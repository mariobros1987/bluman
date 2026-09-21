import React, { createContext, useCallback, useContext, useMemo, useRef, useState } from 'react';

// Sistema di toast centralizzato, zero dipendenze. Sostituisce gli alert() nativi
// (blocco della pagina, aspetto da errore del browser) con avvisi tematizzati che
// scompaiono da soli. I colori seguono i token del tema (chiaro+scuro): verde =
// successo, rosso = errore, blu = info, ambra = attenzione.

export type ToastTipo = 'success' | 'error' | 'info' | 'warning';

export interface Toast {
  id: number;
  tipo: ToastTipo;
  messaggio: string;
}

interface ToastContextValue {
  /** Mostra un toast. Ritorna l'id (per un eventuale dismiss manuale). */
  mostra: (messaggio: string, tipo?: ToastTipo, durataMs?: number) => number;
  successo: (messaggio: string, durataMs?: number) => number;
  errore: (messaggio: string, durataMs?: number) => number;
  info: (messaggio: string, durataMs?: number) => number;
  attenzione: (messaggio: string, durataMs?: number) => number;
  chiudi: (id: number) => void;
}

const ToastContext = createContext<ToastContextValue | null>(null);

// ─── Bus a livello di modulo ─────────────────────────────────────
// I file che NON sono componenti React (api/*.ts, utils/*.ts) non possono usare l'hook.
// Il provider si registra qui all'avvio; `toast.*` inoltra al provider attivo, o ripiega
// su console se il provider non è ancora montato (es. errore prima del render).
let emettitore: ToastContextValue | null = null;

export const toast = {
  successo: (m: string, d?: number) => emettitore?.successo(m, d) ?? fallbackConsole(m),
  errore: (m: string, d?: number) => emettitore?.errore(m, d) ?? fallbackConsole(m),
  info: (m: string, d?: number) => emettitore?.info(m, d) ?? fallbackConsole(m),
  attenzione: (m: string, d?: number) => emettitore?.attenzione(m, d) ?? fallbackConsole(m),
};

function fallbackConsole(messaggio: string): number {
  // eslint-disable-next-line no-console
  console.warn('[toast prima del mount]', messaggio);
  return -1;
}

// Durate predefinite: gli errori restano più a lungo (vanno letti), il successo sparisce presto.
const DURATA_DEFAULT: Record<ToastTipo, number> = {
  success: 3500,
  info: 4000,
  warning: 5000,
  error: 6000,
};

const ICONA: Record<ToastTipo, string> = {
  success: '✓',
  error: '✕',
  info: 'ℹ',
  warning: '⚠',
};

export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const prossimoId = useRef(1);
  const timers = useRef<Map<number, ReturnType<typeof setTimeout>>>(new Map());

  const chiudi = useCallback((id: number) => {
    setToasts((prev) => prev.filter((t) => t.id !== id));
    const timer = timers.current.get(id);
    if (timer) {
      clearTimeout(timer);
      timers.current.delete(id);
    }
  }, []);

  const mostra = useCallback(
    (messaggio: string, tipo: ToastTipo = 'info', durataMs?: number): number => {
      const id = prossimoId.current++;
      setToasts((prev) => [...prev, { id, tipo, messaggio }]);
      const durata = durataMs ?? DURATA_DEFAULT[tipo];
      // durata 0 = persistente finché non lo chiude l'utente.
      if (durata > 0) {
        const timer = setTimeout(() => chiudi(id), durata);
        timers.current.set(id, timer);
      }
      return id;
    },
    [chiudi],
  );

  const value = useMemo<ToastContextValue>(
    () => ({
      mostra,
      successo: (m, d) => mostra(m, 'success', d),
      errore: (m, d) => mostra(m, 'error', d),
      info: (m, d) => mostra(m, 'info', d),
      attenzione: (m, d) => mostra(m, 'warning', d),
      chiudi,
    }),
    [mostra, chiudi],
  );

  // Registra questo provider come emettitore globale per i file non-componente.
  emettitore = value;

  return (
    <ToastContext.Provider value={value}>
      {children}
      <div className="toast-viewport" role="region" aria-label="Notifiche" aria-live="polite">
        {toasts.map((t) => (
          <div key={t.id} className={`toast toast-${t.tipo}`} role={t.tipo === 'error' ? 'alert' : 'status'}>
            <span className="toast-icona" aria-hidden="true">{ICONA[t.tipo]}</span>
            <span className="toast-messaggio">{t.messaggio}</span>
            <button
              type="button"
              className="toast-chiudi"
              aria-label="Chiudi notifica"
              onClick={() => chiudi(t.id)}
            >
              ✕
            </button>
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
}

/**
 * Hook per mostrare i toast. Va usato dentro l'albero avvolto da <ToastProvider>.
 * Se usato fuori (test isolati, storybook) ritorna un fallback che ripiega su console,
 * così un componente non esplode per la sola assenza del provider.
 */
export function useToast(): ToastContextValue {
  const ctx = useContext(ToastContext);
  if (ctx) return ctx;
  const noop = (messaggio: string) => {
    // eslint-disable-next-line no-console
    console.warn('[toast senza provider]', messaggio);
    return -1;
  };
  return {
    mostra: noop,
    successo: noop,
    errore: noop,
    info: noop,
    attenzione: noop,
    chiudi: () => {},
  };
}
