import { serve, upgradeWebSocket } from "@hono/node-server";
import { serveStatic } from "@hono/node-server/serve-static";
import { Hono } from "hono";
import { WebSocketServer } from "ws";

import { join } from "path";

import { config } from "../config.js";
import { rootDir } from "./lib/paths.js";
import { websocketHandler } from "./lib/websocket.js";


const app = new Hono();

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
  console.log(`Server running at http://${config.host}:${info.port}`);
});
