/**
 * L'unico posto che crea o cancella un movimento di Prima Nota **muovendo anche il saldo del conto**.
 *
 * Creare il movimento e aggiornare il saldo sono un atto solo: un movimento il cui saldo non è stato
 * toccato è un conto che dice il falso, e finché erano due chiamate separate bastava dimenticarne
 * una. È successo in tre percorsi su cinque (il racconto sta in `domain/saldoConto.ts`), e nessuno
 * dei tre faceva rumore. Qui la coppia non si può separare: chi scrive un movimento passa di qui, e
 * il segno lo prende da `deltaSaldoCentesimi` invece di riscriverlo.
 *
 * Il saldo resta comunque una **copia** dei movimenti: la verifica che i due coincidano è in
 * `GET /conti-bancari`, che li ricalcola e riporta la colonna al valore vero quando divergono.
 */

import type { Prisma } from '@prisma/client';
import { deltaSaldoCentesimi } from '../domain/saldoConto.js';

/**
 * Il minimo che serve, strutturale di proposito: lo soddisfano sia `prisma` sia il client di una
 * transazione interattiva (`conContestoInTransazione`). È ciò che permette a un incasso di tenere
 * registrazione, movimento e saldo nella **stessa** transazione — se il tipo chiedesse il client
 * completo, chi è dentro una transazione dovrebbe uscirne per scrivere il saldo, cioè dividere di
 * nuovo ciò che questo modulo esiste per tenere insieme.
 */
export interface ClientPrimaNota {
  movimentoPrimaNota: {
    create: (args: any) => Promise<any>;
    delete: (args: any) => Promise<any>;
  };
  contoBancario: {
    update: (args: any) => Promise<any>;
  };
}

export interface DatiMovimento {
  data: Prisma.MovimentoPrimaNotaUncheckedCreateInput;
  /** Le relazioni da restituire, come le passa la rotta che risponde al client. */
  include?: any;
}

/** Il movimento, quando serve solo per stornarlo: la riga letta prima della cancellazione. */
export interface MovimentoDaStornare {
  id: string;
  contoBancarioId: string | null;
  tipo: 'entrata' | 'uscita';
  importoCentesimi: number;
}

async function applicaAlSaldo(
  client: ClientPrimaNota,
  contoBancarioId: string | null,
  deltaCentesimi: number,
): Promise<void> {
  // Un movimento senza conto non muove niente: il denaro non è attribuito a nessuna banca, e
  // caricarlo su un conto che la riga non nomina è la bugia che questo modulo toglie di mezzo.
  if (!contoBancarioId) return;
  await client.contoBancario.update({
    where: { id: contoBancarioId },
    data: { saldoAttuale: { increment: deltaCentesimi } },
  });
}

/** Crea il movimento **e** muove il saldo del conto che il movimento nomina. */
export async function creaMovimentoConSaldo<T = any>(
  client: ClientPrimaNota,
  dati: DatiMovimento,
): Promise<T> {
  const movimento = await client.movimentoPrimaNota.create(
    dati.include ? { data: dati.data, include: dati.include } : { data: dati.data },
  );
  await applicaAlSaldo(
    client,
    dati.data.contoBancarioId ?? null,
    deltaSaldoCentesimi(dati.data.tipo ?? 'entrata', dati.data.importoCentesimi),
  );
  return movimento as T;
}

/**
 * Cancella il movimento **e** storna il suo effetto sul saldo.
 *
 * Prima il saldo, poi la riga: se il processo muore in mezzo, resta un saldo troppo basso con il
 * movimento ancora in elenco — e la riga che c'è è la verità, quindi la riconciliazione della
 * lettura riporta il saldo dov'era. Nell'ordine inverso resterebbe un saldo troppo alto senza più
 * nessuna riga che lo giustifichi, cioè denaro che non esiste.
 */
export async function eliminaMovimentoEStornaSaldo(
  client: ClientPrimaNota,
  movimento: MovimentoDaStornare,
): Promise<void> {
  await applicaAlSaldo(
    client,
    movimento.contoBancarioId,
    -deltaSaldoCentesimi(movimento.tipo, movimento.importoCentesimi),
  );
  await client.movimentoPrimaNota.delete({ where: { id: movimento.id } });
}
