// Preparazione dell'ambiente E2E — vedi e2e/README.md.
//
// Porta in vita i due container usa-e-getta (Postgres 16 su localhost:5433 e
// Mailpit su 1025/8025), applica le migrazioni, esegue il seed master solo se
// il database è vuoto e poi l'overlay E2E (src/scripts/seedE2E.ts).
//
// Il seed master viene eseguito solo a database vuoto per non rigenerare le
// password a ogni corsa: l'overlay è invece idempotente e ridefinisce sempre
// utenti, SMTP del tenant e progetto di test ai valori noti.
//
// Nessuna credenziale di produzione passa da qui: l'URL cablato punta a
// localhost e seedE2E.ts si rifiuta di girare su qualcos'altro.
import { spawnSync } from 'node:child_process';

const URL_DB_E2E = 'postgresql://bluman:bluman_dev_password@localhost:5433/bluman_e2e?schema=public';
const PASSWORD_E2E = process.env.E2E_PASSWORD || 'E2e-BluMan-2026';

const AMBIENTE_DB = {
  DATABASE_URL: URL_DB_E2E,
  DIRECT_URL: URL_DB_E2E,
  ADMIN_DATABASE_URL: URL_DB_E2E,
};

const dormi = (ms) => new Promise((risolvi) => setTimeout(risolvi, ms));

/**
 * Svuota la coda di Mailpit. I container sopravvivono tra le corse, quindi senza
 * questo flush le email di una corsa precedente restano lì e gli helper E2E
 * potrebbero leggere un OTP stantio. Il best-effort basta: se Mailpit non
 * risponde ancora, la coda sarà vuota comunque (appena partito non ha posta).
 */
async function svuotaMailpit() {
  for (let tentativo = 0; tentativo < 10; tentativo++) {
    try {
      const res = await fetch('http://localhost:8025/api/v1/messages', { method: 'DELETE' });
      if (res.ok) {
        console.log('✓ Coda Mailpit svuotata');
        return;
      }
    } catch {
      // Mailpit non è ancora in ascolto: riprova tra un secondo.
    }
    await dormi(1000);
  }
  console.warn('⚠ Mailpit non raggiungibile: coda non svuotata (verrà svuotata dagli helper al primo OTP letto)');
}

function esegui(comando, argomenti, envExtra = {}, opzioni = {}) {
  const esito = spawnSync(comando, argomenti, {
    stdio: 'inherit',
    env: { ...process.env, ...envExtra },
    ...opzioni,
  });
  if (esito.status !== 0) {
    console.error(`❌ Comando fallito: ${comando} ${argomenti.join(' ')}`);
    process.exit(esito.status ?? 1);
  }
  return esito;
}

function containerEsiste(nome) {
  return spawnSync('docker', ['inspect', nome]).status === 0;
}

function containerInEsecuzione(nome) {
  const esito = spawnSync('docker', ['inspect', '-f', '{{.State.Running}}', nome], { encoding: 'utf8' });
  return esito.status === 0 && esito.stdout.trim() === 'true';
}

function assicuraContainer(nome, argomentiCreazione) {
  if (!containerEsiste(nome)) {
    console.log(`→ Creo il container ${nome} (usa-e-getta, cancellabile con: docker rm -f ${nome})`);
    esegui('docker', ['run', '-d', '--name', nome, ...argomentiCreazione]);
  } else if (!containerInEsecuzione(nome)) {
    console.log(`→ Riavvio il container ${nome}`);
    esegui('docker', ['start', nome]);
  } else {
    console.log(`✓ Container ${nome} già in esecuzione`);
  }
}

async function attendiPostgres() {
  for (let tentativo = 0; tentativo < 30; tentativo++) {
    const esito = spawnSync('docker', ['exec', 'bluman-e2e-pg', 'pg_isready', '-U', 'bluman'], { stdio: 'ignore' });
    if (esito.status === 0) return;
    await dormi(1000);
  }
  console.error('❌ Postgres E2E non pronto dopo 30 secondi. Guarda i log: docker logs bluman-e2e-pg');
  process.exit(1);
}

async function main() {
  console.log('── Preparazione ambiente E2E ──────────────────────────────');

  if (spawnSync('docker', ['info'], { stdio: 'ignore' }).status !== 0) {
    console.error('❌ Docker non è in esecuzione: avvia Docker Desktop e riprova.');
    process.exit(1);
  }

  assicuraContainer('bluman-e2e-pg', [
    '-e', 'POSTGRES_USER=bluman',
    '-e', 'POSTGRES_PASSWORD=bluman_dev_password',
    '-e', 'POSTGRES_DB=bluman_e2e',
    '-p', '5433:5432',
    'postgres:16-alpine',
  ]);
  assicuraContainer('bluman-e2e-mailpit', ['-p', '1025:1025', '-p', '8025:8025', 'axllent/mailpit']);
  await attendiPostgres();
  await svuotaMailpit();

  console.log('→ Migrazioni Prisma (migrate deploy, mai db push)');
  esegui('npx', ['prisma', 'migrate', 'deploy'], AMBIENTE_DB, { shell: true });

  const conteggioUtenti = spawnSync(
    'docker',
    ['exec', 'bluman-e2e-pg', 'psql', '-U', 'bluman', '-d', 'bluman_e2e', '-tAc', 'select count(*) from "user"'],
    { encoding: 'utf8' },
  );
  if (conteggioUtenti.status !== 0) {
    console.error('❌ Impossibile contare gli utenti sul database E2E.');
    process.exit(1);
  }
  if (Number(conteggioUtenti.stdout.trim()) === 0) {
    console.log('→ Database vuoto: seed master (con password E2E note)');
    esegui('npx', ['tsx', 'prisma/seed.ts'], {
      ...AMBIENTE_DB,
      SEED_ADMIN_PASSWORD: PASSWORD_E2E,
      SEED_USER_PASSWORD: PASSWORD_E2E,
    }, { shell: true });
  } else {
    console.log('✓ Seed master già presente: salto (l\'overlay ridefinisce le password)');
  }

  console.log('→ Overlay E2E (utenti, SMTP Mailpit, progetto Belfort)');
  esegui('npx', ['tsx', 'src/scripts/seedE2E.ts'], {
    E2E_DATABASE_URL: URL_DB_E2E,
    E2E_PASSWORD: PASSWORD_E2E,
  }, { shell: true });

  console.log('\n🎉 Ambiente E2E pronto. Partenza con: npm run test:e2e');
}

main();
