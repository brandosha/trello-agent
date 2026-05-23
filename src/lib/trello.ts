import crypto from "crypto";
import fs from "fs/promises";

import { configDir } from "./paths.js";

const trelloConfigPath = `${configDir}/trello.json`;

export interface TrelloConfig {
  apiKey: string;
  secret: string;
  token: string;
  webhookOrigin: string;
}

async function readTrelloConfig() {
  try {
    const raw = await fs.readFile(trelloConfigPath, "utf-8");
    return JSON.parse(raw) as TrelloConfig;
  } catch (err: any) {
    console.error("Error reading Trello configuration:", err);
    return null;
  }
}

let storedConfig = readTrelloConfig();

export async function trelloIsConfigured(): Promise<boolean> {
  const config = await storedConfig;
  return !!(config?.apiKey && config?.secret && config?.token);
}

async function getTrelloConfig(): Promise<TrelloConfig> {
  const config = await storedConfig;
  if (!config) {
    throw new Error("Trello configuration not found");
  }
  return config;
}

export async function setTrelloConfig(newConfig: TrelloConfig): Promise<void> {
  const payload = JSON.stringify(newConfig, null, 2);
  storedConfig = Promise.resolve(newConfig);
  await fs.writeFile(trelloConfigPath, payload);
}

export const TRELLO_CLIENT_IDENTIFIER = "TrelloAgent";
interface TrelloApiRequest {
  method: string;
  endpoint: string;
  body?: any;
  token?: string;
  clientIdentifier?: string;
}
export async function makeTrelloApiRequest(request: TrelloApiRequest) {
  const config = await getTrelloConfig();
  const token = request.token ?? config.token;
  const clientIdentifier = request.clientIdentifier ?? TRELLO_CLIENT_IDENTIFIER;

  const url = new URL(`https://api.trello.com/1/${request.endpoint}`);
  url.searchParams.set("key", config.apiKey);
  url.searchParams.set("token", token);

  const options: RequestInit = {
    method: request.method,
    headers: {
      "Content-Type": "application/json",
      "X-Trello-Client-Identifier": clientIdentifier
    },
  };

  if (request.body) {
    options.body = JSON.stringify(request.body);
  }

  const response = await fetch(url.toString(), options);
  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Trello API request failed: ${response.status} ${response.statusText}\n${errorText}`);
  }

  return await response.json();
}

export async function getTrelloMember(token: string) {
  return await makeTrelloApiRequest({
    method: 'GET',
    endpoint: 'members/me',
    token
  });
}

export async function getTrelloApiKey() {
  const config = await storedConfig;
  return config?.apiKey;
}

export interface TrelloBoard {
  id: string;
  name: string;
  closed?: boolean;
}

export async function listTrelloBoards(): Promise<TrelloBoard[]> {
  const boards = await makeTrelloApiRequest({
    method: 'GET',
    endpoint: 'members/me/boards?fields=id,name,closed',
  });
  return Array.isArray(boards) ? boards.filter((board) => !board.closed) : [];
}

export const TRELLO_WEBHOOK_ROUTE = "/hook/trello";
export async function getTrelloWebhookCallbackUrl() {
  const config = await storedConfig;
  if (!config?.webhookOrigin) {
    throw new Error("Trello webhook host is not configured");
  }

  return `${config.webhookOrigin}${TRELLO_WEBHOOK_ROUTE}`;
}

export interface TrelloWebhook {
  id: string;
  idModel: string;
  callbackURL: string;
  description?: string;
  active?: boolean;
}

export async function listTrelloWebhooks(): Promise<TrelloWebhook[]> {
  const config = await getTrelloConfig();
  return await makeTrelloApiRequest({
    method: 'GET',
    endpoint: `tokens/${config.token}/webhooks`
  });
}

export async function createTrelloWebhook(payload: {
  idModel: string;
  description: string;
  callbackURL: string;
}): Promise<TrelloWebhook> {
  return await makeTrelloApiRequest({
    method: 'POST',
    endpoint: 'webhooks',
    body: payload
  });
}

export async function deleteTrelloWebhook(webhookId: string): Promise<void> {
  await makeTrelloApiRequest({
    method: 'DELETE',
    endpoint: `webhooks/${webhookId}`
  });
}

export interface TrelloWebhookRequest {
  bodyStr: string;
  body: any;
  headers: Record<string, string>;
}

export async function verifyTrelloWebhookRequest(request: TrelloWebhookRequest) {
  const { secret } = await getTrelloConfig();
  const callbackURL = await getTrelloWebhookCallbackUrl();

  const expectedHash =
    crypto.createHmac("sha1", secret)
    .update(request.bodyStr)
    .update(callbackURL)
    .digest("base64");
  const headerHash = request.headers["x-trello-webhook"];
  return expectedHash === headerHash;
}


export async function getThreadUrl(threadId: string) {
  const config = await getTrelloConfig();
  return `${config.webhookOrigin}/${threadId}`;
}