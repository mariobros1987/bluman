import { describe, it, expect } from 'vitest';
import {
  calcolaInteressiMora,
  generaTestoSollecito,
  puoInviareSollecito,
  SPESE_FORFETTARIE_RECUPERO_CENT,
} from './services/sollecitiEngine.js';

describe('🧪 Solleciti & Interessi di Mora ex D.Lgs. 231/2002 — Test Suite', () => {
  describe('Calcolo Interessi di Mora', () => {
    it('non applica mora se la scadenza non è ancora superata (giorni ritardo = 0)', () => {
      const dataScadenza = new Date(Date.now() + 10 * 24 * 60 * 60 * 1000); // tra 10 giorni
      const res = calcolaInteressiMora(100000, dataScadenza, new Date());

      expect(res.giorniRitardo).toBe(0);
      expect(res.interessiMoraCent).toBe(0);
      expect(res.speseForfettarieRecuperoCent).toBe(0);
      expect(res.totaleDovutoCent).toBe(100000);
    });

    it('calcola esattamente la mora per 30 giorni di ritardo ex D.Lgs. 231/2002', () => {
      const dataScadenza = new Date('2026-08-01');
      const dataCalcolo = new Date('2026-08-31'); // 30 giorni dopo
      const capitaleCent = 1000000; // €10.000,00
      const saggio = 12.0; // 12% annuo

      const res = calcolaInteressiMora(capitaleCent, dataScadenza, dataCalcolo, saggio, true);

      expect(res.giorniRitardo).toBe(30);
      // Interessi: 10000 * 0.12 * 30 / 365 = 98.63 € -> 9863 centesimi
      expect(res.interessiMoraCent).toBe(9863);
      expect(res.speseForfettarieRecuperoCent).toBe(SPESE_FORFETTARIE_RECUPERO_CENT); // 40,00 €
      expect(res.totaleDovutoCent).toBe(capitaleCent + 9863 + 4000);
    });
  });

  describe('Generazione Testo Sollecito', () => {
    it('genera avviso bonario (1° livello) senza spese di recupero forfettarie', () => {
      const res = generaTestoSollecito({
        livello: '1_avviso_bonario',
        clienteNome: 'Holding Alpha S.r.l.',
        numeroFattura: 'FT-2026/010',
        dataEmissione: '2026-07-01',
        dataScadenza: new Date(Date.now() - 5 * 24 * 60 * 60 * 1000),
        numeroRata: 1,
        importoCapitaleCent: 250000,
        studioNome: 'Studio BluMan Advisory',
        ibanStudio: 'IT00X0000000000000000000000',
      });

      expect(res.oggettoEmail).toContain('Promemoria Scadenza');
      expect(res.corpoTesto).toContain('Holding Alpha S.r.l.');
      expect(res.corpoTesto).toContain('FT-2026/010');
      expect(res.corpoTesto).toContain('IT00X0000000000000000000000');
      expect(res.calcoloMora.speseForfettarieRecuperoCent).toBe(0);
    });

    it('genera sollecito con mora (2° livello) con citazione D.Lgs. 231/2002 e spese forfettarie', () => {
      const res = generaTestoSollecito({
        livello: '2_sollecito_mora',
        clienteNome: 'Beta Finance Ltd',
        numeroFattura: 'FT-2026/005',
        dataEmissione: '2026-06-01',
        dataScadenza: '2026-07-01',
        numeroRata: 2,
        importoCapitaleCent: 500000,
        studioNome: 'Studio BluMan Advisory',
      });

      expect(res.oggettoEmail).toContain('SOLLECITO DI PAGAMENTO');
      expect(res.corpoTesto).toContain('D.Lgs. 9 ottobre 2002 n. 231');
      expect(res.corpoTesto).toContain('Risarcimento forfettario spese di recupero');
      expect(res.calcoloMora.speseForfettarieRecuperoCent).toBe(4000);
    });

    it('genera diffida legale (3° livello) con avviso di decreto ingiuntivo', () => {
      const res = generaTestoSollecito({
        livello: '3_diffida_legale',
        clienteNome: 'Gamma Real Estate S.p.A.',
        numeroFattura: 'FT-2026/001',
        dataEmissione: '2026-05-01',
        dataScadenza: '2026-06-01',
        numeroRata: 1,
        importoCapitaleCent: 1200000,
        studioNome: 'Studio BluMan Advisory',
      });

      expect(res.oggettoEmail).toContain('DIFFIDA FORMALE E MESSA IN MORA');
      expect(res.corpoTesto).toContain('Decreto Ingiuntivo');
      expect(res.corpoTesto).toContain('costituzione in mora');
    });
  });

  describe('Escalation stretta (W4)', () => {
    it('il primo avviso bonario si può sempre inviare, anche senza storia', () => {
      expect(puoInviareSollecito('1_avviso_bonario', [])).toBe(true);
    });
    it('il sollecito di mora richiede un avviso bonario già inviato', () => {
      expect(puoInviareSollecito('2_sollecito_mora', [])).toBe(false);
      expect(puoInviareSollecito('2_sollecito_mora', ['1_avviso_bonario'])).toBe(true);
    });
    it('la diffida legale non può essere il primo contatto né saltare la mora', () => {
      expect(puoInviareSollecito('3_diffida_legale', [])).toBe(false);
      expect(puoInviareSollecito('3_diffida_legale', ['1_avviso_bonario'])).toBe(false);
      expect(puoInviareSollecito('3_diffida_legale', ['1_avviso_bonario', '2_sollecito_mora'])).toBe(true);
    });
    it('un livello già raggiunto consente di re-inviare lo stesso livello', () => {
      expect(puoInviareSollecito('2_sollecito_mora', ['2_sollecito_mora'])).toBe(true);
    });
  });
});
