import { describe, it, expect } from 'vitest';
import {
  statoSoggettoARevisione,
  dataRevisioneKyc,
  giorniAllaRevisioneKyc,
  revisioneKycDovuta,
  motivoRevisioneKyc,
  GIORNI_PREAVVISO_REVISIONE_KYC,
} from './monitoraggioKyc.js';

const OGGI = new Date('2026-09-25T12:00:00Z');
const gg = (n: number) => new Date(OGGI.getTime() + n * 24 * 60 * 60 * 1000);

describe('K7 — monitoraggioKyc (regole pure §5.2)', () => {
  it('solo approvato/in_revisione sono soggetti a revisione', () => {
    expect(statoSoggettoARevisione('approvato')).toBe(true);
    expect(statoSoggettoARevisione('in_revisione')).toBe(true);
    expect(statoSoggettoARevisione('in_verifica')).toBe(false);
    expect(statoSoggettoARevisione('bozza')).toBe(false);
  });

  it('dataRevisioneKyc prende la più vicina tra scadenza e prossima revisione', () => {
    expect(dataRevisioneKyc(gg(40), gg(10))?.getTime()).toBe(gg(10).getTime());
    expect(dataRevisioneKyc(gg(5), gg(90))?.getTime()).toBe(gg(5).getTime());
    expect(dataRevisioneKyc(null, gg(7))?.getTime()).toBe(gg(7).getTime());
    expect(dataRevisioneKyc(gg(7), null)?.getTime()).toBe(gg(7).getTime());
    expect(dataRevisioneKyc(null, null)).toBeNull();
  });

  it('giorniAllaRevisioneKyc: positivo se futura, negativo se scaduta, null se assente', () => {
    expect(giorniAllaRevisioneKyc(gg(10), null, OGGI)).toBe(10);
    expect(giorniAllaRevisioneKyc(gg(-3), null, OGGI)).toBe(-3);
    expect(giorniAllaRevisioneKyc(null, null, OGGI)).toBeNull();
  });

  it('revisioneKycDovuta: entro il preavviso o scaduta = dovuta; oltre = no', () => {
    // dentro la finestra di preavviso
    expect(revisioneKycDovuta('approvato', gg(GIORNI_PREAVVISO_REVISIONE_KYC - 1), null, OGGI)).toBe(true);
    // scaduta
    expect(revisioneKycDovuta('approvato', gg(-5), null, OGGI)).toBe(true);
    // ancora lontana
    expect(revisioneKycDovuta('approvato', gg(120), null, OGGI)).toBe(false);
    // stato non soggetto
    expect(revisioneKycDovuta('in_verifica', gg(-5), null, OGGI)).toBe(false);
    // nessuna data
    expect(revisioneKycDovuta('approvato', null, null, OGGI)).toBe(false);
  });

  it('la prossima revisione (rischio) può anticipare la scadenza del fascicolo', () => {
    // fascicolo scade tra 300gg ma il rischio alto impone revisione tra 20gg → dovuta
    expect(revisioneKycDovuta('approvato', gg(300), gg(20), OGGI)).toBe(true);
  });

  it('motivoRevisioneKyc: frase esplicita solo quando dovuta (regola 12)', () => {
    expect(motivoRevisioneKyc('approvato', gg(120), null, OGGI)).toBe('');
    expect(motivoRevisioneKyc('approvato', gg(-5), null, OGGI)).toContain('scaduta');
    expect(motivoRevisioneKyc('approvato', gg(10), null, OGGI)).toContain('10 giorni');
  });
});
