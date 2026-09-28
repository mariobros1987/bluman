/**
 * Diagnostica read-only: trova le micro-voci DUPLICATE dentro uno stesso modulo di progetto.
 *
 * «A doppio» = due (o più) righe `microvoce_progetto` con lo stesso `modulo_progetto_id` e lo
 * stesso `nome`. Riporta anche se condividono la stessa `riga_distinta_id` (duplicato della
 * stessa riga di origine → istanziazione ripetuta) o `riga_distinta_id` diverse (righe distinte
 * della distinta base con lo stesso nome → problema nel template/distinta, non nell'istanziazione).
 *
 * Non scrive nulla. Usa `prismaAmministrativo()` (§14) per vedere tutti i tenant.
 *
 *   npx tsx src/scripts/controllaMicrovociDoppie.ts
 */
import dotenv from 'dotenv';
import { prismaAmministrativo } from '../util/prismaClient.js';

dotenv.config();

async function main() {
  const db = prismaAmministrativo();

  const microvoci = await db.microvoceProgetto.findMany({
    select: {
      id: true,
      nome: true,
      moduloProgettoId: true,
      rigaDistintaId: true,
      articoloId: true,
      ordine: true,
      stato: true,
      moduloProgetto: {
        select: {
          nome: true,
          progetto: { select: { id: true, nome: true, cliente: { select: { nome: true } } } },
        },
      },
    },
    orderBy: [{ moduloProgettoId: 'asc' }, { nome: 'asc' }, { ordine: 'asc' }],
  });

  console.log(`\n=== CONTROLLO MICRO-VOCI DOPPIE — ${microvoci.length} micro-voci totali ===\n`);

  // Raggruppa per (moduloProgettoId + nome normalizzato).
  const gruppi = new Map<string, typeof microvoci>();
  for (const mv of microvoci) {
    const chiave = `${mv.moduloProgettoId}::${mv.nome.trim().toLowerCase()}`;
    const arr = gruppi.get(chiave) ?? [];
    arr.push(mv);
    gruppi.set(chiave, arr);
  }

  let gruppiDoppi = 0;
  let righeInEccesso = 0;
  const progettiColpiti = new Set<string>();

  for (const [, righe] of gruppi) {
    if (righe.length < 2) continue;
    const primo = righe[0];
    if (!primo) continue;
    gruppiDoppi++;
    righeInEccesso += righe.length - 1;
    const prog = primo.moduloProgetto?.progetto;
    progettiColpiti.add(prog?.id ?? '—');
    const stessaRiga = new Set(righe.map((r) => r.rigaDistintaId)).size === 1;
    const stessoArticolo = new Set(righe.map((r) => r.articoloId)).size === 1;
    console.log(
      `• ${righe.length}× "${primo.nome}"  —  modulo "${primo.moduloProgetto?.nome}"  ·  progetto "${prog?.nome}" (${prog?.cliente?.nome ?? 'n/d'})`,
    );
    console.log(
      `    rigaDistinta ${stessaRiga ? 'UGUALE (istanziazione ripetuta)' : 'DIVERSA (distinta base col nome ripetuto)'}` +
      ` · articolo ${stessoArticolo ? 'uguale' : 'diverso'}`,
    );
    for (const r of righe) {
      console.log(`      id=${r.id} ordine=${r.ordine} stato=${r.stato} riga=${r.rigaDistintaId} art=${r.articoloId}`);
    }
  }

  console.log(`\n--- RIEPILOGO ---`);
  console.log(`Gruppi duplicati (stesso modulo + stesso nome): ${gruppiDoppi}`);
  console.log(`Righe in eccesso (da rimuovere per de-duplicare): ${righeInEccesso}`);
  console.log(`Progetti coinvolti: ${progettiColpiti.size}`);
  if (gruppiDoppi === 0) {
    console.log(`\nNessun duplicato a database: se le vedi doppie in UI è un problema di RENDERING, non di dati.\n`);
  }
}

main()
  .catch((e) => {
    console.error('Errore:', e instanceof Error ? e.message : e);
    process.exit(1);
  })
  .finally(() => process.exit(0));
