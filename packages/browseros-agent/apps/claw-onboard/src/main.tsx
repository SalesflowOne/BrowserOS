import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { BrowserRouter } from 'react-router'
import { App } from './App'
import './styles.css'

// Resolve the initial color theme from the OS preference as early as the single
// inlined bundle allows — before React mounts, so app content never renders on
// the wrong theme. The bundle is deferred, so dark-mode users may still see a
// brief first-paint flash of the light body gradient; a blocking inline <script>
// would avoid it but is disallowed by the strict WebUI/extension CSP (the same
// reason claw-app extracts its theme script to a module chunk, which this app's
// single-bundle chromium contract also rules out). Onboarding is a first-run flow
// with no theme toggle and the host bridge carries no theme signal, so
// `prefers-color-scheme` is the source of truth. Adding `.dark` on <html> flips
// the palette variables and activates the shadcn `dark:` variants.
if (
  typeof document !== 'undefined' &&
  typeof window !== 'undefined' &&
  typeof window.matchMedia === 'function' &&
  window.matchMedia('(prefers-color-scheme: dark)').matches
) {
  document.documentElement.classList.add('dark')
}

const root = document.getElementById('root')
if (!root) throw new Error('Root element not found')

createRoot(root).render(
  <StrictMode>
    <BrowserRouter>
      <App />
    </BrowserRouter>
  </StrictMode>,
)
