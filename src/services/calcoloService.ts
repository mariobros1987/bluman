// §16 — Service layer del motore di stato (Fase 1, task 1.2).
//
// `src/domain/stateEngine.ts` è puro: non sa cosa sia un database. Questo file è l'unico
// punto che traduce quelle funzioni in letture e scritture Prisma, ed è l'unico che decide
// cosa valga la pena persistere.
//
// ── Cosa si persiste, e cosa no ────────────────────────────────────────────────
//
// Si persiste lo `stato` di modulo e progetto e il `segnaleRischio`/`oreExtra` della
// micro-voce: hanno una colonna perché sono il risultato di una cascata verso l'alto
// (§16.2/16.3) che una singola query non può ricostruire, e perché altre parti del sistema
// (fatturazione su modulo completato, sblocco dipendenze) li leggono come fatti.
//
// Le **percentuali non si persistono**. Derivano per intero da `stato`, `orePreventivate` e
// `oreConsuntivate`, che sono già in riga: una colonna in più sarebbe un dato denormalizzato
// libero di divergere dai propri ingredienti senza che nessuno se ne accorga. Per questo
// `ricalcolaProgetto()` non ha una migrazione al seguito — non le serve.
//
// ── Perché le scritture sono condizionate ──────────────────────────────────────
//
// Ogni `update` parte solo se il valore calcolato è diverso da quello in riga. Un ricalcolo
// che riscrive valori identici sporca `updatedAt`, sveglia i trigger di audit e rende
// impossibile distinguere "lo stato è cambiato" da "qualcuno ha premuto ricalcola".

import {
  valutaSegnaleRischio,
  calcolaPercentualeModulo,
  calcolaStatoModulo,
  calcolaPercentualeProgetto,
  calcolaStatoProgetto,
} from '../domain/stateEngine.js';
import type { StatoModulo, StatoProgetto } from '../domain/types.js';
import { prisma } from '../util/prismaClient.js';
import { ProgettoNonTrovatoError } from '../adapters/appErrors.js';

/** Proiezione minima che serve al calcolo: è quanto `GET /progetti` già carica. */
export interface MicrovoceCalcolo {
  id: string;
  stato: string;
  orePreventivate: number;
  oreConsuntivate: number;
  segnaleRischio?: boolean;
  oreExtra?: number;
}

export interface ModuloCalcolo {
  id: string;
  stato: string;
  orePreventivate: number;
  microvoci?: MicrovoceCalcolo[] | null;
}

export interface ProgettoCalcolo {
  id?: string;
  stato?: string | null;
  moduli?: ModuloCalcolo[] | null;
}

export interface AvanzamentoModulo {
  id: string;
  stato: StatoModulo;
  percentuale: number;
  segnaleRischio: boolean;
  oreExtra: number;
}

export interface AvanzamentoProgetto {
  percentuale: number;
  stato: StatoProgetto;
  segnaleRischio: boolean;
  oreExtra: number;
  moduli: AvanzamentoModulo[];
}

/**
 * Percentuale da mostrare, a partire da quella calcolata.
 *
 * Il tetto a 99 replica la regola §16.1 un livello più in alto: `calcolaPercentualeMicrovoce`
 * non arriva a 100 finché la micro-voce non è `done`, ma la media pesata di un modulo quasi
 * finito può valere 99.7 e arrotondare a 100. Un modulo che dichiara "100%" mentre il suo
 * stato è `in_progress` è esattamente l'inganno che §16.1 vuole evitare: chi guarda pensa che
 * sia chiuso e nessuno lo chiude. Il 100 lo concede solo lo stato, non l'aritmetica.
 */
function percentualeVisibile(percentuale: number, completo: boolean): number {
  if (completo) return 100;
  return Math.min(99, Math.round(percentuale));
}

/**
 * Calcolo puro dell'avanzamento, senza database. Riceve il progetto con moduli e micro-voci
 * già caricati — la forma che `GET /progetti` ha in mano — e non emette query, così arricchire
 * un elenco di progetti non costa una query per progetto.
 *
 * La media del progetto usa le percentuali **non arrotondate** dei moduli: arrotondare prima
 * di pesare propagherebbe l'errore di ogni modulo nella media.
 */
export function calcolaAvanzamento(progetto: ProgettoCalcolo): AvanzamentoProgetto {
  const moduli = progetto.moduli ?? [];

  const grezzi = moduli.map((m) => {
    // Le micro-voci si passano così come sono: contengono già `stato`, `orePreventivate` e
    // `oreConsuntivate`, cioè tutto ciò che le funzioni pure leggono.
    const microvoci = (m.microvoci ?? []) as any[];

    // Modulo senza micro-voci a database: non c'è nulla da aggregare, quindi si riporta lo
    // stato che la riga già dichiara. `calcolaStatoModulo([])` risponde 'pending', che è la
    // risposta giusta per un modulo appena creato ma sbagliata per uno che qualcuno ha
    // marcato a mano: un modulo `done` senza micro-voci mostrerebbe "da iniziare". La
    // percentuale segue lo stato, perché non ci sono ore su cui calcolarla.
    if (microvoci.length === 0) {
      const statoRiga = (m.stato || 'pending') as StatoModulo;
      return {
        id: m.id,
        stato: statoRiga,
        percentuale: statoRiga === 'done' ? 100 : 0,
        orePreventivate: m.orePreventivate,
        segnaleRischio: false,
        oreExtra: 0,
        senzaMicrovoci: true,
      };
    }

    const stato = calcolaStatoModulo(microvoci);
    const percentuale = calcolaPercentualeModulo(microvoci);

    // Il segnale del modulo è l'OR dei segnali delle sue micro-voci: basta una voce che
    // sfora perché il modulo vada guardato. Le ore extra invece si sommano — è il costo.
    const segnali = microvoci.map((mv) => valutaSegnaleRischio(mv as any));

    return {
      id: m.id,
      stato,
      percentuale,
      orePreventivate: m.orePreventivate,
      segnaleRischio: segnali.some((s) => s.segnaleRischio),
      oreExtra: segnali.reduce((a, s) => a + s.oreExtra, 0),
      senzaMicrovoci: false,
    };
  });

  const percentualeProgetto = calcolaPercentualeProgetto(grezzi);
  const statoCalcolato = calcolaStatoProgetto(grezzi);

  // `pre_project` non si calcola mai (§16.3): precede l'istanziazione dei moduli ed è una
  // transizione esplicita alla firma dell'engagement letter. Se il progetto è ancora lì,
  // è quello lo stato da riportare — non `in_progress` dedotto da zero moduli.
  const stato: StatoProgetto = progetto.stato === 'pre_project' ? 'pre_project' : statoCalcolato;

  return {
    percentuale: percentualeVisibile(percentualeProgetto, stato === 'completed'),
    stato,
    segnaleRischio: grezzi.some((m) => m.segnaleRischio),
    oreExtra: grezzi.reduce((a, m) => a + m.oreExtra, 0),
    moduli: grezzi.map((m) => ({
      id: m.id,
      stato: m.stato,
      percentuale: percentualeVisibile(m.percentuale, m.stato === 'done'),
      segnaleRischio: m.segnaleRischio,
      oreExtra: m.oreExtra,
    })),
  };
}

/** Attacca l'avanzamento a ogni progetto di un elenco già caricato. Nessuna query. */
export function arricchisciProgetti<T extends ProgettoCalcolo>(
  progetti: T[],
): Array<T & { avanzamento: AvanzamentoProgetto }> {
  return progetti.map((p) => ({ ...p, avanzamento: calcolaAvanzamento(p) }));
}

/**
 * Ricalcola e **persiste** la cascata di un progetto: micro-voce → modulo → progetto.
 *
 * Nessuna funzione qui scrive lo stato di una micro-voce (§16.6): la cascata sale, non scende.
 * Le micro-voci cambiano stato solo per azione esplicita (consuntivazione, ritardo manuale,
 * completamento), e questa funzione le legge come dato di partenza.
 */
export async function ricalcolaProgetto(progettoId: string): Promise<AvanzamentoProgetto> {
  const progetto = await prisma.progetto.findUnique({
    where: { id: progettoId },
    include: { moduli: { include: { microvoci: true } } },
  });

  if (!progetto) throw new ProgettoNonTrovatoError(`Progetto non trovato: ${progettoId}`);

  for (const modulo of progetto.moduli) {
    for (const microvoce of modulo.microvoci) {
      const { segnaleRischio, oreExtra } = valutaSegnaleRischio(microvoce as any);
      if (microvoce.segnaleRischio !== segnaleRischio || microvoce.oreExtra !== oreExtra) {
        await prisma.microvoceProgetto.update({
          where: { id: microvoce.id },
          data: { segnaleRischio, oreExtra },
        });
        (microvoce as any).segnaleRischio = segnaleRischio;
        (microvoce as any).oreExtra = oreExtra;
      }
    }

    // Un modulo senza micro-voci non ha nulla da cui derivare uno stato: la sua riga è
    // l'unica fonte di informazione e non va sovrascritta. `calcolaStatoModulo([])` dice
    // 'pending' e un ricalcolo cieco declasserebbe a "da iniziare" un modulo che qualcuno
    // ha chiuso a mano — cancellando un dato che nessuna query può ricostruire.
    if (modulo.microvoci.length === 0) continue;

    const statoModulo = calcolaStatoModulo(modulo.microvoci as any);
    if (modulo.stato !== statoModulo) {
      await prisma.moduloProgetto.update({ where: { id: modulo.id }, data: { stato: statoModulo } });
      (modulo as any).stato = statoModulo;
    }
  }

  // Il progetto in `pre_project` non viene toccato: vedi `calcolaAvanzamento`.
  if (progetto.stato !== 'pre_project') {
    const statoProgetto = calcolaStatoProgetto(progetto.moduli as any);
    if (progetto.stato !== statoProgetto) {
      await prisma.progetto.update({ where: { id: progettoId }, data: { stato: statoProgetto } });
      (progetto as any).stato = statoProgetto;
    }
  }

  return calcolaAvanzamento(progetto as any);
}
