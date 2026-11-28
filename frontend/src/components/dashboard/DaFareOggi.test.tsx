// «Da fare oggi» sulla Dashboard: legge solo ciò che l'utente può vedere, porta alla pagina giusta,
// e una lettura fallita si dichiara invece di diventare «niente di urgente».
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { DaFareOggi } from './DaFareOggi';
import { fetchScadenzarioIncassiApi, fetchFattureRicevuteApi, fetchContrattiRicorrentiApi } from '../../api/client';

vi.mock('../../api/client', () => ({ fetchScadenzarioIncassiApi: vi.fn(), fetchFattureRicevuteApi: vi.fn(), fetchContrattiRicorrentiApi: vi.fn() }));
const mockRate = fetchScadenzarioIncassiApi as ReturnType<typeof vi.fn>;
const mockAcquisti = fetchFattureRicevuteApi as ReturnType<typeof vi.fn>;
const mockContratti = fetchContrattiRicorrentiApi as ReturnType<typeof vi.fn>;

const ADMIN = { id: 'u-1', ruolo: 'super_admin' };
const apri = (user: unknown = ADMIN, moduliInRitardo = 0) =>
  render(<MemoryRouter><DaFareOggi user={user} moduliInRitardo={moduliInRitardo} /></MemoryRouter>);

beforeEach(() => {
  vi.clearAllMocks();
  mockRate.mockResolvedValue([]);
  mockAcquisti.mockResolvedValue([]);
  mockContratti.mockResolvedValue([]);
});

describe('DaFareOggi', () => {
  it('niente in sospeso → lo dice in chiaro', async () => {
    apri();
    expect(await screen.findByText(/Niente di urgente/)).toBeTruthy();
  });

  it('una rata scaduta da tempo → riga con l’importo e il pulsante per lo Scadenzario', async () => {
    mockRate.mockResolvedValue([{ stato: 'aperta', dataScadenza: '2020-01-10T00:00:00.000Z', importoCentesimi: 48800, registrazioniRegistrate: [] }]);
    apri();
    expect(await screen.findByText('1 rata scaduta da incassare')).toBeTruthy();
    expect(screen.getByText(/488/)).toBeTruthy();
    expect(screen.getByRole('button', { name: /Apri lo Scadenzario/ })).toBeTruthy();
    expect(screen.queryByText(/Niente di urgente/)).toBeNull();
  });

  it('i moduli in ritardo arrivano dalla Dashboard e compaiono anche senza altri dati', async () => {
    apri(ADMIN, 2);
    expect(await screen.findByText('2 moduli in ritardo o con ore sforate')).toBeTruthy();
  });

  it('lettura fallita → avviso, e non «niente di urgente»', async () => {
    mockRate.mockRejectedValue(new Error('rete'));
    apri();
    expect((await screen.findByRole('alert')).textContent).toContain('le rate da incassare');
    expect(screen.queryByText(/Niente di urgente/)).toBeNull();
  });

  it('chi non è entrato non fa partire nessuna lettura', async () => {
    apri(null);
    expect(await screen.findByText(/Niente di urgente/)).toBeTruthy();
    expect(mockRate).not.toHaveBeenCalled();
    expect(mockAcquisti).not.toHaveBeenCalled();
    expect(mockContratti).not.toHaveBeenCalled();
  });

  it('un canone Retainer arrivato alla data → riga con l’importo e il pulsante per i Retainer', async () => {
    mockContratti.mockResolvedValue([{ stato: 'attivo', prossimaFatturazione: '2020-01-10T00:00:00.000Z', importoCentesimi: 50000 }]);
    apri();
    expect(await screen.findByText('1 canone Retainer da fatturare')).toBeTruthy();
    expect(screen.getByRole('button', { name: /Apri i Retainer/ })).toBeTruthy();
    expect(mockContratti).toHaveBeenCalledWith({ rigettaSuErrore: true });
  });

  it('contratti non letti → avviso, e non «niente di urgente»', async () => {
    mockContratti.mockRejectedValue(new Error('rete'));
    apri();
    expect((await screen.findByRole('alert')).textContent).toContain('i contratti Retainer');
    expect(screen.queryByText(/Niente di urgente/)).toBeNull();
  });
});
