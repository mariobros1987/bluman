/**
 * KYC K1 — presidio del service di transizione (spec §8): valida col motore, applica il gate MLRO,
 * persiste ed emette un ComplianceEvent in catena. Store finto, nessun DB.
 */
import { describe, it, expect } from 'vitest';
import { transizioneKyc, type KycStore } from './kycCaseService.js';
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

describe('registraComplianceEvent — catena', () => {
  it('aggancia l’hash al precedente e persiste createdAt = istante firmato', async () => {
    const eventi: any[] = [];
    const store = { complianceEvent: { findFirst: async () => ({ hash: 'PREV' }), create: async (a: any) => { eventi.push(a.data); return a.data; } } };
    const r = await registraComplianceEvent(store, { tenantId: 't1', tipo: 'X', payload: { a: 1 } });
    expect(r.hashPrecedente).toBe('PREV');
    expect(eventi[0].hash).toBe(calcolaHashEvento({ tipo: 'X', payload: { a: 1 }, createdAt: r.createdAt, hashPrecedente: 'PREV' }));
    expect(eventi[0].createdAt).toEqual(new Date(r.createdAt));
  });
});
