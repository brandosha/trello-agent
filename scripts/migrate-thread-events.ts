import fs from "fs/promises";
import path from "path";

import { eq } from "drizzle-orm";

import { db, threadEventsTable, threadsTable } from "../src/lib/database.js";
import { threadsDir } from "../src/lib/paths.js";

// Run manually with: pnpm exec tsx scripts/migrate-thread-events.ts
type LegacyThreadEvent = {
  id?: unknown;
  type?: unknown;
  turnId?: unknown;
  timestamp?: unknown;
  thread_id?: unknown;
  [key: string]: unknown;
};

async function pathExists(filePath: string) {
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
}

function eventTimestamp(event: LegacyThreadEvent) {
  if (typeof event.timestamp === "string" || typeof event.timestamp === "number") {
    const parsed = new Date(event.timestamp);
    if (!Number.isNaN(parsed.getTime())) {
      return parsed;
    }
  }

  return new Date();
}

function eventTurnId(event: LegacyThreadEvent) {
  return typeof event.turnId === "string" ? event.turnId : null;
}

function codexThreadId(events: LegacyThreadEvent[]) {
  const startedEvent = events.find((event) => (
    event.type === "thread.started" && typeof event.thread_id === "string"
  ));

  return typeof startedEvent?.thread_id === "string" ? startedEvent.thread_id : null;
}

async function readThreadEvents(filePath: string) {
  const raw = await fs.readFile(filePath, "utf-8");
  const events: LegacyThreadEvent[] = [];

  raw.split(/\r?\n/).forEach((line, index) => {
    const trimmed = line.trim();
    if (!trimmed) {
      return;
    }

    try {
      events.push(JSON.parse(trimmed) as LegacyThreadEvent);
    } catch (err) {
      throw new Error(`Invalid JSON in ${filePath}:${index + 1}`, { cause: err });
    }
  });

  return events;
}

function hasMigratedEvents(threadId: string) {
  return !!db.select({ id: threadEventsTable.id })
    .from(threadEventsTable)
    .where(eq(threadEventsTable.threadId, threadId))
    .limit(1)
    .get();
}

async function migrateThread(threadId: string) {
  const threadFile = path.join(threadsDir, threadId, "thread.jsonl");
  if (!await pathExists(threadFile)) {
    return { status: "missing" as const, threadId, count: 0 };
  }

  if (hasMigratedEvents(threadId)) {
    return { status: "skipped" as const, threadId, count: 0 };
  }

  const events = await readThreadEvents(threadFile);
  const threadCodexId = codexThreadId(events);

  db.transaction((tx) => {
    const now = new Date();
    const existing = tx.select({ codexThreadId: threadsTable.codexThreadId })
      .from(threadsTable)
      .where(eq(threadsTable.id, threadId))
      .get();

    if (!existing) {
      tx.insert(threadsTable)
        .values({
          id: threadId,
          codexThreadId: threadCodexId,
          createdAt: now,
          updatedAt: now,
        })
        .run();
    } else if (threadCodexId && !existing.codexThreadId) {
      tx.update(threadsTable)
        .set({
          codexThreadId: threadCodexId,
          updatedAt: now,
        })
        .where(eq(threadsTable.id, threadId))
        .run();
    }

    if (events.length) {
      tx.insert(threadEventsTable)
        .values(events.map((event) => ({
          threadId,
          turnId: eventTurnId(event),
          type: String(event.type ?? "unknown"),
          event,
          timestamp: eventTimestamp(event),
        })))
        .run();
    }
  });

  return { status: "migrated" as const, threadId, count: events.length };
}

async function main() {
  const entries = await fs.readdir(threadsDir, { withFileTypes: true }).catch((err: any) => {
    if (err?.code === "ENOENT") {
      return [];
    }
    throw err;
  });

  const threadIds = entries
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort();

  let migrated = 0;
  let skipped = 0;
  let missing = 0;
  let events = 0;

  for (const threadId of threadIds) {
    const result = await migrateThread(threadId);
    if (result.status === "migrated") {
      migrated++;
      events += result.count;
      console.log(`migrated ${result.threadId}: ${result.count} events`);
    } else if (result.status === "skipped") {
      skipped++;
      console.log(`skipped ${result.threadId}: SQLite events already exist`);
    } else {
      missing++;
      console.log(`missing ${result.threadId}: no thread.jsonl file`);
    }
  }

  console.log(`done: ${migrated} migrated, ${skipped} skipped, ${missing} missing, ${events} events`);
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
