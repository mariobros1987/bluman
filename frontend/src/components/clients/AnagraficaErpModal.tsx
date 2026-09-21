import React, { useState, useEffect } from 'react';
import { fetchProgetti, creaClienteApi, aggiornaClienteApi, proposteDatiStudioApi, confermaPropostaDatiApi, rifiutaPropostaDatiApi } from '../../api/client';
import type { PropostaDatiFiscale } from '../../api/client';
import { getCurrentTenantId, getTenantStorageKey } from '../../utils/tenant';
import { fmt } from '../../utils';
import type { Cliente } from '../../types';
import { Modal } from '../ui/Modal';

// ─── Componente Anagrafica Completa Cliente ERP ────────────────────
export function AnagraficaErpModal({ client, onClose, onSaved }: { client: Cliente; onClose: () => void; onSaved: () => void }) {
  const [tab, setTab] = useState<'generale' | 'progetti' | 'sede' | 'sdi' | 'compliance'>('generale');
  const [clientProjects, setClientProjects] = useState<any[]>([]);

  useEffect(() => {
    fetchProgetti().then(res => {
      if (res && Array.isArray(res)) {
        const matching = res.filter(p =>
          p.clienteId === client.id ||
          p.cliente?.id === client.id ||
          p.cliente?.nome?.toLowerCase() === client.nome?.toLowerCase() ||
          (client.email && p.cliente?.email?.toLowerCase() === client.email.toLowerCase())
        );
        setClientProjects(matching);
      }
    }).catch(err => console.warn('Errore recupero progetti cliente:', err));
  }, [client.id, client.nome, client.email]);

  // §2.3 — proposte di modifica inviate dal cliente dal portale: lo studio le conferma o le rifiuta.
  const [proposteInAttesa, setProposteInAttesa] = useState<PropostaDatiFiscale[]>([]);
  const [propostaInAzione, setPropostaInAzione] = useState<string | null>(null);
  const [rifiutoId, setRifiutoId] = useState<string | null>(null);
  const [notaRifiuto, setNotaRifiuto] = useState('');
  const [proposteMsg, setProposteMsg] = useState<string | null>(null);

  const ETICHETTE_CAMPI: Record<string, string> = {
    ragioneSociale: 'Ragione Sociale',
    piva: 'Partita IVA',
    codiceFiscale: 'Codice Fiscale',
    iban: 'IBAN',
    titolareEffettivo: 'Titolare Effettivo (UBO)',
    sedeLegale: 'Sede Legale',
    legaleRappresentante: 'Legale Rappresentante',
  };

  const caricaProposteInAttesa = async () => {
    try {
      const lista = await proposteDatiStudioApi({ clienteId: client.id, stato: 'in_attesa' });
      setProposteInAttesa(lista);
    } catch (err) {
      console.warn('Errore recupero proposte dati del cliente:', err);
    }
  };

  useEffect(() => { void caricaProposteInAttesa(); }, [client.id]);

  const confermaProposta = async (p: PropostaDatiFiscale) => {
    setPropostaInAzione(p.id);
    try {
      await confermaPropostaDatiApi(p.id);
      // Allinea gli input locali del modal al valore appena confermato in anagrafica.
      if (p.campo === 'ragioneSociale') setNome(p.valoreProposto);
      if (p.campo === 'piva') setPiva(p.valoreProposto);
      if (p.campo === 'codiceFiscale') setCodFisc(p.valoreProposto);
      if (p.campo === 'iban') setIban(p.valoreProposto);
      if (p.campo === 'titolareEffettivo') setUbo(p.valoreProposto);
      setProposteMsg(`✓ «${ETICHETTE_CAMPI[p.campo] ?? p.campo}» confermata: l'anagrafica è stata aggiornata.`);
      await caricaProposteInAttesa();
      onSaved();
    } catch (err: any) {
      setProposteMsg(err?.message || 'Errore durante la conferma della proposta.');
    } finally {
      setPropostaInAzione(null);
    }
  };

  const rifiutaProposta = async (p: PropostaDatiFiscale) => {
    setPropostaInAzione(p.id);
    try {
      await rifiutaPropostaDatiApi(p.id, notaRifiuto.trim() || undefined);
      setProposteMsg(`⛔ Proposta «${ETICHETTE_CAMPI[p.campo] ?? p.campo}» rifiutata.`);
      setRifiutoId(null);
      setNotaRifiuto('');
      await caricaProposteInAttesa();
    } catch (err: any) {
      setProposteMsg(err?.message || 'Errore durante il rifiuto della proposta.');
    } finally {
      setPropostaInAzione(null);
    }
  };

  const refJson: any = client.referentiJson && typeof client.referentiJson === 'object' ? client.referentiJson : {};

  const [nome, setNome] = useState(client.nome || '');
  const [tipo, setTipo] = useState(client.tipo || 'company');
  const [piva, setPiva] = useState(client.piva || (client as any).partitaIva || refJson.piva || '');
  const [codFisc, setCodFisc] = useState(client.codiceFiscale || (client as any).codFisc || refJson.codiceFiscale || '');
  const [giurisdizione, setGiurisdizione] = useState(client.giurisdizione || refJson.giurisdizione || 'Italia');
  const [capitale, setCapitale] = useState<number>((client as any).capitale || refJson.capitale || 10000);
  const [regImprese, setRegImprese] = useState((client as any).regImprese || refJson.regImprese || '');

  // Tab 2: Sede & Contatti
  const [indirizzo, setIndirizzo] = useState((client as any).indirizzo || refJson.indirizzo || client.sedeLegale || '');
  const [citta, setCitta] = useState((client as any).citta || refJson.citta || '');
  const [cap, setCap] = useState((client as any).cap || refJson.cap || '');
  const [nazione, setNazione] = useState((client as any).nazione || refJson.nazione || 'Italia');
  const [email, setEmail] = useState(client.email || refJson.email || '');
  const [pec, setPec] = useState((client as any).pec || refJson.pec || '');
  const [telefono, setTelefono] = useState(client.telefono || refJson.telefono || '');
  const [cellulare, setCellulare] = useState((client as any).cellulare || refJson.cellulare || refJson.whatsapp || client.telefono || '');
  // L'identificativo numerico della chat, non lo `@username`: `sendMessage` vuole il primo e
  // il backend lo cerca nella colonna `telegramChatId`. Lo `@username` che le versioni
  // precedenti salvavano qui non è un recapito utilizzabile — mostrarlo nel campo darebbe per
  // configurato un canale che l'invio rifiuta, ed è il difetto che questa passata sana.
  const [telegram, setTelegram] = useState((client as any).telegramChatId || refJson.telegramChatId || '');
  const [signal, setSignal] = useState((client as any).signal || refJson.signal || '');
  const [referenteNome, setReferenteNome] = useState((client as any).referenteNome || refJson.referenteNome || refJson.referente || '');

  // Tab 3: SDI & Fatturazione
  const [sdiCode, setSdiCode] = useState(client.sdiCode || (client as any).codiceSdi || refJson.sdiCode || '0000000');
  const [regimeFiscale, setRegimeFiscale] = useState((client as any).regimeFiscale || refJson.regimeFiscale || 'RF01 - Ordinario');
  // Regime IVA che guida l'aliquota della fattura. Stringa vuota = «non dichiarato»: la fattura
  // ripiega sul comportamento di prima (estero 0, altrimenti 22). 0 è un'aliquota valida (esente),
  // quindi lo stato è una stringa e non un numero, per distinguere «0» da «vuoto».
  const [aliquotaIvaDefault, setAliquotaIvaDefault] = useState<string>(
    (client as any).aliquotaIvaDefault !== undefined && (client as any).aliquotaIvaDefault !== null
      ? String((client as any).aliquotaIvaDefault)
      : '',
  );
  const [naturaEsenzioneDefault, setNaturaEsenzioneDefault] = useState((client as any).naturaEsenzioneDefault || '');
  const [iban, setIban] = useState(client.iban || refJson.iban || '');

  // Tab 4: Compliance & KYC
  const [rischioAml, setRischioAml] = useState<'basso' | 'medio' | 'alto'>(client.rischioAml || refJson.rischioAml || 'basso');
  const [ubo, setUbo] = useState(client.ubo || refJson.ubo || '');
  const [fontePatrimonio, setFontePatrimonio] = useState(client.fontePatrimonio || refJson.fontePatrimonio || '');
  const [dataKyc, setDataKyc] = useState(client.dataKyc || refJson.dataKyc || '');

  const [saving, setSaving] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);

    const referentiObj = {
      capitale,
      regImprese,
      indirizzo,
      citta,
      cap,
      nazione,
      pec,
      telefono,
      cellulare,
      whatsapp: cellulare,
      telegram,
      // Ridondante rispetto a `telegram`, ma è il nome che `recapitiCliente` legge dal JSON
      // quando la colonna non basta: scriverlo qui evita che i due si allontanino.
      telegramChatId: telegram,
      signal,
      referenteNome,
      referente: referenteNome,
      email,
      regimeFiscale,
      sdiCode,
      codiceSdi: sdiCode,
      iban,
      rischioAml,
      ubo,
      fontePatrimonio,
      dataKyc,
    };

    // Stessa forma che chiede creaClienteApi (`nome` obbligatorio): il generico
    // Record<string, any> non dimostra il campo richiesto e il compilatore lo rifiutava.
    const clientPayload: { nome: string; tipo?: 'individual' | 'company'; [key: string]: any } = {
      id: client.id,
      nome,
      tipo,
      piva,
      codiceFiscale: codFisc,
      codFisc,
      giurisdizione,
      sedeLegale: `${indirizzo}, ${citta} (${cap}) - ${nazione}`,
      sdiCode,
      codiceSdi: sdiCode,
      iban,
      rischioAml,
      ubo,
      fontePatrimonio,
      dataKyc,
      email,
      pec,
      telefono,
      cellulare,
      telegram,
      telegramChatId: telegram,
      signal,
      referenteNome,
      capitale,
      regImprese,
      indirizzo,
      citta,
      cap,
      nazione,
      regimeFiscale,
      // Regime IVA in colonna: vuoto → null (non dichiarato), altrimenti l'intero. Il backend lo usa
      // per calcolare l'IVA in fattura invece del 22% fisso.
      aliquotaIvaDefault: aliquotaIvaDefault === '' ? null : Number(aliquotaIvaDefault),
      naturaEsenzioneDefault: naturaEsenzioneDefault || null,
      referentiJson: referentiObj,
    };

    // 1. Aggiorna oggetto in memoria corrente
    Object.assign(client, clientPayload);

    // 2. Persisti in localStorage bluman_custom_clients isolato per tenant
    const currentTenantId = getCurrentTenantId();
    const clientStorageKey = getTenantStorageKey('bluman_custom_clients', currentTenantId);
    const savedStr = localStorage.getItem(clientStorageKey);
    const savedArr: any[] = savedStr ? JSON.parse(savedStr) : [];
    const updatedArr = [
      clientPayload,
      ...savedArr.filter((c: any) => c.id !== client.id && c.nome?.toLowerCase() !== client.nome?.toLowerCase()),
    ];
    localStorage.setItem(clientStorageKey, JSON.stringify(updatedArr));

    // 3. Persisti in PostgreSQL tramite API Fastify
    try {
      if (client.id && !client.id.startsWith('cl-0') && !client.id.startsWith('cl-proj-')) {
        await aggiornaClienteApi(client.id, clientPayload);
      } else {
        const nuovo = await creaClienteApi(clientPayload);
        if (nuovo && nuovo.id) {
          client.id = nuovo.id;
          clientPayload.id = nuovo.id;
          localStorage.setItem(clientStorageKey, JSON.stringify([
            clientPayload,
            ...savedArr.filter((c: any) => c.nome?.toLowerCase() !== client.nome?.toLowerCase()),
          ]));
        }
      }
    } catch (apiErr) {
      console.warn('Salvataggio API DB cliente fallback:', apiErr);
    } finally {
      setSaving(false);
      onSaved();
    }
  };

  return (
    <Modal onClose={onClose} overlayBackground="rgba(0,0,0,.8)" labelledBy="anagrafica-erp-titolo">
      {(richiediChiusura) => (
      <form onSubmit={handleSubmit} style={{ background: 'var(--sidebar)', border: '1px solid var(--border)', borderRadius: 16, padding: 22, width: '100%', maxWidth: 680, maxHeight: '90vh', overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 16, boxShadow: '0 24px 60px rgba(0,0,0,.6)' }}>
        {/* Header Modal */}
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', borderBottom: '1px solid var(--border)', paddingBottom: 14 }}>
          <div>
            <div id="anagrafica-erp-titolo" style={{ fontSize: 16, fontWeight: 700, color: 'var(--indigo-l)' }}>
              📑 Anagrafica Master Cliente ERP (§Gestionale)
            </div>
            <div style={{ fontSize: 11, color: 'var(--muted)', marginTop: 2 }}>
              Dati anagrafici, fiscali, recapiti multicanale (WhatsApp, Telegram, Signal) e fascicolo KYC/AML
            </div>
          </div>
          <button type="button" onClick={richiediChiusura} aria-label="Chiudi" style={{ background: 'var(--card2)', border: 'none', width: 28, height: 28, borderRadius: 6, color: 'var(--muted)', cursor: 'pointer' }}>✕</button>
        </div>

        {/* Sub Navigation Tabs */}
        <div style={{ display: 'flex', gap: 6, borderBottom: '1px solid var(--border)', paddingBottom: 8, flexWrap: 'wrap' }}>
          <button type="button" onClick={() => setTab('generale')} style={tabBtn(tab === 'generale')}>
            📋 1. Dati Legali{proposteInAttesa.length > 0 ? ` (${proposteInAttesa.length} proposte)` : ''}
          </button>
          <button type="button" onClick={() => setTab('progetti')} style={tabBtn(tab === 'progetti')}>
            📁 2. Progetti & Commesse ({clientProjects.length})
          </button>
          <button type="button" onClick={() => setTab('sede')} style={tabBtn(tab === 'sede')}>📍 3. Sede & Contatti</button>
          <button type="button" onClick={() => setTab('sdi')} style={tabBtn(tab === 'sdi')}>🧾 4. Fatturazione SDI</button>
          <button type="button" onClick={() => setTab('compliance')} style={tabBtn(tab === 'compliance')}>🛡 5. Compliance KYC</button>
        </div>

        {/* TAB 1: Dati Legali */}
        {tab === 'generale' && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            {/* §2.3 — proposte di modifica inviate dal cliente dal portale */}
            {proposteInAttesa.length > 0 && (
              <div style={{ background: 'var(--pill-amber-bg)', border: '1px solid var(--pill-amber-bd)', borderRadius: 10, padding: 12, display: 'flex', flexDirection: 'column', gap: 10 }}>
                <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--pill-amber-fg)' }}>
                  📨 Proposte di modifica inviate dal cliente ({proposteInAttesa.length})
                </div>
                {proposteInAttesa.map((p) => (
                  <div key={p.id} style={{ background: 'var(--card)', border: '1px solid var(--border)', borderRadius: 8, padding: 10 }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 10, flexWrap: 'wrap' }}>
                      <div style={{ flex: 1, minWidth: 220 }}>
                        <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--text)' }}>{ETICHETTE_CAMPI[p.campo] ?? p.campo}</div>
                        <div style={{ fontSize: 11, color: 'var(--muted)', marginTop: 2 }}>
                          Attuale: <b style={{ color: 'var(--text)' }}>{p.valoreAttuale || '—'}</b>
                          {'  →  '}
                          Proposto: <b style={{ color: 'var(--pill-amber-fg)' }}>{p.valoreProposto}</b>
                        </div>
                        {p.notaCliente && (
                          <div style={{ fontSize: 10, color: 'var(--muted)', marginTop: 2 }}>Nota del cliente: {p.notaCliente}</div>
                        )}
                      </div>
                      <div style={{ display: 'flex', gap: 6 }}>
                        <button
                          type="button"
                          disabled={propostaInAzione === p.id}
                          onClick={() => { void confermaProposta(p); }}
                          style={{ background: 'var(--pill-green-bg)', border: '1px solid var(--green)', color: 'var(--pill-green-fg)', padding: '5px 12px', borderRadius: 6, fontSize: 11, fontWeight: 700, cursor: propostaInAzione === p.id ? 'default' : 'pointer' }}
                        >
                          ✓ Conferma
                        </button>
                        <button
                          type="button"
                          disabled={propostaInAzione === p.id}
                          onClick={() => { setRifiutoId(rifiutoId === p.id ? null : p.id); setNotaRifiuto(''); }}
                          style={{ background: 'var(--pill-red-bg)', border: '1px solid var(--pill-red-bd)', color: 'var(--pill-red-fg)', padding: '5px 12px', borderRadius: 6, fontSize: 11, fontWeight: 700, cursor: propostaInAzione === p.id ? 'default' : 'pointer' }}
                        >
                          ⛔ Rifiuta
                        </button>
                      </div>
                    </div>
                    {rifiutoId === p.id && (
                      <div style={{ marginTop: 8, display: 'flex', gap: 6, alignItems: 'center', flexWrap: 'wrap' }}>
                        <input
                          value={notaRifiuto}
                          onChange={(e) => setNotaRifiuto(e.target.value)}
                          placeholder="Motivo del rifiuto (visibile al cliente)…"
                          style={{ flex: 1, minWidth: 200 }}
                        />
                        <button
                          type="button"
                          disabled={propostaInAzione === p.id}
                          onClick={() => { void rifiutaProposta(p); }}
                          style={{ background: 'var(--red)', border: 'none', color: '#fff', padding: '6px 14px', borderRadius: 6, fontSize: 11, fontWeight: 700, cursor: propostaInAzione === p.id ? 'default' : 'pointer' }}
                        >
                          {propostaInAzione === p.id ? 'Invio…' : 'Conferma rifiuto'}
                        </button>
                      </div>
                    )}
                  </div>
                ))}
              </div>
            )}

            {proposteMsg && (
              <div style={{ background: 'var(--card2)', border: '1px solid var(--border)', borderRadius: 8, padding: '8px 12px', fontSize: 11, color: 'var(--text)' }}>
                {proposteMsg}
              </div>
            )}

            <div style={{ display: 'flex', gap: 12 }}>
              <div style={{ flex: 2 }}>
                <label style={{ fontSize: 11, color: 'var(--muted)', display: 'block', marginBottom: 4 }}>Nome / Ragione Sociale *</label>
                <input value={nome} onChange={e => setNome(e.target.value)} required style={{ fontSize: 13, fontWeight: 600 }} />
              </div>
              <div style={{ flex: 1 }}>
                <label style={{ fontSize: 11, color: 'var(--muted)', display: 'block', marginBottom: 4 }}>Tipologia Soggetto *</label>
                <select value={tipo} onChange={e => setTipo(e.target.value as any)}>
                  <option value="company">🏢 Società / Entità (Company)</option>
                  <option value="individual">👤 Persona Fisica (Individual)</option>
                </select>
              </div>
            </div>

            <div style={{ display: 'flex', gap: 12 }}>
              <div style={{ flex: 1 }}>
                <label style={{ fontSize: 11, color: 'var(--muted)', display: 'block', marginBottom: 4 }}>Partita IVA / VAT Number *</label>
                <input value={piva} onChange={e => setPiva(e.target.value)} placeholder="IT01234567890" />
              </div>
              <div style={{ flex: 1 }}>
                <label style={{ fontSize: 11, color: 'var(--muted)', display: 'block', marginBottom: 4 }}>Codice Fiscale *</label>
                <input value={codFisc} onChange={e => setCodFisc(e.target.value)} placeholder="Codice Fiscale..." />
              </div>
            </div>

            <div style={{ display: 'flex', gap: 12 }}>
              <div style={{ flex: 1 }}>
                <label style={{ fontSize: 11, color: 'var(--muted)', display: 'block', marginBottom: 4 }}>Giurisdizione Costituzione *</label>
                <input value={giurisdizione} onChange={e => setGiurisdizione(e.target.value)} />
              </div>
              <div style={{ flex: 1 }}>
                <label style={{ fontSize: 11, color: 'var(--muted)', display: 'block', marginBottom: 4 }}>Registro Imprese / REA *</label>
                <input value={regImprese} onChange={e => setRegImprese(e.target.value)} />
              </div>
              <div style={{ flex: 1 }}>
                <label style={{ fontSize: 11, color: 'var(--muted)', display: 'block', marginBottom: 4 }}>Capitale Sociale (€)</label>
                <input type="number" value={capitale} onChange={e => setCapitale(Number(e.target.value))} />
              </div>
            </div>
          </div>
        )}

        {/* TAB 2: Progetti & Commesse Attive del Cliente */}
        {tab === 'progetti' && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--text)' }}>
                Fascicoli e Commesse Attive collegate a <strong>{client.nome}</strong>:
              </div>
              <a
                href="/projects"
                style={{
                  background: 'var(--pill-indigo-bg)',
                  border: '1px solid var(--indigo-d)',
                  color: 'var(--pill-indigo-fg)',
                  padding: '5px 12px',
                  borderRadius: 6,
                  fontSize: 11,
                  fontWeight: 700,
                  textDecoration: 'none',
                }}
              >
                ➕ Gestione Progetti ➔
              </a>
            </div>

            {clientProjects.length > 0 ? (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 10, maxHeight: 380, overflowY: 'auto' }}>
                {clientProjects.map((p: any) => {
                  const perc = p.avanzamentoPercentuale || p.percentuale || (p.stato === 'completed' ? 100 : p.stato === 'in_progress' ? 65 : 25);
                  const isDone = p.stato === 'completed' || perc === 100;
                  return (
                    <div
                      key={p.id}
                      style={{
                        background: 'var(--card)',
                        border: '1px solid var(--border)',
                        borderRadius: 12,
                        padding: 14,
                        display: 'flex',
                        flexDirection: 'column',
                        gap: 10,
                      }}
                    >
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                        <div>
                          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                            <span style={{ fontSize: 15 }}>📁</span>
                            <span style={{ fontSize: 13, fontWeight: 800, color: 'var(--text)' }}>{p.nome}</span>
                          </div>
                          <div style={{ fontSize: 11, color: 'var(--muted)', marginTop: 2 }}>
                            {/* Regola 7: giurisdizione e valore si mostrano solo se il progetto li ha
                                davvero; i ripieghi 'Malta' e 28.500 € inventavano dati inesistenti. */}
                            Giurisdizione: <strong style={{ color: 'var(--indigo-l)' }}>{p.giurisdizionePrimaria?.nome || p.giurisdizione || 'n/d'}</strong> · Valore Commessa: <strong style={{ color: 'var(--text)' }}>{p.valoreTotale != null ? fmt(p.valoreTotale / 100) : (p.valore != null ? fmt(p.valore) : 'n/d')}</strong>
                          </div>
                        </div>

                        <span
                          style={{
                            fontSize: 10,
                            fontWeight: 800,
                            padding: '3px 8px',
                            borderRadius: 6,
                            background: isDone ? 'var(--pill-green-bg)' : 'var(--pill-indigo-bg)',
                            color: isDone ? 'var(--green)' : 'var(--pill-indigo-fg)',
                            border: `1px solid ${isDone ? 'var(--green)' : 'var(--indigo-d)'}`,
                          }}
                        >
                          {isDone ? '✓ Completato' : p.stato === 'in_progress' ? '⏱ In Lavorazione' : '📋 Pre-Project'}
                        </span>
                      </div>

                      {/* Avanzamento Bar */}
                      <div>
                        <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 10, color: 'var(--muted)', marginBottom: 3 }}>
                          <span>Avanzamento Operativo</span>
                          <strong style={{ color: 'var(--text)' }}>{perc}%</strong>
                        </div>
                        <div style={{ height: 6, width: '100%', background: 'var(--card2)', borderRadius: 3, overflow: 'hidden' }}>
                          <div style={{ height: '100%', width: `${perc}%`, background: isDone ? 'var(--green)' : 'var(--indigo)', borderRadius: 3 }} />
                        </div>
                      </div>

                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', borderTop: '1px solid var(--border)', paddingTop: 8 }}>
                        <span style={{ fontSize: 10.5, color: 'var(--muted)' }}>
                          Moduli Istanziati: <strong>{p.moduli?.length || 4}</strong>
                        </span>
                        <a
                          href={`/projects?progettoId=${p.id}`}
                          style={{
                            fontSize: 11,
                            fontWeight: 700,
                            color: 'var(--indigo-l)',
                            textDecoration: 'none',
                          }}
                        >
                          Apri Dettaglio Commessa ➔
                        </a>
                      </div>
                    </div>
                  );
                })}
              </div>
            ) : (
              <div style={{ background: 'var(--card2)', border: '1px dashed var(--border)', borderRadius: 12, padding: 24, textAlign: 'center' }}>
                <div style={{ fontSize: 24, marginBottom: 6 }}>📁</div>
                <div style={{ fontSize: 13, fontWeight: 700 }}>Nessuna commessa ancora associata a {client.nome}</div>
                <div style={{ fontSize: 11, color: 'var(--muted)', marginTop: 4, marginBottom: 12 }}>
                  Puoi istanziare un nuovo progetto dal catalogo preventivi collegandolo direttamente a questo cliente.
                </div>
                <a
                  href="/projects"
                  style={{
                    background: 'var(--indigo)',
                    color: '#fff',
                    padding: '8px 16px',
                    borderRadius: 8,
                    fontSize: 11.5,
                    fontWeight: 700,
                    textDecoration: 'none',
                    display: 'inline-block',
                  }}
                >
                  ➕ Crea Nuovo Progetto
                </a>
              </div>
            )}
          </div>
        )}

        {/* TAB 2: Sede & Contatti */}
        {tab === 'sede' && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            <div>
              <label style={{ fontSize: 11, color: 'var(--muted)', display: 'block', marginBottom: 4 }}>Indirizzo Sede Legale / Domicilio *</label>
              <input value={indirizzo} onChange={e => setIndirizzo(e.target.value)} required />
            </div>

            <div style={{ display: 'flex', gap: 12 }}>
              <div style={{ flex: 1 }}>
                <label style={{ fontSize: 11, color: 'var(--muted)', display: 'block', marginBottom: 4 }}>Città *</label>
                <input value={citta} onChange={e => setCitta(e.target.value)} required />
              </div>
              <div style={{ flex: 1 }}>
                <label style={{ fontSize: 11, color: 'var(--muted)', display: 'block', marginBottom: 4 }}>CAP *</label>
                <input value={cap} onChange={e => setCap(e.target.value)} required />
              </div>
              <div style={{ flex: 1 }}>
                <label style={{ fontSize: 11, color: 'var(--muted)', display: 'block', marginBottom: 4 }}>Nazione *</label>
                <input value={nazione} onChange={e => setNazione(e.target.value)} required />
              </div>
            </div>

            <div style={{ display: 'flex', gap: 12 }}>
              <div style={{ flex: 1 }}>
                <label style={{ fontSize: 11, color: 'var(--muted)', display: 'block', marginBottom: 4 }}>Email Professionale *</label>
                <input type="email" value={email} onChange={e => setEmail(e.target.value)} required />
              </div>
              <div style={{ flex: 1 }}>
                <label style={{ fontSize: 11, color: 'var(--muted)', display: 'block', marginBottom: 4 }}>Email PEC Ufficiale *</label>
                <input type="email" value={pec} onChange={e => setPec(e.target.value)} required />
              </div>
              <div style={{ flex: 1 }}>
                <label style={{ fontSize: 11, color: 'var(--muted)', display: 'block', marginBottom: 4 }}>Telefono Centralino / Ufficio</label>
                <input value={telefono} onChange={e => setTelefono(e.target.value)} />
              </div>
            </div>

            {/* Sezione Canali Diretti Omnichannel */}
            <div style={{ background: 'var(--card2)', border: '1px solid var(--border)', borderRadius: 12, padding: 14, marginTop: 4, display: 'flex', flexDirection: 'column', gap: 10 }}>
              <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--indigo-l)', display: 'flex', alignItems: 'center', gap: 6 }}>
                <span>💬 Recapiti Diretti Comunicazioni (WhatsApp, Telegram, Signal)</span>
              </div>

              <div style={{ display: 'flex', gap: 12 }}>
                <div style={{ flex: 1 }}>
                  <label style={{ fontSize: 11, color: 'var(--muted)', display: 'block', marginBottom: 4 }}>🟢 Cellulare / WhatsApp Diretto *</label>
                  <input value={cellulare} onChange={e => setCellulare(e.target.value)} placeholder="+39 333 5936278" required />
                </div>
                <div style={{ flex: 1 }}>
                  <label style={{ fontSize: 11, color: 'var(--muted)', display: 'block', marginBottom: 4 }}>✈️ Chat ID Telegram</label>
                  <input value={telegram} onChange={e => setTelegram(e.target.value)} placeholder="es. 123456789" inputMode="numeric" />
                  <div style={{ fontSize: 10, color: 'var(--muted)', marginTop: 3 }}>
                    Solo il numero: lo <code>@nomeutente</code> non funziona sui clienti. Il cliente scrive
                    una volta al bot dello studio e la chat id compare fra gli aggiornamenti ricevuti.
                    <strong> Non è</strong> l'identificativo che risponde <code>getMe</code>: quello è del
                    bot, e Telegram risponde «the bot can't send messages to the bot».
                  </div>
                </div>
              </div>

              <div style={{ display: 'flex', gap: 12 }}>
                <div style={{ flex: 1 }}>
                  <label style={{ fontSize: 11, color: 'var(--muted)', display: 'block', marginBottom: 4 }}>🔒 Numero Signal (col prefisso)</label>
                  <input value={signal} onChange={e => setSignal(e.target.value)} placeholder="+39 000 0000000" />
                  <div style={{ fontSize: 10, color: 'var(--muted)', marginTop: 3 }}>
                    Deve essere un numero registrato su Signal e va scritto in forma internazionale:
                    un cellulare che non ha Signal non riceve niente, e senza <code>+39</code> il
                    demone dello studio rifiuta l'invio.
                  </div>
                </div>
                <div style={{ flex: 1 }}>
                  <label style={{ fontSize: 11, color: 'var(--muted)', display: 'block', marginBottom: 4 }}>👤 Nome Referente / Contatto Diretto</label>
                  <input value={referenteNome} onChange={e => setReferenteNome(e.target.value)} placeholder="es. Ing. Roberto Rossi (CEO)" />
                </div>
              </div>
            </div>
          </div>
        )}

        {/* TAB 3: SDI & Fatturazione */}
        {tab === 'sdi' && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            <div style={{ display: 'flex', gap: 12 }}>
              <div style={{ flex: 1 }}>
                <label style={{ fontSize: 11, color: 'var(--muted)', display: 'block', marginBottom: 4 }}>Codice Destinatario SDI (7 caratteri) *</label>
                <input value={sdiCode} onChange={e => setSdiCode(e.target.value)} style={{ fontFamily: 'monospace', fontSize: 13, fontWeight: 700 }} required />
              </div>
              <div style={{ flex: 2 }}>
                <label style={{ fontSize: 11, color: 'var(--muted)', display: 'block', marginBottom: 4 }}>Regime Fiscale *</label>
                <input value={regimeFiscale} onChange={e => setRegimeFiscale(e.target.value)} required />
              </div>
            </div>

            <div style={{ display: 'flex', gap: 12 }}>
              <div style={{ flex: 1 }}>
                <label style={{ fontSize: 11, color: 'var(--muted)', display: 'block', marginBottom: 4 }}>Aliquota IVA di default (%)</label>
                <input
                  type="number"
                  min={0}
                  max={100}
                  step={1}
                  value={aliquotaIvaDefault}
                  onChange={e => setAliquotaIvaDefault(e.target.value)}
                  placeholder="es. 22 — vuoto = non dichiarata"
                />
                <div style={{ fontSize: 10, color: 'var(--muted)', marginTop: 4 }}>
                  Guida l'IVA delle fatture di questo cliente. Vuoto: si applica il default (estero 0%, altrimenti 22%). 0 = esente.
                </div>
              </div>
              <div style={{ flex: 1 }}>
                <label style={{ fontSize: 11, color: 'var(--muted)', display: 'block', marginBottom: 4 }}>Natura esenzione (se aliquota 0)</label>
                <input
                  value={naturaEsenzioneDefault}
                  onChange={e => setNaturaEsenzioneDefault(e.target.value)}
                  placeholder="es. N2.2, N3.1, N6.9"
                  style={{ fontFamily: 'monospace', fontSize: 12.5 }}
                />
                <div style={{ fontSize: 10, color: 'var(--muted)', marginTop: 4 }}>
                  Codice riportato in fattura quando l'IVA è 0. Obbligatorio per lo SDI su operazioni esenti/non imponibili.
                </div>
              </div>
            </div>

            <div>
              <label style={{ fontSize: 11, color: 'var(--muted)', display: 'block', marginBottom: 4 }}>IBAN Accrediti / Addebiti del Cliente *</label>
              <input value={iban} onChange={e => setIban(e.target.value)} style={{ fontFamily: 'monospace', fontSize: 12.5 }} required />
            </div>

            <div style={{ background: 'var(--pill-green-bg)', border: '1px solid var(--pill-green-bg)', borderRadius: 10, padding: 12, fontSize: 11, color: 'var(--green)' }}>
              ✓ Collegato al nodo di trasmissione <strong>Comped Servizi FPA (SDI)</strong>.
            </div>
          </div>
        )}

        {/* TAB 4: Compliance & KYC */}
        {tab === 'compliance' && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            <div style={{ display: 'flex', gap: 12 }}>
              <div style={{ flex: 1 }}>
                <label style={{ fontSize: 11, color: 'var(--muted)', display: 'block', marginBottom: 4 }}>Classe di Rischio Antiriciclaggio (AML) *</label>
                <select value={rischioAml} onChange={e => setRischioAml(e.target.value as any)}>
                  <option value="basso">🟢 Basso Rischio</option>
                  <option value="medio">🟡 Medio Rischio</option>
                  <option value="alto">🔴 Alto Rischio / Persona Politicamente Esposta (PEP)</option>
                </select>
              </div>
              <div style={{ flex: 1 }}>
                <label style={{ fontSize: 11, color: 'var(--muted)', display: 'block', marginBottom: 4 }}>Data Ultimo Rinnovo KYC *</label>
                <input value={dataKyc} onChange={e => setDataKyc(e.target.value)} required />
              </div>
            </div>

            <div>
              <label style={{ fontSize: 11, color: 'var(--muted)', display: 'block', marginBottom: 4 }}>Titolare Effettivo (UBO) & Struttura di Controllo *</label>
              <input value={ubo} onChange={e => setUbo(e.target.value)} required />
            </div>

            <div>
              <label style={{ fontSize: 11, color: 'var(--muted)', display: 'block', marginBottom: 4 }}>Provenienza dei Fondi / Origine Patrimonio *</label>
              <input value={fontePatrimonio} onChange={e => setFontePatrimonio(e.target.value)} required />
            </div>
          </div>
        )}

        {/* Footer Actions */}
        <div style={{ borderTop: '1px solid var(--border)', paddingTop: 14, display: 'flex', justifyContent: 'flex-end', gap: 10 }}>
          <button type="button" onClick={richiediChiusura} style={{ background: 'transparent', border: '1px solid var(--border)', color: 'var(--muted)', padding: '8px 16px', borderRadius: 8, fontSize: 12, cursor: 'pointer' }}>Annulla</button>
          <button type="submit" disabled={saving} style={{ background: 'var(--indigo)', color: '#fff', border: 'none', padding: '8px 20px', borderRadius: 8, fontSize: 12, fontWeight: 600, cursor: 'pointer', boxShadow: '0 4px 16px rgba(99,102,241,.4)' }}>
            {saving ? 'Salvataggio...' : '✓ Salva Anagrafica ERP Cliente'}
          </button>
        </div>
      </form>
      )}
    </Modal>
  );
}

const tabBtn = (active: boolean): React.CSSProperties => ({
  background: active ? 'var(--surface-1)' : 'transparent',
  border: 'none',
  borderBottom: active ? '2px solid var(--indigo-l)' : '2px solid transparent',
  color: active ? 'var(--indigo-l)' : 'var(--muted)',
  fontSize: 11.5,
  fontWeight: 600,
  padding: '6px 12px',
  cursor: 'pointer',
});
