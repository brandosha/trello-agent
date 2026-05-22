import { upgradeWebSocket } from "@hono/node-server";
import { ChildProcessWithoutNullStreams, spawn } from "child_process";
import { WebSocket } from "ws";
import { z } from "zod";

import { generateAuthToken, verifyAuthToken } from "./auth.js";
import { codex, SharedThread } from "./codex.js";
import { logger } from "./Logger.js";
import { trelloIsConfigured, getTrelloMember, setTrelloConfig, getTrelloApiKey } from "./trello.js";
import { permissions, UserPermission, UserPermissions } from "./permissions.js";
import { WSContext } from "hono/ws";
import { Unsubscribe } from "./PubSub.js";

type WsMessage<T> = {
  type: string
} & T

class WsClient {
  ws: WSContext<WebSocket>;
  email?: string;
  permissions?: UserPermissions
  private _unsubscribePermissions?: Unsubscribe;
  codexThreads = new Map<string, SharedThread>();

  constructor(ws: WSContext<WebSocket>) {
    this.ws = ws;
    trelloIsConfigured().then(configured => {
      this.send({
        type: "trello.status",
        configured,
      })
    })
  }

  send<T>(message: WsMessage<T>) {
    this.ws.send(JSON.stringify(message));
  }

  setEmail(email: string) {
    this.email = email;
    this.permissions = permissions.forUser(email);
    this.send({
      type: 'auth.success',
      email,
    })

    this._unsubscribePermissions?.();
    this._unsubscribePermissions = this.permissions.subscribe((perms) => this.send({
      type: 'auth.permissions',
      permissions: perms,
    }))
  }

  async checkPermissions(perms: UserPermission[]) {
    if (!this.permissions) {
      throw new WsError("UNAUTHORIZED", "Not authenticated.");
    }

    for (const perm of perms) {
      if (!await this.permissions.has(perm)) {
        throw new WsError("FORBIDDEN", `Missing required permission: ${perm}`);
      }
    }
  }
}

type WsMessageHandler = (message: any, client: WsClient, event: Event) => void | Promise<void>;

class WsError extends Error {
  code: string;
  constructor(code: string, message: string) {
    super(message);
    this.code = code;
  }
}

function wsEndpoint<T>(schema: z.ZodSchema<T>, handler: (message: T, client: WsClient, event: Event) => void | Promise<void>): WsMessageHandler {
  return async (message, client, event) => {
    let parsed: T;
    try {
      parsed = schema.parse(message);
    } catch (err) {
      if (err instanceof z.ZodError) {
        client.send({
          type: "error",
          code: "INVALID_MESSAGE",
          message: "Invalid message format.",
          err,
        });
        return;
      }
      throw err;
    }

    try {
      await handler(parsed, client, event);
    } catch (err) {
      if (err instanceof WsError) {
        client.send({
          type: "error",
          code: err.code,
          message: err.message,
        });
      } else {
        throw err;
      }
    }
  }
}

const trelloSetupSchema = z.object({
  type: z.literal("trello.setup"),
  apiKey: z.string(),
  secret: z.string(),
  token: z.string(),
});

const trelloSetupEndpoint = wsEndpoint(trelloSetupSchema, async (message, client) => {
  const { apiKey, secret, token } = message;

  if (await trelloIsConfigured()) {
    throw new WsError("TRELLO_ALREADY_CONFIGURED", "Trello is already configured.");
  }
  
  await setTrelloConfig({
    apiKey,
    secret,
    token,
  });

  const { email } = await getTrelloMember(token);

  client.setEmail(email);
  client.send({ type: "trello.setup.success" });
  permissions.forUser(email).set(['*']);

  const authToken = await generateAuthToken({ email });
  client.send({
    type: "auth",
    authToken,
  });
});


const trelloAuthSchema = z.object({
  type: z.literal("trello.auth"),
  token: z.string(),
});

const trelloAuthEndpoint = wsEndpoint(trelloAuthSchema, async (message, client) => {
  const { token } = message;

  if (!await trelloIsConfigured()) {
    throw new WsError("TRELLO_NOT_CONFIGURED", "Trello is not configured.");
  }

  const { email } = await getTrelloMember(token);
  client.setEmail(email);

  const authToken = await generateAuthToken({ email });
  client.send({
    type: "auth",
    authToken,
  });
});


const authMessageSchema = z.object({
  type: z.literal("auth"),
  authToken: z.string().optional(),
});

const authEndpoint = wsEndpoint(authMessageSchema, async (message, client) => {
  if (!await trelloIsConfigured()) {
    throw new WsError("TRELLO_NOT_CONFIGURED", "Trello is not configured.");
  }

  console.log("Received auth message:", message);

  if (!message.authToken) {
    client.send({
      type: "trello.auth.request",
      key: await getTrelloApiKey(),
    });
    return;
  } else {
    try {
      const payload = await verifyAuthToken(message.authToken);
      if (typeof payload.email !== "string") {
        throw new WsError("INVALID_TOKEN", "Invalid auth token payload.");
      }
      client.setEmail(payload.email);
    } catch (err) {
      console.error("Failed to verify auth token:", err);
      client.send({
        type: "trello.auth.request",
        key: await getTrelloApiKey(),
      });
      throw new WsError("INVALID_TOKEN", "Failed to verify auth token.");
    }
  }
});

const threadCreateSchema = z.object({
  type: z.literal("thread.create"),
  threadId: z.string(),
});

const threadCreateEndpoint = wsEndpoint(threadCreateSchema, async (message, client) => {
  await client.checkPermissions(['thread.create']);

  const { threadId } = message;
  const exists = await codex.threadExists(threadId);
  if (exists) {
    throw new WsError("THREAD_ALREADY_EXISTS", `Thread ${threadId} already exists.`);
  }

  await codex.thread(threadId);
  client.send({ type: "thread.created", threadId });
});


const subscribeMessageSchema = z.object({
  type: z.literal("thread.subscribe"),
  threadId: z.string(),
});

const subscribeEndpoint = wsEndpoint(subscribeMessageSchema, async (message, client) => {
  const { threadId } = message;

  await client.checkPermissions(['thread.view']);

  if (client.codexThreads.has(threadId)) {
    throw new WsError("ALREADY_SUBSCRIBED", `Already subscribed to thread ${threadId}.`);
  }

  const exists = await codex.threadExists(threadId);
  if (!exists) {
    logger.warn(`Client attempted to subscribe to non-existent thread: ${threadId}`);
    throw new WsError("THREAD_NOT_FOUND", `Thread ${threadId} does not exist.`);
  }

  const thread = codex.thread(message.threadId);
  // const clientInstance = thread.newClient(client.email!);
  client.codexThreads.set(threadId, thread);

  thread.subscribe(event => {
    client.send({
      type: "thread.event",
      threadId,
      event
    });
  });

  // for await (const pastEvent of thread.pastEvents()) {
  //   ws.send(JSON.stringify({
  //     type: "thread.event",
  //     threadId,
  //     event: pastEvent
  //   }));
  // }
});

const abortMessageSchema = z.object({
  type: z.literal("thread.abort"),
  threadId: z.string(),
});

const abortEndpoint = wsEndpoint(abortMessageSchema, async (message, client) => {
  const { threadId } = message;

  await client.checkPermissions(['thread.abort']);

  codex.thread(threadId).abort(client.email ?? "unk");
});

const promptMessageSchema = z.object({
  type: z.literal("thread.prompt"),
  threadId: z.string(),
  prompt: z.string(),
});

const promptEndpoint = wsEndpoint(promptMessageSchema, async (message, client) => {
  const { threadId, prompt } = message;

  await client.checkPermissions(['thread.prompt']);

  codex.thread(threadId).queueInput(prompt, client.email ?? 'unk')
});

const permissionsSetSchema = z.object({
  type: z.literal("permissions.set"),
  email: z.string(),
  permissions: z.array(z.string()),
});

const permissionsSetEndpoint = wsEndpoint(permissionsSetSchema, async (message, client) => {
  await client.checkPermissions(['admin']);

  const newPermissions = Array.from(new Set(
    message.permissions
      .map((permission) => permission.trim())
      .filter(Boolean)
  )) as UserPermission[];

  try {
    await permissions.forUser(message.email).set(newPermissions);
  } catch (err) {
    if (err instanceof z.ZodError) {
      throw new WsError("INVALID_PERMISSIONS", "Invalid permissions format.");
    } else {
      console.error("Error setting permissions:", err);
      throw new WsError("INTERNAL_ERROR", "Failed to set permissions.");
    }
  }
});


const permissionsListSchema = z.object({
  type: z.literal("permissions.list"),
});

const permissionsListEndpoint = wsEndpoint(permissionsListSchema, async (message, client) => {
  await client.checkPermissions(['admin']);
  
  const allPermissions = await permissions.all();
  const jsonPermissions: Record<string, UserPermission[] | undefined> = {};
  Object.entries(allPermissions).forEach(([email, perms]) => {
    perms?.subscribe(p => client.send({
      type: "permissions.value",
      email,
      permissions: p
    }))
    jsonPermissions[email] = perms?.value;
  });
  // const permissions = await listPermissions();
  // TODO: Remove this and update client side to handle 
  client.send({
    type: "permissions.list",
    permissions: jsonPermissions
  });
});


const codexLoginSchema = z.object({
  type: z.literal("codex.login"),
});

let codexLoginProcess: ChildProcessWithoutNullStreams | undefined

const codexLoginEndpoint = wsEndpoint(codexLoginSchema, async (message, client) => {
  await client.checkPermissions(['admin']);

  if (codexLoginProcess && !codexLoginProcess.killed) {
    throw new WsError("PROCESS_RUNNING", "Codex login is already running.");
  }

  const child = spawn("codex", ["login", "--device-auth"], {
    env: process.env,
    timeout: 600000
  });
  codexLoginProcess = child;

  client.send({ type: "codex.login.started" });

  child.stdout.on("data", (data) => {
    client.send({
      type: "codex.login.output",
      stream: "stdout",
      text: data.toString(),
    });
  });

  child.stderr.on("data", (data) => {
    client.send({
      type: "codex.login.output",
      stream: "stderr",
      text: data.toString(),
    });
  });

  child.on("error", (err) => {
    codexLoginProcess = undefined;
    client.send({
      type: "codex.login.error",
      message: err.message,
    });
  });

  child.on("close", (code, signal) => {
    codexLoginProcess = undefined;
    client.send({
      type: "codex.login.exit",
      code,
      signal,
    });
  });
});

const codexLoginStopSchema = z.object({
  type: z.literal("codex.login.stop"),
});

const codexLoginStopEndpoint = wsEndpoint(codexLoginStopSchema, async (message, client) => {
  await client.checkPermissions(['admin']);

  if (!codexLoginProcess || codexLoginProcess.killed) {
    throw new WsError("NO_PROCESS", "Codex login is not running.");
  }

  codexLoginProcess.kill("SIGTERM");
  client.send({ type: "codex.login.stopped" });
});


const endpoints: Record<string, WsMessageHandler> = {
  "auth": authEndpoint,
  "trello.setup": trelloSetupEndpoint,
  "trello.auth": trelloAuthEndpoint,
  "thread.create": threadCreateEndpoint,
  "thread.subscribe": subscribeEndpoint,
  "thread.prompt": promptEndpoint,
  "thread.abort": abortEndpoint,
  "permissions.set": permissionsSetEndpoint,
  "permissions.list": permissionsListEndpoint,
  "codex.login": codexLoginEndpoint,
  "codex.login.stop": codexLoginStopEndpoint,
};


export const websocketHandler = upgradeWebSocket(c => {

  let client: WsClient | undefined

  return {
    onOpen: (event, ws) => {
      client = new WsClient(ws);
      void (async () => {
        const configured = await trelloIsConfigured();
        ws.send(JSON.stringify({
          type: "trello.status",
          configured,
        }));
      })();
    },
    onMessage: async (event, ws) => {
      if (!client) {
        return;
      }

      let data: any;
      try {
        data = JSON.parse(event.data.toString());
      } catch (err) {
        ws.send(JSON.stringify({
          type: "error",
          code: "INVALID_JSON",
          message: "Invalid JSON format."
        }));
        return;
      }

      const endpoint = endpoints[data.type];

      if (!endpoint) {
        ws.send(JSON.stringify({
          type: "error",
          code: "UNKNOWN_MESSAGE_TYPE",
          message: `Unknown message type: ${data.type}`
        }));
        return;
      }

      try {
        await endpoint(data, client, event);
      } catch (err) {
        console.error(`Error handling message of type ${data.type}:`, err);
        ws.send(JSON.stringify({
          type: "error",
          code: "INTERNAL_ERROR",
          message: "An internal error occurred."
        }));
      }

      return;
    },
    onClose: (event, ws) => {
      
    },
  }
});