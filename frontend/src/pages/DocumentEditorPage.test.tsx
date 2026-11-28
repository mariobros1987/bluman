// 3.14 — Document Studio non inventa importi né dati dello studio. Prima un progetto senza
// valore diventava «€ 8.500,00» (o «€ 0,00»), e senza anagrafica dal server la pagina ripiegava
// sui dati dello studio dimostrativo (getStudioInfoForTenant). Ora il dato mancante è un
// segnaposto evidente, come in resolveDocumentTemplateHtml.
import { describe, it, expect, vi, beforeAll, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
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
// Un modello dello studio che esige la firma avanzata: è già in elenco al primo render, come
// accade entrando dalla Cartella Modelli con la copia locale della cartella.
const MODELLO_FEA = {
  id: 'tmpl-fea', titolo: 'Mandato con firma avanzata', categoria: 'contratto', descrizione: '',
  livelloFirmaRichiesto: 'fea' as const,
  contenutoHtml: '<p>Mandato di {{studio.ragione_sociale}}</p>',
};
vi.mock('../hooks/useCartellaTemplate', () => ({
  useCartellaTemplate: () => ({
    modelli: [MODELLO, MODELLO_FEA], caricamento: false, erroreLettura: null, letto: true,
    sincronizza: vi.fn(), crea: vi.fn(), aggiorna: vi.fn(), revisiona: vi.fn(), adotta: vi.fn(),
    archivia: vi.fn(), elimina: vi.fn(), importaDaJson: vi.fn(), recuperaModelliLocali: vi.fn(),
  }),
}));

import { DocumentEditorPage } from './DocumentEditorPage';
import { fetchProgetti, fetchTenantInfoApi } from '../api/client';
import { BLUECODE_TENANT_ID, getTenantStorageKey } from '../utils/tenant';

function apri() {
  return render(
    <MemoryRouter initialEntries={['/documents?tmplId=tmpl-prova&projId=prg-1']}>
      <DocumentEditorPage />
    </MemoryRouter>,
  );
}

// Il primo mount del file paga il riscaldamento di React e jsdom (~430 ms contro ~160 ms dei
// successivi): sotto il carico delle prove in parallelo bastava a portare il primo test oltre i 5 s
// (run 46016198424). Lo si paga qui, una volta, fuori dai test.
beforeAll(() => {
  vi.stubGlobal('ResizeObserver', class { observe() {} unobserve() {} disconnect() {} });
  vi.mocked(fetchProgetti).mockResolvedValue([]);
  vi.mocked(fetchTenantInfoApi).mockResolvedValue(null);
  apri().unmount();
});

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

// Analisi del 26/11, E1 — il livello di firma del modello si perdeva: aprendo dalla Cartella
// Modelli un modello FEA la pagina segnava «SES — Semplice», e il documento si salvava così.
describe('DocumentEditorPage — il livello di firma segue il modello e il documento (E1)', () => {
  const livelloSegnato = () =>
    screen.getAllByRole('button', { pressed: true }).map((b) => b.textContent || '').filter((t) => /(SES|FEA|FEQ) —/.test(t));

  beforeEach(() => {
    vi.mocked(fetchProgetti).mockResolvedValue([{ id: 'prg-1', nome: 'Pratica', valoreTotale: 100000, cliente: { id: 'cli-1', nome: 'Cliente Vero Srl' } }]);
    vi.mocked(fetchTenantInfoApi).mockResolvedValue({ id: BLUECODE_TENANT_ID, ragioneSociale: 'Studio Vero Srl' });
  });

  it('modello FEA aperto dall\'indirizzo → è segnata la FEA, non la firma semplice', async () => {
    render(
      <MemoryRouter initialEntries={['/documents?tmplId=tmpl-fea&projId=prg-1']}>
        <DocumentEditorPage />
      </MemoryRouter>,
    );
    await waitFor(() => expect(document.body.textContent).toContain('Mandato di Studio Vero Srl'));
    const segnati = livelloSegnato();
    expect(segnati).toHaveLength(1);
    expect(segnati[0]).toContain('FEA — ');
  });

  // Titolare, 28/11/2026 — il livello del modello è il minimo: si alza, non si abbassa.
  it('modello FEA → la firma semplice è spenta e la pagina dice perché; FEQ resta scegliibile', async () => {
    render(
      <MemoryRouter initialEntries={['/documents?tmplId=tmpl-fea&projId=prg-1']}>
        <DocumentEditorPage />
      </MemoryRouter>,
    );
    await waitFor(() => expect(document.body.textContent).toContain('Mandato di Studio Vero Srl'));
    expect(livelloSegnato().join(' ')).toContain('FEA — ');
    // I pulsanti si cercano per testo, non per ruolo e nome: su una pagina così grande ogni ricerca
    // per ruolo ricalcola l'albero di accessibilità, e ripetuta dentro `waitFor` faceva di questo
    // test il più caro del file (misurato sotto carico: 3,3 s contro 1,5 s dei vicini).
    const pulsante = (testo: RegExp) =>
      Array.from(document.querySelectorAll('button')).find((b) => testo.test(b.textContent || '')) as HTMLButtonElement;
    expect(pulsante(/SES — Semplice/).disabled).toBe(true);
    expect(pulsante(/FEQ — Qualificata/).disabled).toBe(false);
    expect(document.querySelector('[role="note"]')?.textContent).toContain('Il modello richiede almeno la firma FEA');
  });

  it('modello senza livello dichiarato → firma semplice, come prima', async () => {
    apri();
    await waitFor(() => expect(document.body.textContent).toContain('Studio Vero Srl'));
    const segnati = livelloSegnato();
    expect(segnati).toHaveLength(1);
    expect(segnati[0]).toContain('SES — ');
    // Nessun minimo: nessun livello spento e nessuna nota.
    expect(screen.queryByRole('note')).toBeNull();
  });

  it('documento salvato con FEQ, riaperto → resta FEQ', async () => {
    localStorage.setItem(getTenantStorageKey('bluman_all_vault_documents'), JSON.stringify([
      { id: 'doc-1', titolo: 'Atto salvato', categoria: 'contratto', contenutoHtml: '<p>Testo salvato</p>', livelloFirmaRichiesto: 'feq' },
    ]));
    render(
      <MemoryRouter initialEntries={['/documents?docId=doc-1&projId=prg-1']}>
        <DocumentEditorPage />
      </MemoryRouter>,
    );
    await waitFor(() => expect(livelloSegnato().join(' ')).toContain('FEQ — '));
    expect(livelloSegnato()).toHaveLength(1);
  });
});
