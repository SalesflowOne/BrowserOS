CREATE TABLE `announcements` (
	`id` text PRIMARY KEY NOT NULL,
	`employee_id` text NOT NULL,
	`thread_id` text,
	`turn_request_id` text,
	`title` text NOT NULL,
	`body` text NOT NULL,
	`posted_at` integer NOT NULL,
	FOREIGN KEY (`employee_id`) REFERENCES `employees`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`thread_id`) REFERENCES `threads`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `announcements_posted_at_idx` ON `announcements` (`posted_at`);--> statement-breakpoint
CREATE INDEX `announcements_employee_idx` ON `announcements` (`employee_id`);