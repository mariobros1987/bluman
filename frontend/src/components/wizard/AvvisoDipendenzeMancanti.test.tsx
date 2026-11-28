// Titolare, 28/11/2026 (risposta 12) — «Questo modulo di solito viene dopo …: aggiungerlo?».
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { AvvisoDipendenzeMancanti } from './AvvisoDipendenzeMancanti';

const analisi = { id: 'm01', n: 'Analisi patrimoniale', deps: [] as string[] };
const corporate = { id: 'm02', n: 'Corporate structuring', deps: ['m01'] };

describe('AvvisoDipendenzeMancanti', () => {
  it('avvisa e offre di aggiungere il modulo che viene prima', () => {
    const onAggiungi = vi.fn();
    render(<AvvisoDipendenzeMancanti scelti={[corporate]} libreria={[analisi, corporate]} onAggiungi={onAggiungi} />);

    expect(screen.getByRole('status').textContent).toContain('«Corporate structuring» di solito viene dopo «Analisi patrimoniale»: aggiungerlo?');
    // È un avviso, non un blocco: lo dice.
    expect(screen.getByText(/il progetto si può creare anche senza/)).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Aggiungi «Analisi patrimoniale»' }));
    expect(onAggiungi).toHaveBeenCalledWith('m01');
  });

  it('senza dipendenze mancanti non mostra niente', () => {
    const { container } = render(<AvvisoDipendenzeMancanti scelti={[analisi, corporate]} libreria={[analisi, corporate]} onAggiungi={vi.fn()} />);
    expect(container.firstChild).toBeNull();
  });
});
