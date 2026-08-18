// Mock data — fedele al prototipo BluMan_platform.html
// Sarà sostituito da chiamate API reali nelle fasi successive

import type { TeamMember, Articolo, ModuloTemplate, Progetto, Giurisdizione } from '../types';

export const GIURISDIZIONI: Giurisdizione[] = [
  { id: 'giur-mt', nome: 'Malta', codice: 'MT', tipo: 'ue', note: 'Repubblica di Malta — Hub finanziario UE' },
  { id: 'giur-gi', nome: 'Gibilterra', codice: 'GI', tipo: 'extra_ue', note: 'Territorio d Oltremare Britannico (Extra-UE)' },
  { id: 'giur-fl', nome: 'Florida (USA)', codice: 'US-FL', tipo: 'stato_usa', note: 'Stato degli Stati Uniti d America (Florida)' },
  { id: 'giur-de', nome: 'Delaware (USA)', codice: 'US-DE', tipo: 'stato_usa', note: 'Stato degli Stati Uniti d America (Delaware)' },
  { id: 'giur-ae', nome: 'Emirati Arabi Uniti', codice: 'AE', tipo: 'extra_ue', note: 'Dubai / Abu Dhabi Free Zones' },
];

export const TEAM: TeamMember[] = [
  { id: 1, n: 'Joe Disabato',       r: 'Lead Advisor & Senior Partner', i: 'JD', c: '#6366f1' },
  { id: 2, n: 'Francesca Disabato', r: 'Back Office & Compliance',      i: 'FD', c: '#ec4899' },
  { id: 3, n: 'Avv. Lorenzo Marino',r: 'Legal Counsel — Diritto Societario', i: 'LM', c: '#10b981' },
  { id: 4, n: 'Dr. Elena Russo',    r: 'Tax Advisor & Fiscalità Internazionale', i: 'ER', c: '#f59e0b' },
  { id: 5, n: 'Avv. Mario Dibenedetto', r: 'Legal Counsel & Partner',   i: 'MD', c: '#3b82f6' },
];

export function extractInitialsFromName(name: string): string {
  if (!name) return 'OP';
  // Rimuovi prefissi e titoli professionali
  const clean = name.replace(/^(avv\.?|dr\.?|dott\.?|dott\.ssa|ing\.?|rag\.?|prof\.?|avvocato|dottore)\s+/i, '').trim();
  const parts = clean.split(/\s+/).filter(Boolean);
  if (parts.length === 0) return 'OP';
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

export function getTeamMembersList(): TeamMember[] {
  return TEAM.map(t => {
    try {
      const customInitials = localStorage.getItem(`bluman_avatar_initials_${t.id}`);
      const customColor = localStorage.getItem(`bluman_avatar_color_${t.id}`);
      return {
        ...t,
        i: customInitials || t.i,
        c: customColor || t.c,
      };
    } catch {
      return t;
    }
  });
}

export const ARTICOLI: Articolo[] = [
  { id: 'A_RACCOLTA_DOC',        n: 'Raccolta documentazione cliente',            cat: 'Analisi',    h: 2,  p: 600,  ver: 2, documentiRichiesti: ['m3'], formMasterId: 'f3' },
  { id: 'A_ANALISI_STRUTT',     n: 'Analisi struttura patrimoniale esistente',   cat: 'Analisi',    h: 4,  p: 1200, ver: 2 },
  { id: 'A_REPORT_ANALISI',     n: 'Report analisi iniziale',                    cat: 'Analisi',    h: 3,  p: 900,  ver: 1 },
  { id: 'A_PRESENT_CLIENTE',    n: 'Presentazione al cliente',                   cat: 'Analisi',    h: 2,  p: 600,  ver: 1 },
  { id: 'A_FIRMA_ENG',          n: 'Validazione e firma engagement letter',      cat: 'Analisi',    h: 1,  p: 200,  ver: 1, documentiRichiesti: ['m1', 'm2'] },
  { id: 'A_STUDIO_STRUTT',      n: 'Studio struttura societaria ottimale',       cat: 'Societario', h: 6,  p: 1800, ver: 2 },
  { id: 'A_COST_SOCIETA',       n: 'Costituzione società',                       cat: 'Societario', h: 10, p: 3000, ver: 3, documentiRichiesti: ['m4'], formMasterId: 'f1' },
  { id: 'A_ATTO_COST',          n: 'Atto costitutivo e statuto',                 cat: 'Societario', h: 6,  p: 1800, ver: 2, documentiRichiesti: ['m4'], formMasterId: 'f1' },
  { id: 'A_CONTRATTO_INTERCOMPANY', n: 'Contratto di servizio intercompany',     cat: 'Societario', h: 6,  p: 1800, ver: 1 },
  { id: 'A_REG_MFSA',           n: 'Registrazione MFSA',                         cat: 'Societario', h: 6,  p: 1800, ver: 1, documentiRichiesti: ['m2'] },
  { id: 'A_REG_FISCALE',        n: 'Registrazione fiscale',                       cat: 'Societario', h: 4,  p: 1200, ver: 1 },
  { id: 'A_UBO',                n: 'Documentazione UBO Registry',                cat: 'Societario', h: 2,  p: 600,  ver: 1, documentiRichiesti: ['m3'], formMasterId: 'f2' },
  { id: 'A_SEL_GIURISDIZIONE',  n: 'Selezione giurisdizione',                    cat: 'Societario', h: 6,  p: 1600, ver: 1 },
  { id: 'A_COST_HOLDING',       n: 'Costituzione holding',                        cat: 'Societario', h: 10, p: 2800, ver: 1, documentiRichiesti: ['m4'], formMasterId: 'f1' },
  { id: 'A_STRUTT_PARTECIPAZIONI', n: 'Struttura partecipazioni',               cat: 'Societario', h: 8,  p: 2200, ver: 1 },
  { id: 'A_CONTRATTO_SERVIZIO', n: 'Contratto di servizio',                      cat: 'Legale',     h: 6,  p: 1800, ver: 2, documentiRichiesti: ['m1'] },
  { id: 'A_COMPLIANCE_ONGOING', n: 'Compliance ongoing',                          cat: 'Societario', h: 5,  p: 1100, ver: 1 },
  { id: 'A_SEL_TRUST_CO',       n: 'Selezione trust company idonea',             cat: 'Trust',      h: 4,  p: 1200, ver: 1 },
  { id: 'A_DEED_TRUST',         n: 'Redazione deed of trust',                    cat: 'Trust',      h: 10, p: 2800, ver: 2, documentiRichiesti: ['m1', 'm3'], formMasterId: 'f2' },
  { id: 'A_LETTER_WISHES',      n: 'Definizione letter of wishes',               cat: 'Trust',      h: 6,  p: 1700, ver: 1 },
  { id: 'A_TRASF_ASSET',        n: 'Trasferimento asset al trust',               cat: 'Trust',      h: 6,  p: 1700, ver: 1 },
  { id: 'A_REG_TRUST_MALTA',    n: 'Registrazione trust Malta',                  cat: 'Trust',      h: 4,  p: 1100, ver: 1 },
  { id: 'A_SEL_BANCHE',         n: 'Selezione banche idonee',                    cat: 'Banking',    h: 3,  p: 650,  ver: 1 },
  { id: 'A_KYC_CLIENTE',        n: 'Raccolta e verifica documentazione KYC',     cat: 'Compliance', h: 5,  p: 1150, ver: 2, documentiRichiesti: ['m3'], formMasterId: 'f3' },
  { id: 'A_APERTURA_CONTO',     n: 'Apertura conto corrente singolo',            cat: 'Banking',    h: 4,  p: 900,  ver: 1 },
  { id: 'A_INTERNET_BANKING',   n: 'Configurazione internet banking',             cat: 'Banking',    h: 2,  p: 450,  ver: 1 },
  { id: 'A_TEST_TRANSAZIONI',   n: 'Test flussi transazionali',                  cat: 'Banking',    h: 2,  p: 450,  ver: 1 },
  { id: 'A_LICENSING_IP',       n: 'Accordo licensing IP',                        cat: 'Legale',     h: 6,  p: 1500, ver: 1 },
  { id: 'A_LOAN_INTERCOMPANY',  n: 'Loan intercompany',                           cat: 'Legale',     h: 5,  p: 1200, ver: 1 },
  { id: 'A_MGMT_AGREEMENT',     n: 'Management agreement',                        cat: 'Legale',     h: 4,  p: 800,  ver: 1 },
  { id: 'A_REVISIONE_LEGALE',   n: 'Revisione e negoziazione legale',            cat: 'Legale',     h: 4,  p: 700,  ver: 1 },
  { id: 'A_CONTR_DISTRIBUZIONE',n: 'Contratto di distribuzione',                 cat: 'Legale',     h: 8,  p: 2000, ver: 1 },
  { id: 'A_NDA',                n: 'NDA e accordo di riservatezza',              cat: 'Legale',     h: 3,  p: 700,  ver: 1 },
  { id: 'A_CONTR_AGENZIA',      n: 'Contratto di agenzia e commissioni',         cat: 'Legale',     h: 6,  p: 1500, ver: 1 },
  { id: 'A_RICERCA_EUIPO',      n: 'Ricerca anteriorità marchio EUIPO',          cat: 'IP',         h: 3,  p: 800,  ver: 1 },
  { id: 'A_DEPOSITO_MARCHIO',   n: 'Deposito marchio EUIPO',                     cat: 'IP',         h: 4,  p: 1100, ver: 1 },
  { id: 'A_LICENZA_USO',        n: 'Contratto licenza d\'uso marchio',           cat: 'IP',         h: 5,  p: 1400, ver: 1 },
  { id: 'A_MONITOR_RINNOVO',    n: 'Monitoraggio e rinnovo',                     cat: 'IP',         h: 3,  p: 700,  ver: 1 },
  { id: 'A_ANALISI_IPA',        n: 'Analisi regime IPA Malta',                   cat: 'Fiscale',    h: 5,  p: 1600, ver: 2 },
  { id: 'A_STRUTT_RIMESSE',     n: 'Struttura rimesse e dividendi',              cat: 'Fiscale',    h: 5,  p: 1500, ver: 1 },
  { id: 'A_OTTIM_REFUND',       n: 'Ottimizzazione 6/7 refund mechanism',        cat: 'Fiscale',    h: 5,  p: 1600, ver: 1 },
  { id: 'A_REPORT_TAX',         n: 'Report tax planning definitivo',             cat: 'Fiscale',    h: 3,  p: 800,  ver: 1 },
  { id: 'A_DUE_DILIGENCE',      n: 'Due diligence cliente',                       cat: 'Compliance', h: 3,  p: 800,  ver: 1 },
  { id: 'A_REPORT_CRS_FATCA',   n: 'Reporting CRS/FATCA',                        cat: 'Compliance', h: 1,  p: 350,  ver: 1 },
  { id: 'A_AGG_ANNUALE',        n: 'Aggiornamento annuale compliance',            cat: 'Compliance', h: 1,  p: 200,  ver: 1 },
];

export const MLIB: ModuloTemplate[] = [
  { id: 'mod-m01', n: 'Analisi patrimoniale iniziale',  cat: 'Analisi',    ver: 2, giurisdizioneId: null, deps: [],       righe: [{ art: 'A_RACCOLTA_DOC' }, { art: 'A_ANALISI_STRUTT' }, { art: 'A_REPORT_ANALISI' }, { art: 'A_PRESENT_CLIENTE' }, { art: 'A_FIRMA_ENG' }] },
  { id: 'mod-m02', n: 'Corporate structuring Malta',    cat: 'Societario', ver: 3, giurisdizioneId: 'giur-mt', deps: ['mod-m01'],  pkg: 11500, righe: [{ art: 'A_STUDIO_STRUTT' }, { art: 'A_COST_SOCIETA' }, { art: 'A_ATTO_COST' }, { art: 'A_CONTRATTO_INTERCOMPANY' }, { art: 'A_REG_MFSA' }, { art: 'A_REG_FISCALE' }, { art: 'A_UBO' }] },
  { id: 'mod-m03', n: 'Holding internazionale',         cat: 'Societario', ver: 1, giurisdizioneId: null, deps: ['mod-m01'],  righe: [{ art: 'A_SEL_GIURISDIZIONE' }, { art: 'A_COST_HOLDING' }, { art: 'A_STRUTT_PARTECIPAZIONI' }, { art: 'A_CONTRATTO_SERVIZIO' }, { art: 'A_COMPLIANCE_ONGOING' }] },
  { id: 'mod-m04', n: 'Struttura Trust',                cat: 'Trust',      ver: 2, giurisdizioneId: null, deps: ['mod-m01'],  righe: [{ art: 'A_SEL_TRUST_CO' }, { art: 'A_DEED_TRUST' }, { art: 'A_LETTER_WISHES' }, { art: 'A_TRASF_ASSET' }, { art: 'A_REG_TRUST_MALTA' }] },
  { id: 'mod-m05', n: 'Apertura conti correnti',        cat: 'Banking',    ver: 1, giurisdizioneId: 'giur-mt', deps: ['mod-m02'],  righe: [{ art: 'A_SEL_BANCHE' }, { art: 'A_KYC_CLIENTE' }, { art: 'A_APERTURA_CONTO', qty: 2 }, { art: 'A_INTERNET_BANKING' }, { art: 'A_TEST_TRANSAZIONI' }] },
  { id: 'mod-m06', n: 'Contratti intra-societari',      cat: 'Legale',     ver: 1, giurisdizioneId: null, deps: ['mod-m02'],  righe: [{ art: 'A_CONTRATTO_SERVIZIO' }, { art: 'A_LICENSING_IP' }, { art: 'A_LOAN_INTERCOMPANY' }, { art: 'A_MGMT_AGREEMENT' }, { art: 'A_REVISIONE_LEGALE' }] },
  { id: 'mod-m07', n: 'Contratti con terzi',            cat: 'Legale',     ver: 1, giurisdizioneId: null, deps: ['mod-m02'],  righe: [{ art: 'A_CONTR_DISTRIBUZIONE' }, { art: 'A_NDA' }, { art: 'A_CONTR_AGENZIA' }, { art: 'A_REVISIONE_LEGALE', oO: 3, oP: 800 }] },
  { id: 'mod-m08', n: 'Gestione marchi e IP',           cat: 'IP',         ver: 1, giurisdizioneId: null, deps: ['mod-m02'],  righe: [{ art: 'A_RICERCA_EUIPO' }, { art: 'A_DEPOSITO_MARCHIO' }, { art: 'A_LICENZA_USO' }, { art: 'A_MONITOR_RINNOVO' }] },
  { id: 'mod-m09', n: 'Tax planning internazionale',    cat: 'Fiscale',    ver: 2, giurisdizioneId: 'giur-mt', deps: ['mod-m02'],  righe: [{ art: 'A_ANALISI_IPA' }, { art: 'A_STRUTT_RIMESSE' }, { art: 'A_OTTIM_REFUND' }, { art: 'A_REPORT_TAX' }] },
  { id: 'mod-m10', n: 'Compliance e KYC',               cat: 'Compliance', ver: 1, giurisdizioneId: null, deps: ['mod-m02'],  righe: [{ art: 'A_DUE_DILIGENCE' }, { art: 'A_KYC_CLIENTE' }, { art: 'A_REPORT_CRS_FATCA' }, { art: 'A_AGG_ANNUALE' }] },
];

export const PROJECTS: Progetto[] = [];

