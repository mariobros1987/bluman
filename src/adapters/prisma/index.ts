// Entry point con database reale — Postgres o Supabase, basta DATABASE_URL in .env.
// Supabase non richiede nulla di specifico: è Postgres gestito, la connection string
// dalla sua dashboard (Project Settings → Database → Connection string) va bene così.
//
// ⚠️ Non eseguibile in questo ambiente di sviluppo (rete bloccata verso i binari Prisma).
// Verificalo sulla tua macchina — vedi ISTRUZIONI_INSTALLAZIONE.md, Percorso B.
//
//   npm run start:db

import 'dotenv/config';
import { PrismaApp } from './prismaApp.js';
import { buildServer } from '../../server.js';
// §14 — client con contesto tenant: il ruolo applicativo è soggetto alle policy RLS.
import { prisma } from '../../util/prismaClient.js';

if (!process.env.DATABASE_URL) {
  console.error('DATABASE_URL non impostata. Copia .env.example in .env e inserisci la connection string (locale o Supabase).');
  process.exit(1);
}

const TENANT_ID_DEMO = '00000000-0000-0000-0000-000000000001'; // stesso id usato da seed.ts

const app = new PrismaApp(prisma, TENANT_ID_DEMO);
const server = buildServer(app);
const porta = Number(process.env.PORT ?? 3000);

server.listen({ port: porta, host: '0.0.0.0' }, (err, address) => {
  if (err) {
    console.error(err);
    process.exit(1);
  }
  console.log(`BluMan API (Postgres reale) in ascolto su ${address}`);
  console.log(`Prova: curl ${address}/moduli`);
});

process.on('SIGTERM', () => prisma.$disconnect());
process.on('SIGINT', () => prisma.$disconnect());
