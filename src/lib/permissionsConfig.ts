import fs from "fs/promises";
import path from "path";

import { dataDir } from "./paths.js";

export interface UserPermissions {
  view: boolean;
  edit: boolean;
}

export type PermissionsMap = Record<string, UserPermissions>;

const configDir = path.join(dataDir, "config");
const permissionsPath = path.join(configDir, "permissions.json");

async function ensureConfigDir() {
  await fs.mkdir(configDir, { recursive: true });
}

export async function readPermissions(): Promise<PermissionsMap> {
  try {
    const raw = await fs.readFile(permissionsPath, "utf-8");
    return JSON.parse(raw) as PermissionsMap;
  } catch (err: any) {
    if (err?.code === "ENOENT") return {};
    throw err;
  }
}

export async function writePermissions(permissions: PermissionsMap): Promise<void> {
  await ensureConfigDir();
  const payload = JSON.stringify(permissions, null, 2);
  await fs.writeFile(permissionsPath, payload);
}
