import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { registerSW } from 'virtual:pwa-register'
// Zuerst die Grundfarben, damit Komponenten-Styles sie überschreiben können.
import './index.css'
import App from './App.tsx'

// PWA: neue Builds sofort aktivieren und die Seite einmal neu laden,
// statt alte gecachte Bundles über mehrere Reloads auszuliefern.
registerSW({
  immediate: true,
  onRegisteredSW(_url, registration) {
    if (!registration) return
    // Während langer Sessions (Codesphere/Preview) regelmäßig nach Updates schauen.
    window.setInterval(() => {
      void registration.update()
    }, 60_000)
  },
})

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
