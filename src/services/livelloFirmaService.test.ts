/**
 * Livelli di firma (piano-firma-legale-ses-fea-feq.md §3) — regole pure.
 *
 * Il guasto che questi test presidiano: il livello richiesto da un documento non deve mai
 * essere cosmetico. Se un documento esige FEQ e il cliente tenta il flusso OTP, la firma si
 * blocca con un 409 onesto invece di degradare silenziosamente a SES (riga 139 del piano).
 * Specularmente: un livello assente o sporco non deve mai bloccare una firma lecita, perché
 * ricade su `ses`, che è il default di migrazione e il comportamento storico.
 *
 * Nessuna dipendenza dal DB: sono funzioni pure, la stessa che gira nelle rotte di firma.
 */
import { describe, it, expect } from 'vitest';
import {
  LIVELLI_FIRMA,
  DESCRIZIONE_LIVELLO_FIRMA,
  livelloFirmaValido,
  normalizzaLivelloFirma,
  livelloPiuAlto,
  verificaLivelloFirma,
} from './livelloFirmaService';

describe('livelloFirmaValido', () => {
  it('accetta solo i tre livelli del piano', () => {
    expect(livelloFirmaValido('ses')).toBe(true);
    expect(livelloFirmaValido('fea')).toBe(true);
    expect(livelloFirmaValido('feq')).toBe(true);
  });

  it('rifiuta valori inventati, maiuscole e non-stringhe', () => {
    expect(livelloFirmaValido('SES')).toBe(false);
    expect(livelloFirmaValido('feq2')).toBe(false);
    expect(livelloFirmaValido('')).toBe(false);
    expect(livelloFirmaValido(null)).toBe(false);
    expect(livelloFirmaValido(undefined)).toBe(false);
    expect(livelloFirmaValido(42)).toBe(false);
  });
});

describe('normalizzaLivelloFirma', () => {
  it('lascia passare i valori validi', () => {
    for (const livello of LIVELLI_FIRMA) {
      expect(normalizzaLivelloFirma(livello)).toBe(livello);
    }
  });

  it('un dato sporco ricade su ses, mai su un blocco', () => {
    expect(normalizzaLivelloFirma(null)).toBe('ses');
    expect(normalizzaLivelloFirma(undefined)).toBe('ses');
    expect(normalizzaLivelloFirma('')).toBe('ses');
    expect(normalizzaLivelloFirma('avanzata')).toBe('ses');
    expect(normalizzaLivelloFirma(7)).toBe('ses');
  });
});

describe('DESCRIZIONE_LIVELLO_FIRMA', () => {
  it('ogni livello ha la descrizione legale completa (verbale + UI la usano)', () => {
    expect(DESCRIZIONE_LIVELLO_FIRMA.ses).toContain('art. 20 CAD');
    expect(DESCRIZIONE_LIVELLO_FIRMA.fea).toContain('eIDAS UE 910/2014 art. 26');
    expect(DESCRIZIONE_LIVELLO_FIRMA.feq).toContain('eIDAS UE 910/2014 art. 25');
  });
});

describe('livelloPiuAlto', () => {
  it('il livello di un modulo è il MASSIMO dei livelli dei suoi passaggi', () => {
    expect(livelloPiuAlto(['ses', 'fea', 'ses'])).toBe('fea');
    expect(livelloPiuAlto(['fea', 'feq', 'ses'])).toBe('feq');
    expect(livelloPiuAlto(['ses', 'ses'])).toBe('ses');
  });

  it('elenco vuoto e valori sporchi non alzano il livello sopra ses', () => {
    expect(livelloPiuAlto([])).toBe('ses');
    expect(livelloPiuAlto([null, undefined, 'sporco'])).toBe('ses');
  });
});

describe('verificaLivelloFirma — enforcement §3.2', () => {
  it('ses → tutto come oggi, su entrambe le rotte', () => {
    expect(verificaLivelloFirma({ livelloRichiesto: 'ses', canale: 'otp' })).toEqual({
      consentito: true,
      livelloRichiesto: 'ses',
    });
    expect(
      verificaLivelloFirma({ livelloRichiesto: 'ses', canale: 'file', tipoFirma: 'manuale_scansionata' }),
    ).toEqual({ consentito: true, livelloRichiesto: 'ses' });
  });

  it('livello assente o sporco → ricade su ses, nessun blocco improprio', () => {
    expect(verificaLivelloFirma({ livelloRichiesto: null, canale: 'otp' })).toEqual({
      consentito: true,
      livelloRichiesto: 'ses',
    });
    expect(verificaLivelloFirma({ livelloRichiesto: 'pippo', canale: 'otp' })).toEqual({
      consentito: true,
      livelloRichiesto: 'ses',
    });
  });

  it('fea + OTP → consentito: lo produce il flusso misurato della Fase 3 (grafometrica obbligatoria + sessione certificata nel digest)', () => {
    expect(verificaLivelloFirma({ livelloRichiesto: 'fea', canale: 'otp' })).toEqual({
      consentito: true,
      livelloRichiesto: 'fea',
    });
  });

  it('fea + file + qualificata_esterna → consentito: un valore legale superiore soddisfa anche un\'esigenza inferiore', () => {
    expect(
      verificaLivelloFirma({ livelloRichiesto: 'fea', canale: 'file', tipoFirma: 'qualificata_esterna' }),
    ).toEqual({ consentito: true, livelloRichiesto: 'fea' });
  });

  it('fea + file + manuale_scansionata → 409: la sottoscrizione autografa scansionata non basta, niente degradazione a SES', () => {
    const esito = verificaLivelloFirma({
      livelloRichiesto: 'fea',
      canale: 'file',
      tipoFirma: 'manuale_scansionata',
    });
    expect(esito.consentito).toBe(false);
    if (!esito.consentito) {
      expect(esito.codice).toBe(409);
      expect(esito.errore).toContain('Firma Elettronica Avanzata');
      expect(esito.errore).toContain('sottoscrizione autografa scansionata non è sufficiente');
      expect(esito.livelloRichiesto).toBe('fea');
    }
  });

  it('feq → 409 sulla rotta OTP, niente degradazione silenziosa a SES', () => {
    const esito = verificaLivelloFirma({ livelloRichiesto: 'feq', canale: 'otp' });
    expect(esito.consentito).toBe(false);
    if (!esito.consentito) {
      expect(esito.codice).toBe(409);
      expect(esito.errore).toContain('Firma Elettronica Qualificata');
      expect(esito.errore).toContain('provider di firma digitale');
    }
  });

  it('feq + firma-con-file: qualificata_esterna ammessa (unico modo attuale di ottenere FEQ)', () => {
    expect(
      verificaLivelloFirma({ livelloRichiesto: 'feq', canale: 'file', tipoFirma: 'qualificata_esterna' }),
    ).toEqual({ consentito: true, livelloRichiesto: 'feq' });
  });

  it('feq + firma-con-file: la scansione autografa NON basta', () => {
    const esito = verificaLivelloFirma({
      livelloRichiesto: 'feq',
      canale: 'file',
      tipoFirma: 'manuale_scansionata',
    });
    expect(esito.consentito).toBe(false);
    if (!esito.consentito) {
      expect(esito.codice).toBe(409);
      expect(esito.errore).toContain('Firma Elettronica Qualificata');
    }
  });
});
