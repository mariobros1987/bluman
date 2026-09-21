// Test del componente Modal condiviso. Presidia il comportamento chiave chiesto dall'utente:
// un modale senza modifiche chiude subito; appena l'utente tocca un campo (dirty), ogni
// tentativo di chiusura (Escape, backdrop, ✕/Annulla) passa dalla guardia che chiede
// conferma; un modale di sola lettura non diventa mai dirty e chiude subito.
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { Modal } from './Modal';
import { ConfirmProvider } from './ConfirmProvider';

function renderConProvider(ui: React.ReactNode) {
  return render(<ConfirmProvider>{ui}</ConfirmProvider>);
}

describe('Modal — guardia modifiche non salvate', () => {
  it('Escape su modale non modificato chiude subito, senza conferma', () => {
    const onClose = vi.fn();
    renderConProvider(
      <Modal onClose={onClose} ariaLabel="test">
        <div><input aria-label="campo" /></div>
      </Modal>,
    );
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument();
  });

  it('dopo una modifica, Escape chiede conferma e chiude solo su "Esci senza salvare"', async () => {
    const onClose = vi.fn();
    renderConProvider(
      <Modal onClose={onClose} ariaLabel="test">
        <div><input aria-label="campo" /></div>
      </Modal>,
    );

    fireEvent.input(screen.getByLabelText('campo'), { target: { value: 'testo' } });
    fireEvent.keyDown(document, { key: 'Escape' });

    // Compare la guardia; onClose NON è ancora stato chiamato.
    const dialog = await screen.findByRole('alertdialog');
    expect(onClose).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole('button', { name: 'Esci senza salvare' }));
    await waitFor(() => expect(onClose).toHaveBeenCalledTimes(1));
    expect(dialog).not.toBeInTheDocument();
  });

  it('dopo una modifica, "Resta" nella guardia NON chiude il modale', async () => {
    const onClose = vi.fn();
    renderConProvider(
      <Modal onClose={onClose} ariaLabel="test">
        <div><input aria-label="campo" /></div>
      </Modal>,
    );
    fireEvent.input(screen.getByLabelText('campo'), { target: { value: 'x' } });
    fireEvent.keyDown(document, { key: 'Escape' });

    fireEvent.click(await screen.findByRole('button', { name: 'Resta' }));
    await waitFor(() => expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument());
    expect(onClose).not.toHaveBeenCalled();
  });

  it('il click sul backdrop passa dalla guardia quando il modale è modificato', async () => {
    const onClose = vi.fn();
    const { container } = renderConProvider(
      <Modal onClose={onClose} ariaLabel="test">
        <div><input aria-label="campo" /></div>
      </Modal>,
    );
    fireEvent.input(screen.getByLabelText('campo'), { target: { value: 'x' } });

    // L'overlay è il primo figlio renderizzato dal Modal.
    const overlay = container.querySelector('[style*="position: fixed"]') as HTMLElement;
    fireEvent.mouseDown(overlay, { target: overlay });

    await screen.findByRole('alertdialog');
    expect(onClose).not.toHaveBeenCalled();
  });

  it('✕/Annulla via render-prop passano dalla guardia se modificato', async () => {
    const onClose = vi.fn();
    renderConProvider(
      <Modal onClose={onClose} ariaLabel="test">
        {(richiediChiusura) => (
          <div>
            <input aria-label="campo" />
            <button onClick={richiediChiusura}>Annulla</button>
          </div>
        )}
      </Modal>,
    );
    fireEvent.input(screen.getByLabelText('campo'), { target: { value: 'x' } });
    fireEvent.click(screen.getByRole('button', { name: 'Annulla' }));

    await screen.findByRole('alertdialog');
    expect(onClose).not.toHaveBeenCalled();
  });

  it('modale di sola lettura (nessun campo) chiude subito su Escape', () => {
    const onClose = vi.fn();
    renderConProvider(
      <Modal onClose={onClose} ariaLabel="sola-lettura">
        <div>Contenuto informativo senza campi.</div>
      </Modal>,
    );
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('la prop dirty esplicita forza la guardia anche senza eventi input', async () => {
    const onClose = vi.fn();
    renderConProvider(
      <Modal onClose={onClose} ariaLabel="test" dirty>
        <div>Contenuto</div>
      </Modal>,
    );
    fireEvent.keyDown(document, { key: 'Escape' });
    await screen.findByRole('alertdialog');
    expect(onClose).not.toHaveBeenCalled();
  });

  it('espone role="dialog" con aria-label', () => {
    const onClose = vi.fn();
    renderConProvider(
      <Modal onClose={onClose} ariaLabel="Titolo accessibile">
        <div>x</div>
      </Modal>,
    );
    expect(screen.getByRole('dialog', { name: 'Titolo accessibile' })).toBeInTheDocument();
  });
});
