import fs from "fs/promises";

import { z } from "zod";

import { configDir } from "./paths.js";
import { ValueSub } from "./PubSub.js";

const permissionsPath = `${configDir}/permissions.json`;
// const mkPermissionsDir = fs.mkdir(configDir, { recursive: true });

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

const userPermissionListSchema = z.array(userPermissionEnum);
export type UserPermissionList = z.infer<typeof userPermissionListSchema>;

const permissionsIndexSchema = z.record(z.string(), userPermissionListSchema.optional());
export type PermissionsIndex = z.infer<typeof permissionsIndexSchema>;



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
  permissionsIndex = permissionsIndex.then(async () => {
    await fs.writeFile(permissionsPath, JSON.stringify(index, null, 2));
    return index;
  });
  return permissionsIndex;
}

async function listPermissions(): Promise<PermissionsIndex> {
  return permissionsIndex;
}

async function getPermissions(email: string): Promise<UserPermissionList> {
  const permissions = await permissionsIndex.then(index => index[email] ?? []);
  return permissions;
}

async function hasPermission(email: string, permission: UserPermission): Promise<boolean> {
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

async function setPermissions(email: string, permissions: UserPermissionList): Promise<void> {
  userPermissionListSchema.parse(permissions);
  const index = await permissionsIndex;
  index[email] = permissions;
  await writePermissionsIndex(index);
}

export class UserPermissions extends ValueSub<UserPermissionList> {
  private _email: string;

  constructor(email: string, permissions: UserPermissionList) {
    super(permissions);
    this._email = email;
  }

  async set(permissions: UserPermissionList) {
    await setPermissions(this._email, permissions);
    super.set(permissions);
  }

  async has(permission: UserPermission) {
    return await hasPermission(this._email, permission);
  }
}

class Permissions {
  readonly PERMISSION_TYPES = PERMISSION_TYPES;
  private _users: Record<string, UserPermissions | undefined> = {}

  constructor() {
    permissionsIndex.then(perms => {
      Object.entries(perms).forEach(([email, p]) => {
        this.forUser(email).set(p!);
      })
    })
  }

  forUser(email: string) {
    if (!this._users[email]) {
      this._users[email] = new UserPermissions(email, []);
    }

    return this._users[email];
  }

  async all() {
    await permissionsIndex;
    return this._users;
  }
}

export const permissions = new Permissions();