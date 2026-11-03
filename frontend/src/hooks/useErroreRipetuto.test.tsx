import { describe, it, expect, vi } from 'vitest';
import type { ReactNode } from 'react';
import { act, renderHook, screen } from '@testing-library/react';
import { ToastProvider } from '../components/ui/ToastProvider';
import { useErroreRipetuto } from './useErroreRipetuto';

const conProvider = ({ children }: { children: ReactNode }) => <ToastProvider>{children}</ToastProvider>;

describe('useErroreRipetuto', () => {
  it('lo stesso errore ripetuto dal polling si mostra una volta, e di nuovo dopo un successo', () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const { result, rerender } = renderHook(() => useErroreRipetuto(), { wrapper: conProvider });
    const primo = result.current;

    act(() => {
      result.current.fallito('segna-lette', 'Messaggi non segnati come letti', new Error('403'));
      result.current.fallito('segna-lette', 'Messaggi non segnati come letti', new Error('403'));
    });
    expect(screen.getAllByText(/Messaggi non segnati come letti: 403/)).toHaveLength(1);

    act(() => {
      result.current.riuscito('segna-lette');
      result.current.fallito('segna-lette', 'Messaggi non segnati come letti', new Error('403'));
    });
    expect(screen.getAllByText(/Messaggi non segnati come letti: 403/)).toHaveLength(2);

    // Stabile fra i render: può stare nelle dipendenze di un effetto di polling.
    rerender();
    expect(result.current).toBe(primo);
  });
});
