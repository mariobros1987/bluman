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
  const base = TEAM.map(t => {
    // Verifica se ci sono iniziali o colori personalizzati dall'utente
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

  try {
    const customStr = localStorage.getItem('bluman_custom_team_users');
    if (customStr) {
      const customList = JSON.parse(customStr);
      if (Array.isArray(customList)) {
        customList.forEach((c: any, idx: number) => {
          const name = c.nome || c.name || c.n || c.email;
          if (name && !base.some(b => b.n.toLowerCase() === name.toLowerCase() || (c.email && b.n.toLowerCase().includes(c.email.toLowerCase())))) {
            const initials = c.iniziali || extractInitialsFromName(name);
            const id = typeof c.id === 'number' ? c.id : 10 + idx;
            base.push({
              id,
              n: name,
              r: c.specializzazione || c.ruolo || c.r || 'Collaboratore Studio',
              i: initials,
              c: c.colore || c.c || '#8b5cf6',
            });
          }
        });
      }
    }
  } catch {}
  return base;
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

export const PROJECTS: Progetto[] = [
  {
    id: 1, n: 'Struttura Holding — Famiglia Ricci', cl: 'Marco Ricci', ct: 'individual',
    st: 'in_progress', pct: 42, start: '01/04/2026', due: '31/07/2026', val: 38000,
    delay: true, fisc: 'privato_italia',
    fatture: [
      { tipo: 'modulo_completo', mid: 11, importo: 3500, desc: 'Analisi patrimoniale iniziale — saldo', stato: 'emessa' },
      { tipo: 'modulo_parziale', mid: 12, pct: 50, importo: 6000, desc: 'Corporate structuring Malta — acconto 50%', stato: 'emessa' },
      { tipo: 'milestone_libera', importo: 5000, desc: 'Acconto alla firma engagement letter', stato: 'incassata' },
    ],
    mods: [
      { id: 11, n: 'Analisi patrimoniale iniziale', cat: 'Analisi', st: 'done', pct: 100, h: 12, a: 11, p: 3500, team: [1,2], delay: false,
        v: [{ n:'Raccolta documentazione cliente',hE:2,hA:2,s:'done',as:2,d:3},{n:'Analisi struttura patrimoniale esistente',hE:4,hA:3.5,s:'done',as:1,d:1},{n:'Report analisi iniziale',hE:3,hA:3,s:'done',as:1,d:2},{n:'Presentazione al cliente',hE:2,hA:2.5,s:'done',as:1,d:1},{n:'Validazione e firma engagement letter',hE:1,hA:1,s:'done',as:2,d:2}] },
      { id: 12, n: 'Corporate structuring Malta', cat: 'Societario', st: 'in_progress', pct: 70, h: 40, a: 28, p: 12000, team: [1,3], delay: false,
        v: [{ n:'Studio struttura societaria ottimale',hE:6,hA:6,s:'done',as:1,d:2},{n:'Costituzione Cassio Consulting LTD',hE:8,hA:8,s:'done',as:2,d:5},{n:'Costituzione Solarys LTD (Holding)',hE:8,hA:8,s:'done',as:2,d:5},{n:'Contratto di servizio intercompany',hE:6,hA:3,s:'active',as:3,d:1},{n:'Registrazione fiscale e MFSA',hE:6,hA:0,s:'pending',as:2,d:0},{n:'Apertura VAT number EU',hE:4,hA:0,s:'pending',as:2,d:0},{n:'Documentazione UBO Registry',hE:2,hA:0,s:'pending',as:2,d:0}] },
      { id: 13, n: 'Struttura Trust', cat: 'Trust', st: 'in_progress', pct: 25, h: 30, a: 7.5, p: 8500, team: [1,3], delay: true, dn: 'In attesa documentazione fiduciaria dal trustee designato',
        v: [{ n:'Selezione trust company idonea',hE:4,hA:4,s:'done',as:1,d:1},{n:'Redazione deed of trust',hE:10,hA:3.5,s:'delayed',as:3,d:2,vn:'In attesa documentazione trustee'},{n:'Definizione letter of wishes',hE:6,hA:0,s:'pending',as:1,d:0},{n:'Trasferimento asset al trust',hE:6,hA:0,s:'pending',as:1,d:0},{n:'Registrazione trust Malta',hE:4,hA:0,s:'pending',as:2,d:0}] },
      { id: 14, n: 'Apertura conti correnti', cat: 'Banking', st: 'blocked', pct: 15, h: 20, a: 3, p: 4500, team: [1,2], delay: true, dn: 'KYC respinto da Bank of Valletta — documentazione integrativa urgente',
        v: [{ n:'Selezione banche idonee alla struttura',hE:3,hA:3,s:'done',as:1,d:1},{n:'Preparazione dossier KYC completo',hE:5,hA:0,s:'blocked',as:2,d:0,vn:'KYC respinto — integrazione documenti necessaria'},{n:'Apertura conto Cassio Consulting LTD',hE:4,hA:0,s:'pending',as:2,d:0},{n:'Apertura conto Solarys LTD',hE:4,hA:0,s:'pending',as:2,d:0},{n:'Configurazione internet banking',hE:2,hA:0,s:'pending',as:2,d:0},{n:'Test flussi transazionali intra-struttura',hE:2,hA:0,s:'pending',as:1,d:0}] },
      { id: 15, n: 'Tax planning internazionale', cat: 'Fiscale', st: 'attesa_dipendenza', pct: 0, h: 18, a: 0, p: 5500, team: [1,4], delay: false, waitDep: true, wdn: 'In attesa: Corporate structuring Malta (70% — non ancora completato)',
        v: [{ n:'Analisi regime IPA Malta',hE:5,hA:0,s:'attesa_dipendenza',as:4,d:0},{n:'Struttura rimesse e dividendi',hE:5,hA:0,s:'attesa_dipendenza',as:1,d:0},{n:'Ottimizzazione 6/7 refund mechanism',hE:5,hA:0,s:'attesa_dipendenza',as:4,d:0},{n:'Report tax planning definitivo',hE:3,hA:0,s:'attesa_dipendenza',as:1,d:0}] },
    ],
  },
  {
    id: 2, n: 'IP Protection — Belfort Industries', cl: 'Belfort Industries S.A.', ct: 'company',
    st: 'in_progress', pct: 18, start: '01/05/2026', due: '15/08/2026', val: 22000,
    delay: false, fisc: 'estero',
    fatture: [{ tipo: 'milestone_libera', importo: 5000, desc: 'Acconto alla firma engagement letter', stato: 'incassata' }],
    mods: [
      { id: 21, n: 'Gestione marchi e IP', cat: 'IP', st: 'in_progress', pct: 40, h: 15, a: 6, p: 4000, team: [1,3], delay: false,
        v: [{ n:'Ricerca anteriorità marchio EU',hE:3,hA:3,s:'done',as:3,d:2},{n:'Deposito marchio EUIPO',hE:4,hA:3,s:'active',as:3,d:1},{n:'Contratto licenza d\'uso marchio',hE:5,hA:0,s:'pending',as:3,d:0},{n:'Setup monitoraggio e rinnovo',hE:3,hA:0,s:'pending',as:2,d:0}] },
      { id: 22, n: 'Contratti con terzi', cat: 'Legale', st: 'pending', pct: 0, h: 20, a: 0, p: 5000, team: [1,3], delay: false,
        v: [{ n:'Contratto distribuzione commerciale',hE:8,hA:0,s:'pending',as:3,d:0},{n:'NDA e accordo di riservatezza',hE:3,hA:0,s:'pending',as:3,d:0},{n:'Contratto di agenzia e commissioni',hE:6,hA:0,s:'pending',as:3,d:0},{n:'Revisione e negoziazione finale',hE:3,hA:0,s:'pending',as:1,d:0}] },
    ],
  },
  {
    id: 3, n: 'Pre-analisi — Famiglia Conti', cl: 'Andrea & Sofia Conti', ct: 'individual',
    st: 'pre_project', pct: 60, start: '20/05/2026', due: '10/06/2026', val: 3500,
    delay: false, fisc: 'privato_italia', fatture: [],
    mods: [
      { id: 31, n: 'Analisi patrimoniale iniziale', cat: 'Analisi', st: 'in_progress', pct: 60, h: 12, a: 7, p: 3500, team: [1,2], delay: false,
        v: [{ n:'Raccolta documentazione cliente',hE:2,hA:2,s:'done',as:2,d:4},{n:'Analisi struttura patrimoniale esistente',hE:4,hA:3,s:'active',as:1,d:1},{n:'Report analisi iniziale',hE:3,hA:0,s:'pending',as:1,d:0},{n:'Presentazione cliente e proposta progetto',hE:2,hA:0,s:'pending',as:1,d:0},{n:'Firma engagement letter',hE:1,hA:0,s:'pending',as:2,d:0}] },
    ],
  },
];
