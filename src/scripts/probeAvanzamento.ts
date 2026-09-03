/**
 * Diagnostica read-only del motore di stato sui dati reali (§16).
 *
 * Risponde a una domanda sola: se lanciassi `POST /progetti/:id/ricalcola` su questi
 * progetti, quali righe cambierebbero? Utile dopo un'importazione, dopo una correzione fatta
 * a mano a database, o dopo una modifica alle regole del motore — guardare prima di scrivere.
 *
 * Non scrive nulla. Usa `prismaAmministrativo()` (§14) perché deve vedere tutti i tenant:
 * è uno script di manutenzione lanciato a mano, non codice che serve richieste HTTP.
 *
 *   npx tsx src/scripts/probeAvanzamento.ts
 *
 * Nota su come leggere l'esito: un modulo senza micro-voci a database non è ricalcolabile —
 * non c'è nulla da aggregare verso l'alto — e il service preserva quel che dice la riga. Sono
 * segnalati a parte proprio perché il loro stato non ha alcuna copertura di controllo.
 */
import dotenv from 'dotenv';
import { prismaAmministrativo } from '../util/prismaClient.js';
import { calcolaAvanzamento } from '../services/calcoloService.js';
import { calcolaStatoModulo, valutaSegnaleRischio } from '../domain/stateEngine.js';

// `tsx` non legge `.env` da sé (stessa ragione di checkRls.ts).
dotenv.config();

async function main() {
  const db = prismaAmministrativo();

  const progetti = await db.progetto.findMany({
    include: { cliente: true, moduli: { include: { microvoci: true } } },
    orderBy: { createdAt: 'desc' },
  });

  console.log(`\n=== AVANZAMENTO CALCOLATO — ${progetti.length} progetti ===\n`);

  let divergenze = 0;
  let moduliSenzaMicrovoci = 0;

  for (const p of progetti) {
    const av = calcolaAvanzamento(p as any);
    const cambiaStato = p.stato !== 'pre_project' && p.stato !== av.stato;
    if (cambiaStato) divergenze++;

    console.log(`── ${p.nome}  [${p.cliente?.nome ?? 'senza cliente'}]`);
    console.log(
      `   stato in riga: ${p.stato}   calcolato: ${av.stato}${cambiaStato ? '   <-- CAMBIA' : ''}`,
    );
    console.log(
      `   avanzamento: ${av.percentuale}%   moduli: ${p.moduli.length}` +
        `   segnaleRischio: ${av.segnaleRischio}   oreExtra: ${av.oreExtra}`,
    );

    for (const m of p.moduli) {
      const avM = av.moduli.find((x) => x.id === m.id)!;

      if (m.microvoci.length === 0) {
        moduliSenzaMicrovoci++;
        console.log(
          `     · ${m.nome}: riga=${m.stato} ${avM.percentuale}%` +
            `   (0 micro-voci: non ricalcolabile, riga preservata)`,
        );
        continue;
      }

      const statoCalcolato = calcolaStatoModulo(m.microvoci as any);
      const cambia = m.stato !== statoCalcolato;
      if (cambia) divergenze++;
      console.log(
        `     · ${m.nome}: riga=${m.stato} calcolato=${statoCalcolato} ${avM.percentuale}%` +
          `   (${m.microvoci.length} micro-voci)${cambia ? '   <-- CAMBIA' : ''}`,
      );

      for (const mv of m.microvoci) {
        const s = valutaSegnaleRischio(mv as any);
        if (mv.segnaleRischio !== s.segnaleRischio || mv.oreExtra !== s.oreExtra) {
          divergenze++;
          console.log(
            `         ! ${mv.nome}: segnale riga=${mv.segnaleRischio}/${mv.oreExtra}h` +
              ` calcolato=${s.segnaleRischio}/${s.oreExtra}h   <-- CAMBIA`,
          );
        }
      }
    }
    console.log('');
  }

  console.log(`Righe che un ricalcolo aggiornerebbe: ${divergenze}`);
  console.log(`Moduli senza micro-voci (stato non verificabile): ${moduliSenzaMicrovoci}`);

  await db.$disconnect();
}

main().catch(async (err) => {
  console.error('probeAvanzamento fallito:', err);
  process.exit(1);
});
