/**
 * Il filtro «senza fascicolo» della campanella (voce 9(c), 09/10/2026).
 *
 * `messaggio_non_instradabile` è l'avviso che dice: un cliente ha scritto su WhatsApp, Telegram o
 * Signal e il messaggio non è entrato in nessun fascicolo — di solito perché ha più di una
 * pratica aperta, o nessuna, e scegliere sarebbe un'invenzione. Sono gli unici avvisi della
 * campanella che chiedono un gesto **sull'anagrafica** invece che su una pratica, e fino al
 * 09/10/2026 erano anche gli unici a non portare da nessuna parte.
 *
 * Il filtro non è un vezzo: finché il difetto non era riparato questi avvisi si accumulavano
 * indistinguibili in mezzo agli altri, e per trovarli bisognava leggere la lista riga per riga.
 * Adesso si isolano, e si vede a colpo d'occhio quanti sono rimasti aperti.
 *
 * ── Perché serve `tipoEvento` e non basta `type` ──────────────────────────────
 * `NotificationItem.type` è il tipo **visivo** (icona e colore), non l'evento. Gli avvisi non
 * instradabili finiscono su `'blocked'`, che è lo stesso tipo dell'euristica KYC: filtrare su
 * `type === 'blocked'` mostrerebbe anche i KYC bloccati, cioè una cosa che con i fascicoli non
 * c'entra. Serve il tipo d'evento grezzo, che il backend manda già in `GET /notifiche`.
 *
 * Il modulo è volutamente indipendente da `NotificationModal`: prende il minimo che gli serve
 * (un `tipoEvento` opzionale), così si può verificare senza montare il pannello, e il pannello
 * resta libero di cambiare forma.
 */

/** Il tipo d'evento degli avvisi «il messaggio non è entrato in nessun fascicolo». */
export const EVENTO_SENZA_FASCICOLO = 'messaggio_non_instradabile';

export type FiltroNotifiche = 'tutte' | 'senza_fascicolo';

export interface NotificaFiltrabile {
  /** Il tipo d'evento del backend. Assente sulle notifiche vecchie, scritte prima che esistesse. */
  tipoEvento?: string;
}

/**
 * Vale la pena mostrare il filtro? Solo se c'è almeno un avviso da filtrare.
 *
 * Un comando che filtra verso il vuoto è peggio di un comando assente: l'operatore lo preme,
 * vede una lista vuota e non sa se è un guasto o se semplicemente non c'è niente. Finché nessun
 * canale ha mai scartato un messaggio — che è la condizione normale quando l'anagrafica è in
 * ordine — il filtro non compare, e non manca a nessuno.
 */
export function haNotificheSenzaFascicolo(notifiche: readonly NotificaFiltrabile[]): boolean {
  return notifiche.some(n => n.tipoEvento === EVENTO_SENZA_FASCICOLO);
}

/** Le notifiche che il pannello deve mostrare per il filtro attivo. */
export function notificheVisibili<T extends NotificaFiltrabile>(
  notifiche: readonly T[],
  filtro: FiltroNotifiche,
): T[] {
  if (filtro === 'tutte') return [...notifiche];
  return notifiche.filter(n => n.tipoEvento === EVENTO_SENZA_FASCICOLO);
}

/** Quante notifiche non lette cadono nel filtro attivo — è il numero che l'operatore vuole vedere. */
export function nonLetteVisibili<T extends NotificaFiltrabile & { read: boolean }>(
  notifiche: readonly T[],
  filtro: FiltroNotifiche,
): number {
  return notificheVisibili(notifiche, filtro).filter(n => !n.read).length;
}
