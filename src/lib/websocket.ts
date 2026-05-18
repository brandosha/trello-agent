import { upgradeWebSocket } from "@hono/node-server";
import { getConnInfo } from '@hono/node-server/conninfo'
import { z } from "zod";

import { codex, SharedThreadClient } from "./codex.js";
import { logger } from "./Logger.js";
import { randomStr } from "./utils.js";

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

const messageSchema = z.union([subscribeMessageSchema, abortMessageSchema, promptMessageSchema]);


export const websocketHandler = upgradeWebSocket(c => {
  const connInfo = getConnInfo(c);
  const ip = connInfo.remote.address;
  const clientId = `${randomStr(8)} (${ip})`;
  logger.log(`New WebSocket connection from: ${clientId}`);

  const codexClients = new Map<string, SharedThreadClient>();

  return {
    onOpen: (event, ws) => {
      logger.log(`WebSocket connection opened for: ${clientId}`);
    },
    onMessage: async (event, ws) => {
      try {
        const data = JSON.parse(event.data.toString());
        const message = messageSchema.parse(data);

        if (message.type === "subscribe") {
          const { threadId } = message;
          if (codexClients.has(threadId)) {
            ws.send(JSON.stringify({
              type: "error",
              error: `Already subscribed to thread ${threadId}`
            }));
            return;
          }

          if (!codex.threadExists(threadId)) {
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