import crypto from "crypto";

import { getConfigValues, setConfigValues } from "./database.js";

export interface TrelloConfig {
  apiKey: string;
  secret: string;
  token: string;
  webhookOrigin: string;
}

function readTrelloConfig() {
  const dbConfigValues = getConfigValues([
    "trello.api_key",
    "trello.secret",
    "trello.token",
    "trello.webhook_origin"
  ]);

  const config: Partial<TrelloConfig> = {
    apiKey: dbConfigValues["trello.api_key"],
    secret: dbConfigValues["trello.secret"],
    token: dbConfigValues["trello.token"],
    webhookOrigin: dbConfigValues["trello.webhook_origin"]
  };

  return config;
}

let storedConfig = readTrelloConfig();

export async function trelloIsConfigured(): Promise<boolean> {
  const config = storedConfig;
  return !!(config.apiKey && config.secret && config.token && config.webhookOrigin);
}

async function getTrelloConfig(): Promise<TrelloConfig> {
  if (!trelloIsConfigured()) {
    throw new Error("Trello configuration not found");
  }
  return storedConfig as TrelloConfig;
}

export function setTrelloConfig(newConfig: TrelloConfig) {
  storedConfig = newConfig;
  setConfigValues({
    "trello.api_key": newConfig.apiKey,
    "trello.secret": newConfig.secret,
    "trello.token": newConfig.token,
    "trello.webhook_origin": newConfig.webhookOrigin
   });
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
    endpoint: 'members/me?fields=id,username,fullName',
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
