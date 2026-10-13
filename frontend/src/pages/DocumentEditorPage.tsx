import React, { useState, useEffect, useRef } from 'react';
import { useSearchParams, useNavigate } from 'react-router-dom';
import { fetchClienti, fetchProgetti, fetchProgettoDettaglio, fetchTenantInfoApi, salvaDocumentoApi } from '../api/client';
import { getFormattedLogoUrl } from '../utils';
import { downloadRealPdf, downloadRealWordDoc } from '../utils/pdfGenerator';
import { getCurrentTenantId, getTenantStorageKey, getStudioInfoForTenant, getBrandLogoFallback } from '../utils/tenant';
import { componiDocumento, scomponiDocumento } from '../../../src/util/intestazionePiede';
import { escapeHtmlTesto, sanitizzaHtmlDocumento } from '../../../src/util/htmlSanitizer';
import { intestazioneStudioHtml, piedeStudioHtml } from '../utils/intestazioneStudio';
import type { Cliente, Progetto } from '../types';

import {
  PREBUILT_TEMPLATES,
  exportTemplatesAsJson,
  type DocumentTemplate,
} from '../utils/documentTemplates';
// §41 — I gesti sui modelli (crea, modifica, revisiona, archivia, elimina, importa) passano
// tutti da qui: prima il server, poi l'elenco. Prima metà finivano in `localStorage`, quindi
// valevano per questo browser e per nessun altro.
import { useCartellaTemplate } from '../hooks/useCartellaTemplate';
import { confirm } from '../components/ui/ConfirmProvider';
import { HeaderEditor } from '../components/editor/HeaderEditor';
import { SelettoreDestinazione } from '../components/editor/SelettoreDestinazione';
import { PannelloTag } from '../components/editor/PannelloTag';
import { LibreriaTemplate } from '../components/editor/LibreriaTemplate';
import { EditorCanvas } from '../components/editor/EditorCanvas';
import { ModaleNuovoTemplate } from '../components/editor/ModaleNuovoTemplate';
export type { DocumentTemplate };
export { PREBUILT_TEMPLATES };

export function DocumentEditorPage() {
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();

  const queryProjId = searchParams.get('projId') || '';
  const queryDocId = searchParams.get('docId') || '';
  const queryTmplId = searchParams.get('tmplId') || 'tmpl-engagement';

  // §41 — L'elenco dei modelli arriva dalla cartella dello studio (database), non più da
  // `localStorage`: un modello creato su un computer si vede su tutti gli altri, e
  // l'archiviazione vale per lo studio. `erroreCartella` esiste perché un guasto di lettura
  // non si travesta da «lo studio ha solo i modelli di serie».
  const cartella = useCartellaTemplate();
  const templatesList = cartella.modelli;
  const [searchMasterTmplQuery, setSearchMasterTmplQuery] = useState('');
  const [tmplStatusSidebar, setTmplStatusSidebar] = useState<'attivi' | 'archiviati' | 'tutti'>('attivi');

  const [showNewTmplModal, setShowNewTmplModal] = useState(false);
  const [newTmplTitolo, setNewTmplTitolo] = useState('');
  const [newTmplCat, setNewTmplCat] = useState<'societario' | 'contratto' | 'nda' | 'engagement' | 'delega' | 'fiscale' | 'trust' | 'compliance'>('societario');
  const [newTmplDesc, setNewTmplDesc] = useState('');
  /**
   * Piano firma §3 — livello legale (ses|fea|feq) che il nuovo Modello Master esigerà.
   * Di default 'ses': comportamento storico, nessuna sorpresa per l'operatore.
   */
  const [newTmplLivello, setNewTmplLivello] = useState<'ses' | 'fea' | 'feq'>('ses');

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
  /**
   * Piano firma §3 — livello legale (ses|fea|feq) che il documento corrente esige.
   * Ereditato dal template selezionato in handleSelectTemplate, salvato su ogni
   * newVaultDoc/salvaDocumentoApi e su ogni master creato con "Salva come Modello".
   */
  const [livelloFirmaDoc, setLivelloFirmaDoc] = useState<'ses' | 'fea' | 'feq'>('ses');

  /**
   * §39 — Intestazione e piè di pagina propri di QUESTO documento.
   *
   * `null` significa «quelli dello studio»: è il caso normale, e i documenti salvati prima di §39
   * ricadono lì senza cambiare aspetto. Diventano una stringa solo quando l'operatore li sblocca
   * con un doppio clic e li modifica; da quel momento viaggiano dentro l'HTML salvato
   * (`componiDocumento`), tornano alla riapertura (`scomponiDocumento`) e finiscono nel PDF e nel
   * .doc. Un blocco modificato che vivesse solo nel DOM non sarebbe salvato (regola 3).
   */
  const [intestazionePropria, setIntestazionePropria] = useState<string | null>(null);
  const [piedeProprio, setPiedeProprio] = useState<string | null>(null);

  const [salvando, setSalvando] = useState(false);
  const [feedback, setFeedback] = useState<string | null>(null);

  const editorRef = useRef<HTMLDivElement>(null);
  const fileImportRef = useRef<HTMLInputElement>(null);
  const rawTemplateRef = useRef<string>(initialTmpl.contenutoHtml);
  /**
   * §41 — Quale modello sta effettivamente nell'editor.
   *
   * Non coincide con `selectedTemplateId` nel primo istante di vita della pagina: entrando da
   * `/documents?tmplId=<id>` (per esempio dalla Cartella Modelli) l'id chiesto è già selezionato,
   * ma la cartella dello studio arriva dal server dopo il primo render, quindi il testo caricato è
   * quello del primo modello disponibile. Questo riferimento dice cosa c'è davvero sotto le mani,
   * così l'effetto sotto può caricare il modello giusto una volta sola e senza sovrascrivere
   * quello che l'operatore ha scelto dopo.
   */
  const modelloCaricatoRef = useRef<string>(initialTmpl.id);
  const modelloDaUrlApplicato = useRef(false);

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
        const foundProj = projMap.get(queryProjId);
        setSelectedProgettoId(queryProjId);
        if (foundProj?.clienteId) {
          const c = allClients.find(cl => cl.id === foundProj.clienteId || cl.nome.toLowerCase() === (foundProj.cl || '').toLowerCase());
          if (c) setSelectedClienteId(c.id);
        } else if (foundProj?.cl) {
          const c = allClients.find(cl => cl.nome.toLowerCase() === foundProj.cl.toLowerCase());
          if (c) setSelectedClienteId(c.id);
        }
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
            // §39 — l'HTML salvato può portare intestazione e piede propri: si rimettono al loro
            // posto, e nell'area editabile va solo il corpo. Un documento salvato prima di §39 non
            // ha marcatori e torna tutto come corpo, esattamente come prima.
            const parti = scomponiDocumento(sanitizzaHtmlDocumento(foundDoc.contenutoHtml));
            setIntestazionePropria(sanitizzaHtmlDocumento(parti.intestazione));
            setPiedeProprio(sanitizzaHtmlDocumento(parti.piede));
            rawTemplateRef.current = sanitizzaHtmlDocumento(parti.corpo);
            if (editorRef.current) {
              editorRef.current.innerHTML = rawTemplateRef.current;
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

  /**
   * §39 — L'intestazione e il piede che il foglio mostra ADESSO.
   *
   * Sono quelli propri del documento se l'operatore li ha sbloccati e modificati, altrimenti quelli
   * dello studio costruiti dagli stessi dati. Uno solo per l'editor, il PDF, il .doc e il documento
   * salvato: prima erano tre HTML somiglianti scritti in tre punti diversi, ed è per questo che si
   * vedeva una cosa e si stampava un'altra.
   */
  const studioCorrente = getStudioInfoForTenant(getCurrentTenantId());
  const ragioneSocialeFoglio = tenantInfo?.ragioneSociale || studioCorrente.ragioneSociale || 'Studio Professionale';
  const logoFoglio = (() => {
    const raw = tenantInfo?.logoUrl || localStorage.getItem(getTenantStorageKey('bluman_logo_url'));
    return raw ? getFormattedLogoUrl(raw) : '';
  })();
  const intestazioneEffettiva = intestazionePropria ?? intestazioneStudioHtml({
    ragioneSociale: ragioneSocialeFoglio,
    sedeLegale: tenantInfo?.sedeLegale || studioCorrente.sedeLegale || '',
    piva: tenantInfo?.piva || studioCorrente.piva || '',
    telefono: tenantInfo?.telefono || studioCorrente.telefono || '',
    logo: logoFoglio,
    logoFallback: getBrandLogoFallback(getCurrentTenantId()),
  });
  const piedeEffettivo = piedeProprio ?? piedeStudioHtml({
    ragioneSociale: ragioneSocialeFoglio,
    pratica: activeProgetto?.titolo || activeProgetto?.n || activeProgetto?.nome || 'Incarico Professionale',
    livelloFirma: livelloFirmaDoc,
  });

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
    const htmlSicuro = sanitizzaHtmlDocumento(htmlContent);
    if (tagDisplayMode === 'raw' && !isForPrintOrExport) return htmlSicuro;

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
    // §7 — il ripiego era `'Lead Senior Advisor'`, cioè un ruolo al posto di un nome (vedi
    // `documentTemplates.ts`): senza il responsabile in anagrafica il campo resta vuoto.
    const studioLeadAdvisor = studioInfo.leadAdvisor || '';
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

    let customRowsHtml = '';
    let customTotalEur: number | null = null;
    const savedRowsStr = sessionStorage.getItem('bluman_proforma_table_rows');
    if (savedRowsStr) {
      try {
        const parsed = JSON.parse(savedRowsStr);
        if (String(parsed.projId) === String(effProgettoId) && Array.isArray(parsed.rows) && parsed.rows.length > 0) {
          customTotalEur = parsed.totalEur;
          customRowsHtml = parsed.rows.map((r: any) => `
            <tr style="border-bottom: 1px solid #e2e8f0;">
              <td style="padding: 10px 8px;">
                <strong style="color: #1e3a8a;">[${escapeHtmlTesto(r.moduloNome || 'Prestazione')}]</strong> ${escapeHtmlTesto(r.titolo)}
                ${r.oreConsuntivate > 0 ? `<div style="font-size: 10px; color: #64748b;">Consuntivo: ${Number(r.oreConsuntivate)}h</div>` : ''}
              </td>
              <td style="padding: 10px 8px; text-align: right; font-weight: 600;">€ ${Number(r.importo).toLocaleString('it-IT', { minimumFractionDigits: 2 })}</td>
            </tr>
          `).join('');
        }
      } catch {}
    }

    const effImporto = customTotalEur !== null ? customTotalEur : projImporto;

    // Se in anteprima bozza e modalità 'highlight', evidenzia il dato reale con un elegante Smart Chip ERP
    const wrapTag = (value: string, tagCode: string) => {
      const valoreSicuro = escapeHtmlTesto(value || `[${tagCode}]`);
      if (isForPrintOrExport || tagDisplayMode === 'plain') return valoreSicuro;
      return `<span class="bluman-smart-chip" title="Smart Tag ERP: {{${tagCode}}}" style="background: rgba(99, 102, 241, 0.14); color: #4338ca; border: 1px solid rgba(99, 102, 241, 0.35); border-bottom: 2px solid #4f46e5; border-radius: 4px; padding: 1px 6px; font-weight: 600; cursor: help; display: inline-block; box-shadow: 0 1px 3px rgba(99,102,241,0.12);">${valoreSicuro}</span>`;
    };

    let out = htmlSicuro;

    // Se sono state iniettate microvoci specifiche dal compositore fatture, sostituisci la riga di esempio
    if (customRowsHtml) {
      out = out.replace(/<tr style="border-bottom: 1px solid #e2e8f0;">\s*<td style="padding: 10px 8px;">Onorari professionali per dossier <strong>\{\{progetto\.titolo\}\}<\/strong><\/td>\s*<td style="padding: 10px 8px; text-align: right; font-weight: 600;">\{\{progetto\.importo_totale\}\}<\/td>\s*<\/tr>/, customRowsHtml);
    }

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
    out = out.replace(/\{\{progetto\.importo_totale\}\}/g, wrapTag(effImporto ? `€ ${Number(effImporto).toLocaleString('it-IT')},00` : '€ 0,00', 'progetto.importo_totale'));

    out = out.replace(/\{\{studio\.ragione_sociale\}\}/g, wrapTag(studioRagioneSociale, 'studio.ragione_sociale'));
    out = out.replace(/\{\{studio\.piva\}\}/g, wrapTag(studioPiva, 'studio.piva'));
    out = out.replace(/\{\{studio\.sede_legale\}\}/g, wrapTag(studioSede, 'studio.sede_legale'));
    out = out.replace(/\{\{studio\.iban\}\}/g, wrapTag(studioIban, 'studio.iban'));
    out = out.replace(/\{\{studio\.lead_advisor\}\}/g, wrapTag(studioLeadAdvisor, 'studio.lead_advisor'));
    out = out.replace(/\{\{studio\.telefono\}\}/g, wrapTag(studioTel, 'studio.telefono'));
    out = out.replace(/\{\{studio\.email\}\}/g, wrapTag(studioEmail, 'studio.email'));

    return sanitizzaHtmlDocumento(out);
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
    // Piano firma §3 — il documento eredita il livello legale richiesto dal template.
    setLivelloFirmaDoc(tmpl.livelloFirmaRichiesto ?? 'ses');
    // §39 — un modello nato da un documento può portarsi dietro intestazione e piede propri: si
    // adottano insieme al testo, invece di essere scambiati per corpo e stampati due volte.
    const parti = scomponiDocumento(sanitizzaHtmlDocumento(tmpl.contenutoHtml));
    setIntestazionePropria(sanitizzaHtmlDocumento(parti.intestazione));
    setPiedeProprio(sanitizzaHtmlDocumento(parti.piede));
    rawTemplateRef.current = sanitizzaHtmlDocumento(parti.corpo);
    modelloCaricatoRef.current = tmpl.id;
    if (editorRef.current) {
      editorRef.current.innerHTML = renderResolvedContent(parti.corpo);
    }
  };

  /**
   * §41 — Carica il modello chiesto nell'indirizzo appena la cartella dello studio arriva.
   *
   * Serve perché i modelli dello studio stanno a database: al primo render l'elenco contiene solo
   * la dotazione di serie, quindi entrando con `?tmplId=<id di una carta dello studio>` la pagina
   * mostrava il testo di un altro modello mentre la barra laterale segnava selezionato quello
   * giusto — si apriva «Lettera d'incarico» e si leggeva un altro contratto.
   *
   * Si applica una volta sola e solo se sotto le mani c'è ancora un modello diverso: se l'operatore
   * ha già scelto o modificato qualcosa, la sua scelta non viene sovrascritta.
   */
  useEffect(() => {
    if (queryDocId) return; // si sta aprendo un documento salvato, non un modello
    if (modelloDaUrlApplicato.current) return;
    if (!cartella.letto) return;
    if (modelloCaricatoRef.current === queryTmplId) {
      modelloDaUrlApplicato.current = true;
      return;
    }
    const chiesto = templatesList.find((t) => t.id === queryTmplId);
    if (!chiesto) return;
    modelloDaUrlApplicato.current = true;
    handleSelectTemplate(chiesto);
  }, [cartella.letto, templatesList, queryTmplId, queryDocId]);

  // Creazione Nuovo Modello Master da Zero
  const handleCreateCustomMaster = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newTmplTitolo.trim()) return;

    // §41 — nessun id inventato dal browser: l'id è quello della riga che risponde il server.
    // Prima era `tmpl-custom-${Date.now()}`, che la POST non mandava e il database non
    // conosceva: le due carte avevano id diversi e archiviarle o eliminarle sul server non
    // poteva funzionare per costruzione.
    const bozza = {
      titolo: newTmplTitolo.trim(),
      categoria: newTmplCat,
      // Piano firma §3 — livello scelto dall'operatore nel modale di creazione.
      livelloFirmaRichiesto: newTmplLivello,
      descrizione: newTmplDesc.trim() || 'Modello master personalizzato salvato nello studio.',
      contenutoHtml: `
<h1 style="text-align: center; color: #1e1b4b; margin-bottom: 20px; font-size: 19px; text-transform: uppercase;">
  ${escapeHtmlTesto(newTmplTitolo.toUpperCase())}
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

    // §41 — prima il server, poi l'elenco. Il modello compare in libreria solo se la riga
    // esiste: prima veniva scritto in `localStorage` e mostrato anche quando la POST era
    // fallita, con l'avviso «salvato in LOCALE» accanto a una carta che nessun altro vedeva.
    const esito = await cartella.crea(bozza);
    if (esito.ok && esito.modello) {
      handleSelectTemplate(esito.modello);
      setShowNewTmplModal(false);
      setNewTmplTitolo('');
      setNewTmplDesc('');
      // Piano firma §3 — il modale riparte sempre dal default legale.
      setNewTmplLivello('ses');
      setFeedback(`✓ ${esito.messaggio}`);
    } else {
      setFeedback(`⚠️ ${esito.messaggio}`);
    }
    setTimeout(() => setFeedback(null), 4000);
  };

  // Salva l'attuale bozza dell'editor come Nuovo Modello Master
  const handleSaveCurrentAsMasterTemplate = async () => {
    // §39 — il modello si porta dietro anche l'intestazione e il piede propri, se ci sono: sono
    // parte dell'atto quanto il testo.
    const currentHtml = sanitizzaHtmlDocumento(componiDocumento({
      intestazione: intestazionePropria,
      corpo: sanitizzaHtmlDocumento(editorRef.current?.innerHTML || rawTemplateRef.current),
      piede: piedeProprio,
    }));
    const name = prompt('Inserisci il nome per questo nuovo Modello Master Studio:', `${titoloDocumento} (Copia Master)`);
    if (!name || !name.trim()) return;

    const esito = await cartella.crea({
      titolo: name.trim(),
      categoria: (categoria as any) || 'societario',
      // Piano firma §3 — il master eredita il livello legale del documento corrente.
      livelloFirmaRichiesto: livelloFirmaDoc,
      descrizione: `Modello master derivato da "${titoloDocumento}" salvato in data ${new Date().toLocaleDateString('it-IT')}.`,
      contenutoHtml: currentHtml,
    });
    if (esito.ok && esito.modello) handleSelectTemplate(esito.modello);
    setFeedback(`${esito.ok ? '✓' : '⚠️'} ${esito.messaggio}`);
    setTimeout(() => setFeedback(null), 4000);
  };

  // Importazione da File (.json / .html / .pdf)
  const handleImportFileTrigger = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    if (file.name.toLowerCase().endsWith('.pdf')) {
      setFeedback('Import PDF come modello disabilitato: carica il PDF nel fascicolo, senza incorporarlo nell’HTML.');
      setTimeout(() => setFeedback(null), 5000);
      e.target.value = '';
      return;
    }

    const reader = new FileReader();
    reader.onload = async (event) => {
      const content = event.target?.result as string;
      if (file.name.endsWith('.json')) {
        // §41 — l'import passa dal server modello per modello: il conteggio dice quanti sono
        // arrivati nell'archivio dello studio, non quanti erano nel file.
        const esito = await cartella.importaDaJson(content);
        setFeedback(`${esito.ok ? '✓' : '⚠️'} ${esito.messaggio}`);
      } else {
        const tmplName = file.name.replace(/\.[^/.]+$/, "");
        const esito = await cartella.crea({
          titolo: tmplName,
          categoria: 'societario',
          // Piano firma §3 — nessuna scelta utente sull'import: default legale esplicito.
          livelloFirmaRichiesto: 'ses',
          descrizione: `Modello importato da file "${file.name}".`,
          contenutoHtml: sanitizzaHtmlDocumento(content),
        });
        if (esito.ok && esito.modello) handleSelectTemplate(esito.modello);
        setFeedback(`${esito.ok ? '✓' : '⚠️'} ${esito.messaggio}`);
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

  // Archiviazione Modello Master — §41: a database, quindi vale per tutto lo studio.
  const handleArchiveTemplate = async (tmplId: string, tmplTitolo: string, e: React.MouseEvent) => {
    e.stopPropagation();
    const tmpl = templatesList.find((t) => t.id === tmplId);
    if (!tmpl) {
      setFeedback(`⚠️ Il modello "${tmplTitolo}" non è più in elenco: ricarica la cartella modelli.`);
      setTimeout(() => setFeedback(null), 4000);
      return;
    }
    const esito = await cartella.archivia(tmpl, true);
    setFeedback(`${esito.ok ? '📦' : '⚠️'} ${esito.messaggio}`);
    setTimeout(() => setFeedback(null), 4000);
  };

  // Ripristino Modello Master
  const handleRestoreTemplate = async (tmplId: string, tmplTitolo: string, e: React.MouseEvent) => {
    e.stopPropagation();
    const tmpl = templatesList.find((t) => t.id === tmplId);
    if (!tmpl) {
      setFeedback(`⚠️ Il modello "${tmplTitolo}" non è più in elenco: ricarica la cartella modelli.`);
      setTimeout(() => setFeedback(null), 4000);
      return;
    }
    const esito = await cartella.archivia(tmpl, false);
    setFeedback(`${esito.ok ? '♻️' : '⚠️'} ${esito.messaggio}`);
    setTimeout(() => setFeedback(null), 4000);
  };

  // Eliminazione Modello Master
  const handleDeleteTemplate = async (tmplId: string, tmplTitolo: string, e: React.MouseEvent) => {
    e.stopPropagation();
    const tmpl = templatesList.find((t) => t.id === tmplId);
    if (!tmpl) return;
    if (!(await confirm({ titolo: `Eliminare definitivamente il Modello Master "${tmplTitolo}"?`, messaggio: 'I documenti già salvati o firmati nei progetti rimangono perfettamente congelati e integri.', confermaLabel: 'Elimina', pericolo: true }))) return;
    // §3.3 / §41 — prima il server, poi lo stato locale: il modello sparisce dall'elenco solo
    // se il server ha confermato l'eliminazione.
    const esito = await cartella.elimina(tmpl);
    if (esito.ok && selectedTemplateId === tmplId) {
      const restanti = cartella.modelli.filter((t) => t.id !== tmplId);
      const primoAttivo = restanti.find((t) => !t.archiviato) || restanti[0];
      if (primoAttivo) handleSelectTemplate(primoAttivo);
    }
    setFeedback(`${esito.ok ? '🗑️' : '⚠️'} ${esito.messaggio}`);
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
      const currentHtml = sanitizzaHtmlDocumento(editorRef.current?.innerHTML || rawTemplateRef.current);
      // Risolvi in modalità Stampa/PDF (senza smart chips, 100% testo pulito)
      const finalHtml = renderResolvedContent(currentHtml, true);

      // §39 — intestazione e piede sono quelli che si vedono nel foglio, non due HTML ricostruiti
      // qui: se l'operatore li ha modificati, il PDF esce con le sue modifiche. L'intestazione entra
      // nel flusso (compare sul primo foglio, come sulla carta intestata), il piede viene ristampato
      // in fondo a ogni foglio dall'impaginatore, con il numero di pagina.
      const fullPrintHtml = sanitizzaHtmlDocumento(`
        <div style="font-family: 'Segoe UI', Helvetica, Arial, sans-serif; color: #0f172a; line-height: 1.6; font-size: 11.5pt; width: 100%;">
          ${intestazioneEffettiva}
          <div>${finalHtml}</div>
        </div>
      `);

      const safeFileName = `${titoloDocumento.replace(/[^a-zA-Z0-9_-]/g, '_')}_${new Date().toISOString().slice(0, 10)}.pdf`;
      await downloadRealPdf(safeFileName, fullPrintHtml, [], {
        piede: (pagina, totale) => sanitizzaHtmlDocumento(`
          <div style="width: 100%;">
            ${piedeEffettivo}
            <div style="text-align: right; font-size: 8pt; color: #94a3b8; margin-top: 3px;">Pagina ${Number(pagina)} di ${Number(totale)}</div>
          </div>
        `),
      });
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
      const currentHtml = sanitizzaHtmlDocumento(editorRef.current?.innerHTML || rawTemplateRef.current);
      const finalHtml = renderResolvedContent(currentHtml, true);

      // §39 — le stesse due fasce del foglio e del PDF. Word non ha un impaginatore nostro, quindi
      // il piede compare una volta in fondo: è il comportamento di sempre per il .doc.
      const fullPrintHtml = sanitizzaHtmlDocumento(`
        <div style="font-family: 'Calibri', 'Segoe UI', Arial, sans-serif; color: #0f172a; line-height: 1.6; font-size: 11pt;">
          ${intestazioneEffettiva}
          <div>${finalHtml}</div>
          <div style="margin-top: 40px;">${piedeEffettivo}</div>
        </div>
      `);

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
      const currentHtml = sanitizzaHtmlDocumento(editorRef.current?.innerHTML || rawTemplateRef.current);
      /**
       * §39 — Si archivia il foglio intero: intestazione, corpo e piede, marcati dentro l'HTML.
       *
       * Qui si salvano le fasce EFFETTIVE, non solo quelle modificate a mano: il file archiviato è
       * quello che il cliente riceve, e deve essere completo di carta intestata da solo. Salvarle
       * congela anche la carta intestata al momento dell'atto — se lo studio cambia sede domani, un
       * atto del 2026 non deve cambiare intestazione. (Il «Salva come Modello» fa il contrario, e di
       * proposito: un modello deve adattarsi allo studio che lo usa.)
       */
      const htmlContent = sanitizzaHtmlDocumento(componiDocumento({
        intestazione: intestazioneEffettiva,
        corpo: renderResolvedContent(currentHtml),
        piede: piedeEffettivo,
      }));
      const safeTitle = titoloDocumento.replace(/[^a-zA-Z0-9_-]/g, '_');
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
        // Piano firma §3 — livello legale (ses|fea|feq) che questo atto esige,
        // ereditato dal template di partenza e modificabile nella strip dedicata.
        livelloFirmaRichiesto: livelloFirmaDoc,
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
          // Piano firma §3 — l'etichetta viaggia con il documento: è quella che il
          // server userà per applicare l'enforcement (409) sulle rotte di firma.
          livelloFirmaRichiesto: livelloFirmaDoc,
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
      <HeaderEditor
        navigate={navigate}
        tagDisplayMode={tagDisplayMode}
        setTagDisplayMode={setTagDisplayMode}
        handleExportPdf={handleExportPdf}
        handleExportWord={handleExportWord}
        handleDeleteTemplate={handleDeleteTemplate}
        selectedTemplateId={selectedTemplateId}
        titoloDocumento={titoloDocumento}
        handleSaveToVault={handleSaveToVault}
        salvando={salvando}
        feedback={feedback}
      />

      <SelettoreDestinazione
        clienti={clienti}
        selectedClienteId={selectedClienteId}
        setSelectedClienteId={setSelectedClienteId}
        progetti={progetti}
        selectedProgettoId={selectedProgettoId}
        setSelectedProgettoId={setSelectedProgettoId}
        microvoci={microvoci}
        selectedMicrovoceId={selectedMicrovoceId}
        setSelectedMicrovoceId={setSelectedMicrovoceId}
        effProgettoId={effProgettoId}
        caricandoMicrovoci={caricandoMicrovoci}
        activeProgetto={activeProgetto}
      />

      {/* Piano firma §3.3 — livello legale richiesto all'atto che l'operatore sta
          componendo. Ereditato dal template di partenza, resta modificabile finché
          il documento non è firmato (PATCH /documenti/:id/livello-firma). */}
      <div style={{ background: 'var(--card)', border: '1px solid var(--border)', borderRadius: 14, padding: '14px 18px' }}>
        <label style={{ fontSize: 11.5, fontWeight: 700, color: 'var(--text)', display: 'block', marginBottom: 8 }}>
          ⚖️ Livello Legale Richiesto all'Atto — "{titoloDocumento}"
        </label>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 8 }}>
          {([
            {
              id: 'ses' as const,
              icon: '📱',
              titolo: 'SES — Semplice',
              desc: 'Firma elettronica semplice (art. 20 CAD / eIDAS art. 3 n. 10). Il flusso OTP attuale.',
            },
            {
              id: 'fea' as const,
              icon: '🧠',
              titolo: 'FEA — Avanzata',
              desc: 'Firma elettronica avanzata (eIDAS art. 26): il cliente firma dal Portale con flusso certificato — OTP verificato, firma grafica obbligatoria e firmatario verificato in anagrafica.',
            },
            {
              id: 'feq' as const,
              icon: '🔐',
              titolo: 'FEQ — Qualificata',
              desc: 'Firma elettronica qualificata (eIDAS art. 25): solo tramite provider esterno del cliente (file .p7m).',
            },
          ]).map((l) => (
            <button
              key={l.id}
              type="button"
              onClick={() => setLivelloFirmaDoc(l.id)}
              style={{
                background: livelloFirmaDoc === l.id ? 'var(--pill-indigo-bg)' : 'var(--card)',
                border: `1.5px solid ${livelloFirmaDoc === l.id ? 'var(--indigo)' : 'var(--border)'}`,
                borderRadius: 10, padding: '9px 10px', textAlign: 'left', cursor: 'pointer',
                display: 'flex', flexDirection: 'column', gap: 3
              }}
            >
              <div style={{ fontSize: 11, fontWeight: 700, color: livelloFirmaDoc === l.id ? 'var(--pill-indigo-fg)' : 'var(--text)', display: 'flex', alignItems: 'center', gap: 5 }}>
                <span>{l.icon}</span> {l.titolo}
              </div>
              <div style={{ fontSize: 9.5, color: 'var(--muted)', lineHeight: 1.3 }}>{l.desc}</div>
            </button>
          ))}
        </div>
        {livelloFirmaDoc === 'fea' && (
          <div style={{ marginTop: 8, padding: '8px 10px', borderRadius: 8, background: '#6366f118', border: '1px solid #6366f150', fontSize: 10, color: 'var(--text)', lineHeight: 1.4 }}>
            ℹ️ Con livello <strong>FEA (Avanzata)</strong> il cliente firmerà dal Portale con il flusso certificato completo: verifica OTP, firma grafica obbligatoria, firmatario verificato in anagrafica e documento d'identità (eIDAS art. 26 · art. 25 CAD).
          </div>
        )}
        {livelloFirmaDoc === 'feq' && (
          <div style={{ marginTop: 8, padding: '8px 10px', borderRadius: 8, background: '#f59e0b18', border: '1px solid #f59e0b50', fontSize: 10, color: 'var(--muted)', lineHeight: 1.4 }}>
            ⚠️ Con livello <strong>FEQ (Qualificata)</strong> il server blocca il flusso OTP: il cliente dovrà firmare con il proprio provider di firma digitale qualificata (es. Aruba, InfoCert, Namirial, SPID/CIE) e caricare il file firmato.
          </div>
        )}
      </div>

      {/* Main Studio Grid */}
      <div style={{ display: 'grid', gridTemplateColumns: '290px 1fr', gap: 20, alignItems: 'start' }}>
        
        {/* Left Column: Smart Tags & Templates */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
          <PannelloTag insertSmartTag={insertSmartTag} />

            <LibreriaTemplate
              templatesList={templatesList}
              setShowNewTmplModal={setShowNewTmplModal}
              fileImportRef={fileImportRef}
              handleExportTemplatesJson={handleExportTemplatesJson}
              handleImportFileTrigger={handleImportFileTrigger}
              handleSaveCurrentAsMasterTemplate={handleSaveCurrentAsMasterTemplate}
              searchMasterTmplQuery={searchMasterTmplQuery}
              setSearchMasterTmplQuery={setSearchMasterTmplQuery}
              tmplStatusSidebar={tmplStatusSidebar}
              setTmplStatusSidebar={setTmplStatusSidebar}
              selectedTemplateId={selectedTemplateId}
              handleSelectTemplate={handleSelectTemplate}
              handleRestoreTemplate={handleRestoreTemplate}
              handleArchiveTemplate={handleArchiveTemplate}
              handleDeleteTemplate={handleDeleteTemplate}
              erroreLettura={cartella.erroreLettura}
              onApriCartella={() => navigate('/modelli')}
            />
        </div>

        <EditorCanvas
          executeFormat={executeFormat}
          editorRef={editorRef}
          rawTemplateRef={rawTemplateRef}
          intestazioneHtml={intestazioneEffettiva}
          setIntestazioneHtml={setIntestazionePropria}
          piedeHtml={piedeEffettivo}
          setPiedeHtml={setPiedeProprio}
        />
      </div>

      {/* ➕ MODALE CREAZIONE NUOVO MODELLO MASTER STUDIO */}
      {showNewTmplModal && (
        <ModaleNuovoTemplate
          setShowNewTmplModal={setShowNewTmplModal}
          handleCreateCustomMaster={handleCreateCustomMaster}
          newTmplTitolo={newTmplTitolo}
          setNewTmplTitolo={setNewTmplTitolo}
          newTmplCat={newTmplCat}
          setNewTmplCat={setNewTmplCat}
          newTmplLivello={newTmplLivello}
          setNewTmplLivello={setNewTmplLivello}
          newTmplDesc={newTmplDesc}
          setNewTmplDesc={setNewTmplDesc}
        />
      )}
    </div>
  );
}
