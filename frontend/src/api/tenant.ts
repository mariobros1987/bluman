import { getTenantStorageKey, getCurrentTenantId, getStudioInfoForTenant, BLUECODE_TENANT_ID } from '../utils/tenant';
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

  return creato;
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
  localStorage.setItem(getTenantStorageKey('bluman_tenant_info', currentTenantId), JSON.stringify({ ...input, ...data }));
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
