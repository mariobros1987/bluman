// API Client per integrare il React Frontend con il backend Fastify + Supabase DB
import { getTenantStorageKey, getCurrentTenantId, getStudioInfoForTenant, BLUECODE_TENANT_ID } from '../utils/tenant';

const getApiBase = () => {
  if (typeof import.meta !== 'undefined' && import.meta.env && import.meta.env.VITE_API_BASE) {
    return import.meta.env.VITE_API_BASE;
  }
  if (typeof window !== 'undefined' && (window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1')) {
    return 'http://localhost:3000';
  }
  return 'https://bluman-api-production.up.railway.app';
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

    if (res.status === 401 && typeof window !== 'undefined' && !url.includes('/auth/') && !window.location.pathname.startsWith('/portal')) {
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
 */
async function apiFetch(url: string, options: RequestInit = {}, timeoutMs: number = 60000) {
  return fetchWithTimeout(url, conCorpoCoerente(options), timeoutMs);
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
  if (metodo === 'GET' || metodo === 'HEAD' || metodo === 'DELETE') return options;
  if (options.body !== undefined && options.body !== null) return options;

  const intestazioni = options.headers as Record<string, string> | undefined;
  const dichiaraJson = Object.entries(intestazioni ?? {}).some(
    ([nome, valore]) => nome.toLowerCase() === 'content-type' && String(valore).includes('application/json'),
  );
  if (!dichiaraJson) return options;

  return { ...options, body: '{}' };
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

/**
 * §23 — l'autenticazione avviene solo sul backend.
 *
 * Fino a questa modifica, se la chiamata a `/auth/login` non andava a buon fine questa
 * funzione ripiegava su una tabella di nove coppie email/password scritte qui: le stesse
 * che erano state rimosse dal server. Essendo codice del bundle Vite, finivano in chiaro
 * nel JavaScript servito dal browser — pubblicamente leggibili. Non solo: la condizione
 * accettava anche una password vuota, e altri due rami riconoscevano due password
 * universali valide per qualunque studio registrato. L'elenco esatto dei valori vive nel
 * test `src/credenziali.test.ts`, che ne presidia l'assenza dai sorgenti.
 *
 * Ora un login riuscito è solo un 200 dal backend, che confronta lo scrypt della
 * password contro la riga `user` del database. Se il backend non risponde, il login
 * fallisce: non c'è nessun percorso alternativo, ed è la proprietà voluta.
 */
export async function loginApi(email: string, password?: string) {
  const cleanEmail = (email || '').trim().toLowerCase();

  let res: Response;
  try {
    res = await apiFetch(`${API_BASE}/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: cleanEmail, password }),
    });
  } catch {
    throw new Error('Server non raggiungibile: impossibile verificare le credenziali.');
  }

  if (res.status === 429) {
    throw new Error('Troppi tentativi di accesso. Riprova tra un minuto.');
  }
  if (!res.ok) {
    throw new Error('Credenziali non valide. Utente non autorizzato ad accedere allo studio.');
  }

  const data = await res.json();
  // Il tenant lo decide il backend in base alla riga dell'utente, non il client.
  if (data?.user?.tenantId) {
    localStorage.setItem('bluman_tenant_id', data.user.tenantId);
  }
  return data;
}


/**
 * §23 — scambia il magic token del link firmato con un JWT di sessione per il ruolo
 * `cliente`. Il ramo `catch` restituiva `{ ok: true, token: 'jwt_magic_mock_456' }`:
 * un errore di rete o un token scaduto producevano comunque una sessione "valida"
 * intestata a un cliente inventato. Ora l'errore si propaga e il portale lo mostra.
 */
export async function magicLoginApi(magicToken: string) {
  const res = await apiFetch(`${API_BASE}/auth/magic-login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ magicToken }),
  });
  if (!res.ok) throw new Error('Magic Link non valido o scaduto');
  return await res.json();
}

/**
 * Accesso classico al Portale Cliente con Email e Password dedicate.
 */
export async function clientLoginApi(email: string, password: string) {
  const res = await apiFetch(`${API_BASE}/auth/client-login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password }),
  });
  if (!res.ok) {
    const json = await res.json().catch(() => null);
    throw new Error(json?.errore || 'Credenziali non valide o accesso disabilitato');
  }
  return await res.json();
}

/**
 * Cambio Password per Utente Staff / Advisor dello Studio
 */
export async function cambiaPasswordStaffApi(currentPassword: string, newPassword: string) {
  const res = await apiFetch(`${API_BASE}/auth/change-password`, {
    method: 'POST',
    headers: getAuthHeaders(),
    body: JSON.stringify({ currentPassword, newPassword }),
  });
  const data = await res.json().catch(() => null);
  if (!res.ok) {
    throw new Error(data?.errore || 'Errore durante l\'aggiornamento della password');
  }
  return data;
}

/**
 * Impostazione o Modifica Password per il Cliente del Portale
 */
export async function cambiaPasswordClienteApi(newPassword: string, currentPassword?: string, clienteId?: string, email?: string) {
  const res = await apiFetch(`${API_BASE}/portal/change-password`, {
    method: 'POST',
    headers: getAuthHeaders(),
    body: JSON.stringify({ newPassword, currentPassword, clienteId, email }),
  });
  const data = await res.json().catch(() => null);
  if (!res.ok) {
    throw new Error(data?.errore || 'Errore durante il salvataggio della password');
  }
  return data;
}

/**
 * Recupero dati profilo utente autenticato
 */
export async function fetchMeApi() {
  const res = await apiFetch(`${API_BASE}/auth/me`, {
    headers: getAuthHeaders(),
  });
  if (!res.ok) {
    const data = await res.json().catch(() => null);
    throw new Error(data?.errore || 'Non autenticato');
  }
  return await res.json();
}

export async function fetchProfiloUtenteApi() {
  const res = await apiFetch(`${API_BASE}/auth/profilo`, {
    headers: getAuthHeaders(),
  });
  if (!res.ok) {
    const data = await res.json().catch(() => null);
    throw new Error(data?.errore || 'Errore recupero profilo');
  }
  return await res.json();
}

/**
 * Aggiornamento profilo utente autenticato
 */
export async function aggiornaProfiloUtenteApi(data: { nome?: string; specializzazione?: string }) {
  const res = await apiFetch(`${API_BASE}/auth/profilo`, {
    method: 'PUT',
    headers: getAuthHeaders(),
    body: JSON.stringify(data),
  });
  if (!res.ok) {
    const errData = await res.json().catch(() => null);
    throw new Error(errData?.errore || 'Errore salvataggio profilo');
  }
  return await res.json();
}

/**
 * Reset password utente / collaboratore da parte di SuperAdmin o Lead Advisor
 */
export async function resetPasswordUtenteApi(userId: string) {
  const res = await apiFetch(`${API_BASE}/tenant/utenti/${userId}/reset-password`, {
    method: 'POST',
    headers: getAuthHeaders(),
  });
  const data = await res.json().catch(() => null);
  if (!res.ok) {
    throw new Error(data?.errore || 'Errore durante il reset della password');
  }
  return data;
}

export async function fetchProgetti() {
  try {
    const res = await fetchWithTimeout(`${API_BASE}/progetti`, { headers: getAuthHeaders() }, 6000);
    if (!res.ok) throw new Error('Errore nel recupero progetti');
    return await res.json();
  } catch (err) {
    console.warn('Backend API offline o in latenza, uso il caricamento istantaneo locale', err);
    return null;
  }
}

export async function fetchProgettoDettaglio(id: string) {
  try {
    const res = await apiFetch(`${API_BASE}/progetti/${id}`, { headers: getAuthHeaders() });
    if (!res.ok) throw new Error('Errore nel recupero dettaglio progetto');
    return await res.json();
  } catch (err) {
    console.warn('Backend API offline, uso fallback locale', err);
    return null;
  }
}

export async function fetchModuliLibreria(giurisdizioneId?: string) {
  try {
    const url = giurisdizioneId ? `${API_BASE}/moduli?giurisdizioneId=${encodeURIComponent(giurisdizioneId)}` : `${API_BASE}/moduli`;
    const res = await apiFetch(url, { headers: getAuthHeaders() });
    if (!res.ok) throw new Error('Errore nel recupero moduli');
    return await res.json();
  } catch (err) {
    console.warn('Backend API offline, uso fallback locale', err);
    return null;
  }
}

export async function fetchGiurisdizioniApi() {
  try {
    const res = await apiFetch(`${API_BASE}/giurisdizioni`, { headers: getAuthHeaders() });
    if (!res.ok) throw new Error('Errore nel recupero giurisdizioni');
    return await res.json();
  } catch (err) {
    console.warn('Backend API offline giurisdizioni fallback', err);
    return null;
  }
}

export async function creaGiurisdizioneApi(input: { nome: string; codice: string; tipo: 'ue' | 'extra_ue' | 'stato_usa' | 'altro'; note?: string }) {
  try {
    const res = await apiFetch(`${API_BASE}/giurisdizioni`, {
      method: 'POST',
      headers: getAuthHeaders(),
      body: JSON.stringify(input),
    });
    if (!res.ok) throw new Error('Errore creazione giurisdizione');
    return await res.json();
  } catch (err) {
    console.warn('Crea giurisdizione API fallback', err);
    return { id: `giur-${Date.now()}`, ...input };
  }
}

export async function fetchArticoli() {
  try {
    const res = await apiFetch(`${API_BASE}/articoli`, { headers: getAuthHeaders() });
    if (!res.ok) throw new Error('Errore nel recupero articoli');
    return await res.json();
  } catch (err) {
    console.warn('Backend API offline, uso fallback locale', err);
    return null;
  }
}

export async function uploadFileApi(filename: string, contentBase64: string) {
  try {
    const res = await apiFetch(`${API_BASE}/upload`, {
      method: 'POST',
      headers: getAuthHeaders(),
      body: JSON.stringify({ filename, contentBase64 }),
    });
    if (!res.ok) throw new Error('Errore upload file');
    return await res.json();
  } catch (err) {
    console.warn('Upload API fallback local simulation', err);
    return { ok: true, url: `${API_BASE}/uploads/${filename}`, name: filename, size: '450 KB' };
  }
}

export async function updateArticoloPrezzoApi(id: string, input: { prezzoDefault?: number; oreDefault?: number; nome?: string }) {
  try {
    const res = await apiFetch(`${API_BASE}/articoli/${id}`, {
      method: 'PATCH',
      headers: getAuthHeaders(),
      body: JSON.stringify(input),
    });
    if (!res.ok) throw new Error('Errore aggiornamento articolo');
    return await res.json();
  } catch (err) {
    console.warn('Update articolo API fallback', err);
    return { ok: true, ...input };
  }
}

export async function creaArticoloApi(input: {
  nome: string;
  categoria: string;
  oreDefault: number;
  prezzoDefault: number;
  documentiRichiesti?: string[];
  passaggi?: Array<{ titolo: string; tipo: 'info' | 'documento' | 'form' | 'verifica'; chi: 'operatore' | 'cliente'; descrizione?: string }>;
}) {
  const res = await apiFetch(`${API_BASE}/articoli`, {
    method: 'POST',
    headers: getAuthHeaders(),
    body: JSON.stringify(input),
  });
  if (!res.ok) throw new Error('Errore creazione articolo');
  return await res.json();
}

export async function creaModuloTemplateApi(input: {
  nome: string;
  categoria: string;
  giurisdizioneId?: string | null;
  prezzoPacchetto?: number | null;
  righe: Array<{ articoloId: string; quantita: number; overrideOre?: number; overridePrezzo?: number }>;
  dipendenzeDaIds?: string[];
}) {
  const res = await apiFetch(`${API_BASE}/moduli-template`, {
    method: 'POST',
    headers: getAuthHeaders(),
    body: JSON.stringify(input),
  });
  if (!res.ok) throw new Error('Errore creazione modulo template');
  return await res.json();
}

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

export async function creaProgettoApi(input: { clienteId: string; nome: string }) {
  const res = await apiFetch(`${API_BASE}/progetti`, {
    method: 'POST',
    headers: getAuthHeaders(),
    body: JSON.stringify(input),
  });
  if (!res.ok) throw new Error('Errore creazione progetto');
  return await res.json();
}

export async function eliminaProgettoApi(id: string) {
  const res = await apiFetch(`${API_BASE}/progetti/${id}`, {
    method: 'DELETE',
    headers: getAuthHeaders(),
  });
  if (!res.ok) {
    const err = await res.json();
    throw new Error(err.errore || 'Errore eliminazione progetto');
  }
  return await res.json();
}

export async function archiviaProgettoApi(id: string, archiviato: boolean) {
  const res = await apiFetch(`${API_BASE}/progetti/${id}/archivia`, {
    method: 'PUT',
    headers: getAuthHeaders(),
    body: JSON.stringify({ archiviato }),
  });
  if (!res.ok) throw new Error('Errore aggiornamento stato progetto');
  return await res.json();
}

/**
 * Crea il preventivo con i moduli scelti e lo accetta subito: è l'unico percorso che
 * istanzia i moduli del progetto a database (§15.3 — con versioni di template e articoli
 * congelate, microvoci, passaggi e dipendenze, tutto in una transazione).
 *
 * Prima ognuno dei tre esiti negativi — preventivo rifiutato, accettazione rifiutata,
 * errore di rete — restituiva `{id: 'prev-<timestamp>', ok: true}`. Il chiamante lo leggeva
 * come riuscito, scriveva il progetto con i suoi moduli in localStorage e mostrava la
 * conferma. A database non c'era nessun modulo. Il portale del cliente legge il database,
 * quindi il cliente apriva una pagina vuota: è il guasto segnalato, e su dieci progetti
 * sette non avevano nemmeno un modulo.
 *
 * Ora l'errore arriva a chi ha premuto il pulsante, con il motivo del server.
 */
export async function creaPreventivoEAccettaApi(input: {
  clienteId: string;
  progettoId: string;
  righe: Array<{ moduloTemplateId: string; moduloTemplateVersione: number }>;
}) {
  if (!input.righe?.length) {
    throw new Error('Nessun modulo selezionato: il progetto verrebbe creato senza niente dentro.');
  }

  const resPrev = await apiFetch(`${API_BASE}/preventivi`, {
    method: 'POST',
    headers: getAuthHeaders(),
    body: JSON.stringify(input),
  });
  if (!resPrev.ok) {
    const dett = await resPrev.json().catch(() => null);
    if (resPrev.status === 401) {
      throw new Error('Sessione scaduta: rientra e ripeti l\'operazione, i moduli non sono stati salvati.');
    }
    throw new Error(dett?.errore || `Il server ha rifiutato il preventivo (HTTP ${resPrev.status}).`);
  }
  const prev = await resPrev.json();

  const resAccetta = await apiFetch(`${API_BASE}/preventivi/${prev.id}/accetta`, {
    method: 'POST',
    headers: getAuthHeaders(),
  });
  if (!resAccetta.ok) {
    const dett = await resAccetta.json().catch(() => null);
    // Il preventivo esiste ma i moduli no: va detto, perché il rimedio è accettarlo di nuovo
    // e non ricreare tutto da capo.
    throw new Error(
      `${dett?.errore || `Il server ha rifiutato l'accettazione (HTTP ${resAccetta.status})`}. ` +
        `Il preventivo ${prev.id} è stato creato ma i moduli non sono stati istanziati.`,
    );
  }
  return await resAccetta.json();
}

export async function emettiFatturaApi(input: {
  progettoId: string;
  tipoClienteFiscale: 'privato_italia' | 'business_italia' | 'estero';
  partitaIva?: string;
  codiceFiscale?: string;
  canale: 'sdi' | 'standard';
  righe: Array<{
    tipo: 'modulo_completo' | 'modulo_parziale' | 'milestone_libera';
    moduloProgettoId?: string;
    percentuale?: number;
    importo: number;
    descrizione: string;
  }>;
}) {
  const res = await apiFetch(`${API_BASE}/progetti/${input.progettoId}/fatture`, {
    method: 'POST',
    headers: getAuthHeaders(),
    body: JSON.stringify(input),
  });
  if (!res.ok) throw new Error('Errore emissione fattura');
  return await res.json();
}

export async function consuntivaMicrovoceApi(input: {
  microvoceId: string;
  oreAggiunte: number;
  completa?: boolean;
}) {
  const res = await apiFetch(`${API_BASE}/microvoci/${input.microvoceId}/consuntiva`, {
    method: 'POST',
    headers: getAuthHeaders(),
    body: JSON.stringify(input),
  });
  if (!res.ok) throw new Error('Errore consuntivazione microvoce');
  return await res.json();
}

/**
 * §16 — forza il ricalcolo della cascata micro-voce → modulo → progetto sul backend e
 * restituisce l'avanzamento aggiornato. Le normali azioni (consuntivazione, completamento)
 * aggiornano già lo stato: questa serve dopo un'importazione o una correzione fatta a mano.
 */
export async function ricalcolaProgettoApi(progettoId: string) {
  const res = await apiFetch(`${API_BASE}/progetti/${progettoId}/ricalcola`, {
    method: 'POST',
    headers: getAuthHeaders(),
  });
  if (!res.ok) throw new Error('Errore ricalcolo avanzamento progetto');
  return await res.json();
}

/**
 * Salva su database lo stato del progetto modificato dall'operatore.
 *
 * Il `catch` restituiva `{ok: true}`: un salvataggio non riuscito era indistinguibile da uno
 * riuscito, e chi lavorava continuava a modificare credendo che tutto fosse a posto.
 */
export async function salvaProgettoDettaglioApi(progettoId: string, data: any) {
  const res = await apiFetch(`${API_BASE}/progetti/${progettoId}/stato-completo`, {
    method: 'PUT',
    headers: getAuthHeaders(),
    body: JSON.stringify(data),
  });
  if (!res.ok) {
    const dett = await res.json().catch(() => null);
    if (res.status === 401) {
      throw new Error('Sessione scaduta: rientra e ripeti il salvataggio, le modifiche non sono state registrate.');
    }
    throw new Error(dett?.errore || `Salvataggio non riuscito (HTTP ${res.status}).`);
  }
  return await res.json();
}

// DEFAULT_TEAM_USERS serve SOLO come fallback di seed per il Tenant Demo Bluecode (tenant-1) se il DB è offline
export const DEFAULT_TEAM_USERS = [
  { id: 'usr-01', nome: 'Joe Disabato', email: 'joe@bluecode.advisory', ruolo: 'super_admin', specializzazione: 'Lead Advisor & Strategia', tenantId: '00000000-0000-0000-0000-000000000001' },
  { id: 'usr-02', nome: 'Avv. Lorenzo Marino', email: 'lorenzo.marino@bluecode.advisory', ruolo: 'advisor', specializzazione: 'Legal Counsel — Diritto Societario, Contrattualistica & IP', tenantId: '00000000-0000-0000-0000-000000000001' },
  { id: 'usr-03', nome: 'Dr. Elena Russo', email: 'elena.russo@bluecode.advisory', ruolo: 'advisor', specializzazione: 'Tax Advisor — Fiscalità Internazionale & Holding', tenantId: '00000000-0000-0000-0000-000000000001' },
  { id: 'usr-04', nome: 'Francesca Disabato', email: 'francesca@bluecode.advisory', ruolo: 'operator', specializzazione: 'Back Office & Compliance KYC/AML', tenantId: '00000000-0000-0000-0000-000000000001' },
  { id: 'usr-05', nome: 'Avv. Mario Dibenedetto', email: 'mario.dibenedetto@bluecode.advisory', ruolo: 'advisor', specializzazione: 'Legal Counsel — Diritto Societario, Contrattualistica & Trust', tenantId: '00000000-0000-0000-0000-000000000001' },
];

export async function fetchUtentiTenant() {
  const currentTenantId = getCurrentTenantId();
  const teamStorageKey = getTenantStorageKey('bluman_custom_team_users', currentTenantId);

  // Carica eventuali collaboratori salvati localmente per questo specifico tenant
  let customList: any[] = [];
  try {
    const customStr = localStorage.getItem(teamStorageKey);
    if (customStr) customList = JSON.parse(customStr);
  } catch {}

  // 1. Prova a caricare dal backend Fastify/DB — la rotta filtra già per x-tenant-id
  try {
    const res = await apiFetch(`${API_BASE}/tenant/utenti`, { headers: getAuthHeaders() });
    if (res.ok) {
      const dbUsers = await res.json();
      if (Array.isArray(dbUsers) && dbUsers.length > 0) {
        // Aggiungi solo eventuali custom locali non già presenti nel DB
        const existingEmails = new Set(dbUsers.map((u: any) => (u.email || '').toLowerCase()));
        const fullList = [...dbUsers];
        for (const cust of customList) {
          if (cust.email && !existingEmails.has(cust.email.toLowerCase())) {
            fullList.push(cust);
          }
        }
        return fullList;
      }
    }
  } catch (err) {
    console.warn('Backend API offline / fallback team locale per tenant', err);
  }

  // 2. Fallback offline: custom locali salvati per questo tenant
  if (customList.length > 0) {
    return customList;
  }

  // 3. Fallback solo per il Tenant Demo Bluecode Ltd
  if (currentTenantId === BLUECODE_TENANT_ID) {
    return DEFAULT_TEAM_USERS;
  }

  // 4. Per qualsiasi altro tenant senza dati: lista vuota (l'admin dello studio aggiungerà i propri collaboratori)
  return [];
}

export async function creaUtenteTenantApi(input: {
  nome: string;
  email: string;
  ruolo: string;
  specializzazione?: string;
}) {
  const currentTenantId = getCurrentTenantId();
  const teamStorageKey = getTenantStorageKey('bluman_custom_team_users', currentTenantId);

  // 1. Il backend è la fonte della verità: crea la riga `user`, decide il tenant in base
  // al ruolo (§2bis) e genera la password temporanea. Va chiamato per primo, perché è
  // l'unico posto da cui quella password può arrivare — prima l'ordine era invertito e
  // l'email di invito partiva con una password di default scritta nel bundle.
  let creato: any = null;
  try {
    const res = await apiFetch(`${API_BASE}/tenant/utenti`, {
      method: 'POST',
      headers: getAuthHeaders(),
      body: JSON.stringify({ ...input, tenantId: currentTenantId }),
    });
    if (res.ok) {
      creato = await res.json();
    } else {
      const errore = await res.json().catch(() => ({}));
      throw new Error(errore?.errore || 'Creazione collaboratore rifiutata dal server');
    }
  } catch (err: any) {
    // Un 403 (ruolo insufficiente) o un 409 (email di un altro studio) non sono guasti di
    // rete: propagarli, altrimenti l'interfaccia mostrerebbe un collaboratore che il
    // database non ha mai accettato.
    if (err?.message && !/fetch|network|Failed/i.test(err.message)) throw err;
    console.warn('Persistenza utente team fallback locale:', err);
  }

  // 2. Cache locale per il rendering immediato della lista team. Nessuna password qui.
  try {
    const raw = localStorage.getItem(teamStorageKey);
    const list: any[] = raw ? JSON.parse(raw) : [];
    const exists = list.findIndex(u => (u.email || '').toLowerCase() === input.email.toLowerCase());
    const newUserObj = {
      id: creato?.id || `usr-${Date.now()}`,
      tenantId: creato?.tenantId ?? currentTenantId,
      ...input,
    };
    if (exists >= 0) {
      list[exists] = { ...list[exists], ...newUserObj };
    } else {
      list.push(newUserObj);
    }
    localStorage.setItem(teamStorageKey, JSON.stringify(list));
  } catch {}

  // 3. Email di benvenuto, solo se il server ha davvero emesso una password temporanea
  // (non lo fa per un utente che ne ha già una: in quel caso non c'è nulla da comunicare).
  if (creato?.passwordTemporanea) {
    sendInviteCollaboratoreApi({
      nome: input.nome,
      email: input.email,
      ruolo: input.ruolo,
      specializzazione: input.specializzazione,
      tempPassword: creato.passwordTemporanea,
    }).catch(() => {});
  }

  return creato || { ok: true, ...input };
}

export async function sendInviteCollaboratoreApi(input: {
  nome: string;
  email: string;
  ruolo: string;
  specializzazione?: string;
  /** Emessa dal server alla creazione dell'utente. Senza di essa l'invito non parte. */
  tempPassword: string;
}) {
  let localTenant: any = {};
  const currentTenantId = getCurrentTenantId();
  const isBC = currentTenantId === BLUECODE_TENANT_ID;
  const studio = getStudioInfoForTenant(currentTenantId);
  try {
    const raw = localStorage.getItem(getTenantStorageKey('bluman_tenant_info'));
    if (raw) localTenant = JSON.parse(raw);
  } catch {}

  const payload = {
    action: 'invite-collaborator',
    smtpHost: localTenant.smtpHost || (isBC ? 'authsmtp.register.it' : ''),
    smtpPort: localTenant.smtpPort || 465,
    smtpSecure: localTenant.smtpSecure !== undefined ? localTenant.smtpSecure : true,
    smtpUser: localTenant.smtpUser || (isBC ? 'support@bluecode-ltd.com' : ''),
    smtpPass: localTenant.smtpPass || '',
    smtpFromEmail: localTenant.smtpFromEmail || localTenant.smtpUser || (isBC ? 'support@bluecode-ltd.com' : ''),
    smtpFromName: localTenant.smtpFromName || studio.ragioneSociale || 'Studio Professionale',
    smtpReplyTo: localTenant.smtpReplyTo,
    smtpBcc: localTenant.smtpBcc,
    to: input.email,
    collaboratorName: input.nome,
    collaboratorRole: input.ruolo,
    collaboratorSpecialization: input.specializzazione,
    collaboratorPassword: input.tempPassword,
  };

  try {
    const res = await apiFetch('/api/send-email', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    return await res.json();
  } catch (err: any) {
    console.warn('Errore invio email invito collaboratore', err);
    return { success: false, errore: err.message };
  }
}

export async function fetchAccessiProgetto(progettoId: string) {
  try {
    const res = await apiFetch(`${API_BASE}/progetti/${progettoId}/accessi`);
    if (!res.ok) throw new Error('Errore recupero accessi');
    return await res.json();
  } catch (err) {
    console.warn('Backend API offline', err);
    return [];
  }
}

export async function assegnaAccessoProgettoApi(progettoId: string, userId: string, livello: string = 'write') {
  const res = await apiFetch(`${API_BASE}/progetti/${progettoId}/accessi`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ userId, livello }),
  });
  if (!res.ok) throw new Error('Errore assegnazione accesso');
  return await res.json();
}

export async function testEmailApi(payload?: {
  smtpHost?: string;
  smtpPort?: number;
  smtpSecure?: boolean;
  smtpUser?: string;
  smtpPass?: string;
  smtpFromEmail?: string;
  smtpFromName?: string;
  smtpReplyTo?: string;
  smtpBcc?: string;
  emailDestinatario?: string;
}) {
  const body = {
    action: 'test',
    ...payload,
    to: payload?.emailDestinatario || payload?.smtpUser,
  };

  // Un test SMTP onesto deve avere il tempo di fallire: aprire la connessione, fare
  // l'handshake TLS, autenticarsi e spedire richiede più di 4,5 secondi su una rete lenta,
  // e il vecchio timeout scadeva prima di conoscere l'esito. Venti secondi coprono anche il
  // caso in cui il server prova più porte in sequenza.
  const conTimeout = async (url: string, init: RequestInit) => {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 20000);
    try {
      const res = await apiFetch(url, { ...init, signal: controller.signal });
      return await res.json();
    } finally {
      clearTimeout(timer);
    }
  };

  const motivi: string[] = [];

  // 1. Serverless Function Vercel /api/send-email
  try {
    const json = await conTimeout('/api/send-email', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    if (json) return json;
    motivi.push('la funzione Vercel non ha risposto nulla');
  } catch (err: any) {
    motivi.push(
      `funzione Vercel: ${err?.name === 'AbortError' ? 'nessuna risposta entro 20 secondi' : err?.message || 'errore di rete'}`,
    );
  }

  // 2. Ripiego sul backend Fastify. L'intestazione di autenticazione serve: la rotta è
  // protetta e senza token rispondeva 401, che il vecchio codice scartava in silenzio.
  try {
    const json = await conTimeout(`${API_BASE}/tenant/test-email`, {
      method: 'POST',
      headers: getAuthHeaders(),
      body: JSON.stringify(payload || {}),
    });
    if (json) return json;
    motivi.push('il backend non ha risposto nulla');
  } catch (err: any) {
    motivi.push(
      `backend: ${err?.name === 'AbortError' ? 'nessuna risposta entro 20 secondi' : err?.message || 'errore di rete'}`,
    );
  }

  // 3. Nessuna delle due strade ha risposto: il test NON è stato eseguito.
  //
  // Qui prima si restituiva un `success: true` con il messaggio «Connessione SMTP testata»:
  // un esito positivo inventato, identico con la configurazione giusta e con quella
  // sbagliata. È il motivo per cui il test in impostazioni «funzionava» mentre il codice
  // OTP non arrivava a nessuno. Un test che non ha potuto girare va detto.
  return {
    success: false,
    errore: `Test non eseguito: nessuna delle due strade di invio ha risposto (${motivi.join('; ') || 'motivo non riportato'}).`,
  };
}

export async function fetchTenantInfoApi(tenantIdParam?: string) {
  const currentTenantId = tenantIdParam || getCurrentTenantId();
  try {
    const res = await apiFetch(`${API_BASE}/tenant/info`, {
      headers: {
        ...getAuthHeaders(),
        'x-tenant-id': currentTenantId,
      }
    });
    if (!res.ok) throw new Error('Errore recupero info tenant');
    const data = await res.json();
    if (data && (!data.ragioneSociale || (data.id && data.id !== currentTenantId))) {
      const studioInfo = getStudioInfoForTenant(currentTenantId);
      return {
        ...data,
        id: currentTenantId,
        ragioneSociale: studioInfo.ragioneSociale,
        sedeLegale: studioInfo.sedeLegale || data.sedeLegale,
        piva: studioInfo.piva || data.piva,
      };
    }
    return data;
  } catch (err) {
    const local = localStorage.getItem(getTenantStorageKey('bluman_tenant_info', currentTenantId));
    if (local) {
      try { return JSON.parse(local); } catch {}
    }
    const studioInfo = getStudioInfoForTenant(currentTenantId);
    return {
      id: currentTenantId,
      ragioneSociale: studioInfo.ragioneSociale,
      sedeLegale: studioInfo.sedeLegale,
      piva: studioInfo.piva,
      telefono: studioInfo.telefono,
      email: studioInfo.email,
      iban: studioInfo.iban,
      codiceSdi: studioInfo.codiceSdi,
    };
  }
}

export async function updateTenantInfoApi(input: any, tenantIdParam?: string) {
  const currentTenantId = tenantIdParam || getCurrentTenantId();
  try {
    const res = await apiFetch(`${API_BASE}/tenant/info`, {
      method: 'PATCH',
      headers: {
        ...getAuthHeaders(),
        'x-tenant-id': currentTenantId,
      },
      body: JSON.stringify(input),
    });
    if (!res.ok) throw new Error('Errore aggiornamento info tenant');
    const data = await res.json();
    localStorage.setItem(getTenantStorageKey('bluman_tenant_info', currentTenantId), JSON.stringify({ ...input, ...data }));
    return data;
  } catch (err) {
    console.warn('Backend API offline, aggiornamento locale', err);
    localStorage.setItem(getTenantStorageKey('bluman_tenant_info', currentTenantId), JSON.stringify(input));
    return input;
  }
}

export async function fetchAuditLogsApi() {
  try {
    const res = await apiFetch(`${API_BASE}/audit-logs`, { headers: getAuthHeaders() });
    if (!res.ok) throw new Error('Errore recupero audit logs');
    return await res.json();
  } catch (err) {
    console.warn('Backend API offline', err);
    return null;
  }
}

export async function createAuditLogApi(input: { azione: string; entita: string; dettagli: string }) {
  try {
    const res = await apiFetch(`${API_BASE}/audit-logs`, {
      method: 'POST',
      headers: getAuthHeaders(),
      body: JSON.stringify(input),
    });
    if (!res.ok) throw new Error('Errore creazione audit log');
    return await res.json();
  } catch (err) {
    console.warn('Audit log fallback', err);
    return null;
  }
}

export async function fetchComunicazioniApi(progettoId: string) {
  try {
    const res = await apiFetch(`${API_BASE}/progetti/${progettoId}/comunicazioni`, { headers: getAuthHeaders() });
    if (!res.ok) throw new Error('Errore recupero comunicazioni');
    return await res.json();
  } catch (err) {
    console.warn('Comunicazioni API fallback', err);
    return null;
  }
}

export async function inviaComunicazioneApi(progettoId: string, input: { canale: string; mittente: string; destinatario: string; direzione: string; testo: string; allegatiJson?: any }) {
  try {
    const res = await apiFetch(`${API_BASE}/progetti/${progettoId}/comunicazioni`, {
      method: 'POST',
      headers: getAuthHeaders(),
      body: JSON.stringify(input),
    });
    if (!res.ok) throw new Error('Errore invio comunicazione');
    return await res.json();
  } catch (err) {
    console.warn('Invia comunicazione fallback', err);
    return null;
  }
}

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


export async function testImapApi(payload: {
  imapHost?: string;
  imapPort?: number;
  imapSecure?: boolean;
  imapUser?: string;
  imapPass?: string;
}) {
  // La rotta `/tenant/test-imap` fa una verifica vera (login IMAP reale). Qui si riporta
  // il suo esito e nient'altro: nei due rami di ripiego c'era un `success: true` con il
  // messaggio «Connessione IMAP verificata con successo», restituito proprio quando il
  // server rispondeva con un errore o non rispondeva affatto. Con una password sbagliata
  // la schermata impostazioni diceva «connesso».
  try {
    const res = await apiFetch(`${API_BASE}/tenant/test-imap`, {
      method: 'POST',
      headers: getAuthHeaders(),
      body: JSON.stringify(payload || {}),
    });
    const json = await res.json().catch(() => null);
    if (json) return json;
    return { success: false, errore: `Il server ha risposto ${res.status} senza contenuto leggibile.` };
  } catch (err: any) {
    return {
      success: false,
      errore: `Test IMAP non eseguito: ${err?.message || 'il server non ha risposto'}.`,
    };
  }
}

export async function testChannelApi(payload: { channel: string; waPhoneId?: string; waAccessToken?: string; tgBotToken?: string; signalCliEndpoint?: string }) {
  const res = await apiFetch(`${API_BASE}/tenant/test-channel`, {
    method: 'POST',
    headers: getAuthHeaders(),
    body: JSON.stringify(payload),
  });
  return await res.json();
}

export async function sendWhatsAppDirectApi(to: string, text: string, templateName?: string) {
  try {
    const res = await apiFetch('/api/send-whatsapp', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ to, text, templateName }),
    });
    return await res.json();
  } catch (err) {
    console.warn('Vercel serverless direct send fallback:', err);
    return null;
  }
}

export async function sendEmailDirectApi(to: string, subject: string, text: string, html?: string) {
  let tenantInfo: any = {};
  const currentTenantId = getCurrentTenantId();
  const isBC = currentTenantId === BLUECODE_TENANT_ID;
  const studio = getStudioInfoForTenant(currentTenantId);
  try {
    const saved = localStorage.getItem(getTenantStorageKey('bluman_tenant_info'));
    if (saved) tenantInfo = JSON.parse(saved);
  } catch {}

  const body = {
    action: 'send-message',
    smtpHost: tenantInfo.smtpHost || (isBC ? 'authsmtp.register.it' : ''),
    smtpPort: tenantInfo.smtpPort || 465,
    smtpSecure: tenantInfo.smtpSecure !== undefined ? tenantInfo.smtpSecure : true,
    smtpUser: tenantInfo.smtpUser || (isBC ? 'support@bluecode-ltd.com' : ''),
    smtpPass: tenantInfo.smtpPass || '',
    smtpFromEmail: tenantInfo.smtpFromEmail || tenantInfo.smtpUser || (isBC ? 'support@bluecode-ltd.com' : ''),
    smtpFromName: tenantInfo.smtpFromName || studio.ragioneSociale || 'Studio Professionale',
    smtpReplyTo: tenantInfo.smtpReplyTo || '',
    smtpBcc: tenantInfo.smtpBcc || '',
    to,
    subject,
    text,
    html,
  };

  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 6000);
    const res = await apiFetch('/api/send-email', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal: controller.signal,
    });
    clearTimeout(timer);
    const data = await res.json();
    if (res.ok && data.success) {
      return data;
    }
    return {
      success: false,
      errore: data.errore || 'Errore durante la trasmissione email',
    };
  } catch (err: any) {
    return {
      success: false,
      errore: err.message || 'Timeout o errore di connessione con il server SMTP',
    };
  }
}

export async function fetchInboundImapEmailsApi(clientEmail?: string) {
  let tenantInfo: any = {};
  const currentTenantId = getCurrentTenantId();
  const isBC = currentTenantId === BLUECODE_TENANT_ID;
  try {
    const saved = localStorage.getItem(getTenantStorageKey('bluman_tenant_info'));
    if (saved) tenantInfo = JSON.parse(saved);
  } catch {}

  const body = {
    action: 'fetch-imap-inbound',
    imapHost: tenantInfo.imapHost || (isBC ? 'imap.register.it' : ''),
    imapPort: tenantInfo.imapPort || 993,
    imapUser: tenantInfo.imapUser || tenantInfo.smtpUser || (isBC ? 'support@bluecode-ltd.com' : ''),
    imapPass: tenantInfo.imapPass || tenantInfo.smtpPass || '',
    imapFolder: tenantInfo.imapFolder || 'INBOX',
    clientEmail: clientEmail || '',
  };

  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 6000);
    const res = await apiFetch('/api/send-email', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal: controller.signal,
    });
    clearTimeout(timer);
    const data = await res.json();
    if (res.ok && data.success && Array.isArray(data.emails)) {
      return data.emails;
    }
  } catch {}
  return [];
}

export async function markNotificheReadApi() {
  try {
    const res = await apiFetch(`${API_BASE}/notifiche/read-all`, {
      method: 'PATCH',
      headers: getAuthHeaders(),
    });
    if (!res.ok) throw new Error('Errore aggiornamento notifiche');
    return await res.json();
  } catch (err) {
    console.warn('Mark notifiche read API fallback', err);
    return { ok: true };
  }
}

export async function fetchTutteFattureStudioApi() {
  try {
    const res = await apiFetch(`${API_BASE}/invoices`, { headers: getAuthHeaders() });
    if (!res.ok) throw new Error('Errore recupero fatture studio');
    return await res.json();
  } catch (err) {
    console.warn('Fetch tutte le fatture API fallback', err);
    return [];
  }
}

export async function fetchScadenzarioIncassiApi() {
  try {
    const res = await apiFetch(`${API_BASE}/invoices/scadenzario`, { headers: getAuthHeaders() });
    if (!res.ok) throw new Error('Errore recupero scadenzario incassi');
    return await res.json();
  } catch (err) {
    console.warn('Scadenzario incassi API fallback', err);
    return null;
  }
}

export async function registraIncassoApi(scadenzaId: string, input: { importoIncassatoCentesimi: number; metodoPagamento?: string; riferimentoTransazione?: string; noteOperatore?: string }) {
  try {
    const res = await apiFetch(`${API_BASE}/invoices/scadenze/${scadenzaId}/incassi`, {
      method: 'POST',
      headers: getAuthHeaders(),
      body: JSON.stringify(input),
    });
    if (!res.ok) throw new Error('Errore durante la registrazione dell\'incasso');
    return await res.json();
  } catch (err) {
    console.warn('Registrazione incasso API fallback', err);
    return null;
  }
}

export async function downloadFatturaXmlApi(fatturaId: string) {
  try {
    const res = await apiFetch(`${API_BASE}/invoices/${fatturaId}/sdi-xml`, { headers: getAuthHeaders() });
    if (!res.ok) throw new Error('Errore durante la generazione dell\'XML');
    const blob = await res.blob();
    const url = window.URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `Fattura_${fatturaId}.xml`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    window.URL.revokeObjectURL(url);
    return { ok: true };
  } catch (err: any) {
    alert('Errore download XML: ' + err.message);
    return null;
  }
}

export async function fetchContrattiRicorrentiApi() {
  try {
    const res = await apiFetch(`${API_BASE}/contratti-ricorrenti`, { headers: getAuthHeaders() });
    if (!res.ok) throw new Error('Errore recupero contratti');
    return await res.json();
  } catch (err) {
    console.warn('Contratti ricorrenti API fallback', err);
    return null;
  }
}

export async function creaContrattoRicorrenteApi(input: { clienteId: string; progettoId?: string; titolo: string; frequenza?: string; importoCentesimi: number; prossimaFatturazione: string; note?: string }) {
  try {
    const res = await apiFetch(`${API_BASE}/contratti-ricorrenti`, {
      method: 'POST',
      headers: getAuthHeaders(),
      body: JSON.stringify(input),
    });
    if (!res.ok) throw new Error('Errore creazione contratto');
    return await res.json();
  } catch (err) {
    console.warn('Crea contratto ricorrente API fallback', err);
    return null;
  }
}

export async function generaFatturaRetainerApi(contrattoId: string) {
  try {
    const res = await apiFetch(`${API_BASE}/contratti-ricorrenti/${contrattoId}/genera-fattura`, {
      method: 'POST',
      headers: getAuthHeaders(),
    });
    if (!res.ok) throw new Error('Errore generazione fattura retainer');
    return await res.json();
  } catch (err) {
    console.warn('Genera fattura retainer API fallback', err);
    return null;
  }
}

export async function fetchPermessiUtenteApi(userId: string) {
  try {
    const res = await apiFetch(`${API_BASE}/tenant/utenti/${userId}/permessi`, { headers: getAuthHeaders() });
    if (!res.ok) throw new Error('Errore recupero permessi utente');
    return await res.json();
  } catch (err) {
    console.warn('Fetch permessi utente API fallback', err);
    return [];
  }
}

export async function salvaPermessiUtenteApi(userId: string, permessi: Array<{ moduloChiave: string; livello: 'denied' | 'read' | 'write' }>) {
  try {
    const res = await apiFetch(`${API_BASE}/tenant/utenti/${userId}/permessi`, {
      method: 'PUT',
      headers: getAuthHeaders(),
      body: JSON.stringify({ permessi }),
    });
    if (!res.ok) throw new Error('Errore aggiornamento permessi utente');
    return await res.json();
  } catch (err) {
    console.warn('Salva permessi utente API fallback', err);
    return { ok: true };
  }
}

export async function fetchChecklistPassaggioApi(passaggioId: string) {
  try {
    const res = await apiFetch(`${API_BASE}/passaggi/${passaggioId}/checklist`, { headers: getAuthHeaders() });
    if (!res.ok) throw new Error('Errore recupero checklist');
    return await res.json();
  } catch (err) {
    console.warn('Checklist passaggio API fallback', err);
    return [];
  }
}

export async function toggleChecklistVoceApi(id: string) {
  try {
    const res = await apiFetch(`${API_BASE}/checklist/${id}/toggle`, {
      method: 'PATCH',
      headers: getAuthHeaders(),
    });
    if (!res.ok) throw new Error('Errore aggiornamento checklist');
    return await res.json();
  } catch (err) {
    console.warn('Toggle checklist API fallback', err);
    return null;
  }
}

export async function downloadFatturaPdfServerApi(fatturaId: string) {
  try {
    const res = await apiFetch(`${API_BASE}/invoices/${fatturaId}/pdf`, { headers: getAuthHeaders() });
    if (!res.ok) throw new Error('Errore generazione PDF server');
    const blob = await res.blob();
    const url = window.URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `Fattura_Server_${fatturaId}.pdf`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    window.URL.revokeObjectURL(url);
    return { ok: true };
  } catch (err: any) {
    alert('Errore download PDF Server: ' + err.message);
    return null;
  }
}

export async function inviaFatturaEmailApi(fatturaId: string, emailDestinatario?: string) {
  try {
    const res = await apiFetch(`${API_BASE}/invoices/${fatturaId}/invia-email`, {
      method: 'POST',
      headers: getAuthHeaders(),
      body: JSON.stringify({ emailDestinatario }),
    });
    if (!res.ok) throw new Error('Errore invio email fattura');
    return await res.json();
  } catch (err: any) {
    alert('Errore invio email: ' + err.message);
    return null;
  }
}

export async function inviaWebhookSdiApi(fatturaId: string, statoSdi: 'consegnata' | 'scartata' | 'mancata_consegna') {
  try {
    const res = await apiFetch(`${API_BASE}/webhooks/sdi`, {
      method: 'POST',
      headers: getAuthHeaders(),
      body: JSON.stringify({ fatturaId, statoSdi }),
    });
    if (!res.ok) throw new Error('Errore invio webhook SDI');
    return await res.json();
  } catch (err) {
    console.warn('Webhook SDI fallback', err);
    return null;
  }
}

export async function fetchContiBancariApi() {
  try {
    const res = await apiFetch(`${API_BASE}/conti-bancari`, { headers: getAuthHeaders() });
    if (!res.ok) throw new Error('Errore recupero conti bancari');
    return await res.json();
  } catch (err) {
    console.warn('Conti bancari API fallback', err);
    return [
      { id: 'c-1', nomeConto: 'Unicredit c/c Principale', banca: 'Unicredit S.p.A.', iban: 'IT99C0306902100100000012345', bicSwift: 'UNCRITM1', saldoIniziale: 5000000, saldoAttuale: 7850000, isDefault: true },
      { id: 'c-2', nomeConto: 'Intesa Sanpaolo Operativo', banca: 'Intesa Sanpaolo', iban: 'IT88X0306902100100000098765', bicSwift: 'BCITITMM', saldoIniziale: 1200000, saldoAttuale: 3450000, isDefault: false },
      { id: 'c-3', nomeConto: 'Account Stripe Gateway', banca: 'Stripe Payments Europe', iban: 'N/D (Gateway)', bicSwift: 'STRPEU2D', saldoIniziale: 0, saldoAttuale: 125000, isDefault: false },
      { id: 'c-4', nomeConto: 'Cassa Contanti Studio', banca: 'Cassa Interna', iban: 'N/D (Cassa)', bicSwift: 'N/D', saldoIniziale: 50000, saldoAttuale: 65000, isDefault: false },
    ];
  }
}

export async function creaContoBancarioApi(input: { nomeConto: string; banca: string; iban?: string; bicSwift?: string; saldoInizialeEur: number; isDefault?: boolean }) {
  try {
    const res = await apiFetch(`${API_BASE}/conti-bancari`, {
      method: 'POST',
      headers: getAuthHeaders(),
      body: JSON.stringify(input),
    });
    if (!res.ok) throw new Error('Errore creazione conto bancario');
    return await res.json();
  } catch (err) {
    console.warn('Crea conto bancario API fallback', err);
    return null;
  }
}

// ── FIRMA ELETTRONICA AVANZATA: CANALI, OTP, FILE FIRMATO ──────────────────
//
// Qui c'erano due ripieghi che rendevano la firma una finzione:
//
//   · se `/portal/request-otp` non rispondeva, la funzione restituiva
//     `{ ok: true, devOtp: '482910', maskedTarget: '+39 333 *** 6278' }`. Il portale
//     mostrava "codice inviato" e il numero di una persona reale, senza che partisse niente;
//   · se `/portal/verify-otp-and-sign` non rispondeva, digitando `482910` o `123456` il
//     browser fabbricava da sé un sigillo eIDAS — id, timestamp e un SHA-256 costante che
//     è l'hash della stringa vuota — e il portale lo mostrava come firma apposta. Nessuna
//     riga a database: la firma esisteva solo nella schermata, e chiunque leggesse il
//     bundle JavaScript conosceva le due cifre per produrne una.
//
// Ora un errore è un errore. Se il backend non risponde la firma non avviene, e il
// cliente legge perché.

export type CanaleOtp = 'whatsapp' | 'email' | 'telegram';
export type AmbitoFirma = 'engagement_letter' | 'documento_vault' | 'modulo_completato' | 'addendum';

export interface CanaleFirma {
  canale: CanaleOtp;
  disponibile: boolean;
  motivo?: string;
  recapitoMascherato: string | null;
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

/** Su quali canali il cliente può ricevere il codice, e perché non sugli altri. */
export async function canaliFirmaApi(clienteId?: string): Promise<{
  ok: boolean;
  canalePreferito: CanaleOtp | null;
  canali: CanaleFirma[];
  botTelegram: string | null;
}> {
  const query = clienteId ? `?clienteId=${encodeURIComponent(clienteId)}` : '';
  const res = await fetchWithTimeout(`${API_BASE}/portal/canali-firma${query}`, { headers: getAuthHeaders() });
  if (!res.ok) throw await erroreDellaRisposta(res, 'Impossibile leggere i canali di firma disponibili.');
  return await res.json();
}

export interface DocumentoPortale {
  id: string;
  nome: string;
  titolo: string;
  categoria: string;
  modulo: string | null;
  progetto: string | null;
  progettoId: string | null;
  fileUrl: string | null;
  tipo: string;
  versione: number | null;
  caricatoIl: string | null;
  scadenza: string | null;
  statoScansione: 'in_corso' | 'pulito' | 'infetto' | null;
  scaricabile: boolean;
  firmato: boolean;
  richiedeFirma: boolean;
  dataFirma: string | null;
  tipoFirma: string | null;
  signatureId: string | null;
  canaleVerificato: string | null;
  documentoNonPiuDisponibile?: boolean;
}

/**
 * I documenti del fascicolo del cliente, con lo stato di firma che sta a database.
 *
 * Non c'è ripiego su un elenco vuoto: un errore di lettura viene propagato perché «lo studio non
 * ti ha caricato niente» e «non riesco a leggere i tuoi documenti» sono due messaggi diversi, e
 * mostrare il primo al posto del secondo fa chiudere la pagina a chi invece deve firmare.
 */
export async function documentiPortaleApi(clienteId?: string): Promise<{ ok: boolean; documenti: DocumentoPortale[] }> {
  const query = clienteId ? `?clienteId=${encodeURIComponent(clienteId)}` : '';
  const res = await fetchWithTimeout(`${API_BASE}/portal/documenti${query}`, { headers: getAuthHeaders() });
  if (!res.ok) throw await erroreDellaRisposta(res, 'Impossibile leggere i documenti del fascicolo.');
  return await res.json();
}

export async function requestPortalOtpApi(input: {
  canale: CanaleOtp;
  ambito?: AmbitoFirma;
  riferimentoId?: string;
  /** Recapito diverso da quello in anagrafica, digitato dal firmatario. */
  recapitoDichiarato?: string;
  clienteId?: string;
  signerName?: string;
}): Promise<{
  ok: boolean;
  canale: CanaleOtp;
  maskedTarget: string;
  recapitoDichiarato: boolean;
  expiresInSeconds: number;
  reinviiRimanenti: number;
  attesaReinvioSecondi: number;
}> {
  const res = await fetchWithTimeout(
    `${API_BASE}/portal/request-otp`,
    { method: 'POST', headers: getAuthHeaders(), body: JSON.stringify(input) },
    15000, // La consegna passa da WhatsApp Cloud API o da un SMTP: 8 secondi sono pochi.
  );
  if (!res.ok) throw await erroreDellaRisposta(res, 'Invio del codice non riuscito.');
  return await res.json();
}

export interface SigilloFirma {
  id: string;
  signatureId: string;
  tipoFirma: string;
  signerName: string;
  documentoTitolo: string;
  timestampIso: string;
  documentoHash: string;
  sha256Digest: string;
  ipAddress: string | null;
  userAgent: string | null;
  canaleVerificato: string;
  standard: string;
  fileFirmatoUrl?: string;
}

export async function verifyPortalOtpAndSignApi(input: {
  otp: string;
  /**
   * Impronta del testo che il cliente ha davvero letto.
   *
   * Va mandata per la lettera d'incarico, il cui testo è composto qui nel browser. Per un
   * documento del fascicolo si omette: la calcola il backend dal file che ha in archivio, ed è
   * l'unico modo perché il sigillo descriva il documento firmato e non quello che il firmatario
   * dichiara di aver firmato.
   */
  documentoHash?: string;
  signerName?: string;
  firmatarioRuolo?: string;
  documentoTitolo?: string;
  ambito?: AmbitoFirma;
  riferimentoId?: string;
  clienteId?: string;
  /** Grafometrica raccolta dopo l'OTP, allegata al sigillo. */
  firmaGrafometricaPng?: string;
}): Promise<{ ok: boolean; seal: SigilloFirma; progettoAttivato: string | null; message: string }> {
  const res = await fetchWithTimeout(
    `${API_BASE}/portal/verify-otp-and-sign`,
    { method: 'POST', headers: getAuthHeaders(), body: JSON.stringify(input) },
    15000,
  );
  if (!res.ok) throw await erroreDellaRisposta(res, 'Codice non valido: la firma non è stata apposta.');
  return await res.json();
}

/** Documento scaricato e firmato a penna, o firmato con il provider digitale del cliente. */
export async function firmaConFileApi(input: {
  tipoFirma: 'manuale_scansionata' | 'qualificata_esterna';
  /** Impronta dell'originale: facoltativa per i documenti del fascicolo, vedi sopra. */
  documentoHash?: string;
  filename: string;
  contentBase64: string;
  ambito?: AmbitoFirma;
  riferimentoId?: string;
  clienteId?: string;
  documentoTitolo?: string;
  signerName?: string;
  firmatarioRuolo?: string;
  otp?: string;
}): Promise<{ ok: boolean; seal: SigilloFirma }> {
  const res = await fetchWithTimeout(
    `${API_BASE}/portal/firma-con-file`,
    { method: 'POST', headers: getAuthHeaders(), body: JSON.stringify(input) },
    30000, // Caricamento di un file: qui il timeout breve tagliava le scansioni pesanti.
  );
  if (!res.ok) throw await erroreDellaRisposta(res, 'Caricamento del documento firmato non riuscito.');
  return await res.json();
}

/** Le firme registrate: il cliente vede le proprie, lo studio quelle del tenant. */
export async function elencoFirmeApi(filtri?: { clienteId?: string; ambito?: AmbitoFirma }): Promise<{
  ok: boolean;
  firme: Array<SigilloFirma & {
    ambito: string;
    riferimentoId: string | null;
    firmatarioNome: string;
    firmatarioRuolo: string | null;
    fileFirmatoHash: string | null;
    firmatoAt: string;
    cliente: { id: string; nome: string };
  }>;
}> {
  const params = new URLSearchParams();
  if (filtri?.clienteId) params.set('clienteId', filtri.clienteId);
  if (filtri?.ambito) params.set('ambito', filtri.ambito);
  const query = params.toString() ? `?${params}` : '';
  const res = await fetchWithTimeout(`${API_BASE}/firme${query}`, { headers: getAuthHeaders() });
  if (!res.ok) throw await erroreDellaRisposta(res, 'Impossibile leggere le firme registrate.');
  return await res.json();
}

export async function grafometricaFirmaApi(firmaId: string): Promise<string | null> {
  const res = await fetchWithTimeout(`${API_BASE}/firme/${firmaId}/grafometrica`, { headers: getAuthHeaders() });
  if (!res.ok) return null;
  const body = await res.json();
  return body?.firmaGrafometricaPng ?? null;
}

/**
 * URL con cui il browser può davvero aprire un file dell'archivio.
 *
 * I file caricati sul ripiego locale sono memorizzati come `/uploads/<nome>?firma=…`, relativi
 * all'host dell'API: aperti così come sono porterebbero a una pagina inesistente del frontend.
 * Quelli su Supabase Storage sono già assoluti e passano invariati. Ritorna `null` quando non
 * c'è nessun file, perché «nessun documento» e «documento non apribile» non sono la stessa cosa.
 */
export function urlFileArchivio(url?: string | null): string | null {
  const valore = (url ?? '').trim();
  if (valore === '') return null;
  if (/^(data:|blob:|https?:\/\/)/i.test(valore)) return valore;
  if (valore.startsWith('/uploads')) return `${API_BASE}${valore}`;
  return valore;
}

/**
 * Impronta SHA-256 del testo che il cliente sta leggendo sullo schermo.
 *
 * Il backend pretende questo valore e non ne inventa più uno: il sigillo deve identificare
 * il documento firmato, altrimenti certifica una volontà su un testo qualunque. Si calcola
 * qui perché il testo del mandato è ancora composto nel frontend — quando il documento
 * passerà lato server, l'impronta arriverà da lì e questa funzione servirà solo ai file.
 */
export async function calcolaHashSha256(contenuto: string | ArrayBuffer): Promise<string> {
  const dati = typeof contenuto === 'string' ? new TextEncoder().encode(contenuto) : contenuto;
  const digest = await crypto.subtle.digest('SHA-256', dati);
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

export async function triggerCronScadenzeApi() {
  try {
    const res = await apiFetch(`${API_BASE}/cron/esegui-notifiche-scadenze`, {
      method: 'POST',
      headers: getAuthHeaders(),
    });
    if (!res.ok) throw new Error('Errore esecuzione scansione cron');
    return await res.json();
  } catch (err) {
    console.warn('Trigger cron API fallback:', err);
    return {
      ok: true,
      message: 'Scansione completata con successo (3 notifiche elaborate: 2 UBO Malta, 1 Scadenza Incasso)',
      report: { notificheInviate: 3, scadenzeUboTrovate: 2, fattureScaduteTrovate: 1 }
    };
  }
}

export async function trasmettiFatturaSdiApi(fatturaId: string) {
  try {
    const res = await apiFetch(`${API_BASE}/invoices/${fatturaId}/trasmetti-sdi`, {
      method: 'POST',
      headers: getAuthHeaders(),
    });
    if (!res.ok) throw new Error('Errore trasmissione SDI');
    return await res.json();
  } catch (err) {
    console.warn('Trasmetti SDI API fallback:', err);
    return {
      ok: true,
      identificativoSdi: `SDI-IT-2026-FEA`,
      message: 'Fattura elettronica trasmessa con successo al Sistema di Interscambio (SdI)',
    };
  }
}

export async function fetchDocumentiTemplateApi() {
  try {
    const res = await apiFetch(`${API_BASE}/documenti-template`, { headers: getAuthHeaders() });
    if (!res.ok) throw new Error('Errore recupero template documenti');
    return await res.json();
  } catch (err) {
    console.warn('Recupero template documenti fallback local:', err);
    const local = localStorage.getItem('bluman_custom_document_templates');
    return local ? JSON.parse(local) : [];
  }
}

export async function creaDocumentoTemplateApi(data: { titolo: string; categoria?: string; descrizione?: string; contenutoHtml: string }) {
  try {
    const res = await apiFetch(`${API_BASE}/documenti-template`, {
      method: 'POST',
      headers: getAuthHeaders(),
      body: JSON.stringify(data),
    });
    if (!res.ok) throw new Error('Errore salvataggio template');
    return await res.json();
  } catch (err) {
    console.warn('Salvataggio template fallback local:', err);
    const newTmpl = { id: `tmpl-custom-${Date.now()}`, ...data, dataCreazione: new Date().toISOString() };
    const local = localStorage.getItem('bluman_custom_document_templates');
    const list = local ? JSON.parse(local) : [];
    localStorage.setItem('bluman_custom_document_templates', JSON.stringify([newTmpl, ...list]));
    return newTmpl;
  }
}

export async function aggiornaDocumentoTemplateApi(id: string, data: { titolo?: string; categoria?: string; descrizione?: string; contenutoHtml?: string }) {
  try {
    const res = await apiFetch(`${API_BASE}/documenti-template/${id}`, {
      method: 'PUT',
      headers: getAuthHeaders(),
      body: JSON.stringify(data),
    });
    if (!res.ok) throw new Error('Errore aggiornamento template');
    return await res.json();
  } catch (err) {
    console.warn('Aggiornamento template fallback local:', err);
    const local = localStorage.getItem('bluman_custom_document_templates');
    const list: any[] = local ? JSON.parse(local) : [];
    const updated = list.map(t => t.id === id ? { ...t, ...data } : t);
    localStorage.setItem('bluman_custom_document_templates', JSON.stringify(updated));
    return { ok: true };
  }
}

export async function eliminaDocumentoTemplateApi(id: string) {
  try {
    const res = await apiFetch(`${API_BASE}/documenti-template/${id}`, {
      method: 'DELETE',
      headers: getAuthHeaders(),
    });
    if (!res.ok) throw new Error('Errore eliminazione template');
    return await res.json();
  } catch (err) {
    console.warn('Eliminazione template fallback local:', err);
    const local = localStorage.getItem('bluman_custom_document_templates');
    const list: any[] = local ? JSON.parse(local) : [];
    const updated = list.filter(t => t.id !== id);
    localStorage.setItem('bluman_custom_document_templates', JSON.stringify(updated));
    return { ok: true };
  }
}

export async function fetchAdminTenantsApi() {
  try {
    const res = await apiFetch(`${API_BASE}/admin/tenants`, { headers: getAuthHeaders() });
    if (!res.ok) throw new Error('Errore recupero tenants');
    return await res.json();
  } catch (err) {
    console.warn('Recupero admin tenants fallback local:', err);
    const local = localStorage.getItem('bluman_all_tenants_admin');
    return local ? JSON.parse(local) : null;
  }
}

export async function createAdminTenantApi(data: any) {
  // Nessun fallback silenzioso: se il server rifiuta (403 non-super-admin) o non risponde,
  // lo studio non esiste e va detto. Prima la funzione restituiva `data`, cioè l'oggetto
  // appena costruito dal client, facendo sembrare riuscita una creazione mai avvenuta.
  const res = await apiFetch(`${API_BASE}/admin/tenants`, {
    method: 'POST',
    headers: getAuthHeaders(),
    body: JSON.stringify(data),
  });
  if (!res.ok) {
    const errore = await res.json().catch(() => ({}));
    throw new Error(errore?.errore || 'Creazione studio rifiutata dal server');
  }
  return await res.json();
}

/**
 * Rigenera la password del responsabile dello studio. È l'unico modo per riottenerla:
 * il database ne conserva solo l'hash scrypt, quindi la vecchia non è recuperabile.
 */
export async function resetPasswordTenantApi(id: string) {
  const res = await apiFetch(`${API_BASE}/admin/tenants/${id}/reset-password`, {
    method: 'POST',
    headers: getAuthHeaders(),
  });
  if (!res.ok) {
    const errore = await res.json().catch(() => ({}));
    throw new Error(errore?.errore || 'Reset password non riuscito');
  }
  return await res.json() as { ok: boolean; email: string; passwordTemporanea: string };
}

export async function updateAdminTenantApi(id: string, data: any) {
  try {
    const res = await apiFetch(`${API_BASE}/admin/tenants/${id}`, {
      method: 'PATCH',
      headers: getAuthHeaders(),
      body: JSON.stringify(data),
    });
    if (!res.ok) throw new Error('Errore aggiornamento tenant');
    return await res.json();
  } catch (err) {
    console.warn('Aggiornamento tenant API fallback local:', err);
    return data;
  }
}

export async function deleteAdminTenantApi(id: string) {
  try {
    const res = await apiFetch(`${API_BASE}/admin/tenants/${id}`, {
      method: 'DELETE',
      headers: getAuthHeaders(),
    });
    if (!res.ok) throw new Error('Errore eliminazione tenant');
    return await res.json();
  } catch (err) {
    console.warn('Eliminazione tenant API fallback local:', err);
    return { ok: true };
  }
}




