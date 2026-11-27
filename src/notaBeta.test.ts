// Note della beta — le regole pure: la pagina a cui una nota si attacca, chi può fare cosa, e il
// testo che «Copia tutto» mette negli appunti.
import { describe, it, expect } from 'vitest';
import { noteBetaInTesto, paginaGenerale, puoGestireNoteBeta, puoScrivereNoteBeta } from './domain/notaBeta.js';

describe('paginaGenerale', () => {
  it('le pagine semplici restano come sono, senza query né ancora', () => {
    expect(paginaGenerale('/primanota')).toBe('/primanota');
    expect(paginaGenerale('/clients?client=Rossi')).toBe('/clients');
    expect(paginaGenerale('/settings#moduli')).toBe('/settings');
  });

  it('la Dashboard è «/»', () => {
    expect(paginaGenerale('/')).toBe('/');
    expect(paginaGenerale('')).toBe('/');
    expect(paginaGenerale(null)).toBe('/');
  });

  it('due progetti diversi sono la stessa pagina: l’identificativo diventa «:id»', () => {
    expect(paginaGenerale('/projects/6a3bca5d-69ca-4eae-8e73-360ab1aed785')).toBe('/projects/:id');
    expect(paginaGenerale('/projects/1955d524-062d-45d3-8d25-343780c6c161')).toBe('/projects/:id');
    expect(paginaGenerale('/qualcosa/42/dettaglio')).toBe('/qualcosa/:id/dettaglio');
  });

  it('una scheda dell’Aiuto resta quella scheda, non un id', () => {
    expect(paginaGenerale('/aiuto/05-fatture-sdi')).toBe('/aiuto/05-fatture-sdi');
  });
});

describe('chi può fare cosa', () => {
  it('scrive chi lavora nello studio; il cliente del portale no', () => {
    for (const ruolo of ['super_admin', 'advisor', 'collaboratore_interno', 'collaboratore_esterno']) {
      expect(puoScrivereNoteBeta(ruolo), ruolo).toBe(true);
    }
    expect(puoScrivereNoteBeta('cliente')).toBe(false);
    expect(puoScrivereNoteBeta(undefined)).toBe(false);
  });

  it('l’elenco completo e «risolta» sono di advisor e super admin', () => {
    expect(puoGestireNoteBeta('advisor')).toBe(true);
    expect(puoGestireNoteBeta('super_admin')).toBe(true);
    expect(puoGestireNoteBeta('collaboratore_interno')).toBe(false);
    expect(puoGestireNoteBeta('cliente')).toBe(false);
  });
});

describe('noteBetaInTesto', () => {
  const nota = (extra: Record<string, unknown> = {}) => ({
    pagina: '/primanota', percorso: '/primanota', tipo: 'errore', testo: 'Il totale non torna', stato: 'aperta',
    autoreNome: 'Lorenzo', createdAt: '2026-11-27T10:00:00.000Z', ...extra,
  });

  it('raggruppa per pagina, col titolo della pagina, chi l’ha scritta e quando', () => {
    const testo = noteBetaInTesto(
      [nota(), nota({ pagina: '/projects/:id', percorso: '/projects/abc', tipo: 'miglioramento', testo: 'Riga 1\nRiga 2' })],
      (p) => (p === '/primanota' ? 'Prima Nota' : p),
    );
    expect(testo).toContain('# Note della beta (2)');
    expect(testo).toContain('## Prima Nota (/primanota)');
    expect(testo).toContain('- **Errore** (Lorenzo, 2026-11-27)');
    expect(testo).toContain('## /projects/:id');
    expect(testo).toContain('- **Miglioramento** (Lorenzo, 2026-11-27) — indirizzo: /projects/abc');
    expect(testo).toContain('  Riga 1\n  Riga 2');
  });

  it('una nota risolta è segnata, e senza note lo dice', () => {
    expect(noteBetaInTesto([nota({ stato: 'risolta' })])).toContain('**Errore** [RISOLTA]');
    expect(noteBetaInTesto([])).toBe('Nessuna nota della beta.');
  });
});
