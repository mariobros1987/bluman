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

export const TENANT_STUDIOS: Record<string, StudioInfo> = {
  '00000000-0000-0000-0000-000000000001': {
    id: '00000000-0000-0000-0000-000000000001',
    ragioneSociale: 'Bluecode Ltd (Malta Headquarters)',
    nomeBreve: 'Bluecode Advisory',
    giurisdizione: 'Malta (UE)',
    piva: 'MT28491039',
    codiceFiscale: 'MT28491039',
    sedeLegale: 'Level 4, Valuation Centre, Tower Road, Sliema SLM 1600, Malta',
    sedeOperativa: 'Via Montenapoleone 8, 20121 Milano (MI), Italia',
    email: 'support@bluecode-ltd.com',
    telefono: '+39 378 092 6461',
    iban: 'MT89VALL22013000000012345678',
    bic: 'VALLMTM1',
    bancaNome: 'Bank of Valletta plc (Malta)',
    codiceSdi: 'XXXXXXX',
    leadAdvisor: 'Joe Disabato',
  },
  '00000000-0000-0000-0000-000000000002': {
    id: '00000000-0000-0000-0000-000000000002',
    ragioneSociale: 'Advisory Italia S.r.l. (Milano)',
    nomeBreve: 'Advisory Italia',
    giurisdizione: 'Italia',
    piva: '',
    codiceFiscale: '',
    sedeLegale: '',
    sedeOperativa: '',
    email: 'lorenzo.marino@bluecode.advisory',
    telefono: '',
    iban: '',
    bic: '',
    bancaNome: '',
    codiceSdi: '',
    leadAdvisor: 'Avv. Lorenzo Marino',
  },
  '00000000-0000-0000-0000-000000000003': {
    id: '00000000-0000-0000-0000-000000000003',
    ragioneSociale: 'Swiss Wealth Management SA (Lugano)',
    nomeBreve: 'Swiss Wealth SA',
    giurisdizione: 'Svizzera',
    piva: '',
    codiceFiscale: '',
    sedeLegale: '',
    sedeOperativa: '',
    email: 'elena.russo@bluecode.advisory',
    telefono: '',
    iban: '',
    bic: '',
    bancaNome: '',
    codiceSdi: '',
    leadAdvisor: 'Dr. Elena Russo',
  },
};

/**
 * Ottiene il Tenant ID attivo dell'utente loggato
 */
export function getCurrentTenantId(user?: any): string {
  if (user?.tenantId) return user.tenantId;
  const storedUserStr = localStorage.getItem('bluman_user');
  if (storedUserStr) {
    try {
      const u = JSON.parse(storedUserStr);
      if (u.tenantId) return u.tenantId;
      if (u.email) {
        const clean = u.email.toLowerCase().trim();
        if (clean.includes('lorenzo.marino') || clean.includes('advisory.it')) {
          return '00000000-0000-0000-0000-000000000002';
        }
        if (clean.includes('elena.russo') || clean.includes('swisswealth')) {
          return '00000000-0000-0000-0000-000000000003';
        }
      }
    } catch {}
  }
  const storedTenantId = localStorage.getItem('bluman_tenant_id');
  if (storedTenantId) return storedTenantId;

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
  if (TENANT_STUDIOS[tId]) return TENANT_STUDIOS[tId];

  // Controlla se è un tenant custom registrato dal SuperAdmin
  try {
    const customTenantsStr = localStorage.getItem('bluman_all_tenants_admin');
    if (customTenantsStr) {
      const list = JSON.parse(customTenantsStr);
      const found = list.find((t: any) => t.id === tId);
      if (found) {
        return {
          id: found.id,
          ragioneSociale: found.ragioneSociale,
          nomeBreve: found.ragioneSociale.split(' ')[0] || 'Studio',
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

  return {
    id: tId,
    ragioneSociale: 'Nuovo Studio',
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
    leadAdvisor: 'Lead Advisor',
  };
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
