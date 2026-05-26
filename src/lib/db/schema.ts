import { int, sqliteTable, text, index } from "drizzle-orm/sqlite-core";

export const configTable = sqliteTable("config", {
  key: text("key").primaryKey(),
  value: text("value").notNull(),
});

export const permissionsTable = sqliteTable("permissions", {
  userId: text("user_id").primaryKey(),
  permissions: text("permissions").notNull(), // Comma-separated list of permissions
});

export const threadEventsTable = sqliteTable("thread_events", {
  id: int("id").primaryKey({ autoIncrement: true }),
  threadId: text("thread_id").notNull(),
  turnId: text("turn_id"),
  type: text("type").notNull(),
  event: text("event", { mode: "json" }).notNull(),
  timestamp: int("timestamp", { mode: "timestamp" }).notNull().$default(() => new Date()),
}, (table) => [
  index("thread_id_idx").on(table.threadId),
  index("thread_id_type_idx").on(table.threadId, table.type),
]);