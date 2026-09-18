/**
 * La regola dell'IVA in fattura, provata sui casi che il rendering nascondeva.
 *
 * Questi test sono la ragione per cui la regola è stata estratta da `FatturazioneTab.tsx`
 * (§ voce 15: il frontend aveva ~3% di copertura). Mettono alla prova esattamente i punti dove
 * l'anteprima e il backend potevano divergere — il difetto corretto il 18/09/2026 — così che se
 * qualcuno cambia la regola di qui e non quella del backend, o viceversa, il test lo veda.
 */
import { describe, it, expect } from 'vitest';
import { risolviAliquotaIva, calcolaTotaliFattura } from './fatturazione';

describe('risolviAliquotaIva — il regime del cliente vince, con ripiego per tipo documento', () => {
  it('usa l\'aliquota registrata sul cliente quando c\'è', () => {
    expect(risolviAliquotaIva(22, 'business_italia')).toBe(22);
    expect(risolviAliquotaIva(10, 'business_italia')).toBe(10);
  });

  it('0 è un\'aliquota valida (esente), non «non dichiarata»: non ripiega sul 22', () => {
    // È la distinzione che il difetto sbagliava: un `||` avrebbe trattato lo 0 come assente.
    expect(risolviAliquotaIva(0, 'business_italia')).toBe(0);
    expect(risolviAliquotaIva(0, 'estero')).toBe(0);
  });

  it('senza aliquota registrata ripiega sul tipo documento: estero 0, altrimenti 22', () => {
    expect(risolviAliquotaIva(null, 'estero')).toBe(0);
    expect(risolviAliquotaIva(undefined, 'estero')).toBe(0);
    expect(risolviAliquotaIva(null, 'business_italia')).toBe(22);
    expect(risolviAliquotaIva(undefined, 'privato_italia')).toBe(22);
  });
});

describe('calcolaTotaliFattura — l\'IVA si somma sopra l\'imponibile', () => {
  it('imponibile €120 al 22% → IVA €26,40, totale €146,40', () => {
    const t = calcolaTotaliFattura(120, 22);
    expect(t.imponibile).toBe(120);
    expect(t.iva).toBeCloseTo(26.4, 2);
    expect(t.totale).toBeCloseTo(146.4, 2);
  });

  it('al 0% l\'IVA è zero e il totale coincide con l\'imponibile', () => {
    const t = calcolaTotaliFattura(200, 0);
    expect(t.iva).toBe(0);
    expect(t.totale).toBe(200);
  });

  it('non scorpora: il totale è sempre ≥ imponibile', () => {
    // Il difetto del backend era lo scorporo (totale = imponibile/1.22); qui il totale cresce.
    const t = calcolaTotaliFattura(1000, 22);
    expect(t.totale).toBeGreaterThan(t.imponibile);
    expect(t.totale).toBeCloseTo(1220, 2);
  });
});
