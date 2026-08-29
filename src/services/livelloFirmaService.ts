/**
 * Livelli di firma (piano-firma-legale-ses-fea-feq.md §3) — logica pura.
 *
 * Tre sono i livelli di valore legale che l'operatore può richiedere per un documento:
 * - `ses` — Firma Elettronica Semplice (art. 20 CAD, eIDAS art. 3 n. 10): il flusso OTP
 *   attuale la soddisfa;
 * - `fea` — Firma Elettronica Avanzata (eIDAS art. 26): dalla Fase 3 del piano la produce
 *   il flusso OTP misurato del portale (identificazione del firmatario + grafometrica
 *   obbligatoria + sessione certificata); sul canale file la produce anche la firma
 *   qualificata esterna del cliente, che è un valore legale superiore;
 * - `feq` — Firma Elettronica Qualificata (eIDAS art. 25): oggi si ottiene solo con il
 *   provider esterno del cliente (`qualificata_esterna` su /portal/firma-con-file).
 *
 * Due campi distinti, come nel piano §3.1:
 * - `livelloFirmaRichiesto` (Documento, PassaggioProgetto, template): il livello che il
 *   documento ESIGE prima di poter essere firmato — lo sceglie l'operatore;
 * - `valoreLegale` (FirmaElettronica): il valore legale EFFETTIVO della firma apposta —
 *   lo scrive il server al momento della firma, mai il frontend (vincolo 7).
 *
 * Questo file non tocca il database: normalizzazione, confronto e enforcement sono
 * funzioni pure, così i test coprono le regole §3.2 senza mocking.
 */

export type LivelloFirma = 'ses' | 'fea' | 'feq';

export const LIVELLI_FIRMA: readonly LivelloFirma[] = ['ses', 'fea', 'feq'];

/** Descrizioni per UI e verbale: il nome legale completo, non una sigla gergale. */
export const DESCRIZIONE_LIVELLO_FIRMA: Record<LivelloFirma, string> = {
  ses: 'Firma Elettronica Semplice (SES) · art. 20 CAD — eIDAS UE 910/2014 art. 3 n. 10',
  fea: 'Firma Elettronica Avanzata (FEA) · eIDAS UE 910/2014 art. 26',
  feq: 'Firma Elettronica Qualificata (FEQ) · eIDAS UE 910/2014 art. 25',
};

export function livelloFirmaValido(valore: unknown): valore is LivelloFirma {
  return typeof valore === 'string' && (LIVELLI_FIRMA as readonly string[]).includes(valore);
}

/**
 * Normalizza il valore letto dal database: una colonna TEXT senza enum può contenere
 * qualsiasi cosa, e un dato sporco non deve bloccare la firma — ricade su `ses`, che è
 * il default di migrazione e il comportamento storico.
 */
export function normalizzaLivelloFirma(valore: unknown): LivelloFirma {
  return livelloFirmaValido(valore) ? valore : 'ses';
}

/** Peso ordinale: serve a calcolare il livello più alto tra più passaggi di un modulo. */
export const PESO_LIVELLO: Record<LivelloFirma, number> = { ses: 0, fea: 1, feq: 2 };

/**
 * Il livello più alto tra quelli indicati; `ses` per l'elenco vuoto.
 * Per la conferma firmata di un modulo il livello richiesto è il MASSIMO dei livelli dei
 * suoi passaggi firmati: basta un passaggio che esige FEQ perché l'intero modulo lo
 * esiga (decisione Fase 2 — il riferimento della firma è il modulo, i livelli stanno sui
 * passaggi).
 */
export function livelloPiuAlto(livelli: Iterable<string | null | undefined>): LivelloFirma {
  let massimo: LivelloFirma = 'ses';
  for (const valore of livelli) {
    const livello = normalizzaLivelloFirma(valore);
    if (PESO_LIVELLO[livello] > PESO_LIVELLO[massimo]) massimo = livello;
  }
  return massimo;
}

/** Quale rotta di firma sta chiedendo di firmare. */
export type CanaleFirma = 'otp' | 'file';

export type EsitoLivelloFirma =
  | { consentito: true; livelloRichiesto: LivelloFirma }
  | { consentito: false; livelloRichiesto: LivelloFirma; codice: 409; errore: string };

/**
 * Enforcement §3.2 — il livello richiesto non è cosmetico: se il flusso scelto non può
 * produrre il valore legale che il documento esige, la firma si blocca PRIMA di consumare
 * risorse (codici OTP, upload, scritture). Nessuna degradazione silenziosa a SES.
 *
 * - `ses` → tutto come oggi, su entrambe le rotte;
 * - `fea` → consentito sul canale OTP: lo produce il flusso misurato della Fase 3
 *   (verify-otp-and-sign con grafometrica obbligatoria e sessione certificata nel
 *   digest). Sul canale `file` è ammessa la `qualificata_esterna` — un valore legale
 *   superiore soddisfa anche un'esigenza inferiore — mentre la scansione autografa
 *   (`manuale_scansionata`) resta insufficiente;
 * - `feq` → 409 sulla rotta OTP; su `firma-con-file` è ammessa SOLO la
 *   `qualificata_esterna` (l'unico modo attuale di ottenere FEQ), mentre la scansione
 *   autografa (`manuale_scansionata`) resta insufficiente.
 */
export function verificaLivelloFirma(params: {
  livelloRichiesto: string | null | undefined;
  canale: CanaleFirma;
  /** Il tipoFirma della rotta `file`: manuale_scansionata | qualificata_esterna. */
  tipoFirma?: string;
}): EsitoLivelloFirma {
  const livelloRichiesto = normalizzaLivelloFirma(params.livelloRichiesto);

  if (livelloRichiesto === 'ses') return { consentito: true, livelloRichiesto };

  if (livelloRichiesto === 'fea') {
    // Canale OTP: la produce il flusso misurato della Fase 3 — in verify-otp-and-sign
    // la grafometrica diventa obbligatoria per questo livello e la sessione certificata
    // (sid/iat) entra nel digest del sigillo.
    if (params.canale === 'otp') {
      return { consentito: true, livelloRichiesto };
    }
    // Canale file: la firma qualificata esterna vale più della FEA e soddisfa anche
    // un'esigenza inferiore; la sottoscrizione autografa scansionata no.
    if (params.tipoFirma === 'qualificata_esterna') {
      return { consentito: true, livelloRichiesto };
    }
    return {
      consentito: false,
      livelloRichiesto,
      codice: 409,
      errore:
        'Questo documento richiede Firma Elettronica Avanzata: la sottoscrizione autografa scansionata non è sufficiente. ' +
        'Firma dal portale con il flusso OTP completo, oppure con il tuo provider di firma digitale e carica il file firmato.',
    };
  }

  // livelloRichiesto === 'feq'
  if (params.canale === 'otp') {
    return {
      consentito: false,
      livelloRichiesto,
      codice: 409,
      errore:
        'Questo documento richiede Firma Elettronica Qualificata: il codice OTP non è sufficiente. ' +
        'Firma il documento con il tuo provider di firma digitale e carica il file firmato.',
    };
  }
  if (params.tipoFirma === 'qualificata_esterna') {
    return { consentito: true, livelloRichiesto };
  }
  return {
    consentito: false,
    livelloRichiesto,
    codice: 409,
    errore:
      'Questo documento richiede Firma Elettronica Qualificata: la sottoscrizione autografa scansionata non è sufficiente. ' +
      'Firma il documento con il tuo provider di firma digitale e carica il file firmato.',
  };
}
