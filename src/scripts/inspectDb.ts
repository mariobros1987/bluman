import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
  const users = await prisma.user.findMany();
  console.log('--- USERS IN DATABASE ---');
  for (const u of users) {
    console.log(`ID: ${u.id} | Email: ${u.email} | Nome: ${u.nome} | Ruolo: ${u.ruolo} | TenantId: ${u.tenantId}`);
  }

  const clients = await prisma.cliente.findMany();
  console.log('\n--- CLIENTS IN DATABASE ---');
  for (const c of clients) {
    console.log(`ID: ${c.id} | Nome: ${c.nome} | PIVA: ${c.piva} | TenantId: ${c.tenantId}`);
  }

  const projs = await prisma.progetto.findMany();
  console.log('\n--- PROJECTS IN DATABASE ---');
  for (const pr of projs) {
    console.log(`ID: ${pr.id} | Nome: ${pr.nome} | TenantId: ${pr.tenantId}`);
  }
}

main().catch(console.error).finally(() => prisma.$disconnect());
