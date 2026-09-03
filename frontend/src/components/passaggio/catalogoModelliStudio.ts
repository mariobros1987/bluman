import { PREBUILT_TEMPLATES, type DocumentTemplate } from '../../utils/documentTemplates';
import { REORGANIZATION_TEMPLATES } from '../../utils/reorganizationTemplates';

export interface RecommendationResult {
  template: DocumentTemplate | null;
  confidence: 'high' | 'medium' | 'low';
  reason: string;
}

// Tutte le 30 cartelle e modelli studio disponibili
export const ALL_STUDIO_TEMPLATES: DocumentTemplate[] = [
  ...PREBUILT_TEMPLATES,
  ...REORGANIZATION_TEMPLATES.filter(rt => !PREBUILT_TEMPLATES.some(pt => pt.id === rt.id)),
];

/**
 * Motore di Pre-screening Intelligente Studio BluMan
 * Analizza la microvoce, il modulo e la categoria e individua il modello più idoneo.
 */
export function getSmartDocumentRecommendation(voceTitle: string, category: string = '', moduleName: string = ''): RecommendationResult {
  const v = voceTitle.toLowerCase();
  const c = category.toLowerCase();
  const m = moduleName.toLowerCase();

  // 1. Intake, KYC, Antiriciclaggio, Raccolta Documenti
  if (v.includes('kyc') || v.includes('intake') || v.includes('questionario') || v.includes('adeguata verifica') || v.includes('antiriciclaggio') || v.includes('raccolta doc')) {
    const tmpl = ALL_STUDIO_TEMPLATES.find(t => t.id === 'tmpl-01-1-questionario-intake-cliente' || t.id === 'tmpl-ubo' || t.id === 'tmpl-antiriciclaggio') || ALL_STUDIO_TEMPLATES[0];
    return {
      template: tmpl,
      confidence: 'high',
      reason: 'Rilevata fase di onboarding/compliance: consigliato il Questionario Intake & Adeguata Verifica Antiriciclaggio.',
    };
  }

  // 2. Trust, Fiduciaria, Protezione Patrimoniale
  if (v.includes('trust') || v.includes('fiduciar') || v.includes('deed') || v.includes('wishes') || c.includes('trust') || m.includes('trust')) {
    const tmpl = ALL_STUDIO_TEMPLATES.find(t => t.id === 'tmpl-trust-malta' || t.categoria === 'trust') || ALL_STUDIO_TEMPLATES[0];
    return {
      template: tmpl,
      confidence: 'high',
      reason: 'Rilevata operazione fiduciaria: consigliato il Deed of Trust con clausole di protezione e Letter of Wishes.',
    };
  }

  // 3. Exit Tax, Fiscalità Internazionale, CFC, Residenza Fiscale
  if (v.includes('exit tax') || v.includes('rateizzazione') || v.includes('plusvalenz') || v.includes('trasferimento residenza')) {
    const tmpl = ALL_STUDIO_TEMPLATES.find(t => t.id === 'tmpl-01-3-memo-valutazione-exit-tax' || t.id === 'tmpl-06-1-memo-procedurale-exit-tax-rateizzazione') || ALL_STUDIO_TEMPLATES[0];
    return {
      template: tmpl,
      confidence: 'high',
      reason: 'Rilevato adempimento fiscale straordinario: consigliato il Memo Valutazione Exit Tax ex art. 166 TUIR.',
    };
  }
  if (v.includes('analisi fiscale') || v.includes('cfc') || v.includes('esterovestizione') || v.includes('interpello') || c.includes('fiscale')) {
    const tmpl = ALL_STUDIO_TEMPLATES.find(t => t.id === 'tmpl-01-2-memo-analisi-fiscale-preliminare') || ALL_STUDIO_TEMPLATES[0];
    return {
      template: tmpl,
      confidence: 'high',
      reason: 'Rilevata perizia tributaria: consigliato il Memo di Analisi Fiscale Preliminare & Sostanza Economica.',
    };
  }

  // 4. Costituzione Società, Statuto, Holding, Atto Costitutivo
  if (v.includes('statuto') || v.includes('costituz') || v.includes('atto') || v.includes('holding') || v.includes('ltd') || v.includes('societ') || c.includes('societario') || m.includes('structuring')) {
    const tmpl = ALL_STUDIO_TEMPLATES.find(t => t.id === 'tmpl-statuto-holding' || t.id === 'tmpl-02-3-checklist-costituzione-societa-estera' || t.id === 'tmpl-02-1-memorandum-struttura') || ALL_STUDIO_TEMPLATES[0];
    return {
      template: tmpl,
      confidence: 'high',
      reason: 'Rilevata costituzione/corporate structuring: consigliato lo Statuto Standard Holding o Memorandum di Struttura.',
    };
  }

  // 5. Cessione Quote, Patti Parasociali, M&A
  if (v.includes('cessione') || v.includes('quote') || v.includes('partecipaz') || v.includes('compravendita')) {
    const tmpl = ALL_STUDIO_TEMPLATES.find(t => t.titolo.toLowerCase().includes('cessione') || t.id.includes('cessione')) || ALL_STUDIO_TEMPLATES[0];
    return {
      template: tmpl,
      confidence: 'high',
      reason: 'Rilevato trasferimento partecipazioni: consigliato il Contratto di Cessione Quote con clausole di garanzia.',
    };
  }

  // 6. Banche, Conti Correnti, KYC Bancario
  if (v.includes('banc') || v.includes('conto') || v.includes('emi') || v.includes('iban') || c.includes('banking')) {
    const tmpl = ALL_STUDIO_TEMPLATES.find(t => t.id === 'tmpl-03-1-matrice-comparativa-istituti-bancari' || t.id === 'tmpl-03-3-procedura-apertura-conto-societario') || ALL_STUDIO_TEMPLATES[0];
    return {
      template: tmpl,
      confidence: 'high',
      reason: 'Rilevato dossier bancario: consigliata la Procedura di Apertura Conto Societario & Matrice Banche.',
    };
  }

  // 7. Marchi, Proprietà Intellettuale (IP), Licenze
  if (v.includes('marchi') || v.includes('ip') || v.includes('brevett') || v.includes('euipo') || c.includes('ip')) {
    const tmpl = ALL_STUDIO_TEMPLATES.find(t => t.id === 'tmpl-05-3-bozza-contratto-cessione-licenza-ip' || t.id === 'tmpl-05-2-procedura-deposito-marchio') || ALL_STUDIO_TEMPLATES[0];
    return {
      template: tmpl,
      confidence: 'high',
      reason: 'Rilevata tutela asset intangibili: consigliato il Contratto di Cessione e Licenza d\'Uso Marchio/IP.',
    };
  }

  // 8. Engagement, Mandato, Accordo di Riservatezza NDA
  if (v.includes('nda') || v.includes('riservatezza') || v.includes('segreto')) {
    const tmpl = ALL_STUDIO_TEMPLATES.find(t => t.id === 'tmpl-nda') || ALL_STUDIO_TEMPLATES[0];
    return {
      template: tmpl,
      confidence: 'high',
      reason: 'Rilevato scambio preliminare informazioni: consigliato il Non-Disclosure Agreement (NDA) bilaterale.',
    };
  }
  if (v.includes('incarico') || v.includes('mandato') || v.includes('lettera') || v.includes('preventivo')) {
    const tmpl = ALL_STUDIO_TEMPLATES.find(t => t.id === 'tmpl-engagement') || ALL_STUDIO_TEMPLATES[0];
    return {
      template: tmpl,
      confidence: 'high',
      reason: 'Rilevato avvio formale incarico: consigliata la Lettera d\'Incarico Professionale (Engagement Letter).',
    };
  }

  // Fallback a suggerimento medio
  const fallbackTmpl = ALL_STUDIO_TEMPLATES.find(t => t.categoria === (c as any)) || ALL_STUDIO_TEMPLATES[0];
  return {
    template: fallbackTmpl,
    confidence: 'medium',
    reason: `Attività generale di categoria ${category || 'Advisory'}: puoi associare un modello correlato o lasciare l'attività senza documenti.`,
  };
}
