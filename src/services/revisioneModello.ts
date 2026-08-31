/**
 * §41 — Lo stato di revisione di un modello del Document Studio, e chi può passare a cosa.
 *
 * Perché un file a parte e non due `if` dentro la rotta: la decisione serve in tre punti
 * diversi — il cambio di stato chiesto dall'operatore (`PATCH /documenti-template/:id/revisione`),
 * la modifica del testo (`PUT /documenti-template/:id`, che su un modello approvato non può
 * lasciare l'approvazione dov'era) e l'adozione di un modello di serie. Tenerla qui la rende
 * verificabile senza database, che è la ragione per cui `src/cartellaTemplate.test.ts` può
 * presidiarla riga per riga.
 *
 * La regola che conta, e che non è ovvia: un'approvazione vale sul TESTO approvato. Se quel
 * testo cambia, l'approvazione non si porta dietro il nuovo testo — decade, la versione sale e
 * il modello torna in bozza. Il contrario (approvazione che resta appesa a un contenuto
 * diverso) è peggio di nessuna approvazione, perché in elenco sembra una garanzia.
 */

/**
 * Gli stati ammessi. L'elenco sta qui e non in un CHECK di colonna: duplicarlo a database
 * significherebbe due posti da cambiare insieme, e la migrazione perderebbe la corsa contro
 * il codice al primo stato nuovo.
 */
export const STATI_REVISIONE = ['bozza', 'in_revisione', 'approvato'] as const;
export type StatoRevisione = (typeof STATI_REVISIONE)[number];

export function statoRevisioneValido(valore: unknown): valore is StatoRevisione {
  return typeof valore === 'string' && (STATI_REVISIONE as readonly string[]).includes(valore);
}

/** Come lo stato si chiama per un essere umano (interfaccia, audit, avvisi). */
export function etichettaStato(stato: StatoRevisione): string {
  if (stato === 'approvato') return 'Approvato';
  if (stato === 'in_revisione') return 'In revisione';
  return 'Bozza';
}

export interface EsitoRevisione {
  ok: boolean;
  errore?: string;
  /** 400 quando la richiesta non è ammissibile; assente quando `ok`. */
  codice?: 400;
  /** Lo stato da scrivere: presente solo se `ok`. */
  stato?: StatoRevisione;
}

/**
 * Il passaggio di stato chiesto dall'operatore è ammissibile?
 *
 * Tutti i passaggi fra stati diversi sono consentiti, compreso il ritorno di un modello
 * approvato in bozza: un testo può diventare obsoleto per una circolare, e negare il ritorno
 * costringerebbe a duplicare il modello per poterlo correggere. Quello che NON è ammesso è
 * riscrivere lo stesso stato: sarebbe un audit che dichiara un cambio mai avvenuto, e
 * sovrascriverebbe la data e il nome di chi aveva deciso davvero.
 */
export function decidiRevisione(attuale: string, chiesto: unknown): EsitoRevisione {
  if (!statoRevisioneValido(chiesto)) {
    return {
      ok: false,
      codice: 400,
      errore: `Stato di revisione non valido: i valori ammessi sono ${STATI_REVISIONE.join(', ')}.`,
    };
  }
  if (chiesto === attuale) {
    return {
      ok: false,
      codice: 400,
      errore: `Il modello è già in stato «${etichettaStato(chiesto)}»: non c'è niente da cambiare.`,
    };
  }
  return { ok: true, stato: chiesto };
}

export interface EffettoModifica {
  /** Lo stato dopo la modifica del testo. */
  stato: StatoRevisione;
  /** La versione dopo la modifica del testo. */
  versione: number;
  /** Vero se l'approvazione è decaduta per effetto della modifica: va detto all'operatore. */
  approvazioneDecaduta: boolean;
}

/**
 * Che ne è dello stato quando si salva una modifica al modello.
 *
 * `versione` conta le approvazioni superate, non i salvataggi: sale solo quando si esce da uno
 * stato approvato perché il testo è cambiato. Così «v3» in elenco significa «questo modello è
 * stato approvato e poi riaperto due volte», che è un'informazione; contare i salvataggi
 * direbbe soltanto quanto si è battuto sulla tastiera.
 *
 * Un modello `in_revisione` che cambia resta in revisione: la revisione è in corso proprio per
 * far correggere il testo, e farla ricadere in bozza a ogni correzione obbligherebbe a
 * ripresentarla dopo ogni virgola. Non è un'attestazione, quindi non c'è nulla che decada.
 */
export function effettoModifica(params: {
  statoAttuale: string;
  versioneAttuale: number;
  contenutoCambiato: boolean;
}): EffettoModifica {
  const stato: StatoRevisione = statoRevisioneValido(params.statoAttuale) ? params.statoAttuale : 'bozza';
  const versione = Number.isFinite(params.versioneAttuale) && params.versioneAttuale > 0 ? params.versioneAttuale : 1;

  if (params.contenutoCambiato && stato === 'approvato') {
    return { stato: 'bozza', versione: versione + 1, approvazioneDecaduta: true };
  }
  return { stato, versione, approvazioneDecaduta: false };
}

/** La frase che finisce nel giornale di audit: cosa è cambiato, e perché se è stato scritto. */
export function descriviRevisione(params: {
  titolo: string;
  da: string;
  a: StatoRevisione;
  note?: string | null;
}): string {
  const da = statoRevisioneValido(params.da) ? etichettaStato(params.da) : params.da;
  const motivo = params.note && params.note.trim() ? ` — motivo: «${params.note.trim()}»` : '';
  return `Modello «${params.titolo}» portato da ${da} a ${etichettaStato(params.a)}${motivo}`;
}

/**
 * La frase per l'audit della modifica del testo. Si scrive solo quando c'è qualcosa di non
 * ovvio da dire, cioè quando la modifica ha fatto decadere un'approvazione.
 */
export function descriviDecadenza(titolo: string, versione: number): string {
  return (
    `Il testo del modello «${titolo}» è stato modificato dopo l'approvazione: ` +
    `l'approvazione è decaduta e il modello torna in bozza come versione ${versione}`
  );
}
