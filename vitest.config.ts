import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    // `setupFiles` gira prima dell'import dei moduli applicativi: è l'unico punto in cui
    // si può neutralizzare il DATABASE_URL di `.env` prima che `new PrismaClient()` lo
    // legga (vedi vitest.setup.ts).
    setupFiles: ['./vitest.setup.ts'],
    include: ['src/**/*.test.ts'],
    // Ogni query verso il DATABASE_URL irraggiungibile costa ~2s di tentativo di
    // connessione prima di cadere sul fallback in-memory: i 5s di default non bastano
    // per i test che percorrono più rotte di fila.
    testTimeout: 30_000,
    // Il frontend ha la sua toolchain Vite: qui si testa solo il backend.
    exclude: ['node_modules/**', 'dist/**', 'frontend/**'],
  },
});
