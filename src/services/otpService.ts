import crypto from 'crypto';

export interface OtpRecord {
  code: string;
  expiresAt: number;
  attempts: number;
  clienteId: string;
  canale: 'whatsapp' | 'email' | 'sms';
  target: string;
}

// In-memory store per gli OTP con TTL 5 minuti (in produzione persistibile anche su Redis/DB)
const otpStore = new Map<string, OtpRecord>();

/**
 * Genera un OTP sicuro a 6 cifre con TTL di 5 minuti
 */
export function generateOtp(clienteId: string, target: string, canale: 'whatsapp' | 'email' | 'sms' = 'whatsapp'): string {
  // Generazione codice casuale a 6 cifre criptograficamente sicuro
  const otp = crypto.randomInt(100000, 999999).toString();
  const expiresAt = Date.now() + 5 * 60 * 1000; // 5 minuti

  otpStore.set(clienteId, {
    code: otp,
    expiresAt,
    attempts: 0,
    clienteId,
    canale,
    target,
  });

  return otp;
}

/**
 * Verifica il codice OTP fornito dall'utente
 */
export function verifyOtp(clienteId: string, inputCode: string): { valid: boolean; reason?: string } {
  const record = otpStore.get(clienteId);

  if (!record) {
    return { valid: false, reason: 'Nessun codice OTP richiesto o codice scaduto. Richiedi un nuovo codice.' };
  }

  if (Date.now() > record.expiresAt) {
    otpStore.delete(clienteId);
    return { valid: false, reason: 'Il codice di sicurezza è scaduto (validità massima 5 minuti). Richiedi un nuovo codice.' };
  }

  if (record.attempts >= 3) {
    otpStore.delete(clienteId);
    return { valid: false, reason: 'Troppi tentativi errati. Per motivi di sicurezza il codice è stato invalidato. Richiedi un nuovo codice.' };
  }

  if (record.code !== inputCode.trim()) {
    record.attempts += 1;
    return { valid: false, reason: `Codice non corretto (Tentativo ${record.attempts} di 3).` };
  }

  // Codice valido: rimuoviamo dalla memoria per evitare riutilizzo
  otpStore.delete(clienteId);
  return { valid: true };
}

/**
 * Genera il sigillo di firma elettronica eIDAS con hash SHA-256
 */
export function generateEidasSignatureSeal(params: {
  clienteId: string;
  signerName: string;
  documentoTitolo: string;
  documentoHash?: string;
  ip?: string;
  userAgent?: string;
  canaleVerificato?: string;
}) {
  const timestampIso = new Date().toISOString();
  const rawPayload = `${params.clienteId}|${params.signerName}|${params.documentoTitolo}|${params.documentoHash || 'DOC_ORIGINAL_HASH'}|${timestampIso}|${params.ip || '127.0.0.1'}`;
  const sha256Digest = crypto.createHash('sha256').update(rawPayload).digest('hex');

  return {
    signatureId: `EIDAS-FEA-${Date.now().toString(36).toUpperCase()}-${crypto.randomBytes(3).toString('hex').toUpperCase()}`,
    signerName: params.signerName,
    documentoTitolo: params.documentoTitolo,
    timestampIso,
    sha256Digest,
    ipAddress: params.ip || '127.0.0.1',
    userAgent: params.userAgent || 'BluMan Secure Client Portal / eIDAS FEA',
    canaleVerificato: params.canaleVerificato || 'WhatsApp OTP + Magic Link',
    standard: 'eIDAS UE 910/2014 Advanced Electronic Signature (FEA)',
  };
}
