import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
// Zuerst die Grundfarben, damit Komponenten-Styles sie überschreiben können.
import './index.css'
import App from './App.tsx'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
