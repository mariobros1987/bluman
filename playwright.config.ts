// Configurazione Playwright per i quattro flussi critici di BluMan (e2e/README.md).
//
// I due webServer partono in questo ordine e Playwright attende che rispondano
// prima di eseguire i test:
//   1. backend Fastify su :3000, collegato al database usa-e-getta del
//      container bluman-e2e-pg (localhost:5433) — vedi scripts/e2e/avvia-backend.mjs;
//   2. frontend Vite dev su :5173.
//
// reuseExistingServer è volutamente TRUE solo per il frontend (riavviarlo è
// lento e non c'è rischio). Per il backend è FALSE: se sulla porta 3000 girasse
// già un processo avviato a mano — magari con il .env di produzione puntato a
// Supabase — i test finirebbero per scrivere sul database reale. Con false
// Playwright si rifiuta di partire, e questo è il comportamento giusto.
//
// Un solo worker, niente parallelismo: i tre flussi condividono lo stesso
// database usa-e-getta e il flusso del portale consuma magic link e OTP le cui
// regole anti-abuso (reinvii, sessioni aperte) renderebbero le corse
// parallele inaffidabili.
import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: './e2e',
  fullyParallel: false,
  workers: 1,
  retries: 0,
  timeout: 120_000,
  expect: { timeout: 15_000 },
  reporter: [['list']],
  use: {
    baseURL: 'http://localhost:5173',
    locale: 'it-IT',
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
  webServer: [
    {
      command: 'node scripts/e2e/avvia-backend.mjs',
      url: 'http://localhost:3000/health',
      reuseExistingServer: false,
      timeout: 180_000,
    },
    {
      command: 'npm run dev',
      cwd: './frontend',
      url: 'http://localhost:5173',
      reuseExistingServer: true,
      timeout: 180_000,
    },
  ],
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
});
