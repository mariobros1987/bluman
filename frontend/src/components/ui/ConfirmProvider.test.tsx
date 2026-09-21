// Test del dialog di conferma centralizzato. Presidia che il bus `confirm(...)` ritorni
// una Promise<boolean> risolta secondo il click dell'utente (Conferma → true, Annulla →
// false), che la coda mostri un dialog per volta rispettando la semantica bloccante del
// confirm() nativo che sostituisce, e che Escape=Annulla / Invio=Conferma funzionino.
import { describe, it, expect } from 'vitest';
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react';
import { ConfirmProvider, confirm, useConfirm } from './ConfirmProvider';

describe('ConfirmProvider — esito del dialog', () => {
  it('il bus confirm() risolve true quando si clicca Conferma', async () => {
    render(<ConfirmProvider><div /></ConfirmProvider>);

    let esito: Promise<boolean>;
    act(() => { esito = confirm('Procedere?'); });

    const conferma = await screen.findByRole('button', { name: 'Conferma' });
    fireEvent.click(conferma);

    await expect(esito!).resolves.toBe(true);
  });

  it('il bus confirm() risolve false quando si clicca Annulla', async () => {
    render(<ConfirmProvider><div /></ConfirmProvider>);

    let esito: Promise<boolean>;
    act(() => { esito = confirm({ messaggio: 'Eliminare?', pericolo: true }); });

    const annulla = await screen.findByRole('button', { name: 'Annulla' });
    fireEvent.click(annulla);

    await expect(esito!).resolves.toBe(false);
  });

  it('Escape risolve false, Invio risolve true', async () => {
    render(<ConfirmProvider><div /></ConfirmProvider>);

    let esito1: Promise<boolean>;
    act(() => { esito1 = confirm('Uno?'); });
    const dialog1 = await screen.findByRole('alertdialog');
    fireEvent.keyDown(dialog1, { key: 'Escape' });
    await expect(esito1!).resolves.toBe(false);

    let esito2: Promise<boolean>;
    act(() => { esito2 = confirm('Due?'); });
    const dialog2 = await screen.findByRole('alertdialog');
    fireEvent.keyDown(dialog2, { key: 'Enter' });
    await expect(esito2!).resolves.toBe(true);
  });

  it('mostra un dialog per volta: la coda avanza dopo la risposta', async () => {
    render(<ConfirmProvider><div /></ConfirmProvider>);

    let primo: Promise<boolean>;
    let secondo: Promise<boolean>;
    act(() => {
      primo = confirm('Primo messaggio');
      secondo = confirm('Secondo messaggio');
    });

    // Solo il primo è visibile.
    expect(screen.getByText('Primo messaggio')).toBeInTheDocument();
    expect(screen.queryByText('Secondo messaggio')).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Conferma' }));
    await expect(primo!).resolves.toBe(true);

    // Ora tocca al secondo.
    await waitFor(() => expect(screen.getByText('Secondo messaggio')).toBeInTheDocument());
    fireEvent.click(screen.getByRole('button', { name: 'Annulla' }));
    await expect(secondo!).resolves.toBe(false);
  });

  it('useConfirm() dentro il provider usa il dialog custom (non window.confirm)', async () => {
    let chiedi: ReturnType<typeof useConfirm> = confirm;
    function Sonda() {
      chiedi = useConfirm();
      return null;
    }
    render(<ConfirmProvider><Sonda /></ConfirmProvider>);

    let esito: Promise<boolean>;
    act(() => { esito = chiedi('Domanda via hook'); });
    expect(await screen.findByText('Domanda via hook')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Conferma' }));
    await expect(esito!).resolves.toBe(true);
  });

  it('etichette personalizzate di conferma/annulla', async () => {
    render(<ConfirmProvider><div /></ConfirmProvider>);
    act(() => { void confirm({ messaggio: 'x', confermaLabel: 'Esci senza salvare', annullaLabel: 'Resta' }); });
    expect(await screen.findByRole('button', { name: 'Esci senza salvare' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Resta' })).toBeInTheDocument();
  });
});
