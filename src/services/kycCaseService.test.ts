/**
 * KYC K1 — presidio del service di transizione (spec §8): valida col motore, applica il gate MLRO,
 * persiste ed emette un ComplianceEvent in catena. Store finto, nessun DB.
 */
import { describe, it, expect } from 'vitest';
import {
  transizioneKyc,
  transizioneKycConGate,
  valutaApprovazione,
  puoApprovareRafforzata,
  motivoRifiutoApprovazione,
  type KycStore,
  type KycStoreConScreening,
} from './kycCaseService.js';
import { calcolaHashEvento } from './complianceService.js';
import { registraComplianceEvent } from './complianceEventLog.js';

function fakeStore(fascicolo: any, lastEvent: { hash: string } | null = null) {
  const updated: any[] = [];
  const eventi: any[] = [];
  const store: KycStore = {
    fascicoloKyc: {
      findFirst: async () => fascicolo,
      update: async (args: any) => { updated.push(args); return { id: args.where.id, stato: args.data.stato }; },
    },
    complianceEvent: {
      findFirst: async () => lastEvent,
      create: async (args: any) => { eventi.push(args.data); return args.data; },
    },
  };
  return { store, updated, eventi };
}

const base = { id: 'f1', noteCompliance: null };

describe('transizioneKyc', () => {
  it('esegue una transizione valida, persiste e appende un ComplianceEvent', async () => {
    const { store, updated, eventi } = fakeStore({ ...base, stato: 'in_attesa_approvazione', rischioCalcolato: 'basso' });
    const esito = await transizioneKyc(store, {
      tenantId: 't1', fascicoloId: 'f1', nuovoStato: 'approvato', attoreUserId: 'u1', puoApprovareRafforzata: false,
      campiApprovazione: { approvatoDa: 'u1' },
    });
    expect(esito.esito).toBe('ok');
    expect(updated[0].data.stato).toBe('approvato');
    expect(updated[0].data.approvatoDa).toBe('u1'); // campiApprovazione applicati solo su 'approvato'
    expect(eventi).toHaveLength(1);
    expect(eventi[0].tipo).toBe('KYC_TRANSIZIONE_STATO');
    expect(eventi[0].payload).toEqual({ fascicoloId: 'f1', da: 'in_attesa_approvazione', a: 'approvato' });
  });

  it('rifiuta un salto non ammesso senza scrivere nulla', async () => {
    const { store, updated, eventi } = fakeStore({ ...base, stato: 'bozza', rischioCalcolato: 'basso' });
    const esito = await transizioneKyc(store, { tenantId: 't1', fascicoloId: 'f1', nuovoStato: 'approvato', puoApprovareRafforzata: true });
    expect(esito).toMatchObject({ esito: 'transizione_non_valida', da: 'bozza', a: 'approvato' });
    expect(updated).toHaveLength(0);
    expect(eventi).toHaveLength(0);
  });

  it('blocca l’approvazione di un rischio alto senza potere MLRO (§8.3)', async () => {
    const { store, updated } = fakeStore({ ...base, stato: 'in_attesa_approvazione', rischioCalcolato: 'alto' });
    const esito = await transizioneKyc(store, { tenantId: 't1', fascicoloId: 'f1', nuovoStato: 'approvato', puoApprovareRafforzata: false });
    expect(esito.esito).toBe('serve_mlro');
    expect(updated).toHaveLength(0);
  });

  it('consente l’approvazione del rischio alto con potere MLRO', async () => {
    const { store } = fakeStore({ ...base, stato: 'in_attesa_approvazione', rischioCalcolato: 'alto' });
    const esito = await transizioneKyc(store, { tenantId: 't1', fascicoloId: 'f1', nuovoStato: 'approvato', puoApprovareRafforzata: true });
    expect(esito.esito).toBe('ok');
  });

  it('blocca l’approvazione con uno screening a match non risolto (§8.4), senza scrivere', async () => {
    const { store, updated } = fakeStore({ ...base, stato: 'in_attesa_approvazione', rischioCalcolato: 'basso' });
    const esito = await transizioneKyc(store, { tenantId: 't1', fascicoloId: 'f1', nuovoStato: 'approvato', puoApprovareRafforzata: true, screeningBloccante: true });
    expect(esito.esito).toBe('screening_bloccante');
    expect(updated).toHaveLength(0);
  });

  it('screeningBloccante gate SOLO l’approvazione: una transizione diversa passa', async () => {
    const { store } = fakeStore({ ...base, stato: 'in_verifica', rischioCalcolato: 'basso' });
    const esito = await transizioneKyc(store, { tenantId: 't1', fascicoloId: 'f1', nuovoStato: 'sospeso', puoApprovareRafforzata: false, screeningBloccante: true });
    expect(esito.esito).toBe('ok');
  });

  it('normalizza lo stato legacy di partenza (in_attesa_revisione → in_attesa_approvazione)', async () => {
    const { store, updated } = fakeStore({ ...base, stato: 'in_attesa_revisione', rischioCalcolato: 'basso' });
    const esito = await transizioneKyc(store, { tenantId: 't1', fascicoloId: 'f1', nuovoStato: 'approvato', puoApprovareRafforzata: true });
    expect(esito.esito).toBe('ok');
    expect(updated[0].data.storico.create.statoPrecedente).toBe('in_attesa_revisione'); // storico conserva il valore reale
  });

  it('404 quando la pratica non esiste', async () => {
    const { store } = fakeStore(null);
    const esito = await transizioneKyc(store, { tenantId: 't1', fascicoloId: 'x', nuovoStato: 'approvato', puoApprovareRafforzata: true });
    expect(esito.esito).toBe('non_trovato');
  });
});

// La porta condivisa: gli stessi gate della rotta singola, ma estratti perché anche la coda
// massiva li usi. Le due strade non devono poter divergere, quindi qui si presidia che i motivi
// mostrati dalla coda (`valutaApprovazione`) coincidano con gli esiti reali della transizione.
function fakeStoreConGate(fascicolo: any, screenings: any[] = []) {
  const updated: any[] = [];
  const eventi: any[] = [];
  const store: KycStoreConScreening = {
    fascicoloKyc: {
      findFirst: async () => fascicolo,
      update: async (args: any) => { updated.push(args); return { id: args.where.id, stato: args.data.stato }; },
    },
    screeningKyc: { findMany: async () => screenings },
    complianceEvent: {
      findFirst: async () => null,
      create: async (args: any) => { eventi.push(args.data); return args.data; },
    },
  };
  return { store, updated, eventi };
}

const fascicoloBase = { id: 'f1', noteCompliance: null, livelloVerifica: 'ordinaria', rischioCalcolato: 'basso', stato: 'in_attesa_approvazione' };
const impostazioni = { regulatoryProfile: 'Malta AMLA', mlroUserId: 'mlro-1', retentionYears: 5 };

describe('transizioneKycConGate', () => {
  it('rifiuta l’approvazione senza profilo regolatorio (§8.2) e non scrive nulla', async () => {
    const { store, updated } = fakeStoreConGate(fascicoloBase);
    const esito = await transizioneKycConGate(store, {
      tenantId: 't1', fascicoloId: 'f1', nuovoStato: 'approvato', attoreUserId: 'u1', ruolo: 'advisor',
      settings: { ...impostazioni, regulatoryProfile: null },
    });
    expect(esito.esito).toBe('profilo_mancante');
    expect(updated).toHaveLength(0);
  });

  it('il profilo regolatorio gate SOLO l’approvazione: un’altra transizione passa', async () => {
    const { store } = fakeStoreConGate({ ...fascicoloBase, stato: 'in_verifica' });
    const esito = await transizioneKycConGate(store, {
      tenantId: 't1', fascicoloId: 'f1', nuovoStato: 'in_attesa_approvazione', ruolo: 'advisor',
      settings: { ...impostazioni, regulatoryProfile: null },
    });
    expect(esito.esito).toBe('ok');
  });

  it('legge gli screening e blocca con il motivo in chiaro (§8.4)', async () => {
    const { store, updated } = fakeStoreConGate(fascicoloBase, [
      { tipo: 'sanzioni', esito: 'match_da_valutare', dataScreening: new Date('2026-10-01') },
    ]);
    const esito = await transizioneKycConGate(store, {
      tenantId: 't1', fascicoloId: 'f1', nuovoStato: 'approvato', attoreUserId: 'u1', ruolo: 'advisor', settings: impostazioni,
    });
    expect(esito.esito).toBe('screening_bloccante');
    if (esito.esito === 'screening_bloccante') expect(esito.motivo).toContain('sanzioni');
    expect(updated).toHaveLength(0);
  });

  it('uno screening risolto NON blocca: approva e calcola verifica/scadenza', async () => {
    const { store, updated } = fakeStoreConGate(fascicoloBase, [
      { tipo: 'pep', esito: 'falso_positivo', dataScreening: new Date('2026-10-01') },
    ]);
    const esito = await transizioneKycConGate(store, {
      tenantId: 't1', fascicoloId: 'f1', nuovoStato: 'approvato', attoreUserId: 'u1', ruolo: 'advisor', settings: impostazioni,
    });
    expect(esito.esito).toBe('ok');
    const dati = updated[0].data;
    expect(dati.approvatoDa).toBe('u1');
    expect(dati.dataVerifica).toBeInstanceOf(Date);
    expect(dati.dataScadenza).toBeInstanceOf(Date);
    expect((dati.dataScadenza as Date).getTime()).toBeGreaterThan(Date.now());
  });

  it('il rischio alto resta all’MLRO anche passando dalla porta (§8.3)', async () => {
    const { store, updated } = fakeStoreConGate({ ...fascicoloBase, rischioCalcolato: 'alto' });
    const esito = await transizioneKycConGate(store, {
      tenantId: 't1', fascicoloId: 'f1', nuovoStato: 'approvato', attoreUserId: 'u1', ruolo: 'collaboratore_interno', settings: impostazioni,
    });
    expect(esito.esito).toBe('serve_mlro');
    expect(updated).toHaveLength(0);

    const conMlro = await transizioneKycConGate(store, {
      tenantId: 't1', fascicoloId: 'f1', nuovoStato: 'approvato', attoreUserId: 'mlro-1', ruolo: 'collaboratore_interno', settings: impostazioni,
    });
    expect(conMlro.esito).toBe('ok');
  });

  it('alla chiusura calcola la conservazione (K9)', async () => {
    const { store, updated } = fakeStoreConGate({ ...fascicoloBase, stato: 'approvato' });
    const esito = await transizioneKycConGate(store, {
      tenantId: 't1', fascicoloId: 'f1', nuovoStato: 'chiuso', attoreUserId: 'u1', ruolo: 'advisor', settings: impostazioni,
    });
    expect(esito.esito).toBe('ok');
    expect(updated[0].data.retentionScadenza).toBeInstanceOf(Date);
    expect(updated[0].data.chiusoAt).toBeInstanceOf(Date);
  });
});

describe('puoApprovareRafforzata', () => {
  it('advisor e super_admin sempre; gli altri solo se sono l’MLRO nominato', () => {
    expect(puoApprovareRafforzata('advisor', 'u1', 'mlro-1')).toBe(true);
    expect(puoApprovareRafforzata('super_admin', 'u1', null)).toBe(true);
    expect(puoApprovareRafforzata('collaboratore_interno', 'mlro-1', 'mlro-1')).toBe(true);
    expect(puoApprovareRafforzata('collaboratore_interno', 'u1', 'mlro-1')).toBe(false);
    expect(puoApprovareRafforzata('collaboratore_interno', null, 'mlro-1')).toBe(false);
  });
});

describe('valutaApprovazione — coerenza con la transizione', () => {
  const casi = [
    { nome: 'tutto a posto', stato: 'in_attesa_approvazione', rischio: 'basso' as const, profilo: true, rafforzata: false, screening: false, atteso: 'ok' },
    { nome: 'profilo mancante', stato: 'in_attesa_approvazione', rischio: 'basso' as const, profilo: false, rafforzata: true, screening: false, atteso: 'profilo_mancante' },
    { nome: 'stato non approvabile', stato: 'in_verifica', rischio: 'basso' as const, profilo: true, rafforzata: true, screening: false, atteso: 'transizione_non_valida' },
    { nome: 'alto rischio senza MLRO', stato: 'in_attesa_approvazione', rischio: 'alto' as const, profilo: true, rafforzata: false, screening: false, atteso: 'serve_mlro' },
    { nome: 'screening aperto', stato: 'in_attesa_approvazione', rischio: 'basso' as const, profilo: true, rafforzata: true, screening: true, atteso: 'screening_bloccante' },
    { nome: 'in revisione periodica', stato: 'in_revisione', rischio: 'basso' as const, profilo: true, rafforzata: false, screening: false, atteso: 'ok' },
  ];

  for (const caso of casi) {
    it(`${caso.nome}: «approvabile» e l’esito reale dicono la stessa cosa`, async () => {
      const valutazione = valutaApprovazione({
        stato: caso.stato,
        rischio: caso.rischio,
        profiloConfigurato: caso.profilo,
        puoApprovareRafforzata: caso.rafforzata,
        screeningNonRisolto: caso.screening,
      });
      expect(valutazione.approvabile).toBe(caso.atteso === 'ok');
      if (caso.atteso !== 'ok') expect(valutazione.motivi.length).toBeGreaterThan(0);

      const screenings = caso.screening
        ? [{ tipo: 'pep', esito: 'match_confermato', dataScreening: new Date('2026-10-01') }]
        : [];
      const { store } = fakeStoreConGate({ ...fascicoloBase, stato: caso.stato, rischioCalcolato: caso.rischio }, screenings);
      const esito = await transizioneKycConGate(store, {
        tenantId: 't1', fascicoloId: 'f1', nuovoStato: 'approvato', attoreUserId: caso.rafforzata ? 'mlro-1' : 'u1', ruolo: 'collaboratore_interno',
        settings: { ...impostazioni, regulatoryProfile: caso.profilo ? impostazioni.regulatoryProfile : null },
      });
      expect(esito.esito).toBe(caso.atteso);
    });
  }

  it('la coda spiega ogni blocco, non solo il primo', () => {
    const v = valutaApprovazione({ stato: 'in_raccolta', rischio: 'alto', profiloConfigurato: false, puoApprovareRafforzata: false, screeningNonRisolto: true });
    expect(v.approvabile).toBe(false);
    expect(v.motivi).toHaveLength(4);
  });
});

describe('motivoRifiutoApprovazione', () => {
  it('traduce ogni esito in una frase (la coda non mostra codici)', () => {
    expect(motivoRifiutoApprovazione({ esito: 'non_trovato' })).toContain('non trovato');
    expect(motivoRifiutoApprovazione({ esito: 'stato_ignoto', valore: 'x' })).toContain('x');
    expect(motivoRifiutoApprovazione({ esito: 'transizione_non_valida', da: 'bozza', a: 'approvato' })).toContain('bozza');
    expect(motivoRifiutoApprovazione({ esito: 'serve_mlro' })).toContain('MLRO');
    expect(motivoRifiutoApprovazione({ esito: 'screening_bloccante' })).toContain('Screening');
    expect(motivoRifiutoApprovazione({ esito: 'profilo_mancante' })).toContain('Profilo');
  });
});

describe('registraComplianceEvent — catena', () => {  it('aggancia l’hash al precedente e persiste createdAt = istante firmato', async () => {
    const eventi: any[] = [];
    const store = { complianceEvent: { findFirst: async () => ({ hash: 'PREV' }), create: async (a: any) => { eventi.push(a.data); return a.data; } } };
    const r = await registraComplianceEvent(store, { tenantId: 't1', tipo: 'X', payload: { a: 1 } });
    expect(r.hashPrecedente).toBe('PREV');
    expect(eventi[0].hash).toBe(calcolaHashEvento({ tipo: 'X', payload: { a: 1 }, createdAt: r.createdAt, hashPrecedente: 'PREV' }));
    expect(eventi[0].createdAt).toEqual(new Date(r.createdAt));
  });
});
