// Modulo di Gestione e Isolamento Dati Multi-Tenant per BluMan Advisory Platform
// Garantisce la rigorosa separazione e azzeramento dei dati tra Tenant/Studi professionali

export interface StudioInfo {
  id: string;
  ragioneSociale: string;
  nomeBreve: string;
  giurisdizione: string;
  piva: string;
  codiceFiscale: string;
  sedeLegale: string;
  sedeOperativa: string;
  email: string;
  telefono: string;
  iban: string;
  bic: string;
  bancaNome: string;
  codiceSdi: string;
  leadAdvisor: string;
}

export const BLUECODE_TENANT_ID = '00000000-0000-0000-0000-000000000001';

/** Vero solo per il tenant Bluecode. Usato per mostrare il marchio Bluecode (`/logo.png`)
 *  soltanto lì: gli altri studi vedono il proprio logo caricato o, se manca, il nome. */
export function isBluecodeTenant(tenantId?: string): boolean {
  return (tenantId || getCurrentTenantId()) === BLUECODE_TENANT_ID;
}

/** Il logo di marca `/logo.png` (asset Bluecode in frontend/public) va usato SOLO come
 *  ripiego per il tenant Bluecode. Per ogni altro studio ritorna stringa vuota: senza
 *  logo caricato si stampa il nome dello studio, non il marchio di un altro. */
export function getBrandLogoFallback(tenantId?: string): string {
  return isBluecodeTenant(tenantId) ? '/logo.png' : '';
}

export const TENANT_STUDIOS: Record<string, StudioInfo> = {
  '00000000-0000-0000-0000-000000000001': {
    id: '00000000-0000-0000-0000-000000000001',
    ragioneSociale: 'Bluecode LTD',
    nomeBreve: 'Bluecode',
    giurisdizione: 'Malta',
    piva: '',
    codiceFiscale: 'C71668', // Malta company registration number
    sedeLegale: 'Notabile Residence, Mdina Road, Attard ATD9036, Malta',
    sedeOperativa: 'Notabile Residence, Mdina Road, Attard ATD9036, Malta',
    // §7 — `email` era `'advisor@bluegib.com'` e `leadAdvisor` era `'Lead Senior Advisor'`.
    // Il primo è un indirizzo su un dominio che non è dello studio; il secondo è un **ruolo**
    // messo nel campo di una **persona**, e finiva stampato come nome («Advisor Lead: Lead
    // Senior Advisor») su proposte e documenti. Quando l'anagrafica non è ancora arrivata dal
    // server, il campo resta vuoto: chi lo legge capisce che manca, non chi è.
    email: '',
    telefono: '',
    iban: '',
    bic: '',
    bancaNome: '',
    codiceSdi: '',
    leadAdvisor: '',
  },
  // Advisory Italia (…002) e Swiss Wealth (…003) erano anagrafiche mock: studi eliminati dal
  // DB il 20/09/2026. Rimosse da qui perché un tenant non in mappa ripiega già sulla lista
  // admin reale (localStorage) o su un segnaposto generico — nessun dato finto da conservare.
};

/**
 * Ruolo dell'utente collegato, letto dalla sessione salvata dal login.
 * Serve solo a decidere quali comandi mostrare: l'autorizzazione vera la fa il server, che
 * rifiuta la richiesta a chi non è admin anche se il pulsante viene raggiunto per altra via.
 */
export function getRuoloCorrente(): string | null {
  try {
    const raw = localStorage.getItem('bluman_user');
    if (!raw) return null;
    const utente = JSON.parse(raw);
    return utente?.ruolo ?? utente?.role ?? null;
  } catch {
    return null;
  }
}

/** §WF-DOC — chi può sbloccare un documento firmato: l'admin dello studio e il super_admin. */
export function isAdminStudio(): boolean {
  const ruolo = getRuoloCorrente();
  return ruolo === 'advisor' || ruolo === 'super_admin';
}

export function getCurrentTenantId(user?: any): string {
  let currentUser = user;
  if (!currentUser) {
    const storedUserStr = localStorage.getItem('bluman_user');
    if (storedUserStr) {
      try { currentUser = JSON.parse(storedUserStr); } catch {}
    }
  }

  // Se l'utente NON è super_admin, è rigorosamente vincolato al proprio tenantId assegnato
  const isSuperAdmin = currentUser?.ruolo === 'super_admin' || currentUser?.role === 'super_admin';
  if (currentUser && !isSuperAdmin) {
    if (currentUser.tenantId) {
      localStorage.setItem('bluman_tenant_id', currentUser.tenantId);
      return currentUser.tenantId;
    }
    // Rimossa l'euristica email→tenant: instradava le email `advisory.it`→…002 e
    // `swisswealth`→…003, tenant mock ELIMINATI dal DB il 20/09/2026. Un utente reale senza
    // tenantId con quelle sottostringhe finiva agganciato a un tenant inesistente. Il tenant
    // deve venire solo da currentUser.tenantId (lo assegna il backend).
  }

  const storedTenantId = localStorage.getItem('bluman_tenant_id');
  if (storedTenantId) return storedTenantId;

  if (currentUser?.tenantId) return currentUser.tenantId;
  return BLUECODE_TENANT_ID;
}

/**
 * Genera la chiave di storage rigorosamente isolata per il tenant
 */
export function getTenantStorageKey(baseKey: string, tenantId?: string): string {
  const tId = tenantId || getCurrentTenantId();
  return `${baseKey}_tenant_${tId}`;
}

/** 3.13 — nell'interfaccia, al posto del nome dello studio che manca. */
export const ANAGRAFICA_DA_COMPLETARE = 'Anagrafica studio da completare';

/** 3.13 — il nome dello studio in un documento, PDF o messaggio al cliente: mai inventato. */
export function ragioneSocialeDocumento(ragioneSociale?: string | null, maiuscolo = false): string {
  if (!ragioneSociale || !ragioneSociale.trim()) return '[DATO MANCANTE: ragione sociale dello studio]';
  return maiuscolo ? ragioneSociale.toUpperCase() : ragioneSociale;
}

/**
 * Recupera i dati anagrafici dello Studio del tenant attivo
 */
export function getStudioInfoForTenant(tenantId?: string): StudioInfo {
  const tId = tenantId || getCurrentTenantId();

  let savedSettings: any = null;
  try {
    const savedSettingsStr = localStorage.getItem(getTenantStorageKey('bluman_tenant_info', tId));
    if (savedSettingsStr) {
      savedSettings = JSON.parse(savedSettingsStr);
    }
  } catch {}

  let base: any = TENANT_STUDIOS[tId];
  if (!base) {
    // Controlla se è un tenant registrato nel SuperAdmin
    try {
      const customTenantsStr = localStorage.getItem('bluman_all_tenants_admin');
      if (customTenantsStr) {
        const list = JSON.parse(customTenantsStr);
        const found = list.find((t: any) => t.id === tId);
        if (found) {
          base = {
            id: found.id,
            ragioneSociale: found.ragioneSociale,
            nomeBreve: found.ragioneSociale ? found.ragioneSociale.split(' ')[0] : '',
            giurisdizione: found.giurisdizione || 'Italia',
            piva: found.pIva || '',
            codiceFiscale: found.pIva || '',
            sedeLegale: '',
            sedeOperativa: '',
            email: found.leadAdvisorEmail || '',
            telefono: '',
            iban: '',
            bic: '',
            bancaNome: '',
            codiceSdi: '',
            // §7 — qui c'era `found.leadAdvisorNome || 'Lead Senior Advisor'`: senza il nome del
            // responsabile si stampava un **ruolo** nel campo di una persona. Vuoto è la verità.
            leadAdvisor: found.leadAdvisorNome || '',
          };
        }
      }
    } catch {}
  }

  if (!base) {
    base = {
      id: tId,
      // 3.13 — uno studio di cui non si sa nulla non ha un nome: era «Studio Professionale».
      ragioneSociale: '',
      nomeBreve: '',
      giurisdizione: 'Italia',
      piva: '',
      codiceFiscale: '',
      sedeLegale: '',
      sedeOperativa: '',
      email: '',
      telefono: '',
      iban: '',
      bic: '',
      bancaNome: '',
      codiceSdi: '',
      // Nessun nome di responsabile: uno studio di cui non si sa nulla non ha un responsabile
      // di nome «Lead Senior Advisor». Il campo vuoto dice che manca il dato (regola 7).
      leadAdvisor: '',
    };
  }

  if (savedSettings && typeof savedSettings === 'object') {
    return {
      ...base,
      ...savedSettings,
      ragioneSociale: savedSettings.ragioneSociale || base.ragioneSociale,
      sedeLegale: savedSettings.sedeLegale !== undefined ? savedSettings.sedeLegale : base.sedeLegale,
      sedeOperativa: savedSettings.sedeOperativa !== undefined ? savedSettings.sedeOperativa : base.sedeOperativa,
      piva: savedSettings.piva !== undefined ? savedSettings.piva : base.piva,
      codiceFiscale: savedSettings.codiceFiscale !== undefined ? savedSettings.codiceFiscale : base.codiceFiscale,
      email: savedSettings.email !== undefined ? savedSettings.email : base.email,
      telefono: savedSettings.telefono !== undefined ? savedSettings.telefono : base.telefono,
      iban: savedSettings.iban !== undefined ? savedSettings.iban : base.iban,
      codiceSdi: savedSettings.codiceSdi !== undefined ? savedSettings.codiceSdi : base.codiceSdi,
      leadAdvisor: savedSettings.leadAdvisor !== undefined ? savedSettings.leadAdvisor : base.leadAdvisor,
    };
  }

  return base;
}

/**
 * Chiavi che non devono MAI finire in localStorage (regola 6 di ISTRUZIONI_PER_IA.md):
 * il localStorage è leggibile da qualunque script della pagina e sopravvive al logout.
 * Le credenziali dello studio stanno solo nella riga Tenant del database; il backend le
 * restituisce già vuote con il flag `<chiave>Impostata`.
 */
export const CHIAVI_SEGRETE_TENANT = [
  'smtpPass',
  'imapPass',
  'waAccessToken',
  'waVerifyToken',
  'tgBotToken',
] as const;

/** Copia dell'oggetto tenant senza i valori delle credenziali. */
export function senzaSegretiTenant<T>(data: T): T {
  if (!data || typeof data !== 'object') return data;
  const copia: Record<string, any> = { ...(data as any) };
  for (const chiave of CHIAVI_SEGRETE_TENANT) {
    if (chiave in copia) {
      copia[`${chiave}Impostata`] = Boolean(copia[`${chiave}Impostata`] ?? copia[chiave]);
      delete copia[chiave];
    }
  }
  return copia as T;
}

/**
 * Salva i dati di configurazione del Tenant in modo persistente e isolato
 */
/** Chiavi dei moduli che lo studio ha messo in standby (nascosti dalla navigazione). */
export function getModuliDisattivati(tenantId?: string): string[] {
  try {
    const raw = localStorage.getItem(getTenantStorageKey('bluman_tenant_info', tenantId || getCurrentTenantId()));
    if (!raw) return [];
    const info = JSON.parse(raw);
    return Array.isArray(info?.moduliDisattivati) ? info.moduliDisattivati.filter((m: unknown) => typeof m === 'string') : [];
  } catch {
    return [];
  }
}

export function saveTenantInfoToStorage(tenantId: string, data: any) {
  try {
    const pulito = senzaSegretiTenant(data) as any;
    localStorage.setItem(
      getTenantStorageKey('bluman_tenant_info', tenantId),
      JSON.stringify(pulito),
    );
    if (pulito.logoUrl) {
      localStorage.setItem(getTenantStorageKey('bluman_logo_url', tenantId), pulito.logoUrl);
    }
    if (TENANT_STUDIOS[tenantId]) {
      TENANT_STUDIOS[tenantId] = {
        ...TENANT_STUDIOS[tenantId],
        ...pulito,
      };
    }
    const customTenantsStr = localStorage.getItem('bluman_all_tenants_admin');
    if (customTenantsStr) {
      const list = JSON.parse(customTenantsStr);
      const idx = list.findIndex((t: any) => t.id === tenantId);
      if (idx >= 0) {
        list[idx] = {
          ...list[idx],
          ragioneSociale: data.ragioneSociale || list[idx].ragioneSociale,
          pIva: data.piva || list[idx].pIva,
          giurisdizione: data.giurisdizione || list[idx].giurisdizione,
        };
        localStorage.setItem('bluman_all_tenants_admin', JSON.stringify(list));
      }
    }
    window.dispatchEvent(new Event('tenant_changed'));
  } catch (err) {
    console.error('Errore salvataggio tenant info in storage:', err);
  }
}

/**
 * Restituisce l'elenco di tutti gli studi/tenant disponibili per lo switch.
 *
 * §7 — è una lettura sincrona di **ciò che il server ha detto l'ultima volta** (il registro admin
 * lo scrive `SuperAdminPage` solo dopo una risposta vera): per l'elenco aggiornato c'è
 * `fetchAdminTenantsApi`. Il ripiego, quando quel registro è vuoto, è lo **studio attivo** con il
 * nome che ha davvero — prima qui c'era una riga scritta a mano, «Bluecode Advisory Malta Ltd»,
 * che non è il nome di nessuno studio: la riga `tenant` dice «Bluecode LTD», e così il selettore
 * mostrava un'entità inesistente.
 */
export function getAllAvailableTenants(): { id: string; ragioneSociale: string; giurisdizione: string }[] {
  try {
    const customTenantsStr = localStorage.getItem('bluman_all_tenants_admin');
    if (customTenantsStr) {
      const list = JSON.parse(customTenantsStr);
      if (Array.isArray(list) && list.length > 0) {
        return list.map((t: any) => ({
          id: t.id,
          ragioneSociale: t.ragioneSociale,
          giurisdizione: t.giurisdizione || 'Italia',
        }));
      }
    }
  } catch {}

  // Niente registro locale: l'unico studio di cui si sa qualcosa è quello attivo. Se nemmeno
  // l'anagrafica è arrivata il selettore lo dice («da completare»), senza un nome inventato.
  const studio = getStudioInfoForTenant();
  return [{ id: studio.id, ragioneSociale: studio.ragioneSociale || ANAGRAFICA_DA_COMPLETARE, giurisdizione: studio.giurisdizione }];
}

/**
 * Imposta lo studio attivo sulla piattaforma e notifica i componenti
 */
export function setActiveTenantId(tenantId: string) {
  localStorage.setItem('bluman_tenant_id', tenantId);
  window.dispatchEvent(new Event('tenant_changed'));
}
