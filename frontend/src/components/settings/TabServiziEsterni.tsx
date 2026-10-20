import React, { useEffect, useState } from 'react';
import {
  fetchServiziEsterni,
  salvaServizioEsterno,
  verificaCollegamentoTsa,
  type EsitoVerificaTsa,
  type ServizioEsterno,
  type ServizioEsternoKey,
} from '../../api/serviziEsterni';

interface TabServiziEsterniProps {
  /** Scrittura riservata ad advisor/super_admin (il backend risponde 403 agli altri). */
  ruolo?: string;
}

interface FormServizio {
  endpoint: string;
  username: string;
  etichetta: string;
  segreto: string;
  rimuoviSegreto: boolean;
}

const formVuoto = (): FormServizio => ({ endpoint: '', username: '', etichetta: '', segreto: '', rimuoviSegreto: false });
const FORMS_INIZIALI: Record<ServizioEsternoKey, FormServizio> = {
  kyc_visura: formVuoto(),
  kyc_screening: formVuoto(),
  tsa: formVuoto(),
};

/**
 * Le credenziali che lo studio riceve dai fornitori dei servizi usati a Malta.
 *
 * Il segreto è di sola scrittura: il server non lo restituisce mai e qui si vede solo la coda
 * mascherata. Il campo vuoto significa «non cambiarlo», non «cancellalo»: per cancellarlo c'è
 * una casella esplicita, altrimenti un salvataggio distratto cancellerebbe la chiave.
 */
export function TabServiziEsterni({ ruolo }: TabServiziEsterniProps) {
  const puoScrivere = ruolo === 'advisor' || ruolo === 'super_admin';
  const [servizi, setServizi] = useState<ServizioEsterno[]>([]);
  const [forms, setForms] = useState<Record<ServizioEsternoKey, FormServizio>>(FORMS_INIZIALI);
  const [loading, setLoading] = useState(true);
  const [salvando, setSalvando] = useState<ServizioEsternoKey | null>(null);
  const [errore, setErrore] = useState<string | null>(null);
  const [successo, setSuccesso] = useState<string | null>(null);
  const [provaTsa, setProvaTsa] = useState<{ inCorso: boolean; esito: EsitoVerificaTsa | null }>({ inCorso: false, esito: null });

  const applica = (elenco: ServizioEsterno[]) => {
    setServizi(elenco);
    const prossimi = { ...FORMS_INIZIALI };
    for (const s of elenco) {
      prossimi[s.servizio] = {
        endpoint: s.endpoint || '',
        username: s.username || '',
        etichetta: s.etichetta || '',
        segreto: '',
        rimuoviSegreto: false,
      };
    }
    setForms(prossimi);
  };

  useEffect(() => {
    fetchServiziEsterni()
      .then((r) => applica(r.servizi))
      .catch((e) => setErrore(e?.message || 'Errore nel caricamento dei servizi esterni'))
      .finally(() => setLoading(false));
  }, []);

  const aggiornaCampo = (servizio: ServizioEsternoKey, campo: keyof FormServizio, valore: string | boolean) => {
    setForms((cur) => ({ ...cur, [servizio]: { ...cur[servizio], [campo]: valore } }));
  };

  const salva = async (servizio: ServizioEsternoKey) => {
    const f = forms[servizio];
    setErrore(null);
    setSuccesso(null);
    setSalvando(servizio);
    try {
      const r = await salvaServizioEsterno(servizio, {
        endpoint: f.endpoint.trim() || null,
        username: f.username.trim() || null,
        etichetta: f.etichetta.trim() || null,
        ...(f.rimuoviSegreto ? { segreto: '' } : f.segreto ? { segreto: f.segreto } : {}),
      });
      setServizi((cur) => cur.map((s) => (s.servizio === servizio ? r.servizio : s)));
      setForms((cur) => ({ ...cur, [servizio]: { ...cur[servizio], segreto: '', rimuoviSegreto: false } }));
      setSuccesso(`✅ ${r.servizio.etichetta}: credenziali salvate.`);
      setTimeout(() => setSuccesso(null), 5000);
    } catch (e: any) {
      setErrore(e?.message || 'Errore durante il salvataggio');
    } finally {
      setSalvando(null);
    }
  };

  /**
   * Prova di collegamento della TSA: usa le credenziali SALVATE, non quelle appena digitate.
   * Se l'utente ha modificato l'indirizzo, prima salva e poi prova.
   */
  const provaCollegamentoTsa = async () => {
    setErrore(null);
    setSuccesso(null);
    setProvaTsa({ inCorso: true, esito: null });
    try {
      const esito = await verificaCollegamentoTsa();
      setProvaTsa({ inCorso: false, esito });
    } catch (e: any) {
      setProvaTsa({
        inCorso: false,
        esito: {
          ok: false, stato: 'sconosciuto', endpoint: '', genTime: null, policy: null,
          serialNumber: null, hashVerificato: false, avviso: null,
          errore: e?.message || 'Errore nella prova di collegamento con la TSA',
        },
      });
    }
  };

  const sCard: React.CSSProperties = {    background: 'var(--sidebar)', border: '1px solid var(--border)', borderRadius: 14,
    padding: 24, display: 'flex', flexDirection: 'column', gap: 16,
  };
  const sLabel: React.CSSProperties = { fontSize: 11, color: 'var(--muted)', display: 'block', marginBottom: 4 };
  const sInput: React.CSSProperties = { width: '100%', fontSize: 14 };
  const sBadge = (ok: boolean): React.CSSProperties => ({
    display: 'inline-flex', alignItems: 'center', gap: 6,
    background: ok ? 'rgba(52,211,153,.12)' : 'rgba(251,191,36,.12)',
    border: `1px solid ${ok ? 'rgba(52,211,153,.3)' : 'rgba(251,191,36,.3)'}`,
    color: ok ? 'var(--green)' : 'var(--amber)',
    borderRadius: 8, padding: '4px 12px', fontSize: 12, fontWeight: 700,
  });

  const dataIt = (iso: string | null) => {
    if (!iso) return null;
    try { return new Date(iso).toLocaleString('it-IT'); } catch { return iso; }
  };

  if (loading) {
    return <div style={sCard}><div style={{ color: 'var(--muted)', fontSize: 13 }}>Caricamento servizi esterni…</div></div>;
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      {errore && (
        <div style={{ background: 'var(--pill-red-bg)', border: '1px solid var(--pill-red-bg)', color: 'var(--pill-red-fg)', padding: '10px 14px', borderRadius: 8, fontSize: 12 }}>⚠️ {errore}</div>
      )}
      {successo && (
        <div style={{ background: 'var(--pill-green-bg)', border: '1px solid var(--pill-green-bg)', color: 'var(--green)', padding: '10px 14px', borderRadius: 8, fontSize: 12, fontWeight: 600 }}>{successo}</div>
      )}

      <div style={sCard}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <span style={{ fontSize: 22 }}>🔑</span>
          <div>
            <div style={{ fontSize: 15, fontWeight: 700, color: 'var(--text)' }}>Servizi esterni usati dallo studio</div>
            <div style={{ fontSize: 12, color: 'var(--muted)', lineHeight: 1.6, maxWidth: 720 }}>
              Le credenziali che i fornitori ti hanno rilasciato. Restano sul server dello studio e
              non tornano mai in chiaro al browser; il segreto si può solo scrivere o cancellare.
              Inserisci qui le chiavi tecniche dei servizi: le password personali dei portali
              (FIAU, MFSA, banca) vanno in un gestore di password, non in questa scheda.
            </div>
          </div>
        </div>
      </div>

      {servizi.map((s) => {
        const f = forms[s.servizio];
        const pronto = Boolean(s.endpoint);
        const idBase = `servizio-${s.servizio}`;
        return (
          <form
            key={s.servizio}
            style={sCard}
            onSubmit={(e) => { e.preventDefault(); if (puoScrivere) void salva(s.servizio); }}
          >
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 12, flexWrap: 'wrap' }}>
              <div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 4 }}>
                  <span style={{ fontSize: 14, fontWeight: 700, color: 'var(--text)' }}>{s.etichetta}</span>
                  <span style={sBadge(pronto)}>{pronto ? '● Indirizzo impostato' : '○ Non configurato'}</span>
                  {s.segretoConfigurato && (
                    <span style={{ fontSize: 11, color: 'var(--muted)' }}>
                      Segreto salvato {s.segretoMascherato ? `(${s.segretoMascherato})` : ''}
                    </span>
                  )}
                </div>
                <div style={{ fontSize: 12, color: 'var(--muted)' }}>{s.descrizione}</div>
              </div>
              {dataIt(s.updatedAt) && (
                <span style={{ fontSize: 11, color: 'var(--muted)' }}>Ultima modifica: {dataIt(s.updatedAt)}</span>
              )}
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))', gap: 16 }}>
              <div>
                <label style={sLabel} htmlFor={`${idBase}-endpoint`}>Indirizzo del servizio (URL)</label>
                <input
                  id={`${idBase}-endpoint`}
                  type="url"
                  value={f.endpoint}
                  disabled={!puoScrivere}
                  maxLength={500}
                  placeholder="https://api.fornitore.example/v1"
                  onChange={(e) => aggiornaCampo(s.servizio, 'endpoint', e.target.value)}
                  style={sInput}
                />
              </div>

              <div>
                <label style={sLabel} htmlFor={`${idBase}-utente`}>Nome utente / client ID</label>
                <input
                  id={`${idBase}-utente`}
                  type="text"
                  value={f.username}
                  disabled={!puoScrivere}
                  maxLength={200}
                  autoComplete="off"
                  onChange={(e) => aggiornaCampo(s.servizio, 'username', e.target.value)}
                  style={sInput}
                />
              </div>

              <div>
                <label style={sLabel} htmlFor={`${idBase}-segreto`}>Password / API key</label>
                <input
                  id={`${idBase}-segreto`}
                  type="password"
                  value={f.segreto}
                  disabled={!puoScrivere || f.rimuoviSegreto}
                  maxLength={4000}
                  autoComplete="new-password"
                  placeholder={s.segretoConfigurato ? (s.segretoMascherato || 'Segreto salvato') : 'Nessun segreto impostato'}
                  onChange={(e) => aggiornaCampo(s.servizio, 'segreto', e.target.value)}
                  style={sInput}
                />
                <div style={{ fontSize: 10, color: 'var(--muted)', marginTop: 2 }}>
                  Lascia vuoto per non cambiarlo.
                </div>
              </div>

              <div>
                <label style={sLabel} htmlFor={`${idBase}-etichetta`}>Etichetta interna (facoltativa)</label>
                <input
                  id={`${idBase}-etichetta`}
                  type="text"
                  value={f.etichetta}
                  disabled={!puoScrivere}
                  maxLength={120}
                  placeholder="es. Contratto studio 2026"
                  onChange={(e) => aggiornaCampo(s.servizio, 'etichetta', e.target.value)}
                  style={sInput}
                />
              </div>
            </div>

            {s.servizio === 'tsa' && (
              <div style={{ borderTop: '1px solid var(--border)', paddingTop: 14, display: 'flex', flexDirection: 'column', gap: 10 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
                  <button
                    type="button"
                    onClick={() => void provaCollegamentoTsa()}
                    disabled={!puoScrivere || provaTsa.inCorso}
                    style={{
                      background: 'transparent', color: 'var(--indigo)', border: '1px solid var(--indigo)',
                      padding: '8px 18px', borderRadius: 9, fontSize: 12, fontWeight: 700,
                      cursor: puoScrivere ? 'pointer' : 'default', opacity: provaTsa.inCorso ? 0.6 : 1,
                    }}
                  >
                    {provaTsa.inCorso ? 'Verifica in corso…' : '🔗 Verifica collegamento'}
                  </button>
                  <span style={{ fontSize: 11, color: 'var(--muted)' }}>
                    Marca un’impronta casuale e non conserva nulla. Usa le credenziali salvate: salva prima le modifiche.
                  </span>
                </div>

                {provaTsa.esito && (
                  <div
                    style={{
                      background: provaTsa.esito.ok ? 'rgba(52,211,153,.10)' : 'var(--pill-red-bg)',
                      border: `1px solid ${provaTsa.esito.ok ? 'rgba(52,211,153,.3)' : 'var(--pill-red-bg)'}`,
                      color: provaTsa.esito.ok ? 'var(--green)' : 'var(--pill-red-fg)',
                      borderRadius: 8, padding: '10px 14px', fontSize: 12, lineHeight: 1.6,
                    }}
                  >
                    {provaTsa.esito.ok ? (
                      <>
                        <div style={{ fontWeight: 700 }}>
                          Marca temporale rilasciata{provaTsa.esito.genTime ? `: ${dataIt(provaTsa.esito.genTime)}` : ''}
                        </div>
                        <div style={{ color: 'var(--muted)', marginTop: 4 }}>
                          TSA: {provaTsa.esito.endpoint}
                          {provaTsa.esito.policy ? ` · policy ${provaTsa.esito.policy}` : ''}
                          {provaTsa.esito.serialNumber ? ` · seriale ${provaTsa.esito.serialNumber}` : ''}
                        </div>
                        {provaTsa.esito.avviso && (
                          <div style={{ color: 'var(--amber)', marginTop: 6, fontSize: 11 }}>{provaTsa.esito.avviso}</div>
                        )}
                      </>
                    ) : (
                      <div>⚠️ {provaTsa.esito.errore || 'La TSA non ha rilasciato la marca temporale.'}</div>
                    )}
                  </div>
                )}
              </div>
            )}

            {s.segretoConfigurato && (
              <label htmlFor={`${idBase}-rimuovi`} style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12, cursor: puoScrivere ? 'pointer' : 'default' }}>
                <input
                  id={`${idBase}-rimuovi`}
                  type="checkbox"
                  checked={f.rimuoviSegreto}
                  disabled={!puoScrivere}
                  onChange={(e) => aggiornaCampo(s.servizio, 'rimuoviSegreto', e.target.checked)}
                />
                Rimuovi il segreto salvato
              </label>
            )}

            {puoScrivere ? (
              <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                <button
                  type="submit"
                  disabled={salvando === s.servizio}
                  style={{ background: 'var(--indigo)', color: '#fff', border: 'none', padding: '10px 22px', borderRadius: 9, fontSize: 13, fontWeight: 700, cursor: 'pointer', opacity: salvando === s.servizio ? 0.6 : 1 }}
                >
                  {salvando === s.servizio ? 'Salvataggio…' : '💾 Salva'}
                </button>
                {s.aggiornatoDa && <span style={{ fontSize: 11, color: 'var(--muted)' }}>Aggiornato da un operatore</span>}
              </div>
            ) : (
              <div style={{ fontSize: 12, color: 'var(--muted)' }}>Sola lettura: le credenziali sono riservate al responsabile dello studio.</div>
            )}
          </form>
        );
      })}
    </div>
  );
}
