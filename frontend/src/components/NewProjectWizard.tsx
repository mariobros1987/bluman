import React, { useState, useEffect } from 'react';
import { CatBadge } from './ui/CatBadge';
import { fmt, moduloH, moduloP, resolveRighe } from '../utils';
import type { Cliente, Giurisdizione, ModuloTemplate, CategoriaModulo } from '../types';
import { fetchClienti, fetchGiurisdizioniApi, fetchModuliLibreria, creaClienteApi, creaProgettoApi, creaPreventivoEAccettaApi } from '../api/client';
import { fetchKycFascicoloApi, type FascicoloKyc } from '../api/kyc';
import { getCurrentTenantId, getTenantStorageKey } from '../utils/tenant';
import { Modal } from './ui/Modal';

interface NewProjectWizardProps {
  onClose: () => void;
  onProjectCreated?: () => void;
}

export function NewProjectWizard({ onClose, onProjectCreated }: NewProjectWizardProps) {
  const [step, setStep] = useState(0);

  // Giurisdizioni & Moduli State — partono vuoti e vengono caricati dal DB in mount
  const [giurisdizioni, setGiurisdizioni] = useState<Giurisdizione[]>([]);
  const [moduliList, setModuliList] = useState<ModuloTemplate[]>([]);
  const [selectedGiurId, setSelectedGiurId] = useState<string>('giur-mt'); // Default Malta
  const [showOtherGiurMods, setShowOtherGiurMods] = useState(false);
  // Modulo di cui mostrare il dettaglio (articoli, ore, importo) senza selezionarlo: l'operatore
  // apre la scheda con ℹ️, la consulta e la chiude — la selezione resta indipendente.
  const [detailMod, setDetailMod] = useState<ModuloTemplate | null>(null);

  // Client selection state
  const [existingClients, setExistingClients] = useState<Cliente[]>([]);
  const [clientMode, setClientMode] = useState<'existing' | 'new'>('existing');
  const [selectedClientId, setSelectedClientId] = useState<string>('');
  
  const [clientName, setClientName] = useState('');
  const [projectName, setProjectName] = useState('');
  const [clientType, setClientType] = useState<'individual' | 'company'>('individual');
  const [selectedMods, setSelectedMods] = useState<Set<string>>(new Set(['mod-m01', 'mod-m02']));
  const [loading, setLoading] = useState(false);
  const [notif, setNotif] = useState(false);
  const [errore, setErrore] = useState<string | null>(null);
  // Gate KYC in versione avviso (non bloccante): il fascicolo del cliente selezionato.
  const [kycFasc, setKycFasc] = useState<FascicoloKyc | null>(null);
  useEffect(() => {
    if (clientMode !== 'existing' || !selectedClientId) { setKycFasc(null); return; }
    let annullato = false;
    fetchKycFascicoloApi(selectedClientId)
      .then((r) => { if (!annullato) setKycFasc(r.fascicolo); })
      .catch(() => { if (!annullato) setKycFasc(null); });
    return () => { annullato = true; };
  }, [selectedClientId, clientMode]);

  // Fetch existing clients, jurisdictions & module templates on mount
  useEffect(() => {
    const loadInitData = async () => {
      const clientsRes = await fetchClienti();
      if (clientsRes && Array.isArray(clientsRes) && clientsRes.length > 0) {
        setExistingClients(clientsRes);
        setSelectedClientId(clientsRes[0].id);
        setClientName(clientsRes[0].nome);
        setClientType(clientsRes[0].tipo as any);
        setClientMode('existing');
      } else {
        setClientMode('new');
      }

      const giurRes = await fetchGiurisdizioniApi();
      if (giurRes && Array.isArray(giurRes) && giurRes.length > 0) {
        setGiurisdizioni(giurRes);
      }

      const modsRes = await fetchModuliLibreria();
      if (modsRes && Array.isArray(modsRes) && modsRes.length > 0) {
        const mappedMods: ModuloTemplate[] = modsRes.map((m: any) => ({
          id: m.id,
          n: m.nome,
          cat: m.categoria as CategoriaModulo,
          ver: m.versione || 1,
          deps: (m.dipendenze || []).map((d: any) => d.dipendeDaModuloTemplateId),
          pkg: m.prezzoPacchetto ? m.prezzoPacchetto / 100 : undefined,
          giurisdizioneId: m.giurisdizioneId,
          giurisdizione: m.giurisdizione,
          righe: (m.righeDistinta || []).map((r: any) => ({
            art: r.articoloId,
            qty: r.quantita,
            oO: r.overrideOre,
            oP: r.overridePrezzo ? r.overridePrezzo / 100 : undefined,
            // L'articolo completo dalla distinta (API: righeDistinta.articolo). Senza questo
            // `resolveRighe` non trova l'articolo nel pool (qui vuoto) e ripiega su un nome
            // generico «Prestazione» a 5h/€500: il dettaglio modulo mostrerebbe dati finti.
            // Con `artObj` i nomi, le ore e i prezzi sono quelli reali del catalogo.
            artObj: r.articolo
              ? {
                  id: r.articolo.id,
                  n: r.articolo.nome,
                  cat: r.articolo.categoria as CategoriaModulo,
                  h: r.articolo.oreDefault ?? 0,
                  p: r.articolo.prezzoDefault != null ? r.articolo.prezzoDefault / 100 : 0,
                  ver: r.articolo.versione ?? 1,
                }
              : undefined,
          })),
        }));
        setModuliList(mappedMods);

        // La preselezione iniziale è `mod-m01`/`mod-m02`, gli identificativi che quei due
        // moduli hanno nella libreria di partenza. Se la libreria di questo studio non li
        // contiene, quelle due voci restavano selezionate senza corrispondere a nessun
        // modulo: il conteggio diceva «2 selezionati», il pulsante si sbloccava e al server
        // arrivava un preventivo senza righe. Qui la selezione viene ristretta a quello che
        // esiste davvero.
        setSelectedMods(prev => {
          const esistenti = new Set(mappedMods.map(m => m.id));
          const ripulita = new Set([...prev].filter(id => esistenti.has(id)));
          return ripulita;
        });
      }
    };
    loadInitData();
  }, []);

  const handleSelectExisting = (clientId: string) => {
    setSelectedClientId(clientId);
    const found = existingClients.find(c => c.id === clientId);
    if (found) {
      setClientName(found.nome);
      setClientType(found.tipo as any);
    }
  };

  const selectedGiurObj = giurisdizioni.find(g => g.id === selectedGiurId);

  // Moduli categorizzati in cascata dal database
  const specificMods = moduliList.filter(m => selectedGiurId && m.giurisdizioneId === selectedGiurId);
  const genericMods = moduliList.filter(m => !m.giurisdizioneId);
  const otherGiurMods = moduliList.filter(m => m.giurisdizioneId && m.giurisdizioneId !== selectedGiurId);

  const selModules = moduliList.filter(m => selectedMods.has(m.id));
  const totalP = selModules.reduce((a, m) => a + moduloP(m), 0);
  const totalH = selModules.reduce((a, m) => a + moduloH(m), 0);

  // Rifinitura Fase 2: voci (per NOME) presenti in PIÙ moduli selezionati. Non è un errore — è
  // l'occasione per condividerle dopo la creazione (🔗 Voci condivise nella scheda progetto), così
  // si eseguono UNA volta e contano per entrambi invece di duplicarsi. I nomi sono reali (artObj).
  const vociInPiuModuli: string[] = (() => {
    const perNome = new Map<string, Set<string>>();
    for (const m of selModules) {
      for (const r of resolveRighe(m)) {
        const nome = (r.art?.n || '').trim();
        if (!nome || nome === 'Prestazione') continue;
        const s = perNome.get(nome) ?? new Set<string>();
        s.add(m.id);
        perNome.set(nome, s);
      }
    }
    return [...perNome.entries()].filter(([, mods]) => mods.size > 1).map(([nome]) => nome);
  })();

  const toggleMod = (id: string) =>
    setSelectedMods(prev => { const s = new Set(prev); s.has(id) ? s.delete(id) : s.add(id); return s; });

  const canNext = step === 0
    ? !!selectedGiurId
    : step === 1
    ? (clientMode === 'existing' ? !!selectedClientId : clientName.trim()) && projectName.trim()
    : step === 2 ? selectedMods.size > 0 : !loading;

  const handleNext = async () => {
    if (step < 3) { setStep(s => s + 1); return; }

    setLoading(true);
    setErrore(null);
    try {
      let finalClientId = selectedClientId;

      // 1. Se in modalità "nuovo", crea il cliente su Supabase
      if (clientMode === 'new' || !finalClientId) {
        const nuovoCliente = await creaClienteApi({ nome: clientName, tipo: clientType });
        finalClientId = nuovoCliente.id;
      }

      // 2. Crea il progetto e istanzia i moduli a database. Non c'è un ripiego locale: un
      //    progetto che esiste solo nel browser di chi lo ha creato è invisibile al cliente,
      //    agli altri operatori e alla fatturazione. Meglio un errore adesso.
      const progetto = await creaProgettoApi({ clienteId: finalClientId, nome: projectName });
      if (!progetto?.id) {
        throw new Error('Il server non ha restituito l\'identificativo del progetto: niente è stato creato.');
      }
      const progettoId = progetto.id;

      // Gli identificativi arrivano dalla libreria moduli del database e si passano come
      // sono. Qui c'era una traduzione a mano — `m.id === 'M01' ? 'mod-m01' : ...` — che
      // copriva due soli moduli: era il residuo di quando l'elenco veniva dai dati di
      // esempio, e con la libreria vera trasformava gli altri in identificativi inesistenti.
      const dbMods = selModules.map(m => ({
        moduloTemplateId: m.id,
        moduloTemplateVersione: m.ver,
      }));

      await creaPreventivoEAccettaApi({
        clienteId: finalClientId,
        progettoId,
        righe: dbMods,
      });

      // 3. Copia locale per far comparire subito il progetto negli elenchi, scritta solo
      //    dopo che il database l'ha accettato: prima veniva scritta anche quando la
      //    creazione era fallita, e da lì nasceva il progetto fantasma con i moduli che il
      //    cliente non vedeva.
      const currentTenantId = getCurrentTenantId();
      const storageKey = getTenantStorageKey('bluman_custom_projects', currentTenantId);
      const customProjsStr = localStorage.getItem(storageKey);
      const customProjs: any[] = customProjsStr ? JSON.parse(customProjsStr) : [];
      const newProjObject = {
        id: progettoId,
        tenantId: currentTenantId,
        n: projectName,
        cl: clientName || 'Cliente',
        ct: clientType,
        st: 'pre_project',
        pct: 0,
        start: new Date().toLocaleDateString('it-IT'),
        // Regola 7: nessuna scadenza inventata ("30 giorni") né regime fiscale di comodo
        // ('privato_italia'): il server non ha ricevuto nessuno dei due dati, e questa copia
        // locale può restare a schermo finché un refresh non rilegge dal DB.
        due: 'n/d',
        val: totalP,
        delay: false,
        fisc: 'n/d',
        fatture: [],
        mods: selModules.map((m, mIdx) => ({
          id: Date.now() + mIdx,
          n: m.n,
          cat: m.cat,
          st: 'pending',
          pct: 0,
          h: moduloH(m),
          a: 0,
          p: moduloP(m),
          // Regola 7: alla creazione nessuno è ancora assegnato — il team vuoto evita di
          // mostrare un membro fittizio; l'assegnazione reale avviene dopo, dal progetto.
          team: [],
          delay: false,
          // ModuloTemplate non ha `v`: qui c'era `m.v`, sempre undefined, quindi la copia
          // locale nasceva senza micro-voci finché un refresh non la rileggeva dal server
          // (che le istanzia dalla distinta). Le deriviamo dalle righe con la stessa logica.
          v: resolveRighe(m).map(r => ({
            n: r.art.n || 'Microvoce operativa',
            // Regola 7: le ore stimate sono quelle della distinta (riga h); il ripiego
            // `|| 4` inventava un preventivo di 4 ore per ogni riga senza stima.
            hE: r.h ?? 0,
            hA: 0,
            s: 'pending' as const,
            d: 0,
          })),
        })),
      };
      localStorage.setItem(storageKey, JSON.stringify([newProjObject, ...customProjs]));

      setNotif(true);
      if (onProjectCreated) onProjectCreated();
      setTimeout(() => { setNotif(false); onClose(); }, 1500);
    } catch (err: any) {
      // Prima anche questo ramo mostrava «✓ Progetto istanziato e collegato su Supabase DB!»
      // e chiudeva la finestra: il progetto non c'era e nessuno lo sapeva.
      console.error('Errore salvataggio progetto:', err);
      setErrore(err instanceof Error ? err.message : 'Errore sconosciuto durante la creazione del progetto.');
    } finally {
      setLoading(false);
    }
  };

  const sd = (n: number) => ({
    width: 24, height: 24, borderRadius: '50%',
    display: 'flex', alignItems: 'center', justifyContent: 'center',
    fontSize: 11, fontWeight: 700,
    background: n < step ? 'var(--green)' : n === step ? 'var(--indigo)' : 'var(--card2)',
    color: n <= step ? '#fff' : 'var(--muted)',
  } as React.CSSProperties);

  return (
    <>
      {notif && (
        <div style={{ position: 'fixed', top: 20, right: 20, background: 'var(--pill-green-bg)', border: '1px solid var(--pill-green-bg)', color: 'var(--green)', padding: '12px 16px', borderRadius: 10, fontSize: 12, fontWeight: 500, zIndex: 200, display: 'flex', alignItems: 'center', gap: 8 }}>
          ✓ Progetto istanziato e collegato su Supabase DB!
        </div>
      )}

      <Modal onClose={onClose} zIndex={100} overlayBackground="rgba(0,0,0,.7)" labelledBy="wizard-progetto-titolo">
        {(richiediChiusura) => (
        <div style={wizStyle}>
          {/* Head */}
          <div style={{ padding: 20, borderBottom: '1px solid var(--border)', display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
            <div>
              <div id="wizard-progetto-titolo" style={{ fontSize: 15, fontWeight: 600 }}>Nuovo progetto — Wizard di Configurazione</div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginTop: 12 }}>
                {[0, 1, 2, 3].map((n, i) => (
                  <React.Fragment key={n}>
                    <div style={sd(n)}>{n < step ? '✓' : n}</div>
                    {i < 3 && <div style={{ width: 28, height: 2, borderRadius: 1, background: n < step ? 'var(--green)' : 'var(--border)' }} />}
                  </React.Fragment>
                ))}
                <span style={{ fontSize: 10, color: 'var(--indigo-l)', marginLeft: 8, fontWeight: 600 }}>
                  {['Giurisdizione', 'Cliente & Progetto', 'Libreria Moduli', 'Riepilogo'][step]}
                </span>
              </div>
            </div>
            <button onClick={richiediChiusura} aria-label="Chiudi" style={closeBtnStyle}>✕</button>
          </div>

          {/* Body */}
          <div style={{ flex: 1, overflowY: 'auto', padding: 20 }}>
            {/* STEP 0: Giurisdizione Target */}
            {step === 0 && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
                <div style={{ fontSize: 13, color: 'var(--muted)', lineHeight: 1.4 }}>
                  Seleziona la giurisdizione o piazza finanziaria di riferimento. La libreria dei moduli verrà filtrata a cascata privilegiando le soluzioni specifiche per il paese scelto.
                </div>

                <div style={labelStyle}>In quale giurisdizione vuoi operare? *</div>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(240px, 1fr))', gap: 10 }}>
                  {giurisdizioni.map((g) => {
                    const sel = selectedGiurId === g.id;
                    const flag = g.codice === 'MT' ? '🇲🇹' : g.codice === 'GI' ? '🇬🇮' : g.codice.startsWith('US') ? '🇺🇸' : g.codice === 'AE' ? '🇦🇪' : '🌐';
                    return (
                      <div
                        key={g.id}
                        onClick={() => setSelectedGiurId(g.id)}
                        style={{
                          padding: 12,
                          borderRadius: 10,
                          border: `1.5px solid ${sel ? 'var(--indigo-l)' : 'var(--border)'}`,
                          background: sel ? 'var(--surface-1)' : 'var(--card)',
                          cursor: 'pointer',
                          transition: 'all .15s',
                        }}
                      >
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 4 }}>
                          <span style={{ fontWeight: 600, fontSize: 13, color: sel ? 'var(--indigo-l)' : 'var(--text)' }}>
                            {flag} {g.nome}
                          </span>
                          <span style={{ fontSize: 9, padding: '2px 6px', borderRadius: 10, background: g.tipo === 'ue' ? 'var(--pill-green-bg)' : 'var(--pill-amber-bg)', color: g.tipo === 'ue' ? 'var(--green)' : 'var(--amber)', textTransform: 'uppercase', fontWeight: 700 }}>
                            {g.tipo}
                          </span>
                        </div>
                        <div style={{ fontSize: 10, color: 'var(--muted)', lineHeight: 1.3 }}>{g.note || 'Piazza finanziaria e strutturazione'}</div>
                      </div>
                    );
                  })}

                  {/* Multi-giurisdizione / Generica */}
                  <div
                    onClick={() => setSelectedGiurId('')}
                    style={{
                      padding: 12,
                      borderRadius: 10,
                      border: `1.5px solid ${selectedGiurId === '' ? 'var(--indigo-l)' : 'var(--border)'}`,
                      background: selectedGiurId === '' ? 'var(--surface-1)' : 'var(--card)',
                      cursor: 'pointer',
                    }}
                  >
                    <div style={{ fontWeight: 600, fontSize: 13, color: selectedGiurId === '' ? 'var(--indigo-l)' : 'var(--text)', marginBottom: 4 }}>
                      🌐 Multi-giurisdizione / Generica
                    </div>
                    <div style={{ fontSize: 10, color: 'var(--muted)' }}>Mostra l intero catalogo senza filtri geografici preliminari</div>
                  </div>
                </div>
              </div>
            )}

            {/* STEP 1: Cliente & Progetto */}
            {step === 1 && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
                {selectedGiurObj && (
                  <div style={{ background: 'var(--pill-indigo-bg)', border: '1px solid var(--indigo-d)', padding: '8px 12px', borderRadius: 8, fontSize: 11, color: 'var(--pill-indigo-fg)', display: 'flex', alignItems: 'center', gap: 8 }}>
                    📍 Giurisdizione selezionata: <strong>{selectedGiurObj.nome} ({selectedGiurObj.codice})</strong>
                  </div>
                )}

                <div>
                  <div style={labelStyle}>Cliente *</div>
                  <div style={{ display: 'flex', gap: 8, marginBottom: 10 }}>
                    <button
                      type="button"
                      onClick={() => setClientMode('existing')}
                      style={{
                        flex: 1, padding: 8, borderRadius: 8,
                        border: `1px solid ${clientMode === 'existing' ? 'var(--indigo)' : 'var(--border)'}`,
                        background: clientMode === 'existing' ? 'var(--surface-1)' : 'var(--card)',
                        color: clientMode === 'existing' ? 'var(--indigo-l)' : 'var(--muted)',
                        fontSize: 12, fontWeight: 500, cursor: 'pointer',
                      }}
                    >
                      👥 Cliente Esistente ({existingClients.length})
                    </button>
                    <button
                      type="button"
                      onClick={() => { setClientMode('new'); setClientName(''); }}
                      style={{
                        flex: 1, padding: 8, borderRadius: 8,
                        border: `1px solid ${clientMode === 'new' ? 'var(--indigo)' : 'var(--border)'}`,
                        background: clientMode === 'new' ? 'var(--surface-1)' : 'var(--card)',
                        color: clientMode === 'new' ? 'var(--indigo-l)' : 'var(--muted)',
                        fontSize: 12, fontWeight: 500, cursor: 'pointer',
                      }}
                    >
                      + Crea Nuovo Cliente
                    </button>
                  </div>

                  {clientMode === 'existing' ? (
                    existingClients.length === 0 ? (
                      <div style={{ padding: 12, background: 'var(--card)', border: '1px solid var(--border)', borderRadius: 8, fontSize: 12, color: 'var(--muted)' }}>
                        Nessun cliente ancora censito. Clicca su "+ Crea Nuovo Cliente".
                      </div>
                    ) : (
                      <select
                        value={selectedClientId}
                        onChange={e => handleSelectExisting(e.target.value)}
                        style={{ fontSize: 13, fontWeight: 500 }}
                      >
                        {existingClients.map(c => (
                          <option key={c.id} value={c.id}>
                            {c.tipo === 'company' ? '🏢' : '👤'} {c.nome} ({c.tipo === 'company' ? 'Società' : 'Persona Fisica'})
                          </option>
                        ))}
                      </select>
                    )
                  ) : (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 10, background: 'var(--card2)', padding: 12, borderRadius: 10, border: '1px solid var(--border)' }}>
                      <div>
                        <label style={{ fontSize: 11, color: 'var(--muted)', display: 'block', marginBottom: 4 }}>Nome / Ragione Sociale Cliente *</label>
                        <input value={clientName} onChange={e => setClientName(e.target.value)} placeholder="es. Marco Rossi / Acme S.r.l." required />
                      </div>
                      <div>
                        <label style={{ fontSize: 11, color: 'var(--muted)', display: 'block', marginBottom: 4 }}>Tipo Cliente *</label>
                        <div style={{ display: 'flex', gap: 8 }}>
                          {(['individual', 'company'] as const).map(t => (
                            <button key={t} type="button" onClick={() => setClientType(t)} style={{ flex: 1, padding: 7, borderRadius: 8, border: `1px solid ${clientType === t ? 'var(--indigo)' : 'var(--border)'}`, background: clientType === t ? 'var(--surface-1)' : 'var(--card)', color: clientType === t ? 'var(--indigo-l)' : 'var(--muted)', fontSize: 11, fontWeight: 500, cursor: 'pointer' }}>
                              {t === 'individual' ? '👤 Persona fisica' : '🏢 Società'}
                            </button>
                          ))}
                        </div>
                      </div>
                    </div>
                  )}
                </div>

                {clientMode === 'existing' && selectedClientId && (!kycFasc || kycFasc.stato !== 'approvato') && (
                  <div style={{ padding: '10px 12px', borderRadius: 8, background: 'var(--pill-amber-bg)', color: 'var(--pill-amber-fg)', fontSize: 12, border: '1px solid var(--amber)' }}>
                    ⚠️ KYC {kycFasc ? `in stato «${kycFasc.stato}»` : 'non ancora avviato'} per questo cliente: puoi procedere, ma valuta di completare l'adeguata verifica nella scheda «Compliance KYC» dell'anagrafica (D.Lgs. 231/2007). Avviso non bloccante.
                  </div>
                )}

                <div>
                  <div style={labelStyle}>Nome Progetto *</div>
                  <input value={projectName} onChange={e => setProjectName(e.target.value)} placeholder="es. Struttura Holding — Famiglia Rossi" required />
                </div>
              </div>
            )}

            {/* STEP 2: Selezione Moduli a Cascata */}
            {step === 2 && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
                {/* 1. Moduli specifici giurisdizione */}
                {selectedGiurObj && (
                  <div>
                    <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--indigo-l)', letterSpacing: '.5px', textTransform: 'uppercase', marginBottom: 8, display: 'flex', alignItems: 'center', gap: 6 }}>
                      <span>⭐ Moduli Specifici {selectedGiurObj.nome}</span>
                      <span style={{ fontSize: 10, background: 'var(--pill-indigo-bg)', color: 'var(--pill-indigo-fg)', padding: '1px 6px', borderRadius: 10 }}>In evidenza</span>
                    </div>
                    {specificMods.length === 0 ? (
                      <div style={{ padding: 10, background: 'var(--card)', borderRadius: 8, fontSize: 11, color: 'var(--muted)' }}>
                        Nessun modulo specifico censito per {selectedGiurObj.nome}. Seleziona moduli generici qui sotto.
                      </div>
                    ) : (
                      specificMods.map(m => {
                        const sel = selectedMods.has(m.id);
                        return (
                          <div key={m.id} onClick={() => toggleMod(m.id)} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '10px 12px', borderRadius: 8, border: `1.5px solid ${sel ? 'var(--indigo)' : 'var(--pill-indigo-bg)'}`, background: sel ? 'var(--surface-1)' : 'var(--surface-2)', cursor: 'pointer', marginBottom: 6 }}>
                            <div style={{ width: 18, height: 18, borderRadius: 5, border: `2px solid ${sel ? 'var(--indigo)' : 'var(--muted)'}`, flexShrink: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', background: sel ? 'var(--indigo)' : 'transparent' }}>
                              {sel && <span style={{ color: '#fff', fontSize: 10 }}>✓</span>}
                            </div>
                            <div style={{ flex: 1 }}>
                              <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--text)' }}>{m.n}</div>
                              <div style={{ fontSize: 10, color: 'var(--muted)' }}>{m.righe.length} articoli · {moduloH(m)}h</div>
                            </div>
                            <button
                              type="button"
                              onClick={(e) => { e.stopPropagation(); setDetailMod(m); }}
                              aria-label={`Vedi cosa contiene il modulo ${m.n}`}
                              title="Vedi dettaglio: articoli, ore e importo"
                              style={infoBtnStyle}
                            >
                              ℹ️
                            </button>
                            <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--cat-societario)' }}>{fmt(moduloP(m))}</div>
                          </div>
                        );
                      })
                    )}
                  </div>
                )}

                {/* 2. Moduli generici */}
                <div>
                  <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--muted)', letterSpacing: '.5px', textTransform: 'uppercase', marginBottom: 8 }}>
                    🌐 Moduli Generici (Validi per tutte le giurisdizioni)
                  </div>
                  {genericMods.map(m => {
                    const sel = selectedMods.has(m.id);
                    return (
                      <div key={m.id} onClick={() => toggleMod(m.id)} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '10px 12px', borderRadius: 8, border: `1px solid ${sel ? 'var(--indigo)' : 'var(--border)'}`, background: sel ? 'var(--surface-1)' : 'var(--card)', cursor: 'pointer', marginBottom: 6 }}>
                        <div style={{ width: 18, height: 18, borderRadius: 5, border: `2px solid ${sel ? 'var(--indigo)' : 'var(--hint)'}`, flexShrink: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', background: sel ? 'var(--indigo)' : 'transparent' }}>
                          {sel && <span style={{ color: '#fff', fontSize: 10 }}>✓</span>}
                        </div>
                        <div style={{ flex: 1 }}>
                          <div style={{ fontSize: 12, fontWeight: 500 }}>{m.n}</div>
                          <div style={{ fontSize: 10, color: 'var(--muted)' }}>{m.righe.length} articoli · {moduloH(m)}h</div>
                        </div>
                        <CatBadge cat={m.cat} />
                        <button
                          type="button"
                          onClick={(e) => { e.stopPropagation(); setDetailMod(m); }}
                          aria-label={`Vedi cosa contiene il modulo ${m.n}`}
                          title="Vedi dettaglio: articoli, ore e importo"
                          style={infoBtnStyle}
                        >
                          ℹ️
                        </button>
                        <div style={{ fontSize: 12, fontWeight: 600, flexShrink: 0, marginLeft: 8 }}>{fmt(moduloP(m))}</div>
                      </div>
                    );
                  })}
                </div>

                {/* 3. Mostra altre giurisdizioni (collassabile) */}
                {otherGiurMods.length > 0 && (
                  <div style={{ marginTop: 8 }}>
                    <button
                      type="button"
                      onClick={() => setShowOtherGiurMods(!showOtherGiurMods)}
                      style={{ background: 'transparent', border: 'none', color: 'var(--indigo-l)', fontSize: 11, cursor: 'pointer', fontWeight: 600, display: 'flex', alignItems: 'center', gap: 6 }}
                    >
                      {showOtherGiurMods ? '▲ Nascondi altre giurisdizioni' : '▼ Mostra anche moduli di altre giurisdizioni (Scenari multi-giurisdizionali)'}
                    </button>

                    {showOtherGiurMods && (
                      <div style={{ marginTop: 10, paddingLeft: 10, borderLeft: '2px solid var(--pill-slate-bd)' }}>
                        {otherGiurMods.map(m => {
                          const sel = selectedMods.has(m.id);
                          return (
                            <div key={m.id} onClick={() => toggleMod(m.id)} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '8px 10px', borderRadius: 8, border: `1px solid ${sel ? 'var(--indigo)' : 'var(--border)'}`, background: sel ? 'var(--surface-1)' : 'var(--card)', cursor: 'pointer', marginBottom: 6 }}>
                              <div style={{ width: 16, height: 16, borderRadius: 4, border: `2px solid ${sel ? 'var(--indigo)' : 'var(--hint)'}`, flexShrink: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', background: sel ? 'var(--indigo)' : 'transparent' }}>
                                {sel && <span style={{ color: '#fff', fontSize: 9 }}>✓</span>}
                              </div>
                              <div style={{ flex: 1 }}>
                                <div style={{ fontSize: 11, fontWeight: 500 }}>{m.n}</div>
                              </div>
                              <button
                                type="button"
                                onClick={(e) => { e.stopPropagation(); setDetailMod(m); }}
                                aria-label={`Vedi cosa contiene il modulo ${m.n}`}
                                title="Vedi dettaglio: articoli, ore e importo"
                                style={infoBtnStyle}
                              >
                                ℹ️
                              </button>
                              <div style={{ fontSize: 11, fontWeight: 600 }}>{fmt(moduloP(m))}</div>
                            </div>
                          );
                        })}
                      </div>
                    )}
                  </div>
                )}
              </div>
            )}

            {/* STEP 3: Riepilogo finale */}
            {step === 3 && (
              <div>
                <div style={{ background: 'var(--card)', border: '1px solid var(--border)', borderRadius: 10, padding: '12px 14px', marginBottom: 14 }}>
                  {[
                    ['Giurisdizione', selectedGiurObj ? `${selectedGiurObj.nome} (${selectedGiurObj.codice})` : 'Multi-giurisdizione'],
                    ['Cliente', clientName || '—'],
                    ['Tipo', clientType === 'individual' ? 'Persona fisica' : 'Società'],
                    ['Progetto', projectName || '—'],
                    ['Moduli selezionati', selModules.length],
                    ['Ore totali', `${totalH}h`],
                  ].map(([l, v]) => (
                    <div key={String(l)} style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12, padding: '5px 0', borderBottom: '1px solid var(--border)' }}>
                      <span style={{ color: 'var(--muted)' }}>{l}</span>
                      <strong>{v}</strong>
                    </div>
                  ))}
                </div>

                {vociInPiuModuli.length > 0 && (
                  <div style={{ background: 'var(--pill-blue-bg)', color: 'var(--pill-blue-fg)', border: '1px solid var(--indigo)', borderRadius: 10, padding: '10px 14px', marginBottom: 14, fontSize: 11.5, lineHeight: 1.5 }}>
                    ℹ️ Alcune voci compaiono in più moduli selezionati: <strong>{vociInPiuModuli.join(', ')}</strong>.
                    Dopo la creazione puoi condividerle dalla scheda progetto (pulsante «🔗 Voci condivise» sul modulo):
                    così si eseguono una volta sola e contano per entrambi i moduli, invece di duplicarsi.
                  </div>
                )}

                {selModules.map(m => (
                  <div key={m.id} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '8px 0', borderBottom: '1px solid var(--border)' }}>
                    <div>
                      <div style={{ fontSize: 12, fontWeight: 500 }}>{m.n}</div>
                      <CatBadge cat={m.cat} />
                    </div>
                    <div style={{ textAlign: 'right' }}>
                      <div style={{ fontSize: 12, fontWeight: 600 }}>{fmt(moduloP(m))}</div>
                      <div style={{ fontSize: 10, color: 'var(--muted)' }}>{moduloH(m)}h</div>
                    </div>
                  </div>
                ))}

                <div style={{ background: 'linear-gradient(135deg,var(--surface-1),var(--surface-1))', border: '1px solid var(--card2)', borderRadius: 12, padding: '16px 20px', display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: 12 }}>
                  <div>
                    <div style={{ fontSize: 11, color: 'var(--indigo-l)', opacity: 0.8 }}>Valore totale progetto</div>
                    <div style={{ fontSize: 11, color: 'var(--indigo-l)', opacity: 0.6, marginTop: 2 }}>{totalH}h · {selModules.length} moduli</div>
                  </div>
                  <div style={{ fontSize: 24, fontWeight: 800 }}>{fmt(totalP)}</div>
                </div>
              </div>
            )}
          </div>

          {/* Il motivo del fallimento, dentro la finestra e non in un avviso che scompare: se il
              progetto non è stato creato la finestra resta aperta con i dati inseriti, così si
              può riprovare senza ricompilare tutto. Il testo è quello del server. */}
          {errore && (
            <div style={{ margin: '0 20px 4px', background: 'var(--pill-red-bg)', border: '1px solid var(--pill-red-bg)', color: 'var(--pill-red-fg)', padding: '10px 12px', borderRadius: 10, fontSize: 12, lineHeight: 1.5 }}>
              <div style={{ fontWeight: 600, marginBottom: 2 }}>Progetto non creato</div>
              {errore}
            </div>
          )}

          {/* Footer */}
          <div style={{ padding: '14px 20px', borderTop: '1px solid var(--border)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <button onClick={step > 0 ? () => setStep(s => s - 1) : richiediChiusura} style={{ background: 'transparent', border: '1px solid var(--border)', color: 'var(--muted)', padding: '6px 12px', borderRadius: 8, fontSize: 12, cursor: 'pointer' }}>
              {step > 0 ? '← Indietro' : 'Annulla'}
            </button>
            <button onClick={handleNext} disabled={!canNext || loading} style={{ background: canNext ? 'var(--indigo)' : 'var(--card2)', color: canNext ? '#fff' : 'var(--hint)', border: 'none', padding: '7px 14px', borderRadius: 8, fontSize: 12, fontWeight: 500, cursor: canNext ? 'pointer' : 'not-allowed', opacity: canNext ? 1 : 0.5 }}>
              {loading ? 'Salvataggio...' : step === 3 ? '✓ Crea progetto' : 'Avanti →'}
            </button>
          </div>
        </div>
        )}
      </Modal>

      {/* Dettaglio modulo: cosa contiene, così l'operatore non deve ricordarlo a memoria.
          Sola lettura (dirty={false} → chiude subito), z-index sopra il wizard. Gli articoli,
          le ore e gli importi sono quelli reali della distinta (via artObj in resolveRighe). */}
      {detailMod && (
        <Modal onClose={() => setDetailMod(null)} zIndex={120} overlayBackground="rgba(0,0,0,.75)" dirty={false} labelledBy="dettaglio-modulo-wizard-titolo">
          <div style={{ background: 'var(--sidebar)', border: '1px solid var(--border)', borderRadius: 16, width: '100%', maxWidth: 560, maxHeight: '85vh', display: 'flex', flexDirection: 'column', boxShadow: '0 24px 60px rgba(0,0,0,.5)' }}>
            <div style={{ padding: '18px 20px', borderBottom: '1px solid var(--border)', display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 12 }}>
              <div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}>
                  <CatBadge cat={detailMod.cat} />
                  <span style={{ fontSize: 10, color: 'var(--muted)', textTransform: 'uppercase', fontWeight: 800 }}>Contenuto del modulo</span>
                </div>
                <div id="dettaglio-modulo-wizard-titolo" style={{ fontSize: 16, fontWeight: 800, color: 'var(--text)' }}>{detailMod.n}</div>
                <div style={{ fontSize: 11.5, color: 'var(--muted)', marginTop: 4 }}>
                  {detailMod.giurisdizione?.nome ? `${detailMod.giurisdizione.nome} · ` : ''}{resolveRighe(detailMod).length} articoli · {moduloH(detailMod)}h totali
                </div>
              </div>
              <button onClick={() => setDetailMod(null)} aria-label="Chiudi" style={closeBtnStyle}>✕</button>
            </div>

            <div style={{ flex: 1, overflowY: 'auto', padding: 20, display: 'flex', flexDirection: 'column', gap: 8 }}>
              {resolveRighe(detailMod).length === 0 ? (
                <div style={{ padding: 14, background: 'var(--card)', border: '1px dashed var(--border)', borderRadius: 10, fontSize: 12, color: 'var(--muted)', lineHeight: 1.5 }}>
                  Questo modulo non ha ancora articoli in distinta. Nulla da mostrare finché non ne vengono aggiunti dalla libreria.
                </div>
              ) : (
                resolveRighe(detailMod).map((r, i) => (
                  <div key={r.art.id || i} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12, padding: '10px 12px', background: 'var(--card)', border: '1px solid var(--border)', borderRadius: 10 }}>
                    <div style={{ minWidth: 0 }}>
                      <div style={{ fontSize: 12.5, fontWeight: 600, color: 'var(--text)' }}>
                        {r.qty > 1 ? `${r.qty}× ` : ''}{r.art.n}
                        {r.override && <span style={{ marginLeft: 6, fontSize: 9.5, background: 'var(--pill-amber-bg)', color: 'var(--pill-amber-fg)', padding: '1px 5px', borderRadius: 4, fontWeight: 700 }}>tariffa su misura</span>}
                      </div>
                      <div style={{ fontSize: 10.5, color: 'var(--muted)', marginTop: 2 }}>{r.h}h stimate</div>
                    </div>
                    <div style={{ fontSize: 12.5, fontWeight: 700, color: 'var(--text)', flexShrink: 0 }}>{fmt(r.p)}</div>
                  </div>
                ))
              )}
            </div>

            <div style={{ padding: '14px 20px', borderTop: '1px solid var(--border)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <div style={{ fontSize: 11, color: 'var(--muted)' }}>
                {detailMod.pkg != null ? 'Prezzo a pacchetto' : `${moduloH(detailMod)}h · ${resolveRighe(detailMod).length} articoli`}
              </div>
              <div style={{ fontSize: 18, fontWeight: 800, color: 'var(--indigo-l)' }}>{fmt(moduloP(detailMod))}</div>
            </div>
          </div>
        </Modal>
      )}
    </>
  );
}

const wizStyle: React.CSSProperties = { background: 'var(--sidebar)', border: '1px solid var(--border)', borderRadius: 16, width: '100%', maxWidth: 580, maxHeight: '90vh', display: 'flex', flexDirection: 'column', boxShadow: '0 24px 60px rgba(0,0,0,.6)' };
const labelStyle: React.CSSProperties = { fontSize: 11, fontWeight: 600, color: 'var(--muted)', marginBottom: 6, letterSpacing: '.5px', textTransform: 'uppercase' };
const closeBtnStyle: React.CSSProperties = { background: 'var(--card2)', border: 'none', width: 28, height: 28, borderRadius: 6, display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer', color: 'var(--muted)', fontSize: 14 };
// Pulsante ℹ️ accanto a ciascun modulo: apre la scheda di dettaglio senza selezionare il modulo.
const infoBtnStyle: React.CSSProperties = { background: 'var(--card2)', border: '1px solid var(--border)', color: 'var(--indigo-l)', width: 26, height: 26, borderRadius: 6, fontSize: 12, cursor: 'pointer', flexShrink: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 0 };
