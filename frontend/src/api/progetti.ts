import { API_BASE, apiFetch, getAuthHeaders, leggiErroreApi } from './http';
import { queryPaginazione, type ParametriListaPaginata } from './paginazione';
import { cachedQuery, invalidateCache } from './cache';
import { getCurrentTenantId } from '../utils/tenant';

export async function fetchProgetti(parametri?: ParametriListaPaginata, options?: { forceRefresh?: boolean }) {
  const currentTenantId = getCurrentTenantId();
  const cacheKey = `progetti_${currentTenantId}_${JSON.stringify(parametri || {})}`;

  return cachedQuery(
    cacheKey,
    async () => {
      try {
        const res = await apiFetch(`${API_BASE}/progetti${queryPaginazione(parametri)}`, { headers: getAuthHeaders() }, 15000);
        if (!res.ok) throw new Error(await leggiErroreApi(res, 'Errore nel recupero progetti'));
        return await res.json();
      } catch (err) {
        if (parametri) throw err;
        console.warn('Backend API offline o in latenza, uso il caricamento istantaneo locale', err);
        return null;
      }
    },
    { ttlMs: 30_000, forceRefresh: options?.forceRefresh }
  );
}

export async function fetchProgettoDettaglio(id: string, options?: { forceRefresh?: boolean }) {
  const currentTenantId = getCurrentTenantId();
  const cacheKey = `progetto_detail_${currentTenantId}_${id}`;

  return cachedQuery(
    cacheKey,
    async () => {
      try {
        const res = await apiFetch(`${API_BASE}/progetti/${id}`, { headers: getAuthHeaders() });
        if (!res.ok) throw new Error('Errore nel recupero dettaglio progetto');
        return await res.json();
      } catch (err) {
        console.warn('Backend API offline, uso fallback locale', err);
        return null;
      }
    },
    { ttlMs: 30_000, forceRefresh: options?.forceRefresh }
  );
}

export async function creaProgettoApi(input: { clienteId: string; nome: string }) {
  const res = await apiFetch(`${API_BASE}/progetti`, {
    method: 'POST',
    headers: getAuthHeaders(),
    body: JSON.stringify(input),
  });
  if (!res.ok) throw new Error('Errore creazione progetto');
  invalidateCache('progett');
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
  invalidateCache('progett');
  return await res.json();
}

/** Elimina un singolo modulo (con le sue micro-voci) da un progetto. 409 se ha ore consuntivate. */
export async function eliminaModuloApi(progettoId: string, moduloId: string): Promise<void> {
  const res = await apiFetch(
    `${API_BASE}/progetti/${encodeURIComponent(progettoId)}/moduli/${encodeURIComponent(moduloId)}`,
    { method: 'DELETE', headers: getAuthHeaders() },
  );
  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    throw new Error((data as any).errore ?? 'Eliminazione modulo non riuscita.');
  }
  invalidateCache('progett');
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
 * Il link firmato che collega la chat Telegram di un cliente a questa pratica.
 *
 * Il link si compone sul server e non qui: la firma è un HMAC con il segreto del webhook, che
 * non esiste nel browser (regola 6). Il motivo per cui non si compone si riporta com'è — «bot non
 * configurato» e «manca lo @username» si risolvono in due punti diversi delle impostazioni.
 *
 * Con `microvoceId` il link è quello della **micro-voce**: chi lo tocca collega la chat alla pratica
 * e dichiara anche di quale voce sta parlando, così i messaggi che seguono nascono già abbinati. Il
 * `tipo` che torna dice quale dei due è stato composto, e non è ridondante: è ciò che permette alla
 * scheda di **dire** al cliente cosa succederà, invece di farglielo scoprire dopo.
 */
export async function fetchLinkTelegramApi(
  progettoId: string,
  microvoceId?: string,
): Promise<{ url: string; botUsername: string; tipo: 'pratica' | 'microvoce' }> {
  const query = microvoceId ? `?microvoceId=${encodeURIComponent(microvoceId)}` : '';
  const res = await apiFetch(`${API_BASE}/progetti/${encodeURIComponent(progettoId)}/link-telegram${query}`, {
    headers: getAuthHeaders(),
  });
  if (!res.ok) throw new Error(await leggiErroreApi(res, 'Link Telegram non disponibile'));
  return await res.json();
}

/**
 * Spedisce l'invito al cliente. Il server registra la comunicazione in uscita nel fascicolo,
 * quindi questa non è una notifica di comodo: è un messaggio che entra nella storia della pratica.
 *
 * `microvoceId` fa spedire il link della voce **e lo stesso** che la scheda mostra: la scelta si fa
 * sul server per non rischiare che l'invito parta con un link diverso da quello sullo schermo.
 */
export async function inviaLinkTelegramApi(
  progettoId: string,
  canale: 'email' | 'whatsapp',
  microvoceId?: string,
): Promise<{ via: string; destinatario: string }> {
  const res = await apiFetch(`${API_BASE}/progetti/${encodeURIComponent(progettoId)}/link-telegram/invia`, {
    method: 'POST',
    headers: getAuthHeaders(),
    body: JSON.stringify(microvoceId ? { canale, microvoceId } : { canale }),
  });
  if (!res.ok) throw new Error(await leggiErroreApi(res, 'Invio del link non riuscito'));
  return await res.json();
}

export interface CollegamentoChat {
  id: string;
  canale: string;
  chatId: string;
  creatoAt: string;
  creatoDa: string;
}

/** Le chat agganciate a questa pratica: da qui si vedono (e si revocano) i collegamenti. */
export async function fetchCollegamentiChatApi(progettoId: string): Promise<CollegamentoChat[]> {
  const res = await apiFetch(`${API_BASE}/progetti/${encodeURIComponent(progettoId)}/collegamenti`, {
    headers: getAuthHeaders(),
  });
  if (!res.ok) throw new Error(await leggiErroreApi(res, 'Elenco dei collegamenti non disponibile'));
  const dati = await res.json();
  return Array.isArray(dati?.collegamenti) ? dati.collegamenti : [];
}

/** Revoca un collegamento: quella chat non scriverà più in questa pratica. */
export async function revocaCollegamentoChatApi(progettoId: string, collegamentoId: string): Promise<void> {
  const res = await apiFetch(
    `${API_BASE}/progetti/${encodeURIComponent(progettoId)}/collegamenti/${encodeURIComponent(collegamentoId)}`,
    { method: 'DELETE', headers: getAuthHeaders() },
  );
  if (!res.ok) throw new Error(await leggiErroreApi(res, 'Revoca non riuscita'));
}

// ── Micro-voci: abbinamento dei messaggi, e contesto armato di una chat ────────────────

/** Una micro-voce di questa pratica, piatta, con il modulo che la possiede. Per il selettore. */
export interface MicrovoceDellaPratica {
  id: string;
  nome: string;
  stato: string;
  moduloId: string;
  moduloNome: string;
}

export async function fetchMicrovociProgettoApi(progettoId: string): Promise<MicrovoceDellaPratica[]> {
  const res = await apiFetch(`${API_BASE}/progetti/${encodeURIComponent(progettoId)}/microvoci`, {
    headers: getAuthHeaders(),
  });
  if (!res.ok) throw new Error(await leggiErroreApi(res, 'Elenco delle micro-voci non disponibile'));
  const dati = await res.json();
  return Array.isArray(dati?.microvoci) ? dati.microvoci : [];
}

/**
 * Un abbinamento visto dal messaggio: quale micro-voce, il suo nome, e **perché** è lì.
 *
 * `origine` non è decorazione: `contesto` è un abbinamento che qualcuno ha dichiarato toccando un
 * link, `manuale` è l'operatore, `eredita` sarà una risposta a un messaggio già abbinato. Senza,
 * un abbinamento automatico sbagliato sarebbe indistinguibile da uno giusto — e non si saprebbe
 * quale correggere.
 */
export interface AbbinamentoMicrovoce {
  microvoceId: string;
  nome: string;
  origine: string;
}

/** Abbina a mano un messaggio a una micro-voce. 404 se l'uno o l'altra non sono di questa pratica. */
export async function abbinaComunicazioneMicrovoceApi(
  progettoId: string,
  messaggioId: string,
  microvoceProgettoId: string,
): Promise<void> {
  const res = await apiFetch(
    `${API_BASE}/progetti/${encodeURIComponent(progettoId)}/comunicazioni/${encodeURIComponent(messaggioId)}/microvoci`,
    { method: 'POST', headers: getAuthHeaders(), body: JSON.stringify({ microvoceProgettoId }) },
  );
  if (!res.ok) throw new Error(await leggiErroreApi(res, 'Abbinamento non riuscito'));
}

/** Toglie un abbinamento. `false` se non c'era: non è un errore, è il risultato voluto. */
export async function slegaComunicazioneMicrovoceApi(
  progettoId: string,
  messaggioId: string,
  microvoceId: string,
): Promise<boolean> {
  const res = await apiFetch(
    `${API_BASE}/progetti/${encodeURIComponent(progettoId)}/comunicazioni/${encodeURIComponent(messaggioId)}`
      + `/microvoci/${encodeURIComponent(microvoceId)}`,
    { method: 'DELETE', headers: getAuthHeaders() },
  );
  if (!res.ok) throw new Error(await leggiErroreApi(res, 'Rimozione dell\'abbinamento non riuscita'));
  return Boolean((await res.json())?.rimosso);
}

/** Un messaggio abbinato a una micro-voce, con l'origine dell'abbinamento e il suo recapito. */
export interface MessaggioDiMicrovoce {
  id: string;
  canale: string;
  mittente: string;
  destinatario: string;
  direzione: string;
  testo: string;
  createdAt: string;
  allegatiJson: string | null;
  origine: string;
  /**
   * Il recapito, proiettato dal server come nel fascicolo (`proiettaRecapito`).
   *
   * `null` significa «la riga non lo dichiara» — non è un campo da riempire con un ripiego: era il
   * ripiego `'consegnato'` a disegnare le spunte blu su messaggi che nessun canale aveva accettato.
   */
  stato: 'da-inviare' | 'inviato' | 'consegnato' | 'letto' | 'non-inviato' | null;
  inviatoAt: string | null;
  consegnatoAt: string | null;
  lettoAt: string | null;
  errore: string | null;
}

/** I messaggi abbinati a una micro-voce, dal più vecchio al più nuovo. */
export async function fetchComunicazioniMicrovoceApi(
  microvoceId: string,
): Promise<{ microvoce: { id: string; nome: string }; messaggi: MessaggioDiMicrovoce[] }> {
  const res = await apiFetch(`${API_BASE}/microvoci/${encodeURIComponent(microvoceId)}/comunicazioni`, {
    headers: getAuthHeaders(),
  });
  if (!res.ok) throw new Error(await leggiErroreApi(res, 'Messaggi della micro-voce non disponibili'));
  const dati = await res.json();
  return {
    microvoce: dati?.microvoce ?? { id: microvoceId, nome: '' },
    messaggi: Array.isArray(dati?.messaggi) ? dati.messaggi : [],
  };
}

/**
 * Una conversazione che ha lasciato messaggi in questa pratica, e il contesto che ha addosso.
 *
 * L'elenco non è dei «collegamenti»: quello è solo Telegram. Qui c'è qualunque chat che abbia scritto
 * nel fascicolo — WhatsApp e Signal compresi — perché è da qui che l'operatore sceglie dove armare
 * una micro-voce, e per armarla deve poterla nominare.
 */
export interface ChatDellaPratica {
  canale: string;
  chatId: string;
  /**
   * Come si legge la conversazione, quando l'identificativo da solo non basta.
   *
   * Sul **portale** il `chatId` è l'id del cliente: mostrarlo tale e quale metterebbe un uuid
   * davanti all'operatore proprio quando deve scegliere dove armare il contesto. Sugli altri canali
   * è `null`, e l'identificativo — un numero, un id di chat — è già la cosa leggibile.
   */
  nome: string | null;
  ultimoMessaggioAt: string;
  messaggi: number;
  contesto: {
    id: string;
    armatoDa: string;
    armatoAt: string;
    scadeAt: string | null;
    microvoce: { id: string; nome: string };
  } | null;
}

export async function fetchChatProgettoApi(progettoId: string): Promise<ChatDellaPratica[]> {
  const res = await apiFetch(`${API_BASE}/progetti/${encodeURIComponent(progettoId)}/chat`, {
    headers: getAuthHeaders(),
  });
  if (!res.ok) throw new Error(await leggiErroreApi(res, 'Elenco delle chat non disponibile'));
  const dati = await res.json();
  return Array.isArray(dati?.chat) ? dati.chat : [];
}

/**
 * Arma il contesto di una chat: da qui in poi i suoi messaggi si abbinano a questa micro-voce.
 *
 * È la stessa cosa che fa il cliente toccando il link della voce. Esiste perché WhatsApp e Signal
 * non hanno un link: lì l'unico che può dire «si sta parlando di questa voce» è l'operatore.
 */
export async function armaContestoMicrovoceApi(
  progettoId: string,
  canale: string,
  chatId: string,
  microvoceId: string,
): Promise<{ microvoce: { id: string; nome: string }; scadeAt: string }> {
  const res = await apiFetch(`${API_BASE}/progetti/${encodeURIComponent(progettoId)}/contesti-microvoce`, {
    method: 'POST',
    headers: getAuthHeaders(),
    body: JSON.stringify({ canale, chatId, microvoceId }),
  });
  if (!res.ok) throw new Error(await leggiErroreApi(res, 'Armamento del contesto non riuscito'));
  return await res.json();
}

/** Disarma il contesto di una chat. `false` se non ce n'era uno — non è un errore. */
export async function disarmaContestoMicrovoceApi(
  progettoId: string,
  canale: string,
  chatId: string,
): Promise<boolean> {
  const query = `?canale=${encodeURIComponent(canale)}&chatId=${encodeURIComponent(chatId)}`;
  const res = await apiFetch(`${API_BASE}/progetti/${encodeURIComponent(progettoId)}/contesti-microvoce${query}`, {
    method: 'DELETE',
    headers: getAuthHeaders(),
  });
  if (!res.ok) throw new Error(await leggiErroreApi(res, 'Disarmo del contesto non riuscito'));
  return Boolean((await res.json())?.disarmato);
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
  invalidateCache('progett');
  return await resAccetta.json();
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
  invalidateCache('progett');
  return await res.json();
}

/**
 * Condivide una micro-voce con altri moduli del progetto (regola: una voce che vale per due
 * moduli si esegue una volta e conta per entrambi). `moduliCondivisi` è l'elenco COMPLETO dei
 * moduli addizionali (sostituisce l'insieme). 409 se il modulo di destinazione ha già una voce
 * con lo stesso nome — il messaggio del server arriva a chi ha premuto.
 */
export async function impostaCondivisioneMicrovoceApi(progettoId: string, microvoceId: string, moduliCondivisi: string[]) {
  const res = await apiFetch(
    `${API_BASE}/progetti/${encodeURIComponent(progettoId)}/microvoci/${encodeURIComponent(microvoceId)}/condivisione`,
    { method: 'POST', headers: getAuthHeaders(), body: JSON.stringify({ moduliCondivisi }) },
  );
  if (!res.ok) throw new Error(await leggiErroreApi(res, 'Condivisione micro-voce non riuscita'));
  invalidateCache('progett');
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
  invalidateCache('progett');
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
  invalidateCache('progett');
  return await res.json();
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
  if (!res.ok) {
    // §1ter.6 (C1) — il motivo del server, non un messaggio generico.
    //
    // Prima qui c'era solo `throw new Error('Errore assegnazione accesso')`, e non
    // importava: il chiamante avvolgeva la promessa in `.catch(() => {})`, quindi quel
    // messaggio non lo leggeva nessuno. Ora arriva fino al modale, che è il posto dove
    // serve capire **perché** l'assegnazione non è riuscita — utente di un altro studio,
    // progetto inesistente, sessione scaduta. Un «non riuscito» senza motivo riporta
    // l'utente allo stesso punto di prima: sa che non ha funzionato e non sa cosa fare.
    const dettaglio = await res.json().catch(() => null);
    throw new Error(dettaglio?.errore || `Assegnazione accesso non riuscita (HTTP ${res.status}).`);
  }
  return await res.json();
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

export async function inviaComunicazioneApi(progettoId: string, input: { canale: string; mittente: string; destinatario: string; direzione: string; testo: string; allegatiJson?: any; microvoceProgettoId?: string }) {
  // §3.3 — una comunicazione nel fascicolo cliente è un invio reale: se non viene persistita
  // il messaggio non esiste. L'errore si propaga (i chiamanti fire-and-forget lo catturano).
  const res = await apiFetch(`${API_BASE}/progetti/${progettoId}/comunicazioni`, {
    method: 'POST',
    headers: getAuthHeaders(),
    body: JSON.stringify(input),
  });
  if (!res.ok) throw new Error(await leggiErroreApi(res, 'Errore invio comunicazione'));
  return await res.json();
}

export async function segnaComunicazioniLetteApi(progettoId: string, direzioneDaSegnare: 'entrata' | 'uscita') {
  try {
    const res = await apiFetch(`${API_BASE}/progetti/${progettoId}/comunicazioni/segna-lette`, {
      method: 'PATCH',
      headers: getAuthHeaders(),
      body: JSON.stringify({ direzioneDaSegnare }),
    });
    if (!res.ok) return null;
    return await res.json();
  } catch (err) {
    console.warn('Errore segna comunicazioni lette:', err);
    return null;
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
  // §3.3 — lo stato di una voce di checklist (compliance UBO/adempimenti) è un dato
  // legale: se il toggle non viene persistito l'errore si propaga, nessun null silenzioso.
  const res = await apiFetch(`${API_BASE}/checklist/${id}/toggle`, {
    method: 'PATCH',
    headers: getAuthHeaders(),
  });
  if (!res.ok) throw new Error(await leggiErroreApi(res, 'Errore aggiornamento checklist'));
  return await res.json();
}
