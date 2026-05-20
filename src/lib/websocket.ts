import { upgradeWebSocket } from "@hono/node-server";
import { getConnInfo } from '@hono/node-server/conninfo'
import { z } from "zod";

import { codex, SharedThreadClient } from "./codex.js";
import { logger } from "./Logger.js";
import { randomStr } from "./utils.js";
import { readTrelloConfig, writeTrelloConfig } from "./trelloConfig.js";
import { readPermissions, writePermissions } from "./permissionsConfig.js";

const subscribeMessageSchema = z.object({
  type: z.literal("subscribe"),
  threadId: z.string(),
});

const abortMessageSchema = z.object({
  type: z.literal("abort"),
  threadId: z.string(),
});

const promptMessageSchema = z.object({
  type: z.literal("prompt"),
  threadId: z.string(),
  prompt: z.string(),
});

const authMessageSchema = z.object({
  type: z.literal("auth"),
  authToken: z.string(),
});

const trelloSetupSchema = z.object({
  type: z.literal("trello.setup"),
  apiKey: z.string(),
  token: z.string(),
});

const trelloAuthSchema = z.object({
  type: z.literal("trello.auth"),
  token: z.string(),
});

const trelloPermissionsSetSchema = z.object({
  type: z.literal("trello.permissions.set"),
  memberId: z.string(),
  permissions: z.object({
    view: z.boolean(),
    edit: z.boolean(),
  }),
});

const trelloPermissionsListSchema = z.object({
  type: z.literal("trello.permissions.list"),
});

const trelloOAuthRequestSchema = z.object({
  type: z.literal("trello.oauth.request"),
  returnUrl: z.string(),
});

const threadCreateSchema = z.object({
  type: z.literal("thread.create"),
  threadId: z.string(),
});

const messageSchema = z.union([
  subscribeMessageSchema,
  abortMessageSchema,
  promptMessageSchema,
  authMessageSchema,
  trelloSetupSchema,
  trelloAuthSchema,
  trelloPermissionsSetSchema,
  trelloPermissionsListSchema,
  trelloOAuthRequestSchema,
  threadCreateSchema,
]);

async function fetchTrelloMember(apiKey: string, token: string) {
  const url = new URL("https://api.trello.com/1/members/me");
  url.searchParams.set("key", apiKey);
  url.searchParams.set("token", token);
  const response = await fetch(url.toString());
  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Trello auth failed (${response.status}): ${text}`);
  }
  return response.json() as Promise<{ id: string; username?: string }>;
}


export const websocketHandler = upgradeWebSocket(c => {
  const connInfo = getConnInfo(c);
  const ip = connInfo.remote.address;
  const clientId = `${randomStr(8)} (${ip})`;
  logger.log(`New WebSocket connection from: ${clientId}`);

  const codexClients = new Map<string, SharedThreadClient>();
  let connectionAuthToken: string | null = null;
  let memberId: string | null = null;
  let ownerId: string | null = null;
  let permissions = { view: false, edit: false };

  function isOwner() {
    return !!memberId && !!ownerId && memberId === ownerId;
  }

  function canView() {
    return isOwner() || permissions.view;
  }

  function canEdit() {
    return isOwner() || permissions.edit;
  }

  async function updatePermissions(configOwnerId: string, currentMemberId: string) {
    ownerId = configOwnerId;
    if (currentMemberId === configOwnerId) {
      permissions = { view: true, edit: true };
      return;
    }
    const stored = await readPermissions();
    permissions = stored[currentMemberId] || { view: false, edit: false };
  }

  function sendStatus(ws: any, configured: boolean, currentOwnerId?: string | null) {
    ws.send(JSON.stringify({
      type: "trello.status",
      configured,
      ownerId: currentOwnerId || null,
    }));
  }

  function sendAuthStatus(ws: any) {
    ws.send(JSON.stringify({
      type: "trello.auth.status",
      authorized: !!memberId && canView(),
      owner: isOwner(),
      memberId,
      permissions,
    }));
  }

  return {
    onOpen: (event, ws) => {
      logger.log(`WebSocket connection opened for: ${clientId}`);
      void (async () => {
        const config = await readTrelloConfig();
        sendStatus(ws, !!config, config?.ownerId || null);
      })();
    },
    onMessage: async (event, ws) => {
      try {
        const data = JSON.parse(event.data.toString());
        const message = messageSchema.parse(data);

        if (message.type === "auth") {
          connectionAuthToken = message.authToken;
          logger.log(`WebSocket auth token received: ${connectionAuthToken}`);
          return;
        }

        if (message.type === "trello.setup") {
          const existing = await readTrelloConfig();
          if (existing) {
            ws.send(JSON.stringify({ type: "error", error: "Trello is already configured." }));
            return;
          }
          const member = await fetchTrelloMember(message.apiKey, message.token);
          await writeTrelloConfig({
            apiKey: message.apiKey,
            token: message.token,
            ownerId: member.id,
          });
          memberId = member.id;
          await updatePermissions(member.id, member.id);
          const stored = await readPermissions();
          if (!stored[member.id]) {
            stored[member.id] = { view: true, edit: true };
            await writePermissions(stored);
          }
          sendStatus(ws, true, member.id);
          sendAuthStatus(ws);
          return;
        }

        if (message.type === "trello.auth") {
          const config = await readTrelloConfig();
          if (!config) {
            sendStatus(ws, false, null);
            ws.send(JSON.stringify({ type: "error", error: "Trello is not configured." }));
            return;
          }
          const member = await fetchTrelloMember(config.apiKey, message.token);
          memberId = member.id;
          await updatePermissions(config.ownerId, member.id);
          sendAuthStatus(ws);
          if (!canView()) {
            ws.send(JSON.stringify({ type: "error", error: "Not authorized." }));
          }
          return;
        }

        if (message.type === "trello.permissions.list") {
          if (!isOwner()) {
            ws.send(JSON.stringify({ type: "error", error: "Only the owner can view permissions." }));
            return;
          }
          const stored = await readPermissions();
          if (ownerId && !stored[ownerId]) {
            stored[ownerId] = { view: true, edit: true };
          }
          ws.send(JSON.stringify({ type: "trello.permissions", permissions: stored }));
          return;
        }

        if (message.type === "trello.oauth.request") {
          const config = await readTrelloConfig();
          if (!config) {
            sendStatus(ws, false, null);
            ws.send(JSON.stringify({ type: "error", error: "Trello is not configured." }));
            return;
          }
          const oauthUrl = new URL("https://trello.com/1/authorize");
          oauthUrl.searchParams.set("expiration", "never");
          oauthUrl.searchParams.set("name", "trello-agent");
          oauthUrl.searchParams.set("scope", "read,write,account");
          oauthUrl.searchParams.set("response_type", "token");
          oauthUrl.searchParams.set("key", config.apiKey);
          oauthUrl.searchParams.set("return_url", message.returnUrl);
          ws.send(JSON.stringify({ type: "trello.oauth.url", url: oauthUrl.toString() }));
          return;
        }

        if (message.type === "trello.permissions.set") {
          if (!isOwner()) {
            ws.send(JSON.stringify({ type: "error", error: "Only the owner can update permissions." }));
            return;
          }
          const stored = await readPermissions();
          const nextPermissions = message.memberId === ownerId
            ? { view: true, edit: true }
            : message.permissions;
          stored[message.memberId] = nextPermissions;
          await writePermissions(stored);
          ws.send(JSON.stringify({ type: "trello.permissions", permissions: stored }));
          return;
        }

        if (message.type === "thread.create") {
          if (!canEdit()) {
            ws.send(JSON.stringify({ type: "error", error: "Not authorized." }));
            return;
          }
          const exists = await codex.threadExists(message.threadId);
          if (exists) {
            ws.send(JSON.stringify({ type: "error", error: `Thread ${message.threadId} already exists` }));
            return;
          }
          codex.thread(message.threadId);
          ws.send(JSON.stringify({ type: "thread.created", threadId: message.threadId }));
          return;
        }

        if (message.type === "subscribe") {
          if (!memberId || !canView()) {
            ws.send(JSON.stringify({ type: "error", error: "Not authorized." }));
            sendAuthStatus(ws);
            return;
          }
          const { threadId } = message;
          if (codexClients.has(threadId)) {
            ws.send(JSON.stringify({
              type: "error",
              error: `Already subscribed to thread ${threadId}`
            }));
            return;
          }

          const exists = await codex.threadExists(threadId);
          if (!exists) {
            logger.warn(`Client ${clientId} attempted to subscribe to non-existent thread: ${threadId}`);
            ws.send(JSON.stringify({
              type: "error",
              error: `Thread ${threadId} does not exist`
            }));
            return;
          }

          const thread = codex.thread(message.threadId);
          const client = thread.newClient(clientId ?? "unknown");
          codexClients.set(threadId, client);

          client.subscribe(event => {
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
        } else if (message.type === "abort") {
          if (!memberId || !canEdit()) {
            ws.send(JSON.stringify({ type: "error", error: "Not authorized." }));
            sendAuthStatus(ws);
            return;
          }
          const { threadId } = message;
          const client = codexClients.get(threadId);
          if (!client) {
            ws.send(JSON.stringify({
              type: "error",
              error: `Not subscribed to thread ${threadId}`
            }));
            return;
          }
          client.sendAbortSignal();
        } else if (message.type === "prompt") {
          if (!memberId || !canEdit()) {
            ws.send(JSON.stringify({ type: "error", error: "Not authorized." }));
            sendAuthStatus(ws);
            return;
          }
          const { threadId, prompt } = message;
          const client = codexClients.get(threadId);
          if (!client) {
            ws.send(JSON.stringify({
              type: "error",
              error: `Not subscribed to thread ${threadId}`
            }));
            return;
          }
          client.sendPrompt(prompt);
        }
      } catch (err) {
        logger.warn(`Received invalid message from ${clientId}`);
        ws.send(JSON.stringify({
          type: "error",
          error: "Invalid message format."
        }));
        return;
      }
    },
    onClose: (event, ws) => {
      logger.log(`WebSocket connection closed for: ${clientId}`);
    },
  }
});