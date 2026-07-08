diff --git a/chrome/browser/browseros/server/resources/db/migrations/0000_zippy_psylocke.sql b/chrome/browser/browseros/server/resources/db/migrations/0000_zippy_psylocke.sql
new file mode 100644
index 0000000000000..11b9c1608f731
--- /dev/null
+++ b/chrome/browser/browseros/server/resources/db/migrations/0000_zippy_psylocke.sql
@@ -0,0 +1,17 @@
+CREATE TABLE `agent_definitions` (
+	`id` text PRIMARY KEY NOT NULL,
+	`name` text NOT NULL,
+	`adapter` text NOT NULL,
+	`model_id` text NOT NULL,
+	`reasoning_effort` text NOT NULL,
+	`permission_mode` text DEFAULT 'approve-all' NOT NULL,
+	`session_key` text NOT NULL,
+	`pinned` integer DEFAULT false NOT NULL,
+	`adapter_config_json` text,
+	`created_at` integer NOT NULL,
+	`updated_at` integer NOT NULL
+);
+--> statement-breakpoint
+CREATE UNIQUE INDEX `agent_definitions_session_key_unique` ON `agent_definitions` (`session_key`);--> statement-breakpoint
+CREATE INDEX `agent_definitions_updated_at_idx` ON `agent_definitions` (`updated_at`);--> statement-breakpoint
+CREATE INDEX `agent_definitions_adapter_updated_at_idx` ON `agent_definitions` (`adapter`,`updated_at`);
\ No newline at end of file
