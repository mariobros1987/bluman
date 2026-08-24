/**
 * §Blocco 7 — ispezione read-only prima della pulizia.
 *
 * Stampa quello che serve per decidere cosa rinominare/eliminare:
 *   7.1 utenti (per trovare i doppioni francesca@ / lorenzo@),
 *   7.2 clienti di esempio (Famiglia Ricci & simili),
 *   7.4 tenant (per la rinomina anti-confusione).
 * Nessuna credenziale in output: solo id, nomi, email, conteggi.
 *
 *   node scripts/ispezione-blocco7.mjs
 */
import dotenv from 'dotenv';
dotenv.config();

const { PrismaClient } = await import('@prisma/client');
const prisma = new PrismaClient();

try {
  console.log('\n── 7.1 Utenti (per tenant) ────────────────────────────────');
  const utenti = await prisma.user.findMany({
    select: { id: true, email: true, nome: true, ruolo: true, tenantId: true, createdAt: true },
    orderBy: [{ email: 'asc' }],
  });
  for (const u of utenti) {
    console.log(`${(u.email || '—').padEnd(38)} ${(u.nome || '—').padEnd(22)} ${(u.ruolo || '—').padEnd(20)} tenant=${u.tenantId || '—'}  creato=${u.createdAt.toISOString().slice(0, 10)}  id=${u.id}`);
  }
  const perEmail = new Map();
  for (const u of utenti) {
    const k = (u.email || '').toLowerCase();
    if (!k) continue;
    perEmail.set(k, (perEmail.get(k) || 0) + 1);
  }
  const doppioni = [...perEmail.entries()].filter(([, n]) => n > 1);
  console.log(doppioni.length ? `\nDoppioni per email: ${doppioni.map(([e, n]) => `${e} x${n}`).join(', ')}` : '\nNessun doppione esatto per email.');

  console.log('\n── 7.2 Clienti (per tenant) ───────────────────────────────');
  const clienti = await prisma.cliente.findMany({
    select: { id: true, nome: true, email: true, tenantId: true, _count: { select: { progetti: true } } },
    orderBy: [{ nome: 'asc' }],
  });
  for (const c of clienti) {
    console.log(`${(c.nome || '—').padEnd(34)} ${(c.email || '—').padEnd(36)} progetti=${c._count.progetti}  tenant=${c.tenantId || '—'}  id=${c.id}`);
  }

  console.log('\n── 7.4 Tenant ─────────────────────────────────────────────');
  const tenant = await prisma.tenant.findMany({
    select: { id: true, ragioneSociale: true, email: true, createdAt: true, _count: { select: { users: true, clienti: true } } },
    orderBy: [{ createdAt: 'asc' }],
  });
  for (const t of tenant) {
    console.log(`${(t.ragioneSociale || '—').padEnd(32)} ${(t.email || '—').padEnd(30)} utenti=${t._count.users} clienti=${t._count.clienti}  creato=${t.createdAt.toISOString().slice(0, 10)}  id=${t.id}`);
  }
} finally {
  await prisma.$disconnect();
}
