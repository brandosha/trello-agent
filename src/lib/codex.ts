import { existsSync, mkdirSync } from "fs";
import fs from "fs/promises";

import { Codex, Input, Thread, ThreadEvent, ThreadOptions, TurnOptions } from "@openai/codex-sdk";

import { dataDir } from "./paths.js";
import { PubSub, Unsubscribe } from "./PubSub.js";
import { Logger } from "./Logger.js";
import { randomStr } from "./utils.js";


const codexInterface = new Codex();

const threadsDir = `${dataDir}/threads`;
if (!existsSync(threadsDir)) {
  mkdirSync(threadsDir, { recursive: true });
}

interface PromptQueuedEvent {
  type: "input.prompt.queued";
  from: string;
  prompt: Input;
  options: TurnOptions;
}

interface PromptEvent {
  type: "input.prompt";
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
}

interface TurnErrorEvent {
  type: "turn.error";
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

export class SharedThread {
  id: string;

  private _filePath: string;
  private _thread: Promise<Thread>;
  private _threadQueue: Promise<Thread>;
  private _fileAppendQueue: Promise<fs.FileHandle>;
  private _abortController = new AbortController();
  private _logAppendQueue: Promise<fs.FileHandle>;
  private _logger = new Logger();
  private _logUnsubscribe: Unsubscribe;
  private _pubsub = new PubSub<SharedThreadEvent>();

  constructor(id: string, options?: ThreadOptions) {
    if (!/^[a-zA-Z0-9\_\-]+$/.test(id)) {
      throw new Error("Invalid thread ID");
    }

    this.id = id;

    const threadDir = `${threadsDir}/${id}`;
    const mkdir = fs.mkdir(threadDir, { recursive: true });

    this._filePath = `${threadDir}/thread.jsonl`;
    this._fileAppendQueue = fs.open(this._filePath, "a");
    this._thread = mkdir.then(() => fs.open(this._filePath, "r"))
      .then(async handle => {
        for await (const line of handle.readLines()) {
          const startEvent = JSON.parse(line) as ThreadEvent;
          if (startEvent.type === "thread.started") {
            return codexInterface.resumeThread(startEvent.thread_id, options);
          }
          break;
        }

        return codexInterface.startThread(options);
      })
      .catch(err => {
        if (err.code === "ENOENT") {
          return codexInterface.startThread(options);
        }
        throw err;
      });
    this._threadQueue = this._thread;

    this._logAppendQueue = mkdir.then(() => fs.open(`${threadDir}/log.jsonl`, "a"));
    this._logUnsubscribe = this._logger.subscribe(message => {
      this._logAppendQueue = this._logAppendQueue.then(async handle => {
        await handle.appendFile(JSON.stringify(message) + "\n");
        return handle;
      });
    });
  }

  async isNew() {
    const thread = await this._thread;
    return !!thread.id;
  }

  async setOptions(options: ThreadOptions) {
    const thread = await this._thread;
    if (thread.id) {
      this._thread = Promise.resolve(codexInterface.resumeThread(thread.id, options));
    } else {
      this._thread = Promise.resolve(codexInterface.startThread(options));
    }
  }

  private queueInput(prompt: Input, from: string, options: TurnOptions = {}) {
    this._pubsub.publish({
      type: "input.prompt.queued",
      from,
      prompt,
      options,
      id: generateEventId(),
      timestamp: new Date(),
    });

    this._logger.log(`Queued input from ${from}: ${JSON.stringify(prompt)}`, "info");

    const promise = this._threadQueue.then(async (thread) => {
      const inputEvent: SharedThreadEvent = {
        type: "input.prompt",
        from,
        prompt,
        options,
        id: generateEventId(),
        timestamp: new Date(),
      };
      this._pubsub.publish(inputEvent);
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
          this._pubsub.publish(sharedEvent);
          this.recordEvent(sharedEvent);
        }
      } catch (err: any) {
        if (err.name === "AbortError") {
          const abortEvent: SharedThreadEvent = {
            type: "turn.abort",
            id: generateEventId(),
            timestamp: new Date(),
          };
          this._pubsub.publish(abortEvent);
          this.recordEvent(abortEvent);
        } else {
          const errorEvent: SharedThreadEvent = {
            type: "turn.error",
            error: {
              name: err.name,
              message: err.message,
            },
            id: generateEventId(),
            timestamp: new Date(),
          };
          this._pubsub.publish(errorEvent);
          this.recordEvent(errorEvent);
        }
      }
      
      return thread;
    });
    this._threadQueue = promise;
  }

  private async abort(from: string) {
    const abortEvent: SharedThreadEvent = {
      type: "input.abort",
      id: generateEventId(),
      timestamp: new Date(),
      from,
    };
    this._pubsub.publish(abortEvent);
    await this.recordEvent(abortEvent);
    
    this._abortController.abort();
    this._abortController = new AbortController();
  }

  private recordEvent(event: SharedThreadEvent) {
    const promise = this._fileAppendQueue.then(async (handle) => {
      await handle.appendFile(JSON.stringify(event) + "\n");
      return handle;
    });
    this._fileAppendQueue = promise;
    return promise;
  }

  async *pastEvents() {
    const handle = await fs.open(this._filePath, "r");
    for await (const line of handle.readLines()) {
      try {
        const event = JSON.parse(line) as SharedThreadEvent;
        yield event;
      } catch (err) {
        console.error(`Error parsing line: ${line}`);
      }
    }
  }

  newClient(clientId: string) {
    this._logger.log(`New client ${clientId}`, "info");
    return new SharedThreadClient(clientId, this);
  }

  destroy() {
    this._abortController.abort();
    this._logUnsubscribe();
    this._logAppendQueue.then(handle => handle.close());
    this._fileAppendQueue.then(handle => handle.close());
  }
}

export class SharedThreadClient {
  clientId: string;
  thread: SharedThread;

  private _unsubscribers: Unsubscribe[] = [];

  constructor(clientId: string, thread: SharedThread) {
    this.clientId = clientId;
    this.thread = thread;
  }

  sendPrompt(input: Input, options: TurnOptions = {}) {
    // @ts-ignore - accessing private method
    this.thread.queueInput(input, this.clientId, options);
  }

  sendAbortSignal() {
    // @ts-ignore - accessing private method
    this.thread.abort(this.clientId);
  }

  subscribe(callback: (event: SharedThreadEvent) => void) {
    // @ts-ignore - _pubsub is private but we need to subscribe to it
    const unsubscribe = this.thread._pubsub.subscribe(callback);
    this._unsubscribers.push(unsubscribe);
    return unsubscribe;
  }

  destroy() {
    this._unsubscribers.forEach(unsub => unsub());
    this._unsubscribers = [];
  }
}

class CodexSharedThreads {
  private threads: Map<string, SharedThread> = new Map();

  threadExists(id: string) {
    return existsSync(`${threadsDir}/${id}/thread.jsonl`);
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
}

export const codex = new CodexSharedThreads();