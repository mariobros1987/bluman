import React, { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react';
import { confirm } from './ConfirmProvider';

// Componente Modal condiviso. Prima ogni modale replicava a mano un overlay
// `position:fixed inset:0` attorno al proprio form, senza role="dialog", senza focus-trap,
// senza gestione di Escape e con comportamenti di chiusura incoerenti (alcuni chiudevano
// cliccando fuori, altri no). Questo componente AVVOLGE il contenuto esistente — non lo
// sostituisce — e porta gratis: accessibilità (dialog + aria + focus-trap + Escape) e una
// guardia "modifiche non salvate" che chiede conferma di uscita SOLO se l'utente ha toccato
// qualcosa. Un modale di sola lettura non ha campi, non diventa mai "sporco", e chiude subito.

interface ModalProps {
  /** Chiusura effettiva, invocata solo dopo che la guardia dirty ha dato l'ok. */
  onClose: () => void;
  /**
   * Contenuto del modale. Può essere JSX diretto oppure una funzione che riceve la
   * chiusura protetta `richiediChiusura`: i pulsanti ✕/Annulla del modale vivono nel
   * componente che RENDERIZZA <Modal> (suo genitore nell'albero), quindi non vedrebbero
   * il context di useModalClose(); la funzione gliela consegna direttamente.
   */
  children: React.ReactNode | ((richiediChiusura: () => void) => React.ReactNode);
  /** id del titolo interno → aria-labelledby (preferito). */
  labelledBy?: string;
  /** Etichetta accessibile alternativa se non c'è un titolo con id. */
  ariaLabel?: string;
  /** Override esplicito del dirty state. Se assente, viene rilevato automaticamente. */
  dirty?: boolean;
  /** Se false, il click sul backdrop non chiude. Default true. */
  closeOnBackdrop?: boolean;
  /** z-index dell'overlay. Default 1050 (allineato alle classi .modal-* di tokens.css). */
  zIndex?: number;
  /** Colore dell'overlay. Default 'rgba(0,0,0,.75)'. */
  overlayBackground?: string;
  /** Messaggio della guardia. Default: chiede se uscire senza salvare. */
  messaggioUscita?: string;
}

// Context per esporre ai children la richiesta di chiusura "protetta". I pulsanti ✕ e Annulla
// dentro il modale la usano al posto di onClose diretto, così anche le chiusure esplicite
// passano dalla guardia dirty (decisione: la guardia vale su TUTTE le chiusure).
const ModalCloseContext = createContext<(() => void) | null>(null);

/** Ritorna la funzione di chiusura protetta del <Modal> che avvolge il componente. */
export function useModalClose(): () => void {
  const ctx = useContext(ModalCloseContext);
  // Fuori da un <Modal> non c'è nulla da chiudere: no-op invece di esplodere.
  return ctx ?? (() => {});
}

const SELETTORE_FOCUSABILI =
  'a[href], button:not([disabled]), textarea:not([disabled]), input:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])';

export function Modal({
  onClose,
  children,
  labelledBy,
  ariaLabel,
  dirty,
  closeOnBackdrop = true,
  zIndex = 1050,
  overlayBackground = 'rgba(0,0,0,.75)',
  messaggioUscita = 'Ci sono modifiche non salvate. Vuoi uscire senza salvare?',
}: ModalProps) {
  const contentRef = useRef<HTMLDivElement>(null);
  const [autoDirty, setAutoDirty] = useState(false);
  // La prop esplicita vince sull'auto-detection quando fornita.
  const isDirty = dirty ?? autoDirty;
  // Ref sempre aggiornata: gli handler globali (Escape) leggono qui senza ri-registrarsi.
  const dirtyRef = useRef(isDirty);
  dirtyRef.current = isDirty;

  const richiediChiusura = useCallback(async () => {
    if (!dirtyRef.current) {
      onClose();
      return;
    }
    if (await confirm({ messaggio: messaggioUscita, confermaLabel: 'Esci senza salvare', annullaLabel: 'Resta', pericolo: true })) {
      onClose();
    }
  }, [onClose, messaggioUscita]);

  // Versione sincrona void per gli handler (onClick, onMouseDown, context).
  const chiudiProtetto = useCallback(() => void richiediChiusura(), [richiediChiusura]);

  // Auto-dirty: qualsiasi input/change nel contenuto marca il modale come modificato.
  // Se la prop `dirty` è passata, l'auto-detection è disattivata (l'override comanda).
  const segnaModificato = useCallback(() => {
    if (dirty === undefined) setAutoDirty(true);
  }, [dirty]);

  // Escape su document (in cattura) → chiusura protetta. Il ConfirmDialog eventualmente
  // aperto sopra ferma la propagazione del suo Escape, quindi non arriva fin qui.
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        void richiediChiusura();
      }
    };
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [richiediChiusura]);

  // Focus-trap: salva il focus precedente, porta il focus nel dialog, lo ripristina all'uscita.
  useEffect(() => {
    const precedente = document.activeElement as HTMLElement | null;
    const nodo = contentRef.current;
    const primoFocusabile = nodo?.querySelector<HTMLElement>(SELETTORE_FOCUSABILI);
    (primoFocusabile ?? nodo)?.focus();
    return () => precedente?.focus?.();
  }, []);

  const onKeyDownTrap = (e: React.KeyboardEvent) => {
    if (e.key !== 'Tab') return;
    const nodo = contentRef.current;
    if (!nodo) return;
    const focusabili = Array.from(nodo.querySelectorAll<HTMLElement>(SELETTORE_FOCUSABILI));
    if (focusabili.length === 0) return;
    const primo = focusabili[0];
    const ultimo = focusabili[focusabili.length - 1];
    if (e.shiftKey && document.activeElement === primo) {
      e.preventDefault();
      ultimo.focus();
    } else if (!e.shiftKey && document.activeElement === ultimo) {
      e.preventDefault();
      primo.focus();
    }
  };

  return (
    // Ruolo, aria e listener stanno sull'overlay stesso: è un box reale (niente
    // display:contents, che in alcuni screen reader fa sparire ruolo e aria). L'overlay
    // è già il contenitore flex che centra il contenuto, come facevano i modali originali.
    <div
      ref={contentRef}
      role="dialog"
      aria-modal="true"
      aria-labelledby={labelledBy}
      aria-label={labelledBy ? undefined : ariaLabel}
      style={{
        position: 'fixed',
        inset: 0,
        background: overlayBackground,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        zIndex,
        padding: 16,
      }}
      // mouseDown (non click) + guardia currentTarget: evita falsi trigger quando si seleziona
      // testo dentro il form e si rilascia il mouse fuori dai bordi.
      onMouseDown={(e) => {
        if (closeOnBackdrop && e.target === e.currentTarget) void richiediChiusura();
      }}
      onInput={segnaModificato}
      onChange={segnaModificato}
      onKeyDown={onKeyDownTrap}
    >
      <ModalCloseContext.Provider value={chiudiProtetto}>
        {typeof children === 'function' ? children(chiudiProtetto) : children}
      </ModalCloseContext.Provider>
    </div>
  );
}
