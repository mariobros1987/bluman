import { describe, expect, it } from 'vitest';
import {
  indirizzoVietato,
  risolviEndpointPubblico,
  validaCartellaImap,
  validaEmail,
  validaHost,
  validaPorta,
  validaServername,
  vietaControlli,
} from './util/networkPolicy.js';

describe('policy rete SMTP/IMAP', () => {
  it('valida host, servername, porte, email e cartella', () => {
    expect(validaHost(' SMTP.Example.COM. ')).toBe('smtp.example.com');
    expect(validaServername('mail.example.com')).toBe('mail.example.com');
    expect(validaPorta('993')).toBe(993);
    expect(validaEmail('User@Example.COM')).toBe('User@example.com');
    expect(validaCartellaImap('Archive/2026')).toBe('Archive/2026');
  });

  it('rifiuta schemi, userinfo, porte fuori range, email e CRLF', () => {
    expect(() => validaHost('https://smtp.example.com')).toThrow(/Host non valido/i);
    expect(() => validaHost('user@smtp.example.com')).toThrow(/Host non valido/i);
    expect(() => validaServername('127.0.0.1')).toThrow(/nome DNS/i);
    expect(() => validaPorta(0)).toThrow(/tra 1 e 65535/i);
    expect(() => validaPorta(65536)).toThrow(/tra 1 e 65535/i);
    expect(() => validaPorta(993.5)).toThrow(/intero/i);
    expect(() => validaEmail('non-email')).toThrow(/non valida/i);
    expect(() => validaCartellaImap('INBOX\r\nA3 LOGOUT')).toThrow(/controllo/i);
    expect(() => vietaControlli('utente\r\nA1 NOOP', 'Utenza')).toThrow(/controllo/i);
  });

  it.each([
    '0.0.0.0', '10.0.0.1', '127.0.0.1', '169.254.169.254', '172.16.0.1',
    '192.168.1.1', '224.0.0.1', '255.255.255.255', '::', '::1', 'fc00::1',
    'fe80::1', 'ff02::1', '2001:db8::1', '::ffff:127.0.0.1',
  ])('blocca indirizzo riservato %s', address => {
    expect(indirizzoVietato(address)).toBe(true);
  });

  it('accetta indirizzi pubblici', () => {
    expect(indirizzoVietato('8.8.8.8')).toBe(false);
    expect(indirizzoVietato('2606:4700:4700::1111')).toBe(false);
  });

  it('rifiuta il dominio metadata prima della risoluzione', async () => {
    await expect(risolviEndpointPubblico('metadata.google.internal')).rejects.toThrow(/metadata|locale/i);
  });

  it('rifiuta se uno qualsiasi degli indirizzi DNS è privato', async () => {
    const resolver = async () => [
      { address: '8.8.8.8', family: 4 },
      { address: '10.0.0.1', family: 4 },
    ];
    await expect(risolviEndpointPubblico('mail.example.com', undefined, resolver)).rejects.toThrow(/non pubblico/i);
  });

  it('fissa un IP pubblico e conserva il nome per TLS, impedendo una seconda risoluzione', async () => {
    let chiamate = 0;
    const resolver = async () => {
      chiamate++;
      return [{ address: '203.1.2.3', family: 4 }];
    };
    await expect(risolviEndpointPubblico('mail.example.com', 'cert.example.com', resolver)).resolves.toEqual({
      host: 'mail.example.com',
      address: '203.1.2.3',
      family: 4,
      servername: 'cert.example.com',
    });
    expect(chiamate).toBe(1);
  });
});
