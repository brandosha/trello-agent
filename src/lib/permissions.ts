import { z } from "zod";

import { getPermissionValues, listPermissionValues, setPermissionValues } from "./database.js";
import { ValueSub } from "./PubSub.js";

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



let permissionsIndex = Promise.resolve(
  permissionsIndexSchema.parse(listPermissionValues())
);

async function writePermissionsIndex(index: PermissionsIndex): Promise<PermissionsIndex> {
  permissionsIndex = permissionsIndex.then(async () => {
    Object.entries(index).forEach(([email, permissions]) => {
      setPermissionValues(email, permissions ?? []);
    });
    return index;
  });
  return permissionsIndex;
}

async function listPermissions(): Promise<PermissionsIndex> {
  return permissionsIndex;
}

async function getPermissions(email: string): Promise<UserPermissionList> {
  const index = await permissionsIndex;
  if (index[email]) {
    return index[email] ?? [];
  }

  const permissions = userPermissionListSchema.parse(getPermissionValues(email));
  index[email] = permissions;
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
  setPermissionValues(email, permissions);
}

export class UserPermissions extends ValueSub<UserPermissionList> {
  private _email: string;

  constructor(email: string, permissions: UserPermissionList) {
    super(permissions);
    this._email = email;
  }

  setValue(permissions: UserPermissionList) {
    super.set(permissions);
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
        const userPermissions = this.forUser(email);
        userPermissions.setValue(p ?? []);
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
