/**
 * Sonda di SOLA LETTURA: quanti moduli e micro-voci ha davvero ogni progetto, cliente per
 * cliente. Serve a stabilire se il Portale Cliente mostra i moduli del progetto scelto o la
 * lista di ripiego cablata in `mapProjectToPortalModules` (ClientPortal.tsx, rami 2 e 3).
 *
 * Non scrive niente. Usa `prismaAmministrativo()` perché è uno script di manutenzione fuori
 * dal percorso HTTP e deve vedere tutti i tenant (§14).
 */
import { prismaAmministrativo } from '../util/prismaClient.js';

const db = prismaAmministrativo();

async function main() {
  const clienti = await db.cliente.findMany({
    select: {
      id: true,
      nome: true,
      tipo: true,
      giurisdizione: true,
      tenantId: true,
      progetti: {
        select: {
          id: true,
          nome: true,
          stato: true,
          moduli: {
            select: { id: true, nome: true, stato: true, _count: { select: { microvoci: true } } },
          },
        },
      },
    },
    orderBy: { nome: 'asc' },
  });

  let clientiMultiProgetto = 0;
  let progettiSenzaModuli = 0;
  let progettiTotali = 0;

  for (const c of clienti) {
    if (c.progetti.length === 0) continue;
    progettiTotali += c.progetti.length;
    if (c.progetti.length > 1) clientiMultiProgetto++;

    console.log(`\n=== CLIENTE: ${c.nome} (${c.progetti.length} progetti) — ${c.tipo ?? 'senza tipo'} / ${c.giurisdizione ?? 'senza giurisdizione'}`);
    for (const p of c.progetti) {
      const nModuli = p.moduli.length;
      if (nModuli === 0) progettiSenzaModuli++;
      const marchio = nModuli === 0 ? '  <-- RIPIEGO CABLATO NEL PORTALE' : '';
      console.log(`  · [${p.stato}] ${p.nome} — ${nModuli} moduli${marchio}`);
      for (const m of p.moduli) {
        console.log(`      - [${m.stato}] ${m.nome} (${m._count.microvoci} micro-voci)`);
      }
    }
  }

  console.log('\n----------------------------------------------------------');
  console.log(`Clienti con progetti:        ${clienti.filter(c => c.progetti.length > 0).length}`);
  console.log(`Clienti con >1 progetto:     ${clientiMultiProgetto}  <-- questi usano il selettore`);
  console.log(`Progetti totali:             ${progettiTotali}`);
  console.log(`Progetti con ZERO moduli:    ${progettiSenzaModuli}  <-- il portale ne inventa i moduli`);
  console.log('----------------------------------------------------------');
}

main()
  .catch(err => {
    console.error('Sonda fallita:', err.message);
    process.exit(1);
  })
  .finally(() => db.$disconnect());
