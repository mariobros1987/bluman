import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { PannelloSoggettoKyc } from './PannelloSoggettoKyc';
import { PannelloRischio } from './PannelloRischio';
import { PannelloTitolariEffettivi } from './PannelloTitolariEffettivi';
import { salvaSoggettoKyc, type FascicoloKyc } from '../../api/kyc';

vi.mock('../../api/kyc', () => ({
  salvaSoggettoKyc: vi.fn().mockResolvedValue({}),
  fetchRischio: vi.fn().mockResolvedValue({ corrente: null }),
  salvaRischio: vi.fn(),
  fetchTitolareEffettivo: vi.fn().mockResolvedValue({ titolari: [], catena: [], deposito: null, soglia: 25 }),
  aggiungiTitolareEffettivo: vi.fn(),
}));

const fascicolo: FascicoloKyc = {
  id: 'f-test', stato: 'bozza', livelloVerifica: 'ordinaria', rischioCalcolato: 'basso', punteggioRischio: 0,
};

describe('Campi KYC — nomi accessibili nel DOM', () => {
  it('nomina tutti i campi del soggetto e conserva il salvataggio', async () => {
    const onAggiornato = vi.fn();
    render(<PannelloSoggettoKyc fascicolo={fascicolo} puoModificare onAggiornato={onAggiornato} />);
    expect(screen.getByRole('combobox', { name: 'Tipo di soggetto' })).toBeInTheDocument();
    for (const name of ['Denominazione o nome e cognome', 'Codice fiscale', 'Partita IVA', 'Paese di residenza', 'Luogo di nascita', 'Data di nascita', 'Indirizzo o sede']) {
      expect(screen.getByRole('textbox', { name })).toHaveAccessibleName(name);
    }
    fireEvent.change(screen.getByRole('textbox', { name: 'Denominazione o nome e cognome' }), { target: { value: 'Soggetto di test' } });
    fireEvent.click(screen.getByRole('button', { name: /Salva soggetto/ }));
    await waitFor(() => expect(onAggiornato).toHaveBeenCalledOnce());
    expect(salvaSoggettoKyc).toHaveBeenCalledWith('f-test', expect.objectContaining({ denominazione: 'Soggetto di test', tipo: 'persona_fisica' }));
  });

  it('mantiene i campi nominati ma disabilitati in sola lettura', () => {
    render(<PannelloSoggettoKyc fascicolo={fascicolo} puoModificare={false} onAggiornato={vi.fn()} />);
    for (const campo of [...screen.getAllByRole('textbox'), screen.getByRole('combobox')]) {
      expect(campo).toHaveAccessibleName();
      expect(campo).toBeDisabled();
    }
  });

  it('distingue livello e motivazione di ciascuno dei quattro pilastri', async () => {
    render(<PannelloRischio fascicoloId="f-test" puoModificare />);
    for (const name of ['Cliente', 'Geografia', 'Prodotto/servizio', 'Canale']) {
      expect(screen.getByRole('combobox', { name })).toHaveAccessibleName(name);
      expect(screen.getByRole('textbox', { name: `Motivazione — ${name}` })).toBeInTheDocument();
    }
    await waitFor(() => expect(screen.getByText('Complessivo: BASSO')).toBeInTheDocument());
  });

  it('nomina anche il form del titolare effettivo aperto su richiesta', async () => {
    render(<PannelloTitolariEffettivi fascicoloId="f-test" puoModificare />);
    await screen.findByText('Nessun titolare effettivo dichiarato.');
    fireEvent.click(screen.getByRole('button', { name: /Aggiungi titolare effettivo/ }));
    expect(screen.getByRole('textbox', { name: 'Nome e cognome del titolare effettivo' })).toBeInTheDocument();
    expect(screen.getByRole('spinbutton', { name: 'Quota percentuale' })).toBeInTheDocument();
    expect(screen.getByRole('combobox', { name: 'Criterio di individuazione' })).toBeInTheDocument();
    expect(screen.getByRole('combobox', { name: 'Fonte della titolarità' })).toBeInTheDocument();
  });
});
