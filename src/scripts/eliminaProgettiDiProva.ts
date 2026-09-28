/**
 * Cancellazione COMPLETA di progetti di PROVA, fatture incluse.
 *
 * L'app rifiuta di eliminare un progetto che ha fatture (guardia fiscale: `eliminaProgetto`
 * risponde 409, «si archivia, non si elimina»). Per i dati di test serve invece rimuoverli
 * davvero: questo script bypassa la guardia usando `prismaAmministrativo()` (§14) e cancella,
 * in una transazione per progetto, l'intero albero:
 *   fatture (→ cascade DB su righe, scadenze→solleciti, registrazioni, audit fattura)
 *   + movimenti di prima nota collegati (altrimenti resterebbero con fattura a null)
 *   + moduli → micro-voci → passaggi, dipendenze, preventivi, eventi, accessi, comunicazioni,
 *     collegamenti chat
 *   + il progetto.
 * NON tocca i clienti (possono avere altri progetti) né la libreria.
 *
 * DISTRUTTIVO e irreversibile. Solo dati di prova. Di default gira in DRY-RUN (mostra cosa
 * cancellerebbe, non scrive). Per eseguire davvero aggiungi `--conferma`.
 *
 *   # dry-run: elenca e conta, non cancella
 *   npx tsx src/scripts/eliminaProgettiDiProva.ts "emirati arabi 123" "Struttura internazionale" "Strutturazione Internazionale — Collaudo E2E"
 *   # esecuzione reale
 *   npx tsx src/scripts/eliminaProgettiDiProva.ts --conferma "emirati arabi 123" "Struttura internazionale" "Strutturazione Internazionale — Collaudo E2E"
 *
 * Si possono passare anche gli id esatti al posto dei nomi.
 */
import dotenv from 'dotenv';
import { prismaAmministrativo } from '../util/prismaClient.js';

dotenv.config();

const prisma = prismaAmministrativo();

async function eliminaProgetto(id: string): Promise<Record<string, number>> {
  return prisma.$transaction(async (tx) => {
    const conteggi: Record<string, number> = {};

    const fatture = await tx.fattura.findMany({ where: { progettoId: id }, select: { id: true } });
    const fatturaIds = fatture.map((f) => f.id);
    conteggi.fatture = fatturaIds.length;

    if (fatturaIds.length > 0) {
      // I movimenti di prima nota hanno FK SetNull sulla fattura: se non li togliamo prima,
      // resterebbero orfani (fatturaId = null) invece di sparire col progetto di prova.
      conteggi.movimentiPrimaNota = (await tx.movimentoPrimaNota.deleteMany({ where: { fatturaId: { in: fatturaIds } } })).count;
      // Cascade DB: fattura_riga, scadenza_incasso (→ sollecito), registrazione_incasso, audit_log_fattura.
      conteggi.fattureEliminate = (await tx.fattura.deleteMany({ where: { id: { in: fatturaIds } } })).count;
    }

    const moduli = await tx.moduloProgetto.findMany({ where: { progettoId: id }, select: { id: true } });
    const moduliIds = moduli.map((m) => m.id);
    if (moduliIds.length > 0) {
      const microvoci = await tx.microvoceProgetto.findMany({ where: { moduloProgettoId: { in: moduliIds } }, select: { id: true } });
      const microvociIds = microvoci.map((mv) => mv.id);
      conteggi.microvoci = microvociIds.length;
      if (microvociIds.length > 0) {
        conteggi.passaggi = (await tx.passaggioProgetto.deleteMany({ where: { microvoceProgettoId: { in: microvociIds } } })).count;
      }
      await tx.microvoceProgetto.deleteMany({ where: { moduloProgettoId: { in: moduliIds } } });
      await tx.moduloProgettoDipendenza.deleteMany({
        where: { OR: [{ dipendeDaModuloProgettoId: { in: moduliIds } }, { moduloProgettoId: { in: moduliIds } }] },
      });
    }
    conteggi.moduli = (await tx.moduloProgetto.deleteMany({ where: { progettoId: id } })).count;
    conteggi.preventivi = (await tx.preventivo.deleteMany({ where: { progettoId: id } })).count;
    conteggi.eventi = (await tx.eventoCalendario.deleteMany({ where: { progettoId: id } })).count;
    conteggi.accessi = (await tx.accessoRisorsa.deleteMany({ where: { progettoId: id } })).count;
    conteggi.comunicazioni = (await tx.comunicazioneProgetto.deleteMany({ where: { progettoId: id } })).count;
    conteggi.collegamentiChat = (await tx.collegamentoChatProgetto.deleteMany({ where: { progettoId: id } })).count;

    await tx.progetto.delete({ where: { id } });
    conteggi.progetto = 1;
    return conteggi;
  });
}

async function main() {
  const argv = process.argv.slice(2);
  const conferma = argv.includes('--conferma');
  const chiavi = argv.filter((a) => a !== '--conferma');
  if (chiavi.length === 0) {
    console.error('Indica almeno un progetto per nome o id. Vedi l\'intestazione del file per l\'uso.');
    process.exit(1);
  }

  console.log(`\n=== ELIMINA PROGETTI DI PROVA — modalità: ${conferma ? 'ESECUZIONE REALE' : 'DRY-RUN'} ===\n`);

  for (const chiave of chiavi) {
    const progetto = await prisma.progetto.findFirst({
      where: { OR: [{ id: chiave }, { nome: chiave }] },
      select: { id: true, nome: true, cliente: { select: { nome: true } }, _count: { select: { fatture: true, moduli: true } } },
    });
    if (!progetto) {
      console.log(`• «${chiave}» → NON TROVATO, salto.`);
      continue;
    }
    const etichetta = `«${progetto.nome}» (${progetto.cliente?.nome ?? 'n/d'}) [${progetto.id}] — ${progetto._count.fatture} fatture, ${progetto._count.moduli} moduli`;
    if (!conferma) {
      console.log(`• DRY-RUN, cancellerei: ${etichetta}`);
      continue;
    }
    const conteggi = await eliminaProgetto(progetto.id);
    console.log(`• ELIMINATO: ${etichetta}`);
    console.log(`    ${JSON.stringify(conteggi)}`);
  }

  if (!conferma) {
    console.log('\nNiente è stato cancellato (dry-run). Rilancia con --conferma per eseguire.\n');
  } else {
    console.log('\nFatto.\n');
  }
}

main()
  .catch((e) => {
    console.error('Errore:', e instanceof Error ? e.message : e);
    process.exit(1);
  })
  .finally(() => process.exit(0));
