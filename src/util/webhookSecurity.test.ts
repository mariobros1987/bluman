import { createHmac } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import {
  creaPayloadCollegamento,
  creaSegretoTelegram,
  normalizzaTelefono,
  progettoIdDaPayloadCollegamento,
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

/**
 * Il payload del link per progetto.
 *
 * Tre proprietà contano più delle altre. La **lunghezza**: Telegram accetta al massimo 64 caratteri
 * in `?start=`, e un payload più lungo verrebbe rifiutato dal provider senza dire perché — il link
 * semplicemente non funzionerebbe. La **non spendibilità altrove**: il MAC copre tenant e progetto,
 * quindi il link di uno studio non vale per un altro. E la **forma**: solo `A-Za-z0-9_-`, perché
 * Telegram scarta il resto.
 */
describe('payload del link per progetto (deep link Telegram)', () => {
  const PROGETTO = '00000000-0000-4000-8000-0000000000a1';
  const ALTRO_PROGETTO = '00000000-0000-4000-8000-0000000000a2';
  const ALTRO_TENANT = '00000000-0000-4000-8000-0000000000ff';
  const MASTER = 'master-secret-di-prova';

  it('sopravvive al viaggio di andata e ritorno', () => {
    const payload = creaPayloadCollegamento(TENANT, PROGETTO, MASTER);
    expect(progettoIdDaPayloadCollegamento(payload, TENANT, MASTER)).toBe(PROGETTO);
  });

  it('resta entro i 64 caratteri che Telegram accetta, e usa solo il suo alfabeto', () => {
    const payload = creaPayloadCollegamento(TENANT, PROGETTO, MASTER);
    expect(payload.length).toBeLessThanOrEqual(64);
    expect(payload).toMatch(/^[A-Za-z0-9_-]+$/);
  });

  it('un MAC manomesso non scioglie il payload', () => {
    const payload = creaPayloadCollegamento(TENANT, PROGETTO, MASTER);
    // Due parti, garantite da `creaPayloadCollegamento`: l'asserzione serve solo a `tsc`.
    const [compatto, mac] = payload.split('_') as [string, string];
    // Un carattere diverso in modo deterministico: sostituire l'ultimo con una lettera fissa
    // lascerebbe il payload intatto una volta su sessantaquattro.
    const manomesso = `${compatto}_${mac[0] === 'A' ? 'B' : 'A'}${mac.slice(1)}`;
    expect(progettoIdDaPayloadCollegamento(manomesso, TENANT, MASTER)).toBeNull();
  });

  it("il progetto di un altro studio non si scioglie, nemmeno con lo stesso master secret", () => {
    const payload = creaPayloadCollegamento(ALTRO_TENANT, PROGETTO, MASTER);
    expect(progettoIdDaPayloadCollegamento(payload, TENANT, MASTER)).toBeNull();
  });

  it('un payload di un altro progetto non si riusa scambiando la parte leggibile', () => {
    const mio = creaPayloadCollegamento(TENANT, PROGETTO, MASTER);
    const [mioCompatto, mioMac] = mio.split('_');
    const altrui = creaPayloadCollegamento(TENANT, ALTRO_PROGETTO, MASTER);
    const [altruiCompatto] = altrui.split('_');
    // L'UUID è in chiaro nel payload: chi lo legge può sostituirlo. Il MAC lo copre, quindi il
    // risultato non è spendibile — è questo che rende il payload una capacità e non un permesso.
    expect(progettoIdDaPayloadCollegamento(`${altruiCompatto}_${mioMac}`, TENANT, MASTER)).toBeNull();
    expect(mioCompatto).not.toBe(altruiCompatto);
  });

  it('un MAC di lunghezza diversa non fa lanciare il confronto', () => {
    const payload = creaPayloadCollegamento(TENANT, PROGETTO, MASTER);
    const [compatto] = payload.split('_');
    // `timingSafeEqual` lancia su buffer di lunghezza diversa: la forma si valida prima.
    expect(progettoIdDaPayloadCollegamento(`${compatto}_${'A'.repeat(21)}`, TENANT, MASTER)).toBeNull();
    expect(progettoIdDaPayloadCollegamento(`${compatto}_${'A'.repeat(23)}`, TENANT, MASTER)).toBeNull();
  });

  it('senza master secret, o con valori non testuali, risponde null invece di lanciare', () => {
    const payload = creaPayloadCollegamento(TENANT, PROGETTO, MASTER);
    expect(progettoIdDaPayloadCollegamento(payload, TENANT, undefined)).toBeNull();
    expect(progettoIdDaPayloadCollegamento(undefined, TENANT, MASTER)).toBeNull();
    expect(progettoIdDaPayloadCollegamento('', TENANT, MASTER)).toBeNull();
    expect(progettoIdDaPayloadCollegamento('/start', TENANT, MASTER)).toBeNull();
  });

  it('rifiuta di firmare un payload su valori che non sono UUID', () => {
    // Meglio non generare il link che generarne uno che il webhook non saprà sciogliere.
    expect(() => creaPayloadCollegamento('non-un-uuid', PROGETTO, MASTER)).toThrow();
    expect(() => creaPayloadCollegamento(TENANT, 'proj-123', MASTER)).toThrow();
  });

  it('lo stesso progetto scritto con o senza trattini produce lo stesso payload', () => {
    const compatto = creaPayloadCollegamento(TENANT, PROGETTO, MASTER).split('_')[0];
    expect(creaPayloadCollegamento(TENANT.replaceAll('-', ''), PROGETTO.replaceAll('-', ''), MASTER))
      .toBe(creaPayloadCollegamento(TENANT, PROGETTO, MASTER));
    expect(compatto).toHaveLength(32);
  });
});
