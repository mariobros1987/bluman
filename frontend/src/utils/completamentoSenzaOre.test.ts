// Titolare, 28/11/2026 (risposta 13) — completare un'attività senza ore: conferma, non blocco.
import { describe, it, expect, vi, beforeEach } from 'vitest';

const { confirm } = vi.hoisted(() => ({ confirm: vi.fn() }));
vi.mock('../components/ui/ConfirmProvider', () => ({ confirm }));

import { confermaCompletamentoSenzaOre, DOMANDA_COMPLETARE_SENZA_ORE, senzaOreSegnate } from './completamentoSenzaOre';

beforeEach(() => confirm.mockReset());

describe('completamento senza ore', () => {
  it('zero, assente o non numerico = senza ore; un valore positivo no', () => {
    expect(senzaOreSegnate(0)).toBe(true);
    expect(senzaOreSegnate(undefined)).toBe(true);
    expect(senzaOreSegnate(null)).toBe(true);
    expect(senzaOreSegnate(0.5)).toBe(false);
  });

  it('con ore segnate non chiede niente', async () => {
    await expect(confermaCompletamentoSenzaOre(3)).resolves.toBe(true);
    expect(confirm).not.toHaveBeenCalled();
  });

  it('senza ore chiede con la frase del titolare, e rispetta la risposta', async () => {
    confirm.mockResolvedValueOnce(false);
    await expect(confermaCompletamentoSenzaOre(0)).resolves.toBe(false);
    expect(confirm).toHaveBeenCalledWith(expect.objectContaining({ messaggio: DOMANDA_COMPLETARE_SENZA_ORE }));
    expect(DOMANDA_COMPLETARE_SENZA_ORE).toBe('Non hai segnato ore su questa attività: completare lo stesso?');

    confirm.mockResolvedValueOnce(true);
    await expect(confermaCompletamentoSenzaOre(0)).resolves.toBe(true);
  });
});
