// Cifratura del canale protetto: ciò che conta è che il dato a riposo non sia leggibile, che si
// riapra solo nel suo studio e nella sua pratica, e che senza chiave nessuno finga un lucchetto.
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  ErroreCifratura,
  cifraFile,
  cifraTesto,
  decifraFile,
  decifraTesto,
  eTestoCifrato,
  statoCifratura,
} from './cifraturaCanale.js';

const CHIAVE = 'chiave-di-prova-del-canale-protetto-0001';
const ALTRA = 'chiave-di-prova-del-canale-protetto-0002';
const STUDIO = '00000000-0000-0000-0000-000000000001';
const ALTRO_STUDIO = '00000000-0000-0000-0000-000000000002';

const SEGRETO_TOKEN = 'segreto-dei-token-di-prova-lungo-abbastanza-01';
const SEGRETO_TOKEN_NUOVO = 'segreto-dei-token-di-prova-lungo-abbastanza-02';

const VARIABILI = ['CANALE_PROTETTO_CHIAVE', 'CANALE_PROTETTO_CHIAVI_PRECEDENTI', 'JWT_SECRET', 'JWT_PREVIOUS_SECRETS'] as const;
const prima = Object.fromEntries(VARIABILI.map((nome) => [nome, process.env[nome]]));

beforeEach(() => {
  for (const nome of VARIABILI) delete process.env[nome];
  process.env.CANALE_PROTETTO_CHIAVE = CHIAVE;
});

afterEach(() => {
  for (const nome of VARIABILI) {
    if (prima[nome] === undefined) delete process.env[nome];
    else process.env[nome] = prima[nome];
  }
});

describe('testo', () => {
  it('a riposo non contiene il messaggio, e si riapre uguale', () => {
    const chiaro = 'IBAN IT60X0542811101000000123456 — è riservato';
    const cifrato = cifraTesto(STUDIO, 'msg:p-1', chiaro);
    expect(eTestoCifrato(cifrato)).toBe(true);
    expect(cifrato).not.toContain('IBAN');
    expect(decifraTesto(STUDIO, 'msg:p-1', cifrato)).toBe(chiaro);
  });

  it('lo stesso messaggio cifrato due volte dà due testi diversi', () => {
    expect(cifraTesto(STUDIO, 'msg:p-1', 'ciao')).not.toBe(cifraTesto(STUDIO, 'msg:p-1', 'ciao'));
  });

  it('non si apre in un altro studio né su un’altra pratica', () => {
    const cifrato = cifraTesto(STUDIO, 'msg:p-1', 'riservato');
    expect(() => decifraTesto(ALTRO_STUDIO, 'msg:p-1', cifrato)).toThrow(ErroreCifratura);
    expect(() => decifraTesto(STUDIO, 'msg:p-2', cifrato)).toThrow(ErroreCifratura);
  });

  it('un testo alterato non si apre', () => {
    const cifrato = cifraTesto(STUDIO, 'msg:p-1', 'riservato');
    const alterato = cifrato.slice(0, -2) + (cifrato.endsWith('AA') ? 'BB' : 'AA');
    expect(() => decifraTesto(STUDIO, 'msg:p-1', alterato)).toThrow(ErroreCifratura);
  });

  it('un messaggio scritto prima della cifratura resta leggibile', () => {
    expect(decifraTesto(STUDIO, 'msg:p-1', 'Buongiorno, allego la visura.')).toBe('Buongiorno, allego la visura.');
  });
});

describe('chiave', () => {
  it('senza chiave non cifra e lo dichiara', () => {
    delete process.env.CANALE_PROTETTO_CHIAVE;
    expect(statoCifratura()).toEqual({ attiva: false, errore: null });
    expect(cifraTesto(STUDIO, 'msg:p-1', 'in chiaro')).toBe('in chiaro');
    expect(cifraFile(STUDIO, 'file:p-1', Buffer.from('pdf'))).toEqual({ contenuto: Buffer.from('pdf'), cifrato: false });
  });

  it('con una chiave troppo corta rifiuta di scrivere, invece di salvare in chiaro', () => {
    process.env.CANALE_PROTETTO_CHIAVE = 'corta';
    expect(statoCifratura().attiva).toBe(false);
    expect(statoCifratura().errore).toMatch(/più corta/);
    expect(() => cifraTesto(STUDIO, 'msg:p-1', 'riservato')).toThrow(ErroreCifratura);
    expect(() => cifraFile(STUDIO, 'file:p-1', Buffer.from('pdf'))).toThrow(ErroreCifratura);
  });

  it('dopo il cambio di chiave i messaggi vecchi si leggono se la precedente resta in elenco', () => {
    const vecchio = cifraTesto(STUDIO, 'msg:p-1', 'scritto con la chiave vecchia');
    process.env.CANALE_PROTETTO_CHIAVE = ALTRA;
    expect(() => decifraTesto(STUDIO, 'msg:p-1', vecchio)).toThrow(/non è configurata/);

    process.env.CANALE_PROTETTO_CHIAVI_PRECEDENTI = CHIAVE;
    expect(decifraTesto(STUDIO, 'msg:p-1', vecchio)).toBe('scritto con la chiave vecchia');
    // I messaggi nuovi usano la chiave nuova.
    const nuovo = cifraTesto(STUDIO, 'msg:p-1', 'nuovo');
    expect(nuovo.split('.')[1]).not.toBe(vecchio.split('.')[1]);
  });
});

describe('senza chiave dedicata', () => {
  beforeEach(() => {
    delete process.env.CANALE_PROTETTO_CHIAVE;
    process.env.JWT_SECRET = SEGRETO_TOKEN;
  });

  it('cifra con il segreto dei token: in produzione il canale è protetto dal primo giorno', () => {
    expect(statoCifratura()).toEqual({ attiva: true, errore: null });
    const cifrato = cifraTesto(STUDIO, 'msg:p-1', 'riservato');
    expect(eTestoCifrato(cifrato)).toBe(true);
    expect(decifraTesto(STUDIO, 'msg:p-1', cifrato)).toBe('riservato');
  });

  it('un segreto dei token corto non fa da chiave: resta in chiaro e lo dichiara', () => {
    process.env.JWT_SECRET = 'corto';
    expect(statoCifratura()).toEqual({ attiva: false, errore: null });
    expect(cifraTesto(STUDIO, 'msg:p-1', 'in chiaro')).toBe('in chiaro');
  });

  it('quando arriva la chiave dedicata, i messaggi scritti prima si leggono ancora', () => {
    const vecchio = cifraTesto(STUDIO, 'msg:p-1', 'scritto col segreto dei token');
    process.env.CANALE_PROTETTO_CHIAVE = CHIAVE;
    expect(decifraTesto(STUDIO, 'msg:p-1', vecchio)).toBe('scritto col segreto dei token');
    expect(cifraTesto(STUDIO, 'msg:p-1', 'nuovo').split('.')[1]).not.toBe(vecchio.split('.')[1]);
  });

  it('dopo il cambio del segreto dei token si legge finché il vecchio resta fra le chiavi precedenti', () => {
    const vecchio = cifraTesto(STUDIO, 'msg:p-1', 'scritto prima del cambio');

    // Il giorno del cambio: il vecchio sta fra i segreti precedenti dei token.
    process.env.JWT_SECRET = SEGRETO_TOKEN_NUOVO;
    process.env.JWT_PREVIOUS_SECRETS = SEGRETO_TOKEN;
    expect(decifraTesto(STUDIO, 'msg:p-1', vecchio)).toBe('scritto prima del cambio');

    // Un giorno dopo quell'elenco si svuota: senza altro i messaggi non si aprono, e lo si dice.
    delete process.env.JWT_PREVIOUS_SECRETS;
    expect(() => decifraTesto(STUDIO, 'msg:p-1', vecchio)).toThrow(/non è configurata/);

    // Il rimedio è tenerlo fra le chiavi precedenti del canale.
    process.env.CANALE_PROTETTO_CHIAVI_PRECEDENTI = SEGRETO_TOKEN;
    expect(decifraTesto(STUDIO, 'msg:p-1', vecchio)).toBe('scritto prima del cambio');
  });

  it('l’impronta scritta accanto al messaggio non è un pezzo dell’hash del segreto', async () => {
    const { createHash } = await import('node:crypto');
    const impronta = cifraTesto(STUDIO, 'msg:p-1', 'x').split('.')[1];
    expect(impronta).not.toBe(createHash('sha256').update(SEGRETO_TOKEN).digest('hex').slice(0, 8));
  });
});

describe('file', () => {
  it('il file a riposo non contiene il contenuto, e si riapre uguale', () => {
    const chiaro = Buffer.from('%PDF-1.7 contenuto riservato del cliente');
    const { contenuto, cifrato } = cifraFile(STUDIO, 'file:p-1', chiaro);
    expect(cifrato).toBe(true);
    expect(contenuto.includes(Buffer.from('riservato'))).toBe(false);
    expect(decifraFile(STUDIO, 'file:p-1', contenuto).equals(chiaro)).toBe(true);
  });

  it('non si apre in un altro studio, e un file senza testata si rifiuta', () => {
    const { contenuto } = cifraFile(STUDIO, 'file:p-1', Buffer.from('riservato'));
    expect(() => decifraFile(ALTRO_STUDIO, 'file:p-1', contenuto)).toThrow(ErroreCifratura);
    expect(() => decifraFile(STUDIO, 'file:p-1', Buffer.from('non è un file protetto, è troppo normale'))).toThrow(/forma/);
  });
});
