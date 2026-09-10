// API Client per integrare il React Frontend con il backend Fastify + Supabase DB
import { getCurrentTenantId } from '../utils/tenant';

/** Il backend dello studio: unico posto dove le rotte Fastify esistono davvero. */
const API_BACKEND_RAILWAY = 'https://bluman-api-production.up.railway.app';

/**
 * §34 — due modi in cui la base delle API fa sparire una rotta che esiste.
 *
 * Il guasto osservato in produzione era un 404 su `POST /documenti/genera`, con la
 * rotta regolarmente presente nel ramo distribuito. Le due configurazioni che lo
 * producono senza toccare una riga di codice del server sono qui:
 *
 * 1. la barra finale. `VITE_API_BASE=https://…app/` più `${API_BASE}/documenti/genera`
 *    dà `https://…app//documenti/genera`: per il router di Fastify quel doppio
 *    slash è un altro percorso, e la risposta è il 404 del gestore not-found;
 * 2. la base che punta al dominio del frontend. Là `vercel.json` riscrive tutto
 *    quello che non è `/api/send-email` o i due webhook su `/index.html`: la POST
 *    non raggiunge mai Railway e quello che torna non è una risposta dell'API.
 *
 * Contro la prima si taglia la barra; contro la seconda si rifiuta la base e si
 * torna a Railway, dicendolo in console — silenziare l'errore significherebbe far
 * credere all'operatore che il salvataggio sia partito (regola 3).
 */
function normalizzaBase(valore: string): string {
  return valore.trim().replace(/\/+$/, '');
}

const getApiBase = () => {
  const dichiarata =
    typeof import.meta !== 'undefined' && import.meta.env ? import.meta.env.VITE_API_BASE : undefined;

  if (dichiarata) {
    const base = normalizzaBase(String(dichiarata));
    const origineDellaPagina = typeof window !== 'undefined' ? normalizzaBase(window.location.origin) : '';
    if (base && base !== origineDellaPagina) return base;
    if (base) {
      // Non è un dettaglio di stile: su questo dominio non esiste nessuna rotta
      // API, quindi la richiesta tornerebbe muta invece di arrivare al backend.
      console.error(
        `[bluman] VITE_API_BASE punta al dominio del frontend (${base}): su quel dominio le rotte API non esistono. Uso ${API_BACKEND_RAILWAY}.`,
      );
    }
  }

  if (typeof window !== 'undefined' && (window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1')) {
    return 'http://localhost:3000';
  }
  return API_BACKEND_RAILWAY;
};

const API_BASE = getApiBase();

// Helper nativo per le chiamate di rete al backend Cloud con timeout configurabile
async function fetchWithTimeout(url: string, options: RequestInit = {}, timeoutMs: number = 8000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, { ...options, signal: controller.signal });
    clearTimeout(timer);

    // Rinnovo scorrevole della sessione: superata metà della vita del token il backend ne
    // manda uno nuovo in questo header, e qui prende il posto del precedente. Serve a non
    // buttare fuori chi sta lavorando: prima il token durava un'ora e non si rinnovava, quindi
    // a metà giornata ogni salvataggio tornava 401.
    const rinnovato = res.headers.get('X-Bluman-Token');
    if (rinnovato && typeof localStorage !== 'undefined') {
      localStorage.setItem('bluman_jwt_token', rinnovato);
    }

    if (res.status === 401 && typeof window !== 'undefined' && !url.includes('/auth/login') && !url.includes('/auth/magic-login') && !window.location.pathname.startsWith('/portal')) {
      window.dispatchEvent(new Event('bluman_unauthorized'));
    }
    return res;
  } catch (error) {
    clearTimeout(timer);
    throw error;
  }
}

/**
 * La chiamata usata da tutte le funzioni di questo file.
 *
 * Esisteva già `fetchWithTimeout`, che segnala la sessione scaduta con l'evento
 * `bluman_unauthorized`, ma la usavano 8 funzioni su 87: le altre chiamavano `fetch` nudo. Il
 * risultato pratico: il token di accesso dura poco, l'operatore che resta al lavoro oltre la
 * scadenza riceve 401 su ogni salvataggio, nessuno di quei 401 veniva riconosciuto come
 * sessione scaduta, e i `catch` di queste funzioni li trasformavano in `{ok: true}`. Da lì il
 * guasto che si vedeva: l'operatore aggiunge moduli, l'interfaccia conferma, il database non
 * riceve niente e il portale del cliente resta vuoto.
 *
 * Il timeout è di sessanta secondi, più lungo di qualunque attesa lato server (il relay email
 * si arrende a quarantacinque): così quello che arriva all'utente è il motivo vero del server,
 * non un timeout del browser che nasconde la risposta in arrivo.
 *
 * §34 — se torna una pagina HTML la richiesta non ha mai raggiunto il backend: nessuna rotta
 * dell'API risponde `text/html`, mentre il rewrite `/(.*)` → `/index.html` di `vercel.json`
 * risponde così a qualunque percorso. Senza questo controllo l'operatore vedeva un errore di
 * lettura JSON, cioè un sintomo che non nomina la causa; peggio, una risposta HTML con stato
 * 200 passava per riuscita.
 */
async function apiFetch(url: string, options: RequestInit = {}, timeoutMs: number = 60000) {
  const res = await fetchWithTimeout(url, conCorpoCoerente(options), timeoutMs);
  const tipo = res.headers.get('content-type') || '';
  if (tipo.includes('text/html')) {
    throw new Error(
      `La richiesta non è arrivata al backend: ${url} ha risposto con una pagina HTML (HTTP ${res.status}). Controllare VITE_API_BASE del frontend.`,
    );
  }
  return res;
}

/**
 * Rende coerente la coppia intestazione/corpo prima di partire.
 *
 * `getAuthHeaders()` dichiara sempre `Content-Type: application/json`, perché quasi tutte le
 * chiamate mandano un oggetto. Le poche che non hanno niente da mandare — accettare un
 * preventivo, ricalcolare un progetto, azzerare una password — partivano quindi annunciando un
 * JSON che non c'era, e Fastify le rifiutava in blocco con «Body cannot be empty when
 * content-type is set to 'application/json'»: nessuna arrivava al gestore della rotta. Era il
 * guasto per cui la creazione di un progetto si fermava a metà, con il preventivo scritto a
 * database e i moduli mai istanziati.
 *
 * Si manda `{}`: un oggetto vuoto è quello che quelle rotte si aspettano di leggere, e non
 * cambia niente per chi un corpo lo passa davvero.
 */
function conCorpoCoerente(options: RequestInit): RequestInit {
  const metodo = (options.method || 'GET').toUpperCase();
  const intestazioni = { ...((options.headers as Record<string, string>) ?? {}) };

  if (metodo === 'GET' || metodo === 'HEAD' || metodo === 'DELETE') {
    if (!options.body) {
      delete intestazioni['Content-Type'];
      delete intestazioni['content-type'];
      return { ...options, headers: intestazioni };
    }
    return options;
  }

  if (options.body !== undefined && options.body !== null) return options;

  const dichiaraJson = Object.entries(intestazioni).some(
    ([nome, valore]) => nome.toLowerCase() === 'content-type' && String(valore).includes('application/json'),
  );
  if (!dichiaraJson) return options;

  return { ...options, headers: intestazioni, body: '{}' };
}

export function getAuthHeaders() {
  // §23 — nessun token di ripiego. Prima qui c'era `|| 'jwt_advisor_mock_123'`, una
  // stringa che non è un JWT: il backend non poteva verificarla, ne ricavava un ruolo
  // indefinito e trattava la richiesta come non autenticata. Meglio non mandare affatto
  // l'header: la risposta è un 401 esplicito invece di un comportamento inspiegabile.
  const token = typeof localStorage !== 'undefined' ? localStorage.getItem('bluman_jwt_token') : null;
  const tenantId = getCurrentTenantId();
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    'x-tenant-id': tenantId,
  };
  if (token) headers.Authorization = `Bearer ${token}`;
  return headers;
}

// Lo storage locale di fallback serve i file da /uploads/<nome> sul backend: per il
// browser quei path relativi puntano al frontend, quindi li rendiamo assoluti.
function urlDocumentoAssoluto(fileUrl: unknown): string {
  if (typeof fileUrl === 'string' && fileUrl.startsWith('/uploads/')) return `${API_BASE}${fileUrl}`;
  return typeof fileUrl === 'string' ? fileUrl : '';
}

/** Legge l'errore dal corpo della risposta: il backend spiega sempre il rifiuto. */
async function erroreDellaRisposta(res: Response, ripiego: string): Promise<Error & { attendiSecondi?: number; status: number }> {
  let messaggio = ripiego;
  let attendiSecondi: number | undefined;
  try {
    const body = await res.json();
    messaggio = body?.errore || ripiego;
    attendiSecondi = body?.attendiSecondi;
  } catch {
    // Risposta non JSON (proxy, 502 di Railway): resta il messaggio di ripiego.
  }
  const err = Object.assign(new Error(messaggio), { status: res.status, attendiSecondi });
  return err;
}

async function leggiErroreApi(res: Response, fallback: string): Promise<string> {
  const body = await res.json().catch(() => null);
  return body?.errore || body?.error || body?.message || `${fallback} (HTTP ${res.status})`;
}

export { API_BASE, fetchWithTimeout, apiFetch, conCorpoCoerente, urlDocumentoAssoluto, erroreDellaRisposta, leggiErroreApi };
