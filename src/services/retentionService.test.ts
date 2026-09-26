/**
 * K9 — presidio del service retention (spec §5.4/§8.9). Store finto, nessun DB.
 * Verifica: anonimizzazione reale del PII prima dell'etichetta, cancellato senza toccare i dati,
 * gate «solo a scadenza» e «non due volte», proroga solo in avanti, e ComplianceEvent ad ogni passo.
 */
import { describe, it, expect } from 'vitest';
import { registraEsitoRetention, prorogaRetention, type RetentionStore } from './retentionService.js';

const PASSATO = new Date('2020-01-01T00:00:00Z'); // scadenza già passata
const FUTURO = new Date('2999-01-01T00:00:00Z');  // scadenza lontana

function fakeStore(riga: any) {
  const fascUpdates: any[] = [];
  const soggUpdates: any[] = [];
  const docUpdates: any[] = [];
  const eventi: any[] = [];
  const ordine: string[] = [];
  let corrente = riga;
  const store: RetentionStore = {
    fascicoloKyc: {
      findFirst: async () => corrente,
      update: async (args: any) => { fascUpdates.push(args.data); ordine.push('fasc'); corrente = { ...corrente, ...args.data }; return corrente; },
    },
    soggettoKyc: { update: async (args: any) => { soggUpdates.push(args); ordine.push('sogg'); return args.data; } },
    documentoIdentita: { updateMany: async (args: any) => { docUpdates.push(args); ordine.push('doc'); return { count: 1 }; } },
    complianceEvent: { findFirst: async () => null, create: async (args: any) => { eventi.push(args.data); return args.data; } },
  };
  return { store, fascUpdates, soggUpdates, docUpdates, eventi, ordine };
}

const RIGA = (over: any = {}) => ({ id: 'f1', tenantId: 't1', soggettoId: 's1', chiusoAt: new Date('2015-01-01T00:00:00Z'), retentionScadenza: PASSATO, retentionProrogaAl: null, retentionEsito: null, ...over });

describe('retentionService (K9)', () => {
  it('anonimizzato a scadenza: azzera il PII PRIMA di marcare l’esito, poi ComplianceEvent', async () => {
    const { store, fascUpdates, soggUpdates, docUpdates, eventi, ordine } = fakeStore(RIGA());
    const r = await registraEsitoRetention(store, { tenantId: 't1', fascicoloId: 'f1', esito: 'anonimizzato', decisoDa: 'mlro1' });
    expect(r.esito).toBe('ok');
    // svuota fascicolo, soggetto e documenti
    expect(fascUpdates[0]).toMatchObject({ noteCompliance: null, paeseResidenza: null, paeseRischio: null });
    expect(soggUpdates[0].data).toMatchObject({ denominazione: '[anonimizzato]', codiceFiscale: null });
    expect(docUpdates[0].data).toMatchObject({ numero: null });
    // l'etichetta (retentionEsito) è l'ULTIMA scrittura sul fascicolo
    expect(ordine).toEqual(['fasc', 'sogg', 'doc', 'fasc']);
    expect(fascUpdates[1]).toMatchObject({ retentionEsito: 'anonimizzato' });
    expect(eventi[0].tipo).toBe('KYC_RETENTION_ESITO');
  });

  it('cancellato a scadenza: registra l’etichetta senza toccare soggetto/documenti', async () => {
    const { store, soggUpdates, docUpdates, fascUpdates, eventi } = fakeStore(RIGA());
    const r = await registraEsitoRetention(store, { tenantId: 't1', fascicoloId: 'f1', esito: 'cancellato', decisoDa: 'mlro1' });
    expect(r.esito).toBe('ok');
    expect(soggUpdates).toHaveLength(0);
    expect(docUpdates).toHaveLength(0);
    expect(fascUpdates[0]).toMatchObject({ retentionEsito: 'cancellato' });
    expect(eventi[0].tipo).toBe('KYC_RETENTION_ESITO');
  });

  it('non_scaduta se la scadenza è futura, senza scrivere (§8.9)', async () => {
    const { store, fascUpdates, eventi } = fakeStore(RIGA({ retentionScadenza: FUTURO }));
    const r = await registraEsitoRetention(store, { tenantId: 't1', fascicoloId: 'f1', esito: 'anonimizzato' });
    expect(r.esito).toBe('non_scaduta');
    expect(fascUpdates).toHaveLength(0);
    expect(eventi).toHaveLength(0);
  });

  it('gia_conclusa se un esito è già registrato', async () => {
    const { store, fascUpdates } = fakeStore(RIGA({ retentionEsito: 'anonimizzato' }));
    const r = await registraEsitoRetention(store, { tenantId: 't1', fascicoloId: 'f1', esito: 'cancellato' });
    expect(r.esito).toBe('gia_conclusa');
    expect(fascUpdates).toHaveLength(0);
  });

  it('non_trovato se il fascicolo non esiste', async () => {
    const { store } = fakeStore(null);
    const r = await registraEsitoRetention(store, { tenantId: 't1', fascicoloId: 'x', esito: 'cancellato' });
    expect(r.esito).toBe('non_trovato');
  });

  it('proroga sposta la scadenza in avanti e appende l’evento', async () => {
    const { store, fascUpdates, eventi } = fakeStore(RIGA());
    const nuova = new Date('2030-01-01T00:00:00Z');
    const r = await prorogaRetention(store, { tenantId: 't1', fascicoloId: 'f1', prorogaAl: nuova, motivo: 'contenzioso in corso', decisoDa: 'mlro1' });
    expect(r.esito).toBe('ok');
    expect(fascUpdates[0].retentionProrogaAl).toEqual(nuova);
    expect(new Date(fascUpdates[0].retentionScadenza).toISOString()).toBe(nuova.toISOString());
    expect(eventi[0].tipo).toBe('KYC_RETENTION_PROROGA');
  });

  it('proroga rifiutata se il fascicolo non è in conservazione', async () => {
    const { store } = fakeStore(RIGA({ chiusoAt: null, retentionScadenza: null }));
    const r = await prorogaRetention(store, { tenantId: 't1', fascicoloId: 'f1', prorogaAl: new Date('2030-01-01T00:00:00Z'), motivo: 'contenzioso in corso' });
    expect(r.esito).toBe('non_in_conservazione');
  });
});
