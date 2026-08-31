// §41 — Il client della cartella modelli dello studio (`/documenti-template`).
//
// Perché un file a parte: `api/documenti.ts` è a ~580 righe e parla del fascicolo del progetto;
// qui si parla dei modelli e del loro stato di revisione (regola 8). Le quattro funzioni
// preesistenti sono state spostate da lì senza cambio di firma — i chiamanti importano da
// `api/client`, che le ri-esporta — e ne sono state aggiunte quattro nuove.
//
// La correzione che conta sta in `fetchDocumentiTemplateApi`: prima, se la chiamata fallisce,
// leggeva `localStorage.bluman_custom_document_templates` e restituiva quello **come se
// arrivasse dal server**. Così una rete caduta diventava «lo studio ha questi tre modelli» —
// che è una risposta inventata, e la regola 7 la vieta. Ora l'errore si propaga e la cartella
// dice che non ha potuto leggere.

import { API_BASE, apiFetch, getAuthHeaders, leggiErroreApi } from './http';

/** Uno stato di revisione come lo scrive il backend (`src/services/revisioneModello.ts`). */
export type StatoRevisioneModello = 'bozza' | 'in_revisione' | 'approvato';

/**
 * Il modello come sta a database.
 *
 * `statoRevisione` è `null` soltanto per i modelli **di serie** non ancora adottati: quelli
 * scritti nel codice, che non hanno una riga e quindi nessuno stato. Mostrarli come «bozza»
 * sarebbe attribuire allo studio una valutazione che nessuno ha dato.
 */
export interface ModelloStudioApi {
  id: string;
  titolo: string;
  categoria: string;
  descrizione: string;
  contenutoHtml: string;
  livelloFirmaRichiesto: 'ses' | 'fea' | 'feq';
  statoRevisione: StatoRevisioneModello;
  versione: number;
  noteRevisione: string | null;
  revisionatoDaUserId: string | null;
  revisionatoDaNome: string | null;
  revisionatoAt: string | null;
  archiviatoAt: string | null;
  riferimentoSerie: string | null;
  createdAt: string;
  updatedAt: string;
}

/**
 * I modelli dello studio. `includiArchiviati` serve alla cartella, che ha una vista «archivio»;
 * il Document Studio chiama senza argomenti e vede solo i modelli attivi.
 *
 * Nessun fallback locale: se la lettura non riesce, l'errore arriva a chi ha chiesto.
 */
export async function fetchDocumentiTemplateApi(includiArchiviati = false): Promise<ModelloStudioApi[]> {
  const query = includiArchiviati ? '?includiArchiviati=1' : '';
  const res = await apiFetch(`${API_BASE}/documenti-template${query}`, { headers: getAuthHeaders() });
  if (!res.ok) throw new Error(await leggiErroreApi(res, 'Errore recupero modelli documento'));
  return await res.json();
}

export async function creaDocumentoTemplateApi(data: {
  titolo: string;
  categoria?: string;
  descrizione?: string;
  contenutoHtml: string;
  livelloFirmaRichiesto?: 'ses' | 'fea' | 'feq';
}): Promise<ModelloStudioApi> {
  // §3.3 — il fallback fabbricava un template locale in localStorage spacciandolo per
  // salvato sul server. Il salvataggio locale (se voluto) spetta al chiamante; qui
  // l'errore si propaga così la UI può dire la verità.
  const res = await apiFetch(`${API_BASE}/documenti-template`, {
    method: 'POST',
    headers: getAuthHeaders(),
    body: JSON.stringify(data),
  });
  if (!res.ok) throw new Error(await leggiErroreApi(res, 'Errore salvataggio template'));
  return await res.json();
}

/**
 * Modifica del modello. La risposta porta `approvazioneDecaduta`: vale `true` quando il testo
 * di un modello approvato è cambiato e l'approvazione è quindi caduta. Va detto all'operatore,
 * perché è un effetto che non ha chiesto.
 */
export async function aggiornaDocumentoTemplateApi(
  id: string,
  data: { titolo?: string; categoria?: string; descrizione?: string; contenutoHtml?: string; livelloFirmaRichiesto?: 'ses' | 'fea' | 'feq' },
): Promise<ModelloStudioApi & { approvazioneDecaduta?: boolean }> {
  // §3.3 — nessun fallback: aggiornamento fallito = il template è ancora com'era.
  const res = await apiFetch(`${API_BASE}/documenti-template/${id}`, {
    method: 'PUT',
    headers: getAuthHeaders(),
    body: JSON.stringify(data),
  });
  if (!res.ok) throw new Error(await leggiErroreApi(res, 'Errore aggiornamento template'));
  return await res.json();
}

export async function eliminaDocumentoTemplateApi(id: string): Promise<{ ok: boolean }> {
  // §3.3 — il fallback eliminava il template da localStorage e rispondeva ok anche se
  // il server non lo aveva cancellato: al reload il template riappariva. L'errore si
  // propaga; la rimozione locale spetta al chiamante solo DOPO la conferma del server.
  const res = await apiFetch(`${API_BASE}/documenti-template/${id}`, {
    method: 'DELETE',
    headers: getAuthHeaders(),
  });
  if (!res.ok) throw new Error(await leggiErroreApi(res, 'Errore eliminazione template'));
  return await res.json();
}

/** §41 — «questo testo l'ha riletto qualcuno?»: porta il modello in bozza, in revisione o approvato. */
export async function revisionaModelloApi(
  id: string,
  stato: StatoRevisioneModello,
  note?: string,
): Promise<ModelloStudioApi> {
  const res = await apiFetch(`${API_BASE}/documenti-template/${id}/revisione`, {
    method: 'PATCH',
    headers: getAuthHeaders(),
    body: JSON.stringify({ stato, note: note ?? null }),
  });
  if (!res.ok) throw new Error(await leggiErroreApi(res, 'Errore revisione modello'));
  return await res.json();
}

/**
 * §41 — Archiviazione del modello a database.
 *
 * Prima questo gesto scriveva un id in `localStorage` (`bluman_archived_template_ids`): valeva
 * per quel browser e per nessun altro, e svuotando la cache il modello tornava attivo. Ora è
 * una data sulla riga, quindi vale per lo studio.
 */
export async function archiviaModelloApi(id: string, archiviato: boolean): Promise<ModelloStudioApi> {
  const res = await apiFetch(`${API_BASE}/documenti-template/${id}/archiviazione`, {
    method: 'PATCH',
    headers: getAuthHeaders(),
    body: JSON.stringify({ archiviato }),
  });
  if (!res.ok) throw new Error(await leggiErroreApi(res, archiviato ? 'Errore archiviazione modello' : 'Errore ripristino modello'));
  return await res.json();
}

/**
 * §41 — Adozione di un modello di serie: da carta uguale per tutti gli studi a carta di questo
 * studio, con una riga a database su cui poggiare lo stato di revisione.
 *
 * È idempotente: il vincolo unico `(tenant_id, riferimento_serie)` impedisce due copie della
 * stessa carta, e la risposta porta `giaAdottato: true` se la riga esisteva già.
 */
export async function adottaModelloSerieApi(data: {
  riferimentoSerie: string;
  titolo: string;
  categoria?: string;
  descrizione?: string;
  contenutoHtml: string;
  livelloFirmaRichiesto?: 'ses' | 'fea' | 'feq';
}): Promise<ModelloStudioApi & { giaAdottato: boolean }> {
  const res = await apiFetch(`${API_BASE}/documenti-template/adotta`, {
    method: 'POST',
    headers: getAuthHeaders(),
    body: JSON.stringify(data),
  });
  if (!res.ok) throw new Error(await leggiErroreApi(res, 'Errore adozione modello di serie'));
  return await res.json();
}
