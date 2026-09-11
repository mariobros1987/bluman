import { describe, expect, it } from 'vitest';
import { campoOrdinamento, creaMetaPaginazione, leggiPaginazione } from './paginazione.js';

describe('leggiPaginazione', () => {
  it('mantiene il contratto array legacy quando non ci sono parametri di lista', () => {
    expect(leggiPaginazione(undefined)).toEqual({ paginata: false });
    expect(leggiPaginazione({ filtroEstraneo: 'x' })).toEqual({ paginata: false });
  });

  it('applica default e coercion quando la modalità paginata è richiesta', () => {
    expect(leggiPaginazione({ page: '2', limit: '25' })).toEqual({
      paginata: true,
      parametri: {
        page: 2,
        limit: 25,
        search: undefined,
        sortBy: undefined,
        sortOrder: 'desc',
        skip: 25,
      },
    });
    expect(leggiPaginazione({ search: 'cliente' })).toMatchObject({
      paginata: true,
      parametri: { page: 1, limit: 50, skip: 0, sortOrder: 'desc' },
    });
  });

  it('normalizza la ricerca e scarta una stringa composta solo da spazi', () => {
    expect(leggiPaginazione({ search: '  Alfa S.r.l.  ' })).toMatchObject({
      paginata: true,
      parametri: { search: 'Alfa S.r.l.' },
    });
    expect(leggiPaginazione({ search: '   ' })).toMatchObject({
      paginata: true,
      parametri: { search: undefined },
    });
  });

  it.each([
    { page: '0' },
    { page: '1.5' },
    { limit: '0' },
    { limit: '201' },
    { sortOrder: 'casuale' },
  ])('restituisce un errore per query non valida: %o', (query) => {
    const esito = leggiPaginazione(query);
    expect(esito.paginata).toBe(true);
    expect(esito).toHaveProperty('errore');
    expect((esito as { errore: string }).errore.length).toBeGreaterThan(0);
  });
});

describe('creaMetaPaginazione', () => {
  it('rappresenta coerentemente una lista vuota', () => {
    expect(creaMetaPaginazione(1, 50, 0)).toEqual({ page: 1, limit: 50, totale: 0, pagine: 0 });
  });

  it('arrotonda per eccesso il numero delle pagine', () => {
    expect(creaMetaPaginazione(2, 25, 51)).toEqual({ page: 2, limit: 25, totale: 51, pagine: 3 });
  });
});

describe('campoOrdinamento', () => {
  const consentiti = ['createdAt', 'nome'] as const;

  it('usa il campo predefinito quando sortBy è assente', () => {
    expect(campoOrdinamento(undefined, consentiti, 'createdAt')).toBe('createdAt');
  });

  it('accetta soltanto i campi presenti nell allowlist', () => {
    expect(campoOrdinamento('nome', consentiti, 'createdAt')).toBe('nome');
    expect(campoOrdinamento('passwordHash', consentiti, 'createdAt')).toBeNull();
  });
});
