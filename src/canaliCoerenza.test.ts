/**
 * I canali di comunicazione sono descritti in più punti — l'elenco del servizio, i due
 * validatori, lo schema zod, il form dell'anagrafica — e ognuno di quei punti è una copia.
 *
 * Questa suite esiste perché una copia è già andata fuori sincrono: quando Signal è
 * diventato un canale vero, `CANALI_OTP` è cresciuto a quattro voci e
 * `serverHelpers.canaleOtpValido` è rimasto a tre. L'effetto non era un errore visibile ma
 * un silenzio: il canale preferito di un cliente non poteva essere Signal, la firma lo
 * offriva nel selettore e l'anagrafica lo scartava senza dirlo.
 *
 * Il rimedio è che l'elenco viva in un posto solo (`otpService.CANALI_OTP`) e che gli altri
 * lo seguano. Qui si verifica che lo seguano davvero.
 */
import { describe, it, expect } from 'vitest';
import { CANALI_OTP, canaleValido } from './services/otpService';
import { canaleOtpValido } from './util/serverHelpers';
import { CreaClienteSchema } from './schemas/clienti.schema';

/** Gli stessi nomi che l'elenco del servizio deve contenere: uno per uno, scritti a mano. */
const CANALI_ATTESI = ['whatsapp', 'email', 'telegram', 'signal'] as const;

describe('Coerenza dell’elenco dei canali di comunicazione', () => {
  it('l’elenco del servizio è esattamente quello che il server sa spedire', () => {
    // Non `length === 4`: se un domani si aggiunge un canale, questo test deve cadere
    // perché qualcuno lo aggiorni qui, non perché il numero è cambiato.
    expect([...CANALI_OTP].sort()).toEqual([...CANALI_ATTESI].sort());
    // `sms` è il caso che l'elenco esiste per escludere: nessun provider lo spedisce.
    expect(CANALI_OTP).not.toContain('sms');
  });

  it('i due validatori concordano, canale per canale', () => {
    for (const canale of CANALI_ATTESI) {
      expect(canaleValido(canale), `${canale} deve essere valido per otpService`).toBe(true);
      expect(canaleOtpValido(canale), `${canale} deve essere valido anche per le rotte clienti`).toBe(true);
    }
    for (const rifiutato of ['sms', '', 'SIGNAL', 'Signal', 'telegram ', 'whatsapp ', 'push', 42, null, undefined, {}]) {
      expect(canaleValido(rifiutato), `${String(rifiutato)} non è un canale`).toBe(false);
      expect(canaleOtpValido(rifiutato), `${String(rifiutato)} non è un canale`).toBe(false);
    }
  });

  it('lo schema dell’anagrafica accetta ogni canale dell’elenco e nessun altro', () => {
    const base = { nome: 'Cliente di Prova', tipo: 'company' as const };
    for (const canale of CANALI_ATTESI) {
      const esito = CreaClienteSchema.safeParse({ ...base, canaleOtpPreferito: canale });
      expect(esito.success, `lo schema deve accettare ${canale}`).toBe(true);
    }
    // Se un canale nuovo entra in `CANALI_OTP` senza entrare nello schema, la rotta risponde
    // 400 «Dati cliente non validi» e l'operatore non capisce perché.
    expect(CreaClienteSchema.safeParse({ ...base, canaleOtpPreferito: 'sms' }).success).toBe(false);
    expect(CreaClienteSchema.safeParse({ ...base, canaleOtpPreferito: '' }).success).toBe(false);
  });

  it('l’anagrafica accetta la chat id Telegram come campo dichiarato', () => {
    // `passthrough()` fa passare anche le chiavi non dichiarate, quindi questo test non
    // difende dal 400: difende dal fatto che il campo sparisca dallo schema e che
    // `telegramChatId` torni a essere una chiave che nessuno dichiara e nessuno scrive.
    const esito = CreaClienteSchema.safeParse({
      nome: 'Cliente di Prova',
      tipo: 'company',
      telegramChatId: '123456789',
    });
    expect(esito.success).toBe(true);
    expect(esito.success && esito.data.telegramChatId).toBe('123456789');
  });
});
