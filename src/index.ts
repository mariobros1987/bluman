// Entry point — Collegato a Supabase PostgreSQL via PrismaApp.

import { PrismaClient } from '@prisma/client';
import { PrismaApp } from './adapters/prisma/prismaApp.js';
import { buildServer } from './server.js';
import dotenv from 'dotenv';

dotenv.config();

const TENANT_ID = '00000000-0000-0000-0000-000000000001';

const prisma = new PrismaClient();
const app = new PrismaApp(prisma, TENANT_ID);

const server = buildServer(app);
const porta = Number(process.env.PORT ?? 3000);

server.listen({ port: porta, host: '0.0.0.0' }, (err, address) => {
  if (err) {
    console.error(err);
    process.exit(1);
  }
  console.log(`🚀 BluMan API collegato a Supabase in ascolto su ${address}`);
});
