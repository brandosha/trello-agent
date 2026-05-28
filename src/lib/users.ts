import { db, usersTable } from "./database.js";
import { permissions } from "./permissions.js";

export interface UserIdentity {
  username: string;
  email?: string;
  fullName?: string;
}

interface TrelloMember {
  username?: unknown;
  email?: unknown;
  fullName?: unknown;
}

function valueOrUndefined(value: unknown) {
  return typeof value === "string" && value ? value : undefined;
}

function parseTrelloMember(member: TrelloMember): UserIdentity {
  const username = valueOrUndefined(member.username);
  if (!username) {
    throw new Error("Trello member response is missing username.");
  }

  return {
    username,
    email: valueOrUndefined(member.email),
    fullName: valueOrUndefined(member.fullName),
  };
}

async function migrateLegacyEmailPermissions(user: UserIdentity) {
  if (!user.email || user.email === user.username) {
    return;
  }

  await permissions.migrateUserKey(user.email, user.username);
}

export async function upsertTrelloUser(member: TrelloMember): Promise<UserIdentity> {
  const user = parseTrelloMember(member);
  const now = new Date();

  db.insert(usersTable)
    .values({
      username: user.username,
      email: user.email,
      fullName: user.fullName,
      createdAt: now,
      updatedAt: now,
    })
    .onConflictDoUpdate({
      target: usersTable.username,
      set: {
        email: user.email,
        fullName: user.fullName,
        updatedAt: now,
      }
    })
    .run();

  await migrateLegacyEmailPermissions(user);
  return user;
}
