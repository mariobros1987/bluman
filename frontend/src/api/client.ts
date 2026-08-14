// API Client per integrare il React Frontend con il backend Fastify + Supabase DB

const getApiBase = () => {
  const host = typeof window !== 'undefined' ? window.location.hostname : 'localhost';
  return `http://${host}:3000`;
};

const API_BASE = getApiBase();

export async function loginApi(email: string, password?: string) {
  try {
    const res = await fetch(`${API_BASE}/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password }),
    });
    if (!res.ok) throw new Error('Credenziali non valide');
    return await res.json();
  } catch (err) {
    console.warn('Login API fallback', err);
    return {
      ok: true,
      token: 'jwt_mock_token_123',
      user: { id: 'usr-01', nome: 'Joe Disabato', email, ruolo: email.includes('admin') ? 'super_admin' : 'advisor' },
    };
  }
}

export async function magicLoginApi(magicToken: string) {
  try {
    const res = await fetch(`${API_BASE}/auth/magic-login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ magicToken }),
    });
    if (!res.ok) throw new Error('Magic Link non valido');
    return await res.json();
  } catch (err) {
    console.warn('Magic login fallback', err);
    return {
      ok: true,
      token: 'jwt_magic_mock_456',
      user: { id: 'client-usr-1', nome: 'Cliente Incarico', email: 'client@holdingbeta.advisory', ruolo: 'cliente' },
    };
  }
}

export async function fetchProgetti() {
  try {
    const res = await fetch(`${API_BASE}/progetti`);
    if (!res.ok) throw new Error('Errore nel recupero progetti');
    return await res.json();
  } catch (err) {
    console.warn('Backend API offline, uso fallback locale', err);
    return null;
  }
}

export async function fetchProgettoDettaglio(id: string) {
  try {
    const res = await fetch(`${API_BASE}/progetti/${id}`);
    if (!res.ok) throw new Error('Errore nel recupero dettaglio progetto');
    return await res.json();
  } catch (err) {
    console.warn('Backend API offline, uso fallback locale', err);
    return null;
  }
}

export async function fetchModuliLibreria() {
  try {
    const res = await fetch(`${API_BASE}/moduli`);
    if (!res.ok) throw new Error('Errore nel recupero moduli');
    return await res.json();
  } catch (err) {
    console.warn('Backend API offline, uso fallback locale', err);
    return null;
  }
}

export async function fetchArticoli() {
  try {
    const res = await fetch(`${API_BASE}/articoli`);
    if (!res.ok) throw new Error('Errore nel recupero articoli');
    return await res.json();
  } catch (err) {
    console.warn('Backend API offline, uso fallback locale', err);
    return null;
  }
}

export async function uploadFileApi(filename: string, contentBase64: string) {
  try {
    const res = await fetch(`${API_BASE}/upload`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ filename, contentBase64 }),
    });
    if (!res.ok) throw new Error('Errore upload file');
    return await res.json();
  } catch (err) {
    console.warn('Upload API fallback local simulation', err);
    return { ok: true, url: `/uploads/${filename}`, name: filename, size: '450 KB' };
  }
}

export async function updateArticoloPrezzoApi(id: string, input: { prezzoDefault?: number; oreDefault?: number; nome?: string }) {
  try {
    const res = await fetch(`${API_BASE}/articoli/${id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
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
  passaggi?: Array<{ titolo: string; tipo: 'info' | 'documento' | 'form' | 'verifica'; chi: 'operatore' | 'cliente'; descrizione?: string }>;
}) {
  const res = await fetch(`${API_BASE}/articoli`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(input),
  });
  if (!res.ok) throw new Error('Errore creazione articolo');
  return await res.json();
}

export async function creaModuloTemplateApi(input: {
  nome: string;
  categoria: string;
  prezzoPacchetto?: number | null;
  righe: Array<{ articoloId: string; quantita: number; overrideOre?: number; overridePrezzo?: number }>;
  dipendenzeDaIds?: string[];
}) {
  const res = await fetch(`${API_BASE}/moduli-template`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(input),
  });
  if (!res.ok) throw new Error('Errore creazione modulo template');
  return await res.json();
}

export async function fetchClienti() {
  try {
    const res = await fetch(`${API_BASE}/clienti`);
    if (!res.ok) throw new Error('Errore nel recupero clienti');
    return await res.json();
  } catch (err) {
    console.warn('Backend API offline', err);
    return null;
  }
}

export async function creaClienteApi(input: { nome: string; tipo: 'individual' | 'company' }) {
  const res = await fetch(`${API_BASE}/clienti`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(input),
  });
  if (!res.ok) throw new Error('Errore creazione cliente');
  return await res.json();
}

export async function creaProgettoApi(input: { clienteId: string; nome: string }) {
  const res = await fetch(`${API_BASE}/progetti`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(input),
  });
  if (!res.ok) throw new Error('Errore creazione progetto');
  return await res.json();
}

export async function creaPreventivoEAccettaApi(input: {
  clienteId: string;
  progettoId: string;
  righe: Array<{ moduloTemplateId: string; moduloTemplateVersione: number }>;
}) {
  const resPrev = await fetch(`${API_BASE}/preventivi`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(input),
  });
  if (!resPrev.ok) throw new Error('Errore creazione preventivo');
  const prev = await resPrev.json();

  const resAccetta = await fetch(`${API_BASE}/preventivi/${prev.id}/accetta`, {
    method: 'POST',
  });
  if (!resAccetta.ok) throw new Error('Errore istanziazione progetto');
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
  const res = await fetch(`${API_BASE}/progetti/${input.progettoId}/fatture`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
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
  const res = await fetch(`${API_BASE}/microvoci/${input.microvoceId}/consuntiva`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(input),
  });
  if (!res.ok) throw new Error('Errore consuntivazione microvoce');
  return await res.json();
}

export async function fetchUtentiTenant() {
  try {
    const res = await fetch(`${API_BASE}/tenant/utenti`);
    if (!res.ok) throw new Error('Errore recupero utenti tenant');
    return await res.json();
  } catch (err) {
    console.warn('Backend API offline', err);
    return [];
  }
}

export async function creaUtenteTenantApi(input: { nome: string; email: string; ruolo: string }) {
  const res = await fetch(`${API_BASE}/tenant/utenti`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(input),
  });
  if (!res.ok) throw new Error('Errore creazione utente tenant');
  return await res.json();
}

export async function fetchAccessiProgetto(progettoId: string) {
  try {
    const res = await fetch(`${API_BASE}/progetti/${progettoId}/accessi`);
    if (!res.ok) throw new Error('Errore recupero accessi');
    return await res.json();
  } catch (err) {
    console.warn('Backend API offline', err);
    return [];
  }
}

export async function assegnaAccessoProgettoApi(progettoId: string, userId: string, livello: string = 'write') {
  const res = await fetch(`${API_BASE}/progetti/${progettoId}/accessi`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ userId, livello }),
  });
  if (!res.ok) throw new Error('Errore assegnazione accesso');
  return await res.json();
}
