// Riparte da zero con i dati di prova: butta via il database usa-e-getta degli E2E e lo ricrea
// con `prepara.mjs` (migrazioni, seed, overlay). Serve quando, provando l'app a mano, i dati di
// prova si sono riempiti di progetti, fatture e incassi e si vuole tornare al punto di partenza.
//
// Tocca UN solo container, per nome esatto: `bluman-e2e-pg`. È il database di prova creato da
// `prepara.mjs` (nessun volume: i dati vivono nel container), e nessun altro progetto lo usa.
// Mailpit non si tocca: la sua coda la svuota già `prepara.mjs`.
//
// Uso:  npm run e2e:reset            → chiede conferma scrivendo «si»
//       npm run e2e:reset -- --si    → senza domanda (script, CI)
import { spawnSync } from 'node:child_process';
import { createInterface } from 'node:readline/promises';

const CONTAINER = 'bluman-e2e-pg';

function esiste(nome) {
  return spawnSync('docker', ['inspect', nome], { stdio: 'ignore' }).status === 0;
}

async function conferma() {
  if (process.argv.includes('--si')) return true;
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  const risposta = await rl.question(
    `Sto per cancellare il database di prova (container ${CONTAINER}) e ricrearlo da zero.\n` +
      'Progetti, fatture e incassi creati provando l\'app andranno persi. Scrivi «si» per continuare: ',
  );
  rl.close();
  return risposta.trim().toLowerCase() === 'si';
}

if (spawnSync('docker', ['info'], { stdio: 'ignore' }).status !== 0) {
  console.error('❌ Docker non è in esecuzione: avvia Docker Desktop e riprova.');
  process.exit(1);
}

if (!(await conferma())) {
  console.log('Annullato: non è stato toccato niente.');
  process.exit(0);
}

if (esiste(CONTAINER)) {
  console.log(`→ Rimuovo il container ${CONTAINER}`);
  const esito = spawnSync('docker', ['rm', '-f', CONTAINER], { stdio: 'inherit' });
  if (esito.status !== 0) {
    console.error(`❌ Non sono riuscito a rimuovere ${CONTAINER}.`);
    process.exit(esito.status ?? 1);
  }
} else {
  console.log(`✓ Il container ${CONTAINER} non esiste: lo crea la preparazione`);
}

console.log('→ Ricreo i dati di prova (npm run e2e:prepara)');
const prepara = spawnSync('node', ['scripts/e2e/prepara.mjs'], { stdio: 'inherit', env: process.env });
process.exit(prepara.status ?? 1);
