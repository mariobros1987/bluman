// Titolare, 28/11/2026 — «nell'articolo deve essere indicato il form da compilare da parte del
// cliente; se è già compilato prende i dati direttamente da lì».
import { describe, expect, it } from 'vitest';
import {
  campiDelForm,
  motivoFormNonValido,
  notaRisposteRiprese,
  passaggioDelForm,
  risposteRiutilizzabili,
} from './formArticolo.js';

describe('campiDelForm', () => {
  it('tiene le domande scritte, senza vuoti né doppioni', () => {
    expect(campiDelForm([' Ragione sociale ', '', 'IBAN', 'iban', 3, null])).toEqual(['Ragione sociale', 'IBAN']);
  });

  it('una forma che non è un elenco non ha domande', () => {
    expect(campiDelForm(null)).toEqual([]);
    expect(campiDelForm({ a: 1 })).toEqual([]);
  });
});

describe('motivoFormNonValido', () => {
  it('nome e almeno una domanda: va bene', () => {
    expect(motivoFormNonValido('Dati societari', ['Ragione sociale'])).toBeNull();
  });

  it('senza nome o senza domande dice perché', () => {
    expect(motivoFormNonValido('  ', ['x'])).toContain('nome');
    expect(motivoFormNonValido('Dati', [])).toContain('almeno una domanda');
    expect(motivoFormNonValido('Dati', ['  ', ''])).toContain('almeno una domanda');
    expect(motivoFormNonValido('Dati', 'Ragione sociale')).toContain('elenco');
    expect(motivoFormNonValido('Dati', ['ok', 7])).toContain('elenco');
  });
});

describe('passaggioDelForm', () => {
  it('nasce per il cliente, con le domande del form e il suo id', () => {
    const p = passaggioDelForm({ id: 'f-1', nome: 'Dati societari', campi: ['Ragione sociale', 'IBAN'] }, 4);
    expect(p).toMatchObject({ tipo: 'form', chi: 'cliente', ordine: 4, formMasterId: 'f-1', campiFormJson: ['Ragione sociale', 'IBAN'] });
    expect(p.titolo).toBe('Compila il form «Dati societari»');
  });
});

describe('risposteRiutilizzabili', () => {
  const campi = ['Ragione sociale', 'IBAN'];

  it('riprende solo le risposte alle domande di oggi, e solo se scritte', () => {
    expect(risposteRiutilizzabili(campi, { 'Ragione sociale': 'Rossi Spa', IBAN: '  ', 'Vecchia domanda': 'x' })).toEqual({
      'Ragione sociale': 'Rossi Spa',
    });
  });

  it('un form mai compilato non si riusa vuoto', () => {
    expect(risposteRiutilizzabili(campi, null)).toBeNull();
    expect(risposteRiutilizzabili(campi, {})).toBeNull();
    expect(risposteRiutilizzabili(campi, { IBAN: '' })).toBeNull();
    expect(risposteRiutilizzabili(campi, ['Rossi Spa'])).toBeNull();
  });
});

describe('notaRisposteRiprese', () => {
  it('dice da quale progetto e quante domande', () => {
    expect(notaRisposteRiprese('Costituzione Ltd', 1, 2)).toBe(
      'Risposte riprese da quelle che il cliente ha già dato nel progetto «Costituzione Ltd» (1 di 2 domande): controllale prima di segnare il passaggio come fatto.',
    );
  });
});
