diff --git a/chrome/browser/browseros/server/resources/db/migrations/0002_chemical_whirlwind.sql b/chrome/browser/browseros/server/resources/db/migrations/0002_chemical_whirlwind.sql
new file mode 100644
index 0000000000000..f8af74aea4431
--- /dev/null
+++ b/chrome/browser/browseros/server/resources/db/migrations/0002_chemical_whirlwind.sql
@@ -0,0 +1,18 @@
+CREATE TABLE `produced_files` (
+	`id` text PRIMARY KEY NOT NULL,
+	`agent_definition_id` text NOT NULL,
+	`session_key` text NOT NULL,
+	`turn_id` text NOT NULL,
+	`turn_prompt` text NOT NULL,
+	`path` text NOT NULL,
+	`size` integer NOT NULL,
+	`mtime_ms` integer NOT NULL,
+	`created_at` integer NOT NULL,
+	`detected_by` text DEFAULT 'diff' NOT NULL,
+	FOREIGN KEY (`agent_definition_id`) REFERENCES `agent_definitions`(`id`) ON UPDATE no action ON DELETE cascade
+);
+--> statement-breakpoint
+CREATE UNIQUE INDEX `produced_files_agent_path_unique` ON `produced_files` (`agent_definition_id`,`path`);--> statement-breakpoint
+CREATE INDEX `produced_files_agent_created_idx` ON `produced_files` (`agent_definition_id`,`created_at`);--> statement-breakpoint
+CREATE INDEX `produced_files_turn_idx` ON `produced_files` (`turn_id`);--> statement-breakpoint
+CREATE INDEX `produced_files_session_idx` ON `produced_files` (`session_key`);
\ No newline at end of file
