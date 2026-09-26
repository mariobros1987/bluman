/**
 * K9/§5.5 — presidio del builder del report fascicolo (regole pure). Nessun DB.
 */
import { describe, it, expect } from 'vitest';
import { costruisciReportFascicolo, type DatiReportFascicolo } from './reportFascicolo.js';

const DATI: DatiReportFascicolo = {
  studio: { ragioneSociale: 'Bluecode Ltd', partitaIva: 'MT1', mlroUserId: 'mlro1' },
  fascicolo: {
    stato: 'chiuso', livelloVerifica: 'rafforzata', rischioCalcolato: 'alto',
    dataVerifica: new Date('2024-01-01T00:00:00Z'), dataScadenza: new Date('2025-01-01T00:00:00Z'),
    chiusoAt: new Date('2025-06-01T00:00:00Z'), retentionScadenza: new Date('2030-06-01T00:00:00Z'), retentionEsito: null,
    paeseResidenza: 'MT', pep: true,
  },
  soggetto: { denominazione: 'Acme SRL', tipo: 'persona_giuridica', codiceFiscale: 'CF' },
  titolariEffettivi: [{ criterio: 'proprieta', percentuale: '30', fonte: 'registro', soggetto: { denominazione: 'Mario Rossi' } }],
  rischio: { livelloComplessivo: 'alto', clienteLivello: 'alto', geografiaLivello: 'medio', prodottoLivello: 'basso', canaleLivello: 'medio', motivazioneComplessiva: 'struttura opaca' },
  screening: [{ tipo: 'sanzioni', esito: 'nessun_match', dataScreening: new Date('2024-02-01T00:00:00Z'), matchDettagli: null, notaRisoluzione: null }],
  anomalie: [{ tipo: 'operazione_sospetta', descrizione: 'flusso incoerente', stato: 'segnalata_fiau', decisioni: [{ decisione: 'segnalazione_fiau', motivazione: 'match confermato' }] }],
  segnalazioni: [{ stato: 'trasmessa', riferimentoGoaml: 'goAML-1', trasmessaAt: new Date('2025-03-01T00:00:00Z') }],
  storico: [{ statoPrecedente: 'approvato', statoNuovo: 'chiuso', motivazione: 'rapporto concluso', createdAt: new Date('2025-06-01T00:00:00Z') }],
};

describe('K9 — reportFascicolo (builder puro §5.5)', () => {
  it('assembla tutte le sezioni dai dati caricati', () => {
    const r = costruisciReportFascicolo(DATI, '2026-09-26T12:00:00.000Z');
    expect(r.studio.ragioneSociale).toBe('Bluecode Ltd');
    expect(r.fascicolo.stato).toBe('chiuso');
    expect(r.fascicolo.retentionScadenza).toBe('2030-06-01T00:00:00.000Z');
    expect(r.soggetto.pep).toBe(true);
    expect(r.titolariEffettivi[0]).toMatchObject({ denominazione: 'Mario Rossi', percentuale: '30' });
    expect(r.rischio?.livelloComplessivo).toBe('alto');
    expect(r.anomalie[0]).toMatchObject({ stato: 'segnalata_fiau', decisione: 'segnalazione_fiau' });
    expect(r.segnalazioni[0]).toMatchObject({ stato: 'trasmessa', riferimentoGoaml: 'goAML-1' });
    expect(r.storico[0]).toMatchObject({ statoNuovo: 'chiuso' });
  });

  it('regge sezioni vuote / soggetto e rischio assenti', () => {
    const r = costruisciReportFascicolo(
      { ...DATI, soggetto: null, rischio: null, titolariEffettivi: [], screening: [], anomalie: [], segnalazioni: [], storico: [] },
      '2026-09-26T12:00:00.000Z',
    );
    expect(r.soggetto.denominazione).toBeNull();
    expect(r.rischio).toBeNull();
    expect(r.anomalie).toHaveLength(0);
    expect(r.storico).toHaveLength(0);
  });
});
