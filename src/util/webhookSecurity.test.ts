import { createHmac } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import {
  creaSegretoTelegram,
  normalizzaTelefono,
  tenantIdDaSegretoTelegram,
  verificaFirmaWhatsapp,
  verificaSegretoTelegram,
} from './webhookSecurity.js';

const TENANT = '00000000-0000-4000-8000-000000000001';

describe('sicurezza webhook WhatsApp', () => {
  const raw = Buffer.from('{"entry":[{"id":"1"}]}');

  it('rifiuta quando WA_APP_SECRET manca', () => {
    expect(verificaFirmaWhatsapp(raw, 'sha256=00', undefined)).toBe('secret_missing');
  });

  it('verifica la firma sul raw body originale e rifiuta payload alterati', () => {
    const firma = `sha256=${createHmac('sha256', 'app-secret').update(raw).digest('hex')}`;
    expect(verificaFirmaWhatsapp(raw, firma, 'app-secret')).toBe('ok');
    expect(verificaFirmaWhatsapp(Buffer.from('{"entry": []}'), firma, 'app-secret')).toBe('invalid');
    expect(verificaFirmaWhatsapp(raw, undefined, 'app-secret')).toBe('invalid');
  });
});

describe('sicurezza webhook Telegram', () => {
  it('lega il secret al tenant e al bot senza persisterlo in chiaro', () => {
    const secret = creaSegretoTelegram(TENANT, '12345:token-lungo-valido', 'master');
    expect(tenantIdDaSegretoTelegram(secret)).toBe(TENANT);
    expect(verificaSegretoTelegram(secret, TENANT, '12345:token-lungo-valido', 'master')).toBe('ok');
    expect(verificaSegretoTelegram(secret, TENANT, '12345:altro-token', 'master')).toBe('invalid');
    expect(verificaSegretoTelegram(secret, TENANT, '12345:token-lungo-valido', undefined)).toBe('secret_missing');
  });

  it('rifiuta secret malformati e tenant sconosciuti prima del lookup', () => {
    expect(tenantIdDaSegretoTelegram(undefined)).toBeNull();
    expect(tenantIdDaSegretoTelegram('tenant:secret')).toBeNull();
  });
});

describe('matching mittente WhatsApp', () => {
  it('normalizza soltanto equivalenze certe senza matching parziale', () => {
    expect(normalizzaTelefono('+39 335 123 4567')).toBe('393351234567');
    expect(normalizzaTelefono('0039 335 123 4567')).toBe('393351234567');
    expect(normalizzaTelefono('3351234567')).toBe('393351234567');
    expect(normalizzaTelefono('123')).toBeNull();
  });
});
