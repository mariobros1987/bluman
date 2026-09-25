import { describe, it, expect } from 'vitest';
import {
  matchNonRisolto,
  screeningBloccaApprovazione,
  screeningPiuRecentiPerTipo,
  motivoBloccoScreening,
  type ScreeningRiga,
} from './screeningKyc.js';

describe('K5 — screeningKyc (regole pure §8.4)', () => {
  it('matchNonRisolto: bloccano da_valutare e confermato, non nessun_match/falso_positivo', () => {
    expect(matchNonRisolto('match_da_valutare')).toBe(true);
    expect(matchNonRisolto('match_confermato')).toBe(true);
    expect(matchNonRisolto('nessun_match')).toBe(false);
    expect(matchNonRisolto('falso_positivo')).toBe(false);
  });

  it('nessuno screening registrato NON blocca (il blocco è sul match, non sull\'assenza)', () => {
    expect(screeningBloccaApprovazione([])).toBe(false);
    expect(motivoBloccoScreening([])).toBe('');
  });

  it('un match da valutare blocca; risolto come falso positivo non blocca', () => {
    const daValutare: ScreeningRiga[] = [{ tipo: 'sanzioni', esito: 'match_da_valutare' }];
    expect(screeningBloccaApprovazione(daValutare)).toBe(true);
    expect(motivoBloccoScreening(daValutare)).toContain('sanzioni');

    const risolto: ScreeningRiga[] = [{ tipo: 'sanzioni', esito: 'falso_positivo' }];
    expect(screeningBloccaApprovazione(risolto)).toBe(false);
    expect(motivoBloccoScreening(risolto)).toBe('');
  });

  it('un match confermato blocca l\'approvazione (spec §8.4)', () => {
    const confermato: ScreeningRiga[] = [{ tipo: 'pep', esito: 'match_confermato' }];
    expect(screeningBloccaApprovazione(confermato)).toBe(true);
    expect(motivoBloccoScreening(confermato)).toContain('PEP');
  });

  it('conta solo lo screening PIÙ RECENTE per tipo: uno più nuovo pulito supera il vecchio match', () => {
    const s: ScreeningRiga[] = [
      { tipo: 'sanzioni', esito: 'match_da_valutare', dataScreening: '2026-09-01T10:00:00Z' },
      { tipo: 'sanzioni', esito: 'nessun_match', dataScreening: '2026-09-20T10:00:00Z' },
    ];
    expect(screeningPiuRecentiPerTipo(s).get('sanzioni')?.esito).toBe('nessun_match');
    expect(screeningBloccaApprovazione(s)).toBe(false);
  });

  it('blocca se anche UN solo tipo è non risolto, e il motivo li elenca', () => {
    const s: ScreeningRiga[] = [
      { tipo: 'sanzioni', esito: 'nessun_match' },
      { tipo: 'pep', esito: 'match_da_valutare' },
      { tipo: 'media_negativi', esito: 'falso_positivo' },
    ];
    expect(screeningBloccaApprovazione(s)).toBe(true);
    const motivo = motivoBloccoScreening(s);
    expect(motivo).toContain('PEP');
    expect(motivo).not.toContain('sanzioni');
    expect(motivo).not.toContain('media negativi');
  });
});
