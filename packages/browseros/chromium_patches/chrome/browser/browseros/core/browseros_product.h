diff --git a/chrome/browser/browseros/core/browseros_product.h b/chrome/browser/browseros/core/browseros_product.h
new file mode 100644
index 0000000000000..a55819d454fdd
--- /dev/null
+++ b/chrome/browser/browseros/core/browseros_product.h
@@ -0,0 +1,23 @@
+// Copyright 2024 The Chromium Authors
+// Use of this source code is governed by a BSD-style license that can be
+// found in the LICENSE file.
+
+#ifndef CHROME_BROWSER_BROWSEROS_CORE_BROWSEROS_PRODUCT_H_
+#define CHROME_BROWSER_BROWSEROS_CORE_BROWSEROS_PRODUCT_H_
+
+namespace browseros {
+
+enum class Product {
+  kBrowserOS,
+  kBrowserClaw,
+};
+
+// Returns the baked product, or a dev/test command-line override when enabled.
+Product GetProduct();
+
+bool IsBrowserOSProduct();
+bool IsBrowserClawProduct();
+
+}  // namespace browseros
+
+#endif  // CHROME_BROWSER_BROWSEROS_CORE_BROWSEROS_PRODUCT_H_
