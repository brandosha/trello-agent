import { existsSync, mkdirSync } from "fs";
import fs from "fs/promises";

import { Codex, Input, Thread, ThreadEvent, ThreadOptions, TurnOptions } from "@openai/codex-sdk";

import { dataDir } from "./paths.js";
import { PubSub } from "./PubSub.js";


const codexInterface = new Codex();

const threadsDir = `${dataDir}/threads`;
if (!existsSync(threadsDir)) {
  mkdirSync(threadsDir, { recursive: true });
}

interface InputQueuedEvent {
  type: "input.queued";
  from: string;
  input: Input;
  options: TurnOptions;
}

interface InputEvent {
  type: "input";
  from: string;
  input: Input;
  options: TurnOptions;
}

type SharedThreadEvent = (
  ThreadEvent | InputQueuedEvent | InputEvent
) & { timestamp: Date };

class SharedThread extends PubSub<ThreadEvent> {
  id: string;

  private _filePath: string;
  private _thread: Promise<Thread>;
  private _threadQueue: Promise<Thread>;
  private _fileAppendQueue: Promise<fs.FileHandle>;
  private _abortController = new AbortController();

  constructor(id: string, options?: ThreadOptions) {
    super();

    if (!/[a-zA-Z0-9\_\-]/.test(id)) {
      throw new Error("Invalid thread ID");
    }

    this.id = id;
    this._filePath = `${threadsDir}/${id}.jsonl`;
    this._fileAppendQueue = fs.open(this._filePath, "a");
    this._thread = fs.open(this._filePath, "r")
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

  queueInput(input: Input, from: string, options: TurnOptions = {}) {
    const promise = this._threadQueue.then(async (thread) => {
      this.recordEvent({
        type: "input",
        from,
        input,
        options,
        timestamp: new Date(),
      });
      options.signal = this._abortController.signal;
      const { events } = await thread.runStreamed(input, options);
      for await (const event of events) {
        this.publish(event);
        this.recordEvent({
          ...event,
          timestamp: new Date(),
        });
      }
      return thread;
    });
    this._threadQueue = promise;
  }

  async abort() {
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
}

class CodexSharedThreads {
  private threads: Map<string, SharedThread> = new Map();

  threadExists(id: string) {
    return existsSync(`${threadsDir}/${id}.jsonl`);
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