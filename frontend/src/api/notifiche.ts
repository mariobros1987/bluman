import { API_BASE, apiFetch, getAuthHeaders, leggiErroreApi } from './http';

export async function fetchNotificheApi() {
  try {
    const res = await apiFetch(`${API_BASE}/notifiche`, { headers: getAuthHeaders() });
    if (!res.ok) throw new Error('Errore recupero notifiche');
    return await res.json();
  } catch (err) {
    console.warn('Fetch notifiche API fallback', err);
    return null;
  }
}

/** Riga notifica come arriva dal backend (GET /notifiche e stream SSE). */
export interface NotificaStreamEvent {
  id: string;
  tipoEvento: string | null;
  oggetto: string;
  corpo: string;
  link: string | null;
  createdAt: string;
}

/**
 * Blocco 3 — stream di notifiche in tempo reale (Server-Sent Events).
 *
 * `EventSource` non può inviare header Authorization e lo stream è protetto dal
 * JWT come tutte le altre rotte: si apre quindi con fetch e i frame SSE vengono
 * letti a mano. Se la connessione cade si riprova dopo 10 secondi, rileggendo
 * il token da localStorage (così un token rinnovato nel frattempo viene usato).
 *
 * Restituisce la funzione di chiusura da chiamare quando il componente smonta.
 */
export function apriStreamNotifiche(
  onNotifica: (n: NotificaStreamEvent) => void,
  opts?: { onStato?: (connesso: boolean) => void },
): () => void {
  let attivo = true;
  let timer: ReturnType<typeof setTimeout> | null = null;
  const controller = new AbortController();

  const connetti = async () => {
    const token = typeof localStorage !== 'undefined' ? localStorage.getItem('bluman_jwt_token') : null;
    if (!token) {
      // Senza sessione non c'è stream: si riprova più tardi nel caso arrivi un login.
      if (attivo) timer = setTimeout(connetti, 10_000);
      return;
    }
    try {
      const res = await fetch(`${API_BASE}/stream`, {
        headers: { Authorization: `Bearer ${token}` },
        signal: controller.signal,
      });
      if (!res.ok || !res.body) throw new Error(`stream ${res.status}`);
      opts?.onStato?.(true);

      const lettore = res.body.getReader();
      const decodificatore = new TextDecoder();
      let buffer = '';
      // I frame SSE sono blocchi terminati da una riga vuota: `event: ...`, `data: {...}`.
      while (attivo) {
        const { done, value } = await lettore.read();
        if (done) break;
        buffer += decodificatore.decode(value, { stream: true });
        let fineFrame: number;
        while ((fineFrame = buffer.indexOf('\n\n')) >= 0) {
          const frame = buffer.slice(0, fineFrame);
          buffer = buffer.slice(fineFrame + 2);
          let evento = '';
          let dati = '';
          for (const riga of frame.split('\n')) {
            if (riga.startsWith('event:')) evento = riga.slice(6).trim();
            else if (riga.startsWith('data:')) dati += riga.slice(5).trim();
          }
          if (evento === 'notifica' && dati) {
            try {
              onNotifica(JSON.parse(dati) as NotificaStreamEvent);
            } catch {
              // frame malformato: si scarta e si va avanti
            }
          }
        }
      }
    } catch {
      // Connessione rifiutata o interrotta: gestita dalla riconnessione qui sotto.
    }
    opts?.onStato?.(false);
    if (attivo) timer = setTimeout(connetti, 10_000);
  };

  void connetti();

  return () => {
    attivo = false;
    if (timer) clearTimeout(timer);
    controller.abort();
  };
}

export async function markNotificheReadApi() {
  // §3.3 — prima il `catch` restituiva `{ ok: true }`: le notifiche sparivano dalla campanella
  // ma restavano «non lette» a database, ripresentandosi al login successivo.
  const res = await apiFetch(`${API_BASE}/notifiche/read-all`, {
    method: 'PATCH',
    headers: getAuthHeaders(),
  });
  if (!res.ok) throw new Error(await leggiErroreApi(res, 'Errore aggiornamento notifiche'));
  return await res.json();
}
