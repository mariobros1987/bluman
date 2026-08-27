import React, { useState, useEffect, useRef } from 'react';
import { useSearchParams, useNavigate } from 'react-router-dom';
import { fetchClienti, fetchProgetti, fetchProgettoDettaglio, fetchTenantInfoApi, salvaDocumentoApi, creaDocumentoTemplateApi, eliminaDocumentoTemplateApi } from '../api/client';
import { getFormattedLogoUrl } from '../utils';
import { downloadRealPdf, downloadRealWordDoc } from '../utils/pdfGenerator';
import { getCurrentTenantId, getTenantStorageKey, getStudioInfoForTenant } from '../utils/tenant';
import type { Cliente, Progetto } from '../types';

import {
  PREBUILT_TEMPLATES,
  getAllTemplates,
  saveCustomTemplate,
  deleteTemplate,
  archiveTemplate,
  restoreTemplate,
  importTemplatesFromJson,
  exportTemplatesAsJson,
  type DocumentTemplate,
} from '../utils/documentTemplates';
export type { DocumentTemplate };
export { PREBUILT_TEMPLATES };

export function DocumentEditorPage() {
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();

  const queryProjId = searchParams.get('projId') || '';
  const queryDocId = searchParams.get('docId') || '';
  const queryTmplId = searchParams.get('tmplId') || 'tmpl-engagement';

  const [templatesList, setTemplatesList] = useState<DocumentTemplate[]>(() => getAllTemplates(true));
  const [searchMasterTmplQuery, setSearchMasterTmplQuery] = useState('');
  const [tmplStatusSidebar, setTmplStatusSidebar] = useState<'attivi' | 'archiviati' | 'tutti'>('attivi');

  const [showNewTmplModal, setShowNewTmplModal] = useState(false);
  const [newTmplTitolo, setNewTmplTitolo] = useState('');
  const [newTmplCat, setNewTmplCat] = useState<'societario' | 'contratto' | 'nda' | 'engagement' | 'delega' | 'fiscale' | 'trust' | 'compliance'>('societario');
  const [newTmplDesc, setNewTmplDesc] = useState('');

  const [clienti, setClienti] = useState<Cliente[]>([]);
  const [progetti, setProgetti] = useState<Progetto[]>([]);
  const [tenantInfo, setTenantInfo] = useState<any>(null);

  const [selectedClienteId, setSelectedClienteId] = useState<string>('');
  const [selectedProgettoId, setSelectedProgettoId] = useState<string>(queryProjId);
  const [selectedTemplateId, setSelectedTemplateId] = useState<string>(queryTmplId);

  /**
   * §WF-DOC / §2.9 — micro-voce di destinazione del documento.
   *
   * Qui prima non esisteva alcun riferimento alla micro-voce: il documento nasceva
   * agganciato solo al progetto. Nel portale il cliente lo vedeva quindi comparire
   * senza modulo e senza micro-voce, mentre quelli caricati dalla scheda passaggio
   * (PassaggioModal) portavano il collegamento: due strade per lo stesso gesto, due
   * risultati diversi. Da qui nasceva la discrepanza fra app e portale.
   *
   * Resta ammesso il documento di solo fascicolo (stringa vuota): §2.9 dice che i file
   * dello studio non appartengono per forza a una micro-voce. Ma ora è una scelta
   * dichiarata dall'operatore, non un effetto collaterale della pagina usata.
   */
  const [microvoci, setMicrovoci] = useState<{ id: string; nome: string; modulo: string }[]>([]);
  const [selectedMicrovoceId, setSelectedMicrovoceId] = useState<string>(searchParams.get('microvoceId') || '');
  const [caricandoMicrovoci, setCaricandoMicrovoci] = useState(false);

  const initialTmpl = templatesList.find(t => t.id === queryTmplId) || templatesList[0] || PREBUILT_TEMPLATES[0];
  const [titoloDocumento, setTitoloDocumento] = useState(initialTmpl.titolo);
  const [categoria, setCategoria] = useState<string>(initialTmpl.categoria);
  const [tagDisplayMode, setTagDisplayMode] = useState<'highlight' | 'plain' | 'raw'>('highlight');

  const [salvando, setSalvando] = useState(false);
  const [feedback, setFeedback] = useState<string | null>(null);

  const editorRef = useRef<HTMLDivElement>(null);
  const fileImportRef = useRef<HTMLInputElement>(null);
  const rawTemplateRef = useRef<string>(initialTmpl.contenutoHtml);

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
        const currentTenantId = getCurrentTenantId();
        if (cls && Array.isArray(cls)) {
          apiCls = cls.filter((c: any) => !c.tenantId || c.tenantId === currentTenantId);
        }
        if (prjs && Array.isArray(prjs)) {
          apiPrjs = prjs.filter((p: any) => !p.tenantId || p.tenantId === currentTenantId);
        }
        if (tntRes) tnt = tntRes;
      } catch (err) {
        console.warn('Caricamento remoto parziale:', err);
      }

      const currentTenantId = getCurrentTenantId();

      // 1. Clienti: Unione DB + LocalStorage + Extracted from Projects
      const customClStr = localStorage.getItem(getTenantStorageKey('bluman_custom_clients'));
      const customCls: Cliente[] = customClStr ? JSON.parse(customClStr) : [];

      const localProjStr = localStorage.getItem(getTenantStorageKey('bluman_custom_projects'));
      const localProjs: any[] = localProjStr ? JSON.parse(localProjStr) : [];

      const extractedClients: Cliente[] = [];
      const projectsForExtraction = localProjs;
      projectsForExtraction.forEach((p: any) => {
        if (p.cl) {
          extractedClients.push({
            id: `cl-proj-${p.id}`,
            nome: p.cl,
            tipo: p.ct || 'company',
            piva: p.piva || '',
            codiceFiscale: p.codFisc || '',
            sedeLegale: p.sede || '',
            codiceSdi: '',
            email: '',
            telefono: '',
            referenteNome: p.cl,
          });
        }
      });

      const clientMap = new Map<string, Cliente>();
      // Ordine di precedenza: extracted -> custom -> API DB reale
      [...extractedClients, ...customCls, ...apiCls].forEach(c => {
        if (c && c.nome) {
          clientMap.set(c.nome.trim().toLowerCase(), c);
        }
      });
      const allClients = Array.from(clientMap.values());
      setClienti(allClients);
      if (allClients.length > 0) {
        setSelectedClienteId(allClients[0].id);
      } else {
        setSelectedClienteId('');
      }

      // 2. Progetti: Unione DB + LocalStorage
      const allRawProjects = [...apiPrjs, ...localProjs];
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
      if (queryProjId && projMap.has(queryProjId)) {
        setSelectedProgettoId(queryProjId);
      } else if (allNormalizedProjects.length > 0) {
        setSelectedProgettoId(allNormalizedProjects[0].id);
      } else {
        setSelectedProgettoId('');
      }

      // Se specificato docId, carica il documento salvato nel Vault
      if (queryDocId) {
        const allDocsStr = localStorage.getItem(getTenantStorageKey('bluman_all_vault_documents'));
        const projDocsStr = queryProjId ? localStorage.getItem(getTenantStorageKey(`bluman_project_documents_${queryProjId}`)) : null;
        const allDocs: any[] = allDocsStr ? JSON.parse(allDocsStr) : [];
        const projDocs: any[] = projDocsStr ? JSON.parse(projDocsStr) : [];
        const foundDoc = [...projDocs, ...allDocs].find((d: any) => d.id === queryDocId);
        if (foundDoc) {
          if (foundDoc.titolo) setTitoloDocumento(foundDoc.titolo);
          if (foundDoc.categoria) setCategoria(foundDoc.categoria);
          if (foundDoc.contenutoHtml) {
            rawTemplateRef.current = foundDoc.contenutoHtml;
            if (editorRef.current) {
              editorRef.current.innerHTML = foundDoc.contenutoHtml;
            }
          }
        }
      }

      if (tnt) {
        setTenantInfo(tnt);
      } else {
        const local = localStorage.getItem(getTenantStorageKey('bluman_tenant_info'));
        if (local) {
          setTenantInfo(JSON.parse(local));
        } else {
          // Fallback: popola tenantInfo dai dati di registrazione del tenant (SuperAdmin o TENANT_STUDIOS)
          // Così il Document Studio ha SEMPRE un'identità corretta (nome, sede, piva) anche senza configurazione manuale
          const studioFallback = getStudioInfoForTenant(currentTenantId);
          setTenantInfo({
            ragioneSociale: studioFallback.ragioneSociale || '',
            piva: studioFallback.piva || '',
            sedeLegale: studioFallback.sedeLegale || '',
            sedeOperativa: studioFallback.sedeOperativa || '',
            telefono: studioFallback.telefono || '',
            email: studioFallback.email || '',
            iban: studioFallback.iban || '',
            codiceSdi: studioFallback.codiceSdi || '',
            logoUrl: '',
          });
        }
      }
    };
    loadInitialData();
  }, [queryDocId, queryProjId]);

  const activeCliente = clienti.find(c => c.id === selectedClienteId) || (clienti.length > 0 ? clienti[0] : null);
  const activeProgetto: any = progetti.find((p: any) => String(p.id) === String(selectedProgettoId)) || (progetti.length > 0 ? progetti[0] : null);

  /**
   * Progetto realmente in uso. Vale '' se in questo studio non c'è nessun progetto:
   * in quel caso non si salva niente sul server, invece di inventare un id (§7).
   */
  const effProgettoId = String(selectedProgettoId || activeProgetto?.id || '');

  // §WF-DOC — micro-voci del progetto scelto, lette dal database (GET /progetti/:id
  // restituisce moduli → microvoci con gli id veri). Nessun elenco cablato: se il
  // progetto non ha micro-voci istanziate, la tendina lo dice e resta vuota.
  useEffect(() => {
    let vivo = true;
    if (!effProgettoId) {
      setMicrovoci([]);
      setSelectedMicrovoceId('');
      return;
    }
    (async () => {
      setCaricandoMicrovoci(true);
      try {
        const dettaglio: any = await fetchProgettoDettaglio(effProgettoId);
        if (!vivo) return;
        const elenco: { id: string; nome: string; modulo: string }[] = [];
        for (const modulo of (dettaglio?.moduli ?? [])) {
          for (const mv of (modulo?.microvoci ?? [])) {
            elenco.push({ id: String(mv.id), nome: mv.nome ?? 'Micro-voce senza nome', modulo: modulo.nome ?? 'Modulo' });
          }
        }
        setMicrovoci(elenco);
        // Se la micro-voce selezionata non appartiene a questo progetto, la si azzera:
        // agganciare un documento alla micro-voce di un altro progetto romperebbe il filo.
        setSelectedMicrovoceId(prec => (prec && elenco.some(m => m.id === prec) ? prec : ''));
      } catch (err) {
        if (!vivo) return;
        console.warn('Lettura micro-voci del progetto non riuscita:', err);
        setMicrovoci([]);
        setSelectedMicrovoceId('');
      } finally {
        if (vivo) setCaricandoMicrovoci(false);
      }
    })();
    return () => { vivo = false; };
  }, [effProgettoId]);

  // Sostituzione dinamica delle variabili Smart Tags (Mail Merge) con Smart Chips interattivi
  const renderResolvedContent = (htmlContent: string, isForPrintOrExport: boolean = false) => {
    if (tagDisplayMode === 'raw' && !isForPrintOrExport) return htmlContent;

    const currentTenantId = getCurrentTenantId();
    const studioInfo = getStudioInfoForTenant(currentTenantId);

    const refJson: any = activeCliente?.referentiJson && typeof activeCliente.referentiJson === 'object' ? activeCliente.referentiJson : {};
    const dataOggi = new Date().toLocaleDateString('it-IT', { day: '2-digit', month: 'long', year: 'numeric' });

    const projTitolo = activeProgetto?.titolo || activeProgetto?.n || activeProgetto?.nome || 'Incarico Professionale';
    const projImporto = activeProgetto?.totalePreventivo || activeProgetto?.val || 0;

    // Dati dinamici Studio del Tenant attivo (totalmente dinamici dallo studio, nessun valore fisso)
    const studioRagioneSociale = tenantInfo?.ragioneSociale || studioInfo.ragioneSociale || 'Studio Professionale';
    const studioPiva = tenantInfo?.piva || studioInfo.piva || '';
    const studioSede = tenantInfo?.sedeLegale || studioInfo.sedeLegale || '';
    const studioIban = tenantInfo?.iban || studioInfo.iban || '';
    const studioLeadAdvisor = studioInfo.leadAdvisor || 'Lead Senior Advisor';
    const studioTel = tenantInfo?.telefono || studioInfo.telefono || '';
    const studioEmail = tenantInfo?.email || studioInfo.email || '';

    // Dati Cliente (se non selezionato, fallback su Smart Tags o etichette neutre)
    const clientNome = activeCliente?.nome || activeProgetto?.cl || 'Cliente Committente';
    const clientPiva = activeCliente?.piva || activeCliente?.codiceFiscale || '';
    const clientCodFisc = activeCliente?.codiceFiscale || activeCliente?.piva || '';
    const clientSede = activeCliente?.sedeLegale || '';
    const clientPec = activeCliente?.pec || '';
    const clientSdi = activeCliente?.codiceSdi || '';
    const clientIban = activeCliente?.iban || '';
    const clientRef = activeCliente?.referenteNome || refJson.referente || 'Legale Rappresentante';
    const clientCell = activeCliente?.cellulare || '';
    const clientUbo = activeCliente?.ubo || activeCliente?.referenteNome || 'Titolare Effettivo (UBO)';

    // Se in anteprima bozza e modalità 'highlight', evidenzia il dato reale con un elegante Smart Chip ERP
    const wrapTag = (value: string, tagCode: string) => {
      if (isForPrintOrExport || tagDisplayMode === 'plain') return value || `[${tagCode}]`;
      return `<span class="bluman-smart-chip" title="Smart Tag ERP: {{${tagCode}}}" style="background: rgba(99, 102, 241, 0.14); color: #4338ca; border: 1px solid rgba(99, 102, 241, 0.35); border-bottom: 2px solid #4f46e5; border-radius: 4px; padding: 1px 6px; font-weight: 600; cursor: help; display: inline-block; box-shadow: 0 1px 3px rgba(99,102,241,0.12);">🏷️ ${value || `[${tagCode}]`}</span>`;
    };

    let out = htmlContent;
    out = out.replace(/\{\{data_odierna\}\}/g, wrapTag(dataOggi, 'data_odierna'));
    out = out.replace(/\{\{cliente\.ragione_sociale\}\}/g, wrapTag(clientNome, 'cliente.ragione_sociale'));
    out = out.replace(/\{\{cliente\.nome\}\}/g, wrapTag(clientNome, 'cliente.nome'));
    out = out.replace(/\{\{cliente\.partita_iva\}\}/g, wrapTag(clientPiva, 'cliente.partita_iva'));
    out = out.replace(/\{\{cliente\.codice_fiscale\}\}/g, wrapTag(clientCodFisc, 'cliente.codice_fiscale'));
    out = out.replace(/\{\{cliente\.sede_legale\}\}/g, wrapTag(clientSede, 'cliente.sede_legale'));
    out = out.replace(/\{\{cliente\.pec\}\}/g, wrapTag(clientPec, 'cliente.pec'));
    out = out.replace(/\{\{cliente\.sdi\}\}/g, wrapTag(clientSdi, 'cliente.sdi'));
    out = out.replace(/\{\{cliente\.iban\}\}/g, wrapTag(clientIban, 'cliente.iban'));
    out = out.replace(/\{\{cliente\.referente\}\}/g, wrapTag(clientRef, 'cliente.referente'));
    out = out.replace(/\{\{cliente\.cellulare\}\}/g, wrapTag(clientCell, 'cliente.cellulare'));
    out = out.replace(/\{\{cliente\.ubo\}\}/g, wrapTag(clientUbo, 'cliente.ubo'));

    out = out.replace(/\{\{progetto\.titolo\}\}/g, wrapTag(projTitolo, 'progetto.titolo'));
    out = out.replace(/\{\{progetto\.importo_totale\}\}/g, wrapTag(projImporto ? `€ ${Number(projImporto).toLocaleString('it-IT')},00` : '€ 0,00', 'progetto.importo_totale'));

    out = out.replace(/\{\{studio\.ragione_sociale\}\}/g, wrapTag(studioRagioneSociale, 'studio.ragione_sociale'));
    out = out.replace(/\{\{studio\.piva\}\}/g, wrapTag(studioPiva, 'studio.piva'));
    out = out.replace(/\{\{studio\.sede_legale\}\}/g, wrapTag(studioSede, 'studio.sede_legale'));
    out = out.replace(/\{\{studio\.iban\}\}/g, wrapTag(studioIban, 'studio.iban'));
    out = out.replace(/\{\{studio\.lead_advisor\}\}/g, wrapTag(studioLeadAdvisor, 'studio.lead_advisor'));
    out = out.replace(/\{\{studio\.telefono\}\}/g, wrapTag(studioTel, 'studio.telefono'));
    out = out.replace(/\{\{studio\.email\}\}/g, wrapTag(studioEmail, 'studio.email'));

    return out;
  };

  // Sincronizzazione automatica dell'editor con i dati reali del tenant/cliente/progetto attivo
  useEffect(() => {
    if (editorRef.current && !queryDocId) {
      editorRef.current.innerHTML = renderResolvedContent(rawTemplateRef.current);
    }
  }, [tenantInfo, selectedClienteId, selectedProgettoId, tagDisplayMode, selectedTemplateId]);

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

  // Creazione Nuovo Modello Master da Zero
  const handleCreateCustomMaster = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newTmplTitolo.trim()) return;

    const newTmpl: DocumentTemplate = {
      id: `tmpl-custom-${Date.now()}`,
      titolo: newTmplTitolo.trim(),
      categoria: newTmplCat,
      descrizione: newTmplDesc.trim() || 'Modello master personalizzato salvato nello studio.',
      contenutoHtml: `
<h1 style="text-align: center; color: #1e1b4b; margin-bottom: 20px; font-size: 19px; text-transform: uppercase;">
  ${newTmplTitolo.toUpperCase()}
</h1>

<p style="text-align: right; color: #64748b; font-size: 11px; margin-bottom: 20px;">
  <strong>Data:</strong> {{data_odierna}} | <strong>Rif. Pratica:</strong> {{progetto.titolo}}
</p>

<div style="background: #f8fafc; border-left: 4px solid #4338ca; padding: 12px 16px; margin-bottom: 20px; font-size: 11.5px;">
  <strong>Studio Professionale:</strong> {{studio.ragione_sociale}} ({{studio.sede_legale}})<br/>
  <strong>Cliente Committente:</strong> {{cliente.ragione_sociale}} (P.IVA {{cliente.partita_iva}}, Rappresentante: {{cliente.referente}})
</div>

<h3 style="color: #1e1b4b; font-size: 13px;">1. OGGETTO E CONDIZIONI GENERALI</h3>
<p style="font-size: 11.5px; line-height: 1.6; text-align: justify;">
  Inserisci qui il testo normativo del contratto, statuto o accordo dello studio.
</p>

<div style="margin-top: 40px; display: flex; justify-content: space-between;">
  <div style="width: 45%; text-align: center; border-top: 1px solid #cbd5e1; padding-top: 8px; font-size: 11px;">
    {{studio.ragione_sociale}}
  </div>
  <div style="width: 45%; text-align: center; border-top: 1px solid #cbd5e1; padding-top: 8px; font-size: 11px;">
    {{cliente.referente}}
  </div>
</div>
      `,
    };

    saveCustomTemplate(newTmpl);
    // §3.3 — il salvataggio locale resta immediato (bozza disponibile), ma il feedback
    // deve dire la verità sul sync col server: prima il successo era annunciato comunque.
    try {
      await creaDocumentoTemplateApi(newTmpl);
      const updated = getAllTemplates();
      setTemplatesList(updated);
      handleSelectTemplate(newTmpl);
      setShowNewTmplModal(false);
      setNewTmplTitolo('');
      setNewTmplDesc('');
      setFeedback(`✓ Nuovo Modello Master "${newTmpl.titolo}" creato e salvato con successo!`);
    } catch (err: any) {
      const updated = getAllTemplates();
      setTemplatesList(updated);
      handleSelectTemplate(newTmpl);
      setFeedback(`⚠️ Modello "${newTmpl.titolo}" salvato in LOCALE ma NON sincronizzato col server: ${err?.message || 'errore di rete'}`);
    }
    setTimeout(() => setFeedback(null), 4000);
  };

  // Salva l'attuale bozza dell'editor come Nuovo Modello Master
  const handleSaveCurrentAsMasterTemplate = async () => {
    const currentHtml = editorRef.current?.innerHTML || rawTemplateRef.current;
    const name = prompt('Inserisci il nome per questo nuovo Modello Master Studio:', `${titoloDocumento} (Copia Master)`);
    if (!name || !name.trim()) return;

    const newTmpl: DocumentTemplate = {
      id: `tmpl-custom-${Date.now()}`,
      titolo: name.trim(),
      categoria: (categoria as any) || 'societario',
      descrizione: `Modello master derivato da "${titoloDocumento}" salvato in data ${new Date().toLocaleDateString('it-IT')}.`,
      contenutoHtml: currentHtml,
    };

    saveCustomTemplate(newTmpl);
    // §3.3 — come sopra: il template resta in locale, il feedback dipende dal sync server.
    try {
      await creaDocumentoTemplateApi(newTmpl);
      setTemplatesList(getAllTemplates());
      handleSelectTemplate(newTmpl);
      setFeedback(`✓ Modello Master "${newTmpl.titolo}" salvato permanentemente nello studio!`);
    } catch (err: any) {
      setTemplatesList(getAllTemplates());
      handleSelectTemplate(newTmpl);
      setFeedback(`⚠️ Modello "${newTmpl.titolo}" salvato in LOCALE ma NON sincronizzato col server: ${err?.message || 'errore di rete'}`);
    }
    setTimeout(() => setFeedback(null), 4000);
  };

  // Importazione da File (.json / .html / .pdf)
  const handleImportFileTrigger = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    if (file.name.toLowerCase().endsWith('.pdf')) {
      const reader = new FileReader();
      reader.onload = async (event) => {
        const dataUrl = event.target?.result as string;
        const tmplName = file.name.replace(/\.[^/.]+$/, "");
        const newTmpl: DocumentTemplate = {
          id: `tmpl-pdf-${Date.now()}`,
          titolo: tmplName,
          categoria: 'societario',
          descrizione: `Documento PDF importato: "${file.name}".`,
          contenutoHtml: `
<div style="font-family: Arial, sans-serif; max-width: 850px; margin: 0 auto; color: #1e293b;">
  <div style="background: #0f172a; color: #fff; padding: 14px 18px; border-radius: 8px; margin-bottom: 16px; display: flex; justify-content: space-between; align-items: center;">
    <div>
      <div style="font-size: 13px; font-weight: 700; color: #818cf8;">📄 ${file.name}</div>
      <div style="font-size: 11px; color: #94a3b8;">Documento PDF importato nel Vault Document Studio</div>
    </div>
    <a href="${dataUrl}" download="${file.name}" style="background: #4338ca; color: #fff; text-decoration: none; padding: 6px 14px; border-radius: 6px; font-size: 11.5px; font-weight: 700;">📥 Scarica PDF</a>
  </div>
  <iframe src="${dataUrl}" style="width: 100%; height: 850px; border: 1px solid #cbd5e1; border-radius: 8px; background: #fff;" title="${file.name}"></iframe>
</div>
          `.trim(),
        };
        saveCustomTemplate(newTmpl);
        // §3.3 — idem: import locale immediato, feedback onesto sul sync server.
        try {
          await creaDocumentoTemplateApi(newTmpl);
          const updated = getAllTemplates();
          setTemplatesList(updated);
          handleSelectTemplate(newTmpl);
          setFeedback(`✓ Documento PDF "${file.name}" importato con visualizzatore integrato!`);
        } catch (err: any) {
          const updated = getAllTemplates();
          setTemplatesList(updated);
          handleSelectTemplate(newTmpl);
          setFeedback(`⚠️ PDF "${file.name}" salvato in LOCALE ma NON sincronizzato col server: ${err?.message || 'errore di rete'}`);
        }
        setTimeout(() => setFeedback(null), 4000);
      };
      reader.readAsDataURL(file);
      e.target.value = '';
      return;
    }

    const reader = new FileReader();
    reader.onload = async (event) => {
      const content = event.target?.result as string;
      if (file.name.endsWith('.json')) {
        const res = importTemplatesFromJson(content);
        if (res.success) {
          const updated = getAllTemplates();
          setTemplatesList(updated);
          handleSelectTemplate(updated[0]);
          setFeedback(`✓ ${res.count} Modello/i Master importati con successo dal file JSON!`);
        } else {
          alert('Errore importazione JSON: ' + (res.error || 'Formato non valido'));
        }
      } else {
        const tmplName = file.name.replace(/\.[^/.]+$/, "");
        const newTmpl: DocumentTemplate = {
          id: `tmpl-custom-${Date.now()}`,
          titolo: tmplName,
          categoria: 'societario',
          descrizione: `Modello importato da file "${file.name}".`,
          contenutoHtml: content,
        };
        saveCustomTemplate(newTmpl);
        // §3.3 — idem: import locale immediato, feedback onesto sul sync server.
        try {
          await creaDocumentoTemplateApi(newTmpl);
          const updated = getAllTemplates();
          setTemplatesList(updated);
          handleSelectTemplate(newTmpl);
          setFeedback(`✓ File "${file.name}" importato come Modello Master!`);
        } catch (err: any) {
          const updated = getAllTemplates();
          setTemplatesList(updated);
          handleSelectTemplate(newTmpl);
          setFeedback(`⚠️ File "${file.name}" salvato in LOCALE ma NON sincronizzato col server: ${err?.message || 'errore di rete'}`);
        }
      }
      setTimeout(() => setFeedback(null), 4000);
    };
    reader.readAsText(file);
    e.target.value = '';
  };

  // Esportazione di tutti i modelli in JSON
  const handleExportTemplatesJson = () => {
    const jsonStr = exportTemplatesAsJson();
    const blob = new Blob([jsonStr], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `bluman_master_templates_bundle_${new Date().toISOString().slice(0, 10)}.json`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
    setFeedback('✓ Bundle Modelli Master esportato in formato JSON!');
    setTimeout(() => setFeedback(null), 4000);
  };

  // Archiviazione Modello Master
  const handleArchiveTemplate = (tmplId: string, tmplTitolo: string, e: React.MouseEvent) => {
    e.stopPropagation();
    archiveTemplate(tmplId);
    const updated = getAllTemplates(true);
    setTemplatesList(updated);
    setFeedback(`📦 Modello "${tmplTitolo}" archiviato con successo.`);
    setTimeout(() => setFeedback(null), 4000);
  };

  // Ripristino Modello Master
  const handleRestoreTemplate = (tmplId: string, tmplTitolo: string, e: React.MouseEvent) => {
    e.stopPropagation();
    restoreTemplate(tmplId);
    const updated = getAllTemplates(true);
    setTemplatesList(updated);
    setFeedback(`♻️ Modello "${tmplTitolo}" ripristinato tra i modelli attivi.`);
    setTimeout(() => setFeedback(null), 4000);
  };

  // Eliminazione Modello Master
  const handleDeleteTemplate = async (tmplId: string, tmplTitolo: string, e: React.MouseEvent) => {
    e.stopPropagation();
    if (!confirm(`Sei sicuro di voler eliminare definitivamente il Modello Master "${tmplTitolo}"?\n\n(I documenti già salvati o firmati nei progetti rimangono perfettamente congelati e integri).`)) return;
    // §3.3 — prima il server, poi lo stato locale: il catch vuoto dichiarava sempre
    // successo anche con l'eliminazione fallita. Il modello sparisce solo se confermato.
    try {
      await eliminaDocumentoTemplateApi(tmplId);
    } catch (err: any) {
      setFeedback(`⚠️ Eliminazione di "${tmplTitolo}" NON riuscita: ${err?.message || 'errore di rete'}. Il modello NON è stato rimosso.`);
      setTimeout(() => setFeedback(null), 4000);
      return;
    }
    deleteTemplate(tmplId);
    const updated = getAllTemplates(true);
    setTemplatesList(updated);
    if (selectedTemplateId === tmplId) {
      const firstActive = updated.find(t => !t.archiviato) || updated[0];
      if (firstActive) handleSelectTemplate(firstActive);
    }
    setFeedback(`🗑️ Modello "${tmplTitolo}" eliminato dai Modelli Master.`);
    setTimeout(() => setFeedback(null), 4000);
  };

  // Sincronizza l'editor all'avvio e quando cambiano i dati anagrafici target o la modalità di visualizzazione
  useEffect(() => {
    if (editorRef.current) {
      editorRef.current.innerHTML = renderResolvedContent(rawTemplateRef.current);
    }
  }, [selectedClienteId, selectedProgettoId, tagDisplayMode, tenantInfo]);

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

  // Esportazione VERO File PDF A4 (ISO 32000 Binary PDF con download diretto)
  const handleExportPdf = async () => {
    setFeedback('⏳ Generazione file PDF ad alta risoluzione in corso...');
    try {
      const currentTenantId = getCurrentTenantId();
      const studioInfo = getStudioInfoForTenant(currentTenantId);

      const studioRagioneSociale = tenantInfo?.ragioneSociale || studioInfo.ragioneSociale || 'Studio Professionale';
      const studioSede = tenantInfo?.sedeLegale || studioInfo.sedeLegale || '';
      const studioPiva = tenantInfo?.piva || studioInfo.piva || '';
      const studioTel = tenantInfo?.telefono || studioInfo.telefono || '';

      const rawLogo = tenantInfo?.logoUrl || localStorage.getItem(getTenantStorageKey('bluman_logo_url'));
      const logo = rawLogo ? getFormattedLogoUrl(rawLogo) : '';

      const currentHtml = editorRef.current?.innerHTML || rawTemplateRef.current;
      // Risolvi in modalità Stampa/PDF (senza smart chips, 100% testo pulito)
      const finalHtml = renderResolvedContent(currentHtml, true);

      const logoOrBadgeHtml = logo
        ? `<img src="${logo}" style="max-height: 45px; max-width: 180px; object-fit: contain;" alt="Logo Studio" />`
        : `<div style="font-size: 16pt; font-weight: 800; color: #1e1b4b; display: flex; align-items: center; gap: 8px;">🏛 ${studioRagioneSociale.toUpperCase()}</div>`;

      const fullPrintHtml = `
        <div style="font-family: 'Segoe UI', Helvetica, Arial, sans-serif; color: #0f172a; line-height: 1.6; font-size: 11.5pt; width: 100%;">
          <div style="display: flex; justify-content: space-between; align-items: center; border-bottom: 2px solid #4338ca; padding-bottom: 14px; margin-bottom: 24px;">
            ${logoOrBadgeHtml}
            <div style="text-align: right; font-size: 9pt; color: #64748b;">
              <strong style="color: #1e1b4b;">${studioRagioneSociale}</strong><br/>
              ${studioSede ? `${studioSede}<br/>` : ''}
              ${studioPiva ? `P.IVA: ${studioPiva}` : ''} ${studioTel ? `| Tel: ${studioTel}` : ''}
            </div>
          </div>
          <div style="min-height: 500px;">${finalHtml}</div>
          <div style="margin-top: 40px; border-top: 1px solid #e2e8f0; padding-top: 10px; display: flex; justify-content: space-between; font-size: 8.5pt; color: #94a3b8;">
            <span>${studioRagioneSociale} • Pratica: ${activeProgetto?.titolo || activeProgetto?.n || 'Incarico Professionale'}</span>
            <span>Sigillo eIDAS Documentale • Validità Giuridica UE</span>
          </div>
        </div>
      `;

      const safeFileName = `${titoloDocumento.replace(/[^a-zA-Z0-9_-]/g, '_')}_${new Date().toISOString().slice(0, 10)}.pdf`;
      await downloadRealPdf(safeFileName, fullPrintHtml);
      setFeedback(`✓ File PDF "${safeFileName}" generato e scaricato con successo!`);
      setTimeout(() => setFeedback(null), 5000);
    } catch (err: any) {
      console.error('Errore generazione PDF:', err);
      setFeedback(`⚠️ Errore generazione PDF: ${err.message || 'Riprova'}`);
      setTimeout(() => setFeedback(null), 5000);
    }
  };

  // Esportazione VERO File Word (.doc) Microsoft Office compatibile al 100%
  const handleExportWord = () => {
    try {
      const currentTenantId = getCurrentTenantId();
      const studioInfo = getStudioInfoForTenant(currentTenantId);

      const studioRagioneSociale = tenantInfo?.ragioneSociale || studioInfo.ragioneSociale || 'Studio Professionale';
      const studioSede = tenantInfo?.sedeLegale || studioInfo.sedeLegale || '';
      const studioPiva = tenantInfo?.piva || studioInfo.piva || '';
      const studioTel = tenantInfo?.telefono || studioInfo.telefono || '';

      const currentHtml = editorRef.current?.innerHTML || rawTemplateRef.current;
      const finalHtml = renderResolvedContent(currentHtml, true);

      const fullPrintHtml = `
        <div style="font-family: 'Calibri', 'Segoe UI', Arial, sans-serif; color: #0f172a; line-height: 1.6; font-size: 11pt;">
          <div style="display: flex; justify-content: space-between; align-items: center; border-bottom: 2px solid #4338ca; padding-bottom: 14px; margin-bottom: 24px;">
            <div style="font-size: 16pt; font-weight: bold; color: #1e1b4b;">🏛 ${studioRagioneSociale.toUpperCase()}</div>
            <div style="text-align: right; font-size: 9pt; color: #64748b;">
              <strong>${studioRagioneSociale}</strong><br/>
              ${studioSede ? `${studioSede}<br/>` : ''}
              ${studioPiva ? `P.IVA: ${studioPiva}` : ''} ${studioTel ? `| Tel: ${studioTel}` : ''}
            </div>
          </div>
          <div style="min-height: 400px;">${finalHtml}</div>
          <div style="margin-top: 40px; border-top: 1px solid #e2e8f0; padding-top: 10px; font-size: 8.5pt; color: #94a3b8;">
            ${studioRagioneSociale} • Pratica: ${activeProgetto?.titolo || activeProgetto?.n || 'Incarico Professionale'} • Validità Giuridica UE
          </div>
        </div>
      `;

      const safeFileName = `${titoloDocumento.replace(/[^a-zA-Z0-9_-]/g, '_')}_${new Date().toISOString().slice(0, 10)}.doc`;
      downloadRealWordDoc(safeFileName, fullPrintHtml);
      setFeedback(`✓ File Word "${safeFileName}" scaricato con successo!`);
      setTimeout(() => setFeedback(null), 5000);
    } catch (err: any) {
      console.error('Errore esportazione Word:', err);
      setFeedback(`⚠️ Errore esportazione Word: ${err.message || 'Riprova'}`);
      setTimeout(() => setFeedback(null), 5000);
    }
  };

  // Salvataggio nel Vault del Progetto (Google Drive / Studio Cloud Vault)
  const handleSaveToVault = async () => {
    setSalvando(true);
    setFeedback(null);
    try {
      const currentHtml = editorRef.current?.innerHTML || rawTemplateRef.current;
      const htmlContent = renderResolvedContent(currentHtml);
      const safeTitle = titoloDocumento.replace(/[^a-zA-Z0-9_\-]/g, '_');
      const filename = `${safeTitle}_${new Date().toISOString().slice(0, 10)}.docx`;
      const base64Data = btoa(unescape(encodeURIComponent(htmlContent)));

      // Senza un progetto vero non si archivia niente: prima qui c'era `|| '1'`, un id
      // inventato che il server rifiutava, e il documento finiva solo nel localStorage
      // di questo browser (regola 7 — il frontend non inventa dati che il DB non ha).
      if (!effProgettoId) {
        setFeedback('⚠️ Nessun progetto selezionato: scegli il progetto di destinazione prima di archiviare il documento.');
        setTimeout(() => setFeedback(null), 6000);
        return;
      }

      const targetProjId = effProgettoId;
      const targetProjTitle = activeProgetto?.titolo || activeProgetto?.n || activeProgetto?.nome || 'Progetto Studio';
      const targetClientName = activeCliente?.nome || 'Cliente Committente';
      const microvoceScelta = microvoci.find(m => m.id === selectedMicrovoceId) || null;

      const newVaultDoc = {
        id: `doc-vault-${Date.now()}`,
        nome: `${titoloDocumento}.docx`,
        titolo: titoloDocumento,
        cat: categoria === 'engagement' ? 'Contratti' : categoria === 'nda' ? 'Riservatezza' : categoria === 'delega' ? 'Procure & Deleghe' : categoria === 'fiscale' ? 'Trust & Fiscale' : 'Societario',
        categoria: categoria,
        dimensione: `${Math.max(14, Math.round(htmlContent.length / 1024))} KB`,
        data: new Date().toLocaleDateString('it-IT'),
        dataCaricamento: new Date().toLocaleDateString('it-IT'),
        progettoId: targetProjId,
        progettoTitolo: targetProjTitle,
        microvoceProgettoId: selectedMicrovoceId || null,
        microvoceNome: microvoceScelta?.nome ?? null,
        clienteNome: targetClientName,
        contenutoHtml: htmlContent,
        firmato: false,
        richiedeFirma: categoria === 'engagement' || categoria === 'nda',
        formato: 'word',
        url: `#doc-${Date.now()}`,
      };

      // 1. Archiviazione sul database (regola 3). Prima qui si chiamava `uploadFileApi`, che
      //    carica il file ma NON crea la riga nella tabella `documento`: il documento viveva
      //    solo nel localStorage di questo browser, gli altri operatori e il portale del
      //    cliente non lo vedevano, e non essendoci nulla da cancellare il cestino del Vault
      //    non aveva effetto. Nasce come bozza: pubblicarlo è un gesto dell'operatore (§WF-DOC).
      let salvatoSulServer = false;
      try {
        const creato = await salvaDocumentoApi({
          progettoId: targetProjId,
          // §WF-DOC — il collegamento alla micro-voce viaggia con il documento: è quello
          // che nel portale permette al cliente di risalire dal file al lavoro che lo ha
          // prodotto (micro-voce → modulo → progetto). Se l'operatore non ne indica una,
          // il documento resta di fascicolo, come previsto da §2.9.
          microvoceProgettoId: selectedMicrovoceId || undefined,
          filename,
          contentBase64: base64Data,
          categoriaDoc: categoria,
        });
        // L'id del database diventa l'id del documento anche in locale: è quello che serve per
        // ritrovarlo, pubblicarlo e cancellarlo.
        newVaultDoc.id = creato.id;
        newVaultDoc.url = creato.fileUrl || newVaultDoc.url;
        salvatoSulServer = true;
      } catch (errSalvataggio: any) {
        console.error('Archiviazione documento sul server non riuscita:', errSalvataggio);
      }

      // 2. Copia locale per la scheda Documenti del progetto
      const storageKey = getTenantStorageKey(`bluman_project_documents_${targetProjId}`);
      const currentVaultStr = localStorage.getItem(storageKey);
      const currentVault: any[] = currentVaultStr ? JSON.parse(currentVaultStr) : [];
      const updatedVault = [newVaultDoc, ...currentVault.filter((d: any) => d.titolo !== titoloDocumento)];
      localStorage.setItem(storageKey, JSON.stringify(updatedVault));

      // 3. Registro globale documenti
      const allVaultKey = getTenantStorageKey('bluman_all_vault_documents');
      const allVaultStr = localStorage.getItem(allVaultKey);
      const allVault: any[] = allVaultStr ? JSON.parse(allVaultStr) : [];
      localStorage.setItem(allVaultKey, JSON.stringify([newVaultDoc, ...allVault.filter((d: any) => d.id !== newVaultDoc.id)]));

      // Nessuna etichetta che promette più di quanto è successo (regola 7): se il server non ha
      // archiviato il documento, questa copia sta solo in questo browser e va detto.
      if (salvatoSulServer) {
        // Il messaggio dice dove è finito il documento — progetto e, se indicata, micro-voce:
        // è il primo anello del filo che il cliente ripercorrerà nel portale.
        const dove = microvoceScelta
          ? `micro-voce "${microvoceScelta.nome}" (modulo ${microvoceScelta.modulo}) del progetto "${targetProjTitle}"`
          : `fascicolo del progetto "${targetProjTitle}" (nessuna micro-voce indicata)`;
        setFeedback(`✓ Documento "${titoloDocumento}" archiviato in bozza nel ${dove}. Per renderlo visibile al cliente pubblicalo dalla micro-voce.`);
      } else {
        setFeedback(
          `⚠️ "${titoloDocumento}" NON è stato archiviato sul server: la copia è solo su questo browser. ` +
          'Riprova il salvataggio, altrimenti il cliente e gli altri operatori non lo vedranno.'
        );
      }
      setTimeout(() => setFeedback(null), 8000);
    } catch (err: any) {
      setFeedback(`⚠️ Errore salvataggio: ${err.message || 'Errore imprevisto'}`);
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

        {/* Action Buttons & Tag Display Switcher */}
        <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'center' }}>
          <div style={{ display: 'flex', background: 'var(--card2)', border: '1px solid var(--border)', borderRadius: 8, overflow: 'hidden' }}>
            <button
              onClick={() => setTagDisplayMode('highlight')}
              style={{
                background: tagDisplayMode === 'highlight' ? '#1e1b4b' : 'transparent',
                color: tagDisplayMode === 'highlight' ? '#818cf8' : 'var(--muted)',
                border: 'none',
                padding: '6px 12px',
                fontSize: 11.5,
                fontWeight: 700,
                cursor: 'pointer',
              }}
              title="Mostra i dati anagrafici reali evidenziati come Smart Chip dinamico"
            >
              🏷️ Dati Reali (Smart Chip)
            </button>
            <button
              onClick={() => setTagDisplayMode('plain')}
              style={{
                background: tagDisplayMode === 'plain' ? '#1e1b4b' : 'transparent',
                color: tagDisplayMode === 'plain' ? '#818cf8' : 'var(--muted)',
                border: 'none',
                padding: '6px 12px',
                fontSize: 11.5,
                fontWeight: 700,
                cursor: 'pointer',
              }}
              title="Mostra i dati anagrafici in testo normale non evidenziato"
            >
              📄 Testo Naturale
            </button>
            <button
              onClick={() => setTagDisplayMode('raw')}
              style={{
                background: tagDisplayMode === 'raw' ? '#1e1b4b' : 'transparent',
                color: tagDisplayMode === 'raw' ? '#818cf8' : 'var(--muted)',
                border: 'none',
                padding: '6px 12px',
                fontSize: 11.5,
                fontWeight: 700,
                cursor: 'pointer',
              }}
              title="Mostra i codici grezzi {{tag}}"
            >
              🔍 Codici &#123;&#123;Tag&#125;&#125;
            </button>
          </div>

          <button
            onClick={handleExportPdf}
            style={{ background: '#0d2d22', color: '#34d399', border: '1px solid #059669', padding: '7px 14px', borderRadius: 8, fontSize: 12, fontWeight: 700, cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 6 }}
            title="Esporta in formato PDF A4 vettoriale"
          >
            <span>📥 Esporta PDF A4</span>
          </button>

          <button
            onClick={handleExportWord}
            style={{ background: '#1e1b4b', color: '#93c5fd', border: '1px solid #3b82f6', padding: '7px 14px', borderRadius: 8, fontSize: 12, fontWeight: 700, cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 6 }}
            title="Esporta in formato Microsoft Word (.doc) apribile"
          >
            <span>📝 Esporta Word (.doc)</span>
          </button>

          <button
            onClick={(e) => handleDeleteTemplate(selectedTemplateId, titoloDocumento, e)}
            style={{ background: 'rgba(239, 68, 68, 0.15)', color: '#f87171', border: '1px solid #ef4444', padding: '7px 14px', borderRadius: 8, fontSize: 12, fontWeight: 700, cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 6 }}
            title="Elimina questo modello master dalla libreria"
          >
            <span>🗑️ Elimina Modello Master</span>
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
            {clienti.length === 0 ? (
              <option value="">(Nessun cliente registrato in questo Studio)</option>
            ) : (
              clienti.map(c => (
                <option key={c.id} value={c.id}>{c.nome} {c.piva || c.codiceFiscale ? `(${c.piva || c.codiceFiscale})` : ''}</option>
              ))
            )}
          </select>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <label style={{ fontSize: 11.5, fontWeight: 700, color: 'var(--muted)' }}>📁 Progetto Collegato:</label>
          <select
            value={selectedProgettoId}
            onChange={(e) => setSelectedProgettoId(e.target.value)}
            style={{ fontSize: 12, padding: '5px 10px', borderRadius: 6, background: 'var(--card)', color: 'var(--text)', border: '1px solid var(--border)', fontWeight: 600 }}
          >
            {progetti.length === 0 ? (
              <option value="">(Nessun progetto attivo in questo Studio)</option>
            ) : (
              progetti.map((p: any) => (
                <option key={p.id} value={p.id}>{p.titolo || p.n || p.nome || `Progetto #${p.id}`} {p.cl ? `(${p.cl})` : ''}</option>
              ))
            )}
          </select>
        </div>

        {/* §WF-DOC — micro-voce di destinazione. È il collegamento che nel portale
            consente al cliente di risalire dal documento al lavoro che l'ha prodotto.
            Se l'operatore non ne indica una il documento resta di solo fascicolo (§2.9),
            ma è una scelta esplicita e la pagina lo dice. */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <label style={{ fontSize: 11.5, fontWeight: 700, color: 'var(--muted)' }}>🔖 Micro-voce di Destinazione:</label>
          <select
            value={selectedMicrovoceId}
            onChange={(e) => setSelectedMicrovoceId(e.target.value)}
            disabled={!effProgettoId || caricandoMicrovoci}
            style={{ fontSize: 12, padding: '5px 10px', borderRadius: 6, background: 'var(--card)', color: 'var(--text)', border: '1px solid var(--border)', fontWeight: 600, maxWidth: 340 }}
            title="Il documento verrà agganciato a questa micro-voce: il cliente lo vedrà nel portale sotto la relativa lavorazione"
          >
            {caricandoMicrovoci ? (
              <option value="">Lettura micro-voci…</option>
            ) : microvoci.length === 0 ? (
              <option value="">(Nessuna micro-voce a database su questo progetto)</option>
            ) : (
              <>
                <option value="">— Solo fascicolo progetto (nessuna micro-voce) —</option>
                {microvoci.map(mv => (
                  <option key={mv.id} value={mv.id}>{mv.modulo} › {mv.nome}</option>
                ))}
              </>
            )}
          </select>
        </div>
      </div>

      {/* Filo logico dichiarato: dove finirà il documento e cosa serve perché il cliente lo veda. */}
      <div style={{ background: 'var(--card)', border: '1px dashed var(--border)', borderRadius: 10, padding: '9px 14px', fontSize: 11, color: 'var(--muted)', display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
        <span style={{ fontWeight: 700, color: 'var(--text)' }}>Percorso del documento:</span>
        <span>
          {effProgettoId
            ? <>
                {activeProgetto?.titolo || activeProgetto?.n || activeProgetto?.nome || 'Progetto'}
                {' › '}
                {selectedMicrovoceId
                  ? (microvoci.find(m => m.id === selectedMicrovoceId)?.modulo ?? 'Modulo') + ' › ' + (microvoci.find(m => m.id === selectedMicrovoceId)?.nome ?? 'Micro-voce')
                  : 'fascicolo progetto'}
                {' › '}
                <span style={{ color: '#a1a1aa' }}>bozza interna</span>
                {' → '}
                <span style={{ color: '#60a5fa' }}>pubblicazione dalla micro-voce</span>
                {' → '}
                <span style={{ color: '#34d399' }}>firma del cliente nel portale</span>
              </>
            : 'nessun progetto selezionato — il salvataggio sul server è sospeso'}
        </span>
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

            {/* Master Templates Studio Library with Import / Export / Creation */}
            <div style={{ background: 'var(--card)', border: '1px solid var(--border)', borderRadius: 14, padding: 16, display: 'flex', flexDirection: 'column', gap: 10 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <div>
                  <div style={{ fontSize: 13, fontWeight: 800, color: 'var(--text)' }}>📚 Modelli Master ({templatesList.length})</div>
                  <div style={{ fontSize: 10, color: 'var(--muted)' }}>Libreria template studio</div>
                </div>
                <div style={{ display: 'flex', gap: 4 }}>
                  <button
                    type="button"
                    onClick={() => setShowNewTmplModal(true)}
                    style={{ background: 'var(--indigo)', color: '#fff', border: 'none', padding: '4px 8px', borderRadius: 6, fontSize: 10.5, fontWeight: 700, cursor: 'pointer' }}
                    title="Crea Nuovo Modello Master da Zero"
                  >
                    ➕ Nuovo
                  </button>
                  <button
                    type="button"
                    onClick={() => fileImportRef.current?.click()}
                    style={{ background: '#1e1b4b', color: '#818cf8', border: '1px solid #4338ca', padding: '4px 8px', borderRadius: 6, fontSize: 10.5, fontWeight: 700, cursor: 'pointer' }}
                    title="Importa Modello Master da file JSON o HTML"
                  >
                    📥
                  </button>
                  <button
                    type="button"
                    onClick={handleExportTemplatesJson}
                    style={{ background: 'var(--card2)', color: 'var(--muted)', border: '1px solid var(--border)', padding: '4px 6px', borderRadius: 6, fontSize: 10.5, cursor: 'pointer' }}
                    title="Esporta Bundle Modelli Master in JSON"
                  >
                    📤
                  </button>
                </div>
              </div>

              <input
                type="file"
                ref={fileImportRef}
                accept=".json,.html,.htm,.pdf"
                style={{ display: 'none' }}
                onChange={handleImportFileTrigger}
              />

              <button
                type="button"
                onClick={handleSaveCurrentAsMasterTemplate}
                style={{ width: '100%', background: 'rgba(99, 102, 241, 0.1)', border: '1px dashed #6366f1', color: '#818cf8', padding: '6px', borderRadius: 8, fontSize: 11, fontWeight: 700, cursor: 'pointer' }}
                title="Salva l'attuale bozza dell'editor come nuovo modello master riutilizzabile"
              >
                💾 Salva Bozza Attuale come Master
              </button>

              {/* Filtri di Ricerca & Stato Sidebar */}
              <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                <input
                  type="text"
                  placeholder="🔍 Cerca modello master..."
                  value={searchMasterTmplQuery}
                  onChange={e => setSearchMasterTmplQuery(e.target.value)}
                  style={{ fontSize: 11, padding: '5px 8px', borderRadius: 6, background: 'var(--card2)', border: '1px solid var(--border)', width: '100%' }}
                />

                <div style={{ display: 'flex', gap: 4, background: 'var(--card2)', padding: 2, borderRadius: 6 }}>
                  <button
                    type="button"
                    onClick={() => setTmplStatusSidebar('attivi')}
                    style={{
                      flex: 1,
                      background: tmplStatusSidebar === 'attivi' ? '#1e1b4b' : 'transparent',
                      color: tmplStatusSidebar === 'attivi' ? '#818cf8' : 'var(--muted)',
                      border: 'none',
                      padding: '3px 0',
                      borderRadius: 4,
                      fontSize: 10,
                      fontWeight: 700,
                      cursor: 'pointer',
                    }}
                  >
                    Attivi ({templatesList.filter(t => !t.archiviato).length})
                  </button>
                  <button
                    type="button"
                    onClick={() => setTmplStatusSidebar('archiviati')}
                    style={{
                      flex: 1,
                      background: tmplStatusSidebar === 'archiviati' ? '#1e1b4b' : 'transparent',
                      color: tmplStatusSidebar === 'archiviati' ? '#818cf8' : 'var(--muted)',
                      border: 'none',
                      padding: '3px 0',
                      borderRadius: 4,
                      fontSize: 10,
                      fontWeight: 700,
                      cursor: 'pointer',
                    }}
                  >
                    Archiviati ({templatesList.filter(t => !!t.archiviato).length})
                  </button>
                  <button
                    type="button"
                    onClick={() => setTmplStatusSidebar('tutti')}
                    style={{
                      flex: 1,
                      background: tmplStatusSidebar === 'tutti' ? '#1e1b4b' : 'transparent',
                      color: tmplStatusSidebar === 'tutti' ? '#818cf8' : 'var(--muted)',
                      border: 'none',
                      padding: '3px 0',
                      borderRadius: 4,
                      fontSize: 10,
                      fontWeight: 700,
                      cursor: 'pointer',
                    }}
                  >
                    Tutti ({templatesList.length})
                  </button>
                </div>
              </div>

              <div style={{ display: 'flex', flexDirection: 'column', gap: 6, maxHeight: 380, overflowY: 'auto' }}>
                {templatesList
                  .filter(t => {
                    const matchSearch = !searchMasterTmplQuery || t.titolo.toLowerCase().includes(searchMasterTmplQuery.toLowerCase()) || t.descrizione.toLowerCase().includes(searchMasterTmplQuery.toLowerCase());
                    const matchStatus = tmplStatusSidebar === 'tutti' || (tmplStatusSidebar === 'archiviati' ? !!t.archiviato : !t.archiviato);
                    return matchSearch && matchStatus;
                  })
                  .map(t => {
                  const isCustom = t.id.startsWith('tmpl-custom');
                  const isSelected = selectedTemplateId === t.id;
                  return (
                    <div
                      key={t.id}
                      onClick={() => handleSelectTemplate(t)}
                      style={{
                        background: isSelected ? '#1e1b4b' : 'var(--card2)',
                        border: `1px solid ${isSelected ? '#6366f1' : t.archiviato ? '#4338ca' : 'var(--border)'}`,
                        padding: '8px 10px',
                        borderRadius: 8,
                        cursor: 'pointer',
                        display: 'flex',
                        justifyContent: 'space-between',
                        alignItems: 'flex-start',
                        gap: 6,
                        opacity: t.archiviato ? 0.8 : 1,
                      }}
                    >
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                          <span style={{ fontWeight: 700, fontSize: 11, color: isSelected ? '#a5b4fc' : 'var(--text)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                            {t.titolo}
                          </span>
                          {t.archiviato && (
                            <span style={{ fontSize: 8.5, background: '#312e81', color: '#c7d2fe', padding: '1px 4px', borderRadius: 4, fontWeight: 700 }}>
                              📦
                            </span>
                          )}
                          {isCustom && (
                            <span style={{ fontSize: 8.5, background: '#064e3b', color: '#34d399', padding: '1px 4px', borderRadius: 4, fontWeight: 700 }}>
                              Custom
                            </span>
                          )}
                        </div>
                        <div style={{ fontSize: 9.5, color: 'var(--muted)', marginTop: 2, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                          {t.descrizione}
                        </div>
                      </div>

                      <div style={{ display: 'flex', alignItems: 'center', gap: 4, flexShrink: 0 }}>
                        {t.archiviato ? (
                          <button
                            type="button"
                            onClick={(e) => handleRestoreTemplate(t.id, t.titolo, e)}
                            style={{ background: '#064e3b', border: '1px solid #059669', color: '#34d399', fontSize: 10, cursor: 'pointer', padding: '3px 6px', borderRadius: 4, fontWeight: 700, display: 'flex', alignItems: 'center', gap: 2 }}
                            title="Ripristina modello tra gli attivi"
                          >
                            <span>♻️</span>
                            <span>Ripristina</span>
                          </button>
                        ) : (
                          <button
                            type="button"
                            onClick={(e) => handleArchiveTemplate(t.id, t.titolo, e)}
                            style={{ background: 'var(--card)', border: '1px solid var(--border)', color: 'var(--muted)', fontSize: 10, cursor: 'pointer', padding: '3px 6px', borderRadius: 4, fontWeight: 600, display: 'flex', alignItems: 'center', gap: 2 }}
                            title="Archivia modello master"
                          >
                            <span>📦</span>
                          </button>
                        )}

                        <button
                          type="button"
                          onClick={(e) => handleDeleteTemplate(t.id, t.titolo, e)}
                          style={{ background: 'rgba(239, 68, 68, 0.15)', border: '1px solid #ef4444', color: '#f87171', fontSize: 10, cursor: 'pointer', padding: '3px 6px', borderRadius: 4, fontWeight: 700, display: 'flex', alignItems: 'center', gap: 2 }}
                          title="Elimina definitivamente modello master"
                        >
                          <span>🗑️</span>
                          <span>Elimina</span>
                        </button>
                      </div>
                    </div>
                  );
                })}
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
                  {(() => {
                    const rawLogo = tenantInfo?.logoUrl || localStorage.getItem(getTenantStorageKey('bluman_logo_url'));
                    if (rawLogo) {
                      return (
                        <img
                          src={getFormattedLogoUrl(rawLogo)}
                          alt="Logo"
                          style={{ height: 42, maxWidth: 180, objectFit: 'contain' }}
                          onError={(e) => { (e.target as HTMLImageElement).style.display = 'none'; }}
                        />
                      );
                    }
                    return (
                      <div style={{ fontSize: 16, fontWeight: 800, color: '#1e1b4b', display: 'flex', alignItems: 'center', gap: 8 }}>
                        🏛 {(tenantInfo?.ragioneSociale || getStudioInfoForTenant(getCurrentTenantId()).ragioneSociale || 'STUDIO PROFESSIONALE').toUpperCase()}
                      </div>
                    );
                  })()}
                  <div style={{ textAlign: 'right', fontSize: 10, color: '#64748b', lineHeight: 1.4 }}>
                    <strong style={{ color: '#1e1b4b', fontSize: 11 }}>{tenantInfo?.ragioneSociale || getStudioInfoForTenant(getCurrentTenantId()).ragioneSociale || 'Studio Professionale'}</strong><br/>
                    {tenantInfo?.sedeLegale || getStudioInfoForTenant(getCurrentTenantId()).sedeLegale ? <>{tenantInfo?.sedeLegale || getStudioInfoForTenant(getCurrentTenantId()).sedeLegale}<br/></> : null}
                    {(tenantInfo?.piva || getStudioInfoForTenant(getCurrentTenantId()).piva) ? `P.IVA/TIN: ${tenantInfo?.piva || getStudioInfoForTenant(getCurrentTenantId()).piva}` : ''}{(tenantInfo?.telefono || getStudioInfoForTenant(getCurrentTenantId()).telefono) ? ` | Tel: ${tenantInfo?.telefono || getStudioInfoForTenant(getCurrentTenantId()).telefono}` : ''}
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
                <span>Documento Riservato • {tenantInfo?.ragioneSociale || getStudioInfoForTenant(getCurrentTenantId()).ragioneSociale || 'Studio Professionale'} • Pratica: {activeProgetto?.titolo || activeProgetto?.n || 'Incarico Professionale'}</span>
                <span>Pagina 1 di 1 • Sigillo eIDAS BluMan</span>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* ➕ MODALE CREAZIONE NUOVO MODELLO MASTER STUDIO */}
      {showNewTmplModal && (
        <div
          style={{
            position: 'fixed',
            inset: 0,
            background: 'rgba(0,0,0,0.75)',
            backdropFilter: 'blur(6px)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            zIndex: 9999,
            padding: 20,
          }}
          onClick={() => setShowNewTmplModal(false)}
        >
          <div
            style={{
              background: 'var(--card)',
              border: '1px solid var(--border)',
              borderRadius: 16,
              width: '100%',
              maxWidth: 520,
              padding: 24,
              boxShadow: '0 20px 40px rgba(0,0,0,0.5)',
            }}
            onClick={(e) => e.stopPropagation()}
          >
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
              <div>
                <div style={{ fontSize: 16, fontWeight: 800, color: 'var(--text)' }}>➕ Crea Nuovo Modello Master Studio</div>
                <div style={{ fontSize: 11, color: 'var(--muted)', marginTop: 2 }}>Crea un nuovo modello personalizzato con Smart Tags riutilizzabili</div>
              </div>
              <button
                type="button"
                onClick={() => setShowNewTmplModal(false)}
                style={{ background: 'transparent', border: 'none', color: 'var(--muted)', fontSize: 18, cursor: 'pointer' }}
              >
                ✕
              </button>
            </div>

            <form onSubmit={handleCreateCustomMaster} style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
              <div>
                <label style={{ fontSize: 11.5, fontWeight: 700, color: 'var(--text)', display: 'block', marginBottom: 5 }}>
                  Titolo Modello Master *
                </label>
                <input
                  type="text"
                  required
                  placeholder="Es. Patto di Riservatezza Dipendenti, Mandato Wealth Management..."
                  value={newTmplTitolo}
                  onChange={(e) => setNewTmplTitolo(e.target.value)}
                  style={{ width: '100%', padding: '9px 12px', borderRadius: 8, background: 'var(--card2)', color: 'var(--text)', border: '1px solid var(--border)', fontSize: 12.5 }}
                />
              </div>

              <div>
                <label style={{ fontSize: 11.5, fontWeight: 700, color: 'var(--text)', display: 'block', marginBottom: 5 }}>
                  Categoria *
                </label>
                <select
                  value={newTmplCat}
                  onChange={(e) => setNewTmplCat(e.target.value as any)}
                  style={{ width: '100%', padding: '9px 12px', borderRadius: 8, background: 'var(--card2)', color: 'var(--text)', border: '1px solid var(--border)', fontSize: 12.5 }}
                >
                  <option value="societario">Societario & Statuti</option>
                  <option value="contratto">Contratti & Accordi</option>
                  <option value="engagement">Engagement Letter & Mandati</option>
                  <option value="nda">NDA & Riservatezza</option>
                  <option value="delega">Procure & Deleghe</option>
                  <option value="trust">Trust & Fiduciaria</option>
                  <option value="compliance">Compliance & UBO KYC</option>
                  <option value="fiscale">Fiscale & Tax Planning</option>
                </select>
              </div>

              <div>
                <label style={{ fontSize: 11.5, fontWeight: 700, color: 'var(--text)', display: 'block', marginBottom: 5 }}>
                  Descrizione Modello
                </label>
                <textarea
                  rows={3}
                  placeholder="Breve descrizione dell'utilizzo pratico e delle condizioni previste dal modello..."
                  value={newTmplDesc}
                  onChange={(e) => setNewTmplDesc(e.target.value)}
                  style={{ width: '100%', padding: '9px 12px', borderRadius: 8, background: 'var(--card2)', color: 'var(--text)', border: '1px solid var(--border)', fontSize: 12 }}
                />
              </div>

              <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 10, marginTop: 10 }}>
                <button
                  type="button"
                  onClick={() => setShowNewTmplModal(false)}
                  style={{ background: 'var(--card2)', border: '1px solid var(--border)', color: 'var(--muted)', padding: '8px 16px', borderRadius: 8, fontSize: 12, cursor: 'pointer' }}
                >
                  Annulla
                </button>
                <button
                  type="submit"
                  style={{ background: 'var(--indigo)', color: '#fff', border: 'none', padding: '8px 20px', borderRadius: 8, fontSize: 12, fontWeight: 700, cursor: 'pointer', boxShadow: '0 4px 14px rgba(99,102,241,0.3)' }}
                >
                  ✓ Crea e Apri nell'Editor
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
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
