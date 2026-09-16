/**
 * Recapiti del cliente per la consegna del codice OTP.
 *
 * Il guasto che questi test presidiano: l'email del cliente sta o nella colonna `cliente.email`
 * o nella chiave `email` di `referentiJson`, e il portale leggeva solo la prima. Con l'indirizzo
 * scritto nella scheda cliente, la richiesta del codice via email si fermava su «Nessuna email
 * in anagrafica» senza tentare nessun invio — con le impostazioni SMTP corrette e il test di
 * posta funzionante.
 */
import { describe, it, expect } from 'vitest';
import { recapitiCliente, canaliDisponibili, type CredenzialiCanali } from './otpDispatch';

const credenzialiComplete: CredenzialiCanali = {
  waPhoneId: '123',
  waAccessToken: 'token',
  waOtpTemplate: 'codice_accesso',
  waOtpTemplateLang: 'it',
  tgBotToken: 'bot',
  tgBotUsername: 'studio_bot',
  smtp: { host: 'authsmtp.register.it', port: 465, secure: true, user: 'studio@example.com', pass: 'x' },
  smtpFromEmail: 'studio@example.com',
  smtpFromName: 'Studio',
};

describe('recapitiCliente', () => {
  it('preferisce le colonne quando ci sono', () => {
    const r = recapitiCliente({
      email: 'colonna@example.com',
      cellulare: '+39 333 1111111',
      telegramChatId: '555',
      referentiJson: { email: 'json@example.com', cellulare: '+39 333 2222222' },
    });
    expect(r.email).toBe('colonna@example.com');
    expect(r.cellulare).toBe('+39 333 1111111');
    expect(r.telegramChatId).toBe('555');
  });

  it('ricade sul referentiJson quando le colonne sono vuote', () => {
    const r = recapitiCliente({
      email: null,
      cellulare: null,
      referentiJson: { email: 'json@example.com', whatsapp: '+39 333 2222222' },
    });
    expect(r.email).toBe('json@example.com');
    expect(r.cellulare).toBe('+39 333 2222222');
  });

  it('tratta la stringa vuota e i soli spazi come recapito assente', () => {
    const r = recapitiCliente({ email: '   ', cellulare: '', referentiJson: { email: '  ' } });
    expect(r.email).toBeNull();
    expect(r.cellulare).toBeNull();
  });

  it('non usa il telefono come numero WhatsApp: un fisso non riceve messaggi', () => {
    const r = recapitiCliente({ cellulare: null, referentiJson: { telefono: '+39 02 1234567' } });
    expect(r.cellulare).toBeNull();
  });

  it('sopporta un referentiJson che non è un oggetto', () => {
    expect(recapitiCliente({ email: 'a@b.it', referentiJson: 'stringa' }).email).toBe('a@b.it');
    expect(recapitiCliente({ referentiJson: null }).email).toBeNull();
    expect(recapitiCliente({ referentiJson: ['x'] }).cellulare).toBeNull();
  });

  it('rende disponibile il canale email quando l\'indirizzo è solo nel referentiJson', () => {
    const cliente = { email: null, cellulare: null, telegramChatId: null, referentiJson: { email: 'json@example.com' } };
    const primaDelRipiego = canaliDisponibili(credenzialiComplete, cliente);
    expect(primaDelRipiego.find(c => c.canale === 'email')?.disponibile).toBe(false);

    const conRipiego = canaliDisponibili(credenzialiComplete, recapitiCliente(cliente));
    expect(conRipiego.find(c => c.canale === 'email')?.disponibile).toBe(true);
  });
});
