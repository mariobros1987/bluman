// Analisi del 26/11, F6 — la voce «Coda KYC / AML» compariva anche a modulo spento e portava a
// una pagina che dice soltanto «il modulo non è attivo». Il menu la mostra quando il server dice
// che il modulo è acceso, la toglie quando dice che è spento, e la lascia quando non si sa:
// un errore di lettura non è un modulo spento.
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { Sidebar } from './Sidebar';
import { fetchModuliTenant } from '../../api/kyc';
import { EVENTO_MODULI_CAMBIATI } from '../../hooks/useModuloKycAttivo';

vi.mock('../../api/kyc', () => ({ fetchModuliTenant: vi.fn() }));
const mockModuli = fetchModuliTenant as ReturnType<typeof vi.fn>;

const UTENTE = { id: 'u-1', nome: 'Lorenzo Marino', ruolo: 'advisor', tenantId: 't-1' };
const apri = () => render(<MemoryRouter><Sidebar user={UTENTE} /></MemoryRouter>);
const voceKyc = () => screen.queryByRole('link', { name: /Coda KYC/i });

beforeEach(() => {
  localStorage.clear();
  sessionStorage.clear();
  mockModuli.mockReset();
});

describe('Sidebar — la voce Coda KYC segue il modulo dello studio (F6)', () => {
  it('modulo spento → la voce sparisce, le altre restano', async () => {
    mockModuli.mockResolvedValue({ concessi: [], disattivati: [], attivi: [] });
    apri();
    await waitFor(() => expect(voceKyc()).toBeNull());
    expect(screen.getByRole('link', { name: /Clienti/i })).toBeTruthy();
  });

  it('modulo acceso → la voce c’è', async () => {
    mockModuli.mockResolvedValue({ concessi: ['kyc'], disattivati: [], attivi: ['kyc'] });
    apri();
    await waitFor(() => expect(mockModuli).toHaveBeenCalled());
    expect(voceKyc()).toBeTruthy();
  });

  it('concesso ma messo in standby dallo studio → la voce sparisce', async () => {
    mockModuli.mockResolvedValue({ concessi: ['kyc'], disattivati: ['kyc'], attivi: [] });
    apri();
    await waitFor(() => expect(voceKyc()).toBeNull());
  });

  it('lettura fallita → non si sa: la voce resta', async () => {
    mockModuli.mockRejectedValue(new Error('rete'));
    apri();
    await waitFor(() => expect(mockModuli).toHaveBeenCalled());
    expect(voceKyc()).toBeTruthy();
  });

  it('lo studio accende il modulo dalle Impostazioni → la voce compare senza ricaricare', async () => {
    mockModuli.mockResolvedValue({ concessi: ['kyc'], disattivati: ['kyc'], attivi: [] });
    apri();
    await waitFor(() => expect(voceKyc()).toBeNull());
    mockModuli.mockResolvedValue({ concessi: ['kyc'], disattivati: [], attivi: ['kyc'] });
    window.dispatchEvent(new Event(EVENTO_MODULI_CAMBIATI));
    await waitFor(() => expect(voceKyc()).toBeTruthy());
  });
});
