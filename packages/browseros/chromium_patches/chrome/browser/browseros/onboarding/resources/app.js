diff --git a/chrome/browser/browseros/onboarding/resources/app.js b/chrome/browser/browseros/onboarding/resources/app.js
new file mode 100644
index 0000000000000..3962409a6d71f
--- /dev/null
+++ b/chrome/browser/browseros/onboarding/resources/app.js
@@ -0,0 +1,58 @@
+const sources = document.querySelector('#sources');
+const importButton = document.querySelector('#import');
+const refreshButton = document.querySelector('#refresh');
+const continueButton = document.querySelector('#continue');
+const status = document.querySelector('#status');
+
+function send(message, args = []) {
+  chrome.send(message, args);
+}
+
+function renderState(state) {
+  sources.textContent = '';
+
+  for (const source of state.sources) {
+    const option = document.createElement('option');
+    option.value = source.id;
+    option.textContent = source.displayName;
+    sources.appendChild(option);
+  }
+
+  const selectedSource =
+      state.sources.find(source => source.id === sources.value);
+  importButton.disabled =
+      state.status === 'detecting' || state.status === 'importing' ||
+      !selectedSource;
+  refreshButton.disabled =
+      state.status === 'detecting' || state.status === 'importing';
+  sources.disabled =
+      state.status === 'detecting' || state.status === 'importing';
+
+  if (state.error) {
+    status.textContent = `${state.status}: ${state.error.message}`;
+    return;
+  }
+
+  status.textContent = `${state.status} (${state.sources.length} source(s))`;
+}
+
+window.browserosOnboarding = {
+  receiveState: renderState,
+};
+
+importButton.addEventListener('click', () => {
+  if (!sources.value) {
+    return;
+  }
+  send('browserosOnboardingStartImport', [{sourceId: sources.value}]);
+});
+
+refreshButton.addEventListener('click', () => {
+  send('browserosOnboardingRefreshSources');
+});
+
+continueButton.addEventListener('click', () => {
+  send('browserosOnboardingComplete');
+});
+
+send('browserosOnboardingPageReady');
