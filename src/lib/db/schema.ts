import { int, sqliteTable, text, index } from "drizzle-orm/sqlite-core";

export const configTable = sqliteTable("config", {
  key: text("key").primaryKey(),
  value: text("value").notNull(),
});

export const usersTable = sqliteTable("users", {
  username: text("username").primaryKey(),
  fullName: text("full_name"),
  createdAt: int("created_at", { mode: "timestamp" }).notNull().$default(() => new Date()),
  updatedAt: int("updated_at", { mode: "timestamp" }).notNull().$default(() => new Date()),
});

export const permissionsTable = sqliteTable("permissions", {
  username: text("username").primaryKey().references(() => usersTable.username),
  permissions: text("permissions").notNull(), // Comma-separated list of permissions
});

export const threadsTable = sqliteTable("threads", {
  id: text("id").primaryKey(),
  codexThreadId: text("codex_thread_id"),
  createdAt: int("created_at", { mode: "timestamp" }).notNull().$default(() => new Date()),
  updatedAt: int("updated_at", { mode: "timestamp" }).notNull().$default(() => new Date()),
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

export const globalLogsTable = sqliteTable("global_logs", {
  id: int("id").primaryKey({ autoIncrement: true }),
  level: text("level").notNull(),
  message: text("message").notNull(),
  timestamp: int("timestamp", { mode: "timestamp" }).notNull().$default(() => new Date()),
});
