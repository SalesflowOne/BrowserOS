import tailwindcss from '@tailwindcss/vite'
import { tanstackRouter } from '@tanstack/router-plugin/vite'
import type { Plugin } from 'vite'
import { defineConfig } from 'wxt'

// WXT's module-react auto-injects @vitejs/plugin-react. The router
// plugin checks plugin order in its configResolved hook and refuses
// to run if the React plugin lands before it. autoCodeSplitting is
// the sub-plugin enforcing that check; turning it off keeps the
// route-tree generator (the part we actually need at this stage)
// while sidestepping the order constraint. Code splitting can be
// reinstated later by replacing the WXT module-react with a manual
// @vitejs/plugin-react placement after the router plugin.
function prependRouterPlugin(): Plugin[] {
  const plugins = tanstackRouter({
    target: 'react',
    routesDirectory: './routes',
    generatedRouteTree: './routeTree.gen.ts',
    autoCodeSplitting: false,
  })
  const asArray = Array.isArray(plugins) ? plugins : [plugins]
  return asArray.map((p) => ({ ...p, enforce: 'pre' as const }))
}

// Mounts the React-only build pipeline (Vite + @vitejs/plugin-react)
// and reserves the cockpit at chrome_url_overrides.newtab so the
// extension takes over the new-tab page once installed.
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
    plugins: [...prependRouterPlugin(), tailwindcss()],
  }),
})
