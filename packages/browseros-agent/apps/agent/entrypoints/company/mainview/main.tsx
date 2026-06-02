import { QueryClientProvider } from '@tanstack/react-query'
import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { Toaster } from 'sonner'
import './index.css'
import { queryClient } from './modules/api/queryClient'
import { ThemeApplier } from './modules/system/theme-applier'
import { Router } from './router'

// Pre-apply OS appearance before React mounts so users on dark OS don't
// see a light flash before next-themes resolves on its first effect.
if (window.matchMedia('(prefers-color-scheme: dark)').matches) {
  document.documentElement.classList.add('dark')
}

// Hosted as a browser-extension page (no native window chrome), so we never
// reserve space for macOS traffic lights — pin the platform to 'linux' to
// neutralize the `darwin:` Tailwind variant the desktop build relied on.
document.documentElement.dataset.platform = 'linux'

const root = document.getElementById('root')
if (!root) throw new Error('Root element not found')

createRoot(root).render(
  <StrictMode>
    <ThemeApplier>
      <QueryClientProvider client={queryClient}>
        <Router />
        <Toaster richColors closeButton position="bottom-right" />
      </QueryClientProvider>
    </ThemeApplier>
  </StrictMode>,
)
