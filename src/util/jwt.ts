import crypto from 'crypto';

const JWT_SECRET = process.env.JWT_SECRET || 'bluman_advisory_jwt_secret_key_2026';

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
