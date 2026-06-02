CREATE TABLE `telegram_active_chat` (
	`connection_id` text NOT NULL,
	`telegram_chat_id` text NOT NULL,
	`thread_id` text NOT NULL,
	`updated_at` integer NOT NULL,
	PRIMARY KEY(`connection_id`, `telegram_chat_id`),
	FOREIGN KEY (`connection_id`) REFERENCES `telegram_connections`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`thread_id`) REFERENCES `threads`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `telegram_chats` (
	`id` text PRIMARY KEY NOT NULL,
	`connection_id` text NOT NULL,
	`telegram_chat_id` text NOT NULL,
	`chat_kind` text NOT NULL,
	`chat_title` text,
	`thread_id` text NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`connection_id`) REFERENCES `telegram_connections`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`thread_id`) REFERENCES `threads`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `telegram_chats_conn_tg_chat` ON `telegram_chats` (`connection_id`,`telegram_chat_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `telegram_chats_thread_unique` ON `telegram_chats` (`thread_id`);--> statement-breakpoint
CREATE TABLE `telegram_connections` (
	`id` text PRIMARY KEY NOT NULL,
	`employee_id` text NOT NULL,
	`name` text NOT NULL,
	`bot_username` text,
	`bot_token_encrypted` text NOT NULL,
	`status` text DEFAULT 'active' NOT NULL,
	`last_error` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`employee_id`) REFERENCES `employees`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `telegram_connections_employee_unique` ON `telegram_connections` (`employee_id`);