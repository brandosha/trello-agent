import fs from "fs/promises";

import { configDir } from "./paths.js";

export type UserPermission = (
  '*' |
  'admin' |
  'thread' |
  'thread.create' |
  'thread.prompt' |
  'thread.abort' |
  'thread.view'
)

export type UserPermissions = UserPermission[]

const permissionsPath = `${configDir}/permissions.json`;
const mkPermissionsDir = fs.mkdir(configDir, { recursive: true });

const permissionsCache: Map<string, UserPermissions> = new Map();
let permissionsIndex: Record<string, UserPermissions> | null = null;

async function readPermissionsIndex(): Promise<Record<string, UserPermissions>> {
  if (permissionsIndex) {
    return permissionsIndex;
  }

  try {
    const raw = await fs.readFile(permissionsPath, "utf-8");
    permissionsIndex = JSON.parse(raw) as Record<string, UserPermissions>;
    return permissionsIndex;
  } catch (err: any) {
    if (err?.code === "ENOENT") {
      permissionsIndex = {};
      return permissionsIndex;
    }
    throw err;
  }
}

async function writePermissionsIndex(index: Record<string, UserPermissions>): Promise<void> {
  await mkPermissionsDir;
  permissionsIndex = index;
  await fs.writeFile(permissionsPath, JSON.stringify(index, null, 2));
}

export async function listPermissions(): Promise<Record<string, UserPermissions>> {
  return readPermissionsIndex();
}

export async function getPermissions(email: string): Promise<UserPermissions | null> {
  if (permissionsCache.has(email)) {
    return permissionsCache.get(email)!;
  }

  const index = await readPermissionsIndex();
  const permissions = index[email] || [];
  permissionsCache.set(email, permissions);
  return permissions;
}

export async function hasPermission(email: string, permission: UserPermission): Promise<boolean> {
  const permissions = await getPermissions(email);
  if (!permissions) {
    return false;
  }

  if (permissions.includes('*') || permissions.includes(permission)) {
    return true;
  }

  let parts = permission.split('.');
  while (parts.length > 2) {
    parts.pop();
    const permToCheck = parts.join('.') as UserPermission;
    if (permissions.includes(permToCheck)) {
      return true;
    }
  }

  return false;
}

export async function setPermissions(email: string, permissions: UserPermissions): Promise<void> {
  permissionsCache.set(email, permissions);
  const index = await readPermissionsIndex();
  index[email] = permissions;
  await writePermissionsIndex(index);
}
