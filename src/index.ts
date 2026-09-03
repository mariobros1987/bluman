import { PrismaApp } from './adapters/prisma/prismaApp.js';
import { InMemoryApp } from './adapters/inMemoryApp.js';
import { buildServer } from './server.js';
// §14 — il client condiviso, non `new PrismaClient()`: si connette col ruolo applicativo
// soggetto alle policy RLS e impone a ogni query il tenant della richiesta in corso.
import { prisma } from './util/prismaClient.js';
import dotenv from 'dotenv';

dotenv.config();

const TENANT_ID = '00000000-0000-0000-0000-000000000001';

async function start() {
  console.log('🚀 Avvio del processo BluMan API...');
  let app: any;
  try {
    console.log('🔌 Connessione a PostgreSQL / Prisma in corso...');
    await prisma.$connect();
    console.log('✅ Connesso a PostgreSQL con successo.');
    app = new PrismaApp(prisma, TENANT_ID);
  } catch (e) {
    // §3.2 — fail-fast: in produzione, senza PostgreSQL, NON si deve servire traffico
    // col fallback InMemoryApp: l'API risponderebbe con dati vuoti (clienti, progetti,
    // fatture spariti) e le scritture andrebbero perse per sempre. Meglio un crash
    // visibile: Railway riavvia il processo finché il database non torna raggiungibile.
    if (process.env.NODE_ENV === 'production') {
      console.error('❌ Connessione a PostgreSQL fallita in produzione: arresto il processo invece di servire dati vuoti dal fallback InMemory.', e);
      process.exit(1);
    }
    console.warn('⚠️ Impossibile connettersi a PostgreSQL, uso InMemoryApp fallback (solo sviluppo/demo):', e);
    app = new InMemoryApp();
  }

  const server = buildServer(app);
  const porta = Number(process.env.PORT ?? 3000);

  server.listen({ port: porta, host: '0.0.0.0' }, (err, address) => {
    if (err) {
      console.error('❌ Errore critico avvio Fastify:', err);
      process.exit(1);
    }
    console.log(`🚀 BluMan API in ascolto su ${address} (porta ${porta})`);
  });
}

start();
