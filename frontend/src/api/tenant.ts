import { getTenantStorageKey, getCurrentTenantId, getStudioInfoForTenant, BLUECODE_TENANT_ID, senzaSegretiTenant } from '../utils/tenant';
import { API_BASE, apiFetch, getAuthHeaders, leggiErroreApi } from './http';

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

  return creato;
}

// `sendInviteCollaboratoreApi` è stata rimossa: costruiva le credenziali SMTP dello studio
// leggendole da `localStorage` e le spediva alla funzione serverless pubblica insieme alla
// password temporanea del nuovo collaboratore. L'invito lo manda `POST /tenant/utenti`, che è
// la rotta che genera quella password (vedi `sendInvitoCollaboratoreEmail` nel backend).

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

/**
 * Messaggio WhatsApp al cliente, spedito dal backend con il numero dello studio.
 *
 * Prima chiamava `POST /api/send-whatsapp`: una funzione senza autenticazione, con
 * `Access-Control-Allow-Origin: *`, che prendeva Phone ID e access token dalle variabili
 * d'ambiente — quindi un unico numero per tutti gli studi — e rispondeva `success: true`
 * anche quando il ripiego su `hello_world` falliva. Ora la consegna la fa
 * `POST /comunicazioni/invia-whatsapp`, che legge le credenziali della riga Tenant.
 */
export async function sendWhatsAppDirectApi(to: string, text: string, templateName?: string) {
  try {
    const res = await apiFetch(`${API_BASE}/comunicazioni/invia-whatsapp`, {
      method: 'POST',
      headers: getAuthHeaders(),
      body: JSON.stringify({ to, testo: text, template: templateName }),
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
export async function sendEmailDirectApi(to: string, subject: string, text: string, html?: string) {
  try {
    // Venti secondi: un invio SMTP che deve provare più porte non sta dentro i sei di prima,
    // e il timeout scaduto veniva mostrato come errore di invio anche quando l'email partiva.
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 20000);
    const res = await apiFetch(`${API_BASE}/comunicazioni/invia-email`, {
      method: 'POST',
      headers: getAuthHeaders(),
      body: JSON.stringify({ to, subject, testo: text, html }),
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
