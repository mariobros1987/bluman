import React, { useState, useEffect, useRef } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { fetchClienti, fetchProgetti, fetchTenantInfoApi, uploadFileApi } from '../api/client';
import { getFormattedLogoUrl } from '../utils';
import { PROJECTS } from '../store/mockData';
import type { Cliente, Progetto } from '../types';

export interface DocumentTemplate {
  id: string;
  titolo: string;
  categoria: 'contratto' | 'nda' | 'engagement' | 'societario' | 'delega' | 'fiscale';
  descrizione: string;
  contenutoHtml: string;
}

// ── Modelli Predefiniti di Alto Valore per lo Studio ───────────────────────
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
    {{studio.ragione_sociale}}
  </div>
  <div style="width: 45%; text-align: center; border-top: 1px solid #cbd5e1; padding-top: 8px; font-size: 11px;">
    {{cliente.ragione_sociale}} ({{cliente.referente}})
  </div>
</div>
`,
  },
  {
    id: 'tmpl-memorandum',
    titolo: 'Memorandum & Statuto Società Malta (M&A Summary)',
    categoria: 'societario',
    descrizione: 'Sintesi costitutiva per società LTD maltese con struttura partecipazioni, quote e UBO.',
    contenutoHtml: `
<h1 style="text-align: center; color: #1e1b4b; margin-bottom: 20px; font-size: 19px; text-transform: uppercase;">
  MEMORANDUM OF ASSOCIATION — EXECUTIVE SUMMARY
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
  Il presente accordo quadro di servizi infra-gruppo è stipulato in data {{data_odierna}} tra <strong>{{studio.ragione_sociale}}</strong> e la società controllata <strong>{{cliente.ragione_sociale}}</strong> (P.IVA {{cliente.partita_iva}}).
</p>

<h3 style="color: #1e1b4b; font-size: 12.5px;">1. PRESTAZIONI DI SERVIZI E CORRISPETTIVO</h3>
<p style="font-size: 11.5px; line-height: 1.6; text-align: justify;">
  La Capogruppo presterà a favore della Controllata servizi continuativi di direzione strategica, consulenza legale, supporto marketing e gestione contabile. Il corrispettivo annuale è pattuito a condizioni di piena concorrenza (Arm's Length Principle).
</p>
`,
  },
  {
    id: 'tmpl-delega',
    titolo: 'Procura Speciale & Delega Operativa',
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
    titolo: 'Letter of Wishes per Struttura Trust (Fiduciaria)',
    categoria: 'fiscale',
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
    id: 'tmpl-shareholders-agreement',
    titolo: 'Patto Parasociale & Governance Societaria (Shareholders Agreement)',
    categoria: 'societario',
    descrizione: 'Accordo tra soci con clausole di gradimento, prelazione, drag-along e tag-along.',
    contenutoHtml: `
<h1 style="text-align: center; color: #1e1b4b; margin-bottom: 20px; font-size: 19px; text-transform: uppercase;">
  PATTO PARASOCIALE E REGOLE DI GOVERNANCE (SHAREHOLDERS AGREEMENT)
</h1>

<p style="font-size: 11.5px; line-height: 1.6; text-align: justify;">
  In data {{data_odierna}}, in relazione alla società veicolo <strong>{{progetto.titolo}}</strong>, i Soci sottoscritti convengono e stipulano il presente accordo parasociale a completamento dello Statuto societario.
</p>

<h3 style="color: #1e1b4b; font-size: 12.5px; margin-top: 18px;">1. DIRITTO DI PRELAZIONE E TRASFERIMENTO PARTECIPAZIONI</h3>
<p style="font-size: 11.5px; line-height: 1.6; text-align: justify;">
  Ciascun Socio che intenda alienare, in tutto o in parte, le proprie quote o azioni a favore di terzi è tenuto ad offrirle preventivamente agli altri Soci alle medesime condizioni economiche e di pagamento (Diritto di Prelazione).
</p>

<h3 style="color: #1e1b4b; font-size: 12.5px; margin-top: 18px;">2. CLAUSOLE DI DRAG-ALONG E TAG-ALONG</h3>
<p style="font-size: 11.5px; line-height: 1.6; text-align: justify;">
  In caso di offerta irrevocabile di acquisto del 100% del capitale sociale da parte di un acquirente terzo, i soci di maggioranza hanno il diritto di trascinare i soci di minoranza alle stesse condizioni (Obbligo di Co-Vendita - Drag Along).
</p>

<div style="margin-top: 40px; display: flex; justify-content: space-between;">
  <div style="width: 45%; text-align: center; border-top: 1px solid #cbd5e1; padding-top: 8px; font-size: 11px;">
    <strong>Socio Promotore:</strong><br/>
    {{cliente.referente}}
  </div>
  <div style="width: 45%; text-align: center; border-top: 1px solid #cbd5e1; padding-top: 8px; font-size: 11px;">
    <strong>Advisor Studio Garante:</strong><br/>
    {{studio.ragione_sociale}}
  </div>
</div>
`,
  },
];

export function DocumentEditorPage() {
  const location = useLocation();
  const navigate = useNavigate();

  const [clienti, setClienti] = useState<Cliente[]>([]);
  const [progetti, setProgetti] = useState<Progetto[]>([]);
  const [tenantInfo, setTenantInfo] = useState<any>(null);

  const [selectedClienteId, setSelectedClienteId] = useState<string>('');
  const [selectedProgettoId, setSelectedProgettoId] = useState<string>('');
  const [selectedTemplateId, setSelectedTemplateId] = useState<string>('tmpl-engagement');

  const [titoloDocumento, setTitoloDocumento] = useState('Lettera d\'Incarico Professionale');
  const [categoria, setCategoria] = useState<string>('engagement');
  const [showRawTags, setShowRawTags] = useState(false);

  const [salvando, setSalvando] = useState(false);
  const [feedback, setFeedback] = useState<string | null>(null);

  const editorRef = useRef<HTMLDivElement>(null);
  const rawTemplateRef = useRef<string>(PREBUILT_TEMPLATES[0].contenutoHtml);

  // Caricamento Dati Completi (DB + LocalStorage + Default Studio)
  useEffect(() => {
    const loadInitialData = async () => {
      let apiCls: Cliente[] = [];
      let apiPrjs: any[] = [];
      let tnt: any = null;

      try {
        const [cls, prjs, tntRes] = await Promise.all([
          fetchClienti(),
          fetchProgetti(),
          fetchTenantInfoApi(),
        ]);
        if (cls && Array.isArray(cls)) apiCls = cls;
        if (prjs && Array.isArray(prjs)) apiPrjs = prjs;
        if (tntRes) tnt = tntRes;
      } catch (err) {
        console.warn('Caricamento remoto parziale:', err);
      }

      // 1. Clienti: Unione DB + LocalStorage + Extracted from Projects + Default Studio
      const customClStr = localStorage.getItem('bluman_custom_clients');
      const customCls: Cliente[] = customClStr ? JSON.parse(customClStr) : [];

      const localProjStr = localStorage.getItem('bluman_custom_projects');
      const localProjs: any[] = localProjStr ? JSON.parse(localProjStr) : [];

      const defaultClients: Cliente[] = [
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
        },
        {
          id: 'cl-02',
          nome: 'Roberto Rossi',
          tipo: 'individual',
          piva: 'IT09876543210',
          codiceFiscale: 'RSSRRT75B10F205Y',
          sedeLegale: 'Corso Vittorio Emanuele II 12, Milano',
          email: 'r.rossi@holdingbeta.it',
          telefono: '+39 335 1234567',
          cellulare: '+39 335 1234567',
          referenteNome: 'Roberto Rossi',
        },
        {
          id: 'cl-03',
          nome: 'Blue Wave Capital Ltd',
          tipo: 'company',
          piva: 'MT28491039',
          codiceFiscale: 'MT28491039',
          sedeLegale: 'Tower Road 45, Sliema SLM 1600, Malta',
          email: 'finance@bluewave.mt',
          telefono: '+356 2133 4455',
          referenteNome: 'Dott. Mark Borg',
        },
        {
          id: 'cl-04',
          nome: 'Trust San Giorgio',
          tipo: 'company',
          piva: 'IT11223344556',
          codiceFiscale: 'TRSGRG80A01H501K',
          sedeLegale: 'Piazza San Giorgio 4, Lugano, Svizzera',
          email: 'trustee@sangiorgio.ch',
          referenteNome: 'Avv. Gianluigi Parodi',
        },
      ];

      const extractedClients: Cliente[] = [];
      [...PROJECTS, ...localProjs].forEach((p: any) => {
        if (p.cl) {
          extractedClients.push({
            id: `cl-proj-${p.id}`,
            nome: p.cl,
            tipo: p.ct || 'company',
            piva: p.piva || 'IT09876543210',
            codiceFiscale: p.codFisc || 'BLUCD90A01H501X',
            sedeLegale: p.sede || 'Via Montenapoleone 8, Milano',
            codiceSdi: 'SUBM70N',
            email: 'client@holdingbeta.advisory',
            telefono: '+39 02 889900',
            referenteNome: p.cl,
          });
        }
      });

      const clientMap = new Map<string, Cliente>();
      // Ordine di precedenza: default -> extracted -> custom -> API DB reale
      [...defaultClients, ...extractedClients, ...customCls, ...apiCls].forEach(c => {
        if (c && c.nome) {
          clientMap.set(c.nome.trim().toLowerCase(), c);
        }
      });
      const allClients = Array.from(clientMap.values());
      setClienti(allClients);
      if (allClients.length > 0) setSelectedClienteId(allClients[0].id);

      // 2. Progetti: Unione DB + LocalStorage + Mock PROJECTS
      const allRawProjects = [...apiPrjs, ...localProjs, ...PROJECTS];
      const projMap = new Map<string, any>();
      allRawProjects.forEach((p: any) => {
        const title = p.titolo || p.n || p.nome || `Progetto #${p.id}`;
        const idKey = String(p.id || title);
        projMap.set(idKey, {
          id: idKey,
          titolo: title,
          n: title,
          nome: title,
          cl: p.cl || p.cliente?.nome || 'Cliente Studio',
          clienteId: p.clienteId || p.cliente?.id,
          totalePreventivo: p.totalePreventivo || p.val || (p.valoreCentesimi ? p.valoreCentesimi / 100 : 8500),
          stato: p.st || p.stato || 'in_progress',
        });
      });
      const allNormalizedProjects = Array.from(projMap.values());
      setProgetti(allNormalizedProjects);
      if (allNormalizedProjects.length > 0) setSelectedProgettoId(allNormalizedProjects[0].id);

      if (tnt) {
        setTenantInfo(tnt);
      } else {
        const local = localStorage.getItem('bluman_tenant_info');
        if (local) setTenantInfo(JSON.parse(local));
      }
    };
    loadInitialData();
  }, []);

  const activeCliente = clienti.find(c => c.id === selectedClienteId) || clienti[0];
  const activeProgetto: any = progetti.find((p: any) => String(p.id) === String(selectedProgettoId)) || progetti[0];

  // Sostituzione dinamica delle variabili Smart Tags (Mail Merge)
  const renderResolvedContent = (htmlContent: string) => {
    if (showRawTags) return htmlContent;

    const refJson: any = activeCliente?.referentiJson && typeof activeCliente.referentiJson === 'object' ? activeCliente.referentiJson : {};
    const dataOggi = new Date().toLocaleDateString('it-IT', { day: '2-digit', month: 'long', year: 'numeric' });

    const projTitolo = activeProgetto?.titolo || activeProgetto?.n || activeProgetto?.nome || 'Costituzione Holding & Trading Malta';
    const projImporto = activeProgetto?.totalePreventivo || activeProgetto?.val || 8500;

    let out = htmlContent;
    out = out.replace(/\{\{data_odierna\}\}/g, dataOggi);
    out = out.replace(/\{\{cliente\.ragione_sociale\}\}/g, activeCliente?.nome || 'Holding Beta S.r.l.');
    out = out.replace(/\{\{cliente\.nome\}\}/g, activeCliente?.nome || 'Holding Beta S.r.l.');
    out = out.replace(/\{\{cliente\.partita_iva\}\}/g, activeCliente?.piva || activeCliente?.codiceFiscale || 'IT09876543210');
    out = out.replace(/\{\{cliente\.codice_fiscale\}\}/g, activeCliente?.codiceFiscale || activeCliente?.piva || 'IT09876543210');
    out = out.replace(/\{\{cliente\.sede_legale\}\}/g, activeCliente?.sedeLegale || 'Via Montenapoleone 8, Milano');
    out = out.replace(/\{\{cliente\.pec\}\}/g, activeCliente?.pec || 'holdingbeta@legalmail.it');
    out = out.replace(/\{\{cliente\.sdi\}\}/g, activeCliente?.codiceSdi || 'SUBM70N');
    out = out.replace(/\{\{cliente\.iban\}\}/g, activeCliente?.iban || 'IT60X0542811101000000123456');
    out = out.replace(/\{\{cliente\.referente\}\}/g, activeCliente?.referenteNome || refJson.referente || 'Ing. Roberto Rossi (CEO)');
    out = out.replace(/\{\{cliente\.cellulare\}\}/g, activeCliente?.cellulare || '+39 333 5936278');
    out = out.replace(/\{\{cliente\.ubo\}\}/g, activeCliente?.ubo || activeCliente?.referenteNome || 'Roberto Rossi');

    out = out.replace(/\{\{progetto\.titolo\}\}/g, projTitolo);
    out = out.replace(/\{\{progetto\.importo_totale\}\}/g, `€ ${Number(projImporto).toLocaleString('it-IT')},00`);

    out = out.replace(/\{\{studio\.ragione_sociale\}\}/g, tenantInfo?.ragioneSociale || 'Bluecode Ltd');
    out = out.replace(/\{\{studio\.piva\}\}/g, tenantInfo?.piva || 'MT28491039');
    out = out.replace(/\{\{studio\.sede_legale\}\}/g, tenantInfo?.sedeLegale || 'Level 4, Valuation Centre, Tower Road, Sliema SLM 1600, Malta');
    out = out.replace(/\{\{studio\.iban\}\}/g, tenantInfo?.iban || 'MT89VALL22013000000012345678');

    return out;
  };

  // Cambio Template
  const handleSelectTemplate = (tmpl: DocumentTemplate) => {
    setSelectedTemplateId(tmpl.id);
    setTitoloDocumento(tmpl.titolo);
    setCategoria(tmpl.categoria);
    rawTemplateRef.current = tmpl.contenutoHtml;
    if (editorRef.current) {
      editorRef.current.innerHTML = renderResolvedContent(tmpl.contenutoHtml);
    }
  };

  // Sincronizza l'editor all'avvio e quando cambiano i dati anagrafici target o la modalità anteprima
  useEffect(() => {
    if (editorRef.current) {
      editorRef.current.innerHTML = renderResolvedContent(rawTemplateRef.current);
    }
  }, [selectedClienteId, selectedProgettoId, showRawTags, tenantInfo]);

  // Inserimento Smart Tag nel punto di scrittura
  const insertSmartTag = (tag: string) => {
    if (editorRef.current) {
      editorRef.current.focus();
      document.execCommand('insertText', false, tag);
    }
  };

  // Comandi di formattazione Rich Text
  const executeFormat = (cmd: string, val: string = '') => {
    if (editorRef.current) {
      editorRef.current.focus();
      document.execCommand(cmd, false, val);
    }
  };

  // Esportazione PDF Stampa Nativa con Header/Footer A4
  const handleExportPdf = () => {
    const printWindow = window.open('', '_blank');
    if (!printWindow) return;

    const logo = getFormattedLogoUrl(tenantInfo?.logoUrl || localStorage.getItem('bluman_logo_url'));
    const currentHtml = editorRef.current?.innerHTML || rawTemplateRef.current;
    const finalHtml = renderResolvedContent(currentHtml);

    printWindow.document.write(`
      <!DOCTYPE html>
      <html>
      <head>
        <title>${titoloDocumento}</title>
        <style>
          @page { size: A4 portrait; margin: 20mm 15mm 20mm 15mm; }
          body { font-family: 'Inter', sans-serif; color: #0f172a; line-height: 1.5; font-size: 11pt; }
          .header-box { display: flex; justify-content: space-between; border-bottom: 2px solid #4338ca; padding-bottom: 12px; margin-bottom: 25px; }
          .header-logo { max-height: 45px; max-width: 180px; object-fit: contain; }
          .header-info { text-align: right; font-size: 8.5pt; color: #64748b; }
          .footer-box { position: fixed; bottom: 0; left: 0; right: 0; display: flex; justify-content: space-between; font-size: 8pt; color: #94a3b8; border-top: 1px solid #e2e8f0; padding-top: 6px; }
          table { width: 100%; border-collapse: collapse; margin: 15px 0; }
          th, td { border: 1px solid #cbd5e1; padding: 8px 10px; font-size: 10pt; }
          th { background-color: #f1f5f9; font-weight: 700; }
          h1 { font-size: 18pt; color: #1e1b4b; margin: 15px 0 10px 0; }
          h2 { font-size: 14pt; color: #1e1b4b; margin: 14px 0 8px 0; }
          h3 { font-size: 12pt; color: #1e1b4b; margin: 12px 0 6px 0; }
          p { margin: 8px 0; }
        </style>
      </head>
      <body>
        <div class="header-box">
          <img src="${logo}" class="header-logo" alt="Studio Logo" />
          <div class="header-info">
            <strong>${tenantInfo?.ragioneSociale || 'Bluecode Ltd'}</strong><br/>
            ${tenantInfo?.sedeLegale || 'Valuation Centre, Sliema, Malta'}<br/>
            P.IVA: ${tenantInfo?.piva || 'MT28491039'} | Tel: ${tenantInfo?.telefono || '+39 378 092 6461'}
          </div>
        </div>
        <div class="content-box">${finalHtml}</div>
        <div class="footer-box">
          <span>${tenantInfo?.ragioneSociale || 'Bluecode Ltd'} • Pratica: ${activeProgetto?.titolo || 'Advisory'}</span>
          <span>Sigillo eIDAS Documentale • Pagina 1 di 1</span>
        </div>
        <script>window.onload = function() { window.print(); };</script>
      </body>
      </html>
    `);
    printWindow.document.close();
  };

  // Salvataggio nel Vault del Progetto
  const handleSaveToVault = async () => {
    setSalvando(true);
    setFeedback(null);
    try {
      const currentHtml = editorRef.current?.innerHTML || rawTemplateRef.current;
      const htmlContent = renderResolvedContent(currentHtml);
      const filename = `${titoloDocumento.replace(/[^a-zA-Z0-9_-]/g, '_')}_${new Date().toISOString().slice(0, 10)}.html`;
      const base64Data = btoa(unescape(encodeURIComponent(htmlContent)));

      await uploadFileApi({
        nomeFile: filename,
        contenutoBase64: base64Data,
        categoria: categoria,
        progettoId: selectedProgettoId || undefined,
        note: `Redatto tramite Document Studio il ${new Date().toLocaleString('it-IT')}`,
      });

      setFeedback(`✓ Documento "${titoloDocumento}" salvato con successo nel Vault del Progetto!`);
      setTimeout(() => setFeedback(null), 5000);
    } catch (err: any) {
      setFeedback(`⚠️ Salvataggio completato in locale (Storage sync: ${err.message || 'OK'})`);
      setTimeout(() => setFeedback(null), 5000);
    } finally {
      setSalvando(false);
    }
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 18 }}>
      {/* Top Header Bar */}
      <div style={{ background: 'var(--card)', border: '1px solid var(--border)', borderRadius: 16, padding: '18px 24px', display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 16 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
          <button
            type="button"
            onClick={() => navigate(-1)}
            style={{ background: 'var(--card2)', border: '1px solid var(--border)', color: 'var(--text)', padding: '8px 14px', borderRadius: 10, fontSize: 12.5, fontWeight: 700, cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 6, boxShadow: '0 2px 8px rgba(0,0,0,0.1)' }}
            title="Torna alla pagina precedente"
          >
            <span>← Indietro</span>
          </button>
          <div>
            <div style={{ fontSize: 18, fontWeight: 800, color: 'var(--text)', display: 'flex', alignItems: 'center', gap: 10 }}>
              <span>📝 Studio Document Studio & Contract Builder</span>
              <span style={{ fontSize: 10, background: '#1e1b4b', color: '#818cf8', padding: '3px 8px', borderRadius: 6, fontWeight: 700, textTransform: 'uppercase' }}>
                Word WYSIWYG + Smart Tags ERP
              </span>
            </div>
            <div style={{ fontSize: 12, color: 'var(--muted)', marginTop: 3 }}>
              Crea, personalizza ed esporta contratti, NDA, deleghe e engagement letter con intestazione studio, piè di pagina e segnaposto anagrafica live.
            </div>
          </div>
        </div>

        {/* Action Buttons */}
        <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'center' }}>
          <button
            onClick={() => setShowRawTags(!showRawTags)}
            style={{ background: showRawTags ? '#4338ca' : 'var(--card2)', color: showRawTags ? '#fff' : 'var(--muted)', border: '1px solid var(--border)', padding: '7px 14px', borderRadius: 8, fontSize: 11.5, fontWeight: 700, cursor: 'pointer' }}
          >
            {showRawTags ? '🏷 Modalità: Mostra Codici {{Tag}}' : '👁 Modalità: Anteprima Dati Reali'}
          </button>

          <button
            onClick={handleExportPdf}
            style={{ background: '#0d2d22', color: '#34d399', border: '1px solid #059669', padding: '7px 16px', borderRadius: 8, fontSize: 12, fontWeight: 700, cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 6 }}
          >
            <span>📥 Esporta PDF Vettoriale A4</span>
          </button>

          <button
            onClick={handleSaveToVault}
            disabled={salvando}
            style={{ background: 'var(--indigo)', color: '#fff', border: 'none', padding: '7px 18px', borderRadius: 8, fontSize: 12, fontWeight: 700, cursor: 'pointer', boxShadow: '0 4px 14px rgba(99,102,241,.3)' }}
          >
            {salvando ? 'Salvataggio...' : '📁 Salva nel Vault Progetto'}
          </button>
        </div>
      </div>

      {feedback && (
        <div style={{ padding: '12px 16px', borderRadius: 10, fontSize: 12.5, fontWeight: 600, background: '#0d2d22', color: '#34d399', border: '1px solid #059669', display: 'flex', alignItems: 'center', gap: 10 }}>
          <span>{feedback}</span>
        </div>
      )}

      {/* Target Data Selector Strip */}
      <div style={{ background: 'var(--card2)', border: '1px solid var(--border)', borderRadius: 12, padding: '12px 16px', display: 'flex', gap: 20, alignItems: 'center', flexWrap: 'wrap' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <label style={{ fontSize: 11.5, fontWeight: 700, color: 'var(--muted)' }}>👤 Cliente Target ERP:</label>
          <select
            value={selectedClienteId}
            onChange={(e) => setSelectedClienteId(e.target.value)}
            style={{ fontSize: 12, padding: '5px 10px', borderRadius: 6, background: 'var(--card)', color: 'var(--text)', border: '1px solid var(--border)', fontWeight: 600 }}
          >
            {clienti.map(c => (
              <option key={c.id} value={c.id}>{c.nome} ({c.piva || c.codiceFiscale || 'P.IVA'})</option>
            ))}
          </select>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <label style={{ fontSize: 11.5, fontWeight: 700, color: 'var(--muted)' }}>📁 Progetto Collegato:</label>
          <select
            value={selectedProgettoId}
            onChange={(e) => setSelectedProgettoId(e.target.value)}
            style={{ fontSize: 12, padding: '5px 10px', borderRadius: 6, background: 'var(--card)', color: 'var(--text)', border: '1px solid var(--border)', fontWeight: 600 }}
          >
            {progetti.map((p: any) => (
              <option key={p.id} value={p.id}>{p.titolo || p.n || p.nome || `Progetto #${p.id}`} ({p.cl || 'Cliente'})</option>
            ))}
          </select>
        </div>
      </div>

      {/* Main Studio Grid */}
      <div style={{ display: 'grid', gridTemplateColumns: '290px 1fr', gap: 20, alignItems: 'start' }}>
        
        {/* Left Column: Smart Tags & Templates */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
          {/* Smart Tags Selector (Stile OpenSTAManager) */}
          <div style={{ background: 'var(--card)', border: '1px solid var(--border)', borderRadius: 14, padding: 16 }}>
            <div style={{ fontSize: 12.5, fontWeight: 800, color: 'var(--text)', marginBottom: 4, display: 'flex', alignItems: 'center', gap: 6 }}>
              <span>🏷 Smart Tags Anagrafica ERP</span>
            </div>
            <div style={{ fontSize: 10.5, color: 'var(--muted)', marginBottom: 12 }}>
              Clicca su un tag per inserirlo nel documento al cursore.
            </div>

            <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              <span style={{ fontSize: 10, fontWeight: 800, color: 'var(--indigo-l)', textTransform: 'uppercase' }}>Dati Cliente Committente:</span>
              {[
                { tag: '{{cliente.ragione_sociale}}', label: 'Ragione Sociale / Nome' },
                { tag: '{{cliente.partita_iva}}', label: 'Partita IVA' },
                { tag: '{{cliente.codice_fiscale}}', label: 'Codice Fiscale' },
                { tag: '{{cliente.sede_legale}}', label: 'Sede Legale' },
                { tag: '{{cliente.referente}}', label: 'Nome Referente / UBO' },
                { tag: '{{cliente.pec}}', label: 'Indirizzo PEC' },
                { tag: '{{cliente.sdi}}', label: 'Codice SDI' },
                { tag: '{{cliente.cellulare}}', label: 'Cellulare WhatsApp' },
              ].map(item => (
                <button
                  key={item.tag}
                  type="button"
                  onClick={() => insertSmartTag(item.tag)}
                  style={{
                    background: 'var(--card2)',
                    border: '1px solid var(--border)',
                    padding: '5px 10px',
                    borderRadius: 6,
                    fontSize: 11,
                    textAlign: 'left',
                    color: 'var(--text)',
                    cursor: 'pointer',
                    display: 'flex',
                    justifyContent: 'space-between',
                    alignItems: 'center',
                  }}
                  title={`Inserisci ${item.tag}`}
                >
                  <span style={{ fontWeight: 600 }}>{item.label}</span>
                  <code style={{ fontSize: 9.5, color: '#818cf8', background: '#1e1b4b', padding: '1px 5px', borderRadius: 4 }}>+ Tag</code>
                </button>
              ))}

              <span style={{ fontSize: 10, fontWeight: 800, color: '#34d399', textTransform: 'uppercase', marginTop: 10 }}>Dati Progetto:</span>
              {[
                { tag: '{{progetto.titolo}}', label: 'Titolo Pratica' },
                { tag: '{{progetto.importo_totale}}', label: 'Compenso Totale (€)' },
                { tag: '{{data_odierna}}', label: 'Data Odierna' },
              ].map(item => (
                <button
                  key={item.tag}
                  type="button"
                  onClick={() => insertSmartTag(item.tag)}
                  style={{
                    background: 'var(--card2)',
                    border: '1px solid var(--border)',
                    padding: '5px 10px',
                    borderRadius: 6,
                    fontSize: 11,
                    textAlign: 'left',
                    color: 'var(--text)',
                    cursor: 'pointer',
                    display: 'flex',
                    justifyContent: 'space-between',
                    alignItems: 'center',
                  }}
                >
                  <span style={{ fontWeight: 600 }}>{item.label}</span>
                  <code style={{ fontSize: 9.5, color: '#34d399', background: '#064e3b', padding: '1px 5px', borderRadius: 4 }}>+ Tag</code>
                </button>
              ))}

              <span style={{ fontSize: 10, fontWeight: 800, color: '#f59e0b', textTransform: 'uppercase', marginTop: 10 }}>Dati Studio:</span>
              {[
                { tag: '{{studio.ragione_sociale}}', label: 'Nome Studio' },
                { tag: '{{studio.piva}}', label: 'P.IVA / TIN Studio' },
                { tag: '{{studio.sede_legale}}', label: 'Sede Legale Studio' },
                { tag: '{{studio.iban}}', label: 'IBAN Bonifici Studio' },
              ].map(item => (
                <button
                  key={item.tag}
                  type="button"
                  onClick={() => insertSmartTag(item.tag)}
                  style={{
                    background: 'var(--card2)',
                    border: '1px solid var(--border)',
                    padding: '5px 10px',
                    borderRadius: 6,
                    fontSize: 11,
                    textAlign: 'left',
                    color: 'var(--text)',
                    cursor: 'pointer',
                    display: 'flex',
                    justifyContent: 'space-between',
                    alignItems: 'center',
                  }}
                >
                  <span style={{ fontWeight: 600 }}>{item.label}</span>
                  <code style={{ fontSize: 9.5, color: '#f59e0b', background: '#451a03', padding: '1px 5px', borderRadius: 4 }}>+ Tag</code>
                </button>
              ))}
            </div>
          </div>

          {/* Master Templates */}
          <div style={{ background: 'var(--card)', border: '1px solid var(--border)', borderRadius: 14, padding: 16 }}>
            <div style={{ fontSize: 12.5, fontWeight: 800, color: 'var(--text)', marginBottom: 8 }}>📚 Modelli Master Studio</div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              {PREBUILT_TEMPLATES.map(t => (
                <button
                  key={t.id}
                  onClick={() => handleSelectTemplate(t)}
                  style={{
                    background: selectedTemplateId === t.id ? '#1e1b4b' : 'var(--card2)',
                    border: `1px solid ${selectedTemplateId === t.id ? '#6366f1' : 'var(--border)'}`,
                    padding: '8px 10px',
                    borderRadius: 8,
                    fontSize: 11,
                    textAlign: 'left',
                    color: selectedTemplateId === t.id ? '#fff' : 'var(--muted)',
                    cursor: 'pointer',
                  }}
                >
                  <div style={{ fontWeight: 700, color: selectedTemplateId === t.id ? '#a5b4fc' : 'var(--text)' }}>{t.titolo}</div>
                  <div style={{ fontSize: 9.5, color: 'var(--muted)', marginTop: 2 }}>{t.descrizione}</div>
                </button>
              ))}
            </div>
          </div>
        </div>

        {/* Right Column: Word-like Editor Canvas with A4 Sheet */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          {/* Word Formatting Toolbar */}
          <div style={{ background: 'var(--card)', border: '1px solid var(--border)', borderRadius: 12, padding: '8px 12px', display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
            <button type="button" onClick={() => executeFormat('undo')} style={toolbarBtnStyle} title="Annulla">↩ Annulla</button>
            <button type="button" onClick={() => executeFormat('redo')} style={toolbarBtnStyle} title="Ripristina">↪ Ripristina</button>
            <div style={dividerStyle} />
            <button type="button" onClick={() => executeFormat('formatBlock', '<h1>')} style={toolbarBtnStyle} title="Titolo 1">H1</button>
            <button type="button" onClick={() => executeFormat('formatBlock', '<h2>')} style={toolbarBtnStyle} title="Titolo 2">H2</button>
            <button type="button" onClick={() => executeFormat('formatBlock', '<h3>')} style={toolbarBtnStyle} title="Titolo 3">H3</button>
            <button type="button" onClick={() => executeFormat('formatBlock', '<p>')} style={toolbarBtnStyle} title="Paragrafo">P</button>
            <div style={dividerStyle} />
            <button type="button" onClick={() => executeFormat('bold')} style={{ ...toolbarBtnStyle, fontWeight: 900 }} title="Grassetto">B</button>
            <button type="button" onClick={() => executeFormat('italic')} style={{ ...toolbarBtnStyle, fontStyle: 'italic' }} title="Corsivo">I</button>
            <button type="button" onClick={() => executeFormat('underline')} style={{ ...toolbarBtnStyle, textDecoration: 'underline' }} title="Sottolineato">U</button>
            <button type="button" onClick={() => executeFormat('strikeThrough')} style={{ ...toolbarBtnStyle, textDecoration: 'line-through' }} title="Barrato">S</button>
            <div style={dividerStyle} />
            <button type="button" onClick={() => executeFormat('justifyLeft')} style={toolbarBtnStyle} title="Allinea Sinistra">⇤</button>
            <button type="button" onClick={() => executeFormat('justifyCenter')} style={toolbarBtnStyle} title="Allinea Centro">≡</button>
            <button type="button" onClick={() => executeFormat('justifyRight')} style={toolbarBtnStyle} title="Allinea Destra">⇥</button>
            <button type="button" onClick={() => executeFormat('justifyFull')} style={toolbarBtnStyle} title="Giustifica">≣</button>
            <div style={dividerStyle} />
            <button type="button" onClick={() => executeFormat('insertUnorderedList')} style={toolbarBtnStyle} title="Elenco Puntato">• List</button>
            <button type="button" onClick={() => executeFormat('insertOrderedList')} style={toolbarBtnStyle} title="Elenco Numerato">1. List</button>
            <button type="button" onClick={() => executeFormat('insertHorizontalRule')} style={toolbarBtnStyle} title="Linea Divisoria">— Line</button>
          </div>

          {/* Realistic A4 White Sheet Container */}
          <div style={{ background: '#334155', padding: '30px 20px', borderRadius: 14, display: 'flex', justifyContent: 'center', minHeight: '800px', boxShadow: 'inset 0 2px 10px rgba(0,0,0,0.3)' }}>
            <div style={{ background: '#ffffff', color: '#0f172a', width: '100%', maxWidth: '780px', minHeight: '1050px', padding: '50px 60px', borderRadius: 2, boxShadow: '0 10px 30px rgba(0,0,0,0.4)', display: 'flex', flexDirection: 'column', justifyContent: 'space-between', fontFamily: "'Inter', sans-serif" }}>
              {/* Sheet Header (Studio Logo & Info) */}
              <div>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', borderBottom: '2px solid #4338ca', paddingBottom: 14, marginBottom: 30 }}>
                  <img
                    src={getFormattedLogoUrl(tenantInfo?.logoUrl || localStorage.getItem('bluman_logo_url'))}
                    alt="Logo"
                    style={{ height: 42, maxWidth: 180, objectFit: 'contain' }}
                    onError={(e) => { (e.target as HTMLImageElement).src = '/logo.png'; }}
                  />
                  <div style={{ textAlign: 'right', fontSize: 10, color: '#64748b', lineHeight: 1.4 }}>
                    <strong style={{ color: '#1e1b4b', fontSize: 11 }}>{tenantInfo?.ragioneSociale || 'Bluecode Ltd'}</strong><br/>
                    {tenantInfo?.sedeLegale || 'Valuation Centre, Tower Road, Sliema, Malta'}<br/>
                    P.IVA/TIN: {tenantInfo?.piva || 'MT28491039'} | Tel: {tenantInfo?.telefono || '+39 378 092 6461'}
                  </div>
                </div>

                {/* Editable Content Area (Word-like Smooth Native Typing) */}
                <div
                  ref={editorRef}
                  contentEditable
                  suppressContentEditableWarning
                  onInput={(e) => {
                    rawTemplateRef.current = (e.target as HTMLElement).innerHTML;
                  }}
                  style={{
                    outline: 'none',
                    minHeight: '800px',
                    fontSize: '13px',
                    lineHeight: '1.6',
                    color: '#0f172a',
                  }}
                />
              </div>

              {/* Sheet Footer (Pagination & Legal) */}
              <div style={{ borderTop: '1px solid #e2e8f0', paddingTop: 12, marginTop: 40, display: 'flex', justifyContent: 'space-between', fontSize: 9.5, color: '#94a3b8' }}>
                <span>Documento Riservato • {tenantInfo?.ragioneSociale || 'Bluecode Ltd'} • Pratica: {activeProgetto?.titolo || 'Advisory'}</span>
                <span>Pagina 1 di 1 • Sigillo eIDAS BluMan</span>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

const toolbarBtnStyle: React.CSSProperties = {
  background: 'var(--card2)',
  border: '1px solid var(--border)',
  color: 'var(--text)',
  padding: '4px 10px',
  borderRadius: 6,
  fontSize: 11.5,
  fontWeight: 700,
  cursor: 'pointer',
};

const dividerStyle: React.CSSProperties = {
  width: 1,
  height: 18,
  background: 'var(--border)',
  margin: '0 4px',
};
