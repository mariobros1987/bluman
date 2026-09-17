/**
 * Lo stato di recapito di una comunicazione vive dentro `comunicazione_progetto.external_id`, come
 * JSON. Qui c'è l'unico posto che lo legge e lo scrive: la stessa decodifica era copiata in tre
 * punti (la rotta delle comunicazioni, quella che segna le lette, la lista del portale) e ognuno
 * dei tre inventava lo stesso ripiego quando lo stato mancava — `'consegnato'`, cioè una consegna
 * dichiarata da nessuno. Il 17/09/2026 ne sono state contate sei in un giorno solo, tutte su invii
 * che Meta non aveva accettato.
 *
 * Vocabolario, e chi scrive ciascuno stato:
 *   `da-inviare`  la riga esiste, il canale non è ancora stato contattato — lo scrive la creazione;
 *   `inviato`     il canale ha accettato il messaggio — il dispatch, oppure Meta dal webhook;
 *   `consegnato`  arrivato al destinatario — solo Meta, dal webhook di stato;
 *   `letto`       letto dal destinatario (Meta) o aperto nel portale (il portale);
 *   `non-inviato` il canale l'ha rifiutato, e `errore` porta il motivo tecnico.
 *
 * `externalId` è però sovraccarico: sulle righe **in entrata** contiene la chiave di idempotenza
 * del provider (`whatsapp:<wamid>`, `telegram:<updateId>`) e non uno stato. Per questo un valore
 * che non è JSON viene letto come stato solo se è una delle parole note: una chiave di idempotenza
 * non diventa mai uno stato che nessuno ha dichiarato. E quando si scrive, quella chiave si
 * conserva accanto allo stato invece di essere sovrascritta — è ciò con cui il webhook riconosce un
 * evento già visto.
 *
 * Sulle righe in **uscita** `externalId` porta lo stato **e**, da quando l'invio lo conserva, il
 * `wamid` che Meta ha assegnato al messaggio (`providerId`). Serve al webhook di stato: è la sola
 * chiave con cui la ricevuta di consegna ritrova la riga. Prima non veniva conservata da nessuno,
 * quindi `consegnato` e `letto` non potevano arrivare, e la riga restava `inviato` per sempre.
 */

export const STATI_COMUNICAZIONE = ['da-inviare', 'inviato', 'consegnato', 'letto', 'non-inviato'] as const;

export type StatoComunicazione = (typeof STATI_COMUNICAZIONE)[number];

export interface MetaComunicazione {
  stato: StatoComunicazione | null;
  inviatoAt: string | null;
  consegnatoAt: string | null;
  lettoAt: string | null;
  /** Il motivo tecnico del rifiuto, quando `stato` è `non-inviato`. */
  errore: string | null;
}

const VUOTA: MetaComunicazione = { stato: null, inviatoAt: null, consegnatoAt: null, lettoAt: null, errore: null };

/**
 * Il verso di avanzamento del recapito, dal più indietro al più avanti.
 *
 * Serve perché le ricevute del provider **non arrivano garantite in ordine**: un `sent` che
 * segue un `delivered` non è un'informazione nuova, è la stessa storia raccontata più indietro.
 * Senza questo ordine, una ricevuta in ritardo riporterebbe a `inviato` un messaggio già
 * consegnato — cioè il fascicolo disdirebbe una consegna che è avvenuta.
 */
const AVANZAMENTO: Record<StatoComunicazione, number> = {
  'non-inviato': -1,
  'da-inviare': 0,
  inviato: 1,
  consegnato: 2,
  letto: 3,
};

/**
 * Vero quando `nuovo` è un passo avanti rispetto ad `attuale`, o lo ripete.
 *
 * Un guasto (`non-inviato`) si registra sempre, e non si cancella con una tappa intermedia: un
 * messaggio che Meta ha rifiutato non torna «inviato» perché è arrivata una ricevuta generica.
 */
export function statoAvanza(attuale: StatoComunicazione | null, nuovo: StatoComunicazione): boolean {
  if (nuovo === 'non-inviato') return true;
  if (attuale === 'non-inviato') return false;
  return AVANZAMENTO[nuovo] >= AVANZAMENTO[attuale ?? 'da-inviare'];
}

function eStatoNoto(valore: unknown): valore is StatoComunicazione {
  return typeof valore === 'string' && (STATI_COMUNICAZIONE as readonly string[]).includes(valore);
}

function eTesto(valore: unknown): string | null {
  return typeof valore === 'string' && valore ? valore : null;
}

/**
 * Il JSON di partenza, qualunque forma abbia in colonna. Non lancia mai: un `external_id`
 * illeggibile è un `external_id` senza stato, non un errore da far esplodere in faccia a chi
 * sta leggendo un fascicolo.
 */
function baseDaEsterno(externalId: string | null | undefined): Record<string, unknown> {
  const grezzo = (externalId ?? '').trim();
  if (!grezzo) return {};
  if (grezzo.startsWith('{')) {
    try {
      const analizzato = JSON.parse(grezzo);
      return analizzato && typeof analizzato === 'object' && !Array.isArray(analizzato)
        ? (analizzato as Record<string, unknown>)
        : {};
    } catch {
      return {};
    }
  }
  if (eStatoNoto(grezzo)) {
    // Riga scritta da una versione precedente, quando in colonna c'era la sola parola dello stato.
    return { stato: grezzo };
  }
  // Chiave di idempotenza del provider: non è uno stato, ma non si butta.
  return { providerId: grezzo };
}

/** Lo stato di una riga, in forma normalizzata. `stato: null` significa «non dichiarato». */
export function leggiMetaComunicazione(externalId: string | null | undefined): MetaComunicazione {
  const base = baseDaEsterno(externalId);
  if (Object.keys(base).length === 0) return { ...VUOTA };
  return {
    stato: eStatoNoto(base.stato) ? base.stato : null,
    inviatoAt: eTesto(base.inviatoAt),
    consegnatoAt: eTesto(base.consegnatoAt),
    lettoAt: eTesto(base.lettoAt),
    errore: eTesto(base.errore),
  };
}

/** Il nuovo `external_id` con le sole chiavi indicate cambiate: le altre restano come sono. */
export function conStatoComunicazione(
  externalId: string | null | undefined,
  modifiche: Partial<MetaComunicazione> & {
    stato?: StatoComunicazione | null;
    /**
     * La chiave con cui il provider riconosce il messaggio: `whatsapp:<wamid>` in entrata, il
     * solo `wamid` in uscita. Scriverla è ciò che permette alla ricevuta di consegna di
     * ritrovare la riga — senza, il webhook di stato non ha niente da cercare.
     */
    providerId?: string | null;
  },
): string {
  const base = baseDaEsterno(externalId);
  const pulite: Record<string, unknown> = {};
  for (const [chiave, valore] of Object.entries(modifiche)) {
    if (valore !== undefined) pulite[chiave] = valore;
  }
  return JSON.stringify({ ...base, ...pulite });
}
