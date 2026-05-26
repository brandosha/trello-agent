CREATE TABLE `config` (
	`key` text PRIMARY KEY NOT NULL,
	`value` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `permissions` (
	`user_id` text PRIMARY KEY NOT NULL,
	`permissions` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `thread_events` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`thread_id` text NOT NULL,
	`turn_id` text,
	`type` text NOT NULL,
	`event` text NOT NULL,
	`timestamp` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `thread_id_idx` ON `thread_events` (`thread_id`);--> statement-breakpoint
CREATE INDEX `thread_id_type_idx` ON `thread_events` (`thread_id`,`type`);