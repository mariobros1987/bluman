/**
 * La regola dell'IVA in fattura, provata sui casi che il rendering nascondeva.
 *
 * Questi test sono la ragione per cui la regola è stata estratta da `FatturazioneTab.tsx`
 * (§ voce 15: il frontend aveva ~3% di copertura). Mettono alla prova esattamente i punti dove
 * l'anteprima e il backend potevano divergere — il difetto corretto il 18/09/2026 — così che se
 * qualcuno cambia la regola di qui e non quella del backend, o viceversa, il test lo veda.
 */
import { describe, it, expect } from 'vitest';
import { risolviAliquotaIva, calcolaTotaliFattura, calcolaTotaliFatturaRighe, calcolaTotaliAnteprimaFattura } from './fatturazione';
import {
  calcolaTotaliFattura as calcolaTotaliFatturaBackend,
  SOGLIA_BOLLO_CENTESIMI as SOGLIA_BOLLO_CENTESIMI_BACKEND,
  type RigaFatturaInput,
  type OpzioniCalcoloFattura,
} from '../../../src/services/fatturaEngine';
import sorgenteInvoicesPage from '../pages/InvoicesPage.tsx?raw';

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

describe('calcolaTotaliFatturaRighe — arrotonda l\'IVA per riga come il backend', () => {
  it('due righe da 3,33 € al 22%: 73c per riga = 1,46 €, NON 1,47 € dell\'aggregato', () => {
    // È il caso che la revisione ha usato: arrotondare una volta sola sull'imponibile aggregato
    // (round(6,66·0,22)=1,47) diverge dal backend, che arrotonda per riga (2×round(3,33·0,22)=2×0,73
    // =1,46). L'anteprima deve dire 1,46, come il documento salvato.
    const t = calcolaTotaliFatturaRighe([3.33, 3.33], 22);
    expect(t.iva).toBeCloseTo(1.46, 2);
    expect(t.imponibile).toBeCloseTo(6.66, 2);
    expect(t.totale).toBeCloseTo(8.12, 2);
  });

  it('riga singola: coincide con calcolaTotaliFattura', () => {
    const a = calcolaTotaliFatturaRighe([120], 22);
    const b = calcolaTotaliFattura(120, 22);
    expect(a).toEqual(b);
  });

  it('al 0% l\'IVA è zero su qualunque numero di righe', () => {
    const t = calcolaTotaliFatturaRighe([100, 250, 33.33], 0);
    expect(t.iva).toBe(0);
    expect(t.totale).toBeCloseTo(383.33, 2);
  });

  it('elenco vuoto → tutti zero, senza NaN', () => {
    const t = calcolaTotaliFatturaRighe([], 22);
    expect(t).toEqual({ imponibile: 0, iva: 0, totale: 0 });
  });
});

// F8 — l'anteprima del modulo «Nuova fattura» era calcolata a mano nella pagina: IVA sulla cassa
// fissa al 22% anche su una fattura esente, e bollo su ogni riga ad aliquota 0. Qui la si
// confronta con il motore che salva, sugli stessi input.
describe('calcolaTotaliAnteprimaFattura — gli stessi numeri di fatturaEngine', () => {
  const casi: Array<[string, RigaFatturaInput[], OpzioniCalcoloFattura]> = [
    ['esente con cassa', [{ descrizione: 'a', prezzoUnitarioCent: 100000, aliquotaIva: 0, naturaEsenzione: 'N2.2', applicaRitenuta: false }], { tipoCassa: 'inps_gestione_separata', aliquotaCassa: 4 }],
    ['ordinaria con cassa e ritenuta', [{ descrizione: 'a', prezzoUnitarioCent: 150000 }], { tipoCassa: 'cassa_forense', aliquotaCassa: 4, aliquotaRitenuta: 20 }],
    ['miste, sconti e quantità', [
      { descrizione: 'a', prezzoUnitarioCent: 1015, quantita: 2, aliquotaIva: 22 },
      { descrizione: 'b', prezzoUnitarioCent: 33333, scontoPercentuale: 10, aliquotaIva: 10, applicaCassa: false },
      { descrizione: 'c', prezzoUnitarioCent: 9000, aliquotaIva: 0, naturaEsenzione: 'N1', applicaRitenuta: false },
    ], { tipoCassa: 'cassa_commercialisti', aliquotaCassa: 4, aliquotaRitenuta: 20 }],
    ['bollo sotto soglia', [{ descrizione: 'a', prezzoUnitarioCent: 7747, aliquotaIva: 0, naturaEsenzione: 'N4' }], {}],
    ['bollo sopra soglia', [{ descrizione: 'a', prezzoUnitarioCent: 7748, aliquotaIva: 0, naturaEsenzione: 'N4' }], {}],
    ['aliquota 0 senza natura: niente bollo', [{ descrizione: 'a', prezzoUnitarioCent: 50000, aliquotaIva: 0 }], {}],
    ['bollo escluso dalla riga', [{ descrizione: 'a', prezzoUnitarioCent: 50000, aliquotaIva: 0, naturaEsenzione: 'N4', applicaBollo: false }], {}],
    ['split payment', [{ descrizione: 'a', prezzoUnitarioCent: 200000 }], { esigibilitaIva: 'split', aliquotaRitenuta: 20 }],
    ['nessuna cassa con aliquota cassa valorizzata', [{ descrizione: 'a', prezzoUnitarioCent: 100000 }], { tipoCassa: 'nessuna', aliquotaCassa: 4 }],
  ];

  it.each(casi)('%s', (_caso, righe, opzioni) => {
    const backend = calcolaTotaliFatturaBackend(righe, opzioni);
    const anteprima = calcolaTotaliAnteprimaFattura(righe, opzioni);
    expect(anteprima).toEqual({
      totaleImponibileCentesimi: backend.totaleImponibileCentesimi,
      totaleCassaCentesimi: backend.totaleCassaCentesimi,
      totaleIvaCentesimi: backend.totaleIvaCentesimi,
      totaleRitenutaCentesimi: backend.totaleRitenutaCentesimi,
      totaleBolloCentesimi: backend.totaleBolloCentesimi,
      totaleDocumentoCentesimi: backend.totaleDocumentoCentesimi,
      nettoAPagareCentesimi: backend.nettoAPagareCentesimi,
    });
  });

  it('fattura esente con cassa: nessuna IVA sulla cassa', () => {
    const t = calcolaTotaliAnteprimaFattura(
      [{ prezzoUnitarioCent: 100000, aliquotaIva: 0, naturaEsenzione: 'N2.2' }],
      { tipoCassa: 'inps_gestione_separata', aliquotaCassa: 4 },
    );
    expect(t.totaleCassaCentesimi).toBe(4000);
    expect(t.totaleIvaCentesimi).toBe(0);
  });

  it('bollo: stessa soglia del backend (oltre 77,47 €)', () => {
    const riga = (cent: number) => [{ prezzoUnitarioCent: cent, aliquotaIva: 0, naturaEsenzione: 'N4' }];
    expect(calcolaTotaliAnteprimaFattura(riga(SOGLIA_BOLLO_CENTESIMI_BACKEND)).totaleBolloCentesimi).toBe(0);
    expect(calcolaTotaliAnteprimaFattura(riga(SOGLIA_BOLLO_CENTESIMI_BACKEND + 1)).totaleBolloCentesimi).toBe(200);
  });

  it('InvoicesPage non ricalcola i totali a mano', () => {
    expect(sorgenteInvoicesPage).toContain('calcolaTotaliAnteprimaFattura(');
    expect(sorgenteInvoicesPage).not.toContain('* 0.22');
  });
});
