import { z } from "zod";
import { eq } from "drizzle-orm";

import { db, permissionsTable, usersTable } from "./database.js";
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


function serializePermissions(permissions: readonly string[]) {
  return permissions.join(",");
}

function parsePermissions(permissions: string) {
  return permissions.split(",").filter(Boolean);
}

function listPermissionValues() {
  const rows = db.select({
    username: permissionsTable.username,
    permissions: permissionsTable.permissions,
  })
    .from(permissionsTable)
    .all();

  return Object.fromEntries(
    rows.map(({ username, permissions }) => [username, parsePermissions(permissions)])
  );
}

function getPermissionValues(username: string) {
  const permissions = db.select({ permissions: permissionsTable.permissions })
    .from(permissionsTable)
    .where(eq(permissionsTable.username, username))
    .get()?.permissions;

  return permissions ? parsePermissions(permissions) : [];
}

function setPermissionValues(username: string, permissions: readonly string[]) {
  const now = new Date();
  db.insert(usersTable)
    .values({ username, createdAt: now, updatedAt: now })
    .onConflictDoNothing()
    .run();

  db.insert(permissionsTable)
    .values({ username, permissions: serializePermissions(permissions) })
    .onConflictDoUpdate({
      target: permissionsTable.username,
      set: { permissions: serializePermissions(permissions) }
    })
    .run();
}

let permissionsIndex = Promise.resolve(
  permissionsIndexSchema.parse(listPermissionValues())
);

async function listPermissions(): Promise<PermissionsIndex> {
  return permissionsIndex;
}

async function getPermissions(username: string): Promise<UserPermissionList> {
  const index = await permissionsIndex;
  if (index[username]) {
    return index[username] ?? [];
  }

  const permissions = userPermissionListSchema.parse(getPermissionValues(username));
  index[username] = permissions;
  return permissions;
}

async function hasPermission(username: string, permission: UserPermission): Promise<boolean> {
  const permissions = await getPermissions(username);
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

async function setPermissions(username: string, permissions: UserPermissionList): Promise<void> {
  userPermissionListSchema.parse(permissions);
  const index = await permissionsIndex;
  index[username] = permissions;
  setPermissionValues(username, permissions);
}

export class UserPermissions extends ValueSub<UserPermissionList> {
  private _username: string;

  constructor(username: string, permissions: UserPermissionList) {
    super(permissions);
    this._username = username;
  }

  async set(permissions: UserPermissionList) {
    await setPermissions(this._username, permissions);
    super.set(permissions);
  }

  async has(permission: UserPermission) {
    return await hasPermission(this._username, permission);
  }
}

class Permissions {
  readonly PERMISSION_TYPES = PERMISSION_TYPES;
  private _users: Record<string, UserPermissions | undefined> = {}

  constructor() {
    permissionsIndex.then(perms => {
      Object.entries(perms).forEach(([username, p]) => {
        const userPermissions = this.forUser(username);
        userPermissions.set(p ?? []);
      })
    })
  }

  forUser(username: string) {
    if (!this._users[username]) {
      this._users[username] = new UserPermissions(username, []);
    }

    return this._users[username];
  }

  async all() {
    await permissionsIndex;
    return this._users;
  }
}

export const permissions = new Permissions();
