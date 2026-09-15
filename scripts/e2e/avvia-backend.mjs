// Avvio del backend per gli E2E Playwright — vedi e2e/README.md.
//
// Playwright lancia questo script come webServer: imposta l'ambiente del
// database usa-e-getta (container Postgres su localhost:5433) e poi esegue
// `npx tsx src/index.ts`. L'URL è cablato qui e punta solo a localhost: così
// non c'è variabile da dimenticare e nessuna possibilità di puntare al
// database di produzione su Supabase.
//
// Nota su dotenv: src/index.ts carica il .env della root, ma dotenv NON
// sovrascrive le variabili già presenti nell'ambiente: le tre URL impostate
// qui sotto vincono su qualunque valore di produzione sia nel file.
import { spawn } from 'node:child_process';

const URL_DB_E2E = 'postgresql://bluman:bluman_dev_password@localhost:5433/bluman_e2e?schema=public';

// Segreto di test: serve solo che sia stabile (≥32 caratteri) perché i token
// sopravvivano ai riavvii del server durante una sessione di test.
const JWT_SECRET_E2E = 'e2e-jwt-secret-di-test-che-non-deve-mai-uscire-da-localhost';

const env = {
  ...process.env,
  DATABASE_URL: URL_DB_E2E,
  DIRECT_URL: URL_DB_E2E,
  ADMIN_DATABASE_URL: URL_DB_E2E,
  JWT_SECRET: JWT_SECRET_E2E,
  NODE_ENV: 'development',
  // Consenso esplicito agli endpoint locali (loopback incluso): è quello che
  // permette l'SMTP di test verso Mailpit in container. Valido solo perché
  // NODE_ENV è development — vedi src/util/networkPolicy.ts.
  PERMETTI_ENDPOINT_LOCALI: '1',
  APP_BASE_URL: 'http://localhost:5173',
  PORT: '3000',
};

const figlio = spawn('npx', ['tsx', 'src/index.ts'], { stdio: 'inherit', env, shell: true });

figlio.on('exit', (code) => process.exit(code ?? 1));
process.on('SIGINT', () => figlio.kill('SIGINT'));
process.on('SIGTERM', () => figlio.kill('SIGTERM'));
