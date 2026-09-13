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
  },
})
