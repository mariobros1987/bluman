// Analisi del 26/11, F6 — la voce «Coda KYC / AML» compariva anche a modulo spento e portava a
// una pagina che dice soltanto «il modulo non è attivo». Il menu la mostra quando il server dice
// che il modulo è acceso, la toglie quando dice che è spento, e la lascia quando non si sa:
// un errore di lettura non è un modulo spento.
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
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

// Le venti voci del menu stanno in quattro aree a tendina (Fabio, 27/11): Dashboard e Aiuto restano
// sempre visibili, l'area della pagina corrente è sempre aperta, le altre si ricordano.
describe('Sidebar — aree a tendina', () => {
  const apriIn = (percorso: string, utente: any = UTENTE) =>
    render(<MemoryRouter initialEntries={[percorso]}><Sidebar user={utente} /></MemoryRouter>);
  const area = (nome: RegExp) => screen.getByRole('button', { name: nome });
  const link = (nome: RegExp) => screen.queryByRole('link', { name: nome });

  beforeEach(() => {
    mockModuli.mockResolvedValue({ concessi: ['kyc'], disattivati: [], attivi: ['kyc'] });
  });

  it('alla prima visita: Dashboard e Aiuto visibili, «Lavoro» aperta, le altre aree chiuse', () => {
    apriIn('/');
    expect(link(/Dashboard/)).toBeTruthy();
    expect(link(/Aiuto/)).toBeTruthy();
    expect(area(/Lavoro/).getAttribute('aria-expanded')).toBe('true');
    expect(link(/Progetti/)).toBeTruthy();
    expect(area(/Contabilità/).getAttribute('aria-expanded')).toBe('false');
    expect(link(/Prima Nota/)).toBeNull();
  });

  it('l’area della pagina in cui ci si trova è aperta da sola', () => {
    apriIn('/primanota');
    expect(area(/Contabilità/).getAttribute('aria-expanded')).toBe('true');
    expect(link(/Prima Nota/)).toBeTruthy();
  });

  it('un clic apre e chiude un’area, e la scelta si ricorda alla visita successiva', () => {
    const { unmount } = apriIn('/');
    fireEvent.click(area(/Documenti/));
    expect(link(/Cartella Modelli/)).toBeTruthy();
    fireEvent.click(area(/Lavoro/));
    expect(link(/Progetti/)).toBeNull();
    unmount();

    apriIn('/');
    expect(link(/Cartella Modelli/)).toBeTruthy();
    expect(link(/Progetti/)).toBeNull();
  });

  it('l’area corrente non si chiude: chi è in Prima Nota non resta senza la sua voce', () => {
    apriIn('/primanota');
    fireEvent.click(area(/Contabilità/));
    expect(link(/Prima Nota/)).toBeTruthy();
  });

  it('ogni voce di prima c’è ancora, in una e una sola area', () => {
    // Il super admin le vede tutte, compresa la sua («Multi-Tenant Admin», nell'area Studio).
    apriIn('/', { ...UTENTE, ruolo: 'super_admin' });
    for (const nome of [/Contabilità/, /Documenti/, /Studio/]) fireEvent.click(area(nome));
    const voci = screen.getAllByRole('link').map((a) => a.getAttribute('href'));
    expect(voci).toEqual([
      '/', '/projects', '/clients', '/compliance', '/calendar', '/timesheet',
      '/invoices', '/fornitori', '/liquidazione-iva', '/scadenzario', '/primanota', '/banks', '/retainers',
      '/documents', '/modelli', '/archivio',
      '/reports', '/library', '/audit', '/note-beta', '/settings', '/admin/tenants',
      '/aiuto',
    ]);
  });
});

describe('Sidebar — la raccolta «Note della beta»', () => {
  beforeEach(() => {
    mockModuli.mockResolvedValue({ concessi: [], disattivati: [], attivi: [] });
    localStorage.setItem('bluman_menu_aree', JSON.stringify({ studio: true }));
  });

  it('la vede chi risponde dello studio, non il collaboratore', () => {
    const { unmount } = render(<MemoryRouter><Sidebar user={UTENTE} /></MemoryRouter>);
    expect(screen.queryByRole('link', { name: /Note della beta/ })).toBeTruthy();
    unmount();
    render(<MemoryRouter><Sidebar user={{ ...UTENTE, ruolo: 'collaboratore_interno' }} /></MemoryRouter>);
    expect(screen.queryByRole('link', { name: /Note della beta/ })).toBeNull();
  });
});
