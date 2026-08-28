import { API_BASE, apiFetch, getAuthHeaders, leggiErroreApi } from './http';

export async function fetchClienti() {
  try {
    const res = await apiFetch(`${API_BASE}/clienti`, { headers: getAuthHeaders() });
    if (!res.ok) throw new Error('Errore nel recupero clienti');
    return await res.json();
  } catch (err) {
    console.warn('Backend API offline', err);
    return null;
  }
}

export async function creaClienteApi(input: { nome: string; tipo?: 'individual' | 'company'; [key: string]: any }) {
  const res = await apiFetch(`${API_BASE}/clienti`, {
    method: 'POST',
    headers: getAuthHeaders(),
    body: JSON.stringify(input),
  });
  if (!res.ok) throw new Error('Errore creazione cliente');
  return await res.json();
}

export async function aggiornaClienteApi(id: string, input: Record<string, any>) {
  const res = await apiFetch(`${API_BASE}/clienti/${encodeURIComponent(id)}`, {
    method: 'PUT',
    headers: getAuthHeaders(),
    body: JSON.stringify(input),
  });
  if (!res.ok) throw new Error('Errore aggiornamento cliente');
  return await res.json();
}

/**
 * Genera un Magic Link per il portale cliente.
 *
 * Il token lo emette e lo firma il server: prima il modale se lo costruiva nel browser
 * (`client_${id.substring(0,8)}`) e nessuno lo aveva mai registrato, quindi il link non
 * apriva nulla — o, peggio, apriva tutto, perché l'endpoint di verifica accettava qualunque
 * stringa. L'indirizzo è obbligatorio: `Cliente` non ha una colonna email e il server non
 * inventa un destinatario.
 */
export async function generaMagicLinkApi(clienteId: string, email: string) {
  const res = await apiFetch(`${API_BASE}/clienti/${encodeURIComponent(clienteId)}/magic-link`, {
    method: 'POST',
    headers: getAuthHeaders(),
    body: JSON.stringify({ email }),
  });
  if (!res.ok) {
    const dettaglio = await res.json().catch(() => null);
    throw new Error(dettaglio?.errore || 'Errore generazione Magic Link');
  }
  return (await res.json()) as {
    ok: boolean;
    sent: boolean;
    /** Perché l'email non è partita: l'operatore deve poter consegnare il link a mano. */
    erroreInvio?: string;
    magicUrl: string;
    magicToken: string;
    scadenza: string;
  };
}

/**
 * Genera o reimposta la password di accesso per il cliente, inviando opzionalmente l'email.
 */
export async function resetPasswordClienteApi(clienteId: string) {
  const res = await apiFetch(`${API_BASE}/clienti/${encodeURIComponent(clienteId)}/reset-password`, {
    method: 'POST',
    headers: getAuthHeaders(),
    body: JSON.stringify({}),
  });
  if (!res.ok) {
    const dettaglio = await res.json().catch(() => null);
    throw new Error(dettaglio?.errore || 'Errore generazione password cliente');
  }
  return (await res.json()) as {
    ok: boolean;
    passwordChiaro: string;
    email: string;
    emailInviata: boolean;
    erroreInvioEmail?: string;
  };
}

// ─────────────────────────────────────────────────────────────────
// BLOCCO 6.2 — SUGGERIMENTO OPERATORE PER ASSEGNAZIONE
// Criterio deciso dallo studio: prima la specializzazione (match con la
// categoria del lavoro), poi il minor carico di lavoro.
// ─────────────────────────────────────────────────────────────────

export interface OperatoreSuggeritoApi {
  id: string;
  nome: string;
  ruolo: string;
  specializzazione: string | null;
  corrisponde: boolean;
  oreSettimana: number;
  oreResidue: number;
  caricoOre: number;
}

/** Operatori ordinati per specializzazione + minor carico (carico = ore settimana + ore residue su voci aperte). */
export async function fetchOperatoriSuggeriti(categoria?: string): Promise<{ criterio: string; categoria: string | null; suggeriti: OperatoreSuggeritoApi[] }> {
  const qs = categoria ? `?categoria=${encodeURIComponent(categoria)}` : '';
  const res = await apiFetch(`${API_BASE}/operatori-suggeriti${qs}`, { headers: getAuthHeaders() });
  if (!res.ok) throw new Error(await leggiErroreApi(res, 'Errore calcolo operatori suggeriti'));
  return await res.json();
}
