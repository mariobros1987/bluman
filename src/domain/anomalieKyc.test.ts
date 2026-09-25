import { describe, it, expect } from 'vitest';
import {
  statoDaDecisione,
  anomaliaAperta,
  richiedeSegnalazioneFiau,
  etichettaDecisione,
  type DecisioneMlro,
} from './anomalieKyc.js';

describe('K8a — anomalieKyc (regole pure §5.3)', () => {
  it('ogni decisione MLRO mappa allo stato terminale giusto', () => {
    expect(statoDaDecisione('nessuna_azione')).toBe('chiusa_nessuna_azione');
    expect(statoDaDecisione('monitoraggio_rafforzato')).toBe('monitoraggio_rafforzato');
    expect(statoDaDecisione('segnalazione_fiau')).toBe('segnalata_fiau');
    expect(statoDaDecisione('chiusura_rapporto')).toBe('rapporto_chiuso');
  });

  it('nessuno stato terminale resta "aperto"', () => {
    const decisioni: DecisioneMlro[] = ['nessuna_azione', 'monitoraggio_rafforzato', 'segnalazione_fiau', 'chiusura_rapporto'];
    for (const d of decisioni) expect(anomaliaAperta(statoDaDecisione(d))).toBe(false);
  });

  it('aperta e in_valutazione sono gli stati "da lavorare"', () => {
    expect(anomaliaAperta('aperta')).toBe(true);
    expect(anomaliaAperta('in_valutazione')).toBe(true);
    expect(anomaliaAperta('segnalata_fiau')).toBe(false);
    expect(anomaliaAperta('rapporto_chiuso')).toBe(false);
  });

  it('solo la decisione di segnalazione avvia il percorso goAML (K8b)', () => {
    expect(richiedeSegnalazioneFiau('segnalazione_fiau')).toBe(true);
    expect(richiedeSegnalazioneFiau('nessuna_azione')).toBe(false);
    expect(richiedeSegnalazioneFiau('chiusura_rapporto')).toBe(false);
  });

  it('le etichette delle decisioni sono leggibili (regola 12)', () => {
    expect(etichettaDecisione('segnalazione_fiau')).toBe('segnalazione alla FIAU');
    expect(etichettaDecisione('chiusura_rapporto')).toBe('chiusura del rapporto');
  });
});
