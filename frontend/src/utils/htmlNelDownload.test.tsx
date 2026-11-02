// 4.3 (N6, N7, F7) — HTML non sanificato nel browser dell'operatore e del cliente. Un dato
// digitato (ragione sociale, nome del firmatario) o un file d'archivio arrivava a innerHTML
// così com'era: `<img src=x onerror=…>` diventava un elemento vivo nel DOM del download.
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';

const catturato = vi.hoisted(() => ({ html: [] as string[] }));
vi.mock('./pdfA4', () => ({
  creaPagineA4: (html: string) => { catturato.html.push(html); return []; },
}));

import { resolveDocumentTemplateHtml } from './documentTemplates';
import { downloadRealPdf } from './pdfGenerator';
import { scaricaDocumentoClient } from '../api/documenti';
import { TabProposta } from '../components/portal/TabProposta';

const ATTACCO = '<img src=x onerror=alert(1)>';

/** Quello che innerHTML ne farebbe: il DOM vero del foglio. */
function dom(html: string) {
  const div = document.createElement('div');
  div.innerHTML = html;
  return div;
}

beforeEach(() => {
  catturato.html = [];
  localStorage.clear();
});

describe('4.3 — i dati entrano nel download come testo', () => {
  it('ragione sociale con markup: nel documento compare come testo, nessun onerror nel DOM', () => {
    const html = resolveDocumentTemplateHtml('<p>{{studio.ragione_sociale}} — {{cliente.ragione_sociale}}</p>', {
      studio: { ragioneSociale: ATTACCO },
      cliente: { nome: ATTACCO },
      progetto: { nome: 'P' },
    });
    const foglio = dom(html);
    expect(foglio.querySelector('[onerror]')).toBeNull();
    expect(foglio.querySelector('img')).toBeNull();
    expect(foglio.textContent).toContain(ATTACCO);
  });

  it('nome, ruolo e data del firmatario con markup: testo nel foglio, nessun onerror', async () => {
    vi.useFakeTimers();
    const pronto = downloadRealPdf('doc', '<p>corpo</p>', [
      { signerName: ATTACCO, signerRole: ATTACCO, timestamp: ATTACCO, ipAddress: null },
    ]);
    await vi.runAllTimersAsync();
    await pronto;
    vi.useRealTimers();
    const foglio = dom(catturato.html[0]);
    expect(foglio.querySelector('[onerror]')).toBeNull();
    expect(foglio.querySelector('img')).toBeNull();
    expect(foglio.textContent).toContain(`${ATTACCO}: ${ATTACCO}`);
    expect(foglio.textContent).toContain(`Data/Ora: ${ATTACCO}`);
  });

  it('un file d\'archivio HTML passa dal sanificatore prima del PDF', async () => {
    const contenuto = `<div><p>Atto</p>${ATTACCO}</div>`;
    const blob = { type: 'text/html', slice: () => ({ text: async () => contenuto }), text: async () => contenuto };
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, blob: async () => blob })));
    vi.useFakeTimers();
    const pronto = scaricaDocumentoClient('https://storage.test/atto.html', 'atto.html');
    await vi.runAllTimersAsync();
    await pronto;
    vi.useRealTimers();
    vi.unstubAllGlobals();
    const foglio = dom(catturato.html[0]);
    expect(foglio.querySelector('[onerror]')).toBeNull();
    expect(foglio.textContent).toContain('Atto');
  });

  it('il download della lettera nel portale usa l\'HTML sanificato della vista', async () => {
    const props: any = {
      signed: false, eidasSeal: null, clientName: 'Cliente', moduliProposti: [], totalValue: 0,
      addendumErrore: null, nuovaRichiestaAddendum: '', setNuovaRichiestaAddendum: vi.fn(), progettoAttivo: null,
      inviaNuovaRichiestaAddendum: vi.fn(), invioAddendum: false, addendumMsg: null, addendums: [],
      moduleSignatures: {}, setSelectedModule: vi.fn(),
      getResolvedEngagementHtml: () => `<p>Lettera</p>${ATTACCO}`,
      modalitaFirma: 'otp', setModalitaFirma: vi.fn(), otpError: null, setOtpError: vi.fn(), canaliFirma: [],
      otpCanale: 'email', setOtpCanale: vi.fn(), nomeCanale: {}, usaRecapitoDiverso: false, setUsaRecapitoDiverso: vi.fn(),
      recapitoDichiarato: '', setRecapitoDichiarato: vi.fn(), canaleCorrente: undefined, botTelegram: null,
      otpModalOpen: false, inviaCodiceFirma: vi.fn(), TITOLO_MANDATO: 'Mandato', loading: false, otpLoading: false,
      fileFirmato: null, leggiFileFirmato: vi.fn(), confermaFirmaConFile: vi.fn(), caricamentoFirmato: false,
    };
    // Il foglio A4 della vista misura il contenitore: jsdom non ha ResizeObserver.
    vi.stubGlobal('ResizeObserver', class { observe() {} unobserve() {} disconnect() {} });
    render(<TabProposta {...props} />);
    fireEvent.click(screen.getByRole('button', { name: /Scarica Bozza PDF A4/ }));
    await waitFor(() => expect(catturato.html.length).toBe(1), { timeout: 2000 });
    const foglio = dom(catturato.html[0]);
    expect(foglio.querySelector('[onerror]')).toBeNull();
    expect(foglio.textContent).toContain('Lettera');
  });
});
