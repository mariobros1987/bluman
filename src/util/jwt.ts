import crypto from 'crypto';

const LUNGHEZZA_MINIMA_SEGRETO = 32;

// §23 — il segreto di firma non ha mai un valore di default: un fallback hardcoded nel
// repo equivale a nessuna autenticazione, perché chiunque legga il codice può forgiare
// un token con qualunque tenantId e ruolo. In produzione l'assenza è un errore fatale;
// in sviluppo si usa un segreto casuale valido solo per il processo corrente.
function risolviSegreto(): string {
  const daEnv = process.env.JWT_SECRET;

  if (daEnv && daEnv.length >= LUNGHEZZA_MINIMA_SEGRETO) return daEnv;

  if (process.env.NODE_ENV === 'production') {
    throw new Error(
      `JWT_SECRET mancante o più corto di ${LUNGHEZZA_MINIMA_SEGRETO} caratteri. ` +
        'Generane uno con: node -e "console.log(require(\'crypto\').randomBytes(32).toString(\'base64\'))"',
    );
  }

  if (daEnv) {
    console.warn(
      `⚠️  JWT_SECRET più corto di ${LUNGHEZZA_MINIMA_SEGRETO} caratteri: accettato solo perché NODE_ENV non è production.`,
    );
    return daEnv;
  }

  // I token firmati con questo segreto non sopravvivono a un restart: è voluto —
  // un logout in sviluppo costa meno di un segreto noto committato nel repo.
  console.warn('⚠️  JWT_SECRET non impostato: uso un segreto casuale valido solo per questo processo.');
  return crypto.randomBytes(32).toString('hex');
}

const JWT_SECRET = risolviSegreto();

export interface JwtPayload {
  userId: string;
  tenantId: string;
  email: string;
  ruolo: 'super_admin' | 'advisor' | 'collaboratore_interno' | 'collaboratore_esterno' | 'cliente';
  exp?: number;
}

export function signJwt(payload: Omit<JwtPayload, 'exp'>, expiresInMinutes = 60): string {
  const header = { alg: 'HS256', typ: 'JWT' };
  const exp = Math.floor(Date.now() / 1000) + expiresInMinutes * 60;
  const fullPayload: JwtPayload = { ...payload, exp };

  const base64Header = Buffer.from(JSON.stringify(header)).toString('base64url');
  const base64Payload = Buffer.from(JSON.stringify(fullPayload)).toString('base64url');

  const signature = crypto
    .createHmac('sha256', JWT_SECRET)
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

    const expectedSignature = crypto
      .createHmac('sha256', JWT_SECRET)
      .update(`${base64Header}.${base64Payload}`)
      .digest('base64url');

    if (signature !== expectedSignature) return null;

    const payload: JwtPayload = JSON.parse(Buffer.from(base64Payload, 'base64url').toString('utf8'));
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
