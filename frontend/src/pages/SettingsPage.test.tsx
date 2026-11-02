// 3.10 — il modulo delle impostazioni partiva dai dati dello studio dimostrativo: un campo vuoto
// a database compariva compilato col valore di prova e il salvataggio lo avrebbe scritto come
// vero. Con il server irraggiungibile il salvataggio resta bloccato.
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';

vi.mock('../api/client', () => ({
  fetchUtentiTenant: vi.fn(async () => []),
  creaUtenteTenantApi: vi.fn(),
  uploadFileApi: vi.fn(),
  fetchTenantInfoApi: vi.fn(),
  updateTenantInfoApi: vi.fn(),
  testEmailApi: vi.fn(),
  testImapApi: vi.fn(),
  testChannelApi: vi.fn(),
  resetPasswordUtenteApi: vi.fn(),
  rigeneraSlugWhatsappApi: vi.fn(),
}));
vi.mock('../api/kyc', () => ({ fetchModuliTenant: vi.fn(async () => ({ concessi: [] })) }));
vi.mock('../hooks/useAnagraficaStudio', () => ({
  useAnagraficaStudio: () => ({ letto: false, completa: false, mancanti: [], ricarica: vi.fn() }),
}));
vi.mock('../components/ui/ToastProvider', () => ({
  useToast: () => ({ successo: vi.fn(), errore: vi.fn(), info: vi.fn() }),
}));

import { SettingsPage } from './SettingsPage';
import { fetchTenantInfoApi, updateTenantInfoApi } from '../api/client';
import { BLUECODE_TENANT_ID } from '../utils/tenant';

const campo = (etichetta: string) => screen.getByText(etichetta).nextElementSibling as HTMLInputElement;
const salva = () => screen.getByRole('button', { name: /Salva Anagrafica/ });

beforeEach(() => {
  localStorage.clear();
  localStorage.setItem('bluman_tenant_id', BLUECODE_TENANT_ID);
  vi.mocked(fetchTenantInfoApi).mockReset();
  vi.mocked(updateTenantInfoApi).mockReset();
});

describe('SettingsPage — anagrafica studio senza dati dimostrativi (3.10)', () => {
  it('un campo vuoto a database resta vuoto nel modulo', async () => {
    vi.mocked(fetchTenantInfoApi).mockResolvedValue({ id: BLUECODE_TENANT_ID, ragioneSociale: 'Studio Vero Srl', sedeLegale: '', codiceFiscale: '' });
    render(<SettingsPage />);

    await waitFor(() => expect(campo('Ragione Sociale Studio *').value).toBe('Studio Vero Srl'));
    expect(campo('📍 Indirizzo Sede Legale (Legally Registered Office) *').value).toBe('');
    expect(campo('Codice Fiscale Societario *').value).toBe('');
    expect(salva()).not.toBeDisabled();
  });

  it('server irraggiungibile: errore con «Riprova» e salvataggio disabilitato', async () => {
    vi.mocked(fetchTenantInfoApi)
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({ id: BLUECODE_TENANT_ID, ragioneSociale: 'Studio Vero Srl' });
    render(<SettingsPage />);

    expect(await screen.findByRole('alert')).toHaveTextContent(/Impossibile leggere l'anagrafica/);
    expect(salva()).toBeDisabled();
    fireEvent.submit(salva().closest('form')!);
    expect(updateTenantInfoApi).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole('button', { name: 'Riprova' }));
    await waitFor(() => expect(salva()).not.toBeDisabled());
    expect(screen.queryByRole('alert')).toBeNull();
    expect(campo('Ragione Sociale Studio *').value).toBe('Studio Vero Srl');
  });
});
