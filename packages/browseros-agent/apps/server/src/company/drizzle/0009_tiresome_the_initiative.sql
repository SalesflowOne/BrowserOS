ALTER TABLE `threads` ADD `browser_window_id` integer;--> statement-breakpoint
ALTER TABLE `threads` ADD `browser_visibility` text DEFAULT 'visible' NOT NULL;