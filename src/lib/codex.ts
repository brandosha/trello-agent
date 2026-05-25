import { existsSync, mkdirSync } from "fs";
import fs from "fs/promises";
import { ChildProcessWithoutNullStreams, spawn } from "child_process";

import { Codex, Input, Thread, ThreadEvent, ThreadOptions, TurnOptions } from "@openai/codex-sdk";

import { rootDir, dataDir, reposDir } from "./paths.js";
import { HistorySub, Unsubscribe } from "./PubSub.js";
import { Logger } from "./Logger.js";
import { randomStr } from "./utils.js";


const codexInterface = new Codex({
  config: {
    mcp_servers: {
      'trello-agent': {
        command: 'node',
        args: [`${rootDir}/dist/src/mcp.js`],
        default_tools_approval_mode: 'approve',
      }
    },
    approval_policy: 'on-request',
    approvals_reviewer: 'auto_review',
    sandbox_workspace_write: {
      writable_roots: [reposDir],
      network_access: true,
    }
  }
});

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

export class SharedThread extends HistorySub<SharedThreadEvent> {
  id: string;
  workspaceDir: string;

  private _threadDir: string;
  private _filePath: string;
  private _thread: Promise<Thread>;
  private _threadQueue: Promise<Thread>;
  private _fileAppendQueue: Promise<fs.FileHandle>;
  private _abortController = new AbortController();
  private _logAppendQueue: Promise<fs.FileHandle>;
  private _logger = new Logger();
  private _logUnsubscribe: Unsubscribe;
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

    this._filePath = `${this._threadDir}/thread.jsonl`;
    this._fileAppendQueue = mkdir.then(() => fs.open(this._filePath, "a"));
    this._thread = mkdir.then(() => fs.open(this._filePath, "r"))
      .then(async handle => {
        let thread: Thread | undefined
        for await (const line of handle.readLines()) {
          const event = JSON.parse(line) as SharedThreadEvent;
          if (event.type === "thread.started") {
            thread = codexInterface.resumeThread(event.thread_id, options);
          }
          this.publish(event);
        }

        return thread ?? codexInterface.startThread(options);
      })
      .catch(err => {
        if (err.code === "ENOENT") {
          return codexInterface.startThread(options);
        }
        throw err;
      });
    this._threadQueue = this._thread;

    this._logAppendQueue = mkdir.then(() => fs.open(`${this._threadDir}/log.jsonl`, "a"));
    this._logUnsubscribe = this._logger.subscribe(message => {
      this._logAppendQueue = this._logAppendQueue.then(async handle => {
        await handle.appendFile(JSON.stringify(message) + "\n");
        return handle;
      });
    });
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
    return this.history.length === 0;
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

  queueInput(prompt: Input, from: string, options: TurnOptions = {}) {
    this.publish({
      type: "input.prompt.queued",
      from,
      prompt,
      options,
      id: generateEventId(),
      timestamp: new Date(),
    });

    this._logger.info(`Queued input from ${from}: ${JSON.stringify(prompt)}`);

    const promise = this._threadQueue.then(async (thread) => {
      const inputEvent: SharedThreadEvent = {
        type: "input.prompt",
        from,
        prompt,
        options,
        id: generateEventId(),
        timestamp: new Date(),
      };
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
          this.publish(sharedEvent);
          this.recordEvent(sharedEvent);
        }
      } catch (err: any) {
        if (err.name === "AbortError") {
          const abortEvent: SharedThreadEvent = {
            type: "turn.abort",
            id: generateEventId(),
            timestamp: new Date(),
          };
          this.publish(abortEvent);
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
          this.publish(errorEvent);
          this.recordEvent(errorEvent);
        }
      }
      
      return thread;
    });
    this._threadQueue = promise;
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

  private recordEvent(event: SharedThreadEvent) {
    const promise = this._fileAppendQueue.then(async (handle) => {
      await handle.appendFile(JSON.stringify(event) + "\n");
      return handle;
    });
    this._fileAppendQueue = promise;
    return promise;
  }

  destroy() {
    this._abortController.abort();
    this._logUnsubscribe();
    this._logAppendQueue.then(handle => handle.close());
    this._fileAppendQueue.then(handle => handle.close());
  }
}

class CodexSharedThreads {
  private threads: Map<string, SharedThread> = new Map();

  async threadExists(id: string) {
    try {
      await fs.access(`${threadsDir}/${id}/thread.jsonl`);
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
      process: spawn("codex", ["login", "--device-auth"], {
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
      defaultThread.queueInput("Introduce yourself.", "system");
    }
  });
}
