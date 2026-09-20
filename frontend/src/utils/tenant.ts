// Modulo di Gestione e Isolamento Dati Multi-Tenant per BluMan Advisory Platform
// Garantisce la rigorosa separazione e azzeramento dei dati tra Tenant/Studi professionali

import type { Cliente, Progetto } from '../types';

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
    ragioneSociale: 'Studio Advisory & Legal Partners',
    nomeBreve: 'Studio Advisory',
    giurisdizione: 'Italia',
    piva: '',
    codiceFiscale: '',
    sedeLegale: '',
    sedeOperativa: '',
    email: 'contact@studioadvisory.it',
    telefono: '',
    iban: '',
    bic: '',
    bancaNome: '',
    codiceSdi: '',
    leadAdvisor: 'Lead Senior Advisor',
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
    if (currentUser.email) {
      const clean = currentUser.email.toLowerCase().trim();
      if (clean.includes('lorenzo.marino') || clean.includes('advisory.it')) {
        localStorage.setItem('bluman_tenant_id', '00000000-0000-0000-0000-000000000002');
        return '00000000-0000-0000-0000-000000000002';
      }
      if (clean.includes('elena.russo') || clean.includes('swisswealth')) {
        localStorage.setItem('bluman_tenant_id', '00000000-0000-0000-0000-000000000003');
        return '00000000-0000-0000-0000-000000000003';
      }
    }
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
            nomeBreve: found.ragioneSociale ? found.ragioneSociale.split(' ')[0] : 'Studio',
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
            leadAdvisor: found.leadAdvisorNome || 'Lead Senior Advisor',
          };
        }
      }
    } catch {}
  }

  if (!base) {
    base = {
      id: tId,
      ragioneSociale: 'Studio Professionale',
      nomeBreve: 'Studio',
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
      leadAdvisor: 'Lead Senior Advisor',
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
 * Restituisce l'elenco di tutti gli studi/tenant disponibili per lo switch
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

  // Ripiego minimo quando il localStorage è vuoto: solo Bluecode, il tenant di default
  // sempre presente. Prima c'erano anche Advisory Italia e Swiss Wealth (studi mock, poi
  // eliminati dal DB): li si toglie perché non devono ricomparire nel selettore studi.
  return [
    { id: BLUECODE_TENANT_ID, ragioneSociale: 'Bluecode Advisory Malta Ltd', giurisdizione: 'Malta (UE)' },
  ];
}

/**
 * Imposta lo studio attivo sulla piattaforma e notifica i componenti
 */
export function setActiveTenantId(tenantId: string) {
  localStorage.setItem('bluman_tenant_id', tenantId);
  window.dispatchEvent(new Event('tenant_changed'));
}

/**
 * Dati iniziali di seed isolati per ciascun Tenant.
 * IMPORTANTE: Qualsiasi nuovo tenant O tenant secondario inizia con database 100% AZZERATO E PULITO.
 * Solo il Tenant Demo Bluecode Ltd (ID 00000000-0000-0000-0000-000000000001) ha i dati di esempio.
 */
export function getTenantSeedData(tenantId?: string) {
  const tId = tenantId || getCurrentTenantId();

  // Solo il tenant demo originario Bluecode Ltd ha i dati dimostrativi
  if (tId === BLUECODE_TENANT_ID) {
    const clients: Cliente[] = [
      {
        id: 'cl-01',
        nome: 'Holding Beta S.r.l.',
        tipo: 'company',
        piva: 'IT09876543210',
        codiceFiscale: 'BLUCD90A01H501X',
        sedeLegale: 'Via Montenapoleone 8, Milano',
        codiceSdi: 'SUBM70N',
        email: 'client@holdingbeta.advisory',
        telefono: '+39 02 889900',
        cellulare: '+39 333 5936278',
        referenteNome: 'Ing. Roberto Rossi (CEO)',
        isAttivo: true,
        dataKyc: '15/08/2026',
        rischioAml: 'basso',
        referentiJson: {
          email: 'client@holdingbeta.advisory',
          telefono: '+39 02 889900',
          cellulare: '+39 333 5936278',
          whatsapp: '+39 333 5936278',
          referenteNome: 'Ing. Roberto Rossi (CEO)',
        }
      },
      {
        id: 'cl-02',
        nome: 'Alpha Real Estate SA',
        tipo: 'company',
        piva: 'CHE-987.654.321',
        codiceFiscale: 'CHE-987.654.321',
        sedeLegale: 'Via Canova 10, Lugano (Svizzera)',
        codiceSdi: '0000000',
        email: 'compliance@alpharealestate.ch',
        telefono: '+41 91 800 22 33',
        referenteNome: 'Marco Bellini (CFO)',
        isAttivo: true,
        dataKyc: '01/08/2026',
        rischioAml: 'basso',
        referentiJson: {
          email: 'compliance@alpharealestate.ch',
          telefono: '+41 91 800 22 33',
          referenteNome: 'Marco Bellini (CFO)',
        }
      }
    ];

    const projects: Progetto[] = [
      {
        id: 'proj-001',
        n: 'Progetto Structuring Holding Malta — Holding Beta S.r.l.',
        cl: 'Holding Beta S.r.l.',
        ct: 'company',
        st: 'in_progress',
        pct: 45,
        start: '12/08/2026',
        due: '31/10/2026',
        val: 18500,
        delay: false,
        fisc: 'ue_malta',
        fatture: [
          { numero: 'FT-2026/01', data: '15/08/2026', importo: 9250, stato: 'incassata' },
        ],
        mods: [
          {
            id: 101,
            n: 'Analisi Patrimoniale & Fiscalità Internazionale',
            cat: 'Analisi',
            st: 'done',
            pct: 100,
            h: 15,
            a: 15,
            p: 4500,
            team: [1, 5],
            delay: false,
            v: [
              { id: 1, n: 'Briefing Iniziale & Raccolta Documenti', hE: 5, hA: 5, s: 'done', op: 'Joe Disabato' },
              { id: 2, n: 'Parere di Pro-Memoria Fiscale', hE: 10, hA: 10, s: 'done', op: 'Avv. Mario Dibenedetto' },
            ]
          },
          {
            id: 102,
            n: 'Costituzione LTD Maltese & MFSA Filing',
            cat: 'Societario',
            st: 'in_progress',
            pct: 35,
            h: 30,
            a: 10,
            p: 14000,
            team: [1, 2],
            delay: false,
            v: [
              { id: 3, n: 'Redazione Memorandum & Articles of Association', hE: 15, hA: 10, s: 'in_progress', op: 'Joe Disabato' },
              { id: 4, n: 'Deposito Registro Imprese MBR / MFSA', hE: 15, hA: 0, s: 'pending', op: 'Francesca Disabato' },
            ]
          }
        ]
      },
      {
        id: 'proj-002',
        n: 'Trust Internazionale Asset Protection — Alpha Real Estate SA',
        cl: 'Alpha Real Estate SA',
        ct: 'company',
        st: 'in_progress',
        pct: 70,
        start: '01/08/2026',
        due: '15/10/2026',
        val: 22000,
        delay: false,
        fisc: 'extra_ue',
        fatture: [
          { numero: 'FT-2026/02', data: '05/08/2026', importo: 22000, stato: 'incassata' },
        ],
        mods: [
          {
            id: 103,
            n: 'Redazione Deed of Trust & Letter of Wishes',
            cat: 'Trust',
            st: 'done',
            pct: 100,
            h: 22,
            a: 22,
            p: 12000,
            team: [1, 5],
            delay: false,
            v: [
              { id: 5, n: 'Definizione clausole protettive e guardiano', hE: 12, hA: 12, s: 'done', op: 'Avv. Mario Dibenedetto' },
              { id: 6, n: 'Conferimento asset immobiliari esteri', hE: 10, hA: 10, s: 'done', op: 'Joe Disabato' },
            ]
          },
          {
            id: 104,
            n: 'Apertura Conti Correnti Svizzera / Malta',
            cat: 'Banking',
            st: 'in_progress',
            pct: 50,
            h: 18,
            a: 9,
            p: 10000,
            team: [2],
            delay: false,
            v: [
              { id: 7, n: 'Compliance Banking & KYC Verification', hE: 10, hA: 9, s: 'done', op: 'Francesca Disabato' },
              { id: 8, n: 'Rilascio credenziali Internet Banking', hE: 8, hA: 0, s: 'in_progress', op: 'Francesca Disabato' },
            ]
          }
        ]
      }
    ];

    const invoices: any[] = [
      {
        id: 'inv-01',
        numero: 'FT-2026/01',
        tipoDocumento: 'fattura',
        serie: 'FT',
        dataEmissione: '15/08/2026',
        clienteId: 'cl-01',
        clienteNome: 'Holding Beta S.r.l.',
        clientePiva: 'IT09876543210',
        progettoId: 'proj-001',
        progettoNome: 'Progetto Structuring Holding Malta — Holding Beta S.r.l.',
        imponibileCentesimi: 925000,
        aliquotaIva: 0,
        totaleCentesimi: 925000,
        stato: 'incassata',
        dataIncasso: '16/08/2026',
        scadenza: '15/09/2026',
      },
      {
        id: 'inv-02',
        numero: 'FT-2026/02',
        tipoDocumento: 'fattura',
        serie: 'FT',
        dataEmissione: '05/08/2026',
        clienteId: 'cl-02',
        clienteNome: 'Alpha Real Estate SA',
        clientePiva: 'CHE-987.654.321',
        progettoId: 'proj-002',
        progettoNome: 'Trust Internazionale Asset Protection — Alpha Real Estate SA',
        imponibileCentesimi: 2200000,
        aliquotaIva: 0,
        totaleCentesimi: 2200000,
        stato: 'incassata',
        dataIncasso: '10/08/2026',
        scadenza: '05/09/2026',
      }
    ];

    return { clients, projects, invoices };
  }

  // TUTTI GLI ALTRI TENANT INIZIANO 100% AZZERATI E VUOTI (TABULA RASA)
  return { clients: [], projects: [], invoices: [] };
}
