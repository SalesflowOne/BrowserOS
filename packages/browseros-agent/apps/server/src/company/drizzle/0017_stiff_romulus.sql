ALTER TABLE `employees` ADD `browser_window_id` integer;--> statement-breakpoint
ALTER TABLE `employees` ADD `browser_visibility` text DEFAULT 'visible' NOT NULL;--> statement-breakpoint
ALTER TABLE `threads` DROP COLUMN `browser_window_id`;--> statement-breakpoint
ALTER TABLE `threads` DROP COLUMN `browser_visibility`;