import React, { useState, useEffect } from 'react';
import {
  fetchComplianceSettings,
  salvaComplianceSettings,
  fetchComplianceEvents,
  type ComplianceSettings,
  type ComplianceEvent,
  type IntegritaCatena,
} from '../../api/compliance';
import { useTeamMembers } from '../../hooks/useTeamMembers';
import { PannelloBusinessRisk } from './PannelloBusinessRisk';
import { PannelloFormazione } from './PannelloFormazione';
import { PannelloQuestionarioFiau } from './PannelloQuestionarioFiau';
import { scaricaReportStudioPdf } from '../../api/compliance';
interface TabComplianceProps {
  /** Scrittura riservata ad advisor/super_admin; gli altri ruoli interni vedono in sola lettura. */
  ruolo?: string;
}

const PACCHETTI: Array<{ v: string; label: string }> = [
  { v: 'MT', label: '🇲🇹 Malta (FIAU / MFSA)' },
  { v: 'IT', label: '🇮🇹 Italia (UIF / OAM)' },
];
const PROFILI: Array<{ v: string; label: string }> = [
  { v: 'CSP_MFSA', label: 'CSP autorizzato MFSA (Company Service Provider)' },
  { v: 'ALTRO_SOGGETTO_OBBLIGATO', label: 'Altro soggetto obbligato' },
];

// PLACEHOLDER_BODY

export function TabCompliance({ ruolo }: TabComplianceProps) {
  const puoScrivere = ruolo === 'advisor' || ruolo === 'super_admin';
  const { team } = useTeamMembers();

  const [settings, setSettings] = useState<ComplianceSettings | null>(null);
  const [modalitaBozza, setModalitaBozza] = useState<boolean>(true);
  const [eventi, setEventi] = useState<ComplianceEvent[]>([]);
  const [catena, setCatena] = useState<IntegritaCatena | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [errore, setErrore] = useState<string | null>(null);
  const [successo, setSuccesso] = useState<string | null>(null);

  // Campi del form (controllati)
  const [jurisdictionPack, setJurisdictionPack] = useState('MT');
  const [regulatoryProfile, setRegulatoryProfile] = useState('');
  const [otherSubjectCategory, setOtherSubjectCategory] = useState('');
  const [retentionYears, setRetentionYears] = useState(5);
  const [mlroUserId, setMlroUserId] = useState('');
  const [reportingChannel, setReportingChannel] = useState('goAML');
  const [screeningProvider, setScreeningProvider] = useState('MANUALE');
  // K2 — config titolare effettivo
  const [sogliaTe, setSogliaTe] = useState(25);
  const [allarmeTe, setAllarmeTe] = useState(false);
  const [gestioneRegistroTe, setGestioneRegistroTe] = useState(false);

  const applica = (s: ComplianceSettings) => {
    setSettings(s);
    setJurisdictionPack(s.jurisdictionPack || 'MT');
    setRegulatoryProfile(s.regulatoryProfile || '');
    setOtherSubjectCategory(s.otherSubjectCategory || '');
    setRetentionYears(s.retentionYears ?? 5);
    setMlroUserId(s.mlroUserId || '');
    setReportingChannel(s.reportingChannel || 'goAML');
    setScreeningProvider(s.screeningProvider || 'MANUALE');
    setSogliaTe(s.sogliaTitolareEffettivo ?? 25);
    setAllarmeTe(!!s.allarmeVariazioniTe);
    setGestioneRegistroTe(!!s.gestioneRegistroTe);
  };

  const caricaEventi = () => {
    fetchComplianceEvents()
      .then(r => { setEventi(r.eventi); setCatena(r.catena); })
      .catch(() => { /* l'audit trail non è bloccante per la scheda */ });
  };

  useEffect(() => {
    fetchComplianceSettings()
      .then(r => { applica(r.settings); setModalitaBozza(r.modalitaBozza); })
      .catch(err => setErrore(err.message || 'Errore nel caricamento della compliance'))
      .finally(() => setLoading(false));
    caricaEventi();
  }, []);

  const salva = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrore(null);
    setSuccesso(null);
    setSaving(true);
    try {
      const r = await salvaComplianceSettings({
        jurisdictionPack,
        regulatoryProfile: regulatoryProfile || null,
        otherSubjectCategory: regulatoryProfile === 'ALTRO_SOGGETTO_OBBLIGATO' ? (otherSubjectCategory || null) : null,
        retentionYears,
        mlroUserId: mlroUserId || null,
        reportingChannel,
        screeningProvider,
        sogliaTitolareEffettivo: sogliaTe,
        allarmeVariazioniTe: allarmeTe,
        gestioneRegistroTe,
      });
      applica(r.settings);
      setModalitaBozza(r.modalitaBozza);
      caricaEventi();
      setSuccesso('✅ Impostazioni di compliance salvate.');
      setTimeout(() => setSuccesso(null), 5000);
    } catch (err: any) {
      setErrore(err.message || 'Errore durante il salvataggio');
    } finally {
      setSaving(false);
    }
  };

  // ── Stili condivisi (allineati a TabSicurezza) ──
  const sCard: React.CSSProperties = {
    background: 'var(--sidebar)', border: '1px solid var(--border)', borderRadius: 14,
    padding: 24, display: 'flex', flexDirection: 'column', gap: 18,
  };
  const sBadge = (ok: boolean): React.CSSProperties => ({
    display: 'inline-flex', alignItems: 'center', gap: 6,
    background: ok ? 'rgba(52,211,153,.12)' : 'rgba(251,191,36,.12)',
    border: `1px solid ${ok ? 'rgba(52,211,153,.3)' : 'rgba(251,191,36,.3)'}`,
    color: ok ? 'var(--green)' : 'var(--amber)',
    borderRadius: 8, padding: '4px 12px', fontSize: 12, fontWeight: 700,
  });
  const sLabel: React.CSSProperties = { fontSize: 11, color: 'var(--muted)', display: 'block', marginBottom: 4 };
  const sInput: React.CSSProperties = { width: '100%', fontSize: 14 };

  const nomeAttore = (id: string | null) => {
    if (!id) return '—';
    const m = team.find(t => t.dbId === id);
    return m ? m.n : id.slice(0, 8);
  };
  const dataIt = (iso: string) => {
    try { return new Date(iso).toLocaleString('it-IT'); } catch { return iso; }
  };

  if (loading) {
    return <div style={sCard}><div style={{ color: 'var(--muted)', fontSize: 13 }}>Caricamento compliance…</div></div>;
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      {errore && (
        <div style={{ background: 'var(--pill-red-bg)', border: '1px solid var(--pill-red-bg)', color: 'var(--pill-red-fg)', padding: '10px 14px', borderRadius: 8, fontSize: 12 }}>⚠️ {errore}</div>
      )}
      {successo && (
        <div style={{ background: 'var(--pill-green-bg)', border: '1px solid var(--pill-green-bg)', color: 'var(--green)', padding: '10px 14px', borderRadius: 8, fontSize: 12, fontWeight: 600 }}>{successo}</div>
      )}

      {/* ── Card impostazioni compliance ── */}
      <form onSubmit={salva} style={sCard}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', flexWrap: 'wrap', gap: 12 }}>
          <div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 6 }}>
              <span style={{ fontSize: 22 }}>🛡️</span>
              <span style={{ fontSize: 15, fontWeight: 700, color: 'var(--text)' }}>Compliance & Antiriciclaggio (AML)</span>
              <span style={sBadge(!modalitaBozza)}>{modalitaBozza ? '○ Modalità bozza' : '● Configurazione vigente'}</span>
            </div>
            <p style={{ fontSize: 12, color: 'var(--muted)', margin: 0, maxWidth: 620, lineHeight: 1.6 }}>
              Il modulo KYC/AML resta in <strong style={{ color: 'var(--text)' }}>bozza</strong> finché lo studio non sceglie il profilo regolatorio e nomina l'<strong style={{ color: 'var(--text)' }}>MLRO</strong> (Money Laundering Reporting Officer). In bozza è consultabile ma non abilita gli incarichi.
            </p>
          </div>
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))', gap: 16 }}>
          <div>
            <label style={sLabel} htmlFor="cmp-pack">Pacchetto giurisdizione</label>
            <select id="cmp-pack" value={jurisdictionPack} disabled={!puoScrivere} onChange={e => setJurisdictionPack(e.target.value)} style={sInput}>
              {PACCHETTI.map(p => <option key={p.v} value={p.v}>{p.label}</option>)}
            </select>
          </div>

          <div>
            <label style={sLabel} htmlFor="cmp-profilo">Profilo regolatorio *</label>
            <select id="cmp-profilo" value={regulatoryProfile} disabled={!puoScrivere} onChange={e => setRegulatoryProfile(e.target.value)} style={sInput}>
              <option value="">— Da scegliere —</option>
              {PROFILI.map(p => <option key={p.v} value={p.v}>{p.label}</option>)}
            </select>
          </div>

          {regulatoryProfile === 'ALTRO_SOGGETTO_OBBLIGATO' && (
            <div>
              <label style={sLabel} htmlFor="cmp-altro">Categoria soggetto obbligato</label>
              <input id="cmp-altro" type="text" value={otherSubjectCategory} disabled={!puoScrivere} maxLength={200} onChange={e => setOtherSubjectCategory(e.target.value)} style={sInput} placeholder="es. VFA agent, trustee…" />
            </div>
          )}

          <div>
            <label style={sLabel} htmlFor="cmp-mlro">MLRO (responsabile segnalazioni) *</label>
            <select id="cmp-mlro" value={mlroUserId} disabled={!puoScrivere} onChange={e => setMlroUserId(e.target.value)} style={sInput}>
              <option value="">— Da nominare —</option>
              {team.map(m => <option key={m.dbId} value={m.dbId}>{m.n} — {m.r}</option>)}
            </select>
          </div>

          <div>
            <label style={sLabel} htmlFor="cmp-retention">Conservazione (anni)</label>
            <input id="cmp-retention" type="number" min={1} max={30} value={retentionYears} disabled={!puoScrivere} onChange={e => setRetentionYears(Number(e.target.value))} style={sInput} />
          </div>

          <div>
            <label style={sLabel} htmlFor="cmp-canale">Canale di segnalazione</label>
            <input id="cmp-canale" type="text" value={reportingChannel} disabled={!puoScrivere} maxLength={40} onChange={e => setReportingChannel(e.target.value)} style={sInput} placeholder="goAML" />
          </div>

          <div>
            <label style={sLabel} htmlFor="cmp-screening">Provider di screening</label>
            <input id="cmp-screening" type="text" value={screeningProvider} disabled={!puoScrivere} maxLength={60} onChange={e => setScreeningProvider(e.target.value)} style={sInput} placeholder="MANUALE" />
          </div>

          <div>
            <label style={sLabel} htmlFor="cmp-soglia-te">Soglia titolare effettivo (%)</label>
            <input id="cmp-soglia-te" type="number" min={0} max={100} value={sogliaTe} disabled={!puoScrivere} onChange={e => setSogliaTe(Number(e.target.value))} style={sInput} />
            <div style={{ fontSize: 10, color: 'var(--muted)', marginTop: 2 }}>Default 25% (Malta) — da verificare con le Implementing Procedures.</div>
          </div>

          <div>
            <label style={sLabel}>Registro titolari effettivi</label>
            <label htmlFor="cmp-allarme-te" style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12, cursor: puoScrivere ? 'pointer' : 'default' }}>
              <input id="cmp-allarme-te" type="checkbox" checked={allarmeTe} disabled={!puoScrivere} onChange={e => setAllarmeTe(e.target.checked)} />
              Allarme variazioni a 14 giorni
            </label>
            <label htmlFor="cmp-gest-reg" style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12, marginTop: 6, cursor: puoScrivere ? 'pointer' : 'default' }}>
              <input id="cmp-gest-reg" type="checkbox" checked={gestioneRegistroTe} disabled={!puoScrivere} onChange={e => setGestioneRegistroTe(e.target.checked)} />
              Lo studio coordina i depositi al registro
            </label>
          </div>
        </div>

        {puoScrivere ? (
          <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
            <button type="submit" disabled={saving} style={{ background: 'var(--indigo)', color: '#fff', border: 'none', padding: '10px 22px', borderRadius: 9, fontSize: 13, fontWeight: 700, cursor: 'pointer', opacity: saving ? 0.6 : 1 }}>
              {saving ? 'Salvataggio…' : '💾 Salva impostazioni'}
            </button>
            {settings && <span style={{ fontSize: 11, color: 'var(--muted)' }}>Versione {settings.versione}</span>}
          </div>
        ) : (
          <div style={{ fontSize: 12, color: 'var(--muted)' }}>Sola lettura: la configurazione di compliance è riservata al responsabile dello studio.</div>
        )}
      </form>

      {/* ── K9/§5.5 — valutazione del rischio dello studio (business risk assessment) ── */}
      <PannelloBusinessRisk puoScrivere={puoScrivere} />

      {/* ── K9/§5.5 — registro della formazione AML ── */}
      <PannelloFormazione puoScrivere={puoScrivere} />

      {/* ── K9/§5.5 — questionario periodico FIAU (REQ) ── */}
      <PannelloQuestionarioFiau puoScrivere={puoScrivere} />

      {/* ── K9/§5.5 — report di studio (panoramica AML) ── */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
        <button type="button" className="btn btn-sm btn-secondary" onClick={() => { setErrore(null); scaricaReportStudioPdf().catch((e) => setErrore(e?.message || 'Errore report di studio')); }}>
          📊 Scarica report compliance di studio (PDF)
        </button>
        <span style={{ fontSize: 11, color: 'var(--muted)' }}>Panoramica AML: rischio d’attività, formazione, questionario FIAU e conteggi pratiche.</span>
      </div>

      {/* ── Card audit trail append-only ── */}
      <div style={sCard}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <span style={{ fontSize: 20 }}>🔗</span>
          <span style={{ fontSize: 14, fontWeight: 700, color: 'var(--text)' }}>Registro eventi di compliance (immutabile)</span>
          {catena && (
            <span style={sBadge(catena.integra)}>{catena.integra ? '✓ Catena integra' : `⚠ Catena compromessa (evento #${(catena.rotturaIndice ?? 0) + 1})`}</span>
          )}
        </div>
        <p style={{ fontSize: 12, color: 'var(--muted)', margin: 0, lineHeight: 1.6 }}>
          Ogni modifica alle impostazioni scrive un evento concatenato con hash SHA-256 al precedente: una manomissione retroattiva rompe la catena ed è rilevabile.
        </p>
        {eventi.length === 0 ? (
          <div style={{ fontSize: 12, color: 'var(--muted)', fontStyle: 'italic' }}>Nessun evento registrato.</div>
        ) : (
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
              <thead>
                <tr style={{ textAlign: 'left', color: 'var(--muted)', borderBottom: '1px solid var(--border)' }}>
                  <th style={{ padding: '8px 10px', fontWeight: 600 }}>Data</th>
                  <th style={{ padding: '8px 10px', fontWeight: 600 }}>Evento</th>
                  <th style={{ padding: '8px 10px', fontWeight: 600 }}>Attore</th>
                  <th style={{ padding: '8px 10px', fontWeight: 600 }}>Hash</th>
                </tr>
              </thead>
              <tbody>
                {eventi.map(ev => (
                  <tr key={ev.id} style={{ borderBottom: '1px solid var(--border)', color: 'var(--text)' }}>
                    <td style={{ padding: '8px 10px', whiteSpace: 'nowrap' }}>{dataIt(ev.createdAt)}</td>
                    <td style={{ padding: '8px 10px' }}>{ev.tipo}</td>
                    <td style={{ padding: '8px 10px' }}>{nomeAttore(ev.attoreUserId)}</td>
                    <td style={{ padding: '8px 10px', fontFamily: 'monospace', color: 'var(--muted)' }}>{ev.hash.slice(0, 12)}…</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
