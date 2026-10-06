// Test del modale «📋 Compila / Visualizza Form» di un passaggio.
//
// Anche questo era stato cancellato insieme ad «Aggiungi Azione», lasciando il pulsante a non fare
// niente. Ripristinarlo **alla lettera** avrebbe però rimesso in circolazione tre cose, e due di
// queste sono il vero oggetto del test:
//
//  1. i campi partivano **precompilati con dati inventati** — una partita IVA, un IBAN e un codice
//    fiscale veri nella forma e falsi nella sostanza (`IT99887766554`, `IT99C03069…`, `DBNMRI85M…`),
//    mostrati come se fossero del cliente. Qui si presidia che si parta vuoti;
//  2. c'era una scritta verde «✓ Dati verificati dal sistema KYC». Nessun controllo KYC aveva
//    verificato niente, e in uno studio che va a Malta sotto FIAU/MFSA una rassicurazione di
//    conformità che nessuno ha prodotto è peggio di nessuna rassicurazione. Non deve tornare;
//  3. quello che si riapre si rilegge: le risposte già salvate sul passaggio riempiono i campi,
//    e risalvano identiche se non si tocca niente.
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { ModaleFormPassaggio } from './ModaleFormPassaggio';
import { ConfirmProvider } from '../ui/ConfirmProvider';
import type { Passaggio } from '../../types';

function passaggio(extra: Partial<Passaggio> = {}): Passaggio {
  return {
    id: 'p-1',
    title: 'Dati societari',
    type: 'form',
    who: 'cliente',
    stato: 'pending',
    ...extra,
  };
}

function apri(step: Passaggio, onSalva = vi.fn()) {
  render(
    <ConfirmProvider>
      <ModaleFormPassaggio step={step} nomeCliente="Bluecode Ltd" onChiudi={() => {}} onSalva={onSalva} />
    </ConfirmProvider>,
  );
  return onSalva;
}

/** I campi di testo del form, nell'ordine in cui si vedono. `queryAll` e non `getAll`: il caso
 *  «nessun campo» è uno di quelli sotto test, e `getAll` su zero elementi lancia invece di dire 0. */
function campi() {
  return screen.queryAllByRole('textbox') as HTMLInputElement[];
}

function salva() {
  fireEvent.click(screen.getByRole('button', { name: /Salva i dati/i }));
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('ModaleFormPassaggio — si parte vuoti', () => {
  it('senza risposte salvate i campi sono vuoti, non precompilati', () => {
    // La regressione da non riaprire: nessun dato inventato mostrato come se fosse del cliente.
    apri(passaggio());

    for (const campo of campi()) {
      expect(campo.value).toBe('');
    }
  });

  it('nessun dato di esempio compare nel modale', () => {
    apri(passaggio());

    const testo = document.body.textContent ?? '';
    for (const inventato of ['IT99887766554', 'IT99C03069', 'DBNMRI85M12H501Z']) {
      expect(testo).not.toContain(inventato);
    }
  });

  it('non dichiara nessuna verifica KYC: nessuno l\'ha fatta', () => {
    apri(passaggio());

    expect(document.body.textContent ?? '').not.toMatch(/KYC/i);
  });
});

describe('ModaleFormPassaggio — quali campi mostra', () => {
  it('usa i campi del passaggio quando ci sono', () => {
    apri(passaggio({ fields: ['Denominazione', 'Sede legale'] }));

    expect(screen.getByText(/Denominazione/)).toBeInTheDocument();
    expect(screen.getByText(/Sede legale/)).toBeInTheDocument();
    expect(campi()).toHaveLength(2);
  });

  it('senza campi usa lo stesso ripiego della scheda, non uno diverso', () => {
    // Le due viste devono mostrare gli stessi campi per lo stesso passaggio: tre sulla scheda e
    // cinque qui sarebbe un modo silenzioso di chiedere al cliente cose che l'operatore non vede.
    apri(passaggio());

    expect(campi()).toHaveLength(3);
    expect(screen.getByText(/Ragione Sociale/)).toBeInTheDocument();
    expect(screen.getByText(/P\.IVA \/ VAT/)).toBeInTheDocument();
    expect(screen.getByText(/Legale Rappresentante/)).toBeInTheDocument();
  });

  it('un elenco di campi vuoto non fa scattare il ripiego', () => {
    // `[]` è «questo form non chiede niente»; l'assenza è «non lo so, mostra i campi di base».
    const onSalva = apri(passaggio({ fields: [] }));

    expect(campi()).toHaveLength(0);
    salva();
    expect(onSalva).toHaveBeenCalledWith({});
  });
});

describe('ModaleFormPassaggio — le risposte salvate si rileggono e si riscrivono', () => {
  it('le risposte già sul passaggio riempiono i campi', () => {
    apri(passaggio({ fields: ['Denominazione'], risposte: { Denominazione: 'Bluecode Ltd' } }));

    expect(campi()[0]!.value).toBe('Bluecode Ltd');
  });

  it('quello che si vede si risalva identico se non si tocca niente', () => {
    const onSalva = apri(passaggio({ fields: ['Denominazione'], risposte: { Denominazione: 'Bluecode Ltd' } }));

    salva();

    expect(onSalva).toHaveBeenCalledWith({ Denominazione: 'Bluecode Ltd' });
  });

  it('le risposte si consegnano tutte, anche quelle di campi non mostrati', () => {
    // Un campo tolto dai `fields` non deve far sparire la risposta già raccolta: qui la si
    // porta avanti, ed è la shell a decidere cosa scrivere.
    const onSalva = apri(
      passaggio({ fields: ['Denominazione'], risposte: { Denominazione: 'Bluecode Ltd', 'Vecchio campo': 'valore' } }),
    );

    salva();

    expect(onSalva).toHaveBeenCalledWith({ Denominazione: 'Bluecode Ltd', 'Vecchio campo': 'valore' });
  });

  it('un campo svuotato si consegna vuoto, non cancellato dalla propria chiave', () => {
    // Chi svuota vuole che risulti vuoto. La chiave resta, con valore vuoto: è la shell a
    // scrivere l'oggetto intero, quindi «svuotato» e «mai compilato» restano distinti.
    const onSalva = apri(passaggio({ fields: ['Denominazione'], risposte: { Denominazione: 'Bluecode Ltd' } }));

    fireEvent.change(campi()[0]!, { target: { value: '' } });
    salva();

    expect(onSalva).toHaveBeenCalledWith({ Denominazione: '' });
  });
});

describe('ModaleFormPassaggio — il conteggio dice una cosa vera', () => {
  it('conta i campi compilati e non dichiara concluso il passaggio', () => {
    apri(passaggio({ fields: ['Denominazione', 'Sede legale'] }));

    expect(screen.getByText(/Nessun campo compilato/i)).toBeInTheDocument();

    fireEvent.change(campi()[0]!, { target: { value: 'Bluecode Ltd' } });

    expect(screen.getByText(/1 campo compilato/i)).toBeInTheDocument();
    // Salvare i dati e chiudere l'azione sono due decisioni diverse: il modale lo dice.
    expect(screen.getByText(/usa il ✓ sulla scheda/i)).toBeInTheDocument();
  });
});
