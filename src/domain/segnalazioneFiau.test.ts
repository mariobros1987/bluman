/**
 * K8b — presidio delle regole pure della segnalazione FIAU (STR). Nessun DB.
 */
import { describe, it, expect } from 'vitest';
import {
  costruisciDossierStr,
  riferimentoGoamlValido,
  puoTrasmettere,
  etichettaStatoSegnalazione,
  type DatiFascicoloPerDossier,
} from './segnalazioneFiau.js';

const DATI: DatiFascicoloPerDossier = {
  studio: { ragioneSociale: 'Bluecode Ltd', partitaIva: 'MT12345', mlroUserId: 'mlro1' },
  soggetto: { denominazione: 'Acme SRL', tipo: 'persona_giuridica', codiceFiscale: 'CF123' },
  fascicolo: { paeseResidenza: 'MT', pep: true },
  titolariEffettivi: [{ criterio: 'proprieta', percentuale: '30', fonte: 'registro', soggetto: { denominazione: 'Mario Rossi' } }],
  rischio: { livelloComplessivo: 'alto', clienteLivello: 'alto', geografiaLivello: 'medio', prodottoLivello: 'basso', canaleLivello: 'medio', motivazioneComplessiva: 'struttura opaca' },
  screening: [{ tipo: 'sanzioni', esito: 'match_confermato', dataScreening: new Date('2026-09-01T00:00:00Z'), matchDettagli: 'lista OFAC', notaRisoluzione: null }],
  anomalia: { tipo: 'operazione_sospetta', descrizione: 'flusso incoerente col profilo', createdAt: new Date('2026-09-20T10:00:00Z') },
  decisione: { decisione: 'segnalazione_fiau', motivazione: 'match confermato, si segnala', createdAt: new Date('2026-09-21T10:00:00Z') },
};

describe('K8b — segnalazioneFiau (regole pure §5.3/§10)', () => {
  it('costruisciDossierStr assembla lo snapshot completo dai dati caricati', () => {
    const d = costruisciDossierStr(DATI, '2026-09-26T12:00:00.000Z');
    expect(d.preparatoIl).toBe('2026-09-26T12:00:00.000Z');
    expect(d.studio.ragioneSociale).toBe('Bluecode Ltd');
    expect(d.soggetto.pep).toBe(true);
    expect(d.titolariEffettivi[0]).toMatchObject({ denominazione: 'Mario Rossi', percentuale: '30' });
    expect(d.rischio?.livelloComplessivo).toBe('alto');
    expect(d.screening[0]).toMatchObject({ tipo: 'sanzioni', esito: 'match_confermato' });
    expect(d.screening[0]?.dataScreening).toBe('2026-09-01T00:00:00.000Z');
    expect(d.anomalia.descrizione).toBe('flusso incoerente col profilo');
    expect(d.decisioneMlro?.decisione).toBe('segnalazione_fiau');
  });

  it('è puro: stesso input → stesso output', () => {
    const a = costruisciDossierStr(DATI, '2026-09-26T12:00:00.000Z');
    const b = costruisciDossierStr(DATI, '2026-09-26T12:00:00.000Z');
    expect(a).toEqual(b);
  });

  it('regge soggetto/rischio/decisione assenti senza sollevare', () => {
    const d = costruisciDossierStr(
      { ...DATI, soggetto: null, rischio: null, decisione: null, titolariEffettivi: [], screening: [] },
      '2026-09-26T12:00:00.000Z',
    );
    expect(d.soggetto.denominazione).toBeNull();
    expect(d.rischio).toBeNull();
    expect(d.decisioneMlro).toBeNull();
    expect(d.titolariEffettivi).toHaveLength(0);
  });

  it('riferimentoGoamlValido: rifiuta vuoto/corto e troppo lungo, accetta plausibile', () => {
    expect(riferimentoGoamlValido('')).toBe(false);
    expect(riferimentoGoamlValido('  ')).toBe(false);
    expect(riferimentoGoamlValido('ab')).toBe(false);
    expect(riferimentoGoamlValido('goAML-2026-000123')).toBe(true);
    expect(riferimentoGoamlValido('x'.repeat(121))).toBe(false);
  });

  it('puoTrasmettere: solo una preparata, mai una già trasmessa', () => {
    expect(puoTrasmettere('preparata')).toBe(true);
    expect(puoTrasmettere('trasmessa')).toBe(false);
  });

  it('etichette esplicative (regola 12)', () => {
    expect(etichettaStatoSegnalazione('preparata')).toContain('attesa');
    expect(etichettaStatoSegnalazione('trasmessa')).toContain('FIAU');
  });
});
