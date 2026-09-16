import { createHmac, timingSafeEqual } from 'node:crypto';

const FIRMA_WA = /^sha256=([a-f0-9]{64})$/i;
const SEGRETO_TG = /^([a-f0-9]{32})_([A-Za-z0-9_-]{43})$/;

function ugualiCostanti(a: Buffer, b: Buffer): boolean {
  return a.length === b.length && timingSafeEqual(a, b);
}

export function verificaFirmaWhatsapp(
  rawBody: Buffer,
  firma: string | string[] | undefined,
  appSecret: string | undefined,
): 'ok' | 'secret_missing' | 'invalid' {
  if (!appSecret) return 'secret_missing';
  const valore = Array.isArray(firma) ? firma[0] : firma;
  const match = valore?.match(FIRMA_WA);
  const digestHex = match?.[1];
  if (!digestHex) return 'invalid';
  const attesa = createHmac('sha256', appSecret).update(rawBody).digest();
  const fornita = Buffer.from(digestHex, 'hex');
  return ugualiCostanti(fornita, attesa) ? 'ok' : 'invalid';
}

function uuidCompatto(tenantId: string): string {
  return tenantId.replaceAll('-', '').toLowerCase();
}

export function tenantIdDaSegretoTelegram(secret: string | string[] | undefined): string | null {
  const valore = Array.isArray(secret) ? secret[0] : secret;
  const match = valore?.match(SEGRETO_TG);
  const compatto = match?.[1];
  if (!compatto) return null;
  return `${compatto.slice(0, 8)}-${compatto.slice(8, 12)}-${compatto.slice(12, 16)}-${compatto.slice(16, 20)}-${compatto.slice(20)}`;
}

export function creaSegretoTelegram(tenantId: string, botToken: string, masterSecret: string): string {
  const tenant = uuidCompatto(tenantId);
  if (!/^[a-f0-9]{32}$/.test(tenant)) throw new Error('tenantId non valido per il secret Telegram');
  const mac = createHmac('sha256', masterSecret)
    .update(`telegram-webhook\0${tenantId}\0${botToken}`)
    .digest('base64url');
  return `${tenant}_${mac}`;
}

export function verificaSegretoTelegram(
  fornito: string | string[] | undefined,
  tenantId: string,
  botToken: string,
  masterSecret: string | undefined,
): 'ok' | 'secret_missing' | 'invalid' {
  if (!masterSecret) return 'secret_missing';
  const valore = Array.isArray(fornito) ? fornito[0] : fornito;
  if (!valore) return 'invalid';
  const atteso = creaSegretoTelegram(tenantId, botToken, masterSecret);
  return ugualiCostanti(Buffer.from(valore), Buffer.from(atteso)) ? 'ok' : 'invalid';
}

/** Normalizza solo forme equivalenti certe: +/00 e prefisso mobile italiano omesso. */
export function normalizzaTelefono(valore: unknown): string | null {
  if (typeof valore !== 'string') return null;
  let cifre = valore.trim().replace(/\D/g, '');
  if (cifre.startsWith('00')) cifre = cifre.slice(2);
  if (/^3\d{8,10}$/.test(cifre)) cifre = `39${cifre}`;
  return /^\d{8,15}$/.test(cifre) ? cifre : null;
}

// ── Payload del link per progetto (deep link Telegram) ────────────────────────────────
//
// `t.me/<Bot>?start=<payload>`: chi tocca il link manda al bot un `/start <payload>`, e il payload
// dice a quale pratica appartiene quella chat. Il payload è firmato perché agganciare una chat a
// una pratica significa «i messaggi di questa chat entrano in questo fascicolo»: se bastasse
// conoscere l'UUID del progetto, chiunque ne venga in possesso — un link inoltrato, uno screenshot,
// un PDF — potrebbe scrivere dentro un fascicolo altrui.
//
// Perché un MAC troncato a 16 byte. Telegram accetta al massimo **64 caratteri** in `?start=`, e
// solo `A-Za-z0-9_-`. L'UUID compatto ne occupa 32; un MAC base64url intero ne occupa 43, e il
// totale di 76 verrebbe rifiutato da Telegram senza spiegare perché. Con 16 byte il payload è di
// **55** caratteri, e 128 bit di MAC restano fuori portata per qualunque tentativo di falsificarlo.
//
// Il MAC copre **tenant e progetto insieme**: il link di uno studio non è spendibile su un altro
// nemmeno se i due condividono il master secret.
const PAYLOAD_COLLEGAMENTO = /^([a-f0-9]{32})_([A-Za-z0-9_-]{22})$/;
const DOMINIO_PAYLOAD_COLLEGAMENTO = 'telegram-deeplink';

function macCollegamento(tenantId: string, progettoId: string, masterSecret: string): string {
  // I due identificativi si normalizzano alla forma compatta **prima** di firmare. `creaSegretoTelegram`
  // qui sopra firma i valori come arrivano, e va bene perché li produce sempre il database; qui il
  // payload lo scioglie il webhook ricomponendo l'UUID con i trattini, quindi firmare la forma grezza
  // significherebbe che uno stesso progetto scritto in due modi produce due MAC diversi — e un link
  // generato da un chiamante che passa l'UUID compatto non verrebbe mai riconosciuto.
  return createHmac('sha256', masterSecret)
    .update(`${DOMINIO_PAYLOAD_COLLEGAMENTO}\0${uuidCompatto(tenantId)}\0${uuidCompatto(progettoId)}`)
    .digest()
    .subarray(0, 16)
    .toString('base64url');
}

/**
 * Il payload del link per progetto: `<uuid-compatto>_<mac>`.
 *
 * Lancia se `tenantId` o `progettoId` non sono UUID: un payload costruito su un valore che non è un
 * identificativo produrrebbe un link che il webhook non saprebbe sciogliere, e meglio non
 * generarlo affatto.
 */
export function creaPayloadCollegamento(tenantId: string, progettoId: string, masterSecret: string): string {
  const tenant = uuidCompatto(tenantId);
  const progetto = uuidCompatto(progettoId);
  if (!/^[a-f0-9]{32}$/.test(tenant)) throw new Error('tenantId non valido per il payload di collegamento');
  if (!/^[a-f0-9]{32}$/.test(progetto)) throw new Error('progettoId non valido per il payload di collegamento');
  return `${progetto}_${macCollegamento(tenantId, progettoId, masterSecret)}`;
}

/**
 * Scioglie il payload ricevuto in `/start`, o `null` se non è autentico.
 *
 * `null` copre ogni motivo — forma sbagliata, MAC di un altro progetto, MAC di un altro studio,
 * master secret diverso — e il chiamante non deve distinguerli: chi manda un payload non valido non
 * deve poter capire *perché* non lo è.
 */
export function progettoIdDaPayloadCollegamento(
  payload: unknown,
  tenantId: string,
  masterSecret: string | undefined,
): string | null {
  if (!masterSecret) return null;
  const valore = typeof payload === 'string' ? payload.trim() : '';
  const match = valore.match(PAYLOAD_COLLEGAMENTO);
  const compatto = match?.[1];
  const mac = match?.[2];
  if (!compatto || !mac) return null;
  const progettoId = `${compatto.slice(0, 8)}-${compatto.slice(8, 12)}-${compatto.slice(12, 16)}-${compatto.slice(16, 20)}-${compatto.slice(20)}`;
  const atteso = macCollegamento(tenantId, progettoId, masterSecret);
  return ugualiCostanti(Buffer.from(mac), Buffer.from(atteso)) ? progettoId : null;
}
