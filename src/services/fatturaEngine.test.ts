import { describe, it, expect } from 'vitest';
import {
  calcolaTotaliFattura,
  generaPianoScadenze,
  assertFatturaModificabile,
  formattaNumeroDocumento,
  SOGLIA_BOLLO_CENTESIMI,
  IMPORTO_BOLLO_CENTESIMI,
} from './fatturaEngine.js';

describe('fatturaEngine — Motore di Calcolo Fiscale OpenSTAManager Style', () => {
  it('calcola correttamente una fattura standard con Cassa 4%, IVA 22% e Ritenuta 20%', () => {
    // Es. Prestazione 1.000 € (100.000 cent)
    // Cassa 4%: 40 € (4.000 cent)
    // Imponibile IVA = 1.040 € (104.000 cent)
    // IVA 22% = 228,80 € (22.880 cent)
    // Ritenuta 20% su 1.000 € = 200 € (20.000 cent)
    // Totale Documento = 1.000 + 40 + 228,80 = 1.268,80 € (126.880 cent)
    // Netto a pagare = 1.268,80 - 200 = 1.068,80 € (106.880 cent)
    const res = calcolaTotaliFattura(
      [
        {
          descrizione: 'Consulenza Strategica e Direzionale',
          quantita: 1,
          prezzoUnitarioCent: 100000,
          aliquotaIva: 22,
          applicaCassa: true,
          applicaRitenuta: true,
        },
      ],
      {
        tipoCassa: 'cassa_commercialisti',
        aliquotaCassa: 4.0,
        aliquotaRitenuta: 20.0,
      }
    );

    expect(res.totaleImponibileCentesimi).toBe(100000);
    expect(res.totaleCassaCentesimi).toBe(4000);
    expect(res.totaleIvaCentesimi).toBe(22880);
    expect(res.totaleRitenutaCentesimi).toBe(20000);
    expect(res.totaleBolloCentesimi).toBe(0);
    expect(res.totaleDocumentoCentesimi).toBe(126880);
    expect(res.nettoAPagareCentesimi).toBe(106880);
  });

  it('applica automaticamente il bollo virtuale di €2 su operazioni esenti > €77,47', () => {
    // Operazione esente art. 10 da 500 € (50.000 cent) > 77,47 €
    const res = calcolaTotaliFattura(
      [
        {
          descrizione: 'Operazione Esente IVA art. 10 DPR 633/72',
          quantita: 1,
          prezzoUnitarioCent: 50000,
          aliquotaIva: 0,
          naturaEsenzione: 'N4',
          applicaCassa: false,
          applicaRitenuta: false,
        },
      ],
      {
        tipoCassa: 'nessuna',
      }
    );

    expect(res.totaleImponibileCentesimi).toBe(50000);
    expect(res.totaleIvaCentesimi).toBe(0);
    expect(res.totaleBolloCentesimi).toBe(IMPORTO_BOLLO_CENTESIMI); // 200 centesimi (€2)
    expect(res.totaleDocumentoCentesimi).toBe(50200); // 500 € + 2 € bollo
    expect(res.nettoAPagareCentesimi).toBe(50200);
  });

  it('NON applica il bollo virtuale su operazioni esenti sotto la soglia di €77,47', () => {
    const res = calcolaTotaliFattura(
      [
        {
          descrizione: 'Rimborso spese escluso art. 15',
          quantita: 1,
          prezzoUnitarioCent: 5000, // 50 € < 77,47 €
          aliquotaIva: 0,
          naturaEsenzione: 'N1',
        },
      ],
      { tipoCassa: 'nessuna' }
    );

    expect(res.totaleBolloCentesimi).toBe(0);
    expect(res.totaleDocumentoCentesimi).toBe(5000);
  });

  it('gestisce correttamente lo split payment verso la Pubblica Amministrazione', () => {
    const res = calcolaTotaliFattura(
      [
        {
          descrizione: 'Fornitura servizi Ente Pubblico',
          quantita: 2,
          prezzoUnitarioCent: 100000, // 2.000 € (200.000 cent)
          aliquotaIva: 22,
          applicaCassa: false,
          applicaRitenuta: false,
        },
      ],
      {
        tipoCassa: 'nessuna',
        esigibilitaIva: 'split',
      }
    );

    expect(res.totaleImponibileCentesimi).toBe(200000);
    expect(res.totaleIvaCentesimi).toBe(44000);
    expect(res.totaleDocumentoCentesimi).toBe(244000);
    // Con split payment l'ente versa l'IVA all'erario, il fornitore incassa solo l'imponibile
    expect(res.nettoAPagareCentesimi).toBe(200000);
  });

  it('genera correttamente il piano scadenze 30/60 giorni bilanciando i centesimi', () => {
    const totaleNetto = 100001; // 1.000,01 € (dispari per testare il centesimo)
    const rate = generaPianoScadenze(totaleNetto, 'bonifico_30_60gg', new Date('2026-09-01T10:00:00Z'));

    expect(rate).toHaveLength(2);
    expect(rate[0]!.numeroRata).toBe(1);
    expect(rate[0]!.importoCentesimi).toBe(50000); // 500,00 €
    expect(rate[1]!.numeroRata).toBe(2);
    expect(rate[1]!.importoCentesimi).toBe(50001); // 500,01 €
    expect(rate[0]!.importoCentesimi + rate[1]!.importoCentesimi).toBe(totaleNetto);
  });

  it('blocca tentativi di modifica su documenti emessi (Immutabilità Fiscale)', () => {
    expect(() => assertFatturaModificabile('bozza')).not.toThrow();
    expect(() => assertFatturaModificabile('emessa')).toThrow(/Impossibile modificare il documento/);
    expect(() => assertFatturaModificabile('incassata')).toThrow(/Impossibile modificare il documento/);
    expect(() => assertFatturaModificabile('annullata')).toThrow(/Impossibile modificare il documento/);
  });

  it('formatta correttamente la numerazione progressiva della serie', () => {
    const data = new Date('2026-09-01T00:00:00Z');
    expect(formattaNumeroDocumento('FT', 1, data)).toBe('FT-2026/001');
    expect(formattaNumeroDocumento('FT', 42, data)).toBe('FT-2026/042');
    expect(formattaNumeroDocumento('NC', 3, data)).toBe('NC-2026/003');
  });
});
