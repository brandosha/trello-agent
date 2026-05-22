import crypto from "crypto";
import fs from "fs/promises";

import { configDir } from "./paths.js";

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
  const payload = JSON.stringify(newConfig, null, 2);
  storedConfig = Promise.resolve(newConfig);
  await fs.writeFile(trelloConfigPath, payload);
}

export async function makeTrelloApiRequest(endpoint: string, method: string = "GET", body?: any) {
  const config = await storedConfig;
  if (!config) {
    throw new Error("Trello configuration not found");
  }

  const url = new URL(`https://api.trello.com/1/${endpoint}`);
  url.searchParams.set("key", config.apiKey);
  url.searchParams.set("token", config.token);

  const options: RequestInit = {
    method,
    headers: {
      "Content-Type": "application/json",
    },
  };

  if (body) {
    options.body = JSON.stringify(body);
  }

  const response = await fetch(url.toString(), options);
  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Trello API request failed: ${response.status} ${response.statusText}`);
  }

  return await response.json();
}

export async function getTrelloMember(token: string) {
  return await makeTrelloApiRequest(`members/me`, "GET");

  // const config = await storedConfig;
  // if (!config) {
  //   throw new Error("Trello configuration not found");
  // }

  // const url = new URL(`https://api.trello.com/1/members/me`);
  // url.searchParams.set("key", config.apiKey);
  // url.searchParams.set("token", token);
  // url.searchParams.set("fields", "id,email");

  // const response = await fetch(url.toString());
  // if (!response.ok) {
  //   throw new Error(`Failed to fetch member info: ${response.status} ${response.statusText}`);
  // }

  // return await response.json() as {
  //   id: string;
  //   email: string;
  // };
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