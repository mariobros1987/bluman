// Analisi del 26/11, E7 — eliminando dalla Prima Nota il movimento di un incasso, la rata restava
// «incassata»: lo Scadenzario dichiarava pagato un importo che nessuna riga registrava più.
import { describe, it, expect } from 'vitest';
import { motivoMovimentoNonEliminabile } from './domain/eliminazioneMovimento.js';

describe('motivoMovimentoNonEliminabile', () => {
  it('movimento libero (spesa, giroconto, riga importata) → si può eliminare', () => {
    expect(motivoMovimentoNonEliminabile({})).toBeNull();
    expect(motivoMovimentoNonEliminabile({ fatturaId: null, fatturaRicevutaId: null })).toBeNull();
  });

  it('incasso di una fattura → non si elimina, e la frase nomina la fattura e il perché', () => {
    const motivo = motivoMovimentoNonEliminabile({ fatturaId: 'f-1', fattura: { numero: 'FT-2026/001' } });
    expect(motivo).toContain('FT-2026/001');
    expect(motivo).toMatch(/rata resterebbe «incassata»/);
  });

  it('incasso di una fattura senza numero letto → non si elimina lo stesso', () => {
    expect(motivoMovimentoNonEliminabile({ fatturaId: 'f-1' })).toMatch(/incasso della fattura:/);
  });

  it('pagamento di una fattura d’acquisto → non si elimina', () => {
    const motivo = motivoMovimentoNonEliminabile({ fatturaRicevutaId: 'fr-1', fatturaRicevuta: { numero: 'A-77' } });
    expect(motivo).toContain('A-77');
    expect(motivo).toMatch(/resterebbe «pagata»/);
  });
});
