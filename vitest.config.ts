import { defineConfig } from 'vitest/config';

export default defineConfig({
  css: {
    postcss: {
      plugins: [],
    },
  },
  test: {
    // `setupFiles` gira prima dell'import dei moduli applicativi: è l'unico punto in cui
    // si può neutralizzare il DATABASE_URL di `.env` prima che `new PrismaClient()` lo
    // legga (vedi vitest.setup.ts).
    setupFiles: ['./vitest.setup.ts'],
    // `api/` è la funzione serverless di relay su Vercel: sta fuori da `src` perché
    // `tsconfig.json` ha `rootDir: src`, ma è codice che spedisce email a nome dello studio
    // e i suoi controlli di autorizzazione vanno presidiati come gli altri (§35).
    include: ['src/**/*.test.ts', 'api/**/*.test.ts'],
    // Ogni query verso il DATABASE_URL irraggiungibile costa ~2s di tentativo di
    // connessione prima di cadere sul fallback in-memory: i 5s di default non bastano
    // per i test che percorrono più rotte di fila.
    testTimeout: 30_000,
    // Il frontend ha la sua toolchain Vite: qui si testa solo il backend.
    exclude: ['node_modules/**', 'dist/**', 'frontend/**'],
    // La suite ha 129 file e i worker di default sono `availableParallelism()` (8 su questa
    // macchina): sono otto thread, nello stesso processo (il pool di default è `threads`), che
    // rileggono **gli stessi** moduli nello stesso momento — `collect` da solo costa più di 200s
    // di parete. Il 10/10/2026 quella concorrenza ha prodotto `UNKNOWN: unknown error, read`
    // (codice di libuv che su Windows significa «un `fs.read` è fallito e non so perché»),
    // attribuito a `src/calendario.test.ts`, che **non tocca il disco**. Ed essendo il passo 1 di
    // `distribuisci.sh` bloccante, quel flake ha **abortito un deploy prima del push**.
    //
    // ⚠️ Il 10/10/2026 il guasto **non è stato riprodotto a comando** nemmeno a 16 worker (due
    // giri, 129/129 verdi): il meccanismo qui sopra è il più probabile, non una causa dimostrata.
    // Quindi le due righe sotto vanno lette per quello che sono, e non come una cura provata:
    //   - `retry` è **assicurazione**, non riparazione. Un test davvero rotto fallisce anche al
    //     secondo e al terzo giro, quindi non nasconde una regressione; copre il guasto
    //     transitorio. È l'unica delle due che non ha bisogno di una causa dimostrata.
    //   - il tetto ai worker toglie la *condizione* in cui la corsa nascerebbe. **Misurato il
    //     10/10/2026: non costa tempo.** 337,6s con gli 8 worker di default, 334,4/335,8s con 4 —
    //     cioè sotto il rumore fra due giri con la stessa configurazione. La lettura dei moduli
    //     (`collect`) invece scende: 127s a 8 worker, 86/95s a 4, 212-371s a 16. Il lavoro di
    //     lettura duplicato cresce coi worker, ma non era sul percorso critico. Se un giorno il
    //     passo 1 si allungasse troppo, **si alza il tetto**, non si toglie il `retry`.
    // Se un giorno il flake uscisse di nuovo: `git log origin/main -1` dice se il push è partito
    // (non parte: lo script esce prima), e la mossa è **rilanciare prima di indagare**.
    maxWorkers: 4,
    minWorkers: 1,
    retry: 2,
  },
});
