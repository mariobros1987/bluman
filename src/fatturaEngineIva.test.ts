/**
 * B1 (audit): l'IVA del riepilogo (DatiRiepilogo SdI) si calcola sull'imponibile di GRUPPO, non
 * sommando i per-riga arrotondati — altrimenti fino a 1 cent di scarto, che SdI segnala come
 * incoerenza Imponibile/Imposta. Puro, si testa senza DB.
 */
import { describe, it, expect } from 'vitest';
import { calcolaTotaliFattura } from './services/fatturaEngine.js';

describe('calcolaTotaliFattura — IVA di riepilogo per gruppo (B1)', () => {
  it('due righe da 10,15€ @22% danno IVA 447 (gruppo), non 446 (somma per-riga)', () => {
    const t = calcolaTotaliFattura(
      [
        { descrizione: 'A', prezzoUnitarioCent: 1015, aliquotaIva: 22, applicaCassa: false, applicaRitenuta: false },
        { descrizione: 'B', prezzoUnitarioCent: 1015, aliquotaIva: 22, applicaCassa: false, applicaRitenuta: false },
      ],
      {},
    );
    expect(t.totaleImponibileCentesimi).toBe(2030);
    expect(t.totaleIvaCentesimi).toBe(447);
    expect(t.riepilogoIva).toHaveLength(1);
    expect(t.riepilogoIva[0]?.ivaCentesimi).toBe(447);
    // Coerenza col totale documento (imponibile + IVA, niente cassa/bollo qui).
    expect(t.totaleDocumentoCentesimi).toBe(2030 + 447);
  });

  it('aliquote diverse restano su righe di riepilogo distinte', () => {
    const t = calcolaTotaliFattura(
      [
        { descrizione: 'std', prezzoUnitarioCent: 10000, aliquotaIva: 22, applicaCassa: false, applicaRitenuta: false },
        { descrizione: 'rid', prezzoUnitarioCent: 10000, aliquotaIva: 10, applicaCassa: false, applicaRitenuta: false },
      ],
      {},
    );
    expect(t.riepilogoIva).toHaveLength(2);
    expect(t.totaleIvaCentesimi).toBe(2200 + 1000);
  });
});
