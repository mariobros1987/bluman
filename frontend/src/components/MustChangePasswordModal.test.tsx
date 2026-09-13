// Test del modale di blocco al primo accesso — l'utente con password temporanea NON
// entra nella piattaforma finché non imposta una password permanente. Qui si presidia
// che le validazioni client-side (lunghezza, conferma, diversità dalla temporanea)
// blocchino l'invio, e che il successo dell'API sblocchi l'app solo quando il server
// conferma — mai su un errore (regola 7).
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import { MustChangePasswordModal } from './MustChangePasswordModal';

vi.mock('../api/client', () => ({
  cambiaPasswordStaffApi: vi.fn(),
}));

import { cambiaPasswordStaffApi } from '../api/client';

const mockCambia = cambiaPasswordStaffApi as ReturnType<typeof vi.fn>;

const UTENTE = { id: 'usr-1', nome: 'Francesca Disabato', email: 'francesca@studio.it', ruolo: 'collaboratore_interno' };

function compilaCampi(temporanea: string, nuova: string, conferma: string) {
  const inputs = document.querySelectorAll('input');
  // I tre campi in ordine: temporanea, nuova, conferma (gli altri input sono i toggle mostra/nascondi)
  fireEvent.change(inputs[0], { target: { value: temporanea } });
  fireEvent.change(inputs[1], { target: { value: nuova } });
  fireEvent.change(inputs[2], { target: { value: conferma } });
}

function invia() {
  const bottone = screen.getByRole('button', { name: /imposta password|conferma|salva/i });
  fireEvent.click(bottone);
}

describe('MustChangePasswordModal — validazioni prima della chiamata API', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  /**
   * Il bottone submit porta `disabled` sui campi incompleti o non validi: è la
   * barriera UI (i controlli in handleSubmit sono la difesa di secondo livello per
   * chi arriva con la tastiera o con tool automatici). Qui si presidia che il
   * bottone resti disabilitato — un click su un bottone disabilitato non sottomette.
   */
  function bottoneInvio(): HTMLButtonElement {
    return screen.getByRole('button', { name: /Conferma & Accedi/i }) as HTMLButtonElement;
  }

  it('resta disabilitato con una nuova password più corta di 8 caratteri', () => {
    render(<MustChangePasswordModal user={UTENTE} onSuccess={() => {}} />);
    compilaCampi('Temporanea123!', 'Corta1!', 'Corta1!');

    expect(bottoneInvio()).toBeDisabled();
    expect(mockCambia).not.toHaveBeenCalled();
  });

  it('resta disabilitato quando la conferma non coincide', () => {
    render(<MustChangePasswordModal user={UTENTE} onSuccess={() => {}} />);
    compilaCampi('Temporanea123!', 'PasswordNuova123!', 'PasswordDiversa123!');

    expect(bottoneInvio()).toBeDisabled();
    // L'avviso inline che le due password non coincidono compare già mentre si digita
    expect(screen.getByText(/non coincidono/i)).toBeInTheDocument();
    expect(mockCambia).not.toHaveBeenCalled();
  });

  it('resta disabilitato senza password temporanea inserita', () => {
    render(<MustChangePasswordModal user={UTENTE} onSuccess={() => {}} />);
    compilaCampi('', 'PasswordNuova123!', 'PasswordNuova123!');

    expect(bottoneInvio()).toBeDisabled();
    expect(mockCambia).not.toHaveBeenCalled();
  });

  it('il controllo in handleSubmit rifiuta la nuova password uguale alla temporanea', () => {
    // Questo caso il bottone NON lo copre (i campi sono formalmente validi): lo
    // presidia la validazione in handleSubmit, che deve mostrare l'errore e non
    // chiamare l'API.
    render(<MustChangePasswordModal user={UTENTE} onSuccess={() => {}} />);
    compilaCampi('StessaPassword1!', 'StessaPassword1!', 'StessaPassword1!');
    expect(bottoneInvio()).not.toBeDisabled();

    fireEvent.submit(bottoneInvio().closest('form')!);

    expect(screen.getByText(/non può essere uguale/i)).toBeInTheDocument();
    expect(mockCambia).not.toHaveBeenCalled();
  });
});

describe('MustChangePasswordModal — esito della chiamata API', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('con campi validi chiama l\'API e invoca onSuccess', async () => {
    mockCambia.mockResolvedValue({ ok: true });
    const onSuccess = vi.fn();
    render(<MustChangePasswordModal user={UTENTE} onSuccess={onSuccess} />);

    compilaCampi('Temporanea123!', 'PasswordNuova123!', 'PasswordNuova123!');
    invia();

    await waitFor(() => {
      expect(mockCambia).toHaveBeenCalledWith('Temporanea123!', 'PasswordNuova123!');
      expect(onSuccess).toHaveBeenCalledTimes(1);
    });
  });

  it('un errore dell\'API mostra il messaggio e NON sblocca l\'app', async () => {
    mockCambia.mockRejectedValue(new Error('La password attuale inserita non è corretta.'));
    const onSuccess = vi.fn();
    render(<MustChangePasswordModal user={UTENTE} onSuccess={onSuccess} />);

    compilaCampi('PasswordSbagliata1!', 'PasswordNuova123!', 'PasswordNuova123!');
    invia();

    await waitFor(() => {
      expect(screen.getByText(/non è corretta/i)).toBeInTheDocument();
    });
    expect(onSuccess).not.toHaveBeenCalled();
  });
});
