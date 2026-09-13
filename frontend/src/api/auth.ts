import { API_BASE, apiFetch, getAuthHeaders } from './http';

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
  if (data?.token && typeof localStorage !== 'undefined') {
    localStorage.setItem('bluman_jwt_token', data.token);
  }
  return data;
}

/**
 * Impostazione o Modifica Password per il Cliente del Portale
 */
export async function cambiaPasswordClienteApi(newPassword: string, currentPassword?: string) {
  const res = await apiFetch(`${API_BASE}/portal/change-password`, {
    method: 'POST',
    headers: getAuthHeaders(),
    body: JSON.stringify({ newPassword, currentPassword }),
  });
  const data = await res.json().catch(() => null);
  if (!res.ok) {
    throw new Error(data?.errore || 'Errore durante il salvataggio della password');
  }
  if (data?.token && typeof localStorage !== 'undefined') {
    localStorage.setItem('bluman_portal_token', data.token);
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

// ─── §6.1 TOTP 2FA ──────────────────────────────────────────────────────────

/**
 * Legge lo stato corrente del 2FA TOTP per il super_admin autenticato.
 * Restituisce { totpAbilitato: boolean }.
 */
export async function statoTotpApi(): Promise<{
  ok: boolean;
  totpAbilitato: boolean;
  ipFidatiCount?: number;
  ipCorrente?: string;
  ipCorrenteFidato?: boolean;
}> {
  const res = await apiFetch(`${API_BASE}/auth/totp/stato`, {
    headers: getAuthHeaders(),
  });
  const data = await res.json().catch(() => null);
  if (!res.ok) throw new Error(data?.errore || 'Errore lettura stato 2FA');
  return data;
}

export async function dimenticaIpFidatiApi(): Promise<{ ok: boolean; messaggio: string }> {
  const res = await apiFetch(`${API_BASE}/auth/totp/dimentica-ip`, {
    method: 'POST',
    headers: getAuthHeaders(),
  });
  const data = await res.json().catch(() => null);
  if (!res.ok) throw new Error(data?.errore || 'Errore reset IP fidati');
  return data;
}

/**
 * Step 1 attivazione: genera il segreto TOTP, lo cifra e salva sul DB.
 * Restituisce { qrUri, qrUrl, segreto, backupCodes, hint }.
 * I backupCodes vanno mostrati UNA SOLA VOLTA e salvati dall'utente.
 */
export async function attivaTotpApi(): Promise<{
  ok: boolean;
  qrUri: string;
  qrUrl: string;
  segreto: string;
  backupCodes: string[];
  hint: string;
}> {
  const res = await apiFetch(`${API_BASE}/auth/totp/attiva`, {
    method: 'POST',
    headers: getAuthHeaders(),
  });
  const data = await res.json().catch(() => null);
  if (!res.ok) throw new Error(data?.errore || 'Errore durante l\'attivazione del 2FA');
  return data;
}

/**
 * Step 2 attivazione: verifica il primo codice a 6 cifre dall'app authenticator.
 * Se corretto imposta totpAbilitato=true sul DB.
 */
export async function confermaTotpApi(codiceTotp: string): Promise<{ ok: boolean; messaggio: string }> {
  const res = await apiFetch(`${API_BASE}/auth/totp/conferma`, {
    method: 'POST',
    headers: { ...getAuthHeaders(), 'Content-Type': 'application/json' },
    body: JSON.stringify({ codiceTotp }),
  });
  const data = await res.json().catch(() => null);
  if (!res.ok) throw new Error(data?.errore || 'Codice TOTP non valido');
  return data;
}

/**
 * Disabilita il 2FA TOTP. Richiede la password corrente come secondo fattore
 * di sicurezza. Elimina segreto e backup codes dal DB.
 */
export async function disabilitaTotpApi(password: string): Promise<{ ok: boolean; messaggio: string }> {
  const res = await apiFetch(`${API_BASE}/auth/totp/disabilita`, {
    method: 'POST',
    headers: { ...getAuthHeaders(), 'Content-Type': 'application/json' },
    body: JSON.stringify({ password }),
  });
  const data = await res.json().catch(() => null);
  if (!res.ok) throw new Error(data?.errore || 'Errore durante la disabilitazione del 2FA');
  return data;
}

/**
 * Step finale login con 2FA: scambia il preToken (2 min) + codice TOTP (o backup code)
 * con il JWT definitivo di sessione.
 */
export async function verificaTotpApi(preToken: string, codiceTotp: string) {
  const res = await apiFetch(`${API_BASE}/auth/totp/verifica`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ preToken, codiceTotp }),
  });
  if (res.status === 429) throw new Error('Troppi tentativi. Riprova tra un minuto.');
  const data = await res.json().catch(() => null);
  if (!res.ok) throw new Error(data?.errore || 'Codice non valido o sessione scaduta.');
  return data;
}

