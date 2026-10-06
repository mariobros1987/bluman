// Test del modale «➕ Aggiungi Azione» della checklist di una micro-voce.
//
// Il pulsante in `TabPassaggi` è rimasto a chiamare `setShowAddStepModal` per un commit intero
// mentre il modale che doveva aprire non esisteva più: il sintomo per l'operatore era «il pulsante
// non fa niente». Qui si presidia cosa quel modale **consegna** alla shell, perché è l'unica cosa
// su cui la checklist costruisce il passaggio:
//
//  - il titolo è obbligatorio: senza, nessun passaggio (una riga vuota in checklist non dice a
//    nessuno cosa manca);
//  - per il tipo «doc» non si inventa nessun documento. Il modale cancellato ne fabbricava uno dal
//    nome del cliente (`Documento_<cliente>.pdf`), cioè un passaggio «da firmare» su un atto che
//    nessuno aveva collegato: la cosa che quel commit stava togliendo;
//  - i campi del form li scrive l'operatore. Vuoti restano **indefiniti**, che è diverso da un
//    elenco vuoto: `TabPassaggi` distingue i due casi, e solo l'indefinito fa scattare il suo
//    elenco di ripiego.
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { ModaleNuovaAzione } from './ModaleNuovaAzione';
import { ConfirmProvider } from '../ui/ConfirmProvider';

function apri(onCrea = vi.fn()) {
  render(
    <ConfirmProvider>
      <ModaleNuovaAzione onChiudi={() => {}} onCrea={onCrea} />
    </ConfirmProvider>,
  );
  return onCrea;
}

/** Compila e invia. `fireEvent.submit` e non click: la validazione nativa del browser non fa
 *  parte di ciò che si sta provando, e in jsdom si comporterebbe diversamente che in pagina. */
function compilaEInvia(campi: { titolo?: string; descrizione?: string; tipo?: string; chi?: string; dati?: string }) {
  if (campi.titolo !== undefined) fireEvent.change(screen.getByLabelText(/Titolo del Passaggio/i), { target: { value: campi.titolo } });
  if (campi.descrizione !== undefined) fireEvent.change(screen.getByLabelText(/Descrizione \/ Istruzioni/i), { target: { value: campi.descrizione } });
  if (campi.tipo !== undefined) fireEvent.change(screen.getByLabelText(/Tipo di Passaggio/i), { target: { value: campi.tipo } });
  if (campi.chi !== undefined) fireEvent.change(screen.getByLabelText(/Assegnato a/i), { target: { value: campi.chi } });
  if (campi.dati !== undefined) fireEvent.change(screen.getByLabelText(/Dati da chiedere/i), { target: { value: campi.dati } });
  fireEvent.submit(screen.getByLabelText(/Titolo del Passaggio/i).closest('form')!);
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('ModaleNuovaAzione — cosa consegna alla checklist', () => {
  it('consegna titolo, tipo e assegnatario scelti', () => {
    const onCrea = apri();
    compilaEInvia({ titolo: 'Verifica visura camerale', descrizione: 'Ordinaria e storica', tipo: 'check', chi: 'operatore' });

    expect(onCrea).toHaveBeenCalledTimes(1);
    expect(onCrea.mock.calls[0][0]).toMatchObject({
      title: 'Verifica visura camerale',
      desc: 'Ordinaria e storica',
      type: 'check',
      who: 'operatore',
    });
  });

  it('senza descrizione mette il ripiego, non una stringa vuota', () => {
    const onCrea = apri();
    compilaEInvia({ titolo: 'Bonifico caparra' });

    expect(onCrea.mock.calls[0][0].desc).toBe('Azione operativa di processo.');
  });

  it('senza titolo non crea niente', () => {
    const onCrea = apri();
    compilaEInvia({ titolo: '   ' });

    expect(onCrea).not.toHaveBeenCalled();
  });

  it('il titolo si ripulisce dagli spazi ai bordi', () => {
    const onCrea = apri();
    compilaEInvia({ titolo: '  Apertura conto  ' });

    expect(onCrea.mock.calls[0][0].title).toBe('Apertura conto');
  });
});

describe('ModaleNuovaAzione — nessun documento inventato', () => {
  it('un passaggio «doc» nasce senza documento, e non porta nessun nome di file', () => {
    const onCrea = apri();
    compilaEInvia({ titolo: 'Firma atto costitutivo', tipo: 'doc' });

    const dati = onCrea.mock.calls[0][0];
    // La regressione da non riaprire: il modale cancellato costruiva
    // `Documento_<cliente>.pdf` da sé. Non deve tornare per nessuna via.
    expect(Object.keys(dati)).not.toContain('file');
    expect(JSON.stringify(dati)).not.toMatch(/Documento_/);
  });

  it('lo dice all\'operatore, invece di lasciarglielo scoprire', () => {
    apri();
    fireEvent.change(screen.getByLabelText(/Tipo di Passaggio/i), { target: { value: 'doc' } });

    expect(screen.getByText(/nasce senza documento/i)).toBeInTheDocument();
  });
});

describe('ModaleNuovaAzione — i campi del form', () => {
  it('i campi scritti dall\'operatore si consegnano ripuliti', () => {
    const onCrea = apri();
    compilaEInvia({ titolo: 'Dati societari', tipo: 'form', dati: ' Ragione Sociale , P.IVA / VAT ,, ' });

    expect(onCrea.mock.calls[0][0].fields).toEqual(['Ragione Sociale', 'P.IVA / VAT']);
  });

  it('nessun campo scritto resta indefinito, e non un elenco vuoto', () => {
    // La distinzione conta: `TabPassaggi` mostra il suo elenco di ripiego solo quando `fields`
    // è assente. Un `[]` direbbe «questo form non chiede niente», che è un'altra cosa.
    const onCrea = apri();
    compilaEInvia({ titolo: 'Questionario', tipo: 'form' });

    expect(onCrea.mock.calls[0][0].fields).toBeUndefined();
  });

  it('i campi scritti si scartano se il tipo non è «form»', () => {
    // Il campo si vede solo col tipo «form», ma lo stato sopravvive al cambio di tipo: chi
    // scrive i campi e poi passa a «check» non deve portarseli dietro.
    const onCrea = apri();
    compilaEInvia({ titolo: 'Verifica', tipo: 'form', dati: 'Campo A' });
    expect(onCrea.mock.calls[0][0].fields).toEqual(['Campo A']);

    onCrea.mockClear();
    fireEvent.change(screen.getByLabelText(/Tipo di Passaggio/i), { target: { value: 'check' } });
    fireEvent.submit(screen.getByLabelText(/Titolo del Passaggio/i).closest('form')!);

    expect(onCrea.mock.calls[0][0].fields).toBeUndefined();
  });
});
