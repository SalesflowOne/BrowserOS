diff --git a/chrome/browser/browseros/core/browseros_product.cc b/chrome/browser/browseros/core/browseros_product.cc
new file mode 100644
index 0000000000000..566bd675f9fd3
--- /dev/null
+++ b/chrome/browser/browseros/core/browseros_product.cc
@@ -0,0 +1,31 @@
+// Copyright 2024 The Chromium Authors
+// Use of this source code is governed by a BSD-style license that can be
+// found in the LICENSE file.
+
+#include "chrome/browser/browseros/core/browseros_product.h"
+
+#include "chrome/browser/browseros/buildflags.h"
+
+namespace browseros {
+
+static_assert(BUILDFLAG(BROWSEROS_PRODUCT_BROWSEROS) !=
+                  BUILDFLAG(BROWSEROS_PRODUCT_BROWSERCLAW),
+              "Exactly one BrowserOS product must be selected");
+
+Product GetProduct() {
+#if BUILDFLAG(BROWSEROS_PRODUCT_BROWSERCLAW)
+  return Product::kBrowserClaw;
+#else
+  return Product::kBrowserOS;
+#endif
+}
+
+bool IsBrowserOSProduct() {
+  return GetProduct() == Product::kBrowserOS;
+}
+
+bool IsBrowserClawProduct() {
+  return GetProduct() == Product::kBrowserClaw;
+}
+
+}  // namespace browseros
