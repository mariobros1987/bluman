// Analisi del 26/11, F5 — il responsabile dello studio vedeva «Reset Pass» anche sui super admin:
// un pulsante che il server rifiuta sempre (403).
import { describe, it, expect } from 'vitest';
import { personaGestibileDa } from './gestioneTeam';

const OPERATORE = { ruolo: 'operatore', tenantId: 't-1' };
const SUPER = { ruolo: 'super_admin', tenantId: null };

describe('personaGestibileDa', () => {
  it('il responsabile dello studio gestisce le persone del suo studio', () => {
    expect(personaGestibileDa('advisor', OPERATORE)).toBe(true);
    expect(personaGestibileDa('advisor', { ruolo: 'advisor', tenantId: 't-1' })).toBe(true);
  });

  it('il responsabile dello studio NON gestisce un super admin, nemmeno se ha uno studio assegnato', () => {
    expect(personaGestibileDa('advisor', SUPER)).toBe(false);
    expect(personaGestibileDa('advisor', { ruolo: 'super_admin', tenantId: 't-1' })).toBe(false);
  });

  it('il super admin gestisce tutti', () => {
    expect(personaGestibileDa('super_admin', SUPER)).toBe(true);
    expect(personaGestibileDa('super_admin', OPERATORE)).toBe(true);
  });

  it('gli altri ruoli, o un ruolo non letto, non gestiscono nessuno', () => {
    expect(personaGestibileDa('operatore', OPERATORE)).toBe(false);
    expect(personaGestibileDa(undefined, OPERATORE)).toBe(false);
  });
});
