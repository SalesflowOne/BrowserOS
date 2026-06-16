diff --git a/chrome/common/pref_names.h b/chrome/common/pref_names.h
index 831ef13b599e6..b291b3328955d 100644
--- a/chrome/common/pref_names.h
+++ b/chrome/common/pref_names.h
@@ -3673,6 +3676,18 @@ inline constexpr char kAuxiliarySearchLastDonatedHistoryEntryVisitTime[] =
 inline constexpr char kAppRatingPromptShown[] = "app_rating_prompt_shown";
 #endif  // BUILDFLAG(IS_ANDROID)
 
+// BrowserOS: metrics prefs
+// String containing the stable client ID for BrowserOS metrics
+inline constexpr char kBrowserOSMetricsClientId[] =
+    "browseros.metrics_client_id";
+
+// String containing the stable install ID for BrowserOS metrics (Local State)
+inline constexpr char kBrowserOSMetricsInstallId[] =
+    "browseros.metrics_install_id";
+
+// NOTE: Other BrowserOS prefs have been moved to
+// chrome/browser/browseros/core/browseros_prefs.h
+
 }  // namespace prefs
 
 #endif  // CHROME_COMMON_PREF_NAMES_H_
