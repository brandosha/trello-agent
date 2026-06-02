import crypto from "crypto";

import { jwtVerify, SignJWT } from "jose";
import { eq } from "drizzle-orm";

import { config } from "../../config.js";
import { db, getConfigValue, setConfigValue, threadsTable } from "./database.js";

const MCP_JWT_SECRET_CONFIG_KEY = "mcp.jwt_secret";
const MCP_JWT_ISSUER = "trello-agent";
const MCP_JWT_AUDIENCE = "trello-agent-mcp";
const textEncoder = new TextEncoder();

export const MCP_AGENT_ID_HEADER = "X-Agent-ID";

function mcpPort() {
  return config.mcpPort ?? 7655;
}

export function getMcpInternalUrl() {
  return config.mcpInternalUrl ?? `http://trello-agent:${mcpPort()}/mcp`;
}

export function getMcpJwtSecret() {
  if (config.mcpJwtSecret) {
    return config.mcpJwtSecret;
  }

  const existing = getConfigValue(MCP_JWT_SECRET_CONFIG_KEY);
  if (existing) {
    return existing;
  }

  const generated = crypto.randomBytes(32).toString("base64url");
  setConfigValue(MCP_JWT_SECRET_CONFIG_KEY, generated);
  return generated;
}

function secretKey() {
  return textEncoder.encode(getMcpJwtSecret());
}

export async function createMcpBearerToken(agentId: string) {
  return await new SignJWT({ agentId })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuer(MCP_JWT_ISSUER)
    .setAudience(MCP_JWT_AUDIENCE)
    .setSubject(agentId)
    .sign(secretKey());
}

function timingSafeEqualString(a: string, b: string) {
  const aBuffer = Buffer.from(a);
  const bBuffer = Buffer.from(b);
  return aBuffer.length === bBuffer.length && crypto.timingSafeEqual(aBuffer, bBuffer);
}

function extractBearerToken(authorization: string | null) {
  const match = authorization?.match(/^Bearer\s+(.+)$/i);
  return match?.[1];
}

export async function authenticateMcpRequest(request: Request) {
  const token = extractBearerToken(request.headers.get("authorization"));
  if (!token) {
    throw new Error("Missing bearer token");
  }

  const headerAgentId = request.headers.get(MCP_AGENT_ID_HEADER);
  if (!headerAgentId) {
    throw new Error(`Missing ${MCP_AGENT_ID_HEADER} header`);
  }

  const { payload } = await jwtVerify(token, secretKey(), {
    issuer: MCP_JWT_ISSUER,
    audience: MCP_JWT_AUDIENCE,
  });

  const tokenAgentId = typeof payload.agentId === "string" ? payload.agentId : payload.sub;
  if (!tokenAgentId || !timingSafeEqualString(headerAgentId, tokenAgentId)) {
    throw new Error(`${MCP_AGENT_ID_HEADER} does not match bearer token agent id`);
  }

  const existingThread = db.select({ id: threadsTable.id })
    .from(threadsTable)
    .where(eq(threadsTable.id, headerAgentId))
    .get();

  if (!existingThread) {
    throw new Error(`Unknown agent id: ${headerAgentId}`);
  }

  return { token, agentId: headerAgentId };
}
