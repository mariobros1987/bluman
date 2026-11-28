// `defineConfig` di vitest (non di vite): porta anche la proprietà `test`.
// https://vitest.dev/config/
import { defineConfig } from 'vitest/config'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  // Test del frontend (Vitest + Testing Library, ambiente DOM). Runner SEPARATO da
  // quello della root, che testa solo il backend: la root esplicitamente esclude
  // `frontend/**` dal suo vitest.config.ts — due toolchain, due configurazioni.
  test: {
    environment: 'jsdom',
    globals: true,
    setupFiles: ['./src/test/setup.ts'],
    include: ['src/**/*.test.{ts,tsx}'],
    // jsdom non ha fetch nativa affidabile nelle versioni vecchie di Node su Windows:
    // i test che toccano la rete la mockano sempre, qui si evita solo il warning.
    css: false,
    // Come il backend (`vitest.config.ts`): i 5 s di default non bastano quando le tre parti delle
    // prove, la build e il revisore girano insieme sullo stesso PC. Il 28/11 due test da 180-230 ms
    // sono scaduti a 5 s in due giri di fila (run 46151502939 e 46152024074), ogni volta uno
    // diverso: non era un test lento, era il tetto troppo vicino. Un test che si blocca davvero
    // fallisce comunque, a 30 s.
    testTimeout: 30_000,
  },
})
