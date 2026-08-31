import { API_BASE, apiFetch, getAuthHeaders, leggiErroreApi } from './http';

export interface FatturaPortale {
  id: string;
  numero: string;
  tipoDocumento: 'fattura' | 'nota_credito';
  data: string | null;
  stato: 'emessa' | 'incassata';
  pagata: boolean;
  totaleCentesimi: number;
  progettoId: string;
  progetto: string | null;
  prossimaScadenza: { dataScadenza: string; importoCentesimi: number } | null;
}

export async function fatturePortaleApi(clienteId?: string): Promise<FatturaPortale[]> {
  const query = clienteId ? `?clienteId=${encodeURIComponent(clienteId)}` : '';
  const res = await apiFetch(`${API_BASE}/portal/fatture${query}`, { headers: getAuthHeaders() });
  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    throw new Error(data.errore ?? 'Errore lettura fatture');
  }
  const data = await res.json();
  return data.fatture ?? [];
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
  // §3.3 — registrare un incasso muove la Prima Nota: un fallimento restituito come `null`
  // lasciava l'operatore senza conferma né errore, con la rata ancora «aperta» a database.
  const res = await apiFetch(`${API_BASE}/invoices/scadenze/${scadenzaId}/incassi`, {
    method: 'POST',
    headers: getAuthHeaders(),
    body: JSON.stringify(input),
  });
  if (!res.ok) throw new Error(await leggiErroreApi(res, 'Errore durante la registrazione dell\'incasso'));
  return await res.json();
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
  // §3.3 — un canone ricorrente genera fatture automatiche: se la creazione non arriva a
  // database il contratto non esiste. Prima il `null` scatenava la creazione di un contratto
  // finto in localStorage sul chiamante, con tanto di alert «attivato con successo».
  const res = await apiFetch(`${API_BASE}/contratti-ricorrenti`, {
    method: 'POST',
    headers: getAuthHeaders(),
    body: JSON.stringify(input),
  });
  if (!res.ok) throw new Error(await leggiErroreApi(res, 'Errore creazione contratto'));
  return await res.json();
}

export async function generaFatturaRetainerApi(contrattoId: string) {
  // §3.3 — l'emissione di una fattura è un atto fiscale: se il backend non la crea, la fattura
  // non esiste. Prima il `null` faceva fabbricare al chiamante una fattura locale con numero
  // inventato (`FT-<anno>-000N` casuale), mostrata in elenco come vera.
  const res = await apiFetch(`${API_BASE}/contratti-ricorrenti/${contrattoId}/genera-fattura`, {
    method: 'POST',
    headers: getAuthHeaders(),
  });
  if (!res.ok) throw new Error(await leggiErroreApi(res, 'Errore generazione fattura retainer'));
  return await res.json();
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
  // §3.3 — il webhook SDI aggiorna lo stato fiscale della fattura: se la scrittura
  // fallisce l'errore si propaga, nessun "consegnata" finto.
  const res = await apiFetch(`${API_BASE}/webhooks/sdi`, {
    method: 'POST',
    headers: getAuthHeaders(),
    body: JSON.stringify({ fatturaId, statoSdi }),
  });
  if (!res.ok) throw new Error(await leggiErroreApi(res, 'Errore invio webhook SDI'));
  return await res.json();
}

export async function fetchContiBancariApi() {
  try {
    const res = await apiFetch(`${API_BASE}/conti-bancari`, { headers: getAuthHeaders() });
    if (!res.ok) throw new Error('Errore recupero conti bancari');
    return await res.json();
  } catch (err) {
    // §3.3 — prima il fallback restituiva QUATTRO conti bancari inventati (IBAN fittizi, saldi
    // a 7 cifre, Unicredit/Intesa/Stripe/Cassa) spacciandoli per reali in una schermata
    // finanziaria. Una lettura che fallisce restituisce lista vuota, non un bilancio immaginario.
    console.warn('Conti bancari API non disponibile:', err);
    return [];
  }
}

export async function creaContoBancarioApi(input: { nomeConto: string; banca: string; iban?: string; bicSwift?: string; saldoInizialeEur: number; isDefault?: boolean }) {
  // §3.3 — un conto bancario/cassa è dato contabile: se la creazione non va a buon fine il
  // conto non esiste e non va mostrato come aggiunto. L'errore si propaga al chiamante.
  const res = await apiFetch(`${API_BASE}/conti-bancari`, {
    method: 'POST',
    headers: getAuthHeaders(),
    body: JSON.stringify(input),
  });
  if (!res.ok) throw new Error(await leggiErroreApi(res, 'Errore creazione conto bancario'));
  return await res.json();
}

export async function preparaInvioManualeSdiApi(fatturaId: string) {
  // §3.5 — la vecchia «trasmissione 1-click a SdI» fabbricava un identificativo finto
  // senza alcun provider collegato. Ora il sistema prepara la fattura per l'invio
  // manuale (XML scaricabile; trasmissione a cura dell'operatore tramite il portale
  // «Fatture & Corrispettivi» o l'intermediario). Gli errori si propagano (§3.3).
  const res = await apiFetch(`${API_BASE}/invoices/${fatturaId}/prepara-invio-manuale`, {
    method: 'POST',
    headers: getAuthHeaders(),
  });
  if (!res.ok) throw new Error(await leggiErroreApi(res, 'Errore preparazione invio manuale'));
  return await res.json();
}

// ─── NUOVE FUNZIONI CONTABILITÀ INTEGRATA OPENSTAMANAGER ─────────────
export async function createInvoiceApi(input: any) {
  const res = await apiFetch(`${API_BASE}/invoices`, {
    method: 'POST',
    headers: getAuthHeaders(),
    body: JSON.stringify(input),
  });
  if (!res.ok) throw new Error(await leggiErroreApi(res, 'Errore creazione bozza fattura'));
  return await res.json();
}

export async function updateInvoiceApi(id: string, input: any) {
  const res = await apiFetch(`${API_BASE}/invoices/${id}`, {
    method: 'PUT',
    headers: getAuthHeaders(),
    body: JSON.stringify(input),
  });
  if (!res.ok) throw new Error(await leggiErroreApi(res, 'Errore modifica fattura'));
  return await res.json();
}

export async function deleteInvoiceApi(id: string) {
  const res = await apiFetch(`${API_BASE}/invoices/${id}`, {
    method: 'DELETE',
    headers: getAuthHeaders(),
  });
  if (!res.ok) throw new Error(await leggiErroreApi(res, 'Errore eliminazione bozza fattura'));
  return await res.json();
}

export async function emettiInvoiceApi(id: string) {
  const res = await apiFetch(`${API_BASE}/invoices/${id}/emetti`, {
    method: 'POST',
    headers: getAuthHeaders(),
  });
  if (!res.ok) throw new Error(await leggiErroreApi(res, 'Errore emissione fattura'));
  return await res.json();
}

export async function emettiNotaCreditoApi(id: string, input: { motivo: string; note?: string }) {
  const res = await apiFetch(`${API_BASE}/invoices/${id}/nota-credito`, {
    method: 'POST',
    headers: getAuthHeaders(),
    body: JSON.stringify(input),
  });
  if (!res.ok) throw new Error(await leggiErroreApi(res, 'Errore emissione nota di credito'));
  return await res.json();
}

export async function importFromProjectApi(progettoId: string, moduliIds?: string[], percentuale?: number) {
  const res = await apiFetch(`${API_BASE}/fatture/da-progetto`, {
    method: 'POST',
    headers: getAuthHeaders(),
    body: JSON.stringify({ progettoId, moduliIds, percentuale }),
  });
  if (!res.ok) throw new Error(await leggiErroreApi(res, 'Errore importazione da progetto'));
  return await res.json();
}

export async function importFromPreventivoApi(preventivoId: string) {
  const res = await apiFetch(`${API_BASE}/fatture/da-preventivo`, {
    method: 'POST',
    headers: getAuthHeaders(),
    body: JSON.stringify({ preventivoId }),
  });
  if (!res.ok) throw new Error(await leggiErroreApi(res, 'Errore importazione da preventivo'));
  return await res.json();
}

export async function importFromTimesheetApi(progettoId: string, operatoreId?: string, tariffaOrariaCent?: number) {
  const res = await apiFetch(`${API_BASE}/fatture/da-timesheet`, {
    method: 'POST',
    headers: getAuthHeaders(),
    body: JSON.stringify({ progettoId, operatoreId, tariffaOrariaCent }),
  });
  if (!res.ok) throw new Error(await leggiErroreApi(res, 'Errore importazione da timesheet'));
  return await res.json();
}

export async function fetchPrimaNotaApi() {
  const res = await apiFetch(`${API_BASE}/prima-nota`, { headers: getAuthHeaders() });
  if (!res.ok) throw new Error(await leggiErroreApi(res, 'Errore lettura prima nota'));
  return await res.json();
}

export async function createPrimaNotaApi(input: any) {
  const res = await apiFetch(`${API_BASE}/prima-nota`, {
    method: 'POST',
    headers: getAuthHeaders(),
    body: JSON.stringify(input),
  });
  if (!res.ok) throw new Error(await leggiErroreApi(res, 'Errore registrazione prima nota'));
  return await res.json();
}

export async function importCsvPrimaNotaApi(csvContent: string, contoBancarioId?: string) {
  const res = await apiFetch(`${API_BASE}/prima-nota/import-csv`, {
    method: 'POST',
    headers: getAuthHeaders(),
    body: JSON.stringify({ csvContent, contoBancarioId }),
  });
  if (!res.ok) throw new Error(await leggiErroreApi(res, 'Errore importazione CSV'));
  return await res.json();
}

export async function deletePrimaNotaApi(id: string) {
  const res = await apiFetch(`${API_BASE}/prima-nota/${id}`, {
    method: 'DELETE',
    headers: getAuthHeaders(),
  });
  if (!res.ok) throw new Error(await leggiErroreApi(res, 'Errore eliminazione movimento'));
  return await res.json();
}

