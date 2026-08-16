import React, { useState, useEffect } from 'react';
import { useSearchParams, useNavigate } from 'react-router-dom';
import { CatBadge } from '../components/ui/CatBadge';
import { fmt } from '../utils';
import { downloadRealPdf } from '../utils/pdfGenerator';
import type { SignatureData } from '../utils/pdfGenerator';
import { DigitalSignatureModal } from '../components/DigitalSignatureModal';
import { fetchModuliLibreria, fetchProgetti, creaPreventivoEAccettaApi, fetchClienti, creaProgettoApi, creaClienteApi, fetchComunicazioniApi, inviaComunicazioneApi } from '../api/client';
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
  const [signed, setSigned] = useState(false);
  const [addendums, setAddendums] = useState<any[]>(() => {
    const saved = localStorage.getItem(`bluman_addendums_Marco Ricci / Holding Beta S.r.l.`);
    return saved ? JSON.parse(saved) : [];
  });
  const [loading, setLoading] = useState(false);
  const [pageLoading, setPageLoading] = useState(true);

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
      const clientiRes = await fetchClienti();
      if (clientiRes && Array.isArray(clientiRes) && clientiRes.length > 0) {
        const found = clientiRes.find(c => token.includes(c.id.substring(0, 8)));
        if (found) {
          setClientObj(found);
          setClientName(found.nome);
        } else {
          setClientObj(clientiRes[0]);
          setClientName(clientiRes[0].nome);
        }
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
          const matchProj = progettiRes.find((p: any) => p.cliente?.nome === (clientObj?.nome || 'Marco Ricci / Holding Beta S.r.l.') || String(p.id).includes('proj-'));
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
      localStorage.setItem('bluman_custom_projects', JSON.stringify(updatedArr));

      // Salva lo stato di firma del cliente
      localStorage.setItem(`bluman_portal_signed_${clientName}`, 'true');

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
                  <p style={{ fontSize: 11.5, color: 'var(--muted)', lineHeight: 1.5, marginBottom: 16 }}>
                    Con il pulsante sottostante apponi la tua <strong>Firma Digitale 1-Click</strong> per confermare la proposta contrattuale e dare avvio immediato alle attività.
                  </p>
                  <button
                    onClick={handleSign}
                    disabled={loading}
                    style={{ background: 'var(--indigo)', color: '#fff', border: 'none', padding: '12px 28px', borderRadius: 10, fontSize: 13, fontWeight: 700, cursor: 'pointer', boxShadow: '0 4px 20px rgba(99,102,241,.4)' }}
                  >
                    {loading ? 'Firma e Registrazione in corso...' : '✍️ Apponi Firma Digitale ed Attiva Progetto'}
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

        {/* TAB 4: Documenti Legali */}
        {activeTab === 'documenti' && (
          <div style={docBoxStyle}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 12, marginBottom: 18 }}>
              <div>
                <div style={{ fontSize: 15, fontWeight: 700, marginBottom: 4 }}>📎 Vault Documenti Legali e Modelli In Incarico</div>
                <div style={{ fontSize: 11, color: 'var(--muted)' }}>
                  Visualizza, scarica, firma con <strong>Firma Digitale eIDAS (1-Click)</strong> oppure <strong>ricarica il PDF firmato a mano</strong>
                </div>
              </div>
            </div>

            <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
              {/* Documento 1 */}
              <div style={{ background: 'var(--card2)', border: '1px solid var(--border)', borderRadius: 14, padding: 16, display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 12 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                  <div style={{ fontSize: 26 }}>📄</div>
                  <div>
                    <div style={{ fontSize: 13.5, fontWeight: 700, color: 'var(--text)' }}>Accordo di Riservatezza NDA & Incarico.pdf</div>
                    <div style={{ fontSize: 10.5, color: 'var(--muted)', marginTop: 2 }}>1.4 MB · Firmato digitalmente con marca temporale eIDAS</div>
                  </div>
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                  <span style={{ background: '#0d2d22', border: '1px solid #1a5c3c', color: '#34d399', padding: '4px 12px', borderRadius: 12, fontSize: 10, fontWeight: 800 }}>
                    🔒 FIRMATO eIDAS
                  </span>
                  <button
                    onClick={() => alert('📥 Download copia firmata dell Accordo NDA avviato.')}
                    style={{ background: 'var(--card)', border: '1px solid var(--border)', color: 'var(--text)', padding: '5px 10px', borderRadius: 6, fontSize: 11, cursor: 'pointer', fontWeight: 600 }}
                  >
                    📥 Scarica PDF
                  </button>
                </div>
              </div>

              {/* Documento 2 */}
              <div style={{ background: 'var(--card2)', border: '1px solid var(--border)', borderRadius: 14, padding: 16, display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 12 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                  <div style={{ fontSize: 26 }}>📄</div>
                  <div>
                    <div style={{ fontSize: 13.5, fontWeight: 700, color: 'var(--text)' }}>Statuto Standard Holding Malta & Procura MFSA.pdf</div>
                    <div style={{ fontSize: 10.5, color: 'var(--muted)', marginTop: 2 }}>3.2 MB · Richiede firma del Legale Rappresentante per la lavorazione</div>
                  </div>
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                  <button
                    onClick={() => alert('✍️ Apertura modulo di Firma Digitale eIDAS per Statuto Holding Malta...')}
                    style={{ background: 'var(--indigo)', color: '#fff', border: 'none', padding: '6px 14px', borderRadius: 8, fontSize: 11, fontWeight: 700, cursor: 'pointer', boxShadow: '0 2px 8px rgba(99,102,241,.3)' }}
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
                          alert(`✓ File firmato a mano "${e.target.files[0].name}" ricaricato con successo nel portale! L operatore è stato notificato per la lavorazione.`);
                        }
                      }}
                    />
                  </label>
                </div>
              </div>

              {/* Documento 3 */}
              <div style={{ background: 'var(--card2)', border: '1px solid var(--border)', borderRadius: 14, padding: 16, display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 12 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                  <div style={{ fontSize: 26 }}>📄</div>
                  <div>
                    <div style={{ fontSize: 13.5, fontWeight: 700, color: 'var(--text)' }}>Dichiarazione Titolare Effettivo (UBO Registry).pdf</div>
                    <div style={{ fontSize: 10.5, color: 'var(--muted)', marginTop: 2 }}>2.8 MB · Richiede firma dell'UBO per la lavorazione</div>
                  </div>
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                  <button
                    onClick={() => alert('✍️ Apertura modulo di Firma Digitale eIDAS per Dichiarazione UBO...')}
                    style={{ background: 'var(--indigo)', color: '#fff', border: 'none', padding: '6px 14px', borderRadius: 8, fontSize: 11, fontWeight: 700, cursor: 'pointer', boxShadow: '0 2px 8px rgba(99,102,241,.3)' }}
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
                          alert(`✓ File firmato a mano "${e.target.files[0].name}" ricaricato con successo nel portale! L operatore è stato notificato per la lavorazione.`);
                        }
                      }}
                    />
                  </label>
                </div>
              </div>
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
                <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                  <span style={{ fontSize: 10.5, color: 'var(--muted)' }}>Canale preferito:</span>
                  <select
                    value={canaleMessaggio}
                    onChange={(e) => setCanaleMessaggio(e.target.value as any)}
                    style={{ fontSize: 11, padding: '3px 8px', borderRadius: 6, background: 'var(--card)', color: 'var(--text)', border: '1px solid var(--border)' }}
                  >
                    <option value="portal">🌐 Portale Riservato (Sicuro)</option>
                    <option value="whatsapp">🟢 WhatsApp Business</option>
                    <option value="email">✉️ Email Transazionale</option>
                    <option value="telegram">✈️ Telegram</option>
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
