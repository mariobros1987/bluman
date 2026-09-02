import { describe, it, expect } from 'vitest';
import {
  determinaPeriodoFiscale,
  calcolaLiquidazioneIvaPeriodo,
  getCodiceTributoIva,
} from './services/lipeEngine.js';

describe('🧪 Liquidazione IVA (LIPE) & F24 Engine — Test Suite', () => {
  describe('Parsing e Determina Periodo', () => {
    it('riconosce correttamente un periodo trimestrale (es. 2026-Q3)', () => {
      const p = determinaPeriodoFiscale('2026-Q3');
      expect(p.tipo).toBe('trimestrale');
      expect(p.anno).toBe(2026);
      expect(p.trimestre).toBe(3);
      expect(p.codicePeriodo).toBe('2026-Q3');
      expect(p.dataInizio.toISOString()).toContain('2026-07-01');
      expect(p.dataFine.toISOString()).toContain('2026-09-30');
    });

    it('riconosce correttamente un periodo mensile (es. 2026-09)', () => {
      const p = determinaPeriodoFiscale('2026-09');
      expect(p.tipo).toBe('mensile');
      expect(p.anno).toBe(2026);
      expect(p.mese).toBe(9);
      expect(p.codicePeriodo).toBe('2026-09');
      expect(p.dataInizio.toISOString()).toContain('2026-09-01');
      expect(p.dataFine.toISOString()).toContain('2026-09-30');
    });

    it('genera codice tributo corretto per F24 trimestrale e mensile', () => {
      const pQ1 = determinaPeriodoFiscale('2026-Q1');
      expect(getCodiceTributoIva(pQ1).codice).toBe('6031');

      const pQ3 = determinaPeriodoFiscale('2026-Q3');
      expect(getCodiceTributoIva(pQ3).codice).toBe('6033');

      const pM5 = determinaPeriodoFiscale('2026-05');
      expect(getCodiceTributoIva(pM5).codice).toBe('6005');
    });
  });

  describe('Calcolo Liquidazione IVA', () => {
    it('calcola correttamente la posizione a debito con prospetto F24', () => {
      const fattureAttive = [
        {
          totaleImponibileCentesimi: 100000, // €1.000
          totaleIvaCentesimi: 22000, // €220
          stato: 'emessa',
          esigibilitaIva: 'immediata',
        },
        {
          totaleImponibileCentesimi: 50000, // €500
          totaleIvaCentesimi: 11000, // €110
          stato: 'emessa',
          esigibilitaIva: 'immediata',
        },
      ];

      const fatturePassive = [
        {
          imponibileCentesimi: 40000, // €400
          ivaCentesimi: 8800, // €88
        },
      ];

      const res = calcolaLiquidazioneIvaPeriodo('2026-Q3', fattureAttive, fatturePassive);

      expect(res.ivaDebitoCent).toBe(33000); // €330
      expect(res.ivaCreditoCent).toBe(8800); // €88
      expect(res.saldoIvaCent).toBe(24200); // €242 debito
      expect(res.stato).toBe('debito');
      expect(res.importoDaVersareCent).toBe(24200);
      expect(res.creditoRiportabileCent).toBe(0);

      // Prospetto F24
      expect(res.prospettoF24.righe.length).toBe(1);
      expect(res.prospettoF24.righe[0]?.codiceTributo).toBe('6033');
      expect(res.prospettoF24.righe[0]?.importoDebitoCent).toBe(24200);
    });

    it('calcola correttamente la posizione a credito riportabile', () => {
      const fattureAttive = [
        {
          totaleImponibileCentesimi: 20000, // €200
          totaleIvaCentesimi: 4400, // €44
          stato: 'emessa',
        },
      ];

      const fatturePassive = [
        {
          imponibileCentesimi: 100000, // €1.000
          ivaCentesimi: 22000, // €220
        },
      ];

      const res = calcolaLiquidazioneIvaPeriodo('2026-09', fattureAttive, fatturePassive);

      expect(res.ivaDebitoCent).toBe(4400);
      expect(res.ivaCreditoCent).toBe(22000);
      expect(res.saldoIvaCent).toBe(-17600); // €176 credito
      expect(res.stato).toBe('credito');
      expect(res.importoDaVersareCent).toBe(0);
      expect(res.creditoRiportabileCent).toBe(17600);
      expect(res.prospettoF24.righe.length).toBe(0);
    });

    it('esclude le fatture in bozza o con split payment dal debito IVA', () => {
      const fattureAttive = [
        {
          totaleImponibileCentesimi: 100000,
          totaleIvaCentesimi: 22000,
          stato: 'bozza', // bozza: esclusa
        },
        {
          totaleImponibileCentesimi: 100000,
          totaleIvaCentesimi: 22000,
          stato: 'emessa',
          esigibilitaIva: 'split', // split payment PA: escluso dal debito verso erario dello studio
        },
        {
          totaleImponibileCentesimi: 50000,
          totaleIvaCentesimi: 11000,
          stato: 'emessa',
          esigibilitaIva: 'immediata', // concorre
        },
      ];

      const res = calcolaLiquidazioneIvaPeriodo('2026-Q2', fattureAttive, []);
      expect(res.ivaDebitoCent).toBe(11000);
      expect(res.saldoIvaCent).toBe(11000);
    });
  });
});
