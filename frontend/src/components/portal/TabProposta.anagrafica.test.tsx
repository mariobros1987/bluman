// La lettera d'incarico si mostra e si firma solo con l'anagrafica dello studio arrivata dal
// server: senza, il cliente leggerebbe una controparte diversa da quella che la firma registra.
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { TabProposta } from './TabProposta';

const props = (anagraficaStudio: 'caricamento' | 'ok' | 'errore', riprova = vi.fn()): any => ({
  signed: false, eidasSeal: null, clientName: 'Cliente', moduliProposti: [], totaleProposta: { totale: 0, mancanti: 0 },
  addendumErrore: null, nuovaRichiestaAddendum: '', setNuovaRichiestaAddendum: vi.fn(), progettoAttivo: null,
  inviaNuovaRichiestaAddendum: vi.fn(), invioAddendum: false, addendumMsg: null, addendums: [],
  moduleSignatures: {}, setSelectedModule: vi.fn(),
  getResolvedEngagementHtml: () => '<p>Testo della lettera</p>',
  modalitaFirma: 'otp', setModalitaFirma: vi.fn(), otpError: null, setOtpError: vi.fn(), canaliFirma: [],
  otpCanale: 'email', setOtpCanale: vi.fn(), nomeCanale: { email: 'Email' }, usaRecapitoDiverso: false, setUsaRecapitoDiverso: vi.fn(),
  recapitoDichiarato: '', setRecapitoDichiarato: vi.fn(), canaleCorrente: undefined, botTelegram: null,
  otpModalOpen: false, inviaCodiceFirma: vi.fn(), TITOLO_MANDATO: 'Mandato', loading: false, otpLoading: false,
  fileFirmato: null, leggiFileFirmato: vi.fn(), confermaFirmaConFile: vi.fn(), caricamentoFirmato: false,
  anagraficaStudio, riprovaAnagraficaStudio: riprova,
});

beforeEach(() => {
  vi.stubGlobal('ResizeObserver', class { observe() {} unobserve() {} disconnect() {} });
});

describe('TabProposta — lettera e firma dipendono dall anagrafica dello studio', () => {
  it('con l anagrafica arrivata: lettera e comandi di firma', () => {
    render(<TabProposta {...props('ok')} />);
    expect(screen.getByText('Testo della lettera')).toBeTruthy();
    expect(screen.getByText(/Scegli come firmare/)).toBeTruthy();
  });

  it('mentre arriva: niente lettera e niente firma', () => {
    render(<TabProposta {...props('caricamento')} />);
    expect(screen.getByText(/Caricamento della lettera/)).toBeTruthy();
    expect(screen.queryByText('Testo della lettera')).toBeNull();
    expect(screen.queryByText(/Scegli come firmare/)).toBeNull();
  });

  it('se non arriva: lo dice, niente firma, e «Riprova» la richiede', () => {
    const riprova = vi.fn();
    render(<TabProposta {...props('errore', riprova)} />);
    expect(screen.getByRole('alert').textContent).toContain('non si può mostrare');
    expect(screen.queryByText(/Scegli come firmare/)).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Riprova' }));
    expect(riprova).toHaveBeenCalled();
  });
});
