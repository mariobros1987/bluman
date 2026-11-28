// La pagina personale del cliente: cosa gli si dice che tocca a lui, e con quali dati.
import { describe, expect, it } from 'vitest';
import {
  controllaRisposte,
  faseDelCliente,
  riepilogoCliente,
  risposteGiaDate,
  type ContestoRiepilogo,
  type ModuloLetto,
  type PassaggioLetto,
  type ProgettoLetto,
} from './riepilogoCliente.js';

function passaggio(parziale: Partial<PassaggioLetto> & { id: string }): PassaggioLetto {
  return {
    titolo: `Passaggio ${parziale.id}`,
    tipo: 'form',
    chi: 'cliente',
    stato: 'pending',
    ordine: 0,
    descrizione: null,
    campiFormJson: null,
    risposteFormJson: null,
    risposteClienteJson: null,
    rispostaClienteAt: null,
    documentoAllegatoUrl: null,
    linkIstruzioni: null,
    ...parziale,
  };
}

function modulo(id: string, statoMicrovoce: string, passaggi: PassaggioLetto[] = [], dipendeDa: string[] = []): ModuloLetto {
  return {
    id,
    nome: `Fase ${id}`,
    categoria: 'Societario',
    stato: 'pending',
    orePreventivate: 10,
    dipendenze: dipendeDa.map((d) => ({ dipendeDaModuloProgettoId: d })),
    microvoci: [{ id: `mv-${id}`, nome: `Attività ${id}`, stato: statoMicrovoce, ordine: 0, orePreventivate: 10, oreConsuntivate: 0, passaggi }],
  };
}

function progetto(moduli: ModuloLetto[], parziale: Partial<ProgettoLetto> = {}): ProgettoLetto {
  return { id: 'p-1', nome: 'Costituzione Malta', stato: 'in_progress', numeroContratto: 'EL-2026-001', moduli, ...parziale };
}

function contesto(parziale: Partial<ContestoRiepilogo> = {}): ContestoRiepilogo {
  return {
    lettereFirmate: new Set(['p-1']),
    fasiConfermate: new Set(),
    messaggiNonLetti: new Map(),
    fattureDaPagare: [],
    indirizzoFile: (url) => `${url}?rinnovato`,
    ...parziale,
  };
}

describe('stato delle fasi', () => {
  it('viene dal calcolo del server, detto con le parole del cliente', () => {
    expect(['done', 'pending', 'attesa_dipendenza', 'in_progress', 'delayed', 'blocked'].map(faseDelCliente))
      .toEqual(['completato', 'da_iniziare', 'in_attesa', 'in_corso', 'in_corso', 'in_corso']);
  });

  it('mette prima le fasi da cui le altre dipendono e dice cosa si aspetta', () => {
    const [r] = riepilogoCliente([progetto([modulo('b', 'attesa_dipendenza', [], ['a']), modulo('a', 'active')])], contesto());
    expect(r!.fasi.map((f) => [f.id, f.fase])).toEqual([['a', 'in_corso'], ['b', 'in_attesa']]);
    expect(r!.fasi[1]!.attende).toEqual(['Fase a']);
    expect(r!.fasi[0]!.attende).toEqual([]);
  });

  it('una fase conclusa aspetta la conferma del cliente finché non l’ha firmata', () => {
    const p = progetto([modulo('a', 'done'), modulo('b', 'active')]);
    const [prima] = riepilogoCliente([p], contesto());
    expect(prima!.fasi[0]).toMatchObject({ fase: 'completato', percentuale: 100, daConfermare: true, attivitaConcluse: 1, attivitaTotali: 1 });
    expect(prima!.azioni.map((a) => a.tipo)).toEqual(['conferma_fase']);
    const [dopo] = riepilogoCliente([p], contesto({ fasiConfermate: new Set(['a']) }));
    expect(dopo!.fasi[0]).toMatchObject({ daConfermare: false, confermata: true });
    expect(dopo!.turno).toBe('studio');
  });
});

describe('tocca a te', () => {
  it('senza niente da fare il turno è dello studio; a incarico concluso non è di nessuno', () => {
    expect(riepilogoCliente([progetto([modulo('a', 'active')])], contesto())[0]).toMatchObject({ turno: 'studio', azioni: [] });
    const concluso = riepilogoCliente([progetto([modulo('a', 'done')])], contesto({ fasiConfermate: new Set(['a']) }))[0]!;
    expect(concluso).toMatchObject({ turno: 'concluso', stato: 'completed', percentuale: 100 });
  });

  it('la lettera non firmata viene prima di tutto; a incarico concluso non si chiede più', () => {
    const p = progetto([modulo('a', 'active', [passaggio({ id: 'r1' })])]);
    const [r] = riepilogoCliente([p], contesto({ lettereFirmate: new Set() }));
    expect(r!.letteraFirmata).toBe(false);
    expect(r!.azioni.map((a) => a.tipo)).toEqual(['firma_incarico', 'richiesta']);
    expect(r!.azioni[0]).toMatchObject({ scheda: 'proposta', urgente: true });
    const concluso = riepilogoCliente([progetto([modulo('a', 'done')])], contesto({ lettereFirmate: new Set(), fasiConfermate: new Set(['a']) }))[0]!;
    expect(concluso.azioni).toEqual([]);
  });

  it('fatture: la scaduta è urgente e sta in alto, quella a scadere in fondo, con importo e data', () => {
    const fattura = { progettoId: 'p-1', importoCentesimi: 122000, dataScadenza: new Date('2026-12-15T00:00:00Z') };
    const [r] = riepilogoCliente(
      [progetto([modulo('a', 'active', [passaggio({ id: 'r1' })])])],
      contesto({
        fattureDaPagare: [
          { ...fattura, id: 'f-2', numero: 'FT-2', scaduta: false },
          { ...fattura, id: 'f-1', numero: 'FT-1', scaduta: true },
          { ...fattura, id: 'f-9', numero: 'FT-9', scaduta: true, progettoId: 'altro' },
        ],
        messaggiNonLetti: new Map([['p-1', 2]]),
      }),
    );
    expect(r!.azioni.map((a) => [a.tipo, a.riferimentoId, a.urgente])).toEqual([
      ['fattura', 'f-1', true],
      ['richiesta', 'r1', false],
      ['fattura', 'f-2', false],
      ['messaggi', null, false],
    ]);
    // Importo in centesimi e data: li formatta il portale, il server non li trasforma in testo.
    expect(r!.azioni[0]).toMatchObject({ importoCentesimi: 122000, scadenza: '2026-12-15T00:00:00.000Z' });
    expect(r!.azioni[3]!.titolo).toBe('2 messaggi dello studio da leggere');
  });
});

describe('richieste dello studio', () => {
  it('sono solo i passaggi a carico del cliente, con fase e attività', () => {
    const [r] = riepilogoCliente(
      [progetto([modulo('a', 'active', [
        passaggio({ id: 'interno', chi: 'operatore' }),
        passaggio({ id: 'r1', titolo: 'Dati della società', descrizione: 'Servono per l’atto', campiFormJson: ['P.IVA'] }),
      ])])],
      contesto(),
    );
    expect(r!.richieste).toHaveLength(1);
    expect(r!.richieste[0]).toMatchObject({
      id: 'r1', progettoId: 'p-1', faseId: 'a', faseNome: 'Fase a', attivitaId: 'mv-a', attivitaNome: 'Attività a',
      titolo: 'Dati della società', descrizione: 'Servono per l’atto', tipo: 'form', stato: 'da_fare', quando: 'ora',
      campi: [{ nome: 'P.IVA', valore: null, ripreso: false }],
    });
    expect(r!.fasi[0]!.richiesteDaFare).toBe(1);
  });

  it('inviata finché lo studio non chiude il passaggio; chiusa dopo', () => {
    const il = new Date('2026-11-20T10:00:00Z');
    const [r] = riepilogoCliente(
      [progetto([modulo('a', 'active', [
        passaggio({ id: 'r1', campiFormJson: ['P.IVA'], risposteClienteJson: { 'P.IVA': 'MT123' }, rispostaClienteAt: il }),
        passaggio({ id: 'r2', stato: 'done', ordine: 1 }),
      ])])],
      contesto(),
    );
    expect(r!.richieste.map((x) => [x.id, x.stato])).toEqual([['r1', 'inviata'], ['r2', 'chiusa']]);
    expect(r!.richieste[0]).toMatchObject({ inviataIl: il.toISOString(), campi: [{ nome: 'P.IVA', valore: 'MT123', ripreso: false }] });
    expect(r!.azioni).toEqual([]);
    expect(r!.turno).toBe('studio');
  });

  it('le richieste di una fase non ancora partita stanno «più avanti» e non sono un’azione di adesso', () => {
    const [r] = riepilogoCliente(
      [progetto([modulo('a', 'active'), modulo('b', 'attesa_dipendenza', [passaggio({ id: 'r1' })], ['a'])])],
      contesto(),
    );
    expect(r!.richieste[0]).toMatchObject({ quando: 'piu_avanti', stato: 'da_fare' });
    expect(r!.azioni).toEqual([]);
    expect(r!.fasi[1]!.richiesteDaFare).toBe(0);
  });

  it('il documento allegato dallo studio esce con l’indirizzo rinnovato', () => {
    const [r] = riepilogoCliente(
      [progetto([modulo('a', 'active', [passaggio({ id: 'r1', tipo: 'documento', documentoAllegatoUrl: '/uploads/modulo.pdf', linkIstruzioni: 'https://esempio.test/guida' })])])],
      contesto(),
    );
    expect(r!.richieste[0]).toMatchObject({ tipo: 'documento', modelloUrl: '/uploads/modulo.pdf?rinnovato', linkIstruzioni: 'https://esempio.test/guida' });
  });

  it('un campo già compilato altrove viene riproposto, e lo si dichiara (risposta 16 del titolare)', () => {
    const vecchio = progetto(
      [modulo('x', 'done', [
        passaggio({ id: 'v1', stato: 'done', campiFormJson: ['Ragione Sociale', 'P.IVA / VAT'], risposteFormJson: { 'Ragione Sociale': 'Rossi Srl' }, risposteClienteJson: { 'Ragione Sociale': 'rossi', 'P.IVA / VAT': 'MT123' }, rispostaClienteAt: new Date('2026-10-01T00:00:00Z') }),
      ])],
      { id: 'p-0', nome: 'Vecchio incarico' },
    );
    const nuovo = progetto([modulo('a', 'active', [passaggio({ id: 'r1', campiFormJson: ['ragione  sociale', 'P.IVA / VAT', 'IBAN'] })])]);
    const riepiloghi = riepilogoCliente([nuovo, vecchio], contesto());
    expect(riepiloghi[0]!.richieste[0]!.campi).toEqual([
      // Vale ciò che ha registrato lo studio, perché è il dato verificato.
      { nome: 'ragione  sociale', valore: 'Rossi Srl', ripreso: true },
      { nome: 'P.IVA / VAT', valore: 'MT123', ripreso: true },
      // Mai dato: resta vuoto, non si inventa.
      { nome: 'IBAN', valore: null, ripreso: false },
    ]);
  });

  it('tra due risposte del cliente allo stesso campo vale l’ultima', () => {
    const p = progetto([modulo('a', 'active', [
      passaggio({ id: 'r1', risposteClienteJson: { IBAN: 'vecchio' }, rispostaClienteAt: new Date('2026-01-01T00:00:00Z') }),
      passaggio({ id: 'r2', risposteClienteJson: { IBAN: 'nuovo' }, rispostaClienteAt: new Date('2026-06-01T00:00:00Z') }),
      passaggio({ id: 'r3', risposteClienteJson: { IBAN: 'intermedio' }, rispostaClienteAt: new Date('2026-03-01T00:00:00Z') }),
    ])]);
    expect(risposteGiaDate([p]).get('iban')).toBe('nuovo');
  });
});

describe('risposte del cliente a una richiesta', () => {
  it('accetta solo i campi chiesti, tutti compilati, e li ripulisce', () => {
    expect(controllaRisposte(['P.IVA', 'Sede'], { 'P.IVA': ' MT123 ', Sede: 'Valletta' })).toEqual({ ok: true, risposte: { 'P.IVA': 'MT123', Sede: 'Valletta' } });
    expect(controllaRisposte(['P.IVA', 'Sede'], { 'P.IVA': 'MT123', Sede: '  ' })).toEqual({ ok: false, errore: 'Manca la risposta a «Sede».' });
    expect(controllaRisposte(['P.IVA'], { 'P.IVA': 'MT123', stato: 'done' })).toEqual({ ok: false, errore: '«stato» non è tra i campi richiesti.' });
    expect(controllaRisposte(['P.IVA'], { 'P.IVA': 'x'.repeat(2001) })).toMatchObject({ ok: false });
    expect(controllaRisposte(['P.IVA'], { 'P.IVA': 42 })).toMatchObject({ ok: false });
  });

  it('una richiesta senza campi non ne pretende', () => {
    expect(controllaRisposte(null, undefined)).toEqual({ ok: true, risposte: {} });
    expect(controllaRisposte('non è un elenco', {})).toEqual({ ok: true, risposte: {} });
  });
});
