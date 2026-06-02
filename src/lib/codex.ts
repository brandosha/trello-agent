import { EventEmitter } from "events";
import fs from "fs/promises";

import type { Input, ThreadEvent, ThreadOptions, TurnOptions } from "@openai/codex-sdk";
import { eq } from "drizzle-orm";
import { WebSocket } from "ws";

import { config } from "../../config.js";
import { threadsDir } from "./paths.js";
import { HistorySub, PubSub } from "./PubSub.js";
import { db, threadsTable } from "./database.js";

interface PromptEvent {
  type: "input.prompt";
  turnId: string;
  from: string;
  prompt: Input;
  options: TurnOptions;
}

interface AbortEvent {
  type: "input.abort";
  from: string;
}

interface ThreadConfigUpdatedEvent {
  type: "thread.config.updated";
  from: string;
  config: unknown;
}

interface TurnAbortEvent {
  type: "turn.abort";
  turnId: string;
}

interface TurnErrorEvent {
  type: "turn.error";
  turnId: string;
  error: {
    name: string;
    message: string;
  };
}

export type SharedThreadEvent = (
  (ThreadEvent & { turnId: string }) |
  PromptEvent |
  AbortEvent |
  ThreadConfigUpdatedEvent |
  TurnAbortEvent |
  TurnErrorEvent
) & {
  id: string;
  timestamp: Date | string;
};

interface SharedThreadTurn {
  turnId: string;
  events: SharedThreadEvent[];
}

type RemoteThreadEventsResponse = {
  type: "thread.events";
  threadId: number;
  limit?: number;
  offset?: number;
  events: SharedThreadEvent[];
};

type PendingEventsRequest = {
  resolve: (events: SharedThreadEvent[]) => void;
  reject: (error: Error) => void;
};

type CodexLogin = {
  process: EventEmitter;
  output: HistorySub<{ stream: "stdout" | "stderr"; text: string }>;
} | undefined;

function multiagentBaseUrl() {
  return config.multiagentContainerUrl ?? "http://multiagent-container";
}

function toWebSocketUrl(path: string) {
  const url = new URL(path, multiagentBaseUrl());
  if (url.protocol === "https:") {
    url.protocol = "wss:";
  } else if (url.protocol === "http:") {
    url.protocol = "ws:";
  }
  return url;
}

function threadWebSocketUrl(threadId: string) {
  return toWebSocketUrl(`/thread/${encodeURIComponent(threadId)}`);
}

function codexLoginWebSocketUrl() {
  return toWebSocketUrl("/codex-login");
}

function assertStringPrompt(prompt: Input): string {
  if (typeof prompt === "string") {
    return prompt;
  }

  throw new Error("multiagent-container currently accepts string prompts only");
}

export class SharedThread extends PubSub<SharedThreadEvent> {
  id: string;
  workspaceDir: string;

  private _knownBeforeCreate: boolean;
  private _ws?: WebSocket;
  private _connectPromise?: Promise<void>;
  private _pendingEventsRequest?: PendingEventsRequest;
  private _eventsRequestQueue: Promise<unknown> = Promise.resolve();

  constructor(id: string, options: ThreadOptions = {}) {
    super();

    if (!/^[a-zA-Z0-9\_\-]+$/.test(id)) {
      throw new Error("Invalid thread ID");
    }

    this.id = id;
    this.workspaceDir = `${threadsDir}/${id}/workspace`;
    this._knownBeforeCreate = this.ensureThreadRecord();
  }

  async isNew() {
    return !this._knownBeforeCreate;
  }

  async setOptions(options: ThreadOptions) {
    // ThreadOptions applied to local Codex threads are intentionally ignored now.
    // Runtime configuration should be sent through multiagent-container config messages.
  }

  async getEvents(limit = 100, offset = 0) {
    const request = async () => {
      await this.connect();
      return new Promise<SharedThreadEvent[]>((resolve, reject) => {
        this._pendingEventsRequest = { resolve, reject };
        this.send({ type: "events.get", limit, offset });
      });
    };

    const result = this._eventsRequestQueue.then(request, request);
    this._eventsRequestQueue = result.catch(() => undefined);
    return result;
  }

  promptImmediately(prompt: Input, from: string, options: TurnOptions = {}) {
    this.abort(from).catch((error) => {
      console.error(`Failed to abort thread ${this.id} before prompt:`, error);
    });
    return this.queueInput(prompt, from, options);
  }

  async queueInput(prompt: Input, from: string, options: TurnOptions = {}): Promise<SharedThreadTurn> {
    if (Object.keys(options).length > 0) {
      console.warn("TurnOptions are not forwarded to multiagent-container yet.");
    }

    const message = assertStringPrompt(prompt);
    await this.connect();
    this.send({ type: "prompt", from, message });
    return { turnId: "", events: [] };
  }

  async abort(from: string): Promise<void> {
    await this.connect();
    this.send({ type: "abort", from });
  }

  destroy() {
    this.abort("system/destroy").catch((error) => {
      console.error(`Failed to destroy thread ${this.id}:`, error);
    });
    this._ws?.close();
  }

  private connect() {
    if (this._ws?.readyState === WebSocket.OPEN) {
      return Promise.resolve();
    }

    if (this._connectPromise) {
      return this._connectPromise;
    }

    this._connectPromise = new Promise<void>((resolve, reject) => {
      const ws = new WebSocket(threadWebSocketUrl(this.id));
      this._ws = ws;

      ws.on("open", () => {
        resolve();
      });

      ws.on("message", (data) => {
        this.handleMessage(data.toString());
      });

      ws.on("error", (error) => {
        this._pendingEventsRequest?.reject(error instanceof Error ? error : new Error(String(error)));
        this._pendingEventsRequest = undefined;
        reject(error);
      });

      ws.on("close", () => {
        this._pendingEventsRequest?.reject(new Error(`multiagent-container thread ${this.id} disconnected`));
        this._pendingEventsRequest = undefined;
        this._ws = undefined;
        this._connectPromise = undefined;
      });
    });

    return this._connectPromise;
  }

  private handleMessage(data: string) {
    let message: any;
    try {
      message = JSON.parse(data);
    } catch (error) {
      console.error(`Invalid message from multiagent-container for thread ${this.id}:`, data);
      return;
    }

    if (message.type === "thread.connected") {
      return;
    }

    if (message.type === "thread.events") {
      const eventsResponse = message as RemoteThreadEventsResponse;
      this._pendingEventsRequest?.resolve(eventsResponse.events);
      this._pendingEventsRequest = undefined;
      return;
    }

    if (message.type === "request.error") {
      this._pendingEventsRequest?.reject(new Error(message.message ?? "multiagent-container request failed"));
      this._pendingEventsRequest = undefined;
      return;
    }

    if (typeof message.type === "string" && typeof message.id === "string") {
      this.publish(message as SharedThreadEvent);
      return;
    }

    console.warn(`Unhandled message from multiagent-container for thread ${this.id}:`, message);
  }

  private send(message: Record<string, unknown>) {
    if (!this._ws || this._ws.readyState !== WebSocket.OPEN) {
      throw new Error(`Thread ${this.id} is not connected to multiagent-container.`);
    }
    this._ws.send(JSON.stringify(message));
  }

  private ensureThreadRecord() {
    const existing = db.select({ id: threadsTable.id })
      .from(threadsTable)
      .where(eq(threadsTable.id, this.id))
      .get();

    if (existing) {
      return true;
    }

    const now = new Date();
    db.insert(threadsTable)
      .values({
        id: this.id,
        codexThreadId: null,
        createdAt: now,
        updatedAt: now,
      })
      .run();
    return false;
  }
}

class CodexSharedThreads {
  private threads: Map<string, SharedThread> = new Map();
  private _login: CodexLogin;

  async threadExists(id: string) {
    const row = db.select({ id: threadsTable.id })
      .from(threadsTable)
      .where(eq(threadsTable.id, id))
      .get();
    return Boolean(row);
  }

  async listThreads() {
    return db.select({ id: threadsTable.id })
      .from(threadsTable)
      .all()
      .map(({ id }) => id);
  }

  thread(id: string, options?: ThreadOptions) {
    if (this.threads.has(id)) {
      return this.threads.get(id)!;
    }

    const thread = new SharedThread(id, options);
    this.threads.set(id, thread);
    return thread;
  }

  login() {
    if (this._login) {
      return this._login;
    }

    const output = new HistorySub<{ stream: "stdout" | "stderr"; text: string }>();
    const process = new EventEmitter();
    const ws = new WebSocket(codexLoginWebSocketUrl());
    let closed = false;

    const closeLogin = (code: unknown, signal: unknown) => {
      if (closed) {
        return;
      }

      closed = true;
      process.emit("close", code, signal);
      this._login = undefined;
    };

    this._login = { process, output };

    ws.on("message", (data) => {
      try {
        const message = JSON.parse(data.toString());
        if (message.type === "codex.login.output") {
          output.publish({ stream: message.stream, text: message.text });
        } else if (message.type === "codex.login.error") {
          process.emit("error", new Error(message.message));
        } else if (message.type === "codex.login.exit") {
          closeLogin(message.code, message.signal);
          if (message.signal == null && message.code === 0) {
            setupDefaultThread().catch(console.error);
          }
        }
      } catch (error) {
        process.emit("error", error);
      }
    });

    ws.on("error", (error) => {
      process.emit("error", error);
    });

    ws.on("close", () => {
      closeLogin(undefined, undefined);
    });

    return this._login;
  }
}

export const codex = new CodexSharedThreads();

export const DEFAULT_AGENT_INSTRUCTIONS = `
You are the Trello Agent Manager. This is your workspace where you can create and manage any resources you need to operate. memory/ is where you can store any persistent information you want to remember. Use memory/INDEX.md to to help you navigate your memories. You can create files and folders as needed to organize them.

You do not work on tasks directly, the system will create separate threads for each task and assign agents to them. Your role is to create and modify tasks in Trello as instructed.
`.trim();

const defaultThread = codex.thread("default", {
  sandboxMode: "workspace-write",
});

async function setupDefaultThread() {
  const isNew = await defaultThread.isNew();
  await fs.mkdir(defaultThread.workspaceDir, { recursive: true }).catch(() => {});

  if (isNew) {
    defaultThread.promptImmediately(`${DEFAULT_AGENT_INSTRUCTIONS}\n\nIntroduce yourself.`, "system");
  }
}
