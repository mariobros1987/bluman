/**
 * Diagnostica read-only dello stato RLS sul database reale (§14).
 * Risponde a tre domande: RLS è attivo? con che ruolo si connette Prisma? quel ruolo
 * è soggetto alle policy o le scavalca?
 *
 * Volutamente `new PrismaClient()` e non i client di `util/prismaClient.ts`: serve la
 * connessione grezza su DATABASE_URL, cioè esattamente quella che userebbe il runtime,
 * senza l'estensione che imposta il contesto — altrimenti la prova pratica qui sotto
 * misurerebbe l'estensione invece delle policy.
 */
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
  const identita = await prisma.$queryRawUnsafe<any[]>(
    `SELECT current_user, session_user, current_setting('is_superuser') AS superuser,
            (SELECT rolbypassrls FROM pg_roles WHERE rolname = current_user) AS bypassa_rls`,
  );
  console.log('\n=== IDENTITÀ DELLA CONNESSIONE PRISMA ===');
  console.log(identita[0]);

  const tabelle = await prisma.$queryRawUnsafe<any[]>(
    `SELECT c.relname AS tabella, c.relrowsecurity AS rls_attivo, c.relforcerowsecurity AS rls_forzato,
            (SELECT count(*) FROM pg_policies p WHERE p.tablename = c.relname) AS policy
       FROM pg_class c
       JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE n.nspname = 'public' AND c.relkind = 'r'
      ORDER BY c.relname`,
  );
  console.log('\n=== RLS PER TABELLA ===');
  const attive = tabelle.filter((t) => t.rls_attivo);
  const spente = tabelle.filter((t) => !t.rls_attivo);
  for (const t of attive) {
    console.log(`  ✔ ${t.tabella.padEnd(26)} forzato=${t.rls_forzato}  policy=${t.policy}`);
  }
  console.log(`\n  RLS attivo su ${attive.length} tabelle, spento su ${spente.length}:`);
  console.log('   ', spente.map((t) => t.tabella).join(', ') || '—');

  // Prova pratica: se il ruolo scavalca RLS, la stessa query restituisce tutto anche
  // impostando un tenant inesistente.
  await prisma.$executeRawUnsafe(`SELECT set_config('app.current_tenant_id', '00000000-0000-0000-0000-0000000000ff', false)`);
  const conTenantFinto = await prisma.$queryRawUnsafe<any[]>(`SELECT count(*)::int AS n FROM "cliente"`);
  console.log(`\n=== PROVA PRATICA ===`);
  console.log(`  Clienti visibili con app.current_tenant_id = ...00ff (tenant inesistente): ${conTenantFinto[0].n}`);
  console.log('  Se è > 0, le policy non filtrano nulla per questo ruolo.');

  await prisma.$disconnect();
}

main().catch(async (err) => {
  console.error(err);
  await prisma.$disconnect();
  process.exit(1);
});
