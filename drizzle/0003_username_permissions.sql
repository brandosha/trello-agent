CREATE TABLE `users` (
	`username` text PRIMARY KEY NOT NULL,
	`email` text,
	`full_name` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
INSERT INTO `users` (`username`, `email`, `created_at`, `updated_at`)
SELECT
	`user_id`,
	CASE WHEN instr(`user_id`, '@') > 0 THEN `user_id` ELSE NULL END,
	unixepoch(),
	unixepoch()
FROM `permissions`;
--> statement-breakpoint
CREATE TABLE `permissions_new` (
	`username` text PRIMARY KEY NOT NULL,
	`permissions` text NOT NULL,
	FOREIGN KEY (`username`) REFERENCES `users`(`username`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
INSERT INTO `permissions_new` (`username`, `permissions`)
SELECT `user_id`, `permissions`
FROM `permissions`;
--> statement-breakpoint
DROP TABLE `permissions`;
--> statement-breakpoint
ALTER TABLE `permissions_new` RENAME TO `permissions`;
