import { REORGANIZATION_TEMPLATES } from './reorganizationTemplates';
import { getCurrentTenantId, getTenantStorageKey, getStudioInfoForTenant } from './tenant';

export interface DocumentTemplate {
  id: string;
  titolo: string;
  categoria: 'contratto' | 'nda' | 'engagement' | 'societario' | 'delega' | 'fiscale' | 'trust' | 'compliance';
  descrizione: string;
  contenutoHtml: string;
  archiviato?: boolean;
  dataCreazione?: string;
  /** Piano firma §3 — livello (ses|fea|feq) che i documenti generati da questo modello esigono; default 'ses'. */
  livelloFirmaRichiesto?: 'ses' | 'fea' | 'feq';
  // §41 — Cartella modelli dello studio. Questi campi arrivano dalla riga a database e
  // servono a rispondere a «questo testo l'ha già riletto qualcuno?».
  /**
   * Lo stato di revisione, oppure `null` per un modello **di serie** non ancora adottato:
   * quello non ha una riga, quindi nessuno ha mai espresso un giudizio su di esso. Scrivere
   * «bozza» al suo posto attribuirebbe allo studio una valutazione che non ha dato.
   */
  statoRevisione?: 'bozza' | 'in_revisione' | 'approvato' | null;
  versione?: number;
  noteRevisione?: string | null;
  revisionatoDaNome?: string | null;
  revisionatoAt?: string | null;
  /** Vero per i modelli scritti nel codice e uguali per tutti gli studi, finché nessuno li adotta. */
  diSerie?: boolean;
  /** L'id del modello di serie da cui questo modello dello studio è stato adottato. */
  riferimentoSerie?: string | null;
  /**
   * Vero per i modelli trovati soltanto in `localStorage` di questo browser: esistevano prima
   * di §41 e non hanno una riga a database. Non sono modelli dello studio — sono modelli di
   * questo computer — e la cartella deve dirlo, non contarli fra gli altri.
   */
  soloLocale?: boolean;
}

// ─── §41 — La cartella dei modelli: la fonte è il database, non il browser ──────────────
//
// Com'era prima. `getAllTemplates()` costruiva l'elenco da tre chiavi di `localStorage`
// (`bluman_custom_document_templates`, `bluman_archived_template_ids`,
// `bluman_deleted_template_ids`) e non chiamava mai il server. Conseguenze osservabili:
// un modello creato sul computer del titolare non compariva su nessun altro — anche se la
// riga a database c'era, perché `creaDocumentoTemplateApi` la scriveva; l'archiviazione
// valeva per un solo browser; svuotare la cache faceva sparire la libreria dello studio.
// Regola 3 (tutto ciò che si aggiunge nell'interfaccia deve stare a database) e regola 7
// (un pulsante che scrive solo in localStorage non ha salvato niente).
//
// C'era anche un difetto meno visibile: i modelli nascevano con un id inventato dal browser
// (`tmpl-custom-${Date.now()}`), che la POST non mandava e che il database non conosceva. Le
// due righe avevano id diversi, quindi archiviare o eliminare «quel» modello sul server non
// poteva funzionare per costruzione. Ora l'id è quello che risponde il server.
//
// Com'è adesso. Questo modulo tiene la copia di lavoro dei modelli letti dal server e la
// fonde con i modelli di serie; le chiamate di rete stanno in `hooks/useCartellaTemplate.ts`,
// perché un modulo di `utils/` che apre connessioni non è più un'utilità. `getAllTemplates()`
// resta sincrona: la chiamano decine di punti, anche dentro `useState(() => ...)`.

/** I modelli dello studio come li ha risposti il server. `null` = non ancora letti. */
let modelliStudio: DocumentTemplate[] | null = null;
let statoLettura: 'mai' | 'ok' | 'errore' = 'mai';
let erroreLettura: string | null = null;

/**
 * Stato della lettura, perché l'interfaccia possa distinguere tre cose che prima erano una
 * sola: «lo studio non ha modelli propri», «non ho ancora letto» e «la lettura è fallita».
 */
export function statoCartellaModelli(): { stato: 'mai' | 'ok' | 'errore'; errore: string | null } {
  return { stato: statoLettura, errore: erroreLettura };
}

/** Chiamata dal hook dopo una lettura riuscita: da qui in poi l'elenco è quello dello studio. */
export function impostaModelliStudio(modelli: DocumentTemplate[]): void {
  modelliStudio = modelli;
  statoLettura = 'ok';
  erroreLettura = null;
}

/** Chiamata dal hook quando la lettura non riesce. Non si inventa un elenco al suo posto. */
export function segnalaLetturaModelliFallita(messaggio: string): void {
  statoLettura = 'errore';
  erroreLettura = messaggio;
}

/**
 * Aggiorna la copia di lavoro con un modello confermato dal server (creato, modificato,
 * revisionato o archiviato). Va chiamata DOPO la risposta, mai prima: un modello in elenco
 * che il server non ha accettato è un modello che non esiste.
 */
export function registraModelloStudio(modello: DocumentTemplate): DocumentTemplate[] {
  const attuali = modelliStudio ?? [];
  const esiste = attuali.some((t) => t.id === modello.id);
  modelliStudio = esiste ? attuali.map((t) => (t.id === modello.id ? modello : t)) : [modello, ...attuali];
  statoLettura = 'ok';
  return getAllTemplates(true);
}

/** Toglie dalla copia di lavoro un modello che il server ha confermato di aver eliminato. */
export function dimenticaModelloStudio(id: string): DocumentTemplate[] {
  modelliStudio = (modelliStudio ?? []).filter((t) => t.id !== id);
  return getAllTemplates(true);
}


export const PREBUILT_TEMPLATES: DocumentTemplate[] = [
  {
    id: 'tmpl-engagement',
    titolo: 'Lettera d\'Incarico Professionale (Engagement Letter)',
    categoria: 'engagement',
    descrizione: 'Mandato di consulenza patrimoniale e corporate structuring con compenso e firma con OTP verificata.',
    contenutoHtml: `
<h1 style="text-align: center; color: #1e1b4b; margin-bottom: 20px; font-size: 20px; text-transform: uppercase; letter-spacing: 0.5px;">
  LETTERA D'INCARICO PROFESSIONALE E MANDATO FIDUCIARIO
</h1>

<p style="text-align: right; color: #64748b; font-size: 11px; margin-bottom: 25px;">
  <strong>Data di emissione:</strong> {{data_odierna}} | <strong>Rif. Pratica:</strong> {{progetto.titolo}}
</p>

<div style="background: #f8fafc; border-left: 4px solid #4338ca; padding: 12px 16px; margin-bottom: 25px; font-size: 11.5px; line-height: 1.6;">
  <strong>TRA LE PARTI:</strong><br/>
  <strong>Lo Studio Professionale:</strong> {{studio.ragione_sociale}}, con sede legale in {{studio.sede_legale}}, P.IVA/TIN {{studio.piva}}, rappresentato da {{studio.lead_advisor}} (Senior Partner Advisory).<br/><br/>
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
  Il presente accordo è regolato dalla legge applicabile alla sede legale dello Studio. Per ogni eventuale controversia sarà competente in via esclusiva il Foro della sede legale dello Studio.
</p>

<div style="margin-top: 40px; display: flex; justify-content: space-between; page-break-inside: avoid;">
  <div style="width: 45%; text-align: center; border-top: 1px dashed #94a3b8; padding-top: 8px; font-size: 11px;">
    <strong>Per Lo Studio:</strong><br/>
    {{studio.ragione_sociale}}<br/>
    <span style="color: #64748b; font-size: 10px;">(Firma Autorizzata)</span><br/>
    {{firma_studio}}
  </div>
  <div style="width: 45%; text-align: center; border-top: 1px dashed #94a3b8; padding-top: 8px; font-size: 11px;">
    <strong>Per Il Cliente Committente:</strong><br/>
    {{cliente.referente}}<br/>
    <span style="color: #4338ca; font-weight: 700; font-size: 10px;">[ Sottoscrizione con OTP verificata · art. 20 CAD ]</span><br/>
    {{firma_cliente}}
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
    {{studio.ragione_sociale}}<br/>
    {{firma_studio}}
  </div>
  <div style="width: 45%; text-align: center; border-top: 1px solid #cbd5e1; padding-top: 8px; font-size: 11px;">
    <strong>Per Il Cliente:</strong><br/>
    {{cliente.ragione_sociale}} ({{cliente.referente}})<br/>
    {{firma_cliente}}
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
  <p style="font-size: 12px; font-weight: 700; color: #1e1b4b;">{{cliente.referente}}<br/>{{firma_cliente}}</p>
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
    {{cliente.referente}}<br/>
    {{firma_cliente}}
  </div>
  <div style="width: 45%; text-align: center; border-top: 1px solid #cbd5e1; padding-top: 8px; font-size: 11px;">
    <strong>Received by Advisory Trustee:</strong><br/>
    {{studio.ragione_sociale}}<br/>
    {{firma_studio}}
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
  Il sottoscritto <strong>{{cliente.referente}}</strong>, Codice Fiscale / ID <strong>{{cliente.codice_fiscale}}</strong>, in qualità di Legale Rappresentante della società <strong>{{cliente.ragione_sociale}}</strong> (P.IVA/TIN {{cliente.partita_iva}}),
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
    Firma UBO: <strong>{{cliente.referente}}</strong><br/>
    {{firma_cliente}}
  </div>
</div>
`,
  },
  ...REORGANIZATION_TEMPLATES,
];

/**
 * Sostituisce le variabili dinamiche (Mail Merge) Smart Tags
 */
export function resolveDocumentTemplateHtml(
  templateOrHtml: string | DocumentTemplate | any,
  context: any = {}
): string {
  let htmlContent = typeof templateOrHtml === 'string'
    ? templateOrHtml
    : (templateOrHtml?.html || templateOrHtml?.contenutoHtml || templateOrHtml?.testo || '');

  if (!htmlContent || typeof htmlContent !== 'string') return '';

  const currentTenantId = getCurrentTenantId();
  const studioInfo = getStudioInfoForTenant(currentTenantId);

  let targetCliente: any = null;
  let targetProgetto: any = null;
  let targetStudio: any = null;

  if (context && (context.cl || context.mods || context.totalePreventivo !== undefined)) {
    // Il contesto è stato passato direttamente come oggetto Progetto
    targetProgetto = context;
    try {
      const clsStr = localStorage.getItem(getTenantStorageKey('bluman_clients')) || localStorage.getItem(getTenantStorageKey('bluman_custom_clients'));
      const clsArr = clsStr ? JSON.parse(clsStr) : [];
      targetCliente = clsArr.find((c: any) => c.nome === context.cl || String(c.id) === String(context.clienteId)) || {
        nome: context.cl,
        referenteNome: context.referente || context.cl,
      };
    } catch {
      targetCliente = { nome: context.cl, referenteNome: context.referente || context.cl };
    }
  } else if (context) {
    targetProgetto = context.progetto;
    targetCliente = context.cliente;
    targetStudio = context.studio;
  }

  // Dati studio da Tenant o Storage (isolato per tenant)
  if (!targetStudio) {
    try {
      const tntStr = localStorage.getItem(getTenantStorageKey('bluman_tenant_info'));
      if (tntStr) targetStudio = JSON.parse(tntStr);
    } catch {}
  }

  // Dati studio dinamici dal tenant attivo
  const studioRagioneSociale = targetStudio?.ragioneSociale || studioInfo.ragioneSociale || 'Studio Professionale';
  const studioPiva = targetStudio?.piva || studioInfo.piva || '';
  const studioSede = targetStudio?.sedeLegale || studioInfo.sedeLegale || '';
  const studioIban = targetStudio?.iban || studioInfo.iban || '';
  const studioLeadAdvisor = studioInfo.leadAdvisor || 'Lead Senior Advisor';
  const studioTel = targetStudio?.telefono || studioInfo.telefono || '';
  const studioEmail = targetStudio?.email || studioInfo.email || '';

  // Dati cliente
  const clientNome = targetCliente?.nome || targetProgetto?.cl || 'Cliente Committente';
  const clientPiva = targetCliente?.piva || targetCliente?.codiceFiscale || '';
  const clientCodFisc = targetCliente?.codiceFiscale || targetCliente?.piva || '';
  const clientSede = targetCliente?.sedeLegale || '';
  const clientPec = targetCliente?.pec || '';
  const clientSdi = targetCliente?.codiceSdi || '';
  const clientIban = targetCliente?.iban || '';
  const clientRef = targetCliente?.referenteNome || (targetCliente?.referentiJson as any)?.referente || targetCliente?.referente || 'Legale Rappresentante';
  const clientCell = targetCliente?.cellulare || '';
  const clientUbo = targetCliente?.ubo || targetCliente?.referenteNome || 'Titolare Effettivo (UBO)';

  const dataOggi = new Date().toLocaleDateString('it-IT', { day: '2-digit', month: 'long', year: 'numeric' });

  const projTitolo = targetProgetto?.titolo || targetProgetto?.n || targetProgetto?.nome || 'Incarico Professionale';
  const projImporto = targetProgetto?.totalePreventivo || targetProgetto?.val || 0;

  // Sostituzione formale dei tag: NESSUN riquadro o badge, solo elegante grassetto istituzionale
  const wrapTag = (value: string) => {
    return `<strong>${value}</strong>`;
  };

  let out = htmlContent;
  out = out.replace(/\{\{data_odierna\}\}/g, wrapTag(dataOggi));
  out = out.replace(/\{\{cliente\.ragione_sociale\}\}/g, wrapTag(clientNome));
  out = out.replace(/\{\{cliente\.nome\}\}/g, wrapTag(clientNome));
  out = out.replace(/\{\{cliente\.partita_iva\}\}/g, wrapTag(clientPiva));
  out = out.replace(/\{\{cliente\.codice_fiscale\}\}/g, wrapTag(clientCodFisc));
  out = out.replace(/\{\{cliente\.sede_legale\}\}/g, wrapTag(clientSede));
  out = out.replace(/\{\{cliente\.pec\}\}/g, wrapTag(clientPec));
  out = out.replace(/\{\{cliente\.sdi\}\}/g, wrapTag(clientSdi));
  out = out.replace(/\{\{cliente\.iban\}\}/g, wrapTag(clientIban));
  out = out.replace(/\{\{cliente\.referente\}\}/g, wrapTag(clientRef));
  out = out.replace(/\{\{cliente\.cellulare\}\}/g, wrapTag(clientCell));
  out = out.replace(/\{\{cliente\.ubo\}\}/g, wrapTag(clientUbo));

  out = out.replace(/\{\{progetto\.titolo\}\}/g, wrapTag(projTitolo));
  out = out.replace(/\{\{progetto\.importo_totale\}\}/g, wrapTag(projImporto ? `€ ${Number(projImporto).toLocaleString('it-IT')},00` : '€ 0,00'));

  out = out.replace(/\{\{studio\.ragione_sociale\}\}/g, wrapTag(studioRagioneSociale));
  out = out.replace(/\{\{studio\.piva\}\}/g, wrapTag(studioPiva));
  out = out.replace(/\{\{studio\.sede_legale\}\}/g, wrapTag(studioSede));
  out = out.replace(/\{\{studio\.iban\}\}/g, wrapTag(studioIban));
  out = out.replace(/\{\{studio\.lead_advisor\}\}/g, wrapTag(studioLeadAdvisor));
  out = out.replace(/\{\{studio\.telefono\}\}/g, wrapTag(studioTel));
  out = out.replace(/\{\{studio\.email\}\}/g, wrapTag(studioEmail));

  // §36 — Aree firma. Nell'anteprima il segnaposto non è un dato ma uno SPAZIO: il filetto
  // su cui, alla firma, il server disegnerà la grafometrica dentro il documento. Va reso
  // come tale e non lasciato letterale, altrimenti l'operatore vede «{{firma_cliente}}»
  // nel contratto e crede di aver sbagliato a scrivere il tag.
  //
  // Nessun nome, nessuna data: qui non c'è ancora nessuna firma, e il frontend non attesta
  // ciò che il database non ha (regola 7). Lo spazio è vuoto perché vuoto lo è davvero
  // finché il cliente non firma dal portale.
  const areaFirma = (etichetta: string) =>
    `<span style="display:inline-block;min-width:190px;border-bottom:1px dashed #94a3b8;` +
    `margin-top:26px;padding-bottom:2px;color:#94a3b8;font-size:10px;font-style:italic;">` +
    `${etichetta}</span>`;
  out = out.replace(/\{\{firma_cliente\}\}/g, areaFirma('Spazio riservato alla firma del cliente'));
  out = out.replace(/\{\{firma_studio\}\}/g, areaFirma('Spazio riservato alla firma dello Studio'));

  return out;
}

/**
 * Associa qualsiasi MicroVoce del progetto al relativo Modello Word Ufficiale
 */
export function getTemplateForVoce(voceTitle: string, category: string = ''): DocumentTemplate {
  const v = voceTitle.toLowerCase();
  const c = category.toLowerCase();

  // 1. Modelli Specifici di Riorganizzazione Societaria
  if (v.includes('intake') || v.includes('questionario')) {
    const found = PREBUILT_TEMPLATES.find(t => t.id === 'tmpl-01-1-questionario-intake-cliente');
    if (found) return found;
  }
  if (v.includes('exit tax') || v.includes('rateizzazione')) {
    const found = PREBUILT_TEMPLATES.find(t => t.id === 'tmpl-01-3-memo-valutazione-exit-tax' || t.id === 'tmpl-06-1-memo-procedurale-exit-tax-rateizzazione');
    if (found) return found;
  }
  if (v.includes('analisi fiscale') || v.includes('cfc') || v.includes('esterovestizione')) {
    const found = PREBUILT_TEMPLATES.find(t => t.id === 'tmpl-01-2-memo-analisi-fiscale-preliminare');
    if (found) return found;
  }
  if (v.includes('fattibilit') || v.includes('raccomandazioni')) {
    const found = PREBUILT_TEMPLATES.find(t => t.id === 'tmpl-01-4-report-fattibilita-raccomandazioni');
    if (found) return found;
  }
  if (v.includes('giurisdiz') || v.includes('comparativ')) {
    const found = PREBUILT_TEMPLATES.find(t => t.id === 'tmpl-02-2-memo-comparativo-giurisdizioni');
    if (found) return found;
  }
  if (v.includes('banc') || v.includes('conto') || v.includes('emi')) {
    const found = PREBUILT_TEMPLATES.find(t => t.id === 'tmpl-03-1-matrice-comparativa-istituti-bancari' || t.id === 'tmpl-03-3-procedura-apertura-conto-societario');
    if (found) return found;
  }
  if (v.includes('marchi') || v.includes('ip') || v.includes('brevett') || v.includes('euipo')) {
    const found = PREBUILT_TEMPLATES.find(t => t.id === 'tmpl-05-1-checklist-verifica-disponibilita-marchio' || t.id === 'tmpl-05-2-procedura-deposito-marchio' || t.id === 'tmpl-05-3-bozza-contratto-cessione-licenza-ip');
    if (found) return found;
  }
  if (v.includes('aire') || v.includes('residenza estera')) {
    const found = PREBUILT_TEMPLATES.find(t => t.id === 'tmpl-06-2-checklist-iscrizione-aire');
    if (found) return found;
  }
  if (v.includes('iva') || v.includes('chiusura italia') || v.includes('adeguamento')) {
    const found = PREBUILT_TEMPLATES.find(t => t.id === 'tmpl-06-3-checklist-chiusura-adeguamento-iva');
    if (found) return found;
  }
  if (v.includes('fornitor')) {
    const found = PREBUILT_TEMPLATES.find(t => t.id === 'tmpl-04-2-bozza-contratto-fornitori-esterni');
    if (found) return found;
  }

  // 2. Modelli Core Standard
  if (v.includes('engagement') || v.includes('incarico') || v.includes('firma') || v.includes('mandato')) {
    return PREBUILT_TEMPLATES.find(t => t.id === 'tmpl-engagement')!;
  }
  if (v.includes('nda') || v.includes('riservatezza') || v.includes('segreto') || v.includes('briefing') || v.includes('raccolta doc')) {
    return PREBUILT_TEMPLATES.find(t => t.id === 'tmpl-nda')!;
  }
  if (v.includes('trust') || v.includes('wishes') || v.includes('fiduciari') || c.includes('trust')) {
    return PREBUILT_TEMPLATES.find(t => t.id === 'tmpl-02-5-memo-predisposizione-trust' || t.id === 'tmpl-letter-of-wishes')!;
  }
  if (v.includes('ubo') || v.includes('kyc') || v.includes('antiriciclaggio') || v.includes('compliance') || c.includes('compliance')) {
    return PREBUILT_TEMPLATES.find(t => t.id === 'tmpl-03-2-checklist-dossier-kyc' || t.id === 'tmpl-compliance')!;
  }
  if (v.includes('intercompany') || v.includes('servizio') || v.includes('management') || v.includes('contratto')) {
    return PREBUILT_TEMPLATES.find(t => t.id === 'tmpl-04-1-bozza-contratto-intra-societario' || t.id === 'tmpl-intercompany')!;
  }
  if (v.includes('delega') || v.includes('procura') || v.includes('mfsa')) {
    return PREBUILT_TEMPLATES.find(t => t.id === 'tmpl-delega')!;
  }
  if (v.includes('costituzione') || v.includes('statuto') || v.includes('atto') || v.includes('holding') || c.includes('societario')) {
    return PREBUILT_TEMPLATES.find(t => t.id === 'tmpl-02-1-memorandum-struttura' || t.id === 'tmpl-02-4-bozza-memorandum-articles-of-association' || t.id === 'tmpl-memorandum')!;
  }

  return PREBUILT_TEMPLATES[0];
}

/**
 * Restituisce tutti i modelli visibili nella cartella dello studio:
 *   1. i modelli dello studio letti dal server (autorevoli: hanno una riga, un id e uno stato);
 *   2. i modelli **di serie** scritti nel codice che nessuno ha ancora adottato, marcati
 *      `diSerie: true` e con `statoRevisione: null` — nessuno li ha riletti in questo studio;
 *   3. i modelli rimasti soltanto in questo browser (§41, `modelliSoloLocali`), marcati
 *      `soloLocale: true` perché la cartella possa dire che non sono dello studio.
 *
 * Un modello di serie già adottato NON compare due volte: la riga dello studio lo sostituisce,
 * riconosciuta dal campo `riferimentoSerie`.
 *
 * `includeArchived: false` esclude gli archiviati. Restano a database: archiviare non elimina.
 *
 * GARANZIA IMMUTABILITÀ: I documenti già istanziati, firmati o salvati all'interno dei singoli
 * Progetti sono copie indipendenti e congelate alla data della firma. Modificare, archiviare o
 * eliminare un modello nella Libreria NON altera in alcun modo i documenti storici dei Progetti.
 */
export function getAllTemplates(includeArchived: boolean = true): DocumentTemplate[] {
  const studio = modelliStudio ?? [];
  const serieAdottate = new Set(studio.map((t) => t.riferimentoSerie).filter(Boolean) as string[]);

  const diSerie: DocumentTemplate[] = PREBUILT_TEMPLATES.filter((p) => !serieAdottate.has(p.id)).map((p) => ({
    ...p,
    diSerie: true,
    statoRevisione: null,
    riferimentoSerie: p.id,
  }));

  const combined = [...studio, ...diSerie, ...modelliSoloLocali()];
  return includeArchived ? combined : combined.filter((t) => !t.archiviato);
}

/**
 * §41 — I modelli rimasti soltanto in questo browser, da recuperare.
 *
 * Prima di §41 esistevano due modi di creare un modello: il pulsante del Document Studio, che
 * scriveva in localStorage E chiamava l'API, e l'importazione da JSON, che scriveva SOLO in
 * localStorage. I secondi non hanno una riga a database: se questa funzione non li mostrasse,
 * passando alla lettura dal server sparirebbero dall'elenco senza che nessuno li abbia
 * eliminati — e sparire in silenzio è peggio che restare segnalati come da sistemare.
 *
 * Il confronto è sul titolo e non sull'id perché gli id non coincidono: la POST non mandava
 * l'id inventato dal browser, e il database ne generava uno proprio.
 */
export function modelliSoloLocali(): DocumentTemplate[] {
  try {
    const customStr = localStorage.getItem(getTenantStorageKey('bluman_custom_document_templates'));
    if (!customStr) return [];
    const locali: DocumentTemplate[] = JSON.parse(customStr);
    if (!Array.isArray(locali)) return [];

    // Finché non si è letto il server non si può dire quali siano «solo locali»: dirlo
    // basandosi su un elenco mai letto sarebbe una diagnosi senza esame.
    if (statoLettura !== 'ok') return [];

    const titoliStudio = new Set((modelliStudio ?? []).map((t) => (t.titolo || '').trim().toLowerCase()));
    const idSerie = new Set(PREBUILT_TEMPLATES.map((p) => p.id));
    return locali
      .filter((t) => t && t.titolo && !idSerie.has(t.id))
      .filter((t) => !titoliStudio.has(t.titolo.trim().toLowerCase()))
      .map((t) => ({ ...t, soloLocale: true, statoRevisione: null }));
  } catch {
    return [];
  }
}

/**
 * §41 — Dimentica il residuo locale di un modello dopo che è stato portato a database.
 * Si chiama solo a recupero confermato: cancellare prima perderebbe il testo.
 */
export function scartaResiduoLocale(titolo: string): void {
  try {
    const chiave = getTenantStorageKey('bluman_custom_document_templates');
    const customStr = localStorage.getItem(chiave);
    if (!customStr) return;
    const locali: DocumentTemplate[] = JSON.parse(customStr);
    if (!Array.isArray(locali)) return;
    const atteso = (titolo || '').trim().toLowerCase();
    localStorage.setItem(chiave, JSON.stringify(locali.filter((t) => (t?.titolo || '').trim().toLowerCase() !== atteso)));
  } catch {
    // Il residuo resta: verrà riproposto al prossimo giro. Nessun dato perso.
  }
}

/**
 * §41 — Legge i modelli da un file JSON esportato, senza salvarli.
 *
 * Prima questa funzione si chiamava `importTemplatesFromJson`, scriveva direttamente in
 * localStorage e dichiarava `success: true`: i modelli importati non arrivavano al database,
 * quindi «importati» valeva per quel browser. Ora si limita a leggere e validare; a salvarli
 * ci pensa `useCartellaTemplate.importaDaJson`, che passa dal server e riferisce come è andata.
 */
export function leggiModelliDaJson(jsonString: string): { ok: boolean; modelli: DocumentTemplate[]; errore?: string } {
  try {
    const parsed = JSON.parse(jsonString);
    const incoming: DocumentTemplate[] = Array.isArray(parsed) ? parsed : [parsed];
    if (incoming.length === 0 || !incoming[0]?.titolo) {
      return { ok: false, modelli: [], errore: 'Formato file JSON non valido. Richiesto titolo e contenutoHtml.' };
    }
    const modelli = incoming.map((tmpl) => ({
      // L'id lo assegna il database alla creazione: qui resta vuoto perché un id inventato dal
      // browser non corrisponderebbe a nessuna riga (è il difetto che §41 chiude).
      id: '',
      titolo: tmpl.titolo || 'Nuovo Modello Master Importato',
      categoria: (tmpl.categoria as DocumentTemplate['categoria']) || 'societario',
      descrizione: tmpl.descrizione || 'Modello master importato nel Vault Studio.',
      contenutoHtml: tmpl.contenutoHtml || '<h1>Modello Master</h1><p>Inserisci testo...</p>',
      livelloFirmaRichiesto: tmpl.livelloFirmaRichiesto ?? ('ses' as const),
    }));
    return { ok: true, modelli };
  } catch (err: any) {
    return { ok: false, modelli: [], errore: err?.message || 'Errore di decodifica JSON' };
  }
}

/**
 * Esporta tutti i Modelli Master correnti in formato JSON scaricabile.
 * Esporta quello che c'è in elenco: se la lettura dal server non è riuscita, l'elenco contiene
 * i soli modelli di serie, e il file lo rispecchia invece di far finta di essere un backup.
 */
export function exportTemplatesAsJson(): string {
  const all = getAllTemplates(true);
  return JSON.stringify(all, null, 2);
}



