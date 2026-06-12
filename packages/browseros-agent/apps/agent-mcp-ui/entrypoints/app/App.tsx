import { HashRouter, Route, Routes } from 'react-router'
import { Cockpit } from '@/screens/cockpit/Cockpit'

// HashRouter so the extension behaves identically under
// `chrome-extension://...#/<route>` regardless of how it was
// loaded — matches the existing agent extension's routing posture.
export function App() {
  return (
    <HashRouter>
      <Routes>
        <Route path="/" element={<Cockpit />} />
      </Routes>
    </HashRouter>
  )
}
