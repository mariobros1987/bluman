import crypto from 'crypto';
import type { Ruolo } from './authorization.js';

const LUNGHEZZA_MINIMA_SEGRETO = 32;

// §6.2b — Rotazione dual-key / multi-key zero-downtime.
//
// Problema: ogni volta che JWT_SECRET viene cambiato in produzione, tutti i token già
// emessi diventano istantaneamente invalidi e tutti gli utenti vengono disconnessi.
//
// Soluzione: `JWT_PREVIOUS_SECRETS` è una lista di segreti precedenti separati da
// virgola. `signJwt` firma sempre con il segreto corrente (primo della lista).
// `verifyJwt` prova in sequenza tutti i segreti: il token è valido se almeno uno
// passa la verifica. Quando tutti gli utenti si sono ri-autenticati (dopo un TTL di
// sessione completo), `JWT_PREVIOUS_SECRETS` può essere rimossa dall'env.
//
// Procedura di rotazione (vedi anche docs/rotazione_segreti.md):
//   1. Genera un nuovo segreto:
//      node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"
//   2. Su Railway: imposta JWT_SECRET=<NUOVO>, JWT_PREVIOUS_SECRETS=<VECCHIO>
//   3. Redeploy → i token vecchi restano validi durante il periodo di grazia.
//   4. Dopo DURATA_SESSIONE_OPERATORE_MINUTI (o al più dopo il TTL massimo): rimuovi JWT_PREVIOUS_SECRETS.
function risolviSegreti(): string[] {
  const corrente = process.env.JWT_SECRET;

  if (!corrente || corrente.length < LUNGHEZZA_MINIMA_SEGRETO) {
    if (process.env.NODE_ENV === 'production') {
      throw new Error(
        `JWT_SECRET mancante o più corto di ${LUNGHEZZA_MINIMA_SEGRETO} caratteri. ` +
          'Generane uno con: node -e "console.log(require(\'crypto\').randomBytes(32).toString(\'base64\'))"',
      );
    }
    if (corrente) {
      console.warn(
        `⚠️  JWT_SECRET più corto di ${LUNGHEZZA_MINIMA_SEGRETO} caratteri: accettato solo perché NODE_ENV non è production.`,
      );
      return [corrente];
    }
    // I token firmati con questo segreto non sopravvivono a un restart: è voluto.
    console.warn('⚠️  JWT_SECRET non impostato: uso un segreto casuale valido solo per questo processo.');
    return [crypto.randomBytes(32).toString('hex')];
  }

  // Segreti precedenti: separati da virgola, ignorati se vuoti.
  const precedenti = (process.env.JWT_PREVIOUS_SECRETS ?? '')
    .split(',')
    .map((s) => s.trim())
    .filter((s) => s.length >= LUNGHEZZA_MINIMA_SEGRETO);

  return [corrente, ...precedenti];
}

// Lista segreti: [corrente, ...precedenti]. Immutabile per il ciclo di vita del processo.
const JWT_SEGRETI = risolviSegreti();

export interface JwtPayload {
  userId: string;
  tenantId: string;
  email: string;
  ruolo: Ruolo;
  /** Versione persistita dell'identità: ogni incremento revoca questo token. */
  sessionVersion?: number;
  exp?: number;
  // Fase 3 FEA (misura 3) — certificato di sessione. `iat` è il momento del login, `sid`
  // l'id univoco della sessione: entrambi finiscono nel digest del sigillo di firma.
  // Additivi e opzionali: il login operatore non li porta, e i token già emessi senza
  // restano validi. `signJwt` li propaga con lo spread del payload.
  iat?: number;
  sid?: string;
  /**
   * §6.1 — marcatore del pre-token della fase 2FA. `pre_totp` = token emesso dopo la sola verifica
   * password, valido SOLO per completare lo step TOTP su `/auth/totp/verifica`. L'hook onRequest lo
   * rifiuta come sessione: senza questo marcatore un pre-token era usabile come token pieno (bypass 2FA).
   */
  scopo?: 'pre_totp';
}

export function signJwt(payload: Omit<JwtPayload, 'exp'>, expiresInMinutes = 60): string {
  const header = { alg: 'HS256', typ: 'JWT' };
  const exp = Math.floor(Date.now() / 1000) + expiresInMinutes * 60;
  const fullPayload: JwtPayload = { ...payload, exp };

  const base64Header = Buffer.from(JSON.stringify(header)).toString('base64url');
  const base64Payload = Buffer.from(JSON.stringify(fullPayload)).toString('base64url');

  // Firma sempre con il segreto corrente (primo della lista, §6.2b).
  const signature = crypto
    .createHmac('sha256', JWT_SEGRETI[0]!)
    .update(`${base64Header}.${base64Payload}`)
    .digest('base64url');

  return `${base64Header}.${base64Payload}.${signature}`;
}

export function verifyJwt(token: string): JwtPayload | null {
  try {
    const parts = token.split('.');
    if (parts.length !== 3) return null;

    const [base64Header, base64Payload, signature] = parts;
    if (!base64Header || !base64Payload || !signature) return null;

    // §6.2b — prova ogni segreto in ordine: corrente, poi precedenti.
    // Il primo che produce una firma valida vince. Se nessuno passa: null.
    // Confronto a tempo costante per evitare timing attack.
    const ricevuta = Buffer.from(signature, 'utf8');
    let payloadVerificato = false;
    for (const segreto of JWT_SEGRETI) {
      const expectedSignature = crypto
        .createHmac('sha256', segreto)
        .update(`${base64Header}.${base64Payload}`)
        .digest('base64url');
      const attesa = Buffer.from(expectedSignature, 'utf8');
      if (ricevuta.length === attesa.length && crypto.timingSafeEqual(ricevuta, attesa)) {
        payloadVerificato = true;
        break;
      }
    }
    if (!payloadVerificato) return null;

    const payload: JwtPayload = JSON.parse(Buffer.from(base64Payload, 'base64url').toString('utf8'));
    if (
      !payload ||
      typeof payload.userId !== 'string' ||
      typeof payload.tenantId !== 'string' ||
      typeof payload.email !== 'string' ||
      typeof payload.ruolo !== 'string'
    ) return null;
    if (payload.exp && Math.floor(Date.now() / 1000) > payload.exp) {
      return null; // Scaduto
    }

    return payload;
  } catch (err) {
    return null;
  }
}

export function generateMagicToken(clienteId: string): string {
  const randomBytes = crypto.randomBytes(16).toString('hex');
  return `client_${clienteId.substring(0, 8)}_${randomBytes}`;
}

/**
 * SHA-256 del magic token: è questo che finisce nella tabella `magic_link`, non il token.
 * Chi legge il database non deve poter entrare al posto del cliente.
 *
 * SHA-256 e non scrypt di proposito. scrypt è lento per difendere segreti *indovinabili*,
 * cioè le password scelte da una persona; qui il segreto lo genera `generateMagicToken`
 * con 16 byte da `crypto.randomBytes`, e non c'è dizionario che lo attacchi. Un hash lento
 * su ogni verifica del link sarebbe solo costo.
 */
export function hashMagicToken(token: string): string {
  return crypto.createHash('sha256').update(token).digest('hex');
}

/**
 * HMAC-SHA-256 del codice OTP, ed è questo che finisce in `codice_otp.codice_hash`.
 *
 * Qui il ragionamento è l'opposto di `hashMagicToken`: il magic token ha 128 bit di
 * entropia e un hash veloce basta, l'OTP ne ha sei cifre — un milione di possibilità,
 * che una tabella precalcolata di SHA-256 esaurisce in un istante. Con l'HMAC il
 * database da solo non è sufficiente: senza `JWT_SECRET`, che vive in ambiente e non
 * in tabella, i digest non si possono ricostruire.
 *
 * L'etichetta `otp:` separa il dominio: lo stesso segreto firma i JWT di sessione e gli
 * URL di download, e nessuno dei tre deve poter produrre un valore valido per un altro.
 *
 * `clienteId` entra nel messaggio perché due clienti possono ricevere lo stesso codice
 * nello stesso minuto: legandolo al destinatario, un digest intercettato non è
 * riutilizzabile su un'altra riga.
 */
export function hashCodiceOtp(codice: string, clienteId: string): string {
  return crypto.createHmac('sha256', JWT_SEGRETI[0]!).update(`otp:${clienteId}:${codice}`).digest('hex');
}

/** Confronto a tempo costante fra il codice digitato e il digest in tabella. */
export function verificaCodiceOtp(codice: string, clienteId: string, hashAtteso: string): boolean {
  const calcolato = Buffer.from(hashCodiceOtp(codice, clienteId), 'utf8');
  const atteso = Buffer.from(hashAtteso, 'utf8');
  if (calcolato.length !== atteso.length) return false;
  return crypto.timingSafeEqual(calcolato, atteso);
}

// ─── Firma dei download (§Sicurezza) ─────────────────────────────────────────────
// `GET /uploads/:filename` non può pretendere l'header Authorization: quegli URL finiscono
// in `<img src>` — il logo dello studio nella sidebar, nelle fatture, dentro l'HTML delle
// PDF di stampa — e in link diretti agli allegati. Nessuno di questi può inviare un header.
// La prova di titolo viaggia quindi in query string, firmata con lo stesso segreto dei JWT.
//
// Scadenza lunga (7 giorni) perché `logoUrl` viene messo in cache nel `localStorage` del
// browser: con una TTL da un'ora il logo si romperebbe da solo a metà sessione.
const TTL_FIRMA_DOWNLOAD_SECONDI = 7 * 24 * 60 * 60;

function calcolaFirmaDownload(filename: string, scadenza: number): string {
  return crypto.createHmac('sha256', JWT_SEGRETI[0]!).update(`${filename}|${scadenza}`).digest('hex');
}

/** Firma e scadenza da appendere all'URL di un file servito da `/uploads/`. */
export function firmaDownload(filename: string): { firma: string; scad: number } {
  const scad = Math.floor(Date.now() / 1000) + TTL_FIRMA_DOWNLOAD_SECONDI;
  return { firma: calcolaFirmaDownload(filename, scad), scad };
}

export function verificaFirmaDownload(filename: string, firma?: string, scad?: string): boolean {
  if (!firma || !scad) return false;

  const scadenza = Number(scad);
  if (!Number.isInteger(scadenza) || Math.floor(Date.now() / 1000) > scadenza) return false;

  const attesa = calcolaFirmaDownload(filename, scadenza);
  const ricevuta = Buffer.from(firma, 'utf8');
  const corretta = Buffer.from(attesa, 'utf8');
  // `timingSafeEqual` pretende buffer di pari lunghezza: il confronto va fatto prima, ed è
  // informazione che l'attaccante ha già (la lunghezza di un HMAC-SHA256 è nota).
  if (ricevuta.length !== corretta.length) return false;

  return crypto.timingSafeEqual(ricevuta, corretta);
}
