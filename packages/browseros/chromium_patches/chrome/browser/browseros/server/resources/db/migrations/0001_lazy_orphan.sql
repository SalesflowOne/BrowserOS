diff --git a/chrome/browser/browseros/server/resources/db/migrations/0001_lazy_orphan.sql b/chrome/browser/browseros/server/resources/db/migrations/0001_lazy_orphan.sql
new file mode 100644
index 0000000000000..4e729c7ef1927
--- /dev/null
+++ b/chrome/browser/browseros/server/resources/db/migrations/0001_lazy_orphan.sql
@@ -0,0 +1,13 @@
+CREATE TABLE `oauth_tokens` (
+	`browseros_id` text NOT NULL,
+	`provider` text NOT NULL,
+	`access_token` text NOT NULL,
+	`refresh_token` text NOT NULL,
+	`expires_at` integer NOT NULL,
+	`email` text,
+	`account_id` text,
+	`updated_at` integer NOT NULL,
+	PRIMARY KEY(`browseros_id`, `provider`)
+);
+--> statement-breakpoint
+CREATE INDEX `oauth_tokens_browseros_id_idx` ON `oauth_tokens` (`browseros_id`);
\ No newline at end of file
