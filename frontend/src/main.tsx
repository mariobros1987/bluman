import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import App from './App.tsx'
import { initSentry } from './utils/sentry.ts'

// Senza VITE_SENTRY_DSN è un no-op: non carica nulla, non tocca la rete.
void initSentry()

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
