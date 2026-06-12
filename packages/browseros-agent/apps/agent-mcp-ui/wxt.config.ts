import tailwindcss from '@tailwindcss/vite'
import { defineConfig } from 'wxt'

// Mounts the React-only build pipeline (Vite + @vitejs/plugin-react)
// via @wxt-dev/module-react and reserves the cockpit at
// chrome_url_overrides.newtab so the extension takes over the
// new-tab page once installed.
export default defineConfig({
  outDir: 'dist',
  modules: ['@wxt-dev/module-react'],
  manifest: {
    name: 'BrowserOS Agents',
    permissions: ['storage', 'tabs', 'tabGroups', 'sidePanel', 'notifications'],
    host_permissions: ['http://127.0.0.1/*'],
    chrome_url_overrides: { newtab: 'app.html' },
    action: {
      default_title: 'BrowserOS Agents',
    },
  },
  vite: () => ({
    plugins: [tailwindcss()],
  }),
})
