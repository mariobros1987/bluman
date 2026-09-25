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
    id: 'tmpl-cdd-persona-fisica',
    titolo: 'Scheda CDD/KYC — Persona Fisica (Malta · FIAU IP Part I)',
    categoria: 'compliance',
    descrizione: 'Adeguata verifica (CDD) di persona fisica secondo le FIAU Implementing Procedures Part I: identità, verifica, rischio, PEP, sanzioni, EDD. Identità auto-compilata dal cliente; le sezioni KYC si compilano dai pannelli Compliance.',
    livelloFirmaRichiesto: 'fea',
    diSerie: true,
    contenutoHtml: `
<h1 style="text-align:center;color:#1e1b4b;font-size:18px;text-transform:uppercase;letter-spacing:.5px;margin-bottom:2px;">Scheda di Adeguata Verifica (CDD/KYC) — Persona Fisica</h1>
<p style="text-align:center;font-size:11px;color:#555;margin-top:0;">Malta · FIAU Implementing Procedures Part I (PMLFTR) — Studio {{studio.ragione_sociale}} · aperta il {{data_odierna}}</p>
<h2 style="color:#1e1b4b;font-size:13px;border-bottom:1px solid #ccc;padding-bottom:2px;margin-top:16px;">1. Relazione d'affari</h2>
<p>Scopo e natura della relazione: ___________________________________________</p>
<p>Canale di onboarding: ☐ Presenza fisica&nbsp;&nbsp; ☐ A distanza (non face-to-face → adeguata verifica <strong>RAFFORZATA / EDD</strong>)</p>
<p>Referente interno / MLRO: _______________________&nbsp;&nbsp; Prossima revisione periodica: ______________</p>
<h2 style="color:#1e1b4b;font-size:13px;border-bottom:1px solid #ccc;padding-bottom:2px;margin-top:16px;">2. Identificazione del soggetto</h2>
<p>Nome e cognome: {{cliente.ragione_sociale}}&nbsp;&nbsp; Eventuali nomi precedenti: ________________</p>
<p>Data e luogo di nascita: ___________________&nbsp;&nbsp; Nazionalità (anche multipla): ________________</p>
<p>Codice fiscale / identificativo: {{cliente.codice_fiscale}}</p>
<p>Residenza: {{cliente.sede_legale}}</p>
<p>Recapiti: {{cliente.cellulare}}&nbsp;&nbsp; PEC/email: {{cliente.pec}}</p>
<p>Professione / datore di lavoro (rilevante per la fonte dei fondi): ___________________________________</p>
<h2 style="color:#1e1b4b;font-size:13px;border-bottom:1px solid #ccc;padding-bottom:2px;margin-top:16px;">3. Verifica dell'identità</h2>
<p>Documento: ☐ Passaporto&nbsp; ☐ Carta d'identità&nbsp; ☐ Patente&nbsp;&nbsp; N. ____________ Ente __________ Scadenza __________</p>
<p>Metodo di verifica: ☐ In presenza&nbsp; ☐ Video-ID&nbsp; ☐ Certificazione notarile&nbsp; ☐ Confronto biometrico</p>
<p>Verifica indirizzo: ☐ Utenza&nbsp; ☐ Estratto conto&nbsp; ☐ Altro __________&nbsp;&nbsp; Verificato da ____________ il __________</p>
<h2 style="color:#1e1b4b;font-size:13px;border-bottom:1px solid #ccc;padding-bottom:2px;margin-top:16px;">4. Valutazione del rischio</h2>
<p>Livello di rischio: ☐ Basso&nbsp; ☐ Medio&nbsp; ☐ Alto&nbsp;&nbsp; Motivazione: _______________________________________</p>
<p>PEP: ☐ No&nbsp; ☐ Sì (ruolo __________ giurisdizione __________)&nbsp;&nbsp; Familiari/associati stretti: ☐ No&nbsp; ☐ Sì</p>
<p>Screening sanzioni (liste UE / OFAC / ONU): ☐ Nessun match&nbsp; ☐ Match da valutare&nbsp; ☐ Falso positivo&nbsp;&nbsp; Note: ____________</p>
<p>Fonte dei fondi: ____________________________&nbsp;&nbsp; Fonte del patrimonio (se rischio medio/alto): ____________________________</p>
<p>Trigger EDD: ☐ Non face-to-face&nbsp; ☐ PEP&nbsp; ☐ Giurisdizione ad alto rischio&nbsp; ☐ Struttura complessa&nbsp; ☐ Settore a rischio&nbsp;&nbsp; Note: __________</p>
<h2 style="color:#1e1b4b;font-size:13px;border-bottom:1px solid #ccc;padding-bottom:2px;margin-top:16px;">5. Profilo soggetto obbligato <span style="font-weight:normal;font-size:10px;color:#777;">(compilare solo se profilo CSP autorizzato MFSA)</span></h2>
<p>N. autorizzazione MFSA: ______________&nbsp;&nbsp; Servizi prestati: ____________________&nbsp;&nbsp; Rif. Certificate of Registration: ______________</p>
<hr style="margin-top:18px;border:none;border-top:1px solid #ccc;"/>
<p style="font-size:10px;color:#555;">Le informazioni sono raccolte e verificate ai sensi del PMLFTR e delle FIAU Implementing Procedures Part I. La scheda è conservata nel fascicolo del cliente.</p>
<div style="display:flex;justify-content:space-between;margin-top:34px;">
  <div style="width:45%;">{{firma_studio}}</div>
  <div style="width:45%;">{{firma_cliente}}</div>
</div>
`,
  },
  {
    id: 'tmpl-cdd-persona-giuridica',
    titolo: 'Scheda CDD/KYC — Persona Giuridica & Titolari Effettivi (Malta)',
    categoria: 'compliance',
    descrizione: 'Adeguata verifica (CDD) di persona giuridica secondo le FIAU Implementing Procedures Part I: entità, amministratori, soci, titolari effettivi (UBO) con catena di controllo, rischio e verifica. Dati entità auto-compilati dal cliente.',
    livelloFirmaRichiesto: 'fea',
    diSerie: true,
    contenutoHtml: `
<h1 style="text-align:center;color:#1e1b4b;font-size:18px;text-transform:uppercase;letter-spacing:.5px;margin-bottom:2px;">Scheda di Adeguata Verifica (CDD/KYC) — Persona Giuridica</h1>
<p style="text-align:center;font-size:11px;color:#555;margin-top:0;">Malta · FIAU Implementing Procedures Part I (PMLFTR) — Studio {{studio.ragione_sociale}} · aperta il {{data_odierna}}</p>
<h2 style="color:#1e1b4b;font-size:13px;border-bottom:1px solid #ccc;padding-bottom:2px;margin-top:16px;">1. Relazione d'affari</h2>
<p>Scopo e natura della relazione: ___________________________________________</p>
<p>Canale di onboarding: ☐ Presenza fisica&nbsp;&nbsp; ☐ A distanza (non face-to-face → adeguata verifica <strong>RAFFORZATA / EDD</strong>)</p>
<p>Referente interno / MLRO: _______________________&nbsp;&nbsp; Prossima revisione periodica: ______________</p>
<h2 style="color:#1e1b4b;font-size:13px;border-bottom:1px solid #ccc;padding-bottom:2px;margin-top:16px;">2. Identificazione dell'entità</h2>
<p>Denominazione sociale: {{cliente.ragione_sociale}}&nbsp;&nbsp; Forma giuridica: ________________</p>
<p>N. registrazione: {{cliente.partita_iva}}&nbsp;&nbsp; Giurisdizione di costituzione: ________________&nbsp;&nbsp; Data costituzione: __________</p>
<p>Sede legale: {{cliente.sede_legale}}&nbsp;&nbsp; Sede operativa (se diversa): ________________________________</p>
<p>Oggetto sociale / attività effettiva: ___________________________________________</p>
<p>Certificate of good standing / vigenza: ☐ Acquisito&nbsp; ☐ N/A&nbsp;&nbsp; Rif.: ______________</p>
<h2 style="color:#1e1b4b;font-size:13px;border-bottom:1px solid #ccc;padding-bottom:2px;margin-top:16px;">3. Amministratori e soci</h2>
<p>Amministratori (nome, data nascita, nazionalità): ___________________________________________</p>
<p>&nbsp;&nbsp;___________________________________________________________________________________</p>
<p>Soci / azionisti e quote (%): ______________________________________________________________</p>
<h2 style="color:#1e1b4b;font-size:13px;border-bottom:1px solid #ccc;padding-bottom:2px;margin-top:16px;">4. Titolari effettivi (UBO) — soglia di controllo &gt;25%</h2>
<p style="font-size:10px;color:#777;">Per ogni UBO: nome, data/luogo nascita, nazionalità, base del controllo (proprietà / diritti di voto / dirigente apicale), quota %, e catena di controllo se passa per altre entità (fino alla persona fisica finale).</p>
<p>UBO 1: ______________________________________&nbsp; base ____________&nbsp; quota ____%&nbsp; catena ____________</p>
<p>UBO 2: ______________________________________&nbsp; base ____________&nbsp; quota ____%&nbsp; catena ____________</p>
<p>UBO 3: ______________________________________&nbsp; base ____________&nbsp; quota ____%&nbsp; catena ____________</p>
<p>Documenti societari acquisiti: ☐ Atto costitutivo/statuto&nbsp; ☐ Registro amministratori/soci&nbsp; ☐ Organigramma di gruppo&nbsp; ☐ Bilanci (source of funds, rischio medio/alto)</p>
<h2 style="color:#1e1b4b;font-size:13px;border-bottom:1px solid #ccc;padding-bottom:2px;margin-top:16px;">5. Valutazione del rischio</h2>
<p>Livello di rischio: ☐ Basso&nbsp; ☐ Medio&nbsp; ☐ Alto&nbsp;&nbsp; Motivazione: _______________________________________</p>
<p>PEP (fra UBO/amministratori): ☐ No&nbsp; ☐ Sì (chi/ruolo __________)&nbsp;&nbsp; Screening sanzioni (UE/OFAC/ONU): ☐ Nessun match&nbsp; ☐ Match da valutare&nbsp; ☐ Falso positivo</p>
<p>Fonte dei fondi: ____________________________&nbsp;&nbsp; Fonte del patrimonio (se rischio medio/alto): ____________________________</p>
<p>Trigger EDD: ☐ Non face-to-face&nbsp; ☐ PEP&nbsp; ☐ Giurisdizione ad alto rischio&nbsp; ☐ Struttura complessa&nbsp; ☐ Settore a rischio&nbsp;&nbsp; Note: __________</p>
<h2 style="color:#1e1b4b;font-size:13px;border-bottom:1px solid #ccc;padding-bottom:2px;margin-top:16px;">6. Verifica e profilo soggetto obbligato</h2>
<p>Fonte della verifica (companies registry ufficiale): ________________&nbsp;&nbsp; Verificato da ____________ il __________</p>
<p><span style="font-size:10px;color:#777;">(solo se CSP autorizzato MFSA)</span> N. autorizzazione MFSA: ____________&nbsp; Servizi prestati: ______________&nbsp; Rif. Certificate of Registration: ____________</p>
<hr style="margin-top:18px;border:none;border-top:1px solid #ccc;"/>
<p style="font-size:10px;color:#555;">Le informazioni sono raccolte e verificate ai sensi del PMLFTR e delle FIAU Implementing Procedures Part I. La scheda è conservata nel fascicolo del cliente.</p>
<div style="display:flex;justify-content:space-between;margin-top:34px;">
  <div style="width:45%;">{{firma_studio}}</div>
  <div style="width:45%;">{{firma_cliente}}</div>
</div>
`,
  },
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
  {
    id: 'tmpl-avviso-parcella',
    titolo: 'Avviso di Parcella / Fattura Proforma',
    categoria: 'fiscale',
    descrizione: 'Modello per emissione avviso di parcella proforma per onorari professionali e spese anticipate.',
    contenutoHtml: `
<div style="display: flex; justify-content: space-between; border-bottom: 2px solid #1e3a8a; padding-bottom: 12px; margin-bottom: 20px;">
  <div>
    <h1 style="color: #1e3a8a; font-size: 20px; font-weight: 800; margin: 0 0 4px 0;">AVVISO DI PARCELLA PROFORMA</h1>
    <p style="font-size: 11px; color: #64748b; margin: 0;">Documento non valido ai fini fiscali — La fattura definitiva sarà emessa all'atto del pagamento (Art. 6 DPR 633/72)</p>
  </div>
  <div style="text-align: right; font-size: 11px;">
    <strong>Data:</strong> {{data_odierna}}<br/>
    <strong>Pratica:</strong> {{progetto.titolo}}
  </div>
</div>

<div style="display: flex; justify-content: space-between; gap: 20px; margin-bottom: 24px;">
  <div style="flex: 1; background: #f8fafc; border: 1px solid #e2e8f0; border-radius: 6px; padding: 12px; font-size: 11.5px;">
    <strong style="color: #1e3a8a; text-transform: uppercase; font-size: 11px; display: block; margin-bottom: 6px;">Professionista Emittente</strong>
    <strong>{{studio.ragione_sociale}}</strong><br/>
    Sede: {{studio.sede_legale}}<br/>
    P.IVA / C.F.: {{studio.piva}}<br/>
    Email: {{studio.email}} · Tel: {{studio.telefono}}
  </div>
  <div style="flex: 1; background: #f8fafc; border: 1px solid #e2e8f0; border-radius: 6px; padding: 12px; font-size: 11.5px;">
    <strong style="color: #1e3a8a; text-transform: uppercase; font-size: 11px; display: block; margin-bottom: 6px;">Spettabile Committente</strong>
    <strong>{{cliente.ragione_sociale}}</strong><br/>
    Indirizzo: {{cliente.sede_legale}}<br/>
    P.IVA: {{cliente.partita_iva}} · C.F.: {{cliente.codice_fiscale}}<br/>
    C.U. / SDI: {{cliente.sdi}} · All'att.ne di: {{cliente.referente}}
  </div>
</div>

<h3 style="color: #1e1b4b; font-size: 13px; margin: 16px 0 8px 0; border-bottom: 1px solid #e2e8f0; padding-bottom: 4px;">OGGETTO: PRESTAZIONI PROFESSIONALI RESE</h3>
<p style="font-size: 11.5px; line-height: 1.6; margin-bottom: 16px;">
  Si rimette il presente prospetto proforma relativo ai compensi professionali maturati per lo svolgimento dell'incarico fiduciario <strong>{{progetto.titolo}}</strong>.
</p>

<table style="width: 100%; border-collapse: collapse; margin-bottom: 20px; font-size: 11.5px;">
  <thead>
    <tr style="background: #1e3a8a; color: white;">
      <th style="padding: 8px; text-align: left;">Descrizione Prestazione / Fase</th>
      <th style="padding: 8px; text-align: right; width: 120px;">Importo</th>
    </tr>
  </thead>
  <tbody>
    <tr style="border-bottom: 1px solid #e2e8f0;">
      <td style="padding: 10px 8px;">Onorari professionali per dossier <strong>{{progetto.titolo}}</strong></td>
      <td style="padding: 10px 8px; text-align: right; font-weight: 600;">{{progetto.importo_totale}}</td>
    </tr>
  </tbody>
</table>

<div style="display: flex; justify-content: space-between; gap: 20px; margin-top: 20px;">
  <div style="flex: 1; background: #eff6ff; border: 1px solid #bfdbfe; border-radius: 6px; padding: 12px; font-size: 11px;">
    <strong style="color: #1e40af;">MODALITÀ DI SALDO</strong><br/>
    Si prega di corrispondere il saldo a mezzo bonifico bancario:<br/>
    <strong>IBAN:</strong> {{studio.iban}}<br/>
    <strong>Beneficiario:</strong> {{studio.ragione_sociale}}<br/>
    <strong>Causale:</strong> Saldo Avviso Parcella - {{progetto.titolo}}
  </div>
  <div style="width: 220px; background: #f8fafc; border: 1px solid #e2e8f0; border-radius: 6px; padding: 12px; font-size: 12px;">
    <div style="display: flex; justify-content: space-between; margin-bottom: 6px;">
      <span>Imponibile:</span>
      <strong>{{progetto.importo_totale}}</strong>
    </div>
    <div style="display: flex; justify-content: space-between; border-top: 1px solid #cbd5e1; padding-top: 6px; font-size: 13px; color: #1e3a8a;">
      <strong>Totale Dovuto:</strong>
      <strong>{{progetto.importo_totale}}</strong>
    </div>
  </div>
</div>

<div style="margin-top: 35px; text-align: right;">
  <p style="font-size: 11px; color: #64748b; margin-bottom: 4px;">Per lo Studio Professionale:</p>
  <p style="font-size: 12px; font-weight: 700; color: #1e1b4b;">{{studio.ragione_sociale}}<br/>{{firma_studio}}</p>
</div>
`,
  },
  {
    id: 'tmpl-rendiconto-prestazioni',
    titolo: 'Rendiconto Prestazioni & Prospetto Onorari',
    categoria: 'fiscale',
    descrizione: 'Riepilogo analitico delle attività svolte per commessa con valorizzazione ore e costi vivi.',
    contenutoHtml: `
<h1 style="text-align: center; color: #1e1b4b; margin-bottom: 6px; font-size: 18px; text-transform: uppercase;">
  RENDICONTO ATTIVITÀ & PROSPETTO ONORARI
</h1>
<p style="text-align: center; color: #64748b; font-size: 11px; margin-bottom: 24px;">
  Commessa: <strong>{{progetto.titolo}}</strong> · Data di rendicontazione: {{data_odierna}}
</p>

<p style="font-size: 11.5px; line-height: 1.6; text-align: justify; margin-bottom: 16px;">
  Il presente prospetto attesta le prestazioni professionali e le attività di advisory prestate da <strong>{{studio.ragione_sociale}}</strong> a favore di <strong>{{cliente.ragione_sociale}}</strong> (P.IVA {{cliente.partita_iva}}), con riferimento al dossier <strong>{{progetto.titolo}}</strong>.
</p>

<table style="width: 100%; border-collapse: collapse; margin-bottom: 20px; font-size: 11px;">
  <thead>
    <tr style="background: #0f172a; color: white;">
      <th style="padding: 8px; text-align: left;">Voce di Attività / Deliverable</th>
      <th style="padding: 8px; text-align: center; width: 80px;">Stato</th>
      <th style="padding: 8px; text-align: right; width: 110px;">Valore (€)</th>
    </tr>
  </thead>
  <tbody>
    <tr style="border-bottom: 1px solid #e2e8f0;">
      <td style="padding: 8px;">Consulenza specialistica e redazione atti dossier <strong>{{progetto.titolo}}</strong></td>
      <td style="padding: 8px; text-align: center; color: #16a34a; font-weight: 600;">Eseguito</td>
      <td style="padding: 8px; text-align: right; font-weight: 600;">{{progetto.importo_totale}}</td>
    </tr>
  </tbody>
  <tfoot>
    <tr style="background: #f8fafc; font-weight: 700; font-size: 12px;">
      <td style="padding: 10px 8px;" colspan="2">Totale Compensi Maturati:</td>
      <td style="padding: 10px 8px; text-align: right; color: #0f172a;">{{progetto.importo_totale}}</td>
    </tr>
  </tfoot>
</table>

<div style="background: #f8fafc; border: 1px solid #e2e8f0; border-radius: 6px; padding: 12px; font-size: 11px; margin-bottom: 24px;">
  <strong>Coordinate per il regolamento finanziario:</strong><br/>
  Accredito c/o: <strong>{{studio.iban}}</strong> · Intestato a: <strong>{{studio.ragione_sociale}}</strong>
</div>

<div style="display: flex; justify-content: space-between; margin-top: 30px;">
  <div style="width: 45%; text-align: center; border-top: 1px solid #cbd5e1; padding-top: 8px; font-size: 11px;">
    <strong>Per il Committente (per presa visione):</strong><br/>
    {{cliente.referente}}<br/>
    {{firma_cliente}}
  </div>
  <div style="width: 45%; text-align: center; border-top: 1px solid #cbd5e1; padding-top: 8px; font-size: 11px;">
    <strong>Per lo Studio Professionale:</strong><br/>
    {{studio.ragione_sociale}}<br/>
    {{firma_studio}}
  </div>
</div>
`,
  },
  {
    id: 'tmpl-gdpr-informativa-en',
    titolo: 'Privacy Notice GDPR (EN)',
    categoria: 'compliance',
    descrizione: 'English translation (first pass, to be reviewed) of the GDPR privacy notice for the residence-relocation service.',
    livelloFirmaRichiesto: 'ses',
    contenutoHtml: `
<h2 style="text-align:center;">Privacy Notice (GDPR) on the Processing of Personal Data</h2>
<p><em>Courtesy translation of the Italian original; the Italian version prevails in case of discrepancy.</em></p>
<p>{{studio.ragione_sociale}} (the "Data Controller"), with registered office at {{studio.sede_legale}}, informs you pursuant to Article 13 of Regulation (EU) 2016/679 ("GDPR") on how your personal data are collected, used and protected.</p>
<p><strong>Categories of data.</strong> Identification data (name, surname, date of birth, address, tax code); contact data (phone, email); identity documents (ID card, passport); contractual and tax data related to the service; other data necessary to meet contractual and legal obligations.</p>
<p><strong>Purposes.</strong> Handling your request and providing the residence-relocation advisory service; related contractual and administrative fulfilments; compliance with legal obligations, including tax, anti-money-laundering (AML) and security; communications and updates about the service.</p>
<p><strong>Legal basis.</strong> Performance of a contract to which you are a party; compliance with the Controller's legal obligations; your consent, where required.</p>
<p><strong>Processing and retention.</strong> Data are processed by manual, IT and electronic means with adequate security measures, and retained for the period necessary for the stated purposes and in any case no longer than the legal terms.</p>
<p><strong>Disclosure.</strong> Data may be disclosed to competent public authorities and administrations; advisors and collaborators involved in the service; banking and financial institutions where necessary.</p>
<p><strong>Your rights.</strong> Access, rectification or erasure, restriction, objection, portability, withdrawal of consent (without affecting prior lawful processing) and lodging a complaint with the supervisory authority.</p>
<p><strong>Contact.</strong> To exercise your rights, contact the Data Controller at: {{studio.email}}.</p>
<p>Date: {{data_odierna}}</p>
<div style="margin-top:24px; border-top:1px solid #cbd5e1; padding-top:8px; width:45%; text-align:center; font-size:11px;"><strong>Acknowledged and signed ({{cliente.ragione_sociale}})</strong><br/>{{firma_cliente}}</div>
`,
  },
  {
    id: 'tmpl-hospitality-agreement-it',
    titolo: 'Accordo di Ospitalità con Rimborso Spese (IT) — Malta',
    categoria: 'contratto',
    descrizione: 'Traduzione italiana (primo passo, da rivedere) dello Hospitality Agreement — posto letto, €250/mese, contesto Malta.',
    livelloFirmaRichiesto: 'ses',
    contenutoHtml: `
<h2 style="text-align:center;">ACCORDO DI OSPITALITÀ CON RIMBORSO SPESE</h2>
<p><em>Traduzione di cortesia dell'originale inglese; in caso di discrepanza prevale la versione inglese.</em></p>
<p><strong>Tra:</strong><br/>
{{studio.ragione_sociale}}, con sede legale in {{studio.sede_legale}}, registrata a Malta con numero di registrazione {{studio.codice_fiscale}}, di seguito "Host";<br/>
<strong>e</strong><br/>
{{cliente.ragione_sociale}}, nato/a in {{cliente.luogo_nascita}} il {{cliente.data_nascita}}, residente in {{cliente.indirizzo_residenza}}, titolare di documento/passaporto n. {{cliente.documento_numero}}, di seguito "Guest".</p>
<p><strong>Premesso che</strong> l'Host ha preso in locazione un appartamento sito in {{cliente.indirizzo_alloggio}}, Malta, e intende ospitare il Guest durante il rapporto di collaborazione, fissando un rimborso spese a carico del Guest, si conviene quanto segue:</p>
<p><strong>Articolo 1 – Finalità.</strong> L'Host concede al Guest l'uso di un posto letto e l'accesso alle aree comuni dell'appartamento sito in {{cliente.indirizzo_alloggio}}, Malta, per la durata del presente accordo.</p>
<p><strong>Articolo 2 – Durata.</strong> Efficace dalla data di firma; durata fissa di un (1) anno, con cessazione automatica senza preavviso.</p>
<p><strong>Articolo 3 – Rimborso spese.</strong> Il Guest corrisponde €250 (duecentocinquanta euro) al mese, entro il 5 di ogni mese, sul conto indicato dall'Host.</p>
<p><strong>Articolo 4 – Uso e regole della casa.</strong> Il Guest si impegna a: usare l'appartamento con cura e rispettare il regolamento condominiale e le istruzioni dell'Host; non subaffittare, cedere o ospitare terzi senza consenso scritto; mantenere puliti e in ordine il posto letto e le aree comuni.</p>
<p><strong>Articolo 5 – Registrazioni obbligatorie.</strong> L'Host registra la presenza del Guest presso le autorità competenti come richiesto dalla legge maltese (Housing Authority Malta).</p>
<p><strong>Articolo 6 – Assicurazione e responsabilità.</strong> Il Guest riconosce che l'Host non è responsabile per danni a persone o cose non causati da colpa grave dell'Host.</p>
<p><strong>Articolo 7 – Clausola finale.</strong> Il presente accordo non costituisce un contratto di locazione ma unicamente un accordo di ospitalità per alloggio temporaneo connesso alla collaborazione con l'Host.</p>
<p>Letto, confermato e sottoscritto. Data: {{data_odierna}}</p>
<div style="display:flex; justify-content:space-between; margin-top:32px;">
  <div style="width:45%; text-align:center; border-top:1px solid #cbd5e1; padding-top:8px; font-size:11px;"><strong>L'Host (per {{studio.ragione_sociale}})</strong><br/>{{firma_studio}}</div>
  <div style="width:45%; text-align:center; border-top:1px solid #cbd5e1; padding-top:8px; font-size:11px;"><strong>Il Guest ({{cliente.ragione_sociale}})</strong><br/>{{firma_cliente}}</div>
</div>
`,
  },
  {
    id: 'tmpl-service-agreement-it',
    titolo: 'Contratto di Servizi al Guest (IT) — Malta',
    categoria: 'contratto',
    descrizione: 'Traduzione italiana (primo passo, da rivedere) del Service Agreement — servizi al guest, €200/mese, contesto Malta.',
    livelloFirmaRichiesto: 'ses',
    contenutoHtml: `
<h2 style="text-align:center;">CONTRATTO DI SERVIZI AL GUEST</h2>
<p><em>Traduzione di cortesia dell'originale inglese; in caso di discrepanza prevale la versione inglese.</em></p>
<p><strong>Tra:</strong><br/>
{{studio.ragione_sociale}}, con sede legale in {{studio.sede_legale}}, registrata a Malta con numero di registrazione {{studio.codice_fiscale}}, di seguito "Host";<br/>
<strong>e</strong><br/>
{{cliente.ragione_sociale}}, nato/a in {{cliente.luogo_nascita}} il {{cliente.data_nascita}}, residente in {{cliente.indirizzo_residenza}}, titolare di documento/passaporto n. {{cliente.documento_numero}}, di seguito "Guest".</p>
<p><strong>Premesso che</strong> il Guest risiede nell'alloggio sito in {{cliente.indirizzo_alloggio}}, Malta, e desidera beneficiare di servizi di pulizia e assistenza nelle pratiche amministrative e burocratiche relative al soggiorno a Malta, si conviene quanto segue:</p>
<p><strong>Articolo 1 – Oggetto.</strong> L'Host si impegna a fornire: pulizia regolare del posto letto e delle aree comuni (almeno una volta a settimana); assistenza nelle pratiche amministrative e burocratiche relative alla residenza a Malta, inclusa la registrazione presso la Housing Authority e l'orientamento sulla documentazione richiesta.</p>
<p><strong>Articolo 2 – Corrispettivo.</strong> Il Guest corrisponde un canone mensile di €200 (duecento euro), entro il 5 di ogni mese, sul conto indicato dall'Host.</p>
<p><strong>Articolo 3 – Durata.</strong> Efficace dalla data di firma; durata fissa di un (1) anno, con cessazione automatica senza preavviso.</p>
<p><strong>Articolo 4 – Responsabilità.</strong> L'Host esegue i servizi con diligenza ma non è responsabile di ritardi o inadempimenti dovuti a circostanze al di fuori del suo ragionevole controllo, inclusi i ritardi delle autorità pubbliche.</p>
<p><strong>Articolo 5 – Disposizioni finali.</strong> Il presente accordo costituisce l'intesa integrale tra le parti e sostituisce ogni accordo precedente. Le modifiche vanno fatte per iscritto e firmate da entrambe le parti.</p>
<p>Letto, confermato e sottoscritto. Data: {{data_odierna}}</p>
<div style="display:flex; justify-content:space-between; margin-top:32px;">
  <div style="width:45%; text-align:center; border-top:1px solid #cbd5e1; padding-top:8px; font-size:11px;"><strong>L'Host (per {{studio.ragione_sociale}})</strong><br/>{{firma_studio}}</div>
  <div style="width:45%; text-align:center; border-top:1px solid #cbd5e1; padding-top:8px; font-size:11px;"><strong>Il Guest ({{cliente.ragione_sociale}})</strong><br/>{{firma_cliente}}</div>
</div>
`,
  },
  {
    id: 'tmpl-gdpr-informativa-it',
    titolo: 'Informativa Privacy GDPR (IT)',
    categoria: 'compliance',
    descrizione: 'Informativa ex art. 13 GDPR per il trattamento dei dati personali (consulenza trasferimento residenza) — versione italiana originale.',
    livelloFirmaRichiesto: 'ses',
    contenutoHtml: `
<h2 style="text-align:center;">Informativa Privacy (GDPR) per il Trattamento dei Dati Personali</h2>
<p>{{studio.ragione_sociale}} (di seguito "Titolare del trattamento"), con sede in {{studio.sede_legale}}, in qualità di Titolare del trattamento dei dati personali, La informa ai sensi dell'art. 13 del Regolamento UE 2016/679 ("GDPR") sulle modalità di raccolta, utilizzo e tutela dei Suoi dati personali.</p>
<p><strong>Tipologia di dati raccolti.</strong> Dati identificativi (nome, cognome, data di nascita, indirizzo, codice fiscale); dati di contatto (telefono, email); documenti di identità (carta d'identità, passaporto); dati contrattuali e fiscali relativi alla prestazione del servizio; altri dati necessari ad adempiere agli obblighi contrattuali e normativi.</p>
<p><strong>Finalità del trattamento.</strong> Gestione della richiesta ed erogazione del servizio di consulenza per trasferimento di residenza; adempimenti contrattuali e amministrativi correlati; rispetto degli obblighi di legge, inclusi quelli fiscali, antiriciclaggio (AML) e di sicurezza; comunicazioni e aggiornamenti relativi al servizio.</p>
<p><strong>Base giuridica.</strong> Esecuzione di un contratto di cui Lei è parte; rispetto di obblighi legali cui il Titolare è soggetto; il Suo consenso, ove richiesto.</p>
<p><strong>Modalità e conservazione.</strong> I dati sono trattati con strumenti manuali, informatici e telematici, con misure di sicurezza adeguate, e conservati per il periodo necessario alle finalità indicate e comunque non oltre i termini di legge.</p>
<p><strong>Comunicazione dei dati.</strong> I dati potranno essere comunicati a: autorità pubbliche e amministrazioni competenti; consulenti e collaboratori coinvolti nell'erogazione del servizio; istituti bancari e finanziari, se necessario.</p>
<p><strong>Diritti dell'interessato.</strong> Accesso, rettifica o cancellazione, limitazione, opposizione, portabilità, revoca del consenso (senza pregiudicare la liceità del trattamento precedente) e reclamo all'Autorità Garante.</p>
<p><strong>Contatti.</strong> Per esercitare i Suoi diritti può contattare il Titolare all'indirizzo: {{studio.email}}.</p>
<p>Data: {{data_odierna}}</p>
<div style="margin-top:24px; border-top:1px solid #cbd5e1; padding-top:8px; width:45%; text-align:center; font-size:11px;"><strong>Firma per presa visione ({{cliente.ragione_sociale}})</strong><br/>{{firma_cliente}}</div>
`,
  },
  {
    id: 'tmpl-hospitality-agreement-en',
    titolo: 'Hospitality Agreement with Expense Reimbursement (EN) — Malta',
    categoria: 'contratto',
    descrizione: 'Accordo di ospitalità (posto letto) con rimborso spese, €250/mese — versione inglese originale, contesto Malta.',
    livelloFirmaRichiesto: 'ses',
    contenutoHtml: `
<h2 style="text-align:center;">HOSPITALITY AGREEMENT WITH EXPENSE REIMBURSEMENT</h2>
<p><strong>Between:</strong><br/>
{{studio.ragione_sociale}}, with registered office at {{studio.sede_legale}}, registered in Malta with company registration number {{studio.codice_fiscale}}, hereinafter the "Host";<br/>
<strong>and</strong><br/>
{{cliente.ragione_sociale}}, born in {{cliente.luogo_nascita}} on {{cliente.data_nascita}}, currently residing at {{cliente.indirizzo_residenza}}, holder of ID/Passport no. {{cliente.documento_numero}}, hereinafter the "Guest".</p>
<p><strong>Whereas</strong> the Host has leased an apartment located at {{cliente.indirizzo_alloggio}}, Malta, and intends to accommodate the Guest during the collaboration relationship, setting an expense reimbursement payable by the Guest, it is agreed as follows:</p>
<p><strong>Article 1 – Purpose.</strong> The Host grants the Guest the use of a bed space and access to shared areas of the apartment located at {{cliente.indirizzo_alloggio}}, Malta, for the duration of this agreement.</p>
<p><strong>Article 2 – Duration.</strong> Effective from the date of signature; fixed duration of one (1) year, terminating automatically without further notice.</p>
<p><strong>Article 3 – Expense reimbursement.</strong> The Guest shall pay €250 (two hundred fifty euros) per month, by the 5th day of each month, to the bank account indicated by the Host.</p>
<p><strong>Article 4 – Use and house rules.</strong> The Guest shall: use the apartment with care and comply with condominium rules and the Host's instructions; not sublet, assign or accommodate third parties without written consent; keep the bed space and shared areas clean and tidy.</p>
<p><strong>Article 5 – Mandatory registrations.</strong> The Host shall register the Guest's presence with the competent authorities as required by Maltese law (Housing Authority Malta).</p>
<p><strong>Article 6 – Insurance and liability.</strong> The Guest acknowledges that the Host is not liable for damage to persons or property not caused by the Host's gross negligence.</p>
<p><strong>Article 7 – Final clause.</strong> This agreement does not constitute a lease agreement but solely an accommodation agreement for temporary housing related to the collaboration with the Host.</p>
<p>Read, confirmed and signed. Date: {{data_odierna}}</p>
<div style="display:flex; justify-content:space-between; margin-top:32px;">
  <div style="width:45%; text-align:center; border-top:1px solid #cbd5e1; padding-top:8px; font-size:11px;"><strong>The Host (on behalf of {{studio.ragione_sociale}})</strong><br/>{{firma_studio}}</div>
  <div style="width:45%; text-align:center; border-top:1px solid #cbd5e1; padding-top:8px; font-size:11px;"><strong>The Guest ({{cliente.ragione_sociale}})</strong><br/>{{firma_cliente}}</div>
</div>
`,
  },
  {
    id: 'tmpl-service-agreement-en',
    titolo: 'Service Agreement for Guest (EN) — Malta',
    categoria: 'contratto',
    descrizione: 'Contratto di servizi al guest (pulizie + assistenza burocratica), €200/mese — versione inglese originale, contesto Malta.',
    livelloFirmaRichiesto: 'ses',
    contenutoHtml: `
<h2 style="text-align:center;">SERVICE AGREEMENT FOR GUEST</h2>
<p><strong>Between:</strong><br/>
{{studio.ragione_sociale}}, with registered office at {{studio.sede_legale}}, registered in Malta with company registration number {{studio.codice_fiscale}}, hereinafter the "Host";<br/>
<strong>and</strong><br/>
{{cliente.ragione_sociale}}, born in {{cliente.luogo_nascita}} on {{cliente.data_nascita}}, currently residing at {{cliente.indirizzo_residenza}}, holder of ID/Passport no. {{cliente.documento_numero}}, hereinafter the "Guest".</p>
<p><strong>Whereas</strong> the Guest is residing in the accommodation located at {{cliente.indirizzo_alloggio}}, Malta, and wishes to benefit from cleaning services and assistance with administrative and bureaucratic tasks related to their stay in Malta, it is agreed as follows:</p>
<p><strong>Article 1 – Subject.</strong> The Host undertakes to provide: regular cleaning of the bed space and shared areas of the apartment (at least once per week); assistance with administrative and bureaucratic tasks related to residence in Malta, including registration with the Housing Authority and guidance on required documentation.</p>
<p><strong>Article 2 – Fee and payment.</strong> The Guest shall pay a monthly fee of €200 (two hundred euros), by the 5th day of each month, to the bank account indicated by the Host.</p>
<p><strong>Article 3 – Duration.</strong> Effective from the date of signature; fixed duration of one (1) year, terminating automatically without further notice.</p>
<p><strong>Article 4 – Liability.</strong> The Host shall perform the services with due diligence but shall not be liable for delays or failures caused by circumstances beyond its reasonable control, including delays from public authorities.</p>
<p><strong>Article 5 – Final provisions.</strong> This agreement constitutes the entire understanding between the parties and supersedes any prior agreement. Amendments shall be made in writing and signed by both parties.</p>
<p>Read, confirmed and signed. Date: {{data_odierna}}</p>
<div style="display:flex; justify-content:space-between; margin-top:32px;">
  <div style="width:45%; text-align:center; border-top:1px solid #cbd5e1; padding-top:8px; font-size:11px;"><strong>The Host (on behalf of {{studio.ragione_sociale}})</strong><br/>{{firma_studio}}</div>
  <div style="width:45%; text-align:center; border-top:1px solid #cbd5e1; padding-top:8px; font-size:11px;"><strong>The Guest ({{cliente.ragione_sociale}})</strong><br/>{{firma_cliente}}</div>
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
  const clientDocNum = targetCliente?.documentoNumero || '';
  const clientDocTipo = targetCliente?.documentoTipo || '';
  const clientDataNasc = targetCliente?.dataNascita || '';
  const clientLuogoNasc = targetCliente?.luogoNascita || '';
  const clientIndRes = targetCliente?.indirizzoResidenza || '';
  const clientIndAllog = targetCliente?.indirizzoAlloggio || '';
  const studioCodFisc = targetStudio?.codiceFiscale || studioInfo.codiceFiscale || '';

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
  out = out.replace(/\{\{cliente\.documento_numero\}\}/g, wrapTag(clientDocNum));
  out = out.replace(/\{\{cliente\.documento_tipo\}\}/g, wrapTag(clientDocTipo));
  out = out.replace(/\{\{cliente\.data_nascita\}\}/g, wrapTag(clientDataNasc));
  out = out.replace(/\{\{cliente\.luogo_nascita\}\}/g, wrapTag(clientLuogoNasc));
  out = out.replace(/\{\{cliente\.indirizzo_residenza\}\}/g, wrapTag(clientIndRes));
  out = out.replace(/\{\{cliente\.indirizzo_alloggio\}\}/g, wrapTag(clientIndAllog));

  out = out.replace(/\{\{progetto\.titolo\}\}/g, wrapTag(projTitolo));
  out = out.replace(/\{\{progetto\.importo_totale\}\}/g, wrapTag(projImporto ? `€ ${Number(projImporto).toLocaleString('it-IT')},00` : '€ 0,00'));

  out = out.replace(/\{\{studio\.ragione_sociale\}\}/g, wrapTag(studioRagioneSociale));
  out = out.replace(/\{\{studio\.piva\}\}/g, wrapTag(studioPiva));
  out = out.replace(/\{\{studio\.codice_fiscale\}\}/g, wrapTag(studioCodFisc));
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

  // 0. Modelli Malta «trasferimento residenza / guest» (modulo mod-r01, art-r02/r03/r05).
  //    Vanno PRIMA delle regole generiche: «Contratto di servizi al guest» sarebbe altrimenti
  //    catturato dalla regola «contratto», e «Informativa privacy GDPR» dalla regola compliance
  //    (che punta alla checklist KYC, non all'informativa). I default IT si allineano alla UI
  //    dello studio; l'operatore può scegliere la versione EN a fronte dal catalogo.
  if (v.includes('ospitalit') || v.includes('hospitality') || v.includes('posto letto')) {
    const found = PREBUILT_TEMPLATES.find(t => t.id === 'tmpl-hospitality-agreement-it');
    if (found) return found;
  }
  if (v.includes('service agreement') || v.includes('servizi al guest') || (v.includes('guest') && v.includes('serviz'))) {
    const found = PREBUILT_TEMPLATES.find(t => t.id === 'tmpl-service-agreement-it');
    if (found) return found;
  }
  if (v.includes('gdpr') || v.includes('privacy') || v.includes('informativa')) {
    const found = PREBUILT_TEMPLATES.find(t => t.id === 'tmpl-gdpr-informativa-it');
    if (found) return found;
  }

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



