import fs from "fs/promises";

import { z } from "zod";

import { configDir } from "./paths.js";

const PERMISSION_TYPES = [
  'admin',
  'thread',
  'thread.create',
  'thread.prompt',
  'thread.abort',
  'thread.view',
  '*'
] as const;
const userPermissionEnum = z.enum(PERMISSION_TYPES);

export type UserPermission = z.infer<typeof userPermissionEnum>;

const userPermissionsSchema = z.array(userPermissionEnum);
export type UserPermissions = z.infer<typeof userPermissionsSchema>;

const permissionsIndexSchema = z.record(z.string(), userPermissionsSchema.optional());
export type PermissionsIndex = z.infer<typeof permissionsIndexSchema>;

const permissionsPath = `${configDir}/permissions.json`;
const mkPermissionsDir = fs.mkdir(configDir, { recursive: true });

let permissionsIndex = (async () => {
  try {
    const raw = await fs.readFile(permissionsPath, "utf-8");
    return JSON.parse(raw) as PermissionsIndex;
  } catch (err: any) {
    if (err?.code === "ENOENT") {
      return {};
    }
    throw err;
  }
})();

async function writePermissionsIndex(index: PermissionsIndex): Promise<PermissionsIndex> {
  await mkPermissionsDir;
  permissionsIndex = permissionsIndex.then(async () => {
    await fs.writeFile(permissionsPath, JSON.stringify(index, null, 2));
    return index;
  });
  return permissionsIndex;
}

export async function listPermissions(): Promise<PermissionsIndex> {
  return permissionsIndex;
}

export async function getPermissions(email: string): Promise<UserPermissions> {
  const permissions = await permissionsIndex.then(index => index[email] ?? []);
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
  userPermissionsSchema.parse(permissions);
  const index = await permissionsIndex;
  index[email] = permissions;
  await writePermissionsIndex(index);
}
