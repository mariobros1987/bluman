/**
 * K8a — presidio del service anomalie/decisioni MLRO (spec §5.3). Store finto, nessun DB.
 * Verifica cosa viene scritto e che ogni passo appenda un ComplianceEvent.
 */
import { describe, it, expect } from 'vitest';
import { apriAnomalia, decidiAnomalia, type AnomalieStore } from './anomalieService.js';

function fakeStore(anomalia: unknown = null) {
  const created: any[] = [];
  const decisioni: any[] = [];
  const eventi: any[] = [];
  const updated: any[] = [];
  const store: AnomalieStore = {
    anomaliaKyc: {
      create: async (args: any) => { created.push(args.data); return { id: 'an1', ...args.data }; },
      findFirst: async () => anomalia as any,
      update: async (args: any) => { updated.push(args); return { id: args.where.id, stato: args.data.stato }; },
    },
    mlroDecisionLog: { create: async (args: any) => { decisioni.push(args.data); return args.data; } },
    complianceEvent: { findFirst: async () => null, create: async (args: any) => { eventi.push(args.data); return args.data; } },
  };
  return { store, created, decisioni, eventi, updated };
}

describe('anomalieService (K8a)', () => {
  it('apre un’anomalia e appende un ComplianceEvent', async () => {
    const { store, created, eventi } = fakeStore();
    const a = await apriAnomalia(store, { tenantId: 't1', fascicoloId: 'f1', tipo: 'match_sanzioni', descrizione: 'match lista OFAC', rilevataDa: 'u1' });
    expect(a.id).toBe('an1');
    expect(created[0]).toMatchObject({ tenantId: 't1', fascicoloId: 'f1', tipo: 'match_sanzioni' });
    expect(eventi[0].tipo).toBe('KYC_ANOMALIA_APERTA');
  });

  it('registra la decisione MLRO, porta lo stato al terminale e appende l’evento', async () => {
    const { store, decisioni, updated, eventi } = fakeStore({ id: 'an1', tenantId: 't1', fascicoloId: 'f1', stato: 'aperta' });
    const esito = await decidiAnomalia(store, { tenantId: 't1', anomaliaId: 'an1', decisione: 'segnalazione_fiau', motivazione: 'match confermato: si segnala alla FIAU', decisaDa: 'mlro1' });
    expect(esito.esito).toBe('ok');
    expect(decisioni[0]).toMatchObject({ decisione: 'segnalazione_fiau', decisaDa: 'mlro1' });
    expect(updated[0].data.stato).toBe('segnalata_fiau');
    expect(eventi[0].tipo).toBe('KYC_MLRO_DECISIONE');
  });

  it('esito non_trovata se l’anomalia non esiste, senza scrivere', async () => {
    const { store, decisioni, updated } = fakeStore(null);
    const esito = await decidiAnomalia(store, { tenantId: 't1', anomaliaId: 'x', decisione: 'nessuna_azione', motivazione: 'nessun rischio reale rilevato' });
    expect(esito.esito).toBe('non_trovata');
    expect(decisioni).toHaveLength(0);
    expect(updated).toHaveLength(0);
  });
});
