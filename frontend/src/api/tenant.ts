import { getTenantStorageKey, getCurrentTenantId, getStudioInfoForTenant, BLUECODE_TENANT_ID, senzaSegretiTenant } from '../utils/tenant';
import { API_BASE, apiFetch, getAuthHeaders, leggiErroreApi } from './http';
import { queryPaginazione, type ParametriListaPaginata } from './paginazione';
import { cachedQuery, invalidateCache } from './cache';

// DEFAULT_TEAM_USERS è il seed del Tenant Demo Bluecode, e vale **solo** quando il server non
// risponde affatto (rete giù, errore, risposta non riconoscibile). Non è la risposta a «questo
// studio non ha ancora collaboratori»: quella è un elenco vuoto, e va mostrata vuota.
export const DEFAULT_TEAM_USERS = [
  { id: 'usr-01', nome: 'Joe Disabato', email: 'joe@bluecode.advisory', ruolo: 'super_admin', specializzazione: 'Lead Advisor & Strategia', tenantId: '00000000-0000-0000-0000-000000000001' },
  { id: 'usr-02', nome: 'Avv. Lorenzo Marino', email: 'lorenzo.marino@bluecode.advisory', ruolo: 'advisor', specializzazione: 'Legal Counsel — Diritto Societario, Contrattualistica & IP', tenantId: '00000000-0000-0000-0000-000000000001' },
  { id: 'usr-03', nome: 'Dr. Elena Russo', email: 'elena.russo@bluecode.advisory', ruolo: 'advisor', specializzazione: 'Tax Advisor — Fiscalità Internazionale & Holding', tenantId: '00000000-0000-0000-0000-000000000001' },
  { id: 'usr-04', nome: 'Francesca Disabato', email: 'francesca@bluecode.advisory', ruolo: 'operator', specializzazione: 'Back Office & Compliance KYC/AML', tenantId: '00000000-0000-0000-0000-000000000001' },
  { id: 'usr-05', nome: 'Avv. Mario Dibenedetto', email: 'mario.dibenedetto@bluecode.advisory', ruolo: 'advisor', specializzazione: 'Legal Counsel — Diritto Societario, Contrattualistica & Trust', tenantId: '00000000-0000-0000-0000-000000000001' },
];

export async function fetchUtentiTenant(options?: { forceRefresh?: boolean }) {
  const currentTenantId = getCurrentTenantId();
  return cachedQuery(
    `team_utenti_${currentTenantId}`,
    async () => {
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
          // §7 — qui c'era `&& dbUsers.length > 0`: un elenco **vuoto** dal database non veniva
          // creduto e si scendeva al ripiego, che per il tenant Bluecode è `DEFAULT_TEAM_USERS`,
          // cioè cinque persone che non esistono. Era la stessa guardia mancante di
          // `QuickTimeTracker`: l'assenza di *righe* scambiata per assenza di *risposta*. Un
          // database che risponde «nessun collaboratore» ha risposto, e va creduto — anche
          // quando la risposta è zero. Il seed resta vivo solo se il server non ha risposto.
          if (Array.isArray(dbUsers)) {
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
    },
    { ttlMs: 60_000, forceRefresh: options?.forceRefresh }
  );
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
  // al ruolo (§2bis) e genera la password temporanea. Se la chiamata fallisce (rete giù o
  // rifiuto del server) l'utente NON è stato creato: si propaga l'errore reale invece di
  // restituire un finto `{ok:true}` che faceva mostrare in lista un collaboratore mai
  // salvato e gli spediva pure l'email di invito.
  const res = await apiFetch(`${API_BASE}/tenant/utenti`, {
    method: 'POST',
    headers: getAuthHeaders(),
    body: JSON.stringify({ ...input, tenantId: currentTenantId }),
  });
  if (!res.ok) {
    throw new Error(await leggiErroreApi(res, 'Creazione collaboratore rifiutata dal server'));
  }
  const creato = await res.json();

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

  // 3. L'email di benvenuto la spedisce il backend, nella stessa richiesta che ha creato
  // l'utente: `invitoInviato` e `invitoErrore` nella risposta dicono com'è andata. Prima la
  // spediva questa funzione, rigirando la password appena generata alla funzione serverless
  // pubblica insieme alla password SMTP dello studio letta da `localStorage` — e se
  // l'operatore chiudeva la schermata l'invito non partiva, con l'utente già creato.

  invalidateCache('team_utenti');
  return creato;
}

/**
 * Archivia un operatore che non lavora più nello studio (§2bis).
 *
 * Non è una cancellazione: il backend chiude il periodo di collaborazione — con il giorno in
 * cui la persona ha smesso — e spegne l'utenza. La persona resta, i progetti a cui ha lavorato
 * restano, e se un giorno rientra si riapre un periodo nuovo senza perdere il precedente.
 *
 * `dataFine` è precompilata a oggi dalla schermata ma resta modificabile: serve a registrare
 * il giorno vero in cui la collaborazione è finita, che non è per forza quello in cui
 * qualcuno si ricorda di archiviare.
 */
export async function archiviaUtenteTenantApi(
  userId: string,
  opzioni?: { dataFine?: string; motivo?: string },
) {
  const res = await apiFetch(`${API_BASE}/tenant/utenti/${userId}/disattiva`, {
    method: 'POST',
    headers: { ...getAuthHeaders(), 'Content-Type': 'application/json' },
    body: JSON.stringify({ dataFine: opzioni?.dataFine, motivo: opzioni?.motivo }),
  });
  if (!res.ok) {
    throw new Error(await leggiErroreApi(res, 'Archiviazione non riuscita'));
  }
  // La lista del team è in cache: senza invalidarla, l'archiviato resterebbe in elenco fino
  // al prossimo refresh e sembrerebbe che il pulsante non abbia fatto niente.
  invalidateCache('team_utenti');
  return await res.json() as { ok: boolean; id: string; nome: string; dataFine: string; messaggio: string };
}

/** Riporta in forza un operatore archiviato: apre un **nuovo** periodo, il vecchio resta. */
export async function riattivaUtenteTenantApi(userId: string, opzioni?: { dataInizio?: string }) {
  const res = await apiFetch(`${API_BASE}/tenant/utenti/${userId}/riattiva`, {
    method: 'POST',
    headers: { ...getAuthHeaders(), 'Content-Type': 'application/json' },
    body: JSON.stringify({ dataInizio: opzioni?.dataInizio }),
  });
  if (!res.ok) {
    throw new Error(await leggiErroreApi(res, 'Riattivazione non riuscita'));
  }
  invalidateCache('team_utenti');
  return await res.json() as { ok: boolean; id: string; nome: string; dataInizio: string; messaggio: string };
}

// `sendInviteCollaboratoreApi` è stata rimossa: costruiva le credenziali SMTP dello studio
// leggendole da `localStorage` e le spediva alla funzione serverless pubblica insieme alla
// password temporanea del nuovo collaboratore. L'invito lo manda `POST /tenant/utenti`, che è
// la rotta che genera quella password (vedi `sendInvitoCollaboratoreEmail` nel backend).

export async function testEmailApi(payload?: {
  smtpHost?: string;
  /** Nome che il certificato deve attestare, se diverso dall'host. Vuoto: si verifica l'host. */
  smtpServername?: string;
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
  // Un test SMTP onesto deve avere il tempo di fallire: aprire la connessione, fare
  // l'handshake TLS, autenticarsi e spedire richiede più di 4,5 secondi su una rete lenta,
  // e il vecchio timeout scadeva prima di conoscere l'esito. Venti secondi coprono anche il
  // caso in cui il server prova più porte in sequenza.
  //
  // La funzione serverless `/api/send-email` non viene più interrogata per prima: accettava le
  // credenziali dal corpo senza autenticazione e ripiegava su quelle dell'ambiente, quindi
  // rispondeva «riuscito» anche quando le impostazioni provate erano vuote — cioè il test
  // passava e poi l'invio reale non partiva. Il backend prova le credenziali che gli passi e,
  // se il corpo è vuoto, quelle salvate sulla riga dello studio.
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 20000);
  try {
    const res = await apiFetch(`${API_BASE}/tenant/test-email`, {
      method: 'POST',
      headers: getAuthHeaders(),
      body: JSON.stringify(payload || {}),
      signal: controller.signal,
    });
    const json = await res.json().catch(() => null);
    if (json) return json;
    return { success: false, errore: `Il server ha risposto ${res.status} senza contenuto leggibile.` };
  } catch (err: any) {
    // Un test che non ha potuto girare va detto: qui prima si restituiva un `success: true`
    // con il messaggio «Connessione SMTP testata», identico con la configurazione giusta e
    // con quella sbagliata.
    return {
      success: false,
      errore: `Test non eseguito: ${err?.name === 'AbortError' ? 'nessuna risposta entro 20 secondi' : err?.message || 'il server non ha risposto'}.`,
    };
  } finally {
    clearTimeout(timer);
  }
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
  // §3.3 — prima il `catch` scriveva solo in localStorage e restituiva `input`: lo studio
  // leggeva «salvato» mentre l'anagrafica su Supabase restava quella vecchia (sedi, IBAN,
  // firma fatture). La cache locale si aggiorna solo DOPO la conferma del server.
  const currentTenantId = tenantIdParam || getCurrentTenantId();
  const res = await apiFetch(`${API_BASE}/tenant/info`, {
    method: 'PATCH',
    headers: {
      ...getAuthHeaders(),
      'x-tenant-id': currentTenantId,
    },
    body: JSON.stringify(input),
  });
  if (!res.ok) throw new Error(await leggiErroreApi(res, 'Errore aggiornamento info tenant'));
  const data = await res.json();
  // §35 — `input` può contenere la password SMTP appena digitata: in localStorage non ci va
  // (regola 6). La cache locale tiene solo l'anagrafica e i flag `<chiave>Impostata`.
  localStorage.setItem(
    getTenantStorageKey('bluman_tenant_info', currentTenantId),
    JSON.stringify(senzaSegretiTenant({ ...input, ...data })),
  );
  return data;
}

/**
 * Un campo dell'anagrafica senza il quale lo studio non può comporre un documento fiscale.
 *
 * La forma è quella che il backend restituisce da `src/domain/anagraficaStudio.ts`, e i campi
 * sono i suoi: `etichetta` è la stessa che l'operatore legge in Impostazioni → Anagrafica, `dove`
 * dice in quale punto del documento il valore finisce, `senza` dice cosa l'app scriveva al suo
 * posto finché poteva inventare. Non si duplica la lista nel frontend: chi la possiede è il
 * backend, perché è la stessa che il controllo prima dell'XML SDI usa per rifiutare — e due copie
 * divergono (la lezione di `canaliCoerenza`).
 */
export interface CampoAnagrafica {
  chiave: string;
  etichetta: string;
  dove: string;
  senza: string;
}

export interface StatoAnagraficaStudio {
  /** Il server ha risposto: si sa qualcosa. Falso quando non si è potuto guardare. */
  letto: boolean;
  /** Nessun campo manca. Vero solo se `letto` è vero. */
  completa: boolean;
  mancanti: CampoAnagrafica[];
}

/**
 * I dati obbligatori dello studio, letti dal server.
 *
 * §7 — `letto: false` significa «non ho potuto guardare» (rete giù, server che risponde male,
 * risposta non riconoscibile), ed è cosa diversa da «mancano dei campi»: senza questa distinzione
 * la guida direbbe «la tua anagrafica è incompleta» a uno studio che non ha nessun problema,
 * soltanto perché il backend era irraggiungibile. Chi legge la guida, con `letto: false`, non la
 * mostra.
 *
 * Nessun ripiego su `localStorage`, che pure è dove l'anagrafica viene messa in cache: là c'è
 * **ciò che il server ha detto l'ultima volta**, e una guida costruita su quella copia direbbe
 * «manca la P.IVA» a chi l'ha appena salvata — cioè l'errore opposto a quello che serve.
 */
export async function fetchAnagraficaStudioApi(): Promise<StatoAnagraficaStudio> {
  const nonLetto: StatoAnagraficaStudio = { letto: false, completa: false, mancanti: [] };
  try {
    const res = await apiFetch(`${API_BASE}/tenant/anagrafica`, { headers: getAuthHeaders() });
    if (!res.ok) return nonLetto;
    const dati = await res.json().catch(() => null);
    // Una risposta che non ha la forma attesa non è una risposta: vale come «non ho potuto
    // guardare». In particolare `completa: true` senza `letto` non deve mai passare per un
    // «è tutto a posto» che nessuno ha verificato.
    if (!dati || typeof dati.letto !== 'boolean' || !Array.isArray(dati.mancanti)) return nonLetto;
    return {
      letto: dati.letto,
      completa: dati.letto && dati.completa === true,
      mancanti: dati.mancanti as CampoAnagrafica[],
    };
  } catch {
    return nonLetto;
  }
}

export async function fetchAuditLogsApi(parametri?: ParametriListaPaginata) {
  try {
    const res = await apiFetch(`${API_BASE}/audit-logs${queryPaginazione(parametri)}`, { headers: getAuthHeaders() });
    if (!res.ok) throw new Error(await leggiErroreApi(res, 'Errore recupero audit logs'));
    return await res.json();
  } catch (err) {
    if (parametri) throw err;
    console.warn('Backend API offline', err);
    return null;
  }
}

export async function createAuditLogApi(input: { azione: string; entita: string; dettagli: string }) {
  // §3.3 — nessun fallback silenzioso: se la scrittura del log fallisce l'errore si propaga.
  const res = await apiFetch(`${API_BASE}/audit-logs`, {
    method: 'POST',
    headers: getAuthHeaders(),
    body: JSON.stringify(input),
  });
  if (!res.ok) throw new Error(await leggiErroreApi(res, 'Errore creazione audit log'));
  return await res.json();
}

export async function testImapApi(payload: {
  imapHost?: string;
  /** Nome che il certificato deve attestare, se diverso dall'host. Vuoto: si verifica l'host. */
  imapServername?: string;
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

export async function testChannelApi(payload: {
  channel: string;
  waPhoneId?: string;
  waAccessToken?: string;
  tgBotToken?: string;
  /** Signal: indirizzo del demone, token del proxy e numero registrato sopra (il mittente). */
  signalEndpoint?: string;
  signalToken?: string;
  signalNumber?: string;
}) {
  const res = await apiFetch(`${API_BASE}/tenant/test-channel`, {
    method: 'POST',
    headers: getAuthHeaders(),
    body: JSON.stringify(payload),
  });
  return await res.json();
}

/**
 * Rotazione del path di callback WhatsApp dello studio.
 *
 * Il discriminante nel path è l'unica cosa che separa il webhook di uno studio da quello di un
 * altro: se finisce in un log o in una pagina condivisa, deve poter essere cambiato senza
 * aspettare che qualcuno apra il database. Il server esige `conferma: true` perché la rotazione
 * **interrompe** la ricezione finché la Callback URL non viene aggiornata in Meta: chi la chiede
 * dal pulsante ha già letto l'avviso, e un pulsante premuto per sbaglio non deve poter spegnere
 * il canale in silenzio.
 */
export async function rigeneraSlugWhatsappApi(): Promise<{ ok: boolean; waCallbackUrl?: string | null; errore?: string }> {
  try {
    const res = await apiFetch(`${API_BASE}/tenant/whatsapp-slug`, {
      method: 'POST',
      headers: {
        ...getAuthHeaders(),
        'x-tenant-id': getCurrentTenantId(),
      },
      body: JSON.stringify({ conferma: true }),
    });
    const dati = await res.json().catch(() => null);
    if (!res.ok) {
      return { ok: false, errore: dati?.errore || `Il server ha risposto ${res.status} senza spiegare il motivo.` };
    }
    return { ok: true, waCallbackUrl: dati?.waCallbackUrl ?? null };
  } catch (err: any) {
    return { ok: false, errore: err?.message || 'Backend non raggiungibile.' };
  }
}

/**
 * Registra il webhook Telegram dello studio presso i server di Telegram.
 *
 * La rotta server-side legge il bot token salvato: il browser non lo conosce mai dopo
 * il salvataggio (regola 6). Il chiamante non deve passare nessun token.
 *
 * `botUsername` e `usernameCorretto` tornano perché la rotta **corregge** in colonna lo username
 * quando non è quello che risponde `getMe` con questo token (era il guasto del 16/09/2026: l'id
 * numerico del bot nel campo «Bot Username», e un link che apriva «questo utente non esiste»). Il
 * campo di modulo nella pagina tiene ancora il valore vecchio: chi chiama questa funzione deve
 * riportarlo nello stato, altrimenti il primo «Salva» di un altro canale riscrive il valore
 * sbagliato e disfa la correzione.
 */
export async function registraWebhookTelegramApi(): Promise<{
  ok: boolean;
  messaggio?: string;
  errore?: string;
  botUsername?: string;
  usernameCorretto?: boolean;
}> {
  try {
    const res = await apiFetch(`${API_BASE}/tenant/telegram-webhook-setup`, {
      method: 'POST',
      headers: getAuthHeaders(),
      body: JSON.stringify({}),
    });
    const dati = await res.json().catch(() => null);
    if (!res.ok) {
      return { ok: false, errore: dati?.errore || `Il server ha risposto ${res.status}.` };
    }
    return {
      ok: true,
      messaggio: dati?.message || 'Webhook registrato.',
      botUsername: typeof dati?.botUsername === 'string' ? dati.botUsername : undefined,
      usernameCorretto: dati?.usernameCorretto === true,
    };
  } catch (err: any) {
    return { ok: false, errore: err?.message || 'Backend non raggiungibile.' };
  }
}

export interface WebhookInfoTelegram {
  webhookUrl: string;
  pendingUpdateCount: number;
  lastErrorDate: number | null;
  lastErrorMessage: string | null;
  maxConnections: number | null;
  allowedUpdates: string[];
}

/**
 * Legge lo stato del webhook Telegram direttamente da Telegram (getWebhookInfo).
 *
 * È la prova vera che la ricezione funziona: mostra URL registrato, messaggi in coda
 * e l'ultimo errore di consegna. `testChannelApi` con channel='telegram' chiama solo
 * getMe e non dice nulla sulla ricezione.
 */
export async function fetchWebhookInfoTelegramApi(): Promise<{ ok: boolean; info?: WebhookInfoTelegram; errore?: string }> {
  try {
    const res = await apiFetch(`${API_BASE}/tenant/telegram-webhook-info`, {
      headers: getAuthHeaders(),
    });
    const dati = await res.json().catch(() => null);
    if (!res.ok) {
      return { ok: false, errore: dati?.errore || `Il server ha risposto ${res.status}.` };
    }
    return { ok: true, info: dati as WebhookInfoTelegram };
  } catch (err: any) {
    return { ok: false, errore: err?.message || 'Backend non raggiungibile.' };
  }
}

/**
 * Messaggio WhatsApp al cliente, spedito dal backend con il numero dello studio.
 *
 * Prima chiamava `POST /api/send-whatsapp`: una funzione senza autenticazione, con
 * `Access-Control-Allow-Origin: *`, che prendeva Phone ID e access token dalle variabili
 * d'ambiente — quindi un unico numero per tutti gli studi — e rispondeva `success: true`
 * anche quando il ripiego su `hello_world` falliva. Ora la consegna la fa
 * `POST /comunicazioni/invia-whatsapp`, che legge le credenziali della riga Tenant.
 */
export async function sendWhatsAppDirectApi(
  to: string,
  text: string,
  templateName?: string,
  comunicazioneId?: string,
) {
  try {
    const res = await apiFetch(`${API_BASE}/comunicazioni/invia-whatsapp`, {
      method: 'POST',
      headers: getAuthHeaders(),
      body: JSON.stringify({ to, testo: text, template: templateName, comunicazioneId }),
    });
    const data = await res.json().catch(() => null);
    if (res.ok && data?.ok) return { success: true, via: data.via };
    return {
      success: false,
      errore: data?.errore || `Il server ha risposto ${res.status} senza spiegare il motivo.`,
    };
  } catch (err: any) {
    return { success: false, errore: err?.message || 'Backend non raggiungibile.' };
  }
}

/**
 * Email al cliente, spedita dal backend con le credenziali dello studio.
 *
 * Prima questa funzione costruiva host, utenza e **password SMTP** leggendoli da
 * `localStorage` e li spediva alla funzione serverless pubblica. Su un browser dove quella
 * chiave era vuota — un altro computer, una cache pulita — partiva un invio senza password che
 * non arrivava a nessuno. Le credenziali ora non lasciano il server.
 */
export async function sendEmailDirectApi(
  to: string,
  subject: string,
  text: string,
  html?: string,
  comunicazioneId?: string,
) {
  try {
    // Venti secondi: un invio SMTP che deve provare più porte non sta dentro i sei di prima,
    // e il timeout scaduto veniva mostrato come errore di invio anche quando l'email partiva.
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 20000);
    const res = await apiFetch(`${API_BASE}/comunicazioni/invia-email`, {
      method: 'POST',
      headers: getAuthHeaders(),
      body: JSON.stringify({ to, subject, testo: text, html, comunicazioneId }),
      signal: controller.signal,
    });
    clearTimeout(timer);
    const data = await res.json().catch(() => null);
    if (res.ok && data?.ok) return { success: true, via: data.via };
    return {
      success: false,
      errore: data?.errore || `Il server ha risposto ${res.status} senza spiegare il motivo.`,
    };
  } catch (err: any) {
    return {
      success: false,
      errore: err?.name === 'AbortError' ? 'Nessuna risposta entro 20 secondi dal server di posta.' : err?.message || 'Backend non raggiungibile.',
    };
  }
}

/**
 * Ultimi messaggi arrivati nella casella dello studio, letti dal backend.
 *
 * Restituisce `{ ok, email, errore }` e non più un semplice elenco: la vecchia versione
 * rispondeva `[]` a qualunque guasto, così «il cliente non ha risposto» e «la casella non è
 * configurata» erano indistinguibili nel fascicolo (regola 7). La password IMAP non passa più
 * dal browser.
 */
export async function fetchInboundImapEmailsApi(
  clientEmail?: string,
): Promise<{ ok: boolean; email: any[]; errore?: string }> {
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 25000);
    const res = await apiFetch(`${API_BASE}/comunicazioni/email-in-arrivo`, {
      method: 'POST',
      headers: getAuthHeaders(),
      body: JSON.stringify({ clientEmail: clientEmail || '' }),
      signal: controller.signal,
    });
    clearTimeout(timer);
    const data = await res.json().catch(() => null);
    if (res.ok && data?.ok && Array.isArray(data.email)) {
      return { ok: true, email: data.email };
    }
    return {
      ok: false,
      email: [],
      errore: data?.errore || `Il server ha risposto ${res.status} senza spiegare il motivo.`,
    };
  } catch (err: any) {
    return {
      ok: false,
      email: [],
      errore: err?.name === 'AbortError' ? 'Nessuna risposta entro 25 secondi dalla casella in arrivo.' : err?.message || 'Backend non raggiungibile.',
    };
  }
}

/**
 * Legge le ultime email con allegati dalla casella dello studio via IMAP e restituisce gli allegati caricati su storage.
 */
export async function fetchInboundImapAllegatiApi(
  clientEmail?: string,
): Promise<{ ok: boolean; email: any[]; errore?: string }> {
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 60000);
    const res = await apiFetch(`${API_BASE}/comunicazioni/poll-imap-allegati`, {
      method: 'POST',
      headers: getAuthHeaders(),
      body: JSON.stringify({ clientEmail: clientEmail || '' }),
      signal: controller.signal,
    });
    clearTimeout(timer);
    const data = await res.json().catch(() => null);
    if (res.ok && data?.ok && Array.isArray(data.email)) {
      return { ok: true, email: data.email };
    }
    return {
      ok: false,
      email: [],
      errore: data?.errore || `Il server ha risposto ${res.status} senza spiegare il motivo.`,
    };
  } catch (err: any) {
    return {
      ok: false,
      email: [],
      errore: err?.name === 'AbortError' ? 'Timeout sincronizzazione allegati IMAP.' : err?.message || 'Backend non raggiungibile.',
    };
  }
}

/**
 * Messaggio Signal al cliente, spedito dal demone dello studio.
 *
 * Questa funzione non esisteva, e la chat del fascicolo ne faceva a meno: Signal era una voce
 * dell'elenco dei canali e, scegliendola, il messaggio veniva registrato nel fascicolo con un
 * riscontro verde — «notificato via SIGNAL» — senza che nessuno contattasse un demone. Il
 * cliente non riceveva niente. Ora l'invio o avviene, o risponde con il motivo del rifiuto.
 *
 * Il recapito deve essere già in forma internazionale (`+39335…`): il backend lo rifiuta
 * altrimenti, invece di indovinare il paese e spedire a un estraneo.
 */
export async function sendSignalDirectApi(
  to: string,
  text: string,
  allegati?: Array<{ nome: string; base64: string }>,
  comunicazioneId?: string,
) {
  try {
    const controller = new AbortController();
    // Più lungo degli altri canali: il corpo può portare un allegato, e il demone dello studio
    // è un servizio che qualcuno ospita e sorveglia, non l'infrastruttura di Meta.
    const timer = setTimeout(() => controller.abort(), 45000);
    const res = await apiFetch(`${API_BASE}/comunicazioni/invia-signal`, {
      method: 'POST',
      headers: getAuthHeaders(),
      body: JSON.stringify({ to, testo: text, ...(allegati && allegati.length > 0 ? { allegati } : {}), comunicazioneId }),
      signal: controller.signal,
    });
    clearTimeout(timer);
    const data = await res.json().catch(() => null);
    if (res.ok && data?.ok) return { success: true, via: data.via };
    return {
      success: false,
      errore: data?.errore || `Il server ha risposto ${res.status} senza spiegare il motivo.`,
    };
  } catch (err: any) {
    return {
      success: false,
      errore:
        err?.name === 'AbortError'
          ? 'Nessuna risposta entro 45 secondi dal demone Signal dello studio.'
          : err?.message || 'Backend non raggiungibile.',
    };
  }
}

/**
 * Messaggio Telegram al cliente, spedito col bot dello studio.
 *
 * Come per Signal, questa funzione non esisteva e la chat del fascicolo ci suppliva con un
 * riscontro verde: «notificato via TELEGRAM al cliente» senza che partisse niente. La chiamata
 * viveva privata dentro il servizio OTP, quindi la rotta delle comunicazioni non poteva usarla.
 *
 * Il destinatario è l'identificativo numerico della chat (`telegramChatId` in anagrafica), non
 * uno `@username`: Telegram accetta il nome solo per i canali pubblici.
 */
export async function sendTelegramDirectApi(to: string, text: string, comunicazioneId?: string) {
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 25000);
    const res = await apiFetch(`${API_BASE}/comunicazioni/invia-telegram`, {
      method: 'POST',
      headers: getAuthHeaders(),
      body: JSON.stringify({ to, testo: text, comunicazioneId }),
      signal: controller.signal,
    });
    clearTimeout(timer);
    const data = await res.json().catch(() => null);
    if (res.ok && data?.ok) return { success: true, via: data.via };
    return {
      success: false,
      errore: data?.errore || `Il server ha risposto ${res.status} senza spiegare il motivo.`,
    };
  } catch (err: any) {
    return {
      success: false,
      errore:
        err?.name === 'AbortError'
          ? 'Nessuna risposta entro 25 secondi da Telegram.'
          : err?.message || 'Backend non raggiungibile.',
    };
  }
}

/**
 * Preleva i messaggi Signal arrivati al demone dello studio.
 *
 * La lettura sul demone è distruttiva — i messaggi escono dalla sua coda — quindi va chiamata
 * quando l'operatore apre il fascicolo o preme «Sincronizza», non a intervalli: due schede
 * aperte sullo stesso fascicolo non si rubano i messaggi solo perché la prima scrittura vince.
 *
 * `ok: false` con il motivo quando Signal non è configurato: «non configurato» e «il cliente
 * non ha scritto» sono due cose diverse, e mostrarle uguali è l'errore che teneva nascosto il
 * guasto del canale email.
 */
export async function fetchSignalInArrivoApi(): Promise<{
  ok: boolean;
  letti: number;
  registrati: number;
  scartati: number;
  errore?: string;
}> {
  const vuoto = { letti: 0, registrati: 0, scartati: 0 };
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 30000);
    const res = await apiFetch(`${API_BASE}/comunicazioni/signal-in-arrivo`, {
      method: 'POST',
      headers: getAuthHeaders(),
      signal: controller.signal,
    });
    clearTimeout(timer);
    const data = await res.json().catch(() => null);
    if (res.ok && data?.ok) {
      return { ok: true, letti: data.letti ?? 0, registrati: data.registrati ?? 0, scartati: data.scartati ?? 0 };
    }
    return { ...vuoto, ok: false, errore: data?.errore || `Il server ha risposto ${res.status} senza spiegare il motivo.` };
  } catch (err: any) {
    return {
      ...vuoto,
      ok: false,
      errore:
        err?.name === 'AbortError'
          ? 'Nessuna risposta entro 30 secondi dal demone Signal dello studio.'
          : err?.message || 'Backend non raggiungibile.',
    };
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
  // §3.3 — la matrice RBAC decide quali moduli un collaboratore può aprire: un salvataggio
  // non riuscito restituito come `{ ok: true }` lasciava attivi permessi che l'admin credeva
  // revocati. L'errore si propaga e la schermata lo mostra.
  const res = await apiFetch(`${API_BASE}/tenant/utenti/${userId}/permessi`, {
    method: 'PUT',
    headers: getAuthHeaders(),
    body: JSON.stringify({ permessi }),
  });
  if (!res.ok) throw new Error(await leggiErroreApi(res, 'Errore aggiornamento permessi utente'));
  return await res.json();
}

export async function triggerCronScadenzeApi() {
  // §3.3 — qui il fallback era il più pericoloso dei report finti: dichiarava
  // "3 notifiche elaborate: 2 UBO Malta, 1 Scadenza Incasso" senza che alcuna
  // scansione fosse avvenuta. Notifiche scadenzate MAI inviate sembravano partite.
  const res = await apiFetch(`${API_BASE}/cron/esegui-notifiche-scadenze`, {
    method: 'POST',
    headers: getAuthHeaders(),
  });
  if (!res.ok) throw new Error(await leggiErroreApi(res, 'Errore esecuzione scansione cron'));
  return await res.json();
}

/**
 * Elenco degli studi della piattaforma, per il super admin.
 *
 * §7 — qui c'era un ripiego silenzioso sulla copia in localStorage: se il server non rispondeva,
 * la funzione restituiva la lista salvata e **chi la chiamava non poteva distinguerla da una
 * risposta vera**. Con l'API giù, gli studi cancellati dal database restavano in elenco con i
 * loro pulsanti di modifica ed eliminazione, come se esistessero ancora. Ora l'errore si
 * propaga: chi legge decide cosa dire all'operatore (vedi `SuperAdminPage`).
 */
export async function fetchAdminTenantsApi() {
  const res = await apiFetch(`${API_BASE}/admin/tenants`, { headers: getAuthHeaders() });
  if (!res.ok) throw new Error(await leggiErroreApi(res, 'Elenco studi non disponibile'));
  return await res.json();
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
 * Con `{ invia: true }` è il backend a spedire le credenziali (§35): il browser non
 * costruisce più il messaggio né conosce le credenziali SMTP della piattaforma.
 */
export async function resetPasswordTenantApi(id: string, opzioni?: { invia?: boolean }) {
  const res = await apiFetch(`${API_BASE}/admin/tenants/${id}/reset-password`, {
    method: 'POST',
    headers: { ...getAuthHeaders(), 'Content-Type': 'application/json' },
    body: JSON.stringify({ invia: Boolean(opzioni?.invia) }),
  });
  if (!res.ok) {
    const errore = await res.json().catch(() => ({}));
    throw new Error(errore?.errore || 'Reset password non riuscito');
  }
  return await res.json() as {
    ok: boolean;
    email: string;
    passwordTemporanea: string;
    invitoInviato?: boolean;
    invitoErrore?: string | null;
  };
}

export async function updateAdminTenantApi(id: string, data: any) {
  // §3.3 — il fallback restituiva `data` (l'input stesso) facendo sembrare applicata
  // una modifica mai arrivata al server: sospensioni, proroghe e scadenze fantasma.
  const res = await apiFetch(`${API_BASE}/admin/tenants/${id}`, {
    method: 'PATCH',
    headers: getAuthHeaders(),
    body: JSON.stringify(data),
  });
  if (!res.ok) throw new Error(await leggiErroreApi(res, 'Errore aggiornamento tenant'));
  return await res.json();
}

export async function deleteAdminTenantApi(id: string) {
  // §3.3 — eliminare uno studio (tenant) è un'operazione distruttiva: se il server non
  // conferma, lo studio esiste ancora e il "successo" finto è un danno, non un favore.
  const res = await apiFetch(`${API_BASE}/admin/tenants/${id}`, {
    method: 'DELETE',
    headers: getAuthHeaders(),
  });
  if (!res.ok) throw new Error(await leggiErroreApi(res, 'Errore eliminazione tenant'));
  return await res.json();
}
