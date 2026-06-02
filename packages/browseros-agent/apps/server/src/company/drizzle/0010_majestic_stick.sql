PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_threads` (
	`id` text PRIMARY KEY NOT NULL,
	`employee_id` text NOT NULL,
	`title` text NOT NULL,
	`is_general` integer DEFAULT false NOT NULL,
	`parent_thread_id` text,
	`created_by_participant_id` text NOT NULL,
	`status` text DEFAULT 'idle' NOT NULL,
	`acpx_session_id` text,
	`agent_kind_override` text,
	`model_id_override` text,
	`reasoning_effort_override` text,
	`workspace_path_override` text,
	`browser_window_id` integer,
	`browser_visibility` text DEFAULT 'hidden' NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`employee_id`) REFERENCES `employees`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`parent_thread_id`) REFERENCES `threads`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
INSERT INTO `__new_threads`("id", "employee_id", "title", "is_general", "parent_thread_id", "created_by_participant_id", "status", "acpx_session_id", "agent_kind_override", "model_id_override", "reasoning_effort_override", "workspace_path_override", "browser_window_id", "browser_visibility", "created_at", "updated_at") SELECT "id", "employee_id", "title", "is_general", "parent_thread_id", "created_by_participant_id", "status", "acpx_session_id", "agent_kind_override", "model_id_override", "reasoning_effort_override", "workspace_path_override", "browser_window_id", "browser_visibility", "created_at", "updated_at" FROM `threads`;--> statement-breakpoint
DROP TABLE `threads`;--> statement-breakpoint
ALTER TABLE `__new_threads` RENAME TO `threads`;--> statement-breakpoint
PRAGMA foreign_keys=ON;