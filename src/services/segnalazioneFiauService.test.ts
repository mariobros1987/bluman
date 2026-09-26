/**
 * K8b — presidio del service segnalazione FIAU (STR). Store finto, nessun DB.
 * Verifica: preparazione solo da anomalia segnalata_fiau, riprepara prima dell'invio, blocco dopo
 * l'invio, registrazione del riferimento goAML, e che ogni passo appenda un ComplianceEvent.
 */
import { describe, it, expect } from 'vitest';
import { preparaSegnalazione, registraTrasmissione, type SegnalazioneStore } from './segnalazioneFiauService.js';
import type { DatiFascicoloPerDossier } from '../domain/segnalazioneFiau.js';

const DATI: DatiFascicoloPerDossier = {
  studio: { ragioneSociale: 'Bluecode Ltd', partitaIva: 'MT1', mlroUserId: 'mlro1' },
  soggetto: { denominazione: 'Acme SRL', tipo: 'persona_giuridica', codiceFiscale: 'CF' },
  fascicolo: { paeseResidenza: 'MT', pep: false },
  titolariEffettivi: [],
  rischio: null,
  screening: [],
  anomalia: { tipo: 'operazione_sospetta', descrizione: 'flusso incoerente', createdAt: new Date('2026-09-20T10:00:00Z') },
  decisione: { decisione: 'segnalazione_fiau', motivazione: 'match confermato', createdAt: new Date('2026-09-21T10:00:00Z') },
};

function fakeStore(esistente: any = null) {
  const created: any[] = [];
  const updated: any[] = [];
  const eventi: any[] = [];
  let riga: any = esistente;
  const store: SegnalazioneStore = {
    segnalazioneFiau: {
      findUnique: async () => riga,
      findFirst: async () => riga,
      create: async (args: any) => { created.push(args.data); riga = { id: 'str1', stato: 'preparata', ...args.data }; return riga; },
      update: async (args: any) => { updated.push(args); riga = { ...riga, ...args.data }; return riga; },
    },
    complianceEvent: { findFirst: async () => null, create: async (args: any) => { eventi.push(args.data); return args.data; } },
  };
  return { store, created, updated, eventi };
}

describe('segnalazioneFiauService (K8b)', () => {
  it('prepara la segnalazione da un’anomalia segnalata_fiau, crea la riga e appende l’evento', async () => {
    const { store, created, eventi } = fakeStore(null);
    const esito = await preparaSegnalazione(store, { tenantId: 't1', anomalia: { id: 'an1', stato: 'segnalata_fiau', fascicoloId: 'f1' }, dati: DATI, preparataDa: 'mlro1' });
    expect(esito.esito).toBe('ok');
    expect(created[0]).toMatchObject({ tenantId: 't1', anomaliaId: 'an1', fascicoloId: 'f1' });
    expect(created[0].datiPreparatiJson).toBeTruthy();
    expect(eventi[0].tipo).toBe('KYC_STR_PREPARATA');
  });

  it('non_segnalabile se l’anomalia non è in stato segnalata_fiau, senza scrivere', async () => {
    const { store, created, eventi } = fakeStore(null);
    const esito = await preparaSegnalazione(store, { tenantId: 't1', anomalia: { id: 'an1', stato: 'aperta', fascicoloId: 'f1' }, dati: DATI });
    expect(esito.esito).toBe('non_segnalabile');
    expect(created).toHaveLength(0);
    expect(eventi).toHaveLength(0);
  });

  it('riprepara (update) se esiste ed è ancora preparata, senza crearne una seconda', async () => {
    const { store, created, updated } = fakeStore({ id: 'str1', tenantId: 't1', anomaliaId: 'an1', fascicoloId: 'f1', stato: 'preparata' });
    const esito = await preparaSegnalazione(store, { tenantId: 't1', anomalia: { id: 'an1', stato: 'segnalata_fiau', fascicoloId: 'f1' }, dati: DATI });
    expect(esito.esito).toBe('ok');
    expect(created).toHaveLength(0);
    expect(updated[0].data.datiPreparatiJson).toBeTruthy();
  });

  it('gia_trasmessa se la segnalazione esistente è già stata trasmessa', async () => {
    const { store, updated } = fakeStore({ id: 'str1', tenantId: 't1', anomaliaId: 'an1', fascicoloId: 'f1', stato: 'trasmessa' });
    const esito = await preparaSegnalazione(store, { tenantId: 't1', anomalia: { id: 'an1', stato: 'segnalata_fiau', fascicoloId: 'f1' }, dati: DATI });
    expect(esito.esito).toBe('gia_trasmessa');
    expect(updated).toHaveLength(0);
  });

  it('registra la trasmissione, porta lo stato a trasmessa e appende l’evento', async () => {
    const { store, updated, eventi } = fakeStore({ id: 'str1', tenantId: 't1', anomaliaId: 'an1', fascicoloId: 'f1', stato: 'preparata' });
    const esito = await registraTrasmissione(store, { tenantId: 't1', segnalazioneId: 'str1', riferimentoGoaml: '  goAML-2026-000123  ', trasmessaDa: 'mlro1' });
    expect(esito.esito).toBe('ok');
    expect(updated[0].data.stato).toBe('trasmessa');
    expect(updated[0].data.riferimentoGoaml).toBe('goAML-2026-000123'); // trimmed
    expect(updated[0].data.trasmessaAt).toBeInstanceOf(Date);
    expect(eventi[0].tipo).toBe('KYC_STR_TRASMESSA');
  });

  it('non_trovata se la segnalazione non esiste', async () => {
    const { store } = fakeStore(null);
    const esito = await registraTrasmissione(store, { tenantId: 't1', segnalazioneId: 'x', riferimentoGoaml: 'goAML-1' });
    expect(esito.esito).toBe('non_trovata');
  });

  it('gia_trasmessa alla seconda registrazione', async () => {
    const { store } = fakeStore({ id: 'str1', tenantId: 't1', anomaliaId: 'an1', fascicoloId: 'f1', stato: 'trasmessa' });
    const esito = await registraTrasmissione(store, { tenantId: 't1', segnalazioneId: 'str1', riferimentoGoaml: 'goAML-2' });
    expect(esito.esito).toBe('gia_trasmessa');
  });

  it('riferimento_non_valido se il riferimento è troppo corto, senza scrivere', async () => {
    const { store, updated } = fakeStore({ id: 'str1', tenantId: 't1', anomaliaId: 'an1', fascicoloId: 'f1', stato: 'preparata' });
    const esito = await registraTrasmissione(store, { tenantId: 't1', segnalazioneId: 'str1', riferimentoGoaml: 'ab' });
    expect(esito.esito).toBe('riferimento_non_valido');
    expect(updated).toHaveLength(0);
  });
});
