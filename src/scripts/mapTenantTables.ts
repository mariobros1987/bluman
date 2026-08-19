/**
 * Diagnostica read-only: classifica le tabelle di `public` in base a come si legano al
 * tenant. Serve a scrivere le policy RLS giuste (§14): una tabella con `tenant_id`
 * filtra direttamente, una tabella figlia deve risalire al padre.
 */
import { prismaAmministrativo } from '../util/prismaClient.js';

// Diagnostica sullo schema: serve la connessione amministrativa, altrimenti
// information_schema mostra solo ciò su cui il ruolo applicativo ha privilegi (§14).
const prisma = prismaAmministrativo();

async function main() {
  const conTenant = await prisma.$queryRawUnsafe<any[]>(
    `SELECT c.relname AS tabella,
            EXISTS (SELECT 1 FROM information_schema.columns col
                     WHERE col.table_schema = 'public' AND col.table_name = c.relname
                       AND col.column_name = 'tenant_id') AS ha_tenant_id,
            (SELECT col.is_nullable FROM information_schema.columns col
              WHERE col.table_schema = 'public' AND col.table_name = c.relname
                AND col.column_name = 'tenant_id') AS tenant_nullable
       FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE n.nspname = 'public' AND c.relkind = 'r'
      ORDER BY 2 DESC, 1`,
  );

  console.log('\n=== CON tenant_id (policy diretta) ===');
  for (const t of conTenant.filter((t) => t.ha_tenant_id)) {
    console.log(`  ${t.tabella.padEnd(30)} nullable=${t.tenant_nullable}`);
  }

  const senza = conTenant.filter((t) => !t.ha_tenant_id).map((t) => t.tabella);
  console.log('\n=== SENZA tenant_id (serve risalire al padre) ===');

  // Per ognuna, elenca le FK: identificano il padre da cui derivare il tenant.
  for (const tabella of senza) {
    const fk = await prisma.$queryRawUnsafe<any[]>(
      `SELECT kcu.column_name AS colonna, ccu.table_name AS padre, ccu.column_name AS col_padre
         FROM information_schema.table_constraints tc
         JOIN information_schema.key_column_usage kcu
           ON tc.constraint_name = kcu.constraint_name AND tc.table_schema = kcu.table_schema
         JOIN information_schema.constraint_column_usage ccu
           ON ccu.constraint_name = tc.constraint_name AND ccu.table_schema = tc.table_schema
        WHERE tc.constraint_type = 'FOREIGN KEY' AND tc.table_schema = 'public'
          AND tc.table_name = $1`,
      tabella,
    );
    const desc = fk.length ? fk.map((f) => `${f.colonna}→${f.padre}`).join(', ') : 'NESSUNA FK';
    console.log(`  ${tabella.padEnd(30)} ${desc}`);
  }

  await prisma.$disconnect();
}

main().catch(async (err) => {
  console.error(err);
  await prisma.$disconnect();
  process.exit(1);
});
