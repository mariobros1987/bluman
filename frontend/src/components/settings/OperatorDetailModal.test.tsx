// Regressione dello step 1.1 (A1): il server valida le chiavi della matrice con le 12 di
// `MODULI_RBAC` e risponde 400 a quelle che non conosce. La schermata ne mostra 14 — anche
// `calendar` e `settings`, che vivono solo nel browser — e toccandole il salvataggio falliva tutto.
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';
import { MODULI_RBAC } from '../../../../src/util/rbacModuli';

const { successo, errore } = vi.hoisted(() => ({ successo: vi.fn(), errore: vi.fn() }));

vi.mock('../../api/client', () => ({
  fetchProgetti: vi.fn().mockResolvedValue([]),
  fetchPermessiUtenteApi: vi.fn().mockResolvedValue([]),
  salvaPermessiUtenteApi: vi.fn(),
}));
vi.mock('../ui/ToastProvider', () => ({
  useToast: () => ({ successo, errore, info: vi.fn(), attenzione: vi.fn() }),
}));

import { OperatorDetailModal } from './OperatorDetailModal';
import { salvaPermessiUtenteApi } from '../../api/client';

const OPERATORE = { id: 'usr-collab', nome: 'Giulia Neri', email: 'giulia@studio.example', ruolo: 'collaboratore_interno' };

/** La riga della matrice di un modulo, dall'etichetta. */
function rigaModulo(etichetta: RegExp): HTMLElement {
  return screen.getByText(etichetta).parentElement!.parentElement!;
}

/** Un pulsante dal suo testo. `getByText` e non `getByRole`: il ruolo calcola il nome accessibile
 *  di tutto il DOM della matrice e, con le prove in parallelo, superava da solo i 5 s del test. */
function bottone(testo: RegExp, dentro: HTMLElement = document.body): HTMLElement {
  return within(dentro).getByText(testo, { selector: 'button' });
}

beforeEach(() => {
  successo.mockClear();
  errore.mockClear();
  vi.mocked(salvaPermessiUtenteApi).mockReset().mockResolvedValue({ ok: true });
});

describe('OperatorDetailModal — salvataggio della matrice permessi', () => {
  it("con 'calendar' toccato, l'API riceve solo le chiavi della matrice server e il salvataggio riesce", async () => {
    render(<OperatorDetailModal operator={OPERATORE} onClose={vi.fn()} />);
    fireEvent.click(bottone(/Matrice Permessi & Accessi/));

    fireEvent.click(bottone(/Bloccato/, rigaModulo(/Calendario Studio/)));
    fireEvent.click(bottone(/Lettura/, rigaModulo(/Impostazioni Studio/)));
    fireEvent.click(bottone(/Salva Matrice Permessi/));

    await waitFor(() => expect(salvaPermessiUtenteApi).toHaveBeenCalledTimes(1));
    const [userId, inviati] = vi.mocked(salvaPermessiUtenteApi).mock.calls[0]!;
    expect(userId).toBe('usr-collab');
    const chiavi = (inviati as Array<{ moduloChiave: string }>).map((p) => p.moduloChiave);
    expect(chiavi.length).toBeGreaterThan(0);
    expect(chiavi.every((k) => (MODULI_RBAC as readonly string[]).includes(k))).toBe(true);
    expect(chiavi).not.toContain('calendar');
    expect(chiavi).not.toContain('settings');
    expect(successo).toHaveBeenCalled();
    expect(errore).not.toHaveBeenCalled();
  });

  it("'calendar' e 'settings' restano salvati in locale, come prima", async () => {
    render(<OperatorDetailModal operator={OPERATORE} onClose={vi.fn()} />);
    fireEvent.click(bottone(/Matrice Permessi & Accessi/));

    fireEvent.click(bottone(/Bloccato/, rigaModulo(/Calendario Studio/)));
    fireEvent.click(bottone(/Salva Matrice Permessi/));
    await waitFor(() => expect(salvaPermessiUtenteApi).toHaveBeenCalled());

    const chiaveLocale = Object.keys(localStorage).find((k) => k.includes('bluman_rbac_permissions_usr-collab'));
    expect(chiaveLocale).toBeDefined();
    const locali = JSON.parse(localStorage.getItem(chiaveLocale!)!);
    expect(locali).toContainEqual({ moduloChiave: 'calendar', livello: 'denied' });
  });
});
