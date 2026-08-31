/**
 * §40 — Dove sta un documento nell'archivio: il progetto, e dentro il progetto la micro-voce.
 *
 * Lo schema ammette i due collegamenti separatamente (`Documento.progettoId` e
 * `Documento.microvoceProgettoId`, entrambi nullable, §2.9), e nessuno dei due era controllato:
 * `POST /documenti` scriveva il `microvoceProgettoId` che riceveva senza verificare che quella
 * micro-voce appartenesse al progetto indicato. Bastava una tendina che non si era aggiornata dopo
 * il cambio di progetto per agganciare un atto alla micro-voce di un'ALTRA pratica — e da quel
 * momento il documento compariva nel fascicolo di un progetto e nella lavorazione di un altro.
 *
 * Qui vive la decisione, separata dal database perché è la parte che si può presidiare: chi chiama
 * legge le due righe e passa quello che ha trovato. Il presidio è `src/collocazioneDocumento.test.ts`.
 *
 * La regola che questo file fa rispettare, oltre alla coerenza: un documento non si stacca da tutto.
 * Un documento senza progetto e senza micro-voce esiste ma non compare in nessuna cartella — è la
 * riga «non collocati» dell'archivio, che nasce solo quando un progetto viene eliminato
 * (`onDelete: SetNull`). Nasce da un incidente; non si crea a mano.
 */

/** Quello che il chiamante ha trovato a database per le due righe citate nella richiesta. */
export interface RigheTrovate {
  /** `true` se il progetto richiesto esiste in questo tenant. Irrilevante se non è stato richiesto. */
  progettoEsiste: boolean;
  /**
   * Il progetto a cui appartiene la micro-voce richiesta (via `moduloProgetto.progettoId`).
   *
   * `undefined` significa «micro-voce non trovata in questo tenant»: è diverso da `null`, che qui
   * non si dà mai — una micro-voce appartiene sempre a un modulo, e un modulo a un progetto.
   */
  progettoDellaMicrovoce?: string | undefined;
}

export interface EsitoCollocazione {
  ok: boolean;
  /** Il messaggio per l'operatore, in italiano: dice quale delle due righe non torna. */
  errore?: string;
  /** `404` quando una riga citata non esiste, `400` quando esistono ma insieme non stanno. */
  codice?: 400 | 404;
  /** I due campi da scrivere sulla riga `documento`. Presenti solo con `ok: true`. */
  progettoId?: string;
  microvoceProgettoId?: string | null;
}

/**
 * Decide dove va il documento, o perché non ci può andare.
 *
 * Il progetto viene sempre valorizzato, anche quando la richiesta indica solo la micro-voce: si
 * deduce da quest'ultima. Così l'archivio non deve risalire il modulo per sapere in quale cartella
 * mostrare il documento, e un documento agganciato a una micro-voce non finisce mai fra i «non
 * collocati» — che era possibile, perché §2.9 permette di valorizzare solo `microvoceProgettoId`.
 */
export function decidiCollocazione(
  richiesta: { progettoId?: string | null; microvoceProgettoId?: string | null },
  trovate: RigheTrovate,
): EsitoCollocazione {
  const progettoRichiesto = (richiesta.progettoId ?? '').trim() || null;
  const microvoceRichiesta = (richiesta.microvoceProgettoId ?? '').trim() || null;

  if (!progettoRichiesto && !microvoceRichiesta) {
    return {
      ok: false,
      codice: 400,
      errore: 'Indicare almeno il progetto: un documento senza progetto non compare in nessuna cartella dell\'archivio.',
    };
  }

  if (progettoRichiesto && !trovate.progettoEsiste) {
    return { ok: false, codice: 404, errore: 'Progetto non trovato.' };
  }

  if (!microvoceRichiesta) {
    // Solo il progetto: è il caso normale del fascicolo, e stacca il documento dalla micro-voce a
    // cui era agganciato prima (`null` è una scrittura, non un «lascia com'era»).
    return { ok: true, progettoId: progettoRichiesto!, microvoceProgettoId: null };
  }

  const progettoDellaMicrovoce = trovate.progettoDellaMicrovoce;
  if (progettoDellaMicrovoce === undefined) {
    return { ok: false, codice: 404, errore: 'Micro-voce non trovata.' };
  }

  if (progettoRichiesto && progettoDellaMicrovoce !== progettoRichiesto) {
    // Il difetto che questo controllo chiude: la micro-voce di un'altra pratica.
    return {
      ok: false,
      codice: 400,
      errore: 'La micro-voce indicata appartiene a un altro progetto: scegliere una micro-voce di questo progetto, oppure collegare il documento al solo fascicolo.',
    };
  }

  return { ok: true, progettoId: progettoDellaMicrovoce, microvoceProgettoId: microvoceRichiesta };
}

/**
 * La frase che finisce nell'audit: dove stava il documento e dove sta adesso.
 *
 * Serve che sia leggibile a distanza di anni da chi non ha davanti l'interfaccia: nomi, non soli
 * UUID. Gli id restano perché sono l'unica cosa che non cambia se il progetto viene rinominato.
 */
export function descriviSpostamento(
  prima: { progetto?: string | null; microvoce?: string | null },
  dopo: { progetto?: string | null; microvoce?: string | null },
): string {
  const dove = (p: { progetto?: string | null; microvoce?: string | null }) => {
    if (!p.progetto && !p.microvoce) return 'nessuna cartella';
    const pezzi = [p.progetto ? `progetto «${p.progetto}»` : 'nessun progetto'];
    if (p.microvoce) pezzi.push(`micro-voce «${p.microvoce}»`);
    else pezzi.push('nessuna micro-voce');
    return pezzi.join(', ');
  };
  return `da ${dove(prima)} a ${dove(dopo)}`;
}
