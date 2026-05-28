import { db, usersTable } from "./database.js";

export interface UserIdentity {
  username: string;
  fullName?: string;
}

interface TrelloMember {
  username?: unknown;
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
    fullName: valueOrUndefined(member.fullName),
  };
}

export function upsertTrelloUser(member: TrelloMember): UserIdentity {
  const user = parseTrelloMember(member);
  const now = new Date();

  db.insert(usersTable)
    .values({
      username: user.username,
      fullName: user.fullName,
      createdAt: now,
      updatedAt: now,
    })
    .onConflictDoUpdate({
      target: usersTable.username,
      set: {
        fullName: user.fullName,
        updatedAt: now,
      }
    })
    .run();

  return user;
}
