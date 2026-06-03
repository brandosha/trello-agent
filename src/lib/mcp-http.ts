import { serve } from "@hono/node-server";
import { Hono } from "hono";
import { AuthInfo, WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/server";

import { config } from "../../config.js";
import { createTrelloMcpServer } from "./mcp-server.js";
import { verifyAuthToken } from "./auth.js";


export const MCP_AGENT_ID_HEADER = "X-Agent-Id";

function mcpPort() {
  return config.mcpPort ?? 7655;
}

export function getMcpInternalUrl() {
  return config.mcpInternalUrl ?? `http://trello-agent:${mcpPort()}/mcp`;
}

function agentIdFromAuth(authInfo: AuthInfo | undefined) {
  const agentId = authInfo?.extra?.agentId;
  return typeof agentId === "string" ? agentId : undefined;
}

export async function startMcpHttpServer() {
  const app = new Hono();
  const server = createTrelloMcpServer({
    resolveAgentId: (ctx) => agentIdFromAuth(ctx.http?.authInfo),
  });
  const transport = new WebStandardStreamableHTTPServerTransport({
    sessionIdGenerator: undefined,
    enableJsonResponse: true,
  });

  await server.connect(transport);

  app.all("/mcp", async (c) => {
    console.log("Received MCP request:", c.req.method, c.req.url);
    console.log("Request headers:", Object.fromEntries(c.req.raw.headers.entries().toArray()));
    let auth;
    try {
      auth = await authenticateMcpRequest(c.req.raw);
    } catch (error) {
      console.error("MCP authentication failed:", error);
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

async function authenticateMcpRequest(req: Request): Promise<any> {
  const authHeader = req.headers.get("authorization");
  const token = authHeader?.startsWith("Bearer ") ? authHeader.slice(7) : null;
  if (!token) {
    throw new Error("Missing bearer token");
  }

  const headerAgentId = req.headers.get(MCP_AGENT_ID_HEADER);
  if (!headerAgentId) {
    throw new Error(`Missing ${MCP_AGENT_ID_HEADER} header`);
  }

  const auth = await verifyAuthToken(token);
  if (typeof auth.agentId !== "string") {
    throw new Error("Invalid token payload: missing agentId");
  }

  if (auth.agentId !== headerAgentId) {
    throw new Error("Token agentId does not match header agentId");
  }

  return { token, agentId: headerAgentId };
}

