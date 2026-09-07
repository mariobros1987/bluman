import { useState, useEffect } from 'react';
import type React from 'react';
import { fetchNotificheApi, markNotificheReadApi, apriStreamNotifiche } from '../../api/client';
import type { NotificaStreamEvent } from '../../api/client';
import type { NotificaPortale, PortalTab } from './types';

/**
 * Hook React con la campanella delle notifiche del portale cliente (Blocco 3).
 *
 * Il backend scrive notifiche destinate al cliente (documento da firmare, pagamento
 * registrato, firma apposta): qui si caricano all'accesso e si aggiornano in tempo
 * reale via stream SSE, così il cliente vede subito quando c'è qualcosa da firmare.
 */

interface UsePortalNotificheArgs {
  /** Solo con una sessione attiva si aprono caricamento e stream delle notifiche. */
  isAuthenticated: boolean;
  /** Il link di una notifica porta alla scheda giusta del portale. */
  setActiveTab: (tab: PortalTab) => void;
}

export function usePortalNotifiche({ isAuthenticated, setActiveTab }: UsePortalNotificheArgs): {
  notifichePortale: NotificaPortale[];
  notifPortaleOpen: boolean;
  setNotifPortaleOpen: React.Dispatch<React.SetStateAction<boolean>>;
  notificheNonLette: number;
  handleSegnaNotificheLette: () => Promise<void>;
  handleSelezionaNotificaPortale: (n: NotificaPortale) => void;
} {
  const [notifichePortale, setNotifichePortale] = useState<NotificaPortale[]>([]);
  const [notifPortaleOpen, setNotifPortaleOpen] = useState(false);

  // ── Blocco 3 — CAMPANELLA: CARICAMENTO NOTIFICHE + STREAM IN TEMPO REALE ──
  useEffect(() => {
    if (!isAuthenticated) return;

    (async () => {
      const righe = await fetchNotificheApi();
      if (Array.isArray(righe)) {
        setNotifichePortale(righe.map((n: any) => ({
          id: n.id,
          oggetto: n.oggetto || 'Notifica',
          corpo: n.corpo || '',
          link: n.link || null,
          tipoEvento: n.tipoEvento || null,
          createdAt: n.createdAt || n.inviataAt || '',
          letto: n.statoLettura === 'letta',
        })));
      }
    })();

    const chiudi = apriStreamNotifiche((evento: NotificaStreamEvent) => {
      setNotifichePortale((prev) =>
        prev.some((n) => n.id === evento.id)
          ? prev
          : [{
              id: evento.id,
              oggetto: evento.oggetto,
              corpo: evento.corpo,
              link: evento.link ?? null,
              tipoEvento: evento.tipoEvento ?? null,
              createdAt: evento.createdAt,
              letto: false,
            }, ...prev].slice(0, 50),
      );
    });
    return chiudi;
  }, [isAuthenticated]);

  const notificheNonLette = notifichePortale.filter((n) => !n.letto).length;

  const handleSegnaNotificheLette = async () => {
    setNotifichePortale((prev) => prev.map((n) => ({ ...n, letto: true })));
    // §3.3 — la campanella si svuota subito (stato visuale), ma se la scrittura sul server
    // fallisce lo notifichiamo in console invece di far finta di niente con un'eccezione
    // non gestita: al prossimo accesso le notifiche torneranno da leggere.
    try {
      await markNotificheReadApi();
    } catch (err) {
      console.warn('Segnala-notifiche-lette non persistito sul server:', err);
    }
  };

  /** Il link della notifica porta alla scheda giusta del portale. */
  const handleSelezionaNotificaPortale = (n: NotificaPortale) => {
    setNotifPortaleOpen(false);
    if (n.link === '/portal/documents') setActiveTab('documenti');
    else if (n.link === '/portal/invoices') setActiveTab('fatture');
    // Punto 4 — le risposte di addendum e proposte dati vivono nella tab «Proposta»;
    // la conferma di una firma si rivede nell'avanzamento.
    else if (n.link === '/portal/proposal') setActiveTab('proposta');
    else if (n.link === '/portal/avanzamento') setActiveTab('avanzamento');
  };

  return {
    notifichePortale,
    notifPortaleOpen,
    setNotifPortaleOpen,
    notificheNonLette,
    handleSegnaNotificheLette,
    handleSelezionaNotificaPortale,
  };
}
