import fs from "fs/promises";
import path from "path";

import { dataDir } from "./paths.js";

export interface TrelloConfig {
  apiKey: string;
  token: string;
  ownerId: string;
}

const configDir = path.join(dataDir, "config");
const trelloConfigPath = path.join(configDir, "trello.json");

async function ensureConfigDir() {
  await fs.mkdir(configDir, { recursive: true });
}

export async function readTrelloConfig(): Promise<TrelloConfig | null> {
  try {
    const raw = await fs.readFile(trelloConfigPath, "utf-8");
    return JSON.parse(raw) as TrelloConfig;
  } catch (err: any) {
    if (err?.code === "ENOENT") return null;
    throw err;
  }
}

export async function writeTrelloConfig(config: TrelloConfig): Promise<void> {
  await ensureConfigDir();
  const payload = JSON.stringify(config, null, 2);
  await fs.writeFile(trelloConfigPath, payload);
}
