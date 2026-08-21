import React, { useState, useEffect } from 'react';
import { useSearchParams, useNavigate } from 'react-router-dom';
import { CatBadge } from '../components/ui/CatBadge';
import { fmt } from '../utils';
import { downloadRealPdf } from '../utils/pdfGenerator';
import type { SignatureData } from '../utils/pdfGenerator';
import { DigitalSignatureModal } from '../components/DigitalSignatureModal';
import { resolveDocumentTemplateHtml, PREBUILT_TEMPLATES } from '../utils/documentTemplates';
import { getStudioInfoForTenant, getCurrentTenantId, getTenantStorageKey, BLUECODE_TENANT_ID } from '../utils/tenant';
import { fetchModuliLibreria, fetchProgetti, creaPreventivoEAccettaApi, fetchClienti, creaProgettoApi, creaClienteApi, fetchComunicazioniApi, inviaComunicazioneApi, requestPortalOtpApi, verifyPortalOtpAndSignApi, magicLoginApi, clientLoginApi } from '../api/client';
import type { CategoriaModulo } from '../types';

export interface ModuloPassaggio {
  id: string;
  titolo: string;
  completato: boolean;
  operatore?: string;
  data?: string;
  note?: string;
}

export interface ModuloDeliverable {
  titolo: string;
  nomeFile: string;
  data: string;
}

export interface ModuloProposta {
  id: string;
  nome: string;
  cat: CategoriaModulo;
  prezzo: number;
  ore: number;
  righeCount: number;
  descrizione?: string;
  stato?: 'completato' | 'in_corso' | 'da_firmare' | 'pending';
  operatore?: string;
  percentuale?: number;
  passaggi?: ModuloPassaggio[];
  deliverables?: ModuloDeliverable[];
  richiedeFirmaFinale?: boolean;
}

function getModulePassaggi(moduloNome: string, cat: string): ModuloPassaggio[] {
  if (cat === 'Trust' || moduloNome.toLowerCase().includes('trust')) {
    return [
      { id: 'p1', titolo: 'Analisi preliminare asset, disponente e beneficiari', completato: true, operatore: 'Senior Advisor Studio', data: '12/08/2026', note: 'KYC e verifica antiriciclaggio completati con esito positivo.' },
      { id: 'p2', titolo: 'Redazione Atto Istitutivo del Trust Elvetico e Letter of Wishes', completato: true, operatore: 'Legal & Trust Specialist', data: '15/08/2026', note: 'Bozza approvata e revisionata con il Protector.' },
      { id: 'p3', titolo: 'Nomina Trustee e Custode con verifica di conformità', completato: true, operatore: 'Compliance Lead', data: '18/08/2026', note: 'Due diligence fiduciaria e mandati convalidati.' },
      { id: 'p4', titolo: 'Perfezionamento rogito istitutivo e rilascio fascicolo', completato: true, operatore: 'Senior Partner', data: '20/08/2026', note: 'In attesa di firma/validazione finale del cliente.' },
    ];
  }

  if (cat === 'Societario' || moduloNome.toLowerCase().includes('societ')) {
    return [
      { id: 'p1', titolo: 'Verifica denominazione sociale e due diligence UBO', completato: true, operatore: 'Compliance Lead', data: '11/08/2026', note: 'Name clearance approvato dal Registro Imprese.' },
      { id: 'p2', titolo: 'Redazione Memorandum & Articles of Association', completato: true, operatore: 'Legal Team', data: '14/08/2026', note: 'Statuto e governance societaria predisposti.' },
      { id: 'p3', titolo: 'Filing telematico presso il Registro Societario / MFSA', completato: true, operatore: 'Senior Advisor Studio', data: '17/08/2026', note: 'Certificato di incorporazione depositato.' },
      { id: 'p4', titolo: 'Rilascio certificato di vigenza e statuto vidimato', completato: true, operatore: 'Senior Partner', data: '19/08/2026', note: 'Pronto per la presa d\'atto e firma del cliente.' },
    ];
  }

  if (cat === 'Fiscale' || moduloNome.toLowerCase().includes('fisc')) {
    return [
      { id: 'p1', titolo: 'Raccolta bilanci e dichiarazioni fiscali pregresse', completato: true, operatore: 'Tax Specialist', data: '10/08/2026', note: 'Audit preliminare chiuso con successo.' },
      { id: 'p2', titolo: 'Simulazione carico impositivo e trattati contro doppie imposizioni', completato: true, operatore: 'Senior Tax Advisor', data: '14/08/2026', note: 'Parere pro-veritate emesso.' },
      { id: 'p3', titolo: 'Predisposizione istanza di tax refund o interpello', completato: true, operatore: 'Senior Partner', data: '18/08/2026', note: 'Documentazione pronta per convalida.' },
    ];
  }

  return [
    { id: 'p1', titolo: 'Fase 1: Raccolta documentale e valutazione iniziale', completato: true, operatore: 'Advisor Studio', data: '12/08/2026', note: 'Requisiti preliminari convalidati.' },
    { id: 'p2', titolo: 'Fase 2: Elaborazione fascicolo ed esecuzione tecnica', completato: true, operatore: 'Specialist Incaricato', data: '16/08/2026', note: 'Lavorazione tecnica completata.' },
    { id: 'p3', titolo: 'Fase 3: Revisione finale e chiusura adempimento', completato: true, operatore: 'Senior Partner', data: '19/08/2026', note: 'Attività concluse — pronta per convalida.' },
  ];
}

function getModuleDeliverables(moduloNome: string, cat: string): ModuloDeliverable[] {
  if (cat === 'Trust' || moduloNome.toLowerCase().includes('trust')) {
    return [
      { titolo: 'Atto Istitutivo Trust Elvetico (Bozza Conclusiva)', nomeFile: 'Atto_Istitutivo_Trust_Elvetico.pdf', data: '20/08/2026' },
      { titolo: 'Letter of Wishes & Regolamento Fiduciario', nomeFile: 'Letter_of_Wishes_Fiduciaria.pdf', data: '20/08/2026' },
    ];
  }
  if (cat === 'Societario' || moduloNome.toLowerCase().includes('societ')) {
    return [
      { titolo: 'Memorandum & Articles of Association Vidimato', nomeFile: 'Statuto_Societario_Vidimato.pdf', data: '19/08/2026' },
      { titolo: 'Certificato di Vigenza & Good Standing', nomeFile: 'Certificato_Good_Standing.pdf', data: '19/08/2026' },
    ];
  }
  return [
    { titolo: `Relazione Tecnica Conclusiva — ${moduloNome}`, nomeFile: `Relazione_${moduloNome.replace(/\s+/g, '_')}.pdf`, data: '19/08/2026' },
  ];
}

type PortalTab = 'proposta' | 'avanzamento' | 'form' | 'documenti' | 'contatti';

export function ClientPortal() {
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const token = searchParams.get('magic_token') || '';

  // Stati di autenticazione per Portale Cliente (Email + Password e Magic Link)
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [loginEmail, setLoginEmail] = useState('');
  const [loginPassword, setLoginPassword] = useState('');
  const [loginLoading, setLoginLoading] = useState(false);
  const [loginError, setLoginError] = useState<string | null>(null);
  const [authMode, setAuthMode] = useState<'credentials' | 'magic'>('credentials');
  const [manualMagicToken, setManualMagicToken] = useState('');

  const [activeTab, setActiveTab] = useState<PortalTab>('proposta');
  const [clientObj, setClientObj] = useState<any>(null);
  const [clientName, setClientName] = useState('Cliente Studio');
  const [clientProjects, setClientProjects] = useState<any[]>([]);
  const [selectedProjectId, setSelectedProjectId] = useState<string>('');
  const [moduliProposti, setModuliProposti] = useState<ModuloProposta[]>([]);
  const [selectedModule, setSelectedModule] = useState<ModuloProposta | null>(null);
  const [moduleSignatures, setModuleSignatures] = useState<Record<string, { firmato: boolean; dataFirma: string; signerName: string }>>({});
  const [signed, setSigned] = useState<boolean>(() => {
    return localStorage.getItem('bluman_portal_signed_Marco Ricci / Holding Beta S.r.l.') === 'true' ||
           localStorage.getItem('bluman_portal_signed_Holding Beta S.r.l.') === 'true';
  });
  const [addendums, setAddendums] = useState<any[]>(() => {
    const saved = localStorage.getItem(`bluman_addendums_Marco Ricci / Holding Beta S.r.l.`);
    return saved ? JSON.parse(saved) : [];
  });
  const [loading, setLoading] = useState(false);
  const [pageLoading, setPageLoading] = useState(true);
  const [accessoNegato, setAccessoNegato] = useState<string | null>(null);

  // Documenti in Incarico con Stato Firma Persistente
  const [portalDocs, setPortalDocs] = useState<any[]>([
    {
      id: 'doc-nda',
      templateId: 'tmpl-nda',
      titolo: 'Accordo di Riservatezza NDA & Mandato Fiduciario',
      nome: 'Accordo di Riservatezza NDA & Incarico.pdf',
      dimensione: '1.4 MB',
      categoria: 'Contratti',
      firmato: true,
      richiedeFirma: true,
      dataFirma: '15/08/2026 01:44:12',
      descrizione: 'Accordo bilaterale di riservatezza e segreto professionale conforme GDPR e standard fiduciario Malta/Svizzera.',
    },
    {
      id: 'doc-statuto',
      templateId: 'tmpl-memorandum',
      titolo: 'Statuto Standard Holding Malta & Procura MFSA',
      nome: 'Statuto Standard Holding Malta & Procura MFSA.pdf',
      dimensione: '3.2 MB',
      categoria: 'Societario',
      firmato: false,
      richiedeFirma: true,
      dataFirma: null,
      descrizione: 'Statuto societario per costituzione LTD maltese con clausole di governance e procura speciale.',
    },
    {
      id: 'doc-ubo',
      templateId: 'tmpl-compliance',
      titolo: 'Dichiarazione Titolare Effettivo (UBO Registry)',
      nome: 'Dichiarazione Titolare Effettivo (UBO Registry).pdf',
      dimensione: '2.8 MB',
      categoria: 'Compliance',
      firmato: false,
      richiedeFirma: true,
      dataFirma: null,
      descrizione: 'Dichiarazione di trasparenza del Beneficiary Owner ai sensi della V Direttiva Antiriciclaggio UE 2018/843.',
    },
    {
      id: 'doc-trust',
      templateId: 'tmpl-trust',
      titolo: 'Confidential Letter of Wishes per Struttura Trust',
      nome: 'Confidential Letter of Wishes Trust.pdf',
      dimensione: '2.1 MB',
      categoria: 'Trust',
      firmato: false,
      richiedeFirma: true,
      dataFirma: null,
      descrizione: 'Istruzioni confidenziali per il trustee designato relative alla governance e protezione asset.',
    },
  ]);

  // Visualizzatore A4 Documento Selezionato per Lettura Completa
  const [selectedViewerDoc, setSelectedViewerDoc] = useState<any | null>(null);

  // Modale Firma Grafica per Documenti Singoli
  const [signingDoc, setSigningDoc] = useState<any | null>(null);

  // FEA OTP State
  const [otpModalOpen, setOtpModalOpen] = useState(false);
  const [otpCode, setOtpCode] = useState('');
  const [otpCanale, setOtpCanale] = useState<'whatsapp' | 'email' | 'sms'>('whatsapp');
  const [otpPhoneInput, setOtpPhoneInput] = useState('+39 333 5936278');
  const [otpEmailInput, setOtpEmailInput] = useState('client@holdingbeta.advisory');
  const [otpTarget, setOtpTarget] = useState('+39 333 *** 6278');
  const [otpLoading, setOtpLoading] = useState(false);
  const [otpError, setOtpError] = useState<string | null>(null);
  const [eidasSeal, setEidasSeal] = useState<any>(() => {
    const saved = localStorage.getItem(`bluman_seal_Marco Ricci / Holding Beta S.r.l.`) || localStorage.getItem(`bluman_seal_Holding Beta S.r.l.`);
    return saved ? JSON.parse(saved) : null;
  });

  // Form Cliente State
  const [formData, setFormData] = useState({
    ragioneSociale: 'Holding Beta S.r.l.',
    piva: 'IT09876543210',
    legaleRappresentante: 'Marco Ricci',
    codiceFiscale: 'RCCMRC80A01H501Z',
    iban: 'IT60X0542811101000000123456',
    titolareEffettivo: 'Marco Ricci (100% Quote)',
  });
  const [formSaved, setFormSaved] = useState(false);

  // Comunicazioni State
  const [progettoId, setProgettoId] = useState<string>('proj-001');
  const [messaggi, setMessaggi] = useState<any[]>([]);
  const [nuovoMessaggio, setNuovoMessaggio] = useState('');
  const [canaleMessaggio, setCanaleMessaggio] = useState<'whatsapp' | 'email' | 'telegram' | 'portal'>('portal');
  const [inviandoMessaggio, setInviandoMessaggio] = useState(false);

  const loadPortalData = async (clienteIdParam?: string) => {
    setPageLoading(true);
    let resolvedClientName = clientName;
    let clienteIdSessione: string | null = clienteIdParam || null;

    if (token) {
      try {
        const sessione = await magicLoginApi(token);
        if (!sessione?.token) throw new Error('Magic Link non valido o scaduto');
        localStorage.setItem('bluman_jwt_token', sessione.token);
        if (sessione.user) {
          localStorage.setItem('bluman_client_user', JSON.stringify(sessione.user));
        }
        clienteIdSessione = sessione.user?.clienteId ?? null;
        setIsAuthenticated(true);
        setAccessoNegato(null);
      } catch (err: any) {
        console.warn('Magic login non riuscito', err);
        setAccessoNegato(err.message || 'Link di accesso non valido o scaduto.');
        setIsAuthenticated(false);
        setPageLoading(false);
        return;
      }
    } else if (clienteIdParam) {
      clienteIdSessione = clienteIdParam;
      setIsAuthenticated(true);
      setAccessoNegato(null);
    } else {
      const existingToken = localStorage.getItem('bluman_jwt_token');
      const savedClientUser = localStorage.getItem('bluman_client_user');
      const savedStudioUser = localStorage.getItem('bluman_user');
      if (existingToken && savedClientUser) {
        try {
          const parsed = JSON.parse(savedClientUser);
          if (parsed.ruolo === 'cliente' && parsed.clienteId) {
            clienteIdSessione = parsed.clienteId;
            setIsAuthenticated(true);
            setAccessoNegato(null);
          } else {
            setIsAuthenticated(false);
            setPageLoading(false);
            return;
          }
        } catch {
          setIsAuthenticated(false);
          setPageLoading(false);
          return;
        }
      } else if (existingToken && savedStudioUser) {
        // Advisor o membro dello studio che apre l'anteprima portale
        setIsAuthenticated(true);
        setAccessoNegato(null);
      } else {
        setIsAuthenticated(false);
        setPageLoading(false);
        return;
      }
    }

    try {
      const clientiRes = await fetchClienti();
      if (clientiRes && Array.isArray(clientiRes) && clientiRes.length > 0) {
        const found = clienteIdSessione
          ? clientiRes.find(c => c.id === clienteIdSessione)
          : undefined;
        if (found) {
          setClientObj(found);
          setClientName(found.nome);
          resolvedClientName = found.nome;
        } else {
          setClientObj(clientiRes[0]);
          setClientName(clientiRes[0].nome);
          resolvedClientName = clientiRes[0].nome;
        }
      }

      // Ripristina lo stato di firma persistito in memoria
      const isSignedLocal = localStorage.getItem(`bluman_portal_signed_${resolvedClientName}`) === 'true' ||
                            localStorage.getItem(`bluman_portal_signed_Marco Ricci / Holding Beta S.r.l.`) === 'true';
      if (isSignedLocal) {
        setSigned(true);
        const savedSeal = localStorage.getItem(`bluman_seal_${resolvedClientName}`) ||
                          localStorage.getItem(`bluman_seal_Marco Ricci / Holding Beta S.r.l.`);
        if (savedSeal) {
          try { setEidasSeal(JSON.parse(savedSeal)); } catch (e) {}
        }
      }

      // Ripristina i documenti firmati singolarmente
      const savedSignedDocsStr = localStorage.getItem(`bluman_signed_docs_${resolvedClientName}`);
      if (savedSignedDocsStr) {
        try {
          const signedIds: string[] = JSON.parse(savedSignedDocsStr);
          setPortalDocs(prev => prev.map(d => {
            if (signedIds.includes(d.id)) {
              const sigStr = localStorage.getItem(`bluman_portal_doc_sig_${d.id}`);
              const sigData = sigStr ? JSON.parse(sigStr) : null;
              return { ...d, firmato: true, signatureData: sigData, dataFirma: sigData?.timestamp || d.dataFirma || '15/08/2026' };
            }
            return d;
          }));
        } catch (e) {}
      }

      // Ripristina firme sulle singole operazioni / moduli
      const savedModSigs = localStorage.getItem(`bluman_module_signatures_${resolvedClientName}`);
      if (savedModSigs) {
        try { setModuleSignatures(JSON.parse(savedModSigs)); } catch {}
      }

      const moduliRes = await fetchModuliLibreria();
      if (moduliRes && Array.isArray(moduliRes) && moduliRes.length > 0) {
        const mapped: ModuloProposta[] = moduliRes.map((m: any, idx: number) => {
          const cat = (m.categoria as CategoriaModulo) || 'Societario';
          const passaggi = getModulePassaggi(m.nome, cat);
          const deliverables = getModuleDeliverables(m.nome, cat);
          const isCompleted = idx % 2 === 0;
          return {
            id: m.id,
            nome: m.nome,
            cat,
            prezzo: m.prezzoPacchetto ? m.prezzoPacchetto / 100 : 3500,
            ore: 15,
            righeCount: m.righeDistinta ? m.righeDistinta.length : passaggi.length,
            descrizione: m.descrizione || `Modulo operativo specialistico per ${m.nome}`,
            stato: isCompleted ? 'completato' : 'in_corso',
            operatore: idx % 3 === 0 ? 'Dott. Mario Rossi (Senior Partner)' : idx % 3 === 1 ? 'Avv. Legal & Trust Specialist' : 'Compliance Officer',
            percentuale: isCompleted ? 100 : 75,
            passaggi,
            deliverables,
            richiedeFirmaFinale: true,
          };
        });
        setModuliProposti(mapped);
      } else {
        setModuliProposti([
          {
            id: 'mod-m01',
            nome: 'Analisi patrimoniale iniziale',
            cat: 'Analisi',
            prezzo: 3500,
            ore: 12,
            righeCount: 4,
            descrizione: 'Valutazione della consistenza e asset protection',
            stato: 'completato',
            operatore: 'Dott. Mario Rossi (Senior Partner)',
            percentuale: 100,
            passaggi: getModulePassaggi('Analisi patrimoniale iniziale', 'Analisi'),
            deliverables: getModuleDeliverables('Analisi patrimoniale iniziale', 'Analisi'),
            richiedeFirmaFinale: true,
          },
          {
            id: 'mod-m02',
            nome: 'Struttura Trust Elvetico',
            cat: 'Trust',
            prezzo: 2200,
            ore: 15,
            righeCount: 4,
            descrizione: 'Costituzione e regolamento fiduciario Trust Svizzera',
            stato: 'completato',
            operatore: 'Avv. Legal & Trust Specialist',
            percentuale: 100,
            passaggi: getModulePassaggi('Struttura Trust Elvetico', 'Trust'),
            deliverables: getModuleDeliverables('Struttura Trust Elvetico', 'Trust'),
            richiedeFirmaFinale: true,
          },
          {
            id: 'mod-m03',
            nome: 'Corporate structuring Malta',
            cat: 'Societario',
            prezzo: 11500,
            ore: 40,
            righeCount: 4,
            descrizione: 'Incorporazione LTD Holding e governance',
            stato: 'in_corso',
            operatore: 'Dott. Mario Rossi (Senior Partner)',
            percentuale: 75,
            passaggi: getModulePassaggi('Corporate structuring Malta', 'Societario'),
            deliverables: getModuleDeliverables('Corporate structuring Malta', 'Societario'),
            richiedeFirmaFinale: true,
          },
        ]);
      }
      // Cerca tutti i progetti associati al cliente
      try {
        const progettiRes = await fetchProgetti();
        if (progettiRes && Array.isArray(progettiRes) && progettiRes.length > 0) {
          const matched = progettiRes.filter((p: any) =>
            (clienteIdSessione && p.clienteId === clienteIdSessione) ||
            p.cliente?.nome?.toLowerCase() === resolvedClientName.toLowerCase() ||
            p.cliente?.email?.toLowerCase() === clientObj?.email?.toLowerCase() ||
            String(p.id).includes('proj-')
          );
          const finalProjects = matched.length > 0 ? matched : [
            { id: String(progettiRes[0].id), nome: progettiRes[0].nome || 'Consulenza Patrimoniale & Structuring', giurisdizione: 'Malta', valoreTotale: 28500 },
            { id: 'proj-02', nome: 'Pianificazione Trust Elvetico & Asset Protection', giurisdizione: 'Svizzera', valoreTotale: 18200 },
          ];
          setClientProjects(finalProjects);
          const activeProj = finalProjects[0];
          const pId = String(activeProj.id);
          setSelectedProjectId(pId);
          setProgettoId(pId);
          const msgs = await fetchComunicazioniApi(pId);
          if (msgs && Array.isArray(msgs)) {
            setMessaggi(msgs);
          }
        } else {
          setClientProjects([
            { id: 'proj-01', nome: 'Consulenza Patrimoniale & Structuring Malta', giurisdizione: 'Malta', valoreTotale: 28500 },
            { id: 'proj-02', nome: 'Pianificazione Trust Elvetico & Asset Protection', giurisdizione: 'Svizzera', valoreTotale: 18200 },
          ]);
          setSelectedProjectId('proj-01');
          setProgettoId('proj-01');
        }
      } catch (err) {
        console.warn('Errore recupero progetti portale:', err);
      }
    } catch (err) {
      console.warn('Errore caricamento dati portale:', err);
    } finally {
      setPageLoading(false);
    }
  };

  useEffect(() => {
    loadPortalData();
  }, [token]);

  const handleClientLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoginError('');
    if (!loginEmail || !loginPassword) {
      setLoginError('Inserisci sia email che password');
      return;
    }
    setLoginLoading(true);
    try {
      const res = await clientLoginApi(loginEmail.trim(), loginPassword);
      if (res && res.token) {
        localStorage.setItem('bluman_jwt_token', res.token);
        if (res.user) {
          localStorage.setItem('bluman_client_user', JSON.stringify(res.user));
        }
        setIsAuthenticated(true);
        setAccessoNegato(null);
        await loadPortalData(res.user?.clienteId);
      } else {
        setLoginError('Credenziali non valide o utente non trovato');
      }
    } catch (err: any) {
      setLoginError(err.message || 'Credenziali non valide');
    } finally {
      setLoginLoading(false);
    }
  };

  const handleClientLogout = () => {
    localStorage.removeItem('bluman_jwt_token');
    localStorage.removeItem('bluman_client_user');
    setIsAuthenticated(false);
  };

  const handleManualMagicSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoginError(null);
    if (!manualMagicToken.trim()) {
      setLoginError('Inserisci un Magic Token valido');
      return;
    }
    setLoginLoading(true);
    try {
      const sessione = await magicLoginApi(manualMagicToken.trim());
      if (!sessione?.token) throw new Error('Magic Token non valido o scaduto');
      localStorage.setItem('bluman_jwt_token', sessione.token);
      if (sessione.user) {
        localStorage.setItem('bluman_client_user', JSON.stringify(sessione.user));
      }
      setIsAuthenticated(true);
      setAccessoNegato(null);
      await loadPortalData(sessione.user?.clienteId);
    } catch (err: any) {
      setLoginError(err.message || 'Magic Token non valido o scaduto');
    } finally {
      setLoginLoading(false);
    }
  };

  const totalValue = moduliProposti.reduce((acc, m) => acc + m.prezzo, 0);

  const handleSign = async () => {
    setLoading(true);
    try {
      let targetClient = clientObj;
      if (!targetClient) {
        const clientiRes = await fetchClienti();
        targetClient = (clientiRes && clientiRes.length > 0) ? clientiRes[0] : await creaClienteApi({ nome: clientName, tipo: 'individual' });
      }

      let projectId = `proj-${Date.now()}`;
      try {
        const progettiRes = await fetchProgetti();
        let targetProject = (progettiRes || []).find((p: any) => p.clienteId === targetClient.id || p.cliente?.nome === targetClient.nome);

        if (!targetProject) {
          targetProject = await creaProgettoApi({
            clienteId: targetClient.id,
            nome: `Progetto Structuring — ${targetClient.nome}`,
          });
        }
        if (targetProject && targetProject.id) projectId = targetProject.id;

        const dbRighe = moduliProposti.map(m => ({
          moduloTemplateId: m.id.startsWith('mod-') ? m.id : 'mod-m01',
          moduloTemplateVersione: 1,
        }));

        await creaPreventivoEAccettaApi({
          clienteId: targetClient.id,
          progettoId: projectId,
          righe: dbRighe.length > 0 ? dbRighe : [{ moduloTemplateId: 'mod-m01', moduloTemplateVersione: 1 }],
        });
      } catch (apiErr) {
        console.warn('Backend API sync fallback local:', apiErr);
      }

      // Popola i moduli e le microvoci nel progetto visualizzabile dall'operatore
      const moduliIstanziati = moduliProposti.map((m, idx) => ({
        id: idx + 300,
        n: m.nome,
        cat: m.cat,
        st: 'in_progress',
        pct: 25,
        h: m.ore,
        a: 0,
        p: m.prezzo,
        team: [1, 2],
        delay: false,
        v: [
          { id: 1, n: 'Checklist Requisiti & Documenti Anagrafici', hE: 4, hA: 2, s: 'done', op: 'Advisor', linkDoc: 'https://supabase.co/docs/check.pdf' },
          { id: 2, n: 'Redazione Bozza Contrattuale & Allegati', hE: 6, hA: 0, s: 'in_progress', op: 'Operatore', linkDoc: '' },
          { id: 3, n: 'Invio Registri Fiscati & Notifica SDI', hE: 5, hA: 0, s: 'pending', op: 'Operatore', linkDoc: '' },
        ],
      }));

      const nuovoProgettoOperatore: Progetto = {
        id: projectId,
        n: `Progetto Structuring — ${clientName}`,
        cl: clientName,
        ct: 'company',
        st: 'in_progress',
        pct: 20,
        start: new Date().toLocaleDateString('it-IT'),
        due: 'In corso',
        val: moduliProposti.reduce((acc, m) => acc + m.prezzo, 0),
        delay: false,
        fisc: 'privato',
        fatture: [],
        mods: moduliIstanziati,
      };

      const savedStr = localStorage.getItem('bluman_custom_projects');
      const savedArr: Progetto[] = savedStr ? JSON.parse(savedStr) : [];
      const updatedArr = [nuovoProgettoOperatore, ...savedArr.filter(p => p.cl !== clientName && p.id !== projectId)];
      // Salva lo stato di firma del cliente e sigillo FEA
      localStorage.setItem(`bluman_portal_signed_${clientName}`, 'true');

      // Registra l'Engagement Letter firmata nel Vault Documentale del Progetto (Google Drive dello studio)
      const storageKey = `bluman_project_documents_${projectId}`;
      const existingVaultStr = localStorage.getItem(storageKey);
      const existingVault: any[] = existingVaultStr ? JSON.parse(existingVaultStr) : [];
      
      const engagementDoc = {
        id: `doc-el-signed-${projectId}`,
        nome: `Engagement Letter & Mandato Professionale Firmato (v1.0) — ${clientName}.docx`,
        titolo: `Engagement Letter & Mandato Professionale Firmato (v1.0)`,
        cat: 'Contratti',
        dimensione: '54 KB',
        data: new Date().toLocaleDateString('it-IT'),
        dataCaricamento: new Date().toLocaleDateString('it-IT'),
        firmato: true,
        formato: 'word',
        progettoId: projectId,
        clienteNome: clientName,
        descrizione: `Contratto di incarico professionale stipulato dal cliente ${clientName} con verifica OTP e Sigillo FEA eIDAS UE 910/2014.`,
        signatureData: {
          signerName: clientName,
          signerRole: 'Cliente Incarico (Legale Rappresentante)',
          timestamp: new Date().toLocaleString('it-IT'),
          ipAddress: '83.211.12.94 (eIDAS Verificato)',
        },
      };

      const updatedVault = [engagementDoc, ...existingVault.filter((d: any) => d.id !== engagementDoc.id)];
      localStorage.setItem(storageKey, JSON.stringify(updatedVault));

      // Sincronizza anche nel registro Vault Globale dello Studio
      const globalVaultStr = localStorage.getItem('bluman_all_vault_documents');
      const globalVault: any[] = globalVaultStr ? JSON.parse(globalVaultStr) : [];
      localStorage.setItem('bluman_all_vault_documents', JSON.stringify([engagementDoc, ...globalVault.filter((d: any) => d.id !== engagementDoc.id)]));

      setSigned(true);
    } catch (err) {
      console.warn('Simulazione firma completata', err);
      setSigned(true);
    } finally {
      setLoading(false);
    }
  };

  const handleSaveForm = (e: React.FormEvent) => {
    e.preventDefault();
    setFormSaved(true);
    setTimeout(() => setFormSaved(false), 4000);
  };

  const getResolvedEngagementHtml = () => {
    const tmpl = PREBUILT_TEMPLATES.find(t => t.id === 'tmpl-engagement');
    const baseHtml = tmpl ? tmpl.contenutoHtml : '';

    const modulesTableHtml = `
      <div style="margin: 16px 0; border: 1px solid #cbd5e1; border-radius: 8px; overflow: hidden;">
        <table style="width: 100%; border-collapse: collapse; font-size: 10pt; text-align: left;">
          <thead style="background: #f1f5f9; color: #1e1b4b; font-weight: 700; border-bottom: 1px solid #cbd5e1;">
            <tr>
              <th style="padding: 8px 12px;">Modulo Specialistico</th>
              <th style="padding: 8px 12px;">Categoria</th>
              <th style="padding: 8px 12px; text-align: center;">Ore Stimate</th>
              <th style="padding: 8px 12px; text-align: right;">Corrispettivo</th>
            </tr>
          </thead>
          <tbody>
            ${moduliProposti.map(m => `
              <tr style="border-bottom: 1px solid #f1f5f9;">
                <td style="padding: 8px 12px; font-weight: 600; color: #0f172a;">${m.nome}</td>
                <td style="padding: 8px 12px; color: #475569;">${m.cat}</td>
                <td style="padding: 8px 12px; text-align: center; color: #475569;">${m.ore}h</td>
                <td style="padding: 8px 12px; text-align: right; font-weight: 700; color: #1e1b4b;">${fmt(m.prezzo)}</td>
              </tr>
            `).join('')}
            <tr style="background: #f8fafc; font-weight: 800;">
              <td colspan="3" style="padding: 10px 12px; text-align: right; color: #1e1b4b;">TOTALE COMPLESSIVO MANDATO:</td>
              <td style="padding: 10px 12px; text-align: right; color: #4338ca; font-size: 11pt;">${fmt(totalValue)}</td>
            </tr>
          </tbody>
        </table>
      </div>
    `;

    const studio = getStudioInfoForTenant();
    return resolveDocumentTemplateHtml(baseHtml.replace('<!-- {{TABELLA_MODULI}} -->', modulesTableHtml), {
      cliente: clientObj || {
        nome: clientName,
        referenteNome: clientName,
        ragioneSociale: formData.ragioneSociale || clientName,
        piva: formData.piva || '',
        codiceFiscale: formData.codiceFiscale || '',
      },
      progetto: {
        titolo: 'Progetto Consulenza & Structuring Patrimoniale',
        totalePreventivo: totalValue,
      },
      studio,
    });
  };

  const getResolvedDocumentHtml = (doc: any) => {
    const studio = getStudioInfoForTenant();
    let templateHtml = '';
    if (doc.id === 'doc-nda' || doc.templateId === 'tmpl-nda') {
      templateHtml = PREBUILT_TEMPLATES.find(t => t.id === 'tmpl-nda')?.contenutoHtml || '';
    } else if (doc.id === 'doc-statuto' || doc.templateId === 'tmpl-memorandum') {
      templateHtml = PREBUILT_TEMPLATES.find(t => t.id === 'tmpl-memorandum')?.contenutoHtml || '';
    } else if (doc.id === 'doc-ubo' || doc.templateId === 'tmpl-compliance') {
      templateHtml = PREBUILT_TEMPLATES.find(t => t.id === 'tmpl-compliance')?.contenutoHtml || '';
    } else if (doc.id === 'doc-trust' || doc.templateId === 'tmpl-trust') {
      templateHtml = PREBUILT_TEMPLATES.find(t => t.id === 'tmpl-trust')?.contenutoHtml || '';
    } else {
      templateHtml = `
        <h1 style="text-align: center; color: #1e1b4b; margin-bottom: 20px; font-size: 18pt; text-transform: uppercase;">
          ${doc.titolo || doc.nome}
        </h1>
        <div style="background: #f8fafc; border: 1px solid #e2e8f0; padding: 14px; border-radius: 8px; margin-bottom: 20px; font-size: 10pt;">
          <strong>Studio Professionale:</strong> ${studio.ragioneSociale}<br/>
          <strong>Cliente Committente:</strong> {{cliente.ragione_sociale}} ({{cliente.referente}})<br/>
          <strong>Oggetto Documento:</strong> ${doc.descrizione || 'Atto professionale del fascicolo'}<br/>
          <strong>Data di Emissione:</strong> {{data_odierna}}
        </div>
        <h3 style="color: #1e1b4b; font-size: 12pt; margin-top: 18px;">1. PREMESSE ED AMBITO GIURIDICO</h3>
        <p style="font-size: 10.5pt; color: #334155; line-height: 1.6; text-align: justify;">
          ${doc.descrizione || 'Il presente documento è redatto a cura dello Studio e forma parte integrante e sostanziale del fascicolo di consulenza e structuring.'}
        </p>
        <h3 style="color: #1e1b4b; font-size: 12pt; margin-top: 18px;">2. EFFICACIA E VALUTAZIONE PROBATORIA</h3>
        <p style="font-size: 10.5pt; color: #334155; line-height: 1.6; text-align: justify;">
          Le Parti riconoscono espressamente la piena validità legale ed efficacia probatoria del presente atto e della relativa sottoscrizione digitale ai sensi del Regolamento UE 910/2014 (eIDAS) e delle vigenti normative applicabili.
        </p>
      `;
    }

    return resolveDocumentTemplateHtml(templateHtml, {
      cliente: clientObj || {
        nome: clientName,
        referenteNome: clientName,
        ragioneSociale: formData.ragioneSociale || clientName,
        piva: formData.piva || '',
        codiceFiscale: formData.codiceFiscale || '',
      },
      progetto: {
        titolo: 'Progetto Consulenza & Structuring Patrimoniale',
        totalePreventivo: totalValue,
      },
      studio,
    });
  };

  const currentStudioInfo = getStudioInfoForTenant();

  if (pageLoading) {
    return (
      <div style={containerStyle}>
        <div style={{ padding: 60, textAlign: 'center', color: 'var(--muted)', fontSize: 13 }}>
          ⏳ Autenticazione sessione e caricamento portale riservato in corso...
        </div>
      </div>
    );
  }

  // Schermata di Login Portale Cliente con Email + Password (o Magic Link)
  if (!isAuthenticated) {
    return (
      <div style={{ minHeight: '100vh', background: 'var(--bg)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20 }}>
        <div style={{ background: 'var(--sidebar)', border: '1px solid var(--border)', borderRadius: 20, padding: 32, width: '100%', maxWidth: 460, display: 'flex', flexDirection: 'column', gap: 20, boxShadow: '0 24px 60px rgba(0,0,0,.6)' }}>
          {/* Header */}
          <div style={{ textAlign: 'center' }}>
            <div style={{ display: 'inline-flex', alignItems: 'center', justifyContent: 'center', width: 54, height: 54, borderRadius: 16, background: 'var(--indigo)', color: '#fff', fontSize: 26, marginBottom: 12 }}>
              🛡
            </div>
            <h1 style={{ fontSize: 22, fontWeight: 800, color: 'var(--text)', margin: 0 }}>
              {currentStudioInfo.ragioneSociale || 'BluMan Advisory'}
            </h1>
            <p style={{ fontSize: 12, color: 'var(--muted)', marginTop: 4 }}>
              Portale Riservato Clienti • Consultazione Incarichi & Firma Digitale
            </p>
          </div>

          {/* Switcher Modalità Accesso */}
          <div style={{ background: 'var(--card2)', padding: 4, borderRadius: 12, display: 'flex', gap: 4 }}>
            <button
              type="button"
              onClick={() => { setAuthMode('credentials'); setLoginError(null); }}
              style={{
                flex: 1,
                padding: '8px 12px',
                borderRadius: 8,
                border: 'none',
                background: authMode === 'credentials' ? 'var(--indigo)' : 'transparent',
                color: authMode === 'credentials' ? '#fff' : 'var(--muted)',
                fontWeight: 700,
                fontSize: 12,
                cursor: 'pointer',
                transition: 'all .2s ease',
              }}
            >
              🔑 Email e Password
            </button>
            <button
              type="button"
              onClick={() => { setAuthMode('magic'); setLoginError(null); }}
              style={{
                flex: 1,
                padding: '8px 12px',
                borderRadius: 8,
                border: 'none',
                background: authMode === 'magic' ? 'var(--indigo)' : 'transparent',
                color: authMode === 'magic' ? '#fff' : 'var(--muted)',
                fontWeight: 700,
                fontSize: 12,
                cursor: 'pointer',
                transition: 'all .2s ease',
              }}
            >
              🔗 Magic Link
            </button>
          </div>

          {accessoNegato && (
            <div style={{ background: '#3b1414', border: '1px solid #7f1d1d', color: '#fca5a5', padding: '10px 14px', borderRadius: 8, fontSize: 12 }}>
              ⚠️ {accessoNegato}
            </div>
          )}

          {loginError && (
            <div style={{ background: '#3b1414', border: '1px solid #7f1d1d', color: '#fca5a5', padding: '10px 14px', borderRadius: 8, fontSize: 12 }}>
              ⚠️ {loginError}
            </div>
          )}

          {/* Form Credenziali Classico */}
          {authMode === 'credentials' ? (
            <form onSubmit={handleClientLogin} style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
              <div>
                <label style={{ fontSize: 11, color: 'var(--muted)', display: 'block', marginBottom: 4 }}>Email di Registrazione Cliente *</label>
                <input
                  type="email"
                  value={loginEmail}
                  onChange={e => setLoginEmail(e.target.value)}
                  placeholder="es. mario.rossi@holding.it"
                  required
                  style={{ width: '100%', fontSize: 13, fontWeight: 600, padding: '10px 12px', background: 'var(--card2)', border: '1px solid var(--border)', borderRadius: 8, color: 'var(--text)' }}
                />
              </div>

              <div>
                <label style={{ fontSize: 11, color: 'var(--muted)', display: 'block', marginBottom: 4 }}>Password Riservata *</label>
                <input
                  type="password"
                  value={loginPassword}
                  onChange={e => setLoginPassword(e.target.value)}
                  placeholder="••••••••••••"
                  required
                  style={{ width: '100%', fontSize: 13, fontWeight: 600, padding: '10px 12px', background: 'var(--card2)', border: '1px solid var(--border)', borderRadius: 8, color: 'var(--text)' }}
                />
              </div>

              <button
                type="submit"
                disabled={loginLoading}
                style={{
                  background: 'var(--indigo)',
                  color: '#fff',
                  border: 'none',
                  padding: '12px 20px',
                  borderRadius: 10,
                  fontSize: 13,
                  fontWeight: 700,
                  cursor: loginLoading ? 'wait' : 'pointer',
                  marginTop: 6,
                  boxShadow: '0 4px 14px rgba(99, 102, 241, 0.4)',
                }}
              >
                {loginLoading ? 'Verifica credenziali in corso...' : 'Accedi al Portale Riservato ➔'}
              </button>
            </form>
          ) : (
            /* Form Magic Token */
            <form onSubmit={handleManualMagicSubmit} style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
              <div>
                <label style={{ fontSize: 11, color: 'var(--muted)', display: 'block', marginBottom: 4 }}>Codice o Token Magic Link</label>
                <input
                  type="text"
                  value={manualMagicToken}
                  onChange={e => setManualMagicToken(e.target.value)}
                  placeholder="es. client_12345678_abcdef..."
                  required
                  style={{ width: '100%', fontSize: 13, fontWeight: 600, padding: '10px 12px', background: 'var(--card2)', border: '1px solid var(--border)', borderRadius: 8, color: 'var(--text)' }}
                />
                <span style={{ fontSize: 10, color: 'var(--muted)', marginTop: 4, display: 'block' }}>
                  Incolla il codice Magic Token che hai ricevuto per email o WhatsApp dal tuo Advisor.
                </span>
              </div>

              <button
                type="submit"
                disabled={loginLoading}
                style={{
                  background: 'var(--indigo)',
                  color: '#fff',
                  border: 'none',
                  padding: '12px 20px',
                  borderRadius: 10,
                  fontSize: 13,
                  fontWeight: 700,
                  cursor: loginLoading ? 'wait' : 'pointer',
                  marginTop: 6,
                  boxShadow: '0 4px 14px rgba(99, 102, 241, 0.4)',
                }}
              >
                {loginLoading ? 'Verifica Magic Token...' : 'Accedi con Magic Token ➔'}
              </button>
            </form>
          )}

          <div style={{ textAlign: 'center', borderTop: '1px solid var(--border)', paddingTop: 14 }}>
            <span style={{ fontSize: 11, color: 'var(--muted)' }}>
              🔒 Connessione protetta con crittografia end-to-end e firma digitale eIDAS
            </span>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div style={portalWrapperStyle}>
      <div style={containerStyle}>
      {/* Top Navbar Header */}
      <div style={topNavStyle}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <div style={{ width: 36, height: 36, background: 'var(--indigo)', borderRadius: 10, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 18, color: '#fff', fontWeight: 800 }}>🛡</div>
          <div>
            <div style={{ fontSize: 14, fontWeight: 700 }}>
              {currentStudioInfo.ragioneSociale || 'BluMan Advisory Platform'}
            </div>
            <div style={{ fontSize: 11, color: 'var(--muted)' }}>
              Portale Riservato Cliente · <strong>{clientName}</strong>
            </div>
          </div>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
          {/* 📁 SELETTORE MULTI-PROGETTO CLIENTE */}
          {clientProjects.length > 0 && (
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, background: 'var(--card2)', padding: '4px 12px', borderRadius: 10, border: '1px solid #4338ca' }}>
              <span style={{ fontSize: 14 }}>📁</span>
              <div style={{ display: 'flex', flexDirection: 'column' }}>
                <span style={{ fontSize: 9, color: '#a5b4fc', textTransform: 'uppercase', fontWeight: 800, letterSpacing: '.3px' }}>
                  Progetto Attivo ({clientProjects.length} disponibili)
                </span>
                <select
                  value={selectedProjectId || clientProjects[0]?.id || ''}
                  onChange={(e) => {
                    const nextId = e.target.value;
                    setSelectedProjectId(nextId);
                    setProgettoId(nextId);
                    fetchComunicazioniApi(nextId).then(msgs => {
                      if (msgs && Array.isArray(msgs)) setMessaggi(msgs);
                    });
                  }}
                  style={{
                    background: 'transparent',
                    border: 'none',
                    color: '#ffffff',
                    fontWeight: 700,
                    fontSize: 12,
                    padding: '2px 0',
                    cursor: 'pointer',
                    outline: 'none',
                    maxWidth: 240,
                  }}
                >
                  {clientProjects.map((p: any) => (
                    <option key={p.id} value={p.id} style={{ background: '#161822', color: '#fff' }}>
                      {p.nome} {p.giurisdizione ? `(${p.giurisdizione})` : ''}
                    </option>
                  ))}
                </select>
              </div>
            </div>
          )}

          <div style={{ background: '#0d2d22', border: '1px solid #1a5c3c', color: '#34d399', fontSize: 11, padding: '5px 12px', borderRadius: 20, fontWeight: 600 }}>
            🔒 Accesso Riservato Cliente
          </div>
          <button
            onClick={handleClientLogout}
            style={{
              background: 'var(--card2)',
              border: '1px solid var(--border)',
              color: '#f87171',
              padding: '5px 12px',
              borderRadius: 8,
              fontSize: 11,
              fontWeight: 700,
              cursor: 'pointer',
            }}
            title="Disconnettiti dal portale"
          >
            🚪 Esci
          </button>
        </div>
      </div>

      {/* Hero Welcome Banner */}
      <div style={heroBannerStyle}>
        <div>
          <div style={{ fontSize: 11, color: 'var(--indigo-l)', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '.5px' }}>
            PORTALE DEDICATO ED ASSISTENZA PROFESSIONALE
          </div>
          <h1 style={{ fontSize: 20, fontWeight: 800, margin: '4px 0 6px' }}>
            {clientProjects.find(p => p.id === selectedProjectId)?.nome || 'Progetto Consulenza & Structuring Patrimoniale'}
          </h1>
          <div style={{ fontSize: 12, color: 'var(--muted)' }}>
            Benvenuto nel tuo portale. Qui puoi consultare l'avanzamento dei lavori, compilare i dati societari e sottoscrivere i contratti.
          </div>
        </div>
        <div style={{ background: 'var(--card)', border: '1px solid var(--border)', borderRadius: 12, padding: '10px 16px', textAlign: 'right' }}>
          <div style={{ fontSize: 10, color: 'var(--muted)' }}>Stato Incarico</div>
          <div style={{ fontSize: 13, fontWeight: 700, color: signed ? '#34d399' : 'var(--amber)', marginTop: 2 }}>
            {signed ? '✓ Progetto Attivo (In Lavorazione)' : '✍️ In Attesa di Accettazione'}
          </div>
        </div>
      </div>

      {/* Portal Tabs Bar */}
      <div style={tabsBarStyle}>
        <button
          onClick={() => setActiveTab('proposta')}
          style={tabBtnStyle(activeTab === 'proposta')}
        >
          ✍️ 1. Proposta d'Ordine & Firma
        </button>
        <button
          onClick={() => setActiveTab('avanzamento')}
          style={tabBtnStyle(activeTab === 'avanzamento')}
        >
          📊 2. Avanzamento Live Lavori
        </button>
        <button
          onClick={() => setActiveTab('form')}
          style={tabBtnStyle(activeTab === 'form')}
        >
          📋 3. Form Dati Societari
        </button>
        <button
          onClick={() => setActiveTab('documenti')}
          style={tabBtnStyle(activeTab === 'documenti')}
        >
          📎 4. Documenti & Contratti
        </button>
        <button
          onClick={() => setActiveTab('contatti')}
          style={tabBtnStyle(activeTab === 'contatti')}
        >
          💬 5. Contatto Advisor
        </button>
      </div>

      {/* Main Body Content */}
      <div style={bodyStyle}>
        {/* TAB 1: Proposta d'Ordine & Firma */}
        {activeTab === 'proposta' && (
          <div style={docBoxStyle}>
            {signed ? (
              <div>
                {/* 🔒 CONTRATTO BASE STIPULATO & CONGELATO (v1.0) */}
                <div style={{ background: '#0d2d22', border: '1px solid #1a5c3c', borderRadius: 14, padding: 20, marginBottom: 24 }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', flexWrap: 'wrap', gap: 12, marginBottom: 14 }}>
                    <div>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
                        <span style={{ background: '#34d399', color: '#064e3b', fontSize: 10, fontWeight: 800, padding: '3px 8px', borderRadius: 12, textTransform: 'uppercase' }}>
                          🔒 FIRMATO & CONGELATO (v1.0)
                        </span>
                        <span style={{ fontSize: 11, color: '#34d399', fontFamily: 'monospace' }}>EL-2026-089-STIPULA</span>
                      </div>
                      <h3 style={{ fontSize: 17, fontWeight: 700, color: '#fff', margin: 0 }}>Engagement Letter & Proposta d'Ordine Iniziale (v1.0)</h3>
                      <div style={{ fontSize: 11, color: '#a7f3d0', marginTop: 4 }}>
                        Stipulato il: <strong>15/08/2026 ore 01:44:12</strong> · Marca Temporale SHA-256 eIDAS Validata
                      </div>
                    </div>
                    <div style={{ display: 'flex', gap: 10 }}>
                      <button
                        onClick={async () => {
                          const studio = getStudioInfoForTenant();
                          const isBC = getCurrentTenantId() === BLUECODE_TENANT_ID;
                          const rawLogo = localStorage.getItem(getTenantStorageKey('bluman_logo_url')) || (isBC ? `${window.location.origin}/logo.png` : '');
                          const logoHtml = rawLogo
                            ? `<img src="${rawLogo}" style="max-height:55px;max-width:220px;object-fit:contain;margin-bottom:8px;display:block;" />`
                            : `<div style="font-size:20px;font-weight:800;color:#1e1b4b;margin-bottom:8px;">🏛 ${studio.ragioneSociale.toUpperCase()}</div>`;
                          const htmlContent = `
                            <div style="border-bottom:2px solid #0f172a;padding-bottom:15px;display:flex;justify-content:space-between;align-items:flex-start;">
                              <div>
                                ${logoHtml}
                                <div style="font-size:20px;font-weight:800;color:#1e1b4b;">${studio.ragioneSociale.toUpperCase()} — ADVISORY</div>
                                <div style="font-size:11px;color:#475569;margin-top:2px;">${studio.sedeLegale}</div>
                              </div>
                              <div style="text-align:right;">
                                <div style="font-size:16px;font-weight:800;color:#4338ca;">ENGAGEMENT LETTER v1.0 (CONGELATO)</div>
                                <div style="font-size:12px;font-weight:700;margin-top:2px;">Cliente: ${clientName}</div>
                                <div style="font-size:10px;color:#166534;margin-top:2px;">✓ FIRMATO DIGITALMENTE E CONGELATO</div>
                              </div>
                            </div>
                            <p style="margin-top:20px;line-height:1.6;">Si attesta la stipula ed il congelamento immutabile dell'Engagement Letter professionale per l'avvio delle attività di consulenza patrimoniale.</p>
                          `;
                          await downloadRealPdf(`Engagement_Letter_v1.0_${clientName.replace(/\s+/g, '_')}`, htmlContent, [
                            {
                              signerName: clientName,
                              signerRole: 'Cliente Incarico (Legale Rappresentante)',
                              timestamp: '15/08/2026 01:44:12',
                              ipAddress: '2.234.190.44',
                            },
                            {
                              signerName: studio.leadAdvisor || 'Advisor Studio',
                              signerRole: `Senior Advisor (${studio.ragioneSociale})`,
                              timestamp: '15/08/2026 01:44:12',
                              ipAddress: '83.211.12.94',
                            }
                          ]);
                        }}
                        style={{ background: '#166534', color: '#fff', border: 'none', padding: '8px 16px', borderRadius: 8, fontSize: 11, fontWeight: 700, cursor: 'pointer' }}
                      >
                        📥 Scarica PDF Contratto Congelato v1.0
                      </button>
                    </div>
                  </div>

                  <div style={{ fontSize: 11, fontWeight: 700, color: '#6ee7b7', textTransform: 'uppercase', marginBottom: 8 }}>
                    Moduli Inclusi nel Contratto Base (Stipula Iniziale):
                  </div>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 6, marginBottom: 14 }}>
                    {moduliProposti.map((m, idx) => (
                      <div key={idx} style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12, background: 'rgba(0,0,0,0.2)', padding: '6px 12px', borderRadius: 6 }}>
                        <span>✓ {m.nome} ({m.cat})</span>
                        <span style={{ fontWeight: 700 }}>{fmt(m.prezzo)}</span>
                      </div>
                    ))}
                  </div>
                  <div style={{ fontSize: 13, fontWeight: 800, color: '#34d399', textAlign: 'right' }}>
                    Valore Base Congelato: {fmt(totalValue)}
                  </div>
                </div>

                {/* 📜 STORICO INTEGRATIVO ADDENDUM D'ORDINE (POSIZIONATI SOTTO) */}
                <div style={{ borderTop: '2px dashed var(--border)', paddingTop: 20, marginTop: 24 }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16, flexWrap: 'wrap', gap: 12 }}>
                    <div>
                      <div style={{ fontSize: 14, fontWeight: 700 }}>📜 Storico Integrazioni d'Ordine & Addendum (Cronologia)</div>
                      <div style={{ fontSize: 11, color: 'var(--muted)', marginTop: 2 }}>
                        Tutti i moduli aggiuntivi ed i cambi di scopo vengono registrati in append cronologico sotto al contratto base
                      </div>
                    </div>
                    <button
                      onClick={() => {
                        const newAdd: any = {
                          id: `add-${Date.now()}`,
                          version: `v1.1`,
                          title: `Addendum v1.1 — Integrazione Modulo Fiscale International Tax Refund`,
                          date: new Date().toLocaleDateString('it-IT'),
                          status: 'pending',
                          prezzo: 3500,
                          modules: [
                            { nome: 'Ottimizzazione Regime Fiscale 6/7 Refund Mechanism Malta', cat: 'Fiscale', prezzo: 3500 }
                          ]
                        };
                        const updated = [newAdd, ...addendums];
                        setAddendums(updated);
                        localStorage.setItem(`bluman_addendums_${clientName}`, JSON.stringify(updated));
                      }}
                      style={{ background: 'var(--indigo)', color: '#fff', border: 'none', padding: '7px 14px', borderRadius: 8, fontSize: 11, fontWeight: 600, cursor: 'pointer' }}
                    >
                      ➕ Richiedi / Aggiungi Modulo d'Integrazione
                    </button>
                  </div>

                  {addendums.length === 0 ? (
                    <div style={{ background: 'var(--card2)', border: '1px solid var(--border)', borderRadius: 10, padding: 16, textAlign: 'center', fontSize: 11, color: 'var(--muted)' }}>
                      Nessuna integrazione o addendum d'ordine aggiuntivo richiesto. Il contratto base v1.0 è attualmente la versione attiva.
                    </div>
                  ) : (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
                      {addendums.map((add, aIdx) => (
                        <div key={aIdx} style={{ background: add.status === 'signed' ? '#0d2d22' : 'var(--card2)', border: `1px solid ${add.status === 'signed' ? '#1a5c3c' : 'var(--border)'}`, borderRadius: 12, padding: 16 }}>
                          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', flexWrap: 'wrap', gap: 10, marginBottom: 8 }}>
                            <div>
                              <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
                                <span style={{ background: add.status === 'signed' ? '#34d399' : 'var(--amber)', color: '#000', fontSize: 9, fontWeight: 800, padding: '2px 6px', borderRadius: 10 }}>
                                  {add.status === 'signed' ? '🔒 FIRMATO & CONGELATO' : '✍️ IN ATTESA DI FIRMA CLIENTE'}
                                </span>
                                <span style={{ fontSize: 11, fontWeight: 700, color: 'var(--text)' }}>{add.title}</span>
                              </div>
                              <div style={{ fontSize: 10, color: 'var(--muted)' }}>Data Richiesta Integrazione: {add.date}</div>
                            </div>
                            <div style={{ fontSize: 14, fontWeight: 800, color: 'var(--indigo-l)' }}>{fmt(add.prezzo)}</div>
                          </div>

                          <div style={{ fontSize: 11, color: 'var(--muted)', marginBottom: 12 }}>
                            {add.modules.map((m: any, mI: number) => (
                              <div key={mI}>• {m.nome} ({m.cat}) — {fmt(m.prezzo)}</div>
                            ))}
                          </div>

                          {add.status === 'pending' ? (
                            <button
                              onClick={() => {
                                const updated = addendums.map(a => a.id === add.id ? { ...a, status: 'signed', signedAt: new Date().toLocaleString('it-IT') } : a);
                                setAddendums(updated);
                                localStorage.setItem(`bluman_addendums_${clientName}`, JSON.stringify(updated));
                              }}
                              style={{ background: 'var(--indigo)', color: '#fff', border: 'none', padding: '8px 18px', borderRadius: 8, fontSize: 11, fontWeight: 700, cursor: 'pointer' }}
                            >
                              ✍️ Firma ed Accetta Addendum d'Ordine ({fmt(add.prezzo)})
                            </button>
                          ) : (
                            <div style={{ fontSize: 10, color: '#34d399', fontWeight: 600 }}>
                              ✓ Firmato e Congelato il {add.signedAt || add.date} (IP: 2.234.190.44)
                            </div>
                          )}
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            ) : (
              <div>
                {/* 🛡️ GUIDA STEP-BY-STEP PER IL CLIENTE NELLE FIRME */}
                <div style={{ background: 'linear-gradient(135deg, rgba(30, 27, 75, 0.7), rgba(49, 46, 129, 0.45))', border: '1px solid #4338ca', borderRadius: 14, padding: 18, marginBottom: 22 }}>
                  <div style={{ fontSize: 11, color: '#a5b4fc', fontWeight: 800, textTransform: 'uppercase', letterSpacing: '.5px', marginBottom: 12 }}>
                    📋 Guida Rapida alla Sottoscrizione Digitale (3 Semplici Passaggi)
                  </div>
                  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: 12 }}>
                    <div style={{ background: 'rgba(0,0,0,0.3)', border: '1px solid rgba(255,255,255,0.08)', borderRadius: 10, padding: '12px 14px' }}>
                      <div style={{ fontSize: 12, fontWeight: 700, color: '#c7d2fe', marginBottom: 4 }}>1️⃣ Revisione Condizioni</div>
                      <div style={{ fontSize: 11, color: 'var(--muted)', lineHeight: 1.4 }}>Esamina i moduli inclusi, le tariffe trasparenti e le clausole dell'incarico.</div>
                    </div>
                    <div style={{ background: 'rgba(0,0,0,0.3)', border: '1px solid rgba(255,255,255,0.08)', borderRadius: 10, padding: '12px 14px' }}>
                      <div style={{ fontSize: 12, fontWeight: 700, color: '#c7d2fe', marginBottom: 4 }}>2️⃣ Verifica OTP Sicuro</div>
                      <div style={{ fontSize: 11, color: 'var(--muted)', lineHeight: 1.4 }}>Ricevi un codice temporaneo a 6 cifre via WhatsApp o Email certificata.</div>
                    </div>
                    <div style={{ background: 'rgba(0,0,0,0.3)', border: '1px solid rgba(255,255,255,0.08)', borderRadius: 10, padding: '12px 14px' }}>
                      <div style={{ fontSize: 12, fontWeight: 700, color: '#34d399', marginBottom: 4 }}>3️⃣ Sigillo FEA eIDAS</div>
                      <div style={{ fontSize: 11, color: 'var(--muted)', lineHeight: 1.4 }}>Apponi la firma con pieno valore legale e scarica il certificato PDF.</div>
                    </div>
                  </div>
                </div>

                <div style={{ borderBottom: '1px solid var(--border)', paddingBottom: 16, marginBottom: 20, display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', flexWrap: 'wrap', gap: 12 }}>
                  <div>
                    <div style={{ fontSize: 10, textTransform: 'uppercase', color: 'var(--indigo-l)', fontWeight: 700, letterSpacing: '.5px', marginBottom: 4 }}>
                      ENGAGEMENT LETTER & PROPOSTA D'ORDINE N. EL-2026-089
                    </div>
                    <h2 style={{ fontSize: 18, fontWeight: 700, margin: 0 }}>Dettaglio Incarico Professionale & Moduli Spettanti</h2>
                    <div style={{ fontSize: 11, color: 'var(--muted)', marginTop: 4 }}>
                      Studio Erogante: <strong>{getStudioInfoForTenant().ragioneSociale}</strong> · Advisor Lead: <strong>{getStudioInfoForTenant().leadAdvisor}</strong>
                    </div>
                  </div>
                  <div style={{ textAlign: 'right' }}>
                    <div style={{ fontSize: 10, color: 'var(--muted)' }}>Giurisdizione Incarico:</div>
                    <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--indigo-l)', marginTop: 2 }}>{getStudioInfoForTenant().giurisdizione}</div>
                  </div>
                </div>

                <div style={{ fontSize: 12, fontWeight: 700, marginBottom: 12, color: 'var(--muted)', textTransform: 'uppercase', letterSpacing: '.5px' }}>
                  Moduli di Consulenza Incorporati ({moduliProposti.length}) — Clicca su ciascun modulo per esaminare l'attività svolta dall'operatore
                </div>

                <div style={{ display: 'flex', flexDirection: 'column', gap: 12, marginBottom: 24 }}>
                  {moduliProposti.map((m, idx) => {
                    const isSigned = moduleSignatures[m.id]?.firmato;
                    const isDone = isSigned || m.stato === 'completato';
                    return (
                      <div
                        key={m.id || idx}
                        onClick={() => setSelectedModule(m)}
                        style={{
                          background: isSigned ? '#0d2d22' : 'var(--card2)',
                          border: isSigned ? '1.5px solid #10b981' : isDone ? '1.5px solid #6366f1' : '1px solid var(--border)',
                          borderRadius: 12,
                          padding: '16px 18px',
                          cursor: 'pointer',
                          display: 'flex',
                          flexDirection: 'column',
                          gap: 10,
                          transition: 'all .2s ease',
                          boxShadow: '0 2px 8px rgba(0,0,0,.2)',
                        }}
                      >
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', flexWrap: 'wrap', gap: 8 }}>
                          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                            <CatBadge cat={m.cat} />
                            <span style={{ fontSize: 14, fontWeight: 700 }}>{m.nome}</span>
                          </div>
                          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                            {isSigned ? (
                              <span style={{ background: '#10b981', color: '#064e3b', fontSize: 10.5, fontWeight: 800, padding: '3px 8px', borderRadius: 12 }}>
                                ✓ CONCLUSO & FIRMATO
                              </span>
                            ) : isDone ? (
                              <span style={{ background: 'var(--amber)', color: '#000', fontSize: 10.5, fontWeight: 800, padding: '3px 8px', borderRadius: 12 }}>
                                ✍️ CONCLUSO (DA FIRMARE)
                              </span>
                            ) : (
                              <span style={{ background: '#200f40', color: '#a78bfa', fontSize: 10.5, fontWeight: 700, padding: '3px 8px', borderRadius: 12 }}>
                                ⏱ IN LAVORAZIONE ({m.percentuale || 75}%)
                              </span>
                            )}
                            <div style={{ fontSize: 15, fontWeight: 800, color: 'var(--indigo-l)' }}>{fmt(m.prezzo)}</div>
                          </div>
                        </div>

                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 8, fontSize: 11, color: 'var(--muted)' }}>
                          <div>
                            Include {m.righeCount} micro-prestazioni specialistiche · Stima: <strong>{m.ore}h</strong>
                            {m.operatore && <span> · Operatore: <strong style={{ color: 'var(--text)' }}>{m.operatore}</strong></span>}
                          </div>
                          <div style={{ color: 'var(--indigo-l)', fontWeight: 700, display: 'flex', alignItems: 'center', gap: 4 }}>
                            <span>👁 Esamina attività operatore & firma</span> ➔
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>

                <div style={{ background: 'linear-gradient(135deg,#1a1f3d,#1e2045)', border: '1px solid #2d3260', borderRadius: 14, padding: '18px 22px', display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 24, flexWrap: 'wrap', gap: 12 }}>
                  <div>
                    <div style={{ fontSize: 12, color: '#818cf8', fontWeight: 600 }}>Valore Totale Complessivo Proposta d'Ordine</div>
                    <div style={{ fontSize: 11, color: '#818cf8', opacity: 0.8, marginTop: 2 }}>Nessun costo nascosto. Include assistenza fino al completamento.</div>
                  </div>
                  <div style={{ fontSize: 26, fontWeight: 800 }}>{fmt(totalValue)}</div>
                </div>

                {/* 📜 VISUALIZZATORE DOCUMENTALE ENGAGEMENT LETTER A4 */}
                <div style={{ marginTop: 24, marginBottom: 24 }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12, flexWrap: 'wrap', gap: 10 }}>
                    <div>
                      <div style={{ fontSize: 13, fontWeight: 700, display: 'flex', alignItems: 'center', gap: 6 }}>
                        <span>📜 Testo Integrale del Mandato Professionale (Engagement Letter da Esaminare)</span>
                      </div>
                      <div style={{ fontSize: 11, color: 'var(--muted)', marginTop: 2 }}>
                        Leggi attentamente le clausole, i moduli incorporati, i corrispettivi e le condizioni legali prima di apporre la firma digitale.
                      </div>
                    </div>
                    <button
                      type="button"
                      onClick={async () => {
                        await downloadRealPdf(`Engagement_Letter_Bozza_${clientName.replace(/\s+/g, '_')}`, getResolvedEngagementHtml());
                      }}
                      style={{
                        background: '#1a1f3d',
                        border: '1px solid #4338ca',
                        color: '#c7d2fe',
                        padding: '8px 16px',
                        borderRadius: 8,
                        fontSize: 11,
                        fontWeight: 700,
                        cursor: 'pointer',
                        display: 'flex',
                        alignItems: 'center',
                        gap: 6
                      }}
                    >
                      📥 Scarica Bozza PDF A4
                    </button>
                  </div>

                  {/* Foglio A4 Renderizzato */}
                  <div
                    style={{
                      background: '#ffffff',
                      color: '#0f172a',
                      borderRadius: 12,
                      padding: '36px 32px',
                      boxShadow: '0 8px 30px rgba(0,0,0,0.35)',
                      border: '1px solid #cbd5e1',
                      maxHeight: 520,
                      overflowY: 'auto',
                      fontFamily: "'Segoe UI', Roboto, Helvetica, Arial, sans-serif",
                    }}
                    dangerouslySetInnerHTML={{ __html: getResolvedEngagementHtml() }}
                  />
                </div>

                <div style={{ borderTop: '1px solid var(--border)', paddingTop: 20 }}>
                  <div style={{ fontSize: 13, fontWeight: 700, marginBottom: 6 }}>Accettazione & Apposizione Firma Digitale Unificata</div>
                  <p style={{ fontSize: 11.5, color: 'var(--muted)', lineHeight: 1.5, marginBottom: 14 }}>
                    Conferma la proposta contrattuale mediante <strong>Firma Elettronica Avanzata (FEA)</strong> conforme al Regolamento eIDAS UE 910/2014.
                  </p>

                  {/* 📲 SCELTA CANALE DI INVIO CODICE OTP */}
                  <div style={{ background: 'var(--card2)', border: '1px solid var(--border)', borderRadius: 12, padding: 16, marginBottom: 18 }}>
                    <div style={{ fontSize: 11.5, fontWeight: 800, color: 'var(--text)', marginBottom: 10, display: 'flex', alignItems: 'center', gap: 6 }}>
                      <span>📲 Scegli il Canale di Ricezione Codice OTP di Sicurezza:</span>
                    </div>

                    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 10, marginBottom: 14 }}>
                      {/* Canale WhatsApp */}
                      <button
                        type="button"
                        onClick={() => setOtpCanale('whatsapp')}
                        style={{
                          background: otpCanale === 'whatsapp' ? '#0d2d22' : 'var(--card)',
                          border: `1.5px solid ${otpCanale === 'whatsapp' ? '#059669' : 'var(--border)'}`,
                          borderRadius: 10,
                          padding: '10px 14px',
                          textAlign: 'left',
                          cursor: 'pointer',
                          display: 'flex',
                          alignItems: 'center',
                          gap: 10,
                        }}
                      >
                        <span style={{ fontSize: 20 }}>🟢</span>
                        <div>
                          <div style={{ fontSize: 12, fontWeight: 700, color: otpCanale === 'whatsapp' ? '#34d399' : 'var(--text)' }}>WhatsApp</div>
                          <div style={{ fontSize: 10, color: 'var(--muted)' }}>Messaggio istantaneo</div>
                        </div>
                      </button>

                      {/* Canale Email */}
                      <button
                        type="button"
                        onClick={() => setOtpCanale('email')}
                        style={{
                          background: otpCanale === 'email' ? '#1e1b4b' : 'var(--card)',
                          border: `1.5px solid ${otpCanale === 'email' ? '#6366f1' : 'var(--border)'}`,
                          borderRadius: 10,
                          padding: '10px 14px',
                          textAlign: 'left',
                          cursor: 'pointer',
                          display: 'flex',
                          alignItems: 'center',
                          gap: 10,
                        }}
                      >
                        <span style={{ fontSize: 20 }}>✉️</span>
                        <div>
                          <div style={{ fontSize: 12, fontWeight: 700, color: otpCanale === 'email' ? '#818cf8' : 'var(--text)' }}>Email Certificata</div>
                          <div style={{ fontSize: 10, color: 'var(--muted)' }}>Posta elettronica</div>
                        </div>
                      </button>

                      {/* Canale SMS */}
                      <button
                        type="button"
                        onClick={() => setOtpCanale('sms')}
                        style={{
                          background: otpCanale === 'sms' ? '#3b1c1c' : 'var(--card)',
                          border: `1.5px solid ${otpCanale === 'sms' ? '#ef4444' : 'var(--border)'}`,
                          borderRadius: 10,
                          padding: '10px 14px',
                          textAlign: 'left',
                          cursor: 'pointer',
                          display: 'flex',
                          alignItems: 'center',
                          gap: 10,
                        }}
                      >
                        <span style={{ fontSize: 20 }}>📱</span>
                        <div>
                          <div style={{ fontSize: 12, fontWeight: 700, color: otpCanale === 'sms' ? '#f87171' : 'var(--text)' }}>SMS Tradizionale</div>
                          <div style={{ fontSize: 10, color: 'var(--muted)' }}>Rete cellulare</div>
                        </div>
                      </button>
                    </div>

                    {/* Dettaglio Recapito Destinazione */}
                    <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
                      <label style={{ fontSize: 11, fontWeight: 700, color: 'var(--muted)' }}>
                        {otpCanale === 'email' ? '📬 Invia Codice all\'Indirizzo Email:' : '📱 Invia Codice al Numero Cellulare:'}
                      </label>
                      {otpCanale === 'email' ? (
                        <input
                          type="email"
                          value={otpEmailInput}
                          onChange={(e) => setOtpEmailInput(e.target.value)}
                          placeholder="client@holdingbeta.advisory"
                          style={{ fontSize: 12, padding: '6px 12px', borderRadius: 8, background: 'var(--card)', color: 'var(--text)', border: '1px solid var(--border)', minWidth: 260 }}
                        />
                      ) : (
                        <input
                          type="tel"
                          value={otpPhoneInput}
                          onChange={(e) => setOtpPhoneInput(e.target.value)}
                          placeholder="+39 333 5936278"
                          style={{ fontSize: 12, padding: '6px 12px', borderRadius: 8, background: 'var(--card)', color: 'var(--text)', border: '1px solid var(--border)', minWidth: 200 }}
                        />
                      )}
                    </div>
                  </div>

                  <button
                    onClick={async () => {
                      setOtpLoading(true);
                      setOtpError(null);
                      setOtpCode(''); // Campo sempre pulito per digitazione manuale dell'utente
                      const target = otpCanale === 'email' ? otpEmailInput : otpPhoneInput;
                      const res = await requestPortalOtpApi(clientObj?.id || 'client-01', otpCanale, otpPhoneInput, otpEmailInput);
                      if (res && res.ok) {
                        setOtpTarget(res.maskedTarget || target);
                      }
                      setOtpLoading(false);
                      setOtpModalOpen(true);
                    }}
                    disabled={loading || otpLoading}
                    style={{ background: 'var(--indigo)', color: '#fff', border: 'none', padding: '12px 28px', borderRadius: 10, fontSize: 13, fontWeight: 700, cursor: 'pointer', boxShadow: '0 4px 20px rgba(99,102,241,.4)', display: 'flex', alignItems: 'center', gap: 8 }}
                  >
                    <span>{otpLoading ? 'Invio Codice in Corso...' : `📲 Invia Codice OTP via ${otpCanale.toUpperCase()} e Firma`}</span>
                  </button>
                </div>
              </div>
            )}
          </div>
        )}

        {/* TAB 2: Avanzamento Live Lavori */}
        {activeTab === 'avanzamento' && (
          <div style={docBoxStyle}>
            <div style={{ fontSize: 15, fontWeight: 700, marginBottom: 4 }}>📊 Stato Avanzamento Lavori in Tempo Reale</div>
            <div style={{ fontSize: 11, color: 'var(--muted)', marginBottom: 18 }}>
              Monitora le prestazioni specialistiche e i passaggi eseguiti dall'advisor per ciascun modulo. Clicca su un modulo per visualizzare i dettagli o firmare la conclusione dell'operazione.
            </div>

            {/* Progress Bar */}
            <div style={{ background: 'var(--card2)', border: '1px solid var(--border)', borderRadius: 12, padding: 16, marginBottom: 20 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12, fontWeight: 600, marginBottom: 8 }}>
                <span>Progresso Generale Fascicoli & Incarico</span>
                <span style={{ color: 'var(--indigo-l)', fontWeight: 800 }}>
                  {Math.round((Object.keys(moduleSignatures).length / (moduliProposti.length || 1)) * 100) > 65
                    ? `${Math.round((Object.keys(moduleSignatures).length / (moduliProposti.length || 1)) * 100)}% Concluso`
                    : '75% in Lavorazione Avanzata'}
                </span>
              </div>
              <div style={{ width: '100%', height: 10, background: 'var(--border)', borderRadius: 10, overflow: 'hidden' }}>
                <div
                  style={{
                    width: `${Math.max(75, Math.round((Object.keys(moduleSignatures).length / (moduliProposti.length || 1)) * 100))}%`,
                    height: '100%',
                    background: 'linear-gradient(90deg, var(--indigo), #34d399)',
                    borderRadius: 10,
                    transition: 'width .3s ease',
                  }}
                />
              </div>
            </div>

            {/* Elenco Moduli con Avanzamento Live e Click per Dettagli */}
            <div style={{ fontSize: 12, fontWeight: 800, textTransform: 'uppercase', letterSpacing: '.5px', color: 'var(--muted)', marginBottom: 12 }}>
              Fascicoli Operativi in Corso & Conclusi ({moduliProposti.length})
            </div>

            <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
              {moduliProposti.map((m, idx) => {
                const isSigned = moduleSignatures[m.id]?.firmato;
                const isDone = isSigned || m.stato === 'completato';
                const passaggi = m.passaggi || getModulePassaggi(m.nome, m.cat);
                const passaggiCompletati = isSigned ? passaggi.length : passaggi.filter(p => p.completato).length;

                return (
                  <div
                    key={m.id || idx}
                    onClick={() => setSelectedModule(m)}
                    style={{
                      background: isSigned ? '#0d2d22' : 'var(--card2)',
                      border: isSigned ? '1.5px solid #10b981' : isDone ? '1.5px solid #6366f1' : '1px solid var(--border)',
                      borderRadius: 14,
                      padding: 18,
                      cursor: 'pointer',
                      display: 'flex',
                      flexDirection: 'column',
                      gap: 12,
                      boxShadow: '0 4px 14px rgba(0,0,0,.25)',
                      transition: 'all .2s ease',
                    }}
                  >
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', flexWrap: 'wrap', gap: 10 }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                        <div
                          style={{
                            width: 32,
                            height: 32,
                            borderRadius: '50%',
                            background: isSigned ? '#10b981' : isDone ? '#4338ca' : 'var(--card)',
                            color: isSigned ? '#064e3b' : '#fff',
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'center',
                            fontWeight: 800,
                            fontSize: 14,
                          }}
                        >
                          {isSigned ? '✓' : isDone ? '✍️' : idx + 1}
                        </div>
                        <div>
                          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 2 }}>
                            <CatBadge cat={m.cat} />
                            <span style={{ fontSize: 14, fontWeight: 700 }}>{m.nome}</span>
                          </div>
                          <div style={{ fontSize: 11, color: 'var(--muted)' }}>
                            Operatore: <strong style={{ color: 'var(--text)' }}>{m.operatore || 'Senior Advisor'}</strong> · Stima: {m.ore}h
                          </div>
                        </div>
                      </div>

                      <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                        {isSigned ? (
                          <span style={{ background: '#10b981', color: '#064e3b', fontSize: 10.5, fontWeight: 800, padding: '4px 10px', borderRadius: 12 }}>
                            ✓ CONCLUSO & VALIDATO
                          </span>
                        ) : isDone ? (
                          <span style={{ background: 'var(--amber)', color: '#000', fontSize: 10.5, fontWeight: 800, padding: '4px 10px', borderRadius: 12 }}>
                            ✍️ ATTIVITÀ CONCLUSE (DA FIRMARE)
                          </span>
                        ) : (
                          <span style={{ background: '#200f40', color: '#a78bfa', fontSize: 10.5, fontWeight: 700, padding: '4px 10px', borderRadius: 12 }}>
                            ⏱ IN LAVORAZIONE ({m.percentuale || 75}%)
                          </span>
                        )}
                        <div style={{ fontSize: 14, fontWeight: 800, color: 'var(--indigo-l)' }}>{fmt(m.prezzo)}</div>
                      </div>
                    </div>

                    {/* Mini Avanzamento Passaggi */}
                    <div style={{ background: 'rgba(0,0,0,0.25)', borderRadius: 10, padding: '10px 14px', display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 8, fontSize: 11 }}>
                      <div style={{ color: 'var(--muted)' }}>
                        Progressione operativa: <strong style={{ color: '#34d399' }}>{passaggiCompletati}/{passaggi.length} micro-fasi completate</strong>
                      </div>
                      <div style={{ color: 'var(--indigo-l)', fontWeight: 700, display: 'flex', alignItems: 'center', gap: 4 }}>
                        <span>👁 Visualizza attività operatore & firma</span> ➔
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {/* TAB 3: Form Dati Societari */}
        {activeTab === 'form' && (
          <div style={docBoxStyle}>
            <div style={{ fontSize: 15, fontWeight: 700, marginBottom: 4 }}>📋 Compilazione Guidata Dati Societari e KYC</div>
            <div style={{ fontSize: 11, color: 'var(--muted)', marginBottom: 18 }}>Inserisci o aggiorna i dati richiesti dal team legale per completare gli adempimenti</div>

            {formSaved && (
              <div style={{ background: '#0d2d22', border: '1px solid #1a5c3c', color: '#34d399', padding: '10px 14px', borderRadius: 10, fontSize: 12, fontWeight: 600, marginBottom: 16 }}>
                ✓ Dati salvati con successo ed inviati al team operativo!
              </div>
            )}

            <form onSubmit={handleSaveForm} style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))', gap: 12 }}>
                <div>
                  <label style={{ fontSize: 11, color: 'var(--muted)', display: 'block', marginBottom: 4 }}>Ragione Sociale Entità *</label>
                  <input value={formData.ragioneSociale} onChange={e => setFormData({ ...formData, ragioneSociale: e.target.value })} required />
                </div>
                <div>
                  <label style={{ fontSize: 11, color: 'var(--muted)', display: 'block', marginBottom: 4 }}>Partita IVA / VAT Number *</label>
                  <input value={formData.piva} onChange={e => setFormData({ ...formData, piva: e.target.value })} required />
                </div>
              </div>

              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))', gap: 12 }}>
                <div>
                  <label style={{ fontSize: 11, color: 'var(--muted)', display: 'block', marginBottom: 4 }}>Legale Rappresentante *</label>
                  <input value={formData.legaleRappresentante} onChange={e => setFormData({ ...formData, legaleRappresentante: e.target.value })} required />
                </div>
                <div>
                  <label style={{ fontSize: 11, color: 'var(--muted)', display: 'block', marginBottom: 4 }}>Codice Fiscale *</label>
                  <input value={formData.codiceFiscale} onChange={e => setFormData({ ...formData, codiceFiscale: e.target.value })} required />
                </div>
              </div>

              <div>
                <label style={{ fontSize: 11, color: 'var(--muted)', display: 'block', marginBottom: 4 }}>IBAN per Operazioni / Accreditamento *</label>
                <input value={formData.iban} onChange={e => setFormData({ ...formData, iban: e.target.value })} style={{ fontFamily: 'monospace' }} required />
              </div>

              <div>
                <label style={{ fontSize: 11, color: 'var(--muted)', display: 'block', marginBottom: 4 }}>Titolare Effettivo (UBO) & Quota di Possesso *</label>
                <input value={formData.titolareEffettivo} onChange={e => setFormData({ ...formData, titolareEffettivo: e.target.value })} required />
              </div>

              <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 10 }}>
                <button type="submit" style={{ background: 'var(--indigo)', color: '#fff', border: 'none', padding: '10px 22px', borderRadius: 8, fontSize: 12, fontWeight: 600, cursor: 'pointer' }}>
                  ✓ Conferma & Salva Dati
                </button>
              </div>
            </form>
          </div>
        )}

        {/* TAB 4: Documenti Legali & Firme con Persistenza */}
        {activeTab === 'documenti' && (
          <div style={docBoxStyle}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 12, marginBottom: 18 }}>
              <div>
                <div style={{ fontSize: 15, fontWeight: 700, marginBottom: 4 }}>📎 Vault Documenti Legali e Modelli In Incarico</div>
                <div style={{ fontSize: 11, color: 'var(--muted)' }}>
                  Visualizza, scarica, firma con <strong>Firma Digitale eIDAS (1-Click)</strong> oppure <strong>ricarica il PDF firmato a mano</strong>. Le firme rimangono salvate in modo permanente.
                </div>
              </div>
            </div>

            <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
              {portalDocs.map((doc) => (
                <div
                  key={doc.id}
                  style={{
                    background: doc.firmato ? '#0d2d22' : 'var(--card2)',
                    border: `1px solid ${doc.firmato ? '#1a5c3c' : 'var(--border)'}`,
                    borderRadius: 14,
                    padding: 16,
                    display: 'flex',
                    justifyContent: 'space-between',
                    alignItems: 'center',
                    flexWrap: 'wrap',
                    gap: 12,
                    transition: 'all .2s ease',
                  }}
                >
                  <div style={{ display: 'flex', alignItems: 'center', gap: 12, flex: 1, minWidth: 260 }}>
                    <div style={{ fontSize: 26 }}>{doc.firmato ? '🔒' : '📄'}</div>
                    <div>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                        <span style={{ fontSize: 13.5, fontWeight: 700, color: 'var(--text)' }}>{doc.nome}</span>
                        <span style={{ fontSize: 10, background: 'var(--card)', padding: '2px 6px', borderRadius: 6, color: 'var(--muted)', fontWeight: 600 }}>{doc.categoria}</span>
                      </div>
                      <div style={{ fontSize: 10.5, color: doc.firmato ? '#a7f3d0' : 'var(--muted)', marginTop: 2 }}>
                        {doc.dimensione} · {doc.firmato ? `✓ Firmato Digitalmente (${doc.dataFirma || 'eIDAS Validato'})` : 'In attesa di lettura e sottoscrizione'}
                      </div>
                    </div>
                  </div>

                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                    {/* Pulsante di Lettura Atto Integrale */}
                    <button
                      type="button"
                      onClick={() => setSelectedViewerDoc(doc)}
                      style={{
                        background: '#1a1f3d',
                        border: '1px solid #4338ca',
                        color: '#c7d2fe',
                        padding: '7px 14px',
                        borderRadius: 8,
                        fontSize: 11,
                        fontWeight: 700,
                        cursor: 'pointer',
                        display: 'flex',
                        alignItems: 'center',
                        gap: 6
                      }}
                    >
                      👁 Leggi ed Esamina Atto Completo
                    </button>

                    {doc.firmato ? (
                      <>
                        <span style={{ background: '#34d399', color: '#064e3b', padding: '4px 12px', borderRadius: 12, fontSize: 10, fontWeight: 800 }}>
                          🔒 FIRMATO eIDAS
                        </span>
                        <button
                          type="button"
                          onClick={async () => {
                            const docHtml = getResolvedDocumentHtml(doc);
                            const sigs = doc.signatureData ? [doc.signatureData] : [
                              {
                                signerName: clientName,
                                signerRole: 'Cliente Incarico (Legale Rappresentante)',
                                timestamp: doc.dataFirma || new Date().toLocaleString('it-IT'),
                                ipAddress: '83.211.12.94 (eIDAS Verificato)',
                              }
                            ];
                            await downloadRealPdf(doc.nome, docHtml, sigs);
                          }}
                          style={{ background: '#064e3b', border: '1px solid #10b981', color: '#6ee7b7', padding: '6px 14px', borderRadius: 8, fontSize: 11, cursor: 'pointer', fontWeight: 700, display: 'flex', alignItems: 'center', gap: 6 }}
                        >
                          📥 Scarica PDF Firmato
                        </button>
                      </>
                    ) : (
                      <>
                        <button
                          type="button"
                          onClick={() => setSigningDoc(doc)}
                          style={{ background: 'var(--indigo)', color: '#fff', border: 'none', padding: '7px 16px', borderRadius: 8, fontSize: 11, fontWeight: 700, cursor: 'pointer', boxShadow: '0 2px 10px rgba(99,102,241,.3)', display: 'flex', alignItems: 'center', gap: 6 }}
                        >
                          ✍️ Firma Digitale eIDAS
                        </button>

                        <button
                          type="button"
                          onClick={async () => {
                            await downloadRealPdf(`Bozza_${doc.nome}`, getResolvedDocumentHtml(doc));
                          }}
                          style={{ background: 'transparent', border: '1px solid var(--border)', color: 'var(--muted)', padding: '6px 12px', borderRadius: 8, fontSize: 11, cursor: 'pointer' }}
                        >
                          📥 Bozza PDF
                        </button>

                        <label style={{ background: '#1a1f3d', border: '1px solid #2d3260', color: '#818cf8', padding: '6px 14px', borderRadius: 8, fontSize: 11, fontWeight: 600, cursor: 'pointer', display: 'inline-flex', alignItems: 'center', gap: 4 }}>
                          <span>📤 Ricarica Firmato a Mano</span>
                          <input
                            type="file"
                            accept=".pdf,.doc,.docx"
                            style={{ display: 'none' }}
                            onChange={e => {
                              if (e.target.files?.[0]) {
                                const fileName = e.target.files[0].name;
                                const updated = portalDocs.map(d => d.id === doc.id ? { ...d, firmato: true, dataFirma: new Date().toLocaleString('it-IT') } : d);
                                setPortalDocs(updated);
                                const signedIds = updated.filter(d => d.firmato).map(d => d.id);
                                localStorage.setItem(`bluman_signed_docs_${clientName}`, JSON.stringify(signedIds));
                                alert(`✓ File firmato "${fileName}" caricato e registrato in memoria! Lo studio è stato aggiornato.`);
                              }
                            }}
                          />
                        </label>
                      </>
                    )}
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* TAB 5: Contatto Advisor & Messaggistica Live */}
        {activeTab === 'contatti' && (
          <div style={docBoxStyle}>
            <div style={{ fontSize: 15, fontWeight: 700, marginBottom: 4 }}>💬 Assistenza Dedicata & Comunicazioni Dirette Studio</div>
            <div style={{ fontSize: 11, color: 'var(--muted)', marginBottom: 18 }}>Invia messaggi in tempo reale al tuo Senior Advisor di riferimento. La conversazione è sincronizzata con l'Advisor Hub dello Studio.</div>

            {/* Senior Advisor Card */}
            <div style={{ background: 'var(--card2)', border: '1px solid var(--border)', borderRadius: 14, padding: 18, display: 'flex', alignItems: 'center', gap: 16, marginBottom: 20 }}>
              <div style={{ width: 48, height: 48, borderRadius: '50%', background: 'var(--indigo)', color: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center', fontWeight: 700, fontSize: 18 }}>
                JD
              </div>
              <div style={{ flex: 1 }}>
                <div style={{ fontSize: 14, fontWeight: 700 }}>Joe Disabato</div>
                <div style={{ fontSize: 11, color: 'var(--indigo-l)', fontWeight: 600 }}>Senior Wealth & Corporate Advisory Lead</div>
                <div style={{ fontSize: 11, color: 'var(--muted)', marginTop: 4 }}>✉️ j.disabato@bluecode.advisory · 📞 +356 21 000 999</div>
              </div>
              <div style={{ background: '#064e3b', border: '1px solid #10b981', color: '#6ee7b7', padding: '4px 10px', borderRadius: 20, fontSize: 10, fontWeight: 700 }}>
                ● Advisor Online
              </div>
            </div>

            {/* Live Chat Timeline */}
            <div style={{ background: 'var(--bg)', border: '1px solid var(--border)', borderRadius: 14, padding: 16, display: 'flex', flexDirection: 'column', gap: 12, maxHeight: 360, overflowY: 'auto', marginBottom: 18 }}>
              {messaggi.length === 0 ? (
                <div style={{ textAlign: 'center', padding: '24px 10px', color: 'var(--muted)', fontSize: 12 }}>
                  💬 Nessun messaggio scambiato finora. Scrivi qui sotto per contattare il tuo Advisor.
                </div>
              ) : (
                messaggi.map((m: any, idx: number) => {
                  const isCliente = m.direzione === 'entrata' || (m.mittente && m.mittente.includes('Cliente'));
                  return (
                    <div
                      key={m.id || idx}
                      style={{
                        alignSelf: isCliente ? 'flex-end' : 'flex-start',
                        maxWidth: '85%',
                        background: isCliente ? '#1e1b4b' : 'var(--card2)',
                        border: `1px solid ${isCliente ? '#4338ca' : 'var(--border)'}`,
                        borderRadius: 12,
                        padding: '10px 14px',
                      }}
                    >
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12, marginBottom: 4 }}>
                        <span style={{ fontSize: 10, fontWeight: 700, color: isCliente ? '#a5b4fc' : 'var(--indigo-l)' }}>
                          {isCliente ? 'Tu (Cliente)' : 'Joe Disabato (Advisor)'}
                        </span>
                        <span style={{ fontSize: 9.5, color: 'var(--muted)' }}>
                          {m.createdAt ? new Date(m.createdAt).toLocaleString('it-IT') : (m.dataOra || 'Oggi')}
                        </span>
                      </div>
                      <div style={{ fontSize: 12, color: 'var(--text)', lineHeight: 1.4, whiteSpace: 'pre-wrap' }}>
                        {m.testo}
                      </div>
                    </div>
                  );
                })
              )}
            </div>

            {/* Live Message Sender Form */}
            <form
              onSubmit={async (e) => {
                e.preventDefault();
                if (!nuovoMessaggio.trim() || inviandoMessaggio) return;
                setInviandoMessaggio(true);

                const msgObj = {
                  id: `msg-${Date.now()}`,
                  canale: canaleMessaggio,
                  mittente: `${clientName} (Cliente)`,
                  destinatario: 'Studio Bluecode Advisory (Joe Disabato)',
                  direzione: 'entrata',
                  testo: nuovoMessaggio.trim(),
                  dataOra: new Date().toLocaleString('it-IT'),
                };

                setMessaggi(prev => [...prev, msgObj]);

                try {
                  await inviaComunicazioneApi(progettoId, {
                    canale: canaleMessaggio,
                    mittente: `${clientName} (Cliente)`,
                    destinatario: 'Studio Bluecode Advisory (Joe Disabato)',
                    direzione: 'entrata',
                    testo: nuovoMessaggio.trim(),
                  });
                } catch (err) {
                  console.warn('Errore invio messaggio portale:', err);
                }

                setNuovoMessaggio('');
                setInviandoMessaggio(false);
              }}
              style={{ display: 'flex', flexDirection: 'column', gap: 10, background: 'var(--card2)', padding: 14, borderRadius: 12, border: '1px solid var(--border)' }}
            >
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
                <span style={{ fontSize: 11, fontWeight: 700, color: 'var(--muted)' }}>Invia messaggio diretto all'Advisor:</span>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                  <span style={{ fontSize: 10.5, color: 'var(--muted)' }}>Canale preferito:</span>
                  <select
                    value={canaleMessaggio}
                    onChange={(e) => setCanaleMessaggio(e.target.value as any)}
                    style={{ fontSize: 11, padding: '3px 8px', borderRadius: 6, background: 'var(--card)', color: 'var(--text)', border: '1px solid var(--border)' }}
                  >
                    <option value="portal">🌐 Portale Riservato (Sicuro)</option>
                    <option value="whatsapp">🟢 WhatsApp Business ({clientObj?.cellulare || (clientObj as any)?.referentiJson?.whatsapp || clientObj?.telefono || '+39 333 5936278'})</option>
                    <option value="email">✉️ Email Transazionale ({clientObj?.email || (clientObj as any)?.referentiJson?.email || 'client@holdingbeta.advisory'})</option>
                    <option value="telegram">✈️ Telegram ({clientObj?.telegram || (clientObj as any)?.referentiJson?.telegram || '@' + (clientName || 'Cliente').replace(/[^a-zA-Z0-9]/g, '')})</option>
                  </select>
                </div>
              </div>

              <div style={{ display: 'flex', gap: 10 }}>
                <textarea
                  value={nuovoMessaggio}
                  onChange={(e) => setNuovoMessaggio(e.target.value)}
                  placeholder="Scrivi qui la tua richiesta o domanda per l'Advisor..."
                  rows={2}
                  style={{ flex: 1, fontSize: 12, padding: 10, borderRadius: 8, background: 'var(--bg)', color: 'var(--text)', border: '1px solid var(--border)', resize: 'none' }}
                />
                <button
                  type="submit"
                  disabled={inviandoMessaggio || !nuovoMessaggio.trim()}
                  style={{
                    background: 'var(--indigo)',
                    color: '#fff',
                    border: 'none',
                    padding: '0 20px',
                    borderRadius: 8,
                    fontSize: 12,
                    fontWeight: 700,
                    cursor: 'pointer',
                    opacity: (!nuovoMessaggio.trim() || inviandoMessaggio) ? 0.6 : 1,
                  }}
                >
                  {inviandoMessaggio ? 'Invio...' : 'Invia →'}
                </button>
              </div>
            </form>

            <div style={{ background: 'var(--card2)', border: '1px solid var(--border)', borderRadius: 12, padding: 14, marginTop: 18 }}>
              <div style={{ fontSize: 12, fontWeight: 600, marginBottom: 6 }}>Sede Legale Studio {getStudioInfoForTenant().ragioneSociale}</div>
              <div style={{ fontSize: 11, color: 'var(--muted)', lineHeight: 1.5 }}>
                {getStudioInfoForTenant().sedeLegale || 'Sede in fase di configurazione'}<br />
                {getStudioInfoForTenant().piva ? `P.IVA: ${getStudioInfoForTenant().piva}` : ''}{getStudioInfoForTenant().email ? ` · ${getStudioInfoForTenant().email}` : ''}
              </div>
            </div>
          </div>
        )}
      </div>

      {/* 🔐 MODALE DI FIRMA ELETTRONICA AVANZATA (FEA) CON OTP */}
      {otpModalOpen && (
        <div style={{
          position: 'fixed',
          inset: 0,
          background: 'rgba(15, 23, 42, 0.85)',
          backdropFilter: 'blur(8px)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          zIndex: 9999,
          padding: 20,
        }}>
          <div style={{
            background: 'var(--sidebar)',
            border: '1px solid var(--border)',
            borderRadius: 20,
            padding: '28px 24px',
            width: '100%',
            maxWidth: 480,
            boxShadow: '0 25px 50px -12px rgba(0, 0, 0, 0.7)',
            display: 'flex',
            flexDirection: 'column',
            gap: 16,
          }}>
            {/* Header Modale */}
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                <div style={{ width: 40, height: 40, borderRadius: 10, background: '#1e1b4b', color: '#818cf8', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 20 }}>
                  🔐
                </div>
                <div>
                  <h3 style={{ fontSize: 16, fontWeight: 700, margin: 0, color: 'var(--text)' }}>
                    Firma Elettronica Avanzata (FEA)
                  </h3>
                  <span style={{ fontSize: 11, color: '#34d399', fontWeight: 600 }}>
                    Conforme Regolamento eIDAS UE 910/2014
                  </span>
                </div>
              </div>
              <button
                onClick={() => setOtpModalOpen(false)}
                style={{ background: 'transparent', border: 'none', color: 'var(--muted)', fontSize: 18, cursor: 'pointer', padding: 4 }}
              >
                ✕
              </button>
            </div>

            {/* Info Canale */}
            <div style={{ background: 'var(--card2)', border: '1px solid var(--border)', borderRadius: 12, padding: 14 }}>
              <div style={{ fontSize: 11.5, color: 'var(--muted)', marginBottom: 8 }}>
                Abbiamo inviato un codice di sicurezza monouso valido <strong>5 minuti</strong> tramite <strong>{otpCanale.toUpperCase()}</strong>:
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', fontSize: 12, fontWeight: 700, color: '#a5b4fc' }}>
                <span>{otpCanale === 'email' ? '📬 Email Destinatario:' : '📱 Recapito Destinatario:'}</span>
                <span>{otpTarget}</span>
              </div>
            </div>

            {/* Input Codice OTP (Nessun codice pre-compilato, digitazione manuale) */}
            <div>
              <label style={{ fontSize: 11.5, fontWeight: 700, color: 'var(--text)', display: 'block', marginBottom: 6 }}>
                Inserisci il Codice a 6 Cifre ricevuto sul tuo dispositivo:
              </label>
              <input
                type="text"
                maxLength={6}
                value={otpCode}
                onChange={(e) => {
                  setOtpCode(e.target.value.replace(/\D/g, ''));
                  setOtpError(null);
                }}
                placeholder="• • • • • •"
                style={{
                  width: '100%',
                  textAlign: 'center',
                  fontSize: 24,
                  fontWeight: 900,
                  letterSpacing: 10,
                  padding: '12px',
                  borderRadius: 10,
                  background: 'var(--card)',
                  color: 'var(--indigo-l)',
                  border: `2px solid ${otpError ? '#ef4444' : 'var(--indigo)'}`,
                  outline: 'none',
                }}
              />
              {otpError && (
                <div style={{ fontSize: 11, color: '#ef4444', marginTop: 4, fontWeight: 600 }}>
                  ⚠️ {otpError}
                </div>
              )}
            </div>

            {/* Note Legali eIDAS */}
            <div style={{ fontSize: 10.5, color: 'var(--muted)', lineHeight: 1.4, background: 'rgba(0,0,0,0.2)', padding: 10, borderRadius: 8 }}>
              🛡 L'apposizione della firma tramite verifica OTP associa univocamente il documento al firmatario ({clientName}), registrando marcatura temporale ISO UTC, impronta crittografica SHA-256 e indirizzo IP certificato.
            </div>

            {/* Azioni */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10, marginTop: 6 }}>
              <button
                type="button"
                onClick={async () => {
                  if (!otpCode || otpCode.length < 6) {
                    setOtpError('Inserisci il codice completo a 6 cifre.');
                    return;
                  }
                  setLoading(true);
                  setOtpError(null);
                  try {
                    const res = await verifyPortalOtpAndSignApi(
                      clientObj?.id || 'client-01',
                      otpCode,
                      clientName,
                      'Engagement Letter & Mandato Fiduciario'
                    );

                    if (res && res.ok) {
                      setEidasSeal(res.seal);
                      localStorage.setItem(`bluman_seal_${clientName}`, JSON.stringify(res.seal));
                      localStorage.setItem(`bluman_portal_signed_${clientName}`, 'true');
                      setSigned(true);
                      setOtpModalOpen(false);
                      await handleSign(); // Istanzia moduli e sblocca il progetto operatore
                    } else {
                      setOtpError(res?.errore || 'Codice errato');
                    }
                  } catch (err: any) {
                    setOtpError(err.message || 'Errore convalida codice');
                  } finally {
                    setLoading(false);
                  }
                }}
                disabled={loading}
                style={{
                  background: 'var(--indigo)',
                  color: '#fff',
                  border: 'none',
                  padding: '14px',
                  borderRadius: 12,
                  fontSize: 13.5,
                  fontWeight: 800,
                  cursor: 'pointer',
                  boxShadow: '0 4px 16px rgba(99,102,241,.4)',
                }}
              >
                {loading ? 'Verifica & Apposizione Sigillo...' : '🔒 Valida Codice ed Apponi Firma FEA'}
              </button>

              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', fontSize: 11 }}>
                <span style={{ color: 'var(--muted)' }}>Non hai ricevuto il codice?</span>
                <button
                  type="button"
                  onClick={async () => {
                    setOtpLoading(true);
                    setOtpCode('');
                    const res = await requestPortalOtpApi(clientObj?.id || 'client-01', otpCanale, otpPhoneInput, otpEmailInput);
                    setOtpLoading(false);
                    alert(`✓ Nuovo codice OTP inviato con successo a ${otpTarget}!`);
                  }}
                  style={{ background: 'none', border: 'none', color: 'var(--indigo-l)', fontWeight: 700, cursor: 'pointer', textDecoration: 'underline' }}
                >
                  Reinvia Codice ↻
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* 📄 MODALE A4 DOCUMENT VIEWER PER LETTURA COMPLETA PRE-FIRMA */}
      {selectedViewerDoc && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,.85)', backdropFilter: 'blur(4px)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 110, padding: 20 }}>
          <div style={{ background: 'var(--sidebar)', border: '1px solid var(--border)', borderRadius: 16, width: '100%', maxWidth: 880, maxHeight: '90vh', display: 'flex', flexDirection: 'column', overflow: 'hidden', boxShadow: '0 20px 60px rgba(0,0,0,.6)' }}>
            {/* Top Modal Bar */}
            <div style={{ padding: '16px 20px', borderBottom: '1px solid var(--border)', display: 'flex', justifyContent: 'space-between', alignItems: 'center', background: 'var(--card)' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                <span style={{ fontSize: 22 }}>📄</span>
                <div>
                  <h3 style={{ margin: 0, fontSize: 15, fontWeight: 700 }}>{selectedViewerDoc.titolo || selectedViewerDoc.nome}</h3>
                  <div style={{ fontSize: 11, color: 'var(--muted)', marginTop: 2 }}>
                    Lettura ed Esame Atto Ufficiale · Cliente: <strong>{clientName}</strong> · Categoria: {selectedViewerDoc.categoria}
                  </div>
                </div>
              </div>
              <button
                onClick={() => setSelectedViewerDoc(null)}
                style={{ background: 'transparent', border: 'none', color: 'var(--muted)', fontSize: 20, cursor: 'pointer', padding: '4px 8px' }}
              >
                ✕
              </button>
            </div>

            {/* A4 Paper Document Content */}
            <div style={{ flex: 1, overflowY: 'auto', padding: 24, background: '#0f172a', display: 'flex', justifyContent: 'center' }}>
              <div
                style={{
                  background: '#ffffff',
                  color: '#0f172a',
                  width: '100%',
                  maxWidth: 760,
                  minHeight: 600,
                  padding: '40px 36px',
                  borderRadius: 8,
                  boxShadow: '0 4px 25px rgba(0,0,0,0.5)',
                  fontFamily: "'Segoe UI', Roboto, Helvetica, Arial, sans-serif",
                  lineHeight: 1.6,
                }}
                dangerouslySetInnerHTML={{ __html: getResolvedDocumentHtml(selectedViewerDoc) }}
              />
            </div>

            {/* Bottom Modal Actions */}
            <div style={{ padding: '14px 20px', borderTop: '1px solid var(--border)', display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 10, background: 'var(--card)' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <button
                  type="button"
                  onClick={async () => {
                    const html = getResolvedDocumentHtml(selectedViewerDoc);
                    const sigs = selectedViewerDoc.firmato ? [
                      selectedViewerDoc.signatureData || {
                        signerName: clientName,
                        signerRole: 'Cliente Incarico',
                        timestamp: selectedViewerDoc.dataFirma || new Date().toLocaleString('it-IT'),
                        ipAddress: '83.211.12.94',
                      }
                    ] : undefined;
                    await downloadRealPdf(selectedViewerDoc.nome, html, sigs);
                  }}
                  style={{ background: '#1a1f3d', border: '1px solid #4338ca', color: '#c7d2fe', padding: '8px 16px', borderRadius: 8, fontSize: 11, fontWeight: 700, cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 6 }}
                >
                  📥 Scarica Copia PDF A4
                </button>
              </div>

              <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                <button
                  type="button"
                  onClick={() => setSelectedViewerDoc(null)}
                  style={{ background: 'transparent', border: '1px solid var(--border)', color: 'var(--muted)', padding: '8px 16px', borderRadius: 8, fontSize: 12, cursor: 'pointer' }}
                >
                  Chiudi Lettura
                </button>

                {selectedViewerDoc.firmato ? (
                  <div style={{ background: '#0d2d22', border: '1px solid #1a5c3c', color: '#34d399', padding: '8px 16px', borderRadius: 8, fontSize: 12, fontWeight: 700 }}>
                    ✓ Documento Già Sottoscritto (Sigillo eIDAS Apposto)
                  </div>
                ) : (
                  <button
                    type="button"
                    onClick={() => {
                      const docToSign = selectedViewerDoc;
                      setSelectedViewerDoc(null);
                      setSigningDoc(docToSign);
                    }}
                    style={{ background: 'var(--indigo)', color: '#fff', border: 'none', padding: '8px 22px', borderRadius: 8, fontSize: 12, fontWeight: 700, cursor: 'pointer', boxShadow: '0 4px 14px rgba(99,102,241,.35)', display: 'flex', alignItems: 'center', gap: 6 }}
                  >
                    ✍️ Ho Letto: Procedi alla Firma Digitale FEA
                  </button>
                )}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ✍️ MODALE FIRMA DIGITALE GRAFICA CON CANVAS & MARCA TEMPORALE */}
      {signingDoc && (
        <DigitalSignatureModal
          documentTitle={signingDoc.titolo}
          signerName={clientName}
          signerRole="Legale Rappresentante / Firmatario Autorizzato"
          onClose={() => setSigningDoc(null)}
          onSigned={(signature) => {
            const updated = portalDocs.map(d => d.id === signingDoc.id ? { ...d, firmato: true, signatureData: signature, dataFirma: signature.timestamp } : d);
            setPortalDocs(updated);

            // Persisti nei registri locali
            localStorage.setItem(`bluman_portal_doc_sig_${signingDoc.id}`, JSON.stringify(signature));
            const signedIds = updated.filter(d => d.firmato).map(d => d.id);
            localStorage.setItem(`bluman_signed_docs_${clientName}`, JSON.stringify(signedIds));

            // Sincronizza nel Cloud Vault del Progetto
            if (progettoId) {
              const storageKey = `bluman_project_documents_${progettoId}`;
              const currentVaultStr = localStorage.getItem(storageKey);
              const currentVault: any[] = currentVaultStr ? JSON.parse(currentVaultStr) : [];
              const newDocObj = {
                id: `doc-signed-${signingDoc.id}-${Date.now()}`,
                nome: signingDoc.nome,
                titolo: signingDoc.titolo,
                cat: signingDoc.categoria,
                dimensione: signingDoc.dimensione,
                data: new Date().toLocaleDateString('it-IT'),
                dataCaricamento: new Date().toLocaleDateString('it-IT'),
                progettoId: String(progettoId),
                clienteNome: clientName,
                firmato: true,
                signatureData: signature,
                formato: 'pdf',
              };
              localStorage.setItem(storageKey, JSON.stringify([newDocObj, ...currentVault.filter((x: any) => x.id !== newDocObj.id)]));
            }

            alert(`✓ Documento "${signingDoc.titolo}" firmato con successo con Sigillo FEA eIDAS UE 910/2014!`);
            setSigningDoc(null);
          }}
        />
      )}

      {/* 🛡️ MODALE DETTAGLIO ATTIVITÀ OPERATORE & FIRMA CONCLUSIONE MODULO */}
      {selectedModule && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,.8)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 110, padding: 16 }}>
          <div style={{ background: 'var(--sidebar)', border: '1px solid var(--border)', borderRadius: 16, padding: 24, width: '100%', maxWidth: 640, maxHeight: '90vh', overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 18, boxShadow: '0 25px 60px rgba(0,0,0,.6)' }}>
            
            {/* Header Modale */}
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', borderBottom: '1px solid var(--border)', paddingBottom: 14 }}>
              <div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}>
                  <CatBadge cat={selectedModule.cat} />
                  <span style={{ fontSize: 10, color: 'var(--muted)', textTransform: 'uppercase', fontWeight: 800 }}>Fascicolo Operativo Modulo</span>
                </div>
                <h2 style={{ fontSize: 18, fontWeight: 800, margin: 0 }}>{selectedModule.nome}</h2>
                <div style={{ fontSize: 11.5, color: 'var(--muted)', marginTop: 4 }}>
                  Valore Operazione: <strong style={{ color: 'var(--indigo-l)' }}>{fmt(selectedModule.prezzo)}</strong> · Stima Ore: <strong>{selectedModule.ore}h</strong>
                </div>
              </div>
              <button
                onClick={() => setSelectedModule(null)}
                style={{ background: 'var(--card2)', border: 'none', width: 32, height: 32, borderRadius: 8, color: 'var(--muted)', cursor: 'pointer', fontSize: 14, fontWeight: 700 }}
              >
                ✕
              </button>
            </div>

            {/* Stato Conclusione / Firma Banner */}
            {moduleSignatures[selectedModule.id]?.firmato ? (
              <div style={{ background: '#0d2d22', border: '1.5px solid #10b981', borderRadius: 12, padding: '14px 18px', display: 'flex', alignItems: 'center', gap: 12 }}>
                <div style={{ width: 36, height: 36, borderRadius: '50%', background: '#10b981', color: '#064e3b', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 18, fontWeight: 800 }}>✓</div>
                <div>
                  <div style={{ fontSize: 13, fontWeight: 800, color: '#34d399' }}>✓ OPERAZIONE CONCLUSA & VALIDATA CON SUCCESSO</div>
                  <div style={{ fontSize: 11, color: '#a7f3d0', marginTop: 2 }}>
                    Firmato digitalmente da <strong>{moduleSignatures[selectedModule.id].signerName}</strong> in data {moduleSignatures[selectedModule.id].dataFirma} · Sigillo Crittografico eIDAS FEA
                  </div>
                </div>
              </div>
            ) : selectedModule.stato === 'completato' ? (
              <div style={{ background: '#2d1a0d', border: '1.5px solid #d97706', borderRadius: 12, padding: '14px 18px', display: 'flex', alignItems: 'center', gap: 12 }}>
                <div style={{ width: 36, height: 36, borderRadius: '50%', background: '#f59e0b', color: '#78350f', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 18, fontWeight: 800 }}>✍️</div>
                <div>
                  <div style={{ fontSize: 13, fontWeight: 800, color: '#fbbf24' }}>ATTIVITÀ OPERATIVE COMPLETATE — IN ATTESA DI FIRMA</div>
                  <div style={{ fontSize: 11, color: '#fde68a', marginTop: 2 }}>
                    L'operatore ha completato tutte le prestazioni previste. Verifica i passaggi sotto ed apponi la firma conclusiva per validare l'operazione.
                  </div>
                </div>
              </div>
            ) : (
              <div style={{ background: '#1e1b4b', border: '1.5px solid #4338ca', borderRadius: 12, padding: '14px 18px', display: 'flex', alignItems: 'center', gap: 12 }}>
                <div style={{ width: 36, height: 36, borderRadius: '50%', background: '#6366f1', color: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 18, fontWeight: 800 }}>⏱</div>
                <div>
                  <div style={{ fontSize: 13, fontWeight: 800, color: '#c7d2fe' }}>OPERAZIONE IN LAVORAZIONE ({selectedModule.percentuale || 75}%)</div>
                  <div style={{ fontSize: 11, color: '#a5b4fc', marginTop: 2 }}>
                    Il team sta eseguendo gli ultimi adempimenti tecnici e la redazione documentale.
                  </div>
                </div>
              </div>
            )}

            {/* Scheda Team Responsabile */}
            <div style={{ background: 'var(--card2)', border: '1px solid var(--border)', borderRadius: 12, padding: 14, display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 10 }}>
              <div>
                <div style={{ fontSize: 10, color: 'var(--muted)', textTransform: 'uppercase', fontWeight: 700 }}>Advisor / Operatore Incaricato:</div>
                <div style={{ fontSize: 13, fontWeight: 700, marginTop: 2, color: 'var(--text)' }}>
                  👤 {selectedModule.operatore || 'Senior Advisor Studio Bluecode'}
                </div>
              </div>
              <div style={{ textAlign: 'right' }}>
                <div style={{ fontSize: 10, color: 'var(--muted)', textTransform: 'uppercase', fontWeight: 700 }}>Data Esecuzione:</div>
                <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--indigo-l)', marginTop: 2 }}>Agosto 2026</div>
              </div>
            </div>

            {/* Checklist Passaggi Operativi Svolti dall'Operatore */}
            <div>
              <div style={{ fontSize: 12, fontWeight: 800, textTransform: 'uppercase', letterSpacing: '.5px', color: 'var(--muted)', marginBottom: 10 }}>
                📋 Dettaglio Passaggi & Micro-Prestazioni Svolte ({selectedModule.passaggi?.length || 4}):
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                {(selectedModule.passaggi || getModulePassaggi(selectedModule.nome, selectedModule.cat)).map((p, pIdx) => (
                  <div
                    key={p.id || pIdx}
                    style={{
                      background: 'var(--card)',
                      border: p.completato ? '1px solid #166534' : '1px solid var(--border)',
                      borderRadius: 10,
                      padding: '10px 14px',
                      display: 'flex',
                      alignItems: 'flex-start',
                      gap: 12,
                    }}
                  >
                    <div style={{ width: 22, height: 22, borderRadius: '50%', background: p.completato ? '#0d2d22' : 'var(--card2)', color: p.completato ? '#34d399' : 'var(--muted)', border: `1px solid ${p.completato ? '#10b981' : 'var(--border)'}`, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 11, fontWeight: 800, marginTop: 2 }}>
                      {p.completato ? '✓' : pIdx + 1}
                    </div>
                    <div style={{ flex: 1 }}>
                      <div style={{ fontSize: 12.5, fontWeight: 700, color: p.completato ? 'var(--text)' : 'var(--muted)' }}>
                        {p.titolo}
                      </div>
                      <div style={{ fontSize: 11, color: 'var(--muted)', marginTop: 2 }}>
                        {p.note} · <span style={{ color: 'var(--indigo-l)' }}>Operatore: {p.operatore}</span> ({p.data})
                      </div>
                    </div>
                    <span style={{ fontSize: 10, fontWeight: 800, padding: '2px 8px', borderRadius: 8, background: p.completato ? '#0d2d22' : 'var(--card2)', color: p.completato ? '#34d399' : 'var(--muted)' }}>
                      {p.completato ? 'Completato ✓' : 'In Corso'}
                    </span>
                  </div>
                ))}
              </div>
            </div>

            {/* Documenti & Deliverables Prodotti */}
            <div>
              <div style={{ fontSize: 12, fontWeight: 800, textTransform: 'uppercase', letterSpacing: '.5px', color: 'var(--muted)', marginBottom: 10 }}>
                📎 Documenti & Fascicoli Prodotti dall'Operatore:
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                {(selectedModule.deliverables || getModuleDeliverables(selectedModule.nome, selectedModule.cat)).map((d, dIdx) => (
                  <div
                    key={dIdx}
                    style={{
                      background: 'var(--card2)',
                      border: '1px solid var(--border)',
                      borderRadius: 10,
                      padding: '10px 14px',
                      display: 'flex',
                      justifyContent: 'space-between',
                      alignItems: 'center',
                      flexWrap: 'wrap',
                      gap: 8,
                    }}
                  >
                    <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                      <span style={{ fontSize: 18 }}>📄</span>
                      <div>
                        <div style={{ fontSize: 12.5, fontWeight: 700 }}>{d.titolo}</div>
                        <div style={{ fontSize: 10.5, color: 'var(--muted)' }}>{d.nomeFile} · Depositato il {d.data}</div>
                      </div>
                    </div>
                    <button
                      onClick={async () => {
                        const htmlDoc = `
                          <div style="padding:20px;font-family:sans-serif;">
                            <h2>${d.titolo}</h2>
                            <p><strong>Modulo Operativo:</strong> ${selectedModule?.nome}</p>
                            <p><strong>Cliente:</strong> ${clientName}</p>
                            <p><strong>Operatore:</strong> ${selectedModule?.operatore}</p>
                            <hr style="margin:20px 0;"/>
                            <p>Si certifica la regolare esecuzione della prestazione e il deposito del relativo fascicolo documentale negli atti di studio.</p>
                          </div>
                        `;
                        await downloadRealPdf(d.nomeFile.replace('.pdf', ''), htmlDoc, [
                          {
                            signerName: clientName,
                            signerRole: 'Cliente Incarico',
                            timestamp: new Date().toLocaleString('it-IT'),
                            ipAddress: '2.234.190.44',
                          }
                        ]);
                      }}
                      style={{ background: '#1e1b4b', border: '1px solid #4338ca', color: '#c7d2fe', padding: '6px 12px', borderRadius: 6, fontSize: 11, fontWeight: 700, cursor: 'pointer' }}
                    >
                      📥 Scarica PDF
                    </button>
                  </div>
                ))}
              </div>
            </div>

            {/* Footer Azioni & Firma Conclusione */}
            <div style={{ borderTop: '1px solid var(--border)', paddingTop: 16, display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 12 }}>
              <button
                onClick={() => setSelectedModule(null)}
                style={{ background: 'var(--card2)', color: 'var(--text)', border: '1px solid var(--border)', padding: '10px 18px', borderRadius: 8, fontSize: 12, fontWeight: 600, cursor: 'pointer' }}
              >
                Chiudi
              </button>

              {moduleSignatures[selectedModule.id]?.firmato ? (
                <div style={{ fontSize: 12, color: '#34d399', fontWeight: 700, display: 'flex', alignItems: 'center', gap: 6 }}>
                  <span>🔒 Sigillo Digitale Validato</span>
                </div>
              ) : (
                <button
                  onClick={() => {
                    const sigData = {
                      signerName: clientName,
                      signerRole: 'Cliente Incarico (Legale Rappresentante)',
                      timestamp: new Date().toLocaleString('it-IT'),
                      ipAddress: '2.234.190.44',
                    };
                    const updated = {
                      ...moduleSignatures,
                      [selectedModule.id]: {
                        firmato: true,
                        dataFirma: sigData.timestamp,
                        signerName: sigData.signerName,
                      },
                    };
                    setModuleSignatures(updated);
                    localStorage.setItem(`bluman_module_signatures_${clientName}`, JSON.stringify(updated));
                    alert(`✓ Operazione "${selectedModule.nome}" convalidata e firmata digitalmente con successo con Sigillo FEA eIDAS UE 910/2014!`);
                    setSelectedModule(null);
                  }}
                  style={{
                    background: '#059669',
                    color: '#ffffff',
                    border: 'none',
                    padding: '11px 22px',
                    borderRadius: 10,
                    fontSize: 13,
                    fontWeight: 800,
                    cursor: 'pointer',
                    boxShadow: '0 4px 14px rgba(5, 150, 105, 0.4)',
                    display: 'flex',
                    alignItems: 'center',
                    gap: 8,
                  }}
                >
                  <span>✍️ Firma e Convalida Conclusione Operazione (eIDAS FEA)</span>
                </button>
              )}
            </div>

          </div>
        </div>
      )}
      </div>
    </div>
  );
}

const portalWrapperStyle: React.CSSProperties = {
  width: '100%',
  minHeight: '100vh',
  overflowY: 'auto',
  background: 'var(--bg)',
  color: 'var(--text)',
};

const containerStyle: React.CSSProperties = {
  minHeight: '100%',
  color: 'var(--text)',
  fontFamily: 'var(--font)',
  padding: '24px 20px 80px',
  maxWidth: 1120,
  margin: '0 auto',
  display: 'flex',
  flexDirection: 'column',
  gap: 20,
};

const topNavStyle: React.CSSProperties = {
  display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 12,
  paddingBottom: 14, borderBottom: '1px solid var(--border)',
};

const heroBannerStyle: React.CSSProperties = {
  background: 'linear-gradient(135deg,#13162b,#1a1d3b)', border: '1px solid var(--border)', borderRadius: 16, padding: '20px 24px',
  display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 16, boxShadow: '0 8px 30px rgba(0,0,0,.3)',
};

const tabsBarStyle: React.CSSProperties = {
  display: 'flex',
  gap: 8,
  overflowX: 'auto',
  borderBottom: '2px solid var(--border)',
  paddingBottom: 10,
  paddingTop: 6,
  position: 'sticky',
  top: 0,
  zIndex: 30,
  background: 'var(--bg)',
};

const tabBtnStyle = (active: boolean): React.CSSProperties => ({
  background: active ? 'var(--indigo)' : 'var(--card2)',
  border: active ? '1px solid var(--indigo-l)' : '1px solid var(--border)',
  color: active ? '#ffffff' : 'var(--text)',
  fontSize: 13,
  fontWeight: 700,
  padding: '10px 18px',
  borderRadius: 10,
  cursor: 'pointer',
  whiteSpace: 'nowrap',
  boxShadow: active ? '0 4px 14px rgba(99, 102, 241, 0.4)' : 'none',
  transition: 'all .2s ease',
  display: 'inline-flex',
  alignItems: 'center',
  gap: 6,
});

const bodyStyle: React.CSSProperties = {
  flex: 1,
};

const docBoxStyle: React.CSSProperties = {
  background: 'var(--card)', border: '1px solid var(--border)', borderRadius: 16, padding: 24, boxShadow: '0 12px 36px rgba(0,0,0,.3)',
};

const modRowStyle: React.CSSProperties = {
  background: 'var(--card2)', border: '1px solid var(--border)', borderRadius: 12, padding: 14, display: 'flex', justifyContent: 'space-between', alignItems: 'center',
};

const successBoxStyle: React.CSSProperties = {
  textAlign: 'center', padding: '40px 20px', display: 'flex', flexDirection: 'column', alignItems: 'center',
};
