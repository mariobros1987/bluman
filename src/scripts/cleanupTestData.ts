/**
 * Rimozione degli artefatti lasciati nel database reale dalle run di vitest eseguite
 * prima che `vitest.setup.ts` isolasse la suite (la causa radice è chiusa lì: qui si
 * ripulisce solo lo sporco già prodotto).
 *
 *   npx tsx src/scripts/cleanupTestData.ts            → elenca soltanto (dry-run)
 *   npx tsx src/scripts/cleanupTestData.ts --conferma  → cancella davvero
 *
 * Criteri di sicurezza — un record viene cancellato solo se li soddisfa TUTTI:
 *   1. il nome è uno di quelli cablati in `src/server.test.ts`;
 *   2. l'id è un uuid generato dal database (gli id "parlanti" come `cli-02` vengono
 *      dal seed e restano);
 *   3. non ha progetti né preventivi collegati.
 */
import { prismaAmministrativo } from '../util/prismaClient.js';

// Manutenzione: connessione amministrativa, che scavalca le policy RLS (§14). Gli
// artefatti da rimuovere appartengono a tenant diversi e lo script gira fuori da
// qualunque richiesta.
const prisma = prismaAmministrativo();

/** Nomi usati come fixture in src/server.test.ts. */
const NOMI_DI_TEST = ['Solo nome', 'Cliente A', 'Cliente B', 'Marco Ricci', 'Test'];

const FORMATO_UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

async function main() {
  const conferma = process.argv.includes('--conferma');

  const candidati = await prisma.cliente.findMany({
    where: { nome: { in: NOMI_DI_TEST } },
    select: { id: true, nome: true, createdAt: true },
    orderBy: { createdAt: 'asc' },
  });

  const daCancellare: typeof candidati = [];
  const risparmiati: string[] = [];

  for (const c of candidati) {
    if (!FORMATO_UUID.test(c.id)) {
      risparmiati.push(`${c.nome} (${c.id}) — id non uuid: viene dal seed`);
      continue;
    }
    const [progetti, preventivi] = await Promise.all([
      prisma.progetto.count({ where: { clienteId: c.id } }),
      prisma.preventivo.count({ where: { clienteId: c.id } }),
    ]);
    if (progetti || preventivi) {
      risparmiati.push(`${c.nome} (${c.id}) — ha ${progetti} progetti e ${preventivi} preventivi collegati`);
      continue;
    }
    daCancellare.push(c);
  }

  console.log(`\nCandidati per nome: ${candidati.length}`);
  console.log(`Da cancellare:      ${daCancellare.length}`);
  console.log(`Risparmiati:        ${risparmiati.length}`);
  for (const r of risparmiati) console.log(`  ✋ ${r}`);

  if (!conferma) {
    console.log('\nDRY-RUN: nessun record toccato. Rilancia con --conferma per cancellare.');
    await prisma.$disconnect();
    return;
  }

  const esito = await prisma.cliente.deleteMany({ where: { id: { in: daCancellare.map((c) => c.id) } } });
  console.log(`\n✅ Cancellati ${esito.count} clienti di test.`);
  console.log(`   Clienti rimasti: ${await prisma.cliente.count()}`);

  await prisma.$disconnect();
}

main().catch(async (err) => {
  console.error(err);
  await prisma.$disconnect();
  process.exit(1);
});
