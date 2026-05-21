import crypto from "crypto";
import fs from "fs/promises";

import { logger } from "./Logger.js";
import { configDir, mkConfigDir } from "./paths.js";

const trelloConfigPath = `${configDir}/trello.json`;

export interface TrelloConfig {
  apiKey: string;
  secret: string;
  token: string;
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

export async function setTrelloConfig(newConfig: TrelloConfig): Promise<void> {
  await mkConfigDir;
  const payload = JSON.stringify(newConfig, null, 2);
  storedConfig = Promise.resolve(newConfig);
  await fs.writeFile(trelloConfigPath, payload);
}

export async function getTrelloMember(token: string) {
  const config = await storedConfig;
  if (!config) {
    throw new Error("Trello configuration not found");
  }

  const url = new URL(`https://api.trello.com/1/members/me`);
  url.searchParams.set("key", config.apiKey);
  url.searchParams.set("token", token);
  url.searchParams.set("fields", "id,email");

  const response = await fetch(url.toString());
  if (!response.ok) {
    throw new Error(`Failed to fetch member info: ${response.status} ${response.statusText}`);
  }

  return await response.json() as {
    id: string;
    email: string;
  };
}

export async function getTrelloApiKey() {
  const config = await storedConfig;
  return config?.apiKey;
}

export function verifyTrelloWebhookRequest(request: any, secret: string, callbackURL: string) {
  var base64Digest = function (s: string) {
    return crypto.createHmac("sha1", secret).update(s).digest("base64");
  };
  var content = JSON.stringify(request.body) + callbackURL;
  var doubleHash = base64Digest(content);
  var headerHash = request.headers["x-trello-webhook"];
  return doubleHash == headerHash;
}