diff --git a/chrome/browser/browseros/core/browseros_product.cc b/chrome/browser/browseros/core/browseros_product.cc
new file mode 100644
index 0000000000000..1b51b3ffbdd8a
--- /dev/null
+++ b/chrome/browser/browseros/core/browseros_product.cc
@@ -0,0 +1,84 @@
+// Copyright 2024 The Chromium Authors
+// Use of this source code is governed by a BSD-style license that can be
+// found in the LICENSE file.
+
+#include "chrome/browser/browseros/core/browseros_product.h"
+
+#include <optional>
+#include <string>
+#include <string_view>
+
+#include "base/command_line.h"
+#include "base/logging.h"
+#include "chrome/browser/browseros/buildflags.h"
+#include "chrome/browser/browseros/core/browseros_switches.h"
+
+namespace browseros {
+namespace {
+
+static_assert(BUILDFLAG(BROWSEROS_PRODUCT_BROWSEROS) !=
+                  BUILDFLAG(BROWSEROS_PRODUCT_BROWSERCLAW),
+              "Exactly one BrowserOS product must be selected");
+
+Product GetBakedProduct() {
+#if BUILDFLAG(BROWSEROS_PRODUCT_BROWSERCLAW)
+  return Product::kBrowserClaw;
+#else
+  return Product::kBrowserOS;
+#endif
+}
+
+#if BUILDFLAG(BROWSEROS_ALLOW_RUNTIME_PRODUCT_OVERRIDE)
+constexpr char kBrowserOSProductValue[] = "browseros";
+constexpr char kBrowserClawProductValue[] = "browserclaw";
+
+std::optional<Product> ProductFromSwitchValue(std::string_view value) {
+  if (value == kBrowserOSProductValue) {
+    return Product::kBrowserOS;
+  }
+  if (value == kBrowserClawProductValue) {
+    return Product::kBrowserClaw;
+  }
+  return std::nullopt;
+}
+#endif
+
+}  // namespace
+
+Product GetProduct() {
+  const Product baked_product = GetBakedProduct();
+
+#if BUILDFLAG(BROWSEROS_ALLOW_RUNTIME_PRODUCT_OVERRIDE)
+  if (!base::CommandLine::InitializedForCurrentProcess()) {
+    return baked_product;
+  }
+
+  const base::CommandLine* command_line =
+      base::CommandLine::ForCurrentProcess();
+  if (!command_line->HasSwitch(kBrowserOSProduct)) {
+    return baked_product;
+  }
+
+  const std::string value =
+      command_line->GetSwitchValueASCII(kBrowserOSProduct);
+  std::optional<Product> product = ProductFromSwitchValue(value);
+  if (product.has_value()) {
+    return *product;
+  }
+
+  LOG(WARNING) << "browseros: Ignoring invalid --" << kBrowserOSProduct << "="
+               << value;
+#endif
+
+  return baked_product;
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
