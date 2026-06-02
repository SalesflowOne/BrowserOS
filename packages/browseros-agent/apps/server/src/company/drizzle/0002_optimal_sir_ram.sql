CREATE TABLE `events` (
	`id` text PRIMARY KEY NOT NULL,
	`thread_id` text NOT NULL,
	`seq` integer NOT NULL,
	`kind` text NOT NULL,
	`payload` text NOT NULL,
	`ts` integer NOT NULL,
	FOREIGN KEY (`thread_id`) REFERENCES `threads`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `events_thread_seq_idx` ON `events` (`thread_id`,`seq`);--> statement-breakpoint
ALTER TABLE `threads` ADD `acpx_session_id` text;