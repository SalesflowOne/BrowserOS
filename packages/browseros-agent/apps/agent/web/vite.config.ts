import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import tailwindcss from '@tailwindcss/vite'
import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

// web/ → apps/agent (the real app root) → packages/shared/src
const webDir = fileURLToPath(new URL('.', import.meta.url))
const agentRoot = resolve(webDir, '..')
const sharedSrc = resolve(agentRoot, '../../packages/shared/src')

export default defineConfig({
  root: webDir, // serve web/index.html
  envDir: agentRoot, // load apps/agent/.env.development (VITE_PUBLIC_*)
  server: { port: 5300, strictPort: true },
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: [
      // WXT's #imports virtual module — only `storage` is imported from it
      { find: '#imports', replacement: '@wxt-dev/storage' },
      // mirror the WXT/tsconfig path aliases (@/* and ~/* → app root)
      { find: /^@browseros\/shared\/(.*)$/, replacement: `${sharedSrc}/$1` },
      { find: /^@\/(.*)$/, replacement: `${agentRoot}/$1` },
      { find: /^~\/(.*)$/, replacement: `${agentRoot}/$1` },
    ],
  },
})
