import { serve, upgradeWebSocket } from "@hono/node-server";
import { serveStatic } from "@hono/node-server/serve-static";
import { Hono } from "hono";
import { WebSocketServer } from "ws";

import { join } from "path";

import { config } from "../config.js";
import { rootDir } from "./lib/paths.js";
import { websocketHandler } from "./lib/websocket.js";
import { TRELLO_WEBHOOK_ROUTE, verifyTrelloWebhookRequest } from "./lib/trello.js";
import { trelloWebhookHandler } from "./lib/webhooks.js";
import { logger } from "./lib/Logger.js";


const app = new Hono();

app.use(TRELLO_WEBHOOK_ROUTE, async (c) => {
  console.log(`Received ${c.req.method} request at ${TRELLO_WEBHOOK_ROUTE}`);
  if (c.req.method === "HEAD") {
    return c.text("OK", 200);
  } else if (c.req.method !== "POST") {
    return c.text("Method Not Allowed", 405);
  }

  const bodyStr = await c.req.text();
  const body = JSON.parse(bodyStr);
  const trelloReq = {
    bodyStr, body,
    headers: c.req.header(),
  }
  console.log(trelloReq);
  const verified = await verifyTrelloWebhookRequest(trelloReq);

  if (!verified) {
    return c.text("Unauthorized", 401);
  }

  try {
    await trelloWebhookHandler(trelloReq);
  } catch (error) {
    logger.error(`Error occurred while handling Trello webhook:\n${error}`);
  }

  return c.text("OK", 200);
});

app.get("/ws", websocketHandler);

app.use("/assets/*", serveStatic({ root: join(rootDir, "public") }));
app.use("*", serveStatic({ path: join(rootDir, "public/index.html") }));


const wss = new WebSocketServer({ noServer: true });

serve({
  fetch: app.fetch,
  port: config.port,
  websocket: {
    server: wss,
  },
}, info => {
  console.log(`Server running on port ${info.port}`);
});
