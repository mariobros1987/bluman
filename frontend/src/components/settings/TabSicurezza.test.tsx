// Test del pannello Sicurezza Account (2FA TOTP) — il componente che l'advisor e il
// super_admin usano per attivare, confermare e disattivare il secondo fattore.
// Le API sono mockate: qui si presidia il COMPORTAMENTO del componente — quale ruolo
// vede cosa, quale chiamata parte su quale azione, e che un errore dell'API non venga
// spacciato per un successo (regola 7).
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import { TabSicurezza } from './TabSicurezza';

// Il modulo API è mockato per intero: il componente non deve dipendere dalla rete
// per essere testato, e così i test dicono ESATTAMENTE quale chiamata aspettarsi.
vi.mock('../../api/auth', () => ({
  statoTotpApi: vi.fn(),
  attivaTotpApi: vi.fn(),
  confermaTotpApi: vi.fn(),
  disabilitaTotpApi: vi.fn(),
  dimenticaIpFidatiApi: vi.fn(),
}));

import {
  statoTotpApi,
  attivaTotpApi,
  disabilitaTotpApi,
  dimenticaIpFidatiApi,
} from '../../api/auth';

const mockStato = statoTotpApi as ReturnType<typeof vi.fn>;
const mockAttiva = attivaTotpApi as ReturnType<typeof vi.fn>;
const mockDisabilita = disabilitaTotpApi as ReturnType<typeof vi.fn>;
const mockDimentica = dimenticaIpFidatiApi as ReturnType<typeof vi.fn>;

describe('TabSicurezza — accesso per ruolo', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('il super_admin vede il pannello', async () => {
    mockStato.mockResolvedValue({ totpAbilitato: false, ipFidatiCount: 0 });
    render(<TabSicurezza ruolo="super_admin" />);
    // Il pannello lo si vede subito, ma il componente lancia `statoTotpApi()` in un effetto:
    // va atteso, se no la risoluzione della promessa aggiorna lo stato **dopo** la fine del test,
    // fuori da `act()`, e quell'aggiornamento tardivo cade dentro un altro test rendendolo instabile.
    expect(screen.queryByText(/riservate a Super Admin e Advisor/i)).toBeNull();
    await waitFor(() => expect(mockStato).toHaveBeenCalled());
  });

  it("l'advisor vede il pannello (estensione settembre 2026)", async () => {
    mockStato.mockResolvedValue({ totpAbilitato: false, ipFidatiCount: 0 });
    render(<TabSicurezza ruolo="advisor" />);
    await waitFor(() => expect(mockStato).toHaveBeenCalledTimes(1));
    expect(screen.queryByText(/riservate a Super Admin e Advisor/i)).toBeNull();
  });

  it('il collaboratore interno non vede il pannello e non chiama lo stato TOTP', () => {
    render(<TabSicurezza ruolo="collaboratore_interno" />);
    expect(mockStato).not.toHaveBeenCalled();
    expect(screen.getByText(/riservate a Super Admin e Advisor/i)).toBeInTheDocument();
  });
});

describe('TabSicurezza — stato e azioni', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('mostra lo stato 2FA attivo letto dal server', async () => {
    mockStato.mockResolvedValue({ totpAbilitato: true, ipFidatiCount: 2, ipCorrenteFidato: true });
    render(<TabSicurezza ruolo="advisor" />);

    // Il badge di stato attivo arriva dal server, non da un default ottimista.
    await waitFor(() => {
      expect(screen.getByText('● Attiva')).toBeInTheDocument();
    });
    expect(mockStato).toHaveBeenCalledTimes(1);
  });

  it('il fallimento dello stato non mostra un 2FA fittizio attivo', async () => {
    mockStato.mockRejectedValue(new Error('Server irraggiungibile'));
    render(<TabSicurezza ruolo="advisor" />);

    // Il catch del componente vale false: nessuna promessa di sicurezza che il server
    // non ha confermato (regola 7).
    await waitFor(() => {
      expect(screen.getByText('○ Non attiva')).toBeInTheDocument();
    });
  });

  it('la disabilitazione richiede la password e chiama l\'API con quella password', async () => {
    mockStato.mockResolvedValue({ totpAbilitato: true, ipFidatiCount: 1 });
    mockDisabilita.mockResolvedValue({ ok: true, messaggio: 'Disabilitato' });
    render(<TabSicurezza ruolo="super_admin" />);

    // Apre il modale di disabilitazione
    const bottoneDisabilita = await screen.findByRole('button', { name: /🔓 Disabilita 2FA/i });
    fireEvent.click(bottoneDisabilita);

    // Il campo password del modale (il label non ha htmlFor: si prende l'input type=password)
    await screen.findByText('Disabilita 2FA');
    const campoPassword = document.querySelector('input[type="password"]') as HTMLInputElement;
    fireEvent.change(campoPassword, { target: { value: 'PasswordSicura123!' } });

    const conferma = screen.getAllByRole('button', { name: /🔓 Disabilita 2FA/i }).pop()!;
    fireEvent.click(conferma);

    await waitFor(() => {
      expect(mockDisabilita).toHaveBeenCalledWith('PasswordSicura123!');
    });
  });

  it('la disabilitazione con password errata mostra l\'errore, non un successo', async () => {
    mockStato.mockResolvedValue({ totpAbilitato: true, ipFidatiCount: 1 });
    mockDisabilita.mockRejectedValue(new Error('Password non corretta'));
    render(<TabSicurezza ruolo="super_admin" />);

    const bottoneDisabilita = await screen.findByRole('button', { name: /🔓 Disabilita 2FA/i });
    fireEvent.click(bottoneDisabilita);

    await screen.findByText('Disabilita 2FA');
    const campoPassword = document.querySelector('input[type="password"]') as HTMLInputElement;
    fireEvent.change(campoPassword, { target: { value: 'PasswordSbagliata!' } });

    const conferma = screen.getAllByRole('button', { name: /🔓 Disabilita 2FA/i }).pop()!;
    fireEvent.click(conferma);

    await waitFor(() => {
      // Il messaggio può apparire sia nel banner generale sia nel modale: conta che ci sia
      expect(screen.getAllByText(/Password non corretta/i).length).toBeGreaterThan(0);
    });
    expect(screen.queryByText(/disabilitata con successo/i)).toBeNull();
  });

  it('il reset delle postazioni fidate azzera il contatore e chiama l\'API', async () => {
    mockStato.mockResolvedValue({ totpAbilitato: true, ipFidatiCount: 3 });
    mockDimentica.mockResolvedValue({ ok: true, messaggio: 'Rimosse' });
    render(<TabSicurezza ruolo="advisor" />);

    const bottoneReset = await screen.findByRole('button', { name: /🗑️ Dimentica postazioni fidate/i });
    fireEvent.click(bottoneReset);

    await waitFor(() => {
      expect(mockDimentica).toHaveBeenCalledTimes(1);
      expect(screen.getByText(/postazioni fidate sono state rimosse/i)).toBeInTheDocument();
    });
  });

  it('l\'attivazione mostra il QR quando il server lo produce', async () => {
    mockStato.mockResolvedValue({ totpAbilitato: false, ipFidatiCount: 0 });
    mockAttiva.mockResolvedValue({
      ok: true,
      qrUrl: 'data:image/png;base64,QR',
      segreto: 'SEGRETO-BASE32',
      backupCodes: ['A', 'B'],
    });
    render(<TabSicurezza ruolo="advisor" />);

    const bottoneAbilita = await screen.findByRole('button', { name: /🔐 Abilita 2FA/i });
    fireEvent.click(bottoneAbilita);

    await waitFor(() => {
      expect(mockAttiva).toHaveBeenCalledTimes(1);
      expect(screen.getByAltText(/QR Code 2FA/i)).toBeInTheDocument();
    });
  });
});
