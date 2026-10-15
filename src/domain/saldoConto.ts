/**
 * Il saldo di un conto bancario, **ricavato dai suoi movimenti**. PURO: nessun DB, nessun HTTP.
 *
 * Il saldo non è un dato da conservare: è `saldoIniziale + Σ(entrate) − Σ(uscite)`. Fino al
 * 15/10/2026 l'app lo teneva in una colonna (`conto_bancario.saldo_attuale`) che ogni percorso che
 * creava o cancellava un movimento doveva incrementare a mano — e tre percorsi su cinque se ne
 * dimenticavano, o lo facevano sul conto sbagliato:
 *
 * - il **rimborso** di una Nota di Credito totale creava il movimento di uscita e non toccava alcun
 *   saldo: il conto continuava a tenere denaro che era uscito;
 * - l'**incasso** senza conto indicato scriveva il movimento **senza conto** e caricava l'importo
 *   sul conto predefinito: il denaro entrava in un conto che nessuna riga nominava, e spariva da
 *   ogni riconciliazione;
 * - l'**import CSV** creava i movimenti sul conto scelto e non aggiornava alcun saldo.
 *
 * Non erano tre sviste: è la forma del guasto. Un valore derivato tenuto a mano in N posti diverge
 * nei posti che si dimenticano, e il posto dimenticato non fa rumore — mostra un numero plausibile.
 * Qui c'è l'**unica** definizione del conto: i percorsi che scrivono passano tutti da
 * `services/primaNotaMovimento.ts`, e la lettura dei conti (`GET /conti-bancari`) ricalcola il saldo
 * dai movimenti e riporta la colonna al valore vero quando i due divergono.
 */

export type TipoMovimento = 'entrata' | 'uscita';

export interface MovimentoPerSaldo {
  tipo: TipoMovimento;
  importoCentesimi: number;
}

/**
 * Il segno di un movimento. L'importo di una riga di Prima Nota è un **modulo**: il segno lo dà il
 * tipo, sempre. Le due copie di questa riga che stavano nelle rotte (una per la creazione, una
 * invertita per la cancellazione) erano il posto naturale per un errore di segno silenzioso.
 */
export function deltaSaldoCentesimi(tipo: TipoMovimento, importoCentesimi: number): number {
  return tipo === 'entrata' ? importoCentesimi : -importoCentesimi;
}

/** Il saldo di un conto: il suo saldo iniziale più tutti i movimenti che lo nominano. */
export function saldoContoCentesimi(
  saldoInizialeCentesimi: number,
  movimenti: readonly MovimentoPerSaldo[],
): number {
  return movimenti.reduce(
    (acc, m) => acc + deltaSaldoCentesimi(m.tipo, m.importoCentesimi),
    saldoInizialeCentesimi,
  );
}
