// Il valore di un progetto è la somma dei prezzi dei suoi moduli meno lo sconto concordato
// (centesimi; lo sconto è del titolare, 28/11/2026).
//
// È la regola che la pagina del progetto applicava già a schermo, ma solo lì: a database il
// valore nasceva a 0 e nessuno lo alzava, quindi elenco, Dashboard e report mostravano un
// progetto senza valore finché qualcuno non salvava una modifica dal dettaglio. Qui la somma si
// fa in un punto solo, sul server (regola 5), e si scrive quando i moduli cambiano: istanziazione,
// eliminazione di un modulo, salvataggio dei prezzi.
//
// Un progetto SENZA moduli non viene toccato: il suo valore è quello scritto a mano (o dal seed),
// e azzerarlo qui vorrebbe dire cancellare un dato che nessun modulo sostituisce. Fa eccezione
// chi ha appena tolto l'ultimo modulo (`azzeraSeSenzaModuli`): lì il valore di prima era la
// somma di moduli che non ci sono più.

import { scontoApplicabile } from '../domain/importiFatturabili.js';

/**
 * Il pezzo di client che serve, scritto a mano: `prisma` qui è un client esteso (contesto dello
 * studio), e i suoi tipi non coincidono con quelli di una transazione. Così la funzione accetta
 * entrambi e resta provabile con un client finto.
 */
export interface ClientValoreProgetto {
  moduloProgetto: {
    aggregate(args: { where: { progettoId: string }; _sum: { prezzo: true }; _count: { _all: true } }): PromiseLike<{
      _sum: { prezzo: number | null };
      _count: { _all: number };
    }>;
  };
  progetto: {
    findUnique(args: { where: { id: string }; select: { scontoCentesimi: true } }): PromiseLike<{ scontoCentesimi: number } | null>;
    update(args: { where: { id: string }; data: { valoreTotale: number } }): PromiseLike<unknown>;
  };
}

/**
 * Riscrive `progetto.valoreTotale` come somma di `modulo_progetto.prezzo` meno lo sconto del
 * progetto (mai sotto zero: uno sconto più alto della somma si applica fino a zero).
 * Ritorna il valore scritto, oppure `null` se il progetto non ha moduli e non si è chiesto di
 * azzerarlo (niente scritto).
 */
export async function riallineaValoreProgetto(
  client: ClientValoreProgetto,
  progettoId: string,
  opzioni: { azzeraSeSenzaModuli?: boolean } = {},
): Promise<number | null> {
  const somma = await client.moduloProgetto.aggregate({
    where: { progettoId },
    _sum: { prezzo: true },
    _count: { _all: true },
  });
  if (somma._count._all === 0 && !opzioni.azzeraSeSenzaModuli) return null;
  const sommaModuli = somma._sum.prezzo ?? 0;
  const progetto = await client.progetto.findUnique({ where: { id: progettoId }, select: { scontoCentesimi: true } });
  const valoreTotale = sommaModuli - scontoApplicabile(sommaModuli, progetto?.scontoCentesimi ?? 0);
  await client.progetto.update({ where: { id: progettoId }, data: { valoreTotale } });
  return valoreTotale;
}
