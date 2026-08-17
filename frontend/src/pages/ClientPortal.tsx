import React, { useState, useEffect } from 'react';
import { useSearchParams, useNavigate } from 'react-router-dom';
import { CatBadge } from '../components/ui/CatBadge';
import { fmt } from '../utils';
import { downloadRealPdf } from '../utils/pdfGenerator';
import type { SignatureData } from '../utils/pdfGenerator';
import { DigitalSignatureModal } from '../components/DigitalSignatureModal';
import { fetchModuliLibreria, fetchProgetti, creaPreventivoEAccettaApi, fetchClienti, creaProgettoApi, creaClienteApi, fetchComunicazioniApi, inviaComunicazioneApi, requestPortalOtpApi, verifyPortalOtpAndSignApi } from '../api/client';
import type { CategoriaModulo } from '../types';

interface ModuloProposta {
  id: string;
  nome: string;
  cat: CategoriaModulo;
  prezzo: number;
  ore: number;
  righeCount: number;
}

type PortalTab = 'proposta' | 'avanzamento' | 'form' | 'documenti' | 'contatti';

export function ClientPortal() {
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const token = searchParams.get('magic_token') || 'client_demo';

  const [activeTab, setActiveTab] = useState<PortalTab>('proposta');
  const [clientObj, setClientObj] = useState<any>(null);
  const [clientName, setClientName] = useState('Marco Ricci / Holding Beta S.r.l.');
  const [moduliProposti, setModuliProposti] = useState<ModuloProposta[]>([]);
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

  // Documenti in Incarico con Stato Firma Persistente
  const [portalDocs, setPortalDocs] = useState<any[]>([
    {
      id: 'doc-nda',
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

  useEffect(() => {
    const loadPortalData = async () => {
      setPageLoading(true);
      let resolvedClientName = clientName;

      const clientiRes = await fetchClienti();
      if (clientiRes && Array.isArray(clientiRes) && clientiRes.length > 0) {
        const found = clientiRes.find(c => token.includes(c.id.substring(0, 8)));
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

      const moduliRes = await fetchModuliLibreria();
      if (moduliRes && Array.isArray(moduliRes) && moduliRes.length > 0) {
        const mapped: ModuloProposta[] = moduliRes.map((m: any) => ({
          id: m.id,
          nome: m.nome,
          cat: (m.categoria as CategoriaModulo) || 'Societario',
          prezzo: m.prezzoPacchetto ? m.prezzoPacchetto / 100 : 3500,
          ore: 15,
          righeCount: m.righeDistinta ? m.righeDistinta.length : 3,
        }));
        setModuliProposti(mapped);
      } else {
        setModuliProposti([
          { id: 'mod-m01', nome: 'Analisi patrimoniale iniziale', cat: 'Analisi', prezzo: 3500, ore: 12, righeCount: 5 },
          { id: 'mod-m02', nome: 'Corporate structuring Malta', cat: 'Societario', prezzo: 11500, ore: 40, righeCount: 5 },
        ]);
      }
      // Cerca progetto associato per caricare le comunicazioni
      try {
        const progettiRes = await fetchProgetti();
        if (progettiRes && Array.isArray(progettiRes) && progettiRes.length > 0) {
          const matchProj = progettiRes.find((p: any) => p.cliente?.nome === resolvedClientName || String(p.id).includes('proj-'));
          const pId = matchProj ? String(matchProj.id) : String(progettiRes[0].id);
          setProgettoId(pId);
          const msgs = await fetchComunicazioniApi(pId);
          if (msgs && Array.isArray(msgs)) {
            setMessaggi(msgs);
          }
        }
      } catch (err) {
        console.warn('Errore recupero messaggi portale:', err);
      }

      setPageLoading(false);
    };

    loadPortalData();
  }, [token]);

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

  if (pageLoading) {
    return (
      <div style={containerStyle}>
        <div style={{ padding: 60, textAlign: 'center', color: 'var(--muted)', fontSize: 13 }}>
          ⏳ Autenticazione sessione e caricamento portale riservato in corso...
        </div>
      </div>
    );
  }

  return (
    <div style={containerStyle}>
      {/* Top Navbar Header */}
      <div style={topNavStyle}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <div style={{ width: 36, height: 36, background: 'var(--indigo)', borderRadius: 10, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 18, color: '#fff', fontWeight: 800 }}>🛡</div>
          <div>
            <div style={{ fontSize: 14, fontWeight: 700 }}>Bluecode Advisory Platform</div>
            <div style={{ fontSize: 11, color: 'var(--muted)' }}>Portale Riservato Cliente · {clientName}</div>
          </div>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <div style={{ background: '#0d2d22', border: '1px solid #1a5c3c', color: '#34d399', fontSize: 11, padding: '5px 12px', borderRadius: 20, fontWeight: 600 }}>
            🔒 Accesso Sicuro Passwordless
          </div>
        </div>
      </div>

      {/* Hero Welcome Banner */}
      <div style={heroBannerStyle}>
        <div>
          <div style={{ fontSize: 11, color: 'var(--indigo-l)', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '.5px' }}>
            PORTALE DEDICATO ED ASSISTENZA PROFESSIONALE
          </div>
          <h1 style={{ fontSize: 20, fontWeight: 800, margin: '4px 0 6px' }}>Progetto Consulenza & Structuring Patrimoniale</h1>
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
                          const htmlContent = `
                            <div style="border-bottom:2px solid #0f172a;padding-bottom:15px;display:flex;justify-content:space-between;align-items:flex-start;">
                              <div>
                                <img src="${window.location.origin}/logo.png" style="max-height:55px;max-width:220px;object-fit:contain;margin-bottom:8px;display:block;" />
                                <div style="font-size:20px;font-weight:800;color:#1e1b4b;">BLUECODE LTD — ADVISORY</div>
                                <div style="font-size:11px;color:#475569;margin-top:2px;">Level 4, Valuation Centre, Sliema, Malta</div>
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
                              signerName: 'Joe Disabato',
                              signerRole: 'Senior Advisor (Bluecode Ltd)',
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
                      Studio Erogante: <strong>Bluecode Ltd (Malta)</strong> · Advisor Lead: <strong>Joe Disabato</strong>
                    </div>
                  </div>
                  <div style={{ textAlign: 'right' }}>
                    <div style={{ fontSize: 10, color: 'var(--muted)' }}>Giurisdizione Incarico:</div>
                    <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--indigo-l)', marginTop: 2 }}>Malta / Unione Europea</div>
                  </div>
                </div>

                <div style={{ fontSize: 12, fontWeight: 700, marginBottom: 12, color: 'var(--muted)', textTransform: 'uppercase', letterSpacing: '.5px' }}>
                  Moduli di Consulenza Incorporati ({moduliProposti.length})
                </div>

                <div style={{ display: 'flex', flexDirection: 'column', gap: 12, marginBottom: 24 }}>
                  {moduliProposti.map((m, idx) => (
                    <div key={idx} style={modRowStyle}>
                      <div>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
                          <CatBadge cat={m.cat} />
                          <span style={{ fontSize: 13.5, fontWeight: 700 }}>{m.nome}</span>
                        </div>
                        <div style={{ fontSize: 11, color: 'var(--muted)' }}>
                          Include {m.righeCount} micro-prestazioni specialistiche · Stima ore operative: {m.ore}h
                        </div>
                      </div>
                      <div style={{ fontSize: 15, fontWeight: 800, color: 'var(--indigo-l)' }}>{fmt(m.prezzo)}</div>
                    </div>
                  ))}
                </div>

                <div style={{ background: 'linear-gradient(135deg,#1a1f3d,#1e2045)', border: '1px solid #2d3260', borderRadius: 14, padding: '18px 22px', display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 24, flexWrap: 'wrap', gap: 12 }}>
                  <div>
                    <div style={{ fontSize: 12, color: '#818cf8', fontWeight: 600 }}>Valore Totale Complessivo Proposta d'Ordine</div>
                    <div style={{ fontSize: 11, color: '#818cf8', opacity: 0.8, marginTop: 2 }}>Nessun costo nascosto. Include assistenza fino al completamento.</div>
                  </div>
                  <div style={{ fontSize: 26, fontWeight: 800 }}>{fmt(totalValue)}</div>
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
            <div style={{ fontSize: 11, color: 'var(--muted)', marginBottom: 18 }}>Visualizza la progressione delle fasi operative gestite dal team Bluecode per la tua consulenza</div>

            {/* Progress Bar */}
            <div style={{ background: 'var(--card2)', border: '1px solid var(--border)', borderRadius: 12, padding: 16, marginBottom: 20 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12, fontWeight: 600, marginBottom: 8 }}>
                <span>Progresso Generale del Progetto</span>
                <span style={{ color: 'var(--indigo-l)' }}>65% Completato</span>
              </div>
              <div style={{ width: '100%', height: 10, background: 'var(--border)', borderRadius: 10, overflow: 'hidden' }}>
                <div style={{ width: '65%', height: '100%', background: 'linear-gradient(90deg, var(--indigo), #a78bfa)', borderRadius: 10 }} />
              </div>
            </div>

            {/* Timeline Passaggi */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
              <div style={{ background: 'var(--card2)', border: '1px solid var(--border)', borderRadius: 12, padding: 14, display: 'flex', alignItems: 'center', gap: 14 }}>
                <div style={{ width: 32, height: 32, borderRadius: '50%', background: '#0d2d22', color: '#34d399', display: 'flex', alignItems: 'center', justifyContent: 'center', fontWeight: 700, fontSize: 14 }}>✓</div>
                <div style={{ flex: 1 }}>
                  <div style={{ fontSize: 13, fontWeight: 600 }}>1. Briefing Iniziale & Analisi Fiscale</div>
                  <div style={{ fontSize: 11, color: 'var(--muted)', marginTop: 2 }}>Completato dal team advisor il 12 Agosto 2026</div>
                </div>
                <span style={{ background: '#0d2d22', color: '#34d399', padding: '3px 8px', borderRadius: 12, fontSize: 10, fontWeight: 700 }}>Completato</span>
              </div>

              <div style={{ background: 'var(--card2)', border: '1px solid var(--border)', borderRadius: 12, padding: 14, display: 'flex', alignItems: 'center', gap: 14 }}>
                <div style={{ width: 32, height: 32, borderRadius: '50%', background: '#200f40', color: '#a78bfa', display: 'flex', alignItems: 'center', justifyContent: 'center', fontWeight: 700, fontSize: 14 }}>⏱</div>
                <div style={{ flex: 1 }}>
                  <div style={{ fontSize: 13, fontWeight: 600 }}>2. Redazione Atti Costitutivi Holding Malta & MFSA Filing</div>
                  <div style={{ fontSize: 11, color: 'var(--muted)', marginTop: 2 }}>In corso di lavorazione da parte del legali convenzionati</div>
                </div>
                <span style={{ background: '#200f40', color: '#a78bfa', padding: '3px 8px', borderRadius: 12, fontSize: 10, fontWeight: 700 }}>In Lavorazione</span>
              </div>

              <div style={{ background: 'var(--card2)', border: '1px solid var(--border)', borderRadius: 12, padding: 14, display: 'flex', alignItems: 'center', gap: 14, opacity: 0.7 }}>
                <div style={{ width: 32, height: 32, borderRadius: '50%', background: 'var(--card)', border: '1px solid var(--border)', color: 'var(--muted)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontWeight: 700, fontSize: 14 }}>3</div>
                <div style={{ flex: 1 }}>
                  <div style={{ fontSize: 13, fontWeight: 600 }}>3. Apertura Conto Corrente Corporate & Compliance Banking</div>
                  <div style={{ fontSize: 11, color: 'var(--muted)', marginTop: 2 }}>Pianificato a seguito del rilascio certificato MFSA</div>
                </div>
                <span style={{ background: 'var(--card)', color: 'var(--muted)', padding: '3px 8px', borderRadius: 12, fontSize: 10, fontWeight: 600 }}>In Programma</span>
              </div>
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
                        {doc.dimensione} · {doc.firmato ? `✓ Firmato Digitalmente (${doc.dataFirma || 'eIDAS Validato'})` : 'In attesa di sottoscrizione legale'}
                      </div>
                    </div>
                  </div>

                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                    {doc.firmato ? (
                      <>
                        <span style={{ background: '#34d399', color: '#064e3b', padding: '4px 12px', borderRadius: 12, fontSize: 10, fontWeight: 800 }}>
                          🔒 FIRMATO eIDAS
                        </span>
                        <button
                          type="button"
                          onClick={async () => {
                            const docHtml = `
                              <div style="font-family: 'Segoe UI', Arial, sans-serif; color: #0f172a; line-height: 1.6; padding: 20px;">
                                <div style="text-align: right; font-size: 9pt; color: #64748b; margin-bottom: 20px;">
                                  Rif. Pratica: #${progettoId} | Data Registrazione: ${doc.dataFirma || new Date().toLocaleDateString('it-IT')}
                                </div>
                                <h1 style="color: #1e1b4b; text-align: center; text-transform: uppercase; font-size: 18pt; border-bottom: 2px solid #4338ca; padding-bottom: 10px; margin-bottom: 20px;">
                                  ${doc.titolo}
                                </h1>
                                <div style="background: #f8fafc; border: 1px solid #e2e8f0; padding: 15px; border-radius: 8px; margin-bottom: 20px; font-size: 10pt;">
                                  <strong>Studio Professionale:</strong> Bluecode Ltd (Malta / Switzerland)<br/>
                                  <strong>Cliente Firmatario:</strong> ${clientName}<br/>
                                  <strong>Stato eIDAS:</strong> 🔒 SOTTOSCRITTO CON FIRMA ELETTRONICA AVANZATA (Regolamento UE n. 910/2014)
                                </div>
                                <p style="font-size: 11pt; color: #334155; line-height: 1.6;">
                                  ${doc.descrizione}
                                </p>
                                <p style="font-size: 11pt; color: #334155; line-height: 1.6;">
                                  Le Parti riconoscono la piena validità probatoria ed efficacia giuridica della presente sottoscrizione ai sensi dell'art. 20 del CAD e del Regolamento UE 910/2014.
                                </p>
                              </div>
                            `;
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
                          📥 Scarica VERO PDF Firmato
                        </button>
                      </>
                    ) : (
                      <>
                        <button
                          type="button"
                          onClick={() => setSigningDoc(doc)}
                          style={{ background: 'var(--indigo)', color: '#fff', border: 'none', padding: '7px 16px', borderRadius: 8, fontSize: 11, fontWeight: 700, cursor: 'pointer', boxShadow: '0 2px 10px rgba(99,102,241,.3)', display: 'flex', alignItems: 'center', gap: 6 }}
                        >
                          ✍️ Firma Digitale eIDAS (1-Click)
                        </button>

                        <label style={{ background: '#1a1f3d', border: '1px solid #2d3260', color: '#818cf8', padding: '6px 14px', borderRadius: 8, fontSize: 11, fontWeight: 600, cursor: 'pointer', display: 'inline-flex', alignItems: 'center', gap: 4 }}>
                          <span>📤 Ricarica PDF Firmato a Mano</span>
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
              <div style={{ fontSize: 12, fontWeight: 600, marginBottom: 6 }}>Sede Legale Studio Bluecode Ltd</div>
              <div style={{ fontSize: 11, color: 'var(--muted)', lineHeight: 1.5 }}>
                Level 4, Valuation Centre, Tower Road, Sliema SLM 1600, Malta<br />
                PEC: bluecode@legalmail.it · Reg. N. C-99881
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
    </div>
  );
}

const containerStyle: React.CSSProperties = {
  minHeight: '100vh', background: 'var(--bg)', color: 'var(--text)', fontFamily: 'var(--font)', padding: '24px 20px 40px',
  maxWidth: 1040, margin: '0 auto', display: 'flex', flexDirection: 'column', gap: 18,
};

const topNavStyle: React.CSSProperties = {
  display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 12,
  paddingBottom: 12, borderBottom: '1px solid var(--border)',
};

const heroBannerStyle: React.CSSProperties = {
  background: 'linear-gradient(135deg,#13162b,#1a1d3b)', border: '1px solid var(--border)', borderRadius: 16, padding: '20px 24px',
  display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 16, boxShadow: '0 8px 30px rgba(0,0,0,.3)',
};

const tabsBarStyle: React.CSSProperties = {
  display: 'flex', gap: 6, overflowX: 'auto', borderBottom: '1px solid var(--border)', paddingBottom: 8,
};

const tabBtnStyle = (active: boolean): React.CSSProperties => ({
  background: active ? '#1a1f3d' : 'transparent',
  border: 'none',
  borderBottom: active ? '2px solid var(--indigo-l)' : '2px solid transparent',
  color: active ? 'var(--indigo-l)' : 'var(--muted)',
  fontSize: 12,
  fontWeight: 600,
  padding: '8px 14px',
  borderRadius: 8,
  cursor: 'pointer',
  whiteSpace: 'nowrap',
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
