import { API_BASE, apiFetch, getAuthHeaders, leggiErroreApi } from './http';

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
  // §3.3 — prima il `catch` inventava `{ id: 'giur-<timestamp>', ...input }`: la riga
  // compariva in lista con un id mai esistito a database e le successive letture la
  // perdevano. Una scrittura rifiutata o non consegnata è un errore, non una creazione.
  const res = await apiFetch(`${API_BASE}/giurisdizioni`, {
    method: 'POST',
    headers: getAuthHeaders(),
    body: JSON.stringify(input),
  });
  if (!res.ok) throw new Error(await leggiErroreApi(res, 'Errore creazione giurisdizione'));
  return await res.json();
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

export async function updateArticoloPrezzoApi(id: string, input: { prezzoDefault?: number; oreDefault?: number; nome?: string }) {
  // §3.3 — prima il `catch` restituiva `{ ok: true, ...input }`: un prezzo/ore aggiornato
  // solo a schermo ma mai scritto a database. Il listino tornava al valore vecchio al reload.
  const res = await apiFetch(`${API_BASE}/articoli/${id}`, {
    method: 'PATCH',
    headers: getAuthHeaders(),
    body: JSON.stringify(input),
  });
  if (!res.ok) throw new Error(await leggiErroreApi(res, 'Errore aggiornamento articolo'));
  return await res.json();
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

export async function aggiornaModuloTemplateApi(id: string, input: {
  nome?: string;
  categoria?: string;
  giurisdizioneId?: string | null;
  prezzoPacchetto?: number | null;
  righe?: Array<{ articoloId: string; quantita: number; overrideOre?: number; overridePrezzo?: number }>;
  dipendenzeDaIds?: string[];
}) {
  const res = await apiFetch(`${API_BASE}/moduli-template/${id}`, {
    method: 'PUT',
    headers: getAuthHeaders(),
    body: JSON.stringify(input),
  });
  if (!res.ok) throw new Error(await leggiErroreApi(res, 'Errore aggiornamento modulo template'));
  return await res.json();
}

// §30 — disattivazione, non cancellazione: i progetti e i preventivi già creati
// continuano a funzionare, il modulo sparisce solo dalla libreria.
export async function disattivaModuloTemplateApi(id: string) {
  const res = await apiFetch(`${API_BASE}/moduli-template/${id}`, {
    method: 'DELETE',
    headers: getAuthHeaders(),
  });
  if (!res.ok) throw new Error(await leggiErroreApi(res, 'Errore disattivazione modulo template'));
  return await res.json();
}

export async function disattivaArticoloApi(id: string) {
  const res = await apiFetch(`${API_BASE}/articoli/${id}`, {
    method: 'DELETE',
    headers: getAuthHeaders(),
  });
  if (!res.ok) throw new Error(await leggiErroreApi(res, 'Errore disattivazione articolo'));
  return await res.json();
}
