import path from 'path';

import { drizzle } from 'drizzle-orm/better-sqlite3';
import { eq, inArray, sql } from 'drizzle-orm';

import { rootDir, dataDir } from './paths.js';
import { configTable } from './db/schema.js';
import { migrate } from 'drizzle-orm/better-sqlite3/migrator';

export * from 'drizzle-orm/sql'
export * from './db/schema.js';
export const db = drizzle(path.join(dataDir, 'trello-agent.db'));
try {
  migrate(db, { migrationsFolder: path.join(rootDir, 'drizzle') });
} catch (err) {
  console.error("Failed to run migrations:", err);
}


export function getConfigValue(key: string) {
  return db.select({ value: configTable.value })
    .from(configTable)
    .where(eq(configTable.key, key))
    .get()?.value;
}

export function setConfigValue(key: string, value: string) {
  db.insert(configTable)
    .values({ key, value })
    .onConflictDoUpdate({
      target: configTable.key,
      set: { value }
    })
    .run();
}


export function getConfigValues<const K extends string>(keys: K[]): Partial<Record<K, string>> {
  const rows = db.select({ key: configTable.key, value: configTable.value })
    .from(configTable)
    .where(inArray(configTable.key, keys))
    .all();

  const result: Partial<Record<K, string>> = {};
  for (const { key, value } of rows) {
    result[key as K] = value;
  }

  return result;
}

export function setConfigValues<const K extends string>(entries: Record<K, string>) {
  const entriesArr = Object.entries(entries) as [K, string][];
  const rows = entriesArr.map(([key, value]) => ({ key, value }));
  db.insert(configTable)
    .values(rows)
    .onConflictDoUpdate({
      target: configTable.key,
      set: { value: sql`excluded.value` }
    })
    .run();
}
