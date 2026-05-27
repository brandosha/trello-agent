import { existsSync, mkdirSync } from "fs";
import fs from "fs/promises";
import { ChildProcessWithoutNullStreams, spawn } from "child_process";
import path from "path";

import { Codex, Input, Thread, ThreadEvent, ThreadOptions, TurnOptions } from "@openai/codex-sdk";
import { and, desc, eq } from "drizzle-orm";

import { rootDir, dataDir, reposDir } from "./paths.js";
import { HistorySub, PubSub } from "./PubSub.js";
import { randomStr } from "./utils.js";
import { db, threadEventsTable, threadsTable } from "./database.js";


const codexInterface = new Codex({
  config: {
    mcp_servers: {
      'trello-agent': {
        command: 'node',
        args: [`${rootDir}/dist/src/mcp.js`],
        default_tools_approval_mode: 'approve',
      }
    },
    sandbox_mode: 'danger-full-access',
    approval_policy: 'on-request',
    approvals_reviewer: 'auto_review',
    sandbox_workspace_write: {
      writable_roots: [reposDir],
      network_access: true,
    }
  }
});

const codexCliPath = process.env.CODEX_CLI_PATH
  ?? path.join(rootDir, "node_modules", ".bin", process.platform === "win32" ? "codex.cmd" : "codex");

const threadsDir = `${dataDir}/threads`;
if (!existsSync(threadsDir)) {
  mkdirSync(threadsDir, { recursive: true });
}

interface PromptQueuedEvent {
  type: "input.prompt.queued";
  turnId: string;
  from: string;
  prompt: Input;
  options: TurnOptions;
}

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
  }
}

type SharedThreadEvent = (
  ThreadEvent | PromptQueuedEvent | PromptEvent | AbortEvent | TurnAbortEvent | TurnErrorEvent
) & {
  id: string;
  timestamp: Date
};

function generateEventId() {
  return randomStr(5);
}

interface SharedThreadTurn {
  turnId: string;
  events: SharedThreadEvent[];
}

export class SharedThread extends PubSub<SharedThreadEvent> {
  id: string;
  workspaceDir: string;

  private _threadDir: string;
  private _thread: Promise<Thread>;
  private _threadQueue: Promise<Thread>;
  private _abortController = new AbortController();
  // private _pubsub = new PubSub<SharedThreadEvent>();

  constructor(id: string, options: ThreadOptions = {}) {
    super()

    if (!/^[a-zA-Z0-9\_\-]+$/.test(id)) {
      throw new Error("Invalid thread ID");
    }

    this.id = id;

    this._threadDir = `${threadsDir}/${id}`;
    this.workspaceDir = `${this._threadDir}/workspace`;
    const mkdir = fs.mkdir(this.workspaceDir, { recursive: true });
    options = this.configureOptions(options);

    this._thread = mkdir.then(() => {
      this.ensureThreadRecord();
      return this.loadThread(options);
    });
    this._threadQueue = this._thread;
  }

  private configureOptions(options: ThreadOptions) {
    return {
      ...options,
      workingDirectory: this.workspaceDir,
      skipGitRepoCheck: true,
    };
  }

  async isNew() {
    await this._thread;
    const event = db.select({ id: threadEventsTable.id })
      .from(threadEventsTable)
      .where(eq(threadEventsTable.threadId, this.id))
      .limit(1)
      .get();
    return !event;
  }

  getEvents(limit = 100, offset = 0) {
    const rows = db.select({ event: threadEventsTable.event })
      .from(threadEventsTable)
      .where(eq(threadEventsTable.threadId, this.id))
      .orderBy(desc(threadEventsTable.id))
      .limit(limit)
      .offset(offset)
      .all();

    return rows
      .map(({ event }) => event as SharedThreadEvent)
      .reverse();
  }

  async setOptions(options: ThreadOptions) {
    const thread = await this._thread;
    options = this.configureOptions(options);
    if (thread.id) {
      this._thread = Promise.resolve(codexInterface.resumeThread(thread.id, options));
    } else {
      this._thread = Promise.resolve(codexInterface.startThread(options));
    }
  }

  promptImmediately(prompt: Input, from: string, options: TurnOptions = {}) {
    this.queueInput(prompt, from, options)
    this.abort(from);
  }

  queueInput(prompt: Input, from: string, options: TurnOptions = {}): Promise<SharedThreadTurn> {
    const turnId = generateEventId();
    const result: SharedThreadTurn = {
      turnId,
      events: []
    };
    
    const queuedEvent: SharedThreadEvent = {
      type: "input.prompt.queued",
      turnId,
      from,
      prompt,
      options,
      id: generateEventId(),
      timestamp: new Date(),
    }
    result.events.push(queuedEvent);
    this.publish(queuedEvent);
    this.recordEvent(queuedEvent);
    const promise = this._threadQueue.then(async (thread) => {
      const inputEvent: SharedThreadEvent = {
        type: "input.prompt",
        turnId,
        from,
        prompt,
        options,
        id: generateEventId(),
        timestamp: new Date(),
      };
      result.events.push(inputEvent);
      this.publish(inputEvent);
      this.recordEvent(inputEvent);

      options.signal = this._abortController.signal;
      try {
        const { events } = await thread.runStreamed(prompt, options);
        for await (const event of events) {
          const sharedEvent: SharedThreadEvent = {
            ...event,
            id: generateEventId(),
            timestamp: new Date(),
          };
          result.events.push(sharedEvent);
          this.publish(sharedEvent);
          this.recordEvent(sharedEvent);
        }
      } catch (err: any) {
        if (err.name === "AbortError") {
          const abortEvent: SharedThreadEvent = {
            type: "turn.abort",
            turnId,
            id: generateEventId(),
            timestamp: new Date(),
          };
          result.events.push(abortEvent);
          this.publish(abortEvent);
          this.recordEvent(abortEvent);
        } else {
          const errorEvent: SharedThreadEvent = {
            type: "turn.error",
            turnId,
            error: {
              name: err.name,
              message: err.message,
            },
            id: generateEventId(),
            timestamp: new Date(),
          };
          result.events.push(errorEvent);
          this.publish(errorEvent);
          this.recordEvent(errorEvent);
        }
      }
      
      return thread;
    });
    this._threadQueue = promise;

    return promise.then(() => result);
  }

  async abort(from: string) {
    const abortEvent: SharedThreadEvent = {
      type: "input.abort",
      id: generateEventId(),
      timestamp: new Date(),
      from,
    };
    this.publish(abortEvent);
    await this.recordEvent(abortEvent);
    
    this._abortController.abort();
    this._abortController = new AbortController();
  }

  private ensureThreadRecord() {
    const now = new Date();
    db.insert(threadsTable)
      .values({
        id: this.id,
        codexThreadId: null,
        createdAt: now,
        updatedAt: now,
      })
      .onConflictDoNothing()
      .run();
  }

  private loadThread(options: ThreadOptions) {
    const threadRecord = db.select({ codexThreadId: threadsTable.codexThreadId })
      .from(threadsTable)
      .where(eq(threadsTable.id, this.id))
      .get();

    let codexThreadId = threadRecord?.codexThreadId;
    if (!codexThreadId) {
      const startedEvent = db.select({ event: threadEventsTable.event })
        .from(threadEventsTable)
        .where(and(
          eq(threadEventsTable.threadId, this.id),
          eq(threadEventsTable.type, "thread.started")
        ))
        .orderBy(desc(threadEventsTable.id))
        .limit(1)
        .get()?.event as SharedThreadEvent | undefined;

      if (
        startedEvent?.type === "thread.started"
        && "thread_id" in startedEvent
        && typeof startedEvent.thread_id === "string"
      ) {
        codexThreadId = startedEvent.thread_id;
        this.setCodexThreadId(codexThreadId);
      }
    }

    return codexThreadId
      ? codexInterface.resumeThread(codexThreadId, options)
      : codexInterface.startThread(options);
  }

  private setCodexThreadId(codexThreadId: string) {
    db.update(threadsTable)
      .set({
        codexThreadId,
        updatedAt: new Date(),
      })
      .where(eq(threadsTable.id, this.id))
      .run();
  }

  private recordEvent(event: SharedThreadEvent) {
    db.insert(threadEventsTable)
      .values({
        threadId: this.id,
        turnId: "turnId" in event ? event.turnId : null,
        type: event.type,
        event,
        timestamp: event.timestamp,
      })
      .run();

    if (event.type === "thread.started" && "thread_id" in event && typeof event.thread_id === "string") {
      this.setCodexThreadId(event.thread_id);
    }

    return Promise.resolve();
  }

  destroy() {
    this._abortController.abort();
  }
}

class CodexSharedThreads {
  private threads: Map<string, SharedThread> = new Map();

  async threadExists(id: string) {
    try {
      await fs.access(`${threadsDir}/${id}/workspace`);
      return true;
    } catch {
      return false;
    }
  }

  async listThreads() {
    const entries = await fs.readdir(threadsDir, { withFileTypes: true });
    return entries
      .filter(entry => entry.isDirectory())
      .map(entry => entry.name);
  }

  thread(id: string, options?: ThreadOptions) {
    if (this.threads.has(id)) {
      return this.threads.get(id)!;
    } else {
      const thread = new SharedThread(id, options);
      this.threads.set(id, thread);
      return thread;
    }
  }

  private _login: CodexLogin;
  login() {
    if (this._login) {
      return this._login;
    }

    const login = this._login = {
      process: spawn(codexCliPath, ["login", "--device-auth"], {
        env: process.env,
        timeout: 600000
      }),
      output: new HistorySub()
    };

    login.process.stdout.on("data", (data) => {
      login.output.publish({ stream: 'stdout', text: data.toString() });
    });

    login.process.stderr.on("data", (data) => {
      login.output.publish({ stream: 'stderr', text: data.toString() });
    });

    login.process.on("close", (code, signal) => {
      this._login = undefined;
      if (signal == null && code === 0) {
        setupDefaultThread().catch(console.error);
      }
    });

    return login;
  }
}
type CodexLogin = {
  process: ChildProcessWithoutNullStreams;
  output: HistorySub<{ stream: 'stdout' | 'stderr', text: string }>;
} | undefined;

export const codex = new CodexSharedThreads();


export const DEFAULT_AGENT_INSTRUCTIONS = `
You are the Trello Agent Manager. This is your workspace where you can create and manage any resources you need to operate. memory/ is where you can store any persistent information you want to remember. Use memory/INDEX.md to to help you navigate your memories. You can create files and folders as needed to organize your workspace.
You also have access to the trello API through the Trello mcp tool. Use it to understand trello boards, lists, and cards, and to create and manage them as needed when instructed.

You do not work on tasks directly, the sytem will create seperate threads for each task and assign agents to them. Your role is to create and modify tasks in Trello as instructed.
`.trim();

const defaultThread = codex.thread("default", {
  sandboxMode: 'workspace-write',
});
async function setupDefaultThread() {
  await defaultThread.isNew().then(async (isNew) => {
    const { workspaceDir } = defaultThread;

    await fs.mkdir(`${workspaceDir}/memory`, { recursive: true });
    await fs.writeFile(`${workspaceDir}/memory/INDEX.md`, "No memories yet.", { flag: "wx" }).catch(() => {});
    await fs.writeFile(`${workspaceDir}/AGENTS.md`, DEFAULT_AGENT_INSTRUCTIONS);

    if (isNew) {
      defaultThread.promptImmediately("Introduce yourself.", "system");
    }
  });
}
