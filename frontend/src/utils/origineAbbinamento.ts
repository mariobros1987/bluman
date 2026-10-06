/**
 * L'origine di un abbinamento messaggio ↔ micro-voce: icona, etichetta, motivo, colore.
 *
 * Perché esiste. Le stesse quattro informazioni erano scritte come ternari annidati in **due** posti
 * per ciascuna vista — l'etichetta e il `title` nella chat, l'etichetta e il `title` nella scheda
 * «Messaggi» — quindi quattro punti per due viste, e l'ottavo sarebbe arrivato con la quarta origine.
 * Qui c'è una tabella sola.
 *
 * Il colore non è decorazione. Fino al 06/10/2026 il badge era **verde per tutte e tre le origini**,
 * cioè «va tutto bene» su abbinamenti che nessuno aveva dichiarato — mentre il compito che i due file
 * gli assegnavano era l'opposto: un abbinamento automatico sbagliato si riconosce **solo** sapendo che
 * era automatico, e il verde lo rendeva indistinguibile da uno giusto. Ora ogni origine ha il suo
 * colore, e i quattro dicono cose diverse:
 *
 *   contesto   azzurro — l'ha dichiarato il cliente toccando il link della voce;
 *   manuale    grigio  — l'ha abbinato una persona: un atto umano, non un allarme;
 *   microvoce  indaco  — il messaggio è nato da questa voce (la mano è dell'operatore, ma non c'è
 *                        stato nessun abbinamento da fare);
 *   eredita    ambra   — l'inferenza più debole, quella da controllare.
 */

export type OrigineAbbinamento = 'contesto' | 'manuale' | 'microvoce' | 'eredita';

export interface EtichettaOrigine {
  /** Il segno, quando la pill non ha spazio per altro (il badge nella chat). */
  icona: string;
  /** Il testo breve, nella scheda della micro-voce. */
  etichetta: string;
  /**
   * Perché quel messaggio è lì. È il `title`, ed è metà dell'informazione: senza, un abbinamento
   * senza motivo è indistinguibile da un abbinamento sbagliato.
   *
   * È una frase intera e autonoma — non un frammento da incastrare — perché i titoli delle due viste
   * devono poter essere lo stesso testo: qui c'era `Messaggio ${motivo}`, che produceva «Messaggio
   * abbinata a mano dall'operatore», cioè un participio che concordava con la voce dentro una frase
   * che cominciava con «Messaggio».
   */
  motivo: string;
  sfondo: string;
  colore: string;
  bordo: string;
}

const ORIGINI: Record<OrigineAbbinamento, EtichettaOrigine> = {
  contesto: {
    icona: '🔗',
    etichetta: '🔗 dal link',
    motivo: 'Abbinata dal link che il cliente ha toccato',
    sfondo: 'var(--pill-sky-bg)',
    colore: 'var(--pill-sky-fg)',
    bordo: 'var(--pill-sky-bd)',
  },
  manuale: {
    icona: '✋',
    etichetta: '✋ a mano',
    motivo: "Abbinata a mano dall'operatore",
    sfondo: 'var(--pill-slate-bg)',
    colore: 'var(--pill-slate-fg)',
    bordo: 'var(--pill-slate-bd)',
  },
  microvoce: {
    icona: '✍',
    etichetta: '✍ scritto da qui',
    motivo: 'Scritto da dentro questa micro-voce: nasce abbinato',
    sfondo: 'var(--pill-indigo-bg)',
    colore: 'var(--pill-indigo-fg)',
    bordo: 'var(--pill-indigo-bd)',
  },
  eredita: {
    icona: '↩️',
    etichetta: '↩️ ereditata',
    motivo: 'Ereditata dal messaggio a cui risponde',
    sfondo: 'var(--pill-amber-bg)',
    colore: 'var(--pill-amber-fg)',
    bordo: 'var(--pill-amber-bd)',
  },
};

/**
 * L'etichetta di un'origine. Un valore che non si conosce **non** ricade su «a mano»: direbbe il
 * falso su un abbinamento che nessuno ha fatto a mano — è il ripiego che `SpunteStato` evita per lo
 * stato di recapito, e la ragione è la stessa.
 */
export function etichettaOrigine(origine: string): EtichettaOrigine {
  return (
    ORIGINI[origine as OrigineAbbinamento] ?? {
      icona: '•',
      etichetta: origine || 'origine non registrata',
      motivo: 'Motivo dell\'abbinamento non registrato per questa riga',
      sfondo: 'var(--pill-slate-bg)',
      colore: 'var(--pill-slate-fg)',
      bordo: 'var(--pill-slate-bd)',
    }
  );
}

export const ORIGINI_ABBINAMENTO = Object.keys(ORIGINI) as OrigineAbbinamento[];
