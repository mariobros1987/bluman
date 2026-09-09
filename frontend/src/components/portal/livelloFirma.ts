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
 *
 * Fase 3: il ramo FEA non respinge più l'OTP — il flusso misurato del portale
 * (grafometrica obbligatoria + sessione certificata + firmatario identificato) la
 * PRODUCE. L'avviso resta per l'unico percorso che il server respinge: la
 * sottoscrizione autografa scansionata, insufficiente per la FEA.
 */
export const AVVISO_LIVELLO: Record<LivelloFirmaPortale, string> = {
  ses: '',
  fea:
    'Questo documento richiede Firma Elettronica Avanzata: la sottoscrizione autografa scansionata non è sufficiente. Firma dal portale con il flusso OTP completo (con firma grafica), oppure con il tuo provider di firma digitale e carica il file firmato.',
  feq:
    'Questo documento richiede Firma Elettronica Qualificata: il codice OTP non è sufficiente. Firma il documento con il tuo provider di firma digitale e carica il file firmato.',
};

/**
 * Il livello contenuto nella stringa `standard` che il server incide nel sigillo
 * (STANDARD_SES / STANDARD_FEA / standard del canale file in firma.ts).
 *
 * Derivarlo dal sigillo è più robusto che fidarsi dello stato della modale: il seal
 * torna sia dal flusso OTP sia dalla firma con file, e per quest'ultima la prop
 * `livelloFirmaModale` ('ses' | 'fea') non copre la qualificata di provider esterno.
 * L'ordine dei match conta: la stringa della qualificata contiene "qualificata"
 * e va riconosciuta prima del ripiego SES; "autografa"/"cartaceo" coprono la
 * sottoscrizione scansionata, che resta SES (la piattaforma attesta la ricezione,
 * non un valore legale superiore). Il default è SES: senza standard dichiarato
 * vale l'etichetta più prudente, mai la più forte — stesso principio di
 * `creaSigilloFea` sul server.
 */
export function livelloDaStandard(standard: string | null | undefined): LivelloFirmaPortale {
  const s = (standard || '').toLowerCase();
  if (s.includes('avanzata')) return 'fea';
  if (s.includes('qualificata')) return 'feq';
  if (s.includes('autografa') || s.includes('cartaceo')) return 'ses';
  return 'ses';
}

/**
 * Sottotitolo della ricevuta (SuccessSealModal): il tipo di firma come lo dichiara
 * lo standard inciso dal server nel sigillo. Allineato alle stringhe STANDARD_* di
 * otpService e ai messaggi di firma.ts, così la ricevuta non promette un valore
 * legale diverso da quello che il backend ha attestato.
 */
export const SOTTOTITOLO_RICEVUTA: Record<LivelloFirmaPortale, string> = {
  ses: "Firma Elettronica Semplice (OTP verificata) · art. 20 CAD",
  fea: "Firma Elettronica Avanzata · eIDAS art. 26 · art. 25 CAD",
  feq: "Firma Elettronica Qualificata (QES · provider esterno eIDAS)",
};

/**
 * Nota legale della ricevuta (SuccessSealModal), per livello. Il ramo FEQ dichiara
 * la cosa per come la piattaforma la conosce — acquisizione di una firma di provider
 * esterno, non una verifica della piattaforma — con lo stesso tono prudente dello
 * standard inciso dal server per il canale file.
 */
export const NOTA_LEGALE_RICEVUTA: Record<LivelloFirmaPortale, string> = {
  ses: "🛡 La presente attestazione documenta che l'atto è stato sottoscritto con firma elettronica semplice mediante codice OTP verificato (art. 20 del CAD). Una copia del documento firmato è conservata nel Vault dello Studio.",
  fea: "🛡 La presente attestazione documenta che l'atto è stato sottoscritto con firma elettronica avanzata (eIDAS art. 26 · art. 25 del CAD). Una copia del documento firmato è conservata nel Vault dello Studio.",
  feq: "🛡 La presente attestazione documenta l'acquisizione di una firma elettronica qualificata apposta con provider esterno (eIDAS UE 910/2014 QES), non verificata dalla piattaforma. Una copia del documento firmato è conservata nel Vault dello Studio.",
};
