CREATE TABLE `channel_member_sessions` (
	`channel_id` text NOT NULL,
	`employee_id` text NOT NULL,
	`last_seen_at` integer DEFAULT 0 NOT NULL,
	`soul_mtime_seen` integer DEFAULT 0 NOT NULL,
	`updated_at` integer NOT NULL,
	PRIMARY KEY(`channel_id`, `employee_id`),
	FOREIGN KEY (`channel_id`) REFERENCES `channels`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`employee_id`) REFERENCES `employees`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `channel_members` (
	`channel_id` text NOT NULL,
	`employee_id` text NOT NULL,
	`added_at` integer NOT NULL,
	PRIMARY KEY(`channel_id`, `employee_id`),
	FOREIGN KEY (`channel_id`) REFERENCES `channels`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`employee_id`) REFERENCES `employees`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `channels` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`topic` text,
	`lead_employee_id` text NOT NULL,
	`created_by_participant_id` text NOT NULL,
	`archived_at` integer,
	`browser_window_id` integer,
	`browser_visibility` text DEFAULT 'hidden' NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`lead_employee_id`) REFERENCES `employees`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `channels_name_unique` ON `channels` (`name`);--> statement-breakpoint
ALTER TABLE `messages` ADD `to_participant_id` text;--> statement-breakpoint
ALTER TABLE `messages` ADD `status` text DEFAULT 'complete' NOT NULL;