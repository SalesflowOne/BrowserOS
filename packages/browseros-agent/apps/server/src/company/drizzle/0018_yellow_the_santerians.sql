PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_channels` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`topic` text,
	`lead_employee_id` text NOT NULL,
	`created_by_participant_id` text NOT NULL,
	`archived_at` integer,
	`browser_window_id` integer,
	`browser_visibility` text DEFAULT 'visible' NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`lead_employee_id`) REFERENCES `employees`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
INSERT INTO `__new_channels`("id", "name", "topic", "lead_employee_id", "created_by_participant_id", "archived_at", "browser_window_id", "browser_visibility", "created_at", "updated_at") SELECT "id", "name", "topic", "lead_employee_id", "created_by_participant_id", "archived_at", "browser_window_id", "browser_visibility", "created_at", "updated_at" FROM `channels`;--> statement-breakpoint
DROP TABLE `channels`;--> statement-breakpoint
ALTER TABLE `__new_channels` RENAME TO `channels`;--> statement-breakpoint
PRAGMA foreign_keys=ON;--> statement-breakpoint
CREATE UNIQUE INDEX `channels_name_unique` ON `channels` (`name`);