// §7 — la lista dei dati senza i quali un documento fiscale non si compone, e il rifiuto che li
// nomina. Vive qui perché la usano in due: la guida in-app (`GET /tenant/anagrafica`) e il
// controllo prima di generare l'XML (`GET /invoices/:id/sdi-xml`, fascicolo del commercialista).
// Due copie della lista divergerebbero, ed è la classe di guasto di `src/canaliCoerenza.test.ts`.
import { describe, it, expect } from 'vitest';
import {
  CAMPI_ANAGRAFICA,
  anagraficaCompleta,
  campiAnagraficaMancanti,
  messaggioAnagraficaIncompleta,
} from './domain/anagraficaStudio.js';

/** Una riga `tenant` completa: è il caso di uno studio che può fatturare. */
const COMPLETA = {
  ragioneSociale: 'Bluecode LTD',
  piva: 'MT12345678',
  codiceFiscale: 'C71668',
  sedeLegale: 'Notabile Residence, Mdina Road, Attard ATD9036, Malta',
  regimeFiscale: 'RF01',
  iban: 'MT84MALT011000012345MTLCAST001S',
};

describe('campiAnagraficaMancanti — cosa manca davvero', () => {
  it("un'anagrafica completa non manca di niente", () => {
    expect(campiAnagraficaMancanti(COMPLETA)).toEqual([]);
    expect(anagraficaCompleta(COMPLETA)).toBe(true);
  });

  it('nomina il campo vuoto invece di dire «anagrafica incompleta»', () => {
    const mancanti = campiAnagraficaMancanti({ ...COMPLETA, piva: '' });
    expect(mancanti.map(c => c.chiave)).toEqual(['piva']);
    expect(mancanti[0]?.etichetta).toBe('Partita IVA / VAT Number');
    // Il «perché» è la parte che rende la guida utile: dice dove finisce il valore e cosa l'app
    // scriveva al suo posto. Un elenco di campi senza motivo non spiega perché compilarli.
    expect(mancanti[0]?.senza).toContain('00000000000');
  });

  it('una stringa di soli spazi è un campo vuoto', () => {
    // Un campo toccato e lasciato in bianco è il modo più comune in cui «manca» un dato: senza
    // il `trim()` sarebbe passato per compilato e l'XML avrebbe avuto un `IdCodice` di spazi.
    expect(campiAnagraficaMancanti({ ...COMPLETA, iban: '   ' }).map(c => c.chiave)).toEqual(['iban']);
  });

  it('un campo assente e uno nullo sono la stessa cosa', () => {
    const senzaSede = { ...COMPLETA } as Record<string, unknown>;
    delete senzaSede.sedeLegale;
    expect(campiAnagraficaMancanti(senzaSede).map(c => c.chiave)).toEqual(['sedeLegale']);
    expect(campiAnagraficaMancanti({ ...COMPLETA, sedeLegale: null }).map(c => c.chiave)).toEqual(['sedeLegale']);
  });

  it("con una riga che non si è potuta leggere manca tutto: non si sa che ci sia", () => {
    // Il verso dell'errore conta: «non ho potuto guardare» non è «va tutto bene». Chi legge vede
    // una guida da compilare invece di un documento fiscale composto con valori inventati.
    expect(campiAnagraficaMancanti(null).map(c => c.chiave)).toEqual(CAMPI_ANAGRAFICA.map(c => c.chiave));
    expect(anagraficaCompleta(undefined)).toBe(false);
  });

  it('l’ordine è quello in cui i campi vanno compilati, e non cambia', () => {
    expect(CAMPI_ANAGRAFICA.map(c => c.chiave)).toEqual([
      'ragioneSociale', 'piva', 'codiceFiscale', 'sedeLegale', 'regimeFiscale', 'iban',
    ]);
  });
});

describe('messaggioAnagraficaIncompleta — il rifiuto dice cosa manca', () => {
  it('elenca le etichette dei soli campi mancanti', () => {
    const messaggio = messaggioAnagraficaIncompleta(campiAnagraficaMancanti({ ...COMPLETA, iban: '', piva: '' }));
    expect(messaggio).toContain('Partita IVA / VAT Number');
    expect(messaggio).toContain('IBAN per Accredito Fatture');
    expect(messaggio).not.toContain('Ragione Sociale Studio');
    // Dice anche che l'app non li inventa e dove si compilano: senza, il rifiuto è un vicolo cieco.
    expect(messaggio).toContain('Impostazioni');
  });
});
