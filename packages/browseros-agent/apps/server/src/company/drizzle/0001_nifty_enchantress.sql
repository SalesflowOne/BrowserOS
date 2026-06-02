CREATE TABLE `approvals` (
	`id` text PRIMARY KEY NOT NULL,
	`surface` text NOT NULL,
	`surface_id` text NOT NULL,
	`proposer_employee_id` text NOT NULL,
	`permission_id` text NOT NULL,
	`tool_name` text NOT NULL,
	`tool_input` text DEFAULT '{}' NOT NULL,
	`chain` text DEFAULT '[]' NOT NULL,
	`current_decider_id` text NOT NULL,
	`status` text DEFAULT 'pending' NOT NULL,
	`title` text NOT NULL,
	`detail` text NOT NULL,
	`payload` text,
	`created_at` integer NOT NULL,
	`resolved_at` integer
);
--> statement-breakpoint
CREATE TABLE `channel_members` (
	`channel_id` text NOT NULL,
	`participant_id` text NOT NULL,
	`added_at` integer NOT NULL,
	PRIMARY KEY(`channel_id`, `participant_id`),
	FOREIGN KEY (`channel_id`) REFERENCES `channels`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `channels` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`topic` text,
	`created_by_participant_id` text NOT NULL,
	`archived_at` integer,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `channels_name_unique` ON `channels` (`name`);--> statement-breakpoint
CREATE TABLE `employee_permissions` (
	`employee_id` text NOT NULL,
	`permission_id` text NOT NULL,
	`granted` integer DEFAULT false NOT NULL,
	`always_allow` integer DEFAULT false NOT NULL,
	`delegated_from_employee_id` text,
	`updated_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	PRIMARY KEY(`employee_id`, `permission_id`),
	FOREIGN KEY (`employee_id`) REFERENCES `employees`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`delegated_from_employee_id`) REFERENCES `employees`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE TABLE `messages` (
	`id` text PRIMARY KEY NOT NULL,
	`surface` text NOT NULL,
	`surface_id` text NOT NULL,
	`author_id` text NOT NULL,
	`kind` text NOT NULL,
	`body` text,
	`approval_id` text,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `messages_surface_idx` ON `messages` (`surface`,`surface_id`,`created_at`);--> statement-breakpoint
CREATE TABLE `threads` (
	`id` text PRIMARY KEY NOT NULL,
	`employee_id` text NOT NULL,
	`title` text NOT NULL,
	`is_general` integer DEFAULT false NOT NULL,
	`parent_thread_id` text,
	`created_by_participant_id` text NOT NULL,
	`status` text DEFAULT 'idle' NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`employee_id`) REFERENCES `employees`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`parent_thread_id`) REFERENCES `threads`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
ALTER TABLE `employees` ADD `agent_kind` text DEFAULT 'claude' NOT NULL;--> statement-breakpoint
ALTER TABLE `employees` ADD `model_id` text;--> statement-breakpoint
ALTER TABLE `employees` ADD `reasoning_effort` text;--> statement-breakpoint
ALTER TABLE `employees` ADD `workspace_path` text;