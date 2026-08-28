// Etichettatura SES/FEA/FEQ lato portale cliente (piano firma §3) — solo presentazione.
// L'enforcement vero resta il 409 del server sulle rotte di firma
// (src/services/livelloFirmaService.ts): qui il portale nasconde o disabilita il
// percorso OTP prima di consumare un invio di codice, orientando il cliente al
// canale che il documento esige.

export type LivelloFirmaPortale = 'ses' | 'fea' | 'feq';

/**
 * Il livello che il documento esige, con il ripiego per i dati storici: i documenti
 * nati prima dell'etichettatura (o con dato sporco) non hanno `livelloFirmaRichiesto`,
 * e per loro tutto continua a funzionare come SES — è anche ciò che il server assume
 * con `normalizzaLivelloFirma`.
 */
export function livelloFirmaEffettivo(livello: string | null | undefined): LivelloFirmaPortale {
  return livello === 'fea' || livello === 'feq' ? livello : 'ses';
}

/** Sigla e icona per il badge accanto al titolo del documento. */
export const ETICHETTA_LIVELLO: Record<LivelloFirmaPortale, { icona: string; nome: string }> = {
  ses: { icona: '📱', nome: 'SES' },
  fea: { icona: '🧠', nome: 'FEA' },
  feq: { icona: '🔐', nome: 'FEQ' },
};

/**
 * Messaggi con cui il portale rifiusta in anticipo il flusso OTP. Sono allineati a
 * quelli che il server risponde con 409 (verificaLivelloFirma): chi li vede qui non
 * arriverà a fare una richiesta che verrebbe respinta con le stesse parole.
 */
export const AVVISO_LIVELLO: Record<LivelloFirmaPortale, string> = {
  ses: '',
  fea:
    'Questo documento richiede Firma Elettronica Avanzata: il flusso OTP semplice non è sufficiente. Contatta lo studio per concordare la modalità di sottoscrizione.',
  feq:
    'Questo documento richiede Firma Elettronica Qualificata: il codice OTP non è sufficiente. Firma il documento con il tuo provider di firma digitale e carica il file firmato.',
};
