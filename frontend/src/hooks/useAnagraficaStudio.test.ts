// §7 — la lettura dei dati obbligatori dello studio. Il punto del test è il verso dell'errore:
// «il server non ha risposto» e «mancano dei campi» devono restare due cose distinte, perché la
// guida che le confonde dice a uno studio che ha un problema che non ha.
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';

vi.mock('../api/client', () => ({
  fetchAnagraficaStudioApi: vi.fn(),
}));

import { fetchAnagraficaStudioApi } from '../api/client';
import { useAnagraficaStudio } from './useAnagraficaStudio';

const mockFetch = fetchAnagraficaStudioApi as ReturnType<typeof vi.fn>;

const MANCANTE = { chiave: 'piva', etichetta: 'Partita IVA / VAT Number', dove: 'l’XML SDI', senza: '«00000000000»' };

describe('useAnagraficaStudio — leggi dal server, non inventare', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.clear();
  });

  it('riporta i campi mancanti che il server ha nominato', async () => {
    mockFetch.mockResolvedValue({ letto: true, completa: false, mancanti: [MANCANTE] });

    const { result } = renderHook(() => useAnagraficaStudio());

    await waitFor(() => expect(result.current.letto).toBe(true));
    expect(result.current.completa).toBe(false);
    expect(result.current.mancanti).toEqual([MANCANTE]);
  });

  it('senza risposta del server resta «non letto»: non si dice che manca qualcosa', async () => {
    // È il caso che prima sarebbe stato un falso allarme: `letto: false` non è «incompleta».
    mockFetch.mockResolvedValue({ letto: false, completa: false, mancanti: [] });

    const { result } = renderHook(() => useAnagraficaStudio());

    await waitFor(() => expect(mockFetch).toHaveBeenCalled());
    expect(result.current.letto).toBe(false);
    expect(result.current.completa).toBe(false);
    expect(result.current.mancanti).toEqual([]);
  });

  it('con `abilitato: false` non chiama affatto il server', () => {
    // Un collaboratore non può scrivere quei campi (`PATCH /tenant/info` lo rifiuta): chiedergli
    // i dati e dirgli che «gli mancano» sarebbe una guida su campi che non sono suoi.
    renderHook(() => useAnagraficaStudio({ abilitato: false }));
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it('`ricarica` rilegge dal server (dopo aver compilato i campi, la guida deve sparire)', async () => {
    mockFetch.mockResolvedValueOnce({ letto: true, completa: false, mancanti: [MANCANTE] });
    const { result } = renderHook(() => useAnagraficaStudio());
    await waitFor(() => expect(result.current.letto).toBe(true));

    mockFetch.mockResolvedValueOnce({ letto: true, completa: true, mancanti: [] });
    result.current.ricarica();

    await waitFor(() => expect(result.current.completa).toBe(true));
    expect(result.current.mancanti).toEqual([]);
    expect(mockFetch).toHaveBeenCalledTimes(2);
  });
});
