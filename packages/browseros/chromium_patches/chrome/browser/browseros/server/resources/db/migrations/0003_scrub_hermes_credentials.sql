diff --git a/chrome/browser/browseros/server/resources/db/migrations/0003_scrub_hermes_credentials.sql b/chrome/browser/browseros/server/resources/db/migrations/0003_scrub_hermes_credentials.sql
new file mode 100644
index 0000000000000..956737aac4c4e
--- /dev/null
+++ b/chrome/browser/browseros/server/resources/db/migrations/0003_scrub_hermes_credentials.sql
@@ -0,0 +1,3 @@
+UPDATE `agent_definitions`
+SET `adapter_config_json` = NULL
+WHERE `adapter` = 'hermes' AND `adapter_config_json` IS NOT NULL;
