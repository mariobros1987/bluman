// L'aiuto in-app: l'indice delle schede e la scheda singola.
//
// Entrambe **non lanciano mai**, come `fetchAnagraficaStudioApi` (`api/tenant.ts`): restituiscono
// `letto: false` quando il server non risponde o la risposta non ha la forma attesa. La ragione è
// §7, e qui ha una conseguenza precisa: la pagina dell'aiuto, davanti a un `letto: false`, **non
// mostra un indice vuoto** — dice che il manuale non è disponibile in questa installazione. Un
// indice vuoto sarebbe la stessa schermata con il significato opposto: «non c'è niente da leggere»
// invece di «non ho potuto leggere», e la prima è una bugia detta dall'app.
//
// L'HTML di una scheda arriva **già sanitizzato dal server** ed è l'unica cosa che questa pagina
// passa a `dangerouslySetInnerHTML`. Il confine è là, non qui: `sanitizzaHtmlDocumento` gira sul
// backend, e nel bundle del browser non esiste.

import { API_BASE, apiFetch, erroreDellaRisposta, getAuthHeaders } from './http';

export interface SchedaManualeApi {
  slug: string;
  numero: string;
  titolo: string;
  riservata: boolean;
  /** Il contenuto visibile al proprio ruolo, in testo piano, un rigo di sorgente per riga. */
  testo: string;
}

export interface IndiceManualeApi {
  /** Falso quando il manuale non è leggibile in questa installazione. **Non** è «indice vuoto». */
  letto: boolean;
  schede: SchedaManualeApi[];
}

export interface SchedaApertaApi {
  letto: boolean;
  slug: string;
  numero: string;
  titolo: string;
  riservata: boolean;
  /** HTML **già sanitizzato dal server**, pronto per `dangerouslySetInnerHTML`. */
  html: string;
  /** Perché non si è potuta leggere, **con le parole del server**, quando `letto` è falso.
   *  Un 403 e un 404 sono due cose diverse e il server le sa distinguere meglio di qui. */
  errore?: string;
}

const INDICE_NON_LETTO: IndiceManualeApi = { letto: false, schede: [] };
const SCHEDA_NON_LETTA: SchedaApertaApi = { letto: false, slug: '', numero: '', titolo: '', riservata: false, html: '' };

/**
 * L'indice delle schede, già filtrato per ruolo dal server.
 *
 * Il `testo` viaggia con l'indice — sono ~110 KB in una richiesta sola — perché la ricerca cerca in
 * locale, mentre si scrive. Interrogare il server a ogni tasto sarebbe un ciclo di richieste per
 * una funzione che deve essere istantanea.
 */
export async function fetchIndiceManualeApi(): Promise<IndiceManualeApi> {
  try {
    const res = await apiFetch(`${API_BASE}/manuale`, { headers: getAuthHeaders() });
    if (!res.ok) return INDICE_NON_LETTO;
    const dati = await res.json().catch(() => null);
    // Una risposta che non ha la forma attesa non è una risposta. In particolare `schede` senza
    // `letto` non deve passare per un indice valido: un elenco vuoto con `letto: true` direbbe
    // «non c'è aiuto», che è la conclusione che non si vuole far trarre per sbaglio.
    if (!dati || typeof dati.letto !== 'boolean' || !Array.isArray(dati.schede)) return INDICE_NON_LETTO;
    return { letto: dati.letto, schede: dati.schede as SchedaManualeApi[] };
  } catch {
    return INDICE_NON_LETTO;
  }
}

/** Una scheda. Il 403 della §19 e il 404 di una scheda inesistente valgono entrambi `letto: false`,
 *  perché per chi legge sono la stessa cosa: quella pagina non c'è. Ma **il perché viaggia con
 *  loro**, con le parole del server: la pagina lo mostra, e così un collaboratore che apre la §19
 *  legge che è riservata all'amministratore della piattaforma invece di «non trovata». */
export async function fetchSchedaManualeApi(slug: string): Promise<SchedaApertaApi> {
  try {
    const res = await apiFetch(`${API_BASE}/manuale/${encodeURIComponent(slug)}`, { headers: getAuthHeaders() });
    if (!res.ok) {
      const motivo = await erroreDellaRisposta(res, `La scheda «${slug}» non è disponibile.`);
      return { ...SCHEDA_NON_LETTA, slug, errore: motivo.message };
    }
    const dati = await res.json().catch(() => null);
    if (!dati || dati.letto !== true || typeof dati.html !== 'string' || typeof dati.titolo !== 'string') {
      return { ...SCHEDA_NON_LETTA, slug, errore: `La scheda «${slug}» è arrivata in una forma inattesa.` };
    }
    return {
      letto: true,
      slug: typeof dati.slug === 'string' ? dati.slug : slug,
      numero: typeof dati.numero === 'string' ? dati.numero : '',
      titolo: dati.titolo,
      riservata: dati.riservata === true,
      html: dati.html,
    };
  } catch (err) {
    return {
      ...SCHEDA_NON_LETTA,
      slug,
      errore: err instanceof Error ? err.message : `La scheda «${slug}» non è disponibile.`,
    };
  }
}
