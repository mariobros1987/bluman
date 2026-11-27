// Il «?» accanto al titolo (proposta M5 dell'analisi del 26/11) apre la scheda dell'Aiuto della
// pagina corrente. Che le schede nominate esistano lo verifica `src/aiutoDellePagine.test.ts`.
import { describe, it, expect } from 'vitest';
import { schedaAiutoDellaPagina } from './aiutoDellaPagina';

describe('schedaAiutoDellaPagina', () => {
  it('pagina → la sua scheda', () => {
    expect(schedaAiutoDellaPagina('/primanota')).toBe('07-prima-nota');
    expect(schedaAiutoDellaPagina('/')).toBe('21-dashboard');
  });

  it('il dettaglio di un progetto prende la scheda dei Progetti', () => {
    expect(schedaAiutoDellaPagina('/projects/abc-123')).toBe('01-progetti-motore-stato');
  });

  it('dentro l’Aiuto, o su una pagina senza scheda, niente «?»', () => {
    expect(schedaAiutoDellaPagina('/aiuto/05-fatture-sdi')).toBeNull();
    expect(schedaAiutoDellaPagina('/pagina-che-non-esiste')).toBeNull();
  });
});
