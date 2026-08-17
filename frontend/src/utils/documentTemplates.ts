export interface DocumentTemplate {
  id: string;
  titolo: string;
  categoria: 'contratto' | 'nda' | 'engagement' | 'societario' | 'delega' | 'fiscale' | 'trust' | 'compliance';
  descrizione: string;
  contenutoHtml: string;
  archiviato?: boolean;
  dataCreazione?: string;
}

export const PREBUILT_TEMPLATES: DocumentTemplate[] = [
  {
    id: 'tmpl-engagement',
    titolo: 'Lettera d\'Incarico Professionale (Engagement Letter)',
    categoria: 'engagement',
    descrizione: 'Mandato di consulenza patrimoniale e corporate structuring con compenso e firma 1-click.',
    contenutoHtml: `
<h1 style="text-align: center; color: #1e1b4b; margin-bottom: 20px; font-size: 20px; text-transform: uppercase; letter-spacing: 0.5px;">
  LETTERA D'INCARICO PROFESSIONALE E MANDATO FIDUCIARIO
</h1>

<p style="text-align: right; color: #64748b; font-size: 11px; margin-bottom: 25px;">
  <strong>Data di emissione:</strong> {{data_odierna}} | <strong>Rif. Pratica:</strong> {{progetto.titolo}}
</p>

<div style="background: #f8fafc; border-left: 4px solid #4338ca; padding: 12px 16px; margin-bottom: 25px; font-size: 11.5px; line-height: 1.6;">
  <strong>TRA LE PARTI:</strong><br/>
  <strong>Lo Studio Professionale:</strong> {{studio.ragione_sociale}}, con sede legale in {{studio.sede_legale}}, P.IVA/TIN {{studio.piva}}, rappresentato da Joe Disabato (Senior Partner Advisory).<br/><br/>
  <strong>E Il Cliente Committente:</strong> <strong>{{cliente.ragione_sociale}}</strong>, con sede legale in {{cliente.sede_legale}}, Codice Fiscale / P.IVA <code>{{cliente.partita_iva}}</code>, Codice SDI <code>{{cliente.sdi}}</code>, rappresentato dal Sig. <strong>{{cliente.referente}}</strong> (in qualità di Legale Rappresentante e UBO).
</div>

<h3 style="color: #1e1b4b; border-bottom: 1px solid #e2e8f0; padding-bottom: 4px; font-size: 13px; margin-top: 20px;">
  1. OGGETTO DELL'INCARICO
</h3>
<p style="font-size: 11.5px; line-height: 1.6; text-align: justify;">
  Il Cliente affida allo Studio l'incarico professionale di consulenza strategica, assistenza societaria e strutturazione internazionale avente ad oggetto l'esecuzione del progetto denominato <strong>"{{progetto.titolo}}"</strong>, comprensivo delle relative microvoci operative, della redazione degli atti societari, del supporto alla compliance KYC/AML e del coordinamento con le autorità competenti.
</p>

<h3 style="color: #1e1b4b; border-bottom: 1px solid #e2e8f0; padding-bottom: 4px; font-size: 13px; margin-top: 20px;">
  2. COMPENSI PROFESSIONALI E MODALITÀ DI PAGAMENTO
</h3>
<p style="font-size: 11.5px; line-height: 1.6; text-align: justify;">
  Per l'espletamento dell'incarico sopra descritto, viene pattuito un compenso complessivo omnicomprensivo pari ad <strong>{{progetto.importo_totale}}</strong>, oltre eventuali oneri di legge e spese vive anticipate. Il pagamento avverrà tramite bonifico bancario sulle coordinate IBAN dello Studio: <code>{{studio.iban}}</code>, secondo le scadenze concordate nel piano di fatturazione.
</p>

<h3 style="color: #1e1b4b; border-bottom: 1px solid #e2e8f0; padding-bottom: 4px; font-size: 13px; margin-top: 20px;">
  3. RISERVATEZZA E TRATTAMENTO DATI (GDPR)
</h3>
<p style="font-size: 11.5px; line-height: 1.6; text-align: justify;">
  Tutte le informazioni, i documenti patrimoniali e i dati societari scambiati tra le Parti saranno trattati con la massima riservatezza e nel rispetto del Regolamento UE 2016/679 (GDPR), con conservazione crittografata all'interno del Vault Documentale Sicuro dello Studio.
</p>

<h3 style="color: #1e1b4b; border-bottom: 1px solid #e2e8f0; padding-bottom: 4px; font-size: 13px; margin-top: 20px;">
  4. FORO COMPETENTE E LEGGE APPLICABILE
</h3>
<p style="font-size: 11.5px; line-height: 1.6; text-align: justify;">
  Il presente accordo è regolato dalla legge maltese/italiana. Per ogni eventuale controversia sarà competente in via esclusiva il Foro di competenza della sede legale dello Studio.
</p>

<div style="margin-top: 40px; display: flex; justify-content: space-between; page-break-inside: avoid;">
  <div style="width: 45%; text-align: center; border-top: 1px dashed #94a3b8; padding-top: 8px; font-size: 11px;">
    <strong>Per Lo Studio:</strong><br/>
    {{studio.ragione_sociale}}<br/>
    <span style="color: #64748b; font-size: 10px;">(Firma Digitale Autorizzata)</span>
  </div>
  <div style="width: 45%; text-align: center; border-top: 1px dashed #94a3b8; padding-top: 8px; font-size: 11px;">
    <strong>Per Il Cliente Committente:</strong><br/>
    {{cliente.referente}}<br/>
    <span style="color: #4338ca; font-weight: 700; font-size: 10px;">[ Sottoscrizione FEA 1-Click eIDAS ]</span>
  </div>
</div>
`,
  },
  {
    id: 'tmpl-nda',
    titolo: 'Accordo di Riservatezza & Non Divulgazione (NDA)',
    categoria: 'nda',
    descrizione: 'Accordo bilaterale di riservatezza per analisi patrimoniali e due diligence pre-incarico.',
    contenutoHtml: `
<h1 style="text-align: center; color: #1e1b4b; margin-bottom: 20px; font-size: 19px; text-transform: uppercase;">
  ACCORDO BILATERALE DI RISERVATEZZA E NON DIVULGAZIONE (NDA)
</h1>

<p style="text-align: center; color: #64748b; font-size: 11px; margin-bottom: 25px;">
  Stipulato in data {{data_odierna}} in relazione alla pratica <strong>{{progetto.titolo}}</strong>
</p>

<p style="font-size: 11.5px; line-height: 1.6; text-align: justify;">
  <strong>TRA:</strong> <strong>{{studio.ragione_sociale}}</strong> (di seguito "Parte Ricevente") e <strong>{{cliente.ragione_sociale}}</strong> (P.IVA {{cliente.partita_iva}}, rappresentata da {{cliente.referente}}, di seguito "Parte Divulgante").
</p>

<h3 style="color: #1e1b4b; font-size: 12.5px; margin-top: 18px;">1. DEFINIZIONE DI INFORMAZIONI RISERVATE</h3>
<p style="font-size: 11.5px; line-height: 1.6; text-align: justify;">
  Si considerano "Informazioni Riservate" tutti i dati societari, patrimoniali, contabili, bancari, know-how, strategie di pianificazione fiscale e documenti KYC scambiati per la valutazione della struttura aziendale.
</p>

<h3 style="color: #1e1b4b; font-size: 12.5px; margin-top: 18px;">2. OBBLIGHI DI SEGRETEZZA</h3>
<p style="font-size: 11.5px; line-height: 1.6; text-align: justify;">
  Le Parti si impegnano a custodire con la massima diligenza professionale le informazioni ricevute, a non divulgarle a terzi non autorizzati e ad utilizzarle esclusivamente per l'esecuzione del mandato professionale.
</p>

<div style="margin-top: 40px; display: flex; justify-content: space-between;">
  <div style="width: 45%; text-align: center; border-top: 1px solid #cbd5e1; padding-top: 8px; font-size: 11px;">
    <strong>Per Lo Studio:</strong><br/>
    {{studio.ragione_sociale}}
  </div>
  <div style="width: 45%; text-align: center; border-top: 1px solid #cbd5e1; padding-top: 8px; font-size: 11px;">
    <strong>Per Il Cliente:</strong><br/>
    {{cliente.ragione_sociale}} ({{cliente.referente}})
  </div>
</div>
`,
  },
  {
    id: 'tmpl-memorandum',
    titolo: 'Memorandum & Statuto Società Malta (MFSA Filing)',
    categoria: 'societario',
    descrizione: 'Sintesi costitutiva per società LTD maltese con struttura partecipazioni, quote e UBO.',
    contenutoHtml: `
<h1 style="text-align: center; color: #1e1b4b; margin-bottom: 20px; font-size: 19px; text-transform: uppercase;">
  MEMORANDUM & ARTICLES OF ASSOCIATION (MALTA LTD)
</h1>

<div style="background: #f1f5f9; padding: 14px; border-radius: 8px; margin-bottom: 20px; font-size: 11.5px; line-height: 1.7;">
  <strong>Company Name:</strong> {{progetto.titolo}} (Malta Limited Company)<br/>
  <strong>Jurisdiction:</strong> Republic of Malta (MFSA / MBR Registered)<br/>
  <strong>Registered Office:</strong> {{studio.sede_legale}}<br/>
  <strong>Ultimate Beneficial Owner (UBO):</strong> {{cliente.referente}} ({{cliente.ragione_sociale}})<br/>
  <strong>Authorized Share Capital:</strong> € 1,200 divided into 1,200 Ordinary Shares of € 1.00 each.
</div>

<h3 style="color: #1e1b4b; font-size: 12.5px;">1. CORPORATE OBJECTS & TRADING ACTIVITIES</h3>
<p style="font-size: 11.5px; line-height: 1.6; text-align: justify;">
  The Company is established to carry on the business of international commercial trading, management consulting, holding of participating interests, and intellectual property licensing under the Malta Business Companies Act (Cap. 386).
</p>

<h3 style="color: #1e1b4b; font-size: 12.5px;">2. TAX REGIME APPLICABILITY</h3>
<p style="font-size: 11.5px; line-height: 1.6; text-align: justify;">
  The Company is eligible for the full imputation tax system with a 6/7ths refund mechanism on distributed trading dividends, resulting in an effective tax burden of 5% in accordance with the Malta Income Tax Act.
</p>
`,
  },
  {
    id: 'tmpl-intercompany',
    titolo: 'Contratto di Servizi Intra-Societari (Intercompany Agreement)',
    categoria: 'contratto',
    descrizione: 'Accordo per prestazioni di servizi di management e consulenza in conformità Transfer Pricing.',
    contenutoHtml: `
<h1 style="text-align: center; color: #1e1b4b; margin-bottom: 20px; font-size: 19px; text-transform: uppercase;">
  INTERCOMPANY MANAGEMENT SERVICES AGREEMENT
</h1>

<p style="font-size: 11.5px; line-height: 1.6; text-align: justify;">
  Il presente accordo quadro di servizi infra-gruppo è stipulato in data {{data_odierna}} tra <strong>{{studio.ragione_sociale}}</strong> e la società committente <strong>{{cliente.ragione_sociale}}</strong> (P.IVA {{cliente.partita_iva}}).
</p>

<h3 style="color: #1e1b4b; font-size: 12.5px;">1. PRESTAZIONI DI SERVIZI E CORRISPETTIVO</h3>
<p style="font-size: 11.5px; line-height: 1.6; text-align: justify;">
  La Capogruppo presterà a favore della Controllata servizi continuativi di direzione strategica, consulenza legale, supporto marketing e gestione contabile. Il corrispettivo annuale è pattuito a condizioni di piena concorrenza (Arm's Length Principle).
</p>
`,
  },
  {
    id: 'tmpl-delega',
    titolo: 'Procura Speciale & Delega Operativa (Power of Attorney)',
    categoria: 'delega',
    descrizione: 'Delega conferita allo Studio per il deposito pratiche MFSA, Agenzia Entrate e banche.',
    contenutoHtml: `
<h1 style="text-align: center; color: #1e1b4b; margin-bottom: 20px; font-size: 19px; text-transform: uppercase;">
  PROCURA SPECIALE E DELEGA DI RAPPRESENTANZA (POWER OF ATTORNEY)
</h1>

<p style="font-size: 11.5px; line-height: 1.6; text-align: justify;">
  Il sottoscritto <strong>{{cliente.referente}}</strong>, in qualità di Legale Rappresentante di <strong>{{cliente.ragione_sociale}}</strong> (Codice Fiscale {{cliente.codice_fiscale}}), con la presente
</p>

<h3 style="text-align: center; color: #4338ca; margin: 15px 0;">DELEGA E NOMINA</h3>

<p style="font-size: 11.5px; line-height: 1.6; text-align: justify;">
  Lo Studio <strong>{{studio.ragione_sociale}}</strong> a rappresentare la società mandante innanzi a qualsiasi Ufficio Pubblico, Autorità di Vigilanza (MFSA / MBR / Agenzia delle Entrate) e Istituti Bancari, per il compimento di tutti gli atti connessi al dossier <strong>{{progetto.titolo}}</strong>.
</p>

<div style="margin-top: 40px; text-align: right;">
  <p style="font-size: 11px; color: #64748b;">Firma del Delegante:</p>
  <p style="font-size: 12px; font-weight: 700; color: #1e1b4b;">{{cliente.referente}}</p>
</div>
`,
  },
  {
    id: 'tmpl-letter-of-wishes',
    titolo: 'Letter of Wishes per Struttura Trust (Deed of Trust)',
    categoria: 'trust',
    descrizione: 'Lettera confidenziale del disponente (Settlor) con le direttive per la gestione dei beni in Trust.',
    contenutoHtml: `
<h1 style="text-align: center; color: #1e1b4b; margin-bottom: 20px; font-size: 19px; text-transform: uppercase;">
  CONFIDENTIAL LETTER OF WISHES (TRUST DEED)
</h1>

<p style="text-align: right; color: #64748b; font-size: 11px; margin-bottom: 20px;">
  <strong>Data:</strong> {{data_odierna}} | <strong>Rif. Trust:</strong> {{progetto.titolo}}
</p>

<p style="font-size: 11.5px; line-height: 1.6; text-align: justify;">
  <strong>To the Trustees of:</strong> <strong>{{progetto.titolo}}</strong><br/>
  <strong>From the Settlor:</strong> <strong>{{cliente.referente}}</strong> (on behalf of {{cliente.ragione_sociale}}).
</p>

<h3 style="color: #1e1b4b; font-size: 12.5px; margin-top: 18px;">1. SCOPO E PRINCIPI GUIDA</h3>
<p style="font-size: 11.5px; line-height: 1.6; text-align: justify;">
  La presente Lettera di Desideri esprime i miei auspici per l'amministrazione, la protezione e la successiva distribuzione del fondo in Trust. Sebbene non vincolante legalmente ai sensi del Trust Act, confido che i Trustees considerino attentamente le mie indicazioni nel pieno rispetto del loro dovere fiduciario.
</p>

<h3 style="color: #1e1b4b; font-size: 12.5px; margin-top: 18px;">2. PROTEZIONE E DISTRIBUZIONE BENEFICIARI</h3>
<p style="font-size: 11.5px; line-height: 1.6; text-align: justify;">
  Desidero che il fondo in Trust sia primariamente orientato a garantire la stabilità economica e la continuità generazionale dei Beneficiari designati, preservando l'integrità del patrimonio da rischi commerciali o di aggressione patrimoniale ingiustificata.
</p>

<div style="margin-top: 40px; display: flex; justify-content: space-between;">
  <div style="width: 45%; text-align: center; border-top: 1px solid #cbd5e1; padding-top: 8px; font-size: 11px;">
    <strong>The Settlor:</strong><br/>
    {{cliente.referente}}
  </div>
  <div style="width: 45%; text-align: center; border-top: 1px solid #cbd5e1; padding-top: 8px; font-size: 11px;">
    <strong>Received by Advisory Trustee:</strong><br/>
    {{studio.ragione_sociale}}
  </div>
</div>
`,
  },
  {
    id: 'tmpl-compliance',
    titolo: 'Dichiarazione Titolare Effettivo (UBO Registry & KYC)',
    categoria: 'compliance',
    descrizione: 'Dichiarazione di trasparenza del Beneficiary Owner ai sensi della V Direttiva Antiriciclaggio UE 2018/843.',
    contenutoHtml: `
<h1 style="text-align: center; color: #1e1b4b; margin-bottom: 20px; font-size: 19px; text-transform: uppercase;">
  DICHIARAZIONE SOSTITUTIVA TITOLARE EFFETTIVO (UBO DECLARATION)
</h1>

<p style="font-size: 11.5px; line-height: 1.6; text-align: justify;">
  Il sottoscritto <strong>{{cliente.referente}}</strong>, nato a Milano il 12/04/1980, Codice Fiscale <strong>{{cliente.codice_fiscale}}</strong>, in qualità di Legale Rappresentante della società <strong>{{cliente.ragione_sociale}}</strong> (P.IVA {{cliente.partita_iva}}),
</p>

<h3 style="text-align: center; color: #4338ca; margin: 15px 0;">DICHIARA SOTTO LA PROPRIA RESPONSABILITÀ</h3>

<p style="font-size: 11.5px; line-height: 1.6; text-align: justify;">
  che il Titolare Effettivo (Ultimate Beneficial Owner - UBO) dell'entità mandante ai sensi della Direttiva (UE) 2018/843 e della normativa antiriciclaggio vigente è il Sig. <strong>{{cliente.referente}}</strong> con quota di partecipazione pari al 100%.
</p>

<div style="margin-top: 40px; display: flex; justify-content: space-between;">
  <div style="width: 45%; text-align: center; border-top: 1px solid #cbd5e1; padding-top: 8px; font-size: 11px;">
    Data: {{data_odierna}}
  </div>
  <div style="width: 45%; text-align: center; border-top: 1px solid #cbd5e1; padding-top: 8px; font-size: 11px;">
    Firma UBO: <strong>{{cliente.referente}}</strong>
  </div>
</div>
`,
  },
];

/**
 * Sostituisce le variabili dinamiche (Mail Merge) Smart Tags
 */
export function resolveDocumentTemplateHtml(
  htmlContent: string,
  context: {
    cliente?: any;
    progetto?: any;
    studio?: any;
    isForPrintOrExport?: boolean;
    tagMode?: 'highlight' | 'plain' | 'raw';
  }
): string {
  const { cliente, progetto, studio, isForPrintOrExport = false, tagMode = 'highlight' } = context;

  if (tagMode === 'raw' && !isForPrintOrExport) return htmlContent;

  const dataOggi = new Date().toLocaleDateString('it-IT', { day: '2-digit', month: 'long', year: 'numeric' });
  const refJson: any = cliente?.referentiJson && typeof cliente.referentiJson === 'object' ? cliente.referentiJson : {};

  const projTitolo = progetto?.titolo || progetto?.n || progetto?.nome || 'Costituzione Holding & Trading Malta';
  const projImporto = progetto?.totalePreventivo || progetto?.val || 8500;

  const wrapTag = (value: string, tagCode: string) => {
    if (isForPrintOrExport || tagMode === 'plain') return value;
    return `<span class="bluman-smart-chip" title="Smart Tag ERP: {{${tagCode}}}" style="background: rgba(99, 102, 241, 0.14); color: #4338ca; border: 1px solid rgba(99, 102, 241, 0.35); border-bottom: 2px solid #4f46e5; border-radius: 4px; padding: 1px 6px; font-weight: 600; cursor: help; display: inline-block; box-shadow: 0 1px 3px rgba(99,102,241,0.12);">🏷️ ${value}</span>`;
  };

  let out = htmlContent;
  out = out.replace(/\{\{data_odierna\}\}/g, wrapTag(dataOggi, 'data_odierna'));
  out = out.replace(/\{\{cliente\.ragione_sociale\}\}/g, wrapTag(cliente?.nome || 'Holding Beta S.r.l.', 'cliente.ragione_sociale'));
  out = out.replace(/\{\{cliente\.nome\}\}/g, wrapTag(cliente?.nome || 'Holding Beta S.r.l.', 'cliente.nome'));
  out = out.replace(/\{\{cliente\.partita_iva\}\}/g, wrapTag(cliente?.piva || cliente?.codiceFiscale || 'IT09876543210', 'cliente.partita_iva'));
  out = out.replace(/\{\{cliente\.codice_fiscale\}\}/g, wrapTag(cliente?.codiceFiscale || cliente?.piva || 'IT09876543210', 'cliente.codice_fiscale'));
  out = out.replace(/\{\{cliente\.sede_legale\}\}/g, wrapTag(cliente?.sedeLegale || 'Via Montenapoleone 8, Milano', 'cliente.sede_legale'));
  out = out.replace(/\{\{cliente\.pec\}\}/g, wrapTag(cliente?.pec || 'holdingbeta@legalmail.it', 'cliente.pec'));
  out = out.replace(/\{\{cliente\.sdi\}\}/g, wrapTag(cliente?.codiceSdi || 'SUBM70N', 'cliente.sdi'));
  out = out.replace(/\{\{cliente\.iban\}\}/g, wrapTag(cliente?.iban || 'IT60X0542811101000000123456', 'cliente.iban'));
  out = out.replace(/\{\{cliente\.referente\}\}/g, wrapTag(cliente?.referenteNome || refJson.referente || 'Ing. Roberto Rossi (CEO)', 'cliente.referente'));
  out = out.replace(/\{\{cliente\.cellulare\}\}/g, wrapTag(cliente?.cellulare || '+39 333 5936278', 'cliente.cellulare'));
  out = out.replace(/\{\{cliente\.ubo\}\}/g, wrapTag(cliente?.ubo || cliente?.referenteNome || 'Roberto Rossi', 'cliente.ubo'));

  out = out.replace(/\{\{progetto\.titolo\}\}/g, wrapTag(projTitolo, 'progetto.titolo'));
  out = out.replace(/\{\{progetto\.importo_totale\}\}/g, wrapTag(`€ ${Number(projImporto).toLocaleString('it-IT')},00`, 'progetto.importo_totale'));

  out = out.replace(/\{\{studio\.ragione_sociale\}\}/g, wrapTag(studio?.ragioneSociale || 'Bluecode Ltd', 'studio.ragione_sociale'));
  out = out.replace(/\{\{studio\.piva\}\}/g, wrapTag(studio?.piva || 'MT28491039', 'studio.piva'));
  out = out.replace(/\{\{studio\.sede_legale\}\}/g, wrapTag(studio?.sedeLegale || 'Level 4, Valuation Centre, Tower Road, Sliema SLM 1600, Malta', 'studio.sede_legale'));
  out = out.replace(/\{\{studio\.iban\}\}/g, wrapTag(studio?.iban || 'MT89VALL22013000000012345678', 'studio.iban'));

  return out;
}

/**
 * Associa qualsiasi MicroVoce del progetto al relativo Modello Word Ufficiale
 */
export function getTemplateForVoce(voceTitle: string, category: string = ''): DocumentTemplate {
  const v = voceTitle.toLowerCase();
  const c = category.toLowerCase();

  if (v.includes('engagement') || v.includes('incarico') || v.includes('firma') || v.includes('mandato')) {
    return PREBUILT_TEMPLATES.find(t => t.id === 'tmpl-engagement')!;
  }
  if (v.includes('nda') || v.includes('riservatezza') || v.includes('segreto') || v.includes('briefing') || v.includes('raccolta doc')) {
    return PREBUILT_TEMPLATES.find(t => t.id === 'tmpl-nda')!;
  }
  if (v.includes('trust') || v.includes('wishes') || v.includes('fiduciari') || c.includes('trust')) {
    return PREBUILT_TEMPLATES.find(t => t.id === 'tmpl-letter-of-wishes')!;
  }
  if (v.includes('ubo') || v.includes('kyc') || v.includes('antiriciclaggio') || v.includes('compliance') || c.includes('compliance')) {
    return PREBUILT_TEMPLATES.find(t => t.id === 'tmpl-compliance')!;
  }
  if (v.includes('intercompany') || v.includes('servizio') || v.includes('management') || v.includes('contratto')) {
    return PREBUILT_TEMPLATES.find(t => t.id === 'tmpl-intercompany')!;
  }
  if (v.includes('delega') || v.includes('procura') || v.includes('mfsa') || v.includes('banc')) {
    return PREBUILT_TEMPLATES.find(t => t.id === 'tmpl-delega')!;
  }
  if (v.includes('costituzione') || v.includes('statuto') || v.includes('atto') || v.includes('holding') || c.includes('societario')) {
    return PREBUILT_TEMPLATES.find(t => t.id === 'tmpl-memorandum')!;
  }

  return PREBUILT_TEMPLATES[0];
}

/**
 * Restituisce tutti i modelli (Predefiniti + Modelli Master Personalizzati creati o importati dallo studio)
 * Parametro includeArchived: se false, esclude i modelli contrassegnati come archiviati.
 * 
 * GARANZIA IMMUTABILITÀ: I documenti già istanziati, firmati o salvati all'interno dei singoli Progetti
 * sono copie indipendenti e congelate alla data della firma. Modificare, archiviare o eliminare un modello
 * nella Libreria NON altera in alcun modo i documenti storici dei Progetti.
 */
export function getAllTemplates(includeArchived: boolean = true): DocumentTemplate[] {
  try {
    const archivedIdsStr = localStorage.getItem('bluman_archived_template_ids');
    const archivedIds = new Set<string>(archivedIdsStr ? JSON.parse(archivedIdsStr) : []);

    const deletedIdsStr = localStorage.getItem('bluman_deleted_template_ids');
    const deletedIds = new Set<string>(deletedIdsStr ? JSON.parse(deletedIdsStr) : []);

    const customStr = localStorage.getItem('bluman_custom_document_templates');
    const customArr: DocumentTemplate[] = customStr ? JSON.parse(customStr) : [];
    const prebuiltFiltered = PREBUILT_TEMPLATES.filter(p => !deletedIds.has(p.id));
    const prebuiltIds = new Set(prebuiltFiltered.map(t => t.id));
    const uniqueCustom = customArr.filter(c => !prebuiltIds.has(c.id) && !deletedIds.has(c.id));

    const combined: DocumentTemplate[] = [...prebuiltFiltered, ...uniqueCustom].map(t => ({
      ...t,
      archiviato: archivedIds.has(t.id) || !!t.archiviato,
    }));

    if (!includeArchived) {
      return combined.filter(t => !t.archiviato);
    }
    return combined;
  } catch {
    return PREBUILT_TEMPLATES;
  }
}

/**
 * Salva o aggiorna un Modello Master personalizzato nello storage persistente dello studio
 */
export function saveCustomTemplate(tmpl: DocumentTemplate): DocumentTemplate[] {
  const current = getAllTemplates(true);
  const exists = current.some(t => t.id === tmpl.id);
  const updated = exists ? current.map(t => t.id === tmpl.id ? tmpl : t) : [tmpl, ...current];
  
  // Salva solo i modelli custom nel local storage
  const customOnly = updated.filter(t => !PREBUILT_TEMPLATES.some(p => p.id === t.id));
  localStorage.setItem('bluman_custom_document_templates', JSON.stringify(customOnly));
  return updated;
}

/**
 * Archivia un Modello Master (sia prebuilt che custom).
 * NOTA: Non cancella i dati, ma imposta lo stato su archiviato nascondendolo dai menu operativi predefiniti.
 */
export function archiveTemplate(templateId: string): DocumentTemplate[] {
  try {
    const archivedIdsStr = localStorage.getItem('bluman_archived_template_ids');
    const archivedIds: string[] = archivedIdsStr ? JSON.parse(archivedIdsStr) : [];
    if (!archivedIds.includes(templateId)) {
      archivedIds.push(templateId);
      localStorage.setItem('bluman_archived_template_ids', JSON.stringify(archivedIds));
    }
    return getAllTemplates(true);
  } catch {
    return getAllTemplates(true);
  }
}

/**
 * Ripristina un Modello Master precedentemente archiviato.
 */
export function restoreTemplate(templateId: string): DocumentTemplate[] {
  try {
    const archivedIdsStr = localStorage.getItem('bluman_archived_template_ids');
    const archivedIds: string[] = archivedIdsStr ? JSON.parse(archivedIdsStr) : [];
    const filtered = archivedIds.filter(id => id !== templateId);
    localStorage.setItem('bluman_archived_template_ids', JSON.stringify(filtered));
    return getAllTemplates(true);
  } catch {
    return getAllTemplates(true);
  }
}

/**
 * Elimina definitivamente un Modello Master.
 * NOTA FONDAMENTALE: Non tocca né altera i documenti già congelati/firmati nei progetti.
 */
export function deleteCustomTemplate(templateId: string): DocumentTemplate[] {
  try {
    // 1. Rimuovi dai custom
    const customStr = localStorage.getItem('bluman_custom_document_templates');
    const customArr: DocumentTemplate[] = customStr ? JSON.parse(customStr) : [];
    const filteredCustom = customArr.filter(t => t.id !== templateId);
    localStorage.setItem('bluman_custom_document_templates', JSON.stringify(filteredCustom));

    // 2. Se era un prebuilt, segnalo come eliminato
    const deletedPrebuiltStr = localStorage.getItem('bluman_deleted_template_ids');
    const deletedPrebuilt: string[] = deletedPrebuiltStr ? JSON.parse(deletedPrebuiltStr) : [];
    if (!deletedPrebuilt.includes(templateId)) {
      deletedPrebuilt.push(templateId);
      localStorage.setItem('bluman_deleted_template_ids', JSON.stringify(deletedPrebuilt));
    }

    return getAllTemplates(true);
  } catch {
    return getAllTemplates(true);
  }
}

export const deleteTemplate = deleteCustomTemplate;

/**
 * Importa un bundle JSON o singolo Modello Master
 */
export function importTemplatesFromJson(jsonString: string): { success: boolean; count: number; error?: string } {
  try {
    const parsed = JSON.parse(jsonString);
    const incoming: DocumentTemplate[] = Array.isArray(parsed) ? parsed : [parsed];
    if (incoming.length === 0 || !incoming[0].titolo) {
      return { success: false, count: 0, error: 'Formato file JSON non valido. Richiesto titolo e contenutoHtml.' };
    }
    
    let addedCount = 0;
    incoming.forEach(tmpl => {
      const formatted: DocumentTemplate = {
        id: tmpl.id || `tmpl-custom-${Date.now()}-${Math.random().toString(36).substring(2, 6)}`,
        titolo: tmpl.titolo || 'Nuovo Modello Master Importato',
        categoria: (tmpl.categoria as any) || 'societario',
        descrizione: tmpl.descrizione || 'Modello master importato nel Vault Studio.',
        contenutoHtml: tmpl.contenutoHtml || '<h1>Modello Master</h1><p>Inserisci testo...</p>',
        archiviato: !!tmpl.archiviato,
      };
      saveCustomTemplate(formatted);
      addedCount++;
    });

    return { success: true, count: addedCount };
  } catch (err: any) {
    return { success: false, count: 0, error: err.message || 'Errore di decodifica JSON' };
  }
}

/**
 * Esporta tutti i Modelli Master correnti in formato JSON scaricabile
 */
export function exportTemplatesAsJson(): string {
  const all = getAllTemplates(true);
  return JSON.stringify(all, null, 2);
}


