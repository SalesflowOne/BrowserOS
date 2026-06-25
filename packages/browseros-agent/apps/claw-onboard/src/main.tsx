import '@fontsource-variable/schibsted-grotesk'
import '@fontsource/newsreader/400-italic.css'
import '@fontsource/newsreader/500-italic.css'
import '@fontsource-variable/jetbrains-mono'

import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { BrowserRouter } from 'react-router'
import { App } from './App'
import './styles.css'

const root = document.getElementById('root')
if (!root) throw new Error('Root element not found')

createRoot(root).render(
  <StrictMode>
    <BrowserRouter>
      <App />
    </BrowserRouter>
  </StrictMode>,
)
