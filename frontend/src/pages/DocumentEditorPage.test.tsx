// 3.14 — Document Studio non inventa importi né dati dello studio. Prima un progetto senza
// valore diventava «€ 8.500,00» (o «€ 0,00»), e senza anagrafica dal server la pagina ripiegava
// sui dati dello studio dimostrativo (getStudioInfoForTenant). Ora il dato mancante è un
// segnaposto evidente, come in resolveDocumentTemplateHtml.
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';

vi.mock('../api/client', () => ({
  fetchClienti: vi.fn(async () => [{ id: 'cli-1', nome: 'Cliente Vero Srl', tipo: 'company' }]),
  fetchProgetti: vi.fn(),
  fetchProgettoDettaglio: vi.fn(async () => ({ moduli: [] })),
  fetchTenantInfoApi: vi.fn(),
  salvaDocumentoApi: vi.fn(),
}));

const MODELLO = {
  id: 'tmpl-prova', titolo: 'Prova', categoria: 'contratto', descrizione: '',
  contenutoHtml: '<p>Studio: {{studio.ragione_sociale}} · P.IVA {{studio.piva}} · Compenso: {{progetto.importo_totale}}</p>',
};
vi.mock('../hooks/useCartellaTemplate', () => ({
  useCartellaTemplate: () => ({
    modelli: [MODELLO], caricamento: false, erroreLettura: null, letto: true,
    sincronizza: vi.fn(), crea: vi.fn(), aggiorna: vi.fn(), revisiona: vi.fn(), adotta: vi.fn(),
    archivia: vi.fn(), elimina: vi.fn(), importaDaJson: vi.fn(), recuperaModelliLocali: vi.fn(),
  }),
}));

import { DocumentEditorPage } from './DocumentEditorPage';
import { fetchProgetti, fetchTenantInfoApi } from '../api/client';
import { BLUECODE_TENANT_ID } from '../utils/tenant';

function apri() {
  return render(
    <MemoryRouter initialEntries={['/documents?tmplId=tmpl-prova&projId=prg-1']}>
      <DocumentEditorPage />
    </MemoryRouter>,
  );
}

beforeEach(() => {
  localStorage.clear();
  sessionStorage.clear();
  localStorage.setItem('bluman_tenant_id', BLUECODE_TENANT_ID);
  vi.stubGlobal('ResizeObserver', class { observe() {} unobserve() {} disconnect() {} });
});

describe('DocumentEditorPage — niente importi né studi inventati (3.14)', () => {
  it('progetto del database senza valore → segnaposto, non € 8.500', async () => {
    vi.mocked(fetchProgetti).mockResolvedValue([{ id: 'prg-1', nome: 'Pratica', cliente: { id: 'cli-1', nome: 'Cliente Vero Srl' } }]);
    vi.mocked(fetchTenantInfoApi).mockResolvedValue({ id: BLUECODE_TENANT_ID, ragioneSociale: 'Studio Vero Srl', piva: 'IT123' });
    apri();
    await waitFor(() => expect(document.body.textContent).toContain('Studio Vero Srl'));
    expect(document.body.textContent).toContain('[DATO MANCANTE: valore del progetto]');
    expect(document.body.textContent).not.toContain('8.500');
    expect(document.body.textContent).not.toContain('€ 0,00');
  });

  it('valore del database in centesimi → euro con due decimali', async () => {
    vi.mocked(fetchProgetti).mockResolvedValue([{ id: 'prg-1', nome: 'Pratica', valoreTotale: 123450, cliente: { id: 'cli-1', nome: 'Cliente Vero Srl' } }]);
    vi.mocked(fetchTenantInfoApi).mockResolvedValue({ id: BLUECODE_TENANT_ID, ragioneSociale: 'Studio Vero Srl' });
    apri();
    await waitFor(() => expect(document.body.textContent).toContain('€ 1.234,50'));
  });

  it('anagrafica dello studio non letta → segnaposto, non lo studio dimostrativo', async () => {
    vi.mocked(fetchProgetti).mockResolvedValue([{ id: 'prg-1', nome: 'Pratica', valoreTotale: 100000, cliente: { id: 'cli-1', nome: 'Cliente Vero Srl' } }]);
    vi.mocked(fetchTenantInfoApi).mockResolvedValue(null);
    apri();
    await waitFor(() => expect(document.body.textContent).toContain('[DATO MANCANTE: ragione sociale dello studio]'));
    expect(document.body.textContent).toContain('[DATO MANCANTE: partita IVA dello studio]');
    expect(document.body.textContent).not.toMatch(/Bluecode|Studio Professionale|Notabile/i);
  });
});
