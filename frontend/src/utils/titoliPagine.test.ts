// Il nome delle pagine: lo leggono la barra in alto e la raccolta delle note della beta, che
// conosce le pagine in forma generale («/projects/:id»).
import { describe, it, expect } from 'vitest';
import { titoloDellaPagina } from './titoliPagine';

describe('titoloDellaPagina', () => {
  it('pagina a indirizzo fisso', () => {
    expect(titoloDellaPagina('/primanota')).toBe('Prima Nota');
    expect(titoloDellaPagina('/note-beta')).toBe('Note della beta');
  });

  it('pagina con identificativo: vale l’indirizzo esatto e quello generale', () => {
    expect(titoloDellaPagina('/projects/6a3bca5d-69ca-4eae-8e73-360ab1aed785')).toBe('Dettaglio Progetto');
    expect(titoloDellaPagina('/projects/:id')).toBe('Dettaglio Progetto');
    expect(titoloDellaPagina('/aiuto/05-fatture-sdi')).toBe('Aiuto');
  });

  it('indirizzo sconosciuto → il nome dell’app, non un titolo inventato', () => {
    expect(titoloDellaPagina('/non-esiste')).toBe('BluMan');
  });
});
