// «Da fare oggi» (proposta M1 dell'analisi del 26/11): la Dashboard dice che cosa aspetta
// l'operatore. Le regole sono conteggi su dati già scritti; «oggi» è un parametro.
import { describe, it, expect } from 'vitest';
import { vociDaFare } from './daFareOggi';

const OGGI = new Date(2026, 10, 27); // 27 novembre 2026
const rata = (giornoIso: string, importo: number, extra: Record<string, unknown> = {}) => ({
  stato: 'aperta', dataScadenza: `${giornoIso}T00:00:00.000Z`, importoCentesimi: importo, registrazioniRegistrate: [], ...extra,
});
const base = { oggi: OGGI, rate: [], fattureAcquisto: [], moduliInRitardo: 0 };

describe('vociDaFare', () => {
  it('niente da fare → elenco vuoto', () => {
    expect(vociDaFare(base)).toEqual([]);
  });

  it('rate scadute: si contano, con il residuo da incassare', () => {
    const [voce] = vociDaFare({ ...base, rate: [rata('2026-11-20', 48800), rata('2026-11-10', 10000)] });
    expect(voce).toMatchObject({ chiave: 'rate_scadute', tono: 'urgente', testo: '2 rate scadute da incassare', importoCentesimi: 58800, vaiA: '/scadenzario' });
  });

  it('una rata incassata in parte conta per quello che resta; una già incassata o stornata non conta', () => {
    const voci = vociDaFare({
      ...base,
      rate: [
        rata('2026-11-20', 48800, { stato: 'parziale', registrazioniRegistrate: [{ importoIncassatoCentesimi: 40000 }] }),
        rata('2026-11-20', 10000, { stato: 'incassato' }),
        rata('2026-11-20', 10000, { stato: 'stornata' }),
      ],
    });
    expect(voci).toHaveLength(1);
    expect(voci[0]).toMatchObject({ testo: '1 rata scaduta da incassare', importoCentesimi: 8800 });
  });

  it('una rata che scade oggi o entro 7 giorni è «in scadenza», non scaduta; oltre i 7 giorni non compare', () => {
    const voci = vociDaFare({ ...base, rate: [rata('2026-11-27', 100), rata('2026-12-04', 200), rata('2026-12-05', 400)] });
    expect(voci).toHaveLength(1);
    expect(voci[0]).toMatchObject({ chiave: 'rate_in_scadenza', tono: 'presto', testo: '2 rate scadono entro 7 giorni', importoCentesimi: 300 });
  });

  it('fatture d’acquisto non pagate e moduli in ritardo', () => {
    const voci = vociDaFare({
      ...base,
      fattureAcquisto: [{ pagata: false, totaleCentesimi: 12200 }, { pagata: true, totaleCentesimi: 5000 }],
      moduliInRitardo: 1,
    });
    expect(voci.map((v) => v.chiave)).toEqual(['moduli_in_ritardo', 'acquisti_da_pagare']);
    expect(voci[1]).toMatchObject({ testo: '1 fattura d’acquisto da pagare', importoCentesimi: 12200, vaiA: '/fornitori' });
    expect(voci[0].testo).toBe('1 modulo in ritardo o con ore sforate');
  });

  it('dati non letti (null) non diventano «niente da fare» inventato: quelle voci mancano e basta', () => {
    const voci = vociDaFare({ oggi: OGGI, rate: null, fattureAcquisto: null, moduliInRitardo: 2 });
    expect(voci.map((v) => v.chiave)).toEqual(['moduli_in_ritardo']);
  });

  it('prima ciò che è già tardi, poi ciò che scade, poi il resto', () => {
    const voci = vociDaFare({
      ...base,
      rate: [rata('2026-11-30', 100), rata('2026-11-01', 100)],
      fattureAcquisto: [{ pagata: false, totaleCentesimi: 1 }],
    });
    expect(voci.map((v) => v.tono)).toEqual(['urgente', 'presto', 'info']);
  });

  // Titolare, 28/11/2026 (risposta 9): il canone Retainer non si fattura da solo, lo si ricorda qui.
  describe('canoni Retainer da fatturare', () => {
    const contratto = (prossimaFatturazione: string | null, extra: Record<string, unknown> = {}) =>
      ({ stato: 'attivo', prossimaFatturazione, importoCentesimi: 50000, ...extra });

    it('contratto attivo con la data arrivata (oggi compreso) → una riga che porta ai Retainer', () => {
      const giornoDiOggi = OGGI.toISOString().slice(0, 10);
      const voci = vociDaFare({ ...base, contratti: [contratto('2026-10-01T00:00:00.000Z'), contratto(`${giornoDiOggi}T00:00:00.000Z`)] });
      expect(voci).toHaveLength(1);
      expect(voci[0]).toMatchObject({
        chiave: 'canoni_da_fatturare', testo: '2 canoni Retainer da fatturare', importoCentesimi: 100000, vaiA: '/retainers',
      });
    });

    it('data futura, contratto non attivo o senza data → niente riga', () => {
      const voci = vociDaFare({
        ...base,
        contratti: [contratto('2099-01-01T00:00:00.000Z'), contratto('2026-10-01T00:00:00.000Z', { stato: 'sospeso' }), contratto(null)],
      });
      expect(voci).toEqual([]);
    });

    it('contratti non letti (null) → la voce manca, non vale «nessun canone»', () => {
      expect(vociDaFare({ ...base, contratti: null })).toEqual([]);
    });
  });
});
