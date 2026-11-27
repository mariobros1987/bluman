import { describe, it, expect } from 'vitest';
import { motivoCanaleCliente } from './motivoCanaleCliente';

describe('motivo di un canale non disponibile, detto al cliente', () => {
  it('niente dettagli tecnici della configurazione dello studio', () => {
    expect(motivoCanaleCliente('Signal non configurato nelle impostazioni dello studio: servono indirizzo del demone e numero')).toBe('Non attivo per questo studio');
    expect(motivoCanaleCliente('SMTP non configurato nelle impostazioni dello studio')).toBe('Non attivo per questo studio');
  });
  it('i recapiti mancanti detti in seconda persona', () => {
    expect(motivoCanaleCliente('Nessun cellulare in anagrafica')).toBe('Lo studio non ha il tuo cellulare');
    expect(motivoCanaleCliente('Il cliente deve prima scrivere al bot @studio_bot per attivare il canale')).toBe('Per attivarlo scrivi prima al bot @studio_bot per attivare il canale');
  });
  it('un motivo che non conosce resta com è', () => {
    expect(motivoCanaleCliente('Altro motivo')).toBe('Altro motivo');
    expect(motivoCanaleCliente(undefined)).toBeUndefined();
  });
});
