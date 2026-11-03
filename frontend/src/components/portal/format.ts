import { fmt } from '../../utils';
import type { TotaleModuli } from './types';

/**
 * Data e ora nel formato italiano, a partire da quello che manda il backend (ISO).
 * Se il valore non è una data valida si restituisce così com'è: meglio un testo grezzo che un
 * «Invalid Date» al posto della data di una firma.
 */
export function dataOraLeggibile(valore: string | null): string {
  if (!valore) return '';
  const d = new Date(valore);
  if (Number.isNaN(d.getTime())) return valore;
  return d.toLocaleString('it-IT', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' });
}

/** §2.4 — Maschera l'IBAN lasciando visibili solo gli ultimi caratteri. */
export const mascheraIban = (iban: string) => {
  const compatto = (iban || '').replace(/\s+/g, '');
  if (!compatto) return '';
  return `•••• ${compatto.slice(-8)}`;
};

/** §2.4 — Maschera il titolare effettivo: il nome intero si vede solo scoprendo il dato. */
export const mascheraUbo = (nome: string) => ((nome || '').trim() ? '••••••••' : '');

/** Prezzo di un modulo nel portale: null vuol dire che lo studio non l'ha indicato, e lo si dice. */
export const fmtPrezzo = (euro: number | null) => (euro == null ? 'Corrispettivo non indicato' : fmt(euro));

/** Totale dei moduli: con prezzi mancanti è la somma dei soli noti, marcata come parziale. */
export const fmtTotaleModuli = (t: TotaleModuli) =>
  t.mancanti === 0 ? fmt(t.totale) : `${fmt(t.totale)} (parziale: ${t.mancanti} senza corrispettivo)`;
