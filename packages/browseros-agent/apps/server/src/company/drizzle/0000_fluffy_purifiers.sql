CREATE TABLE `employees` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`role` text NOT NULL,
	`tagline` text,
	`monogram` text NOT NULL,
	`tint` text NOT NULL,
	`bio` text,
	`status` text DEFAULT 'idle' NOT NULL,
	`manager_id` text,
	`created_by_employee_id` text,
	`hired_at` integer NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`manager_id`) REFERENCES `employees`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `settings` (
	`key` text PRIMARY KEY NOT NULL,
	`value` text NOT NULL,
	`updated_at` integer NOT NULL
);
