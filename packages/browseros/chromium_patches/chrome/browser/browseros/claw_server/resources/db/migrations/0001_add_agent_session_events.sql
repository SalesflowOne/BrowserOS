diff --git a/chrome/browser/browseros/claw_server/resources/db/migrations/0001_add_agent_session_events.sql b/chrome/browser/browseros/claw_server/resources/db/migrations/0001_add_agent_session_events.sql
new file mode 100644
index 0000000000000..053f829189b41
--- /dev/null
+++ b/chrome/browser/browseros/claw_server/resources/db/migrations/0001_add_agent_session_events.sql
@@ -0,0 +1,23 @@
+CREATE TABLE `agent_session_ends` (
+	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
+	`created_at` integer DEFAULT (unixepoch('subsec') * 1000) NOT NULL,
+	`session_id` text NOT NULL,
+	`kind` text NOT NULL,
+	`reason` text
+);
+--> statement-breakpoint
+CREATE INDEX `agent_session_ends_session_idx` ON `agent_session_ends` (`session_id`);--> statement-breakpoint
+CREATE INDEX `agent_session_ends_created_at_idx` ON `agent_session_ends` (`created_at`);--> statement-breakpoint
+CREATE TABLE `agent_session_starts` (
+	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
+	`created_at` integer DEFAULT (unixepoch('subsec') * 1000) NOT NULL,
+	`session_id` text NOT NULL,
+	`agent_id` text NOT NULL,
+	`slug` text NOT NULL,
+	`agent_label` text NOT NULL,
+	`client_name` text NOT NULL,
+	`client_version` text NOT NULL
+);
+--> statement-breakpoint
+CREATE INDEX `agent_session_starts_session_idx` ON `agent_session_starts` (`session_id`);--> statement-breakpoint
+CREATE INDEX `agent_session_starts_created_at_idx` ON `agent_session_starts` (`created_at`);
\ No newline at end of file
