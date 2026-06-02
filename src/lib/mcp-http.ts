import { serve } from "@hono/node-server";
import { Hono } from "hono";
import { AuthInfo, WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/server";

import { config } from "../../config.js";
import { authenticateMcpRequest } from "./mcp-auth.js";
import { createTrelloMcpServer } from "./mcp-server.js";

function mcpPort() {
  return config.mcpPort ?? 7655;
}

function agentIdFromAuth(authInfo: AuthInfo | undefined) {
  const agentId = authInfo?.extra?.agentId;
  return typeof agentId === "string" ? agentId : undefined;
}

export async function startMcpHttpServer() {
  const app = new Hono();
  const server = createTrelloMcpServer({
    enableGitClone: false,
    resolveAgentId: (ctx) => agentIdFromAuth(ctx.http?.authInfo),
  });
  const transport = new WebStandardStreamableHTTPServerTransport({
    sessionIdGenerator: undefined,
    enableJsonResponse: true,
  });

  await server.connect(transport);

  app.all("/mcp", async (c) => {
    let auth;
    try {
      auth = await authenticateMcpRequest(c.req.raw);
    } catch (error) {
      return c.text(error instanceof Error ? error.message : "Unauthorized", 401);
    }

    return await transport.handleRequest(c.req.raw, {
      authInfo: {
        token: auth.token,
        clientId: auth.agentId,
        scopes: ["trello-agent:mcp"],
        extra: { agentId: auth.agentId },
      },
    });
  });

  serve({
    fetch: app.fetch,
    port: mcpPort(),
  }, info => {
    console.log(`Internal MCP server running on port ${info.port}`);
  });
}
