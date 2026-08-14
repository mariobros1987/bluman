import { PrismaClient } from '@prisma/client';
import { PrismaApp } from './adapters/prisma/prismaApp.js';
import { InMemoryApp } from './adapters/inMemoryApp.js';
import { buildServer } from './server.js';
import dotenv from 'dotenv';

dotenv.config();

const TENANT_ID = '00000000-0000-0000-0000-000000000001';

async function start() {
  let app: any;
  try {
    const prisma = new PrismaClient();
    app = new PrismaApp(prisma, TENANT_ID);
  } catch (e) {
    console.warn('⚠️ Supabase Prisma offline, uso InMemoryApp fallback per sviluppo locale.');
    app = new InMemoryApp();
  }

  const server = buildServer(app);
  const porta = Number(process.env.PORT ?? 3000);

  server.listen({ port: porta, host: '0.0.0.0' }, (err, address) => {
    if (err) {
      console.error('Errore avvio Fastify:', err);
      process.exit(1);
    }
    console.log(`🚀 BluMan API in ascolto su ${address}`);
  });
}

start();
