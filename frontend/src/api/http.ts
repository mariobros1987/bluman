// API Client per integrare il React Frontend con il backend Fastify + Supabase DB
import { getCurrentTenantId } from '../utils/tenant';

/**
 * Il backend dell'**ambiente di prove**: Railway, col suo database. Non è un ripiego per la
 * produzione, ed è la sola cosa che questa costante può essere — vedi `scegliBaseApi`.
 */
const API_BACKEND_RAILWAY = 'https://bluman-api-production.up.railway.app';

/** Il prefisso con cui nginx consegna l'API sulla stessa origine della pagina (VPS). */
const PREFISSO_API = '/api';

/** L'ospite dell'ambiente di prove: solo da qui Railway è una risposta sensata. */
const OSPITE_DI_PROVA = /(^|\.)vercel\.app$/i;

/**
 * §36 — sul VPS il frontend è servito dalla **stessa origine** che espone le API (nginx monta la
 * build Vite e proxa `/api/` su `api:3000`), quindi là la base è un percorso **relativo**:
 * `VITE_API_BASE=/api`.
 *
 * Relativo e non la stringa vuota, che è quello che c'era prima con `VITE_API_SAME_ORIGIN=true`.
 * Senza prefisso una chiamata era indistinguibile da una pagina — `GET /invoices` era sia i dati
 * della pagina Fatture sia la pagina Fatture — e nginx doveva tenere un elenco di prefissi per
 * decidere, salvo sbagliare proprio su `/portal`, `/fornitori`, `/timesheet`, `/liquidazione-iva`,
 * `/reports` e `/admin/tenants`, che si chiamano come le pagine. Con `/api` le due cose non si
 * toccano.
 *
 * Resta vero che la stessa origine **non si deduce**: su Vercel `vercel.json` riscrive su
 * `/index.html` tutto ciò che non è `/api/send-email`, quindi là un percorso relativo tornerebbe
 * una pagina HTML al posto del JSON (§34 punto 2). Le due situazioni si assomigliano e hanno
 * esito opposto, quindi la base si **dichiara** nella build.
 */

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
 * Contro la prima si taglia la barra; contro la seconda non si tiene quella base, e si
 * scende al ripiego — dicendolo in console, perché silenziare l'errore significherebbe far
 * credere all'operatore che il salvataggio sia partito (regola 3).
 */
function normalizzaBase(valore: string): string {
  return valore.trim().replace(/\/+$/, '');
}

function ospiteDi(origine: string): string {
  try {
    return new URL(origine).hostname;
  } catch {
    // Un'origine che non si lascia leggere (ambiente senza `window`, stringa vuota) non è
    // l'ambiente di prove: vale come «ospite sconosciuto» e non fa scattare il ramo Railway.
    return '';
  }
}

/**
 * §37 — **quale backend, deciso qui, una volta sola.**
 *
 * Prima esisteva una sola strada di ripiego: Railway. Andava bene finché Railway *era* la
 * produzione; dal 12/10/2026 la produzione è il VPS e Railway è l'ambiente di prove, e quella
 * riga è diventata il guasto peggiore che questa applicazione possa fare: **una build del
 * frontend che dimentichi `VITE_API_BASE=/api` parla col database di prova e ci scrive.** Non
 * fallisce — il salvataggio riesce, l'interfaccia conferma, il dato non c'è in produzione. È la
 * stessa famiglia del difetto di `urlPubblica.ts`: una configurazione composta per il deployment
 * sbagliato non dà errore, mente.
 *
 * La regola che la sostituisce: **solo l'ambiente di prova può finire su Railway.** Ovunque
 * altrove — il dominio del VPS, l'IP, un nome futuro — il ripiego è il prefisso relativo `/api`
 * di questa stessa origine, che è dove l'API sta davvero quando il frontend è servito dal VPS.
 * Così una dimenticanza ha due esiti, entrambi accettabili: sul VPS il ripiego **indovina**
 * (era la risposta giusta), su Vercel sbaglia dentro l'ambiente di prove, che è l'unico posto
 * dove uno sbaglio non fa danno.
 *
 * Un ospite che non sia `*.vercel.app` **non** ricade su Railway, e vale la pena dirlo: se un
 * giorno la prova si sposta su un dominio proprio, là il ripiego darà `/api` e la chiamata
 * tornerà una pagina HTML — un errore parlante (`apiFetch` lo spiega) invece di un salvataggio
 * nella produzione sbagliata. Il verso in cui si sbaglia è scelto apposta.
 *
 * Perché non «relativo sempre»: su Vercel `/api` non esiste (ci passa solo `send-email`), quindi
 * un ripiego cieco spezzerebbe l'ambiente di prove al primo deploy senza variabile d'ambiente.
 */
function scegliBaseApi(dichiarata: unknown, originePagina: string): string {
  const origine = normalizzaBase(originePagina);
  const ospite = ospiteDi(origine);
  const ambienteDiProva = OSPITE_DI_PROVA.test(ospite);

  if (dichiarata) {
    const base = normalizzaBase(String(dichiarata));
    // La base dichiarata vince — è il punto di tutto il §36. Non vince quando è **questa**
    // origine: non aggiunge niente che il ripiego non sappia già fare meglio, perché `/api`
    // dice *dove* sta l'API dentro l'origine mentre un dominio nudo non lo dice.
    if (base && base !== origine) return base;
  }

  if (ospite === 'localhost' || ospite === '127.0.0.1') return 'http://localhost:3000';

  const scelta = ambienteDiProva ? API_BACKEND_RAILWAY : PREFISSO_API;
  const motivo = dichiarata
    ? `VITE_API_BASE vale «${normalizzaBase(String(dichiarata))}», cioè il dominio di questa pagina`
    : 'VITE_API_BASE non è dichiarata in questa build';
  console.error(
    `[bluman] ${motivo}: ${ambienteDiProva ? 'siamo nell\'ambiente di prove' : 'questa origine non è l\'ambiente di prove'}, uso «${scelta}».` +
      (scelta === PREFISSO_API
        ? ' Se il backend di questa build è altrove, il frontend è compilato per il deployment sbagliato.'
        : ''),
  );
  return scelta;
}

const getApiBase = () => scegliBaseApi(
  typeof import.meta !== 'undefined' && import.meta.env ? import.meta.env.VITE_API_BASE : undefined,
  typeof window !== 'undefined' ? window.location.origin : '',
);

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
      const isPortal = typeof window !== 'undefined' && window.location.pathname.startsWith('/portal');
      const storageKey = isPortal ? 'bluman_portal_token' : 'bluman_jwt_token';
      localStorage.setItem(storageKey, rinnovato);
    }

    if (res.status === 401 && typeof window !== 'undefined' && !url.includes('/auth/login') && !url.includes('/auth/magic-login')) {
      const isPortal = window.location.pathname.startsWith('/portal');
      if (!isPortal) {
        window.dispatchEvent(new Event('bluman_unauthorized'));
      } else {
        // F2: sessione del PORTALE scaduta a metà uso. Distinta da un login fallito (che non ha
        // ancora un token in storage): solo se c'era una sessione si segnala la scadenza, così il
        // cliente torna al login pulito invece di restare su una UI che dà 401 a ogni azione.
        let avevaSessione = false;
        try { avevaSessione = !!localStorage.getItem('bluman_portal_token'); } catch { /* storage non disponibile */ }
        if (avevaSessione) window.dispatchEvent(new Event('bluman_portal_unauthorized'));
      }
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
      `La richiesta non è arrivata al backend: ${url} ha risposto con una pagina HTML (HTTP ${res.status}). Controllare VITE_API_BASE — sul VPS deve valere «/api», il prefisso che nginx toglie prima di consegnare la richiesta all'API.`,
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
  //
  // Separazione token: nel portale cliente (/portal) leggiamo bluman_portal_token
  // (con fallback a bluman_jwt_token per sessioni esistenti), così da evitare
  // collisioni con la sessione dell'operatore/advisor.
  const isPortal = typeof window !== 'undefined' && window.location.pathname.startsWith('/portal');
  const token = typeof localStorage !== 'undefined'
    ? (isPortal ? (localStorage.getItem('bluman_portal_token') || localStorage.getItem('bluman_jwt_token')) : localStorage.getItem('bluman_jwt_token'))
    : null;
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

export { API_BASE, scegliBaseApi, fetchWithTimeout, apiFetch, conCorpoCoerente, urlDocumentoAssoluto, erroreDellaRisposta, leggiErroreApi };
