import React, { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react';

// Dialog di conferma centralizzato, zero dipendenze. Sostituisce il confirm() nativo
// (bloccante, aspetto da browser, non tematizzabile, non accessibile) con un dialog
// modale tematizzato che ritorna una Promise<boolean>. Rispecchia il pattern di
// ToastProvider: Context + bus a livello di modulo per i file non-componente, ma qui
// serve un valore di ritorno perché il confirm() è semanticamente una domanda.

export interface ConfirmOptions {
  titolo?: string;
  messaggio: string;
  confermaLabel?: string;
  annullaLabel?: string;
  /** Se true, il pulsante di conferma prende lo stile "pericolo" (rosso) per le azioni distruttive. */
  pericolo?: boolean;
}

export type ConfirmFn = (opts: string | ConfirmOptions) => Promise<boolean>;

interface CodaItem {
  id: number;
  opts: ConfirmOptions;
  resolve: (esito: boolean) => void;
}

function normalizza(opts: string | ConfirmOptions): ConfirmOptions {
  return typeof opts === 'string' ? { messaggio: opts } : opts;
}

// ─── Bus a livello di modulo ─────────────────────────────────────
// I file che NON sono componenti React (api/*.ts, utils/*.ts, o funzioni fuori dall'albero)
// non possono usare l'hook. Il provider si registra qui all'avvio; `confirm(...)` inoltra al
// provider attivo, o ripiega sul confirm() nativo se il provider non è ancora montato — il
// valore di ritorno è necessario, quindi il fallback non può essere un no-op.
let emettitore: ConfirmFn | null = null;

export const confirm: ConfirmFn = (opts) => {
  if (emettitore) return emettitore(opts);
  const o = normalizza(opts);
  // eslint-disable-next-line no-alert
  return Promise.resolve(window.confirm(o.titolo ? `${o.titolo}\n\n${o.messaggio}` : o.messaggio));
};

const ConfirmContext = createContext<ConfirmFn | null>(null);

export function ConfirmProvider({ children }: { children: React.ReactNode }) {
  const [coda, setCoda] = useState<CodaItem[]>([]);
  const prossimoId = useRef(1);

  const richiedi = useCallback<ConfirmFn>((opts) => {
    const o = normalizza(opts);
    return new Promise<boolean>((resolve) => {
      const id = prossimoId.current++;
      setCoda((prev) => [...prev, { id, opts: o, resolve }]);
    });
  }, []);

  const rispondi = useCallback((id: number, esito: boolean) => {
    setCoda((prev) => {
      const item = prev.find((c) => c.id === id);
      if (item) item.resolve(esito);
      return prev.filter((c) => c.id !== id);
    });
  }, []);

  // Registra questo provider come emettitore globale per i file non-componente.
  emettitore = richiedi;

  // Mostra un solo dialog per volta (il primo della coda), per rispecchiare la semantica
  // bloccante del confirm() nativo che sostituisce.
  const attivo = coda[0] ?? null;

  return (
    <ConfirmContext.Provider value={richiedi}>
      {children}
      {attivo && (
        <ConfirmDialog
          key={attivo.id}
          opts={attivo.opts}
          onConferma={() => rispondi(attivo.id, true)}
          onAnnulla={() => rispondi(attivo.id, false)}
        />
      )}
    </ConfirmContext.Provider>
  );
}

function ConfirmDialog({
  opts,
  onConferma,
  onAnnulla,
}: {
  opts: ConfirmOptions;
  onConferma: () => void;
  onAnnulla: () => void;
}) {
  const dialogRef = useRef<HTMLDivElement>(null);
  const annullaRef = useRef<HTMLButtonElement>(null);
  const titoloId = useRef(`confirm-titolo-${Math.random().toString(36).slice(2)}`).current;
  const msgId = useRef(`confirm-msg-${Math.random().toString(36).slice(2)}`).current;

  // Focus sul pulsante Annulla all'apertura (scelta sicura di default).
  useEffect(() => {
    annullaRef.current?.focus();
  }, []);

  // Escape = Annulla, Invio = Conferma, Tab = focus-trap dentro il dialog.
  // stopPropagation su Escape così un eventuale <Modal> sottostante (z-index minore) non
  // riceve anch'esso l'Escape e chiude a sua volta.
  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Escape') {
      e.stopPropagation();
      e.preventDefault();
      onAnnulla();
      return;
    }
    if (e.key === 'Enter') {
      e.preventDefault();
      onConferma();
      return;
    }
    if (e.key === 'Tab') {
      const focusabili = dialogRef.current?.querySelectorAll<HTMLElement>('button');
      if (!focusabili || focusabili.length === 0) return;
      const primo = focusabili[0];
      const ultimo = focusabili[focusabili.length - 1];
      if (e.shiftKey && document.activeElement === primo) {
        e.preventDefault();
        ultimo.focus();
      } else if (!e.shiftKey && document.activeElement === ultimo) {
        e.preventDefault();
        primo.focus();
      }
    }
  };

  return (
    <div className="confirm-overlay" onMouseDown={(e) => { if (e.target === e.currentTarget) onAnnulla(); }}>
      <div
        ref={dialogRef}
        className="confirm-dialog"
        role="alertdialog"
        aria-modal="true"
        aria-labelledby={opts.titolo ? titoloId : undefined}
        aria-describedby={msgId}
        aria-label={opts.titolo ? undefined : 'Conferma'}
        onKeyDown={onKeyDown}
      >
        {opts.titolo && <div id={titoloId} className="confirm-titolo">{opts.titolo}</div>}
        <div id={msgId} className="confirm-messaggio">{opts.messaggio}</div>
        <div className="confirm-azioni">
          <button ref={annullaRef} type="button" className="confirm-btn confirm-btn-annulla" onClick={onAnnulla}>
            {opts.annullaLabel ?? 'Annulla'}
          </button>
          <button
            type="button"
            className={`confirm-btn ${opts.pericolo ? 'confirm-btn-pericolo' : 'confirm-btn-conferma'}`}
            onClick={onConferma}
          >
            {opts.confermaLabel ?? 'Conferma'}
          </button>
        </div>
      </div>
    </div>
  );
}

/**
 * Hook per chiedere conferma. Va usato dentro l'albero avvolto da <ConfirmProvider>.
 * Se usato fuori (test isolati) ripiega sul confirm() nativo, così il valore di ritorno
 * resta significativo anche senza provider.
 */
export function useConfirm(): ConfirmFn {
  const ctx = useContext(ConfirmContext);
  return ctx ?? confirm;
}
