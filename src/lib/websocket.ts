import { upgradeWebSocket } from "@hono/node-server";
import { WebSocket } from "ws";
import { z } from "zod";

import { generateAuthToken, verifyAuthToken } from "./auth.js";
import { codex, SharedThreadClient } from "./codex.js";
import { logger } from "./Logger.js";
import { trelloIsConfigured, getTrelloMember, setTrelloConfig, getTrelloApiKey } from "./trello.js";
import { hasPermission, listPermissions, setPermissions, UserPermission } from "./permissions.js";
import { WSContext } from "hono/ws";

interface ClientContext {
  codexClients: Map<string, SharedThreadClient>;
  email?: string;
}

type WsMessageHandler = (client: ClientContext, message: any, ws: WSContext<WebSocket>, event: Event) => void | Promise<void>;

class WsError extends Error {
  code: string;
  constructor(code: string, message: string) {
    super(message);
    this.code = code;
  }
}

function wsEndpoint<T>(schema: z.ZodSchema<T>, handler: (client: ClientContext, message: T, ws: WSContext<WebSocket>, event: Event) => void | Promise<void>): WsMessageHandler {
  return async (client, message, ws, event) => {
    let parsed: T;
    try {
      parsed = schema.parse(message);
    } catch (err) {
      if (err instanceof z.ZodError) {
        ws.send(JSON.stringify({
          type: "error",
          code: "INVALID_MESSAGE",
          message: "Invalid message format.",
          err,
        }));
        return;
      }
      throw err;
    }

    try {
      await handler(client, parsed, ws, event);
    } catch (err) {
      if (err instanceof WsError) {
        ws.send(JSON.stringify({
          type: "error",
          code: err.code,
          message: err.message,
        }));
        return;
      }
      throw err;
    }
  }
}

const trelloSetupSchema = z.object({
  type: z.literal("trello.setup"),
  apiKey: z.string(),
  secret: z.string(),
  token: z.string(),
});

const trelloSetupEndpoint = wsEndpoint(trelloSetupSchema, async (client, message, ws) => {
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

  client.email = email;
  ws.send(JSON.stringify({ type: "trello.setup.success" }));
  await setPermissions(email, ['*']);

  const authToken = await generateAuthToken({ email });
  ws.send(JSON.stringify({
    type: "auth",
    authToken,
  }));
});


const trelloAuthSchema = z.object({
  type: z.literal("trello.auth"),
  token: z.string(),
});

const trelloAuthEndpoint = wsEndpoint(trelloAuthSchema, async (client, message, ws) => {
  const { token } = message;

  if (!await trelloIsConfigured()) {
    throw new WsError("TRELLO_NOT_CONFIGURED", "Trello is not configured.");
  }

  const { email } = await getTrelloMember(token);
  client.email = email;

  const authToken = await generateAuthToken({ email });
  ws.send(JSON.stringify({
    type: "auth",
    authToken,
  }));
});

const authMessageSchema = z.object({
  type: z.literal("auth"),
  authToken: z.string().optional(),
});

const authEndpoint = wsEndpoint(authMessageSchema, async (client, message, ws) => {
  if (!await trelloIsConfigured()) {
    throw new WsError("TRELLO_NOT_CONFIGURED", "Trello is not configured.");
  }

  console.log("Received auth message:", message);

  if (!message.authToken) {
    ws.send(JSON.stringify({
      type: "trello.auth.request",
      key: await getTrelloApiKey(),
    }));
    return;
  } else {
    try {
      const payload = await verifyAuthToken(message.authToken);
      if (typeof payload.email !== "string") {
        throw new WsError("INVALID_TOKEN", "Invalid auth token payload.");
      }
      client.email = payload.email;
    } catch (err) {
      console.error("Failed to verify auth token:", err);
      ws.send(JSON.stringify({
        type: "trello.auth.request",
        key: await getTrelloApiKey(),
      }));
      throw new WsError("INVALID_TOKEN", "Failed to verify auth token.");
    }
  }
});

async function checkPermissions(client: ClientContext, permission: UserPermission[]) {
  if (!client.email) {
    throw new WsError("UNAUTHORIZED", "Not authenticated.");
  }

  for (const perm of permission) {
    if (!await hasPermission(client.email, perm)) {
      throw new WsError("FORBIDDEN", `Missing required permission: ${perm}`);
    }
  }
}

const threadCreateSchema = z.object({
  type: z.literal("thread.create"),
  threadId: z.string(),
});

const threadCreateEndpoint = wsEndpoint(threadCreateSchema, async (client, message, ws) => {
  await checkPermissions(client, ['thread.create']);

  const { threadId } = message;
  const exists = await codex.threadExists(threadId);
  if (exists) {
    throw new WsError("THREAD_ALREADY_EXISTS", `Thread ${threadId} already exists.`);
  }

  await codex.thread(threadId);
  ws.send(JSON.stringify({ type: "thread.created", threadId }));
});


const subscribeMessageSchema = z.object({
  type: z.literal("thread.subscribe"),
  threadId: z.string(),
});

const subscribeEndpoint = wsEndpoint(subscribeMessageSchema, async (client, message, ws) => {
  const { threadId } = message;

  await checkPermissions(client, ['thread.view']);

  if (client.codexClients.has(threadId)) {
    throw new WsError("ALREADY_SUBSCRIBED", `Already subscribed to thread ${threadId}.`);
  }

  const exists = await codex.threadExists(threadId);
  if (!exists) {
    logger.warn(`Client attempted to subscribe to non-existent thread: ${threadId}`);
    throw new WsError("THREAD_NOT_FOUND", `Thread ${threadId} does not exist.`);
  }

  const thread = codex.thread(message.threadId);
  const clientInstance = thread.newClient(client.email!);
  client.codexClients.set(threadId, clientInstance);

  clientInstance.subscribe(event => {
    ws.send(JSON.stringify({
      type: "thread.event",
      threadId,
      event
    }));
  });

  for await (const pastEvent of thread.pastEvents()) {
    ws.send(JSON.stringify({
      type: "thread.event",
      threadId,
      event: pastEvent
    }));
  }
});

const abortMessageSchema = z.object({
  type: z.literal("thread.abort"),
  threadId: z.string(),
});

const abortEndpoint = wsEndpoint(abortMessageSchema, async (client, message, ws) => {
  const { threadId } = message;

  await checkPermissions(client, ['thread.abort']);

  const clientInstance = client.codexClients.get(threadId);
  if (!clientInstance) {
    throw new WsError("NOT_SUBSCRIBED", `Not subscribed to thread ${threadId}`);
  }

  clientInstance.sendAbortSignal();
});

const promptMessageSchema = z.object({
  type: z.literal("thread.prompt"),
  threadId: z.string(),
  prompt: z.string(),
});

const promptEndpoint = wsEndpoint(promptMessageSchema, async (client, message, ws) => {
  const { threadId, prompt } = message;

  await checkPermissions(client, ['thread.prompt']);

  const clientInstance = client.codexClients.get(threadId);
  if (!clientInstance) {
    throw new WsError("NOT_SUBSCRIBED", `Not subscribed to thread ${threadId}`);
  }

  clientInstance.sendPrompt(prompt);
});



const permissionsSetSchema = z.object({
  type: z.literal("permissions.set"),
  memberId: z.string(),
  permissions: z.object({
    view: z.boolean(),
    edit: z.boolean(),
    create: z.boolean(),
  }),
});

const permissionsListSchema = z.object({
  type: z.literal("permissions.list"),
});

const permissionsSetEndpoint = wsEndpoint(permissionsSetSchema, async (client, message, ws) => {
  await checkPermissions(client, ['admin']);

  const permissions: UserPermission[] = [];
  if (message.permissions.view) permissions.push('thread.view');
  if (message.permissions.edit) {
    permissions.push('thread.prompt');
    permissions.push('thread.abort');
  }
  if (message.permissions.create) permissions.push('thread.create');

  await setPermissions(message.memberId, permissions);
  ws.send(JSON.stringify({ type: "permissions.updated" }));
});

const permissionsListEndpoint = wsEndpoint(permissionsListSchema, async (client, message, ws) => {
  await checkPermissions(client, ['admin']);
  const permissions = await listPermissions();
  ws.send(JSON.stringify({ type: "permissions.list", permissions }));
});


// const messageSchema = z.union([
//   subscribeMessageSchema,
//   abortMessageSchema,
//   promptMessageSchema,
//   authMessageSchema,
//   trelloSetupSchema,
//   trelloAuthSchema,
//   trelloPermissionsSetSchema,
//   trelloPermissionsListSchema,
//   trelloOAuthRequestSchema,
//   threadCreateSchema,
// ]);


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
};


export const websocketHandler = upgradeWebSocket(c => {

  const codexClients = new Map<string, SharedThreadClient>();
  const ctx: ClientContext = {
    codexClients,
    email: undefined,
  };

  return {
    onOpen: (event, ws) => {
      void (async () => {
        const configured = await trelloIsConfigured();
        ws.send(JSON.stringify({
          type: "trello.status",
          configured,
        }));
      })();
    },
    onMessage: async (event, ws) => {
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
        await endpoint(ctx, data, ws, event);
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
      // logger.log(`WebSocket connection closed for: ${clientId}`);
    },
  }
});