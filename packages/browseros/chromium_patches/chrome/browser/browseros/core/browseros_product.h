diff --git a/chrome/browser/browseros/core/browseros_product.h b/chrome/browser/browseros/core/browseros_product.h
new file mode 100644
index 0000000000000..8ff030b115de6
--- /dev/null
+++ b/chrome/browser/browseros/core/browseros_product.h
@@ -0,0 +1,26 @@
+// Copyright 2024 The Chromium Authors
+// Use of this source code is governed by a BSD-style license that can be
+// found in the LICENSE file.
+
+#ifndef CHROME_BROWSER_BROWSEROS_CORE_BROWSEROS_PRODUCT_H_
+#define CHROME_BROWSER_BROWSEROS_CORE_BROWSEROS_PRODUCT_H_
+
+namespace browseros {
+
+// Product identity for this build. Selected at build time via the
+// `browseros_product` GN arg and baked into the binary, so runtime switches
+// and field trials cannot change it.
+enum class Product {
+  kBrowserOS,
+  kBrowserClaw,
+};
+
+// Returns the product this binary was built as.
+Product GetProduct();
+
+bool IsBrowserOSProduct();
+bool IsBrowserClawProduct();
+
+}  // namespace browseros
+
+#endif  // CHROME_BROWSER_BROWSEROS_CORE_BROWSEROS_PRODUCT_H_
