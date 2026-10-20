// Coda KYC — la vista aggregata che mancava. I pannelli erano per-fascicolo dentro la scheda
// cliente: approvare dieci pratiche voleva dire aprire dieci clienti. Qui si vede cosa attende,
// perché non è ancora approvabile (i motivi li calcola il server con la stessa porta dei gate)
// e si approva in blocco.
//
// Il browser non decide chi è approvabile: mostra `approvabile` e `motivi` come arrivano, e se
// prova comunque a forzare, il backend rifiuta per singolo id. La selezione è solo comodità.
import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  approvaMassivaKycApi,
  fetchCodaKycApi,
  fetchModuliTenant,
  type CodaKyc,
  type RigaCodaKyc,
} from '../api/kyc';
import { useToast } from '../components/ui/ToastProvider';
import { confirm } from '../components/ui/ConfirmProvider';

const ETICHETTA_STATO: Record<string, string> = {
  bozza: 'Bozza',
  in_raccolta: 'In raccolta',
  in_verifica: 'In verifica',
  in_attesa_approvazione: 'In attesa di approvazione',
  in_attesa_revisione: 'In attesa di approvazione',
  approvato: 'Approvato',
  respinto: 'Respinto',
  sospeso: 'Sospeso',
  scaduto: 'Sospeso (scaduto)',
  in_revisione: 'In revisione periodica',
  chiuso: 'Chiuso',
};

const ETICHETTA_LIVELLO: Record<string, string> = {
  semplificata: 'Semplificata',
  ordinaria: 'Ordinaria',
  rafforzata: 'Rafforzata',
};

function badgeRischio(rischio: string): { bg: string; color: string } {
  if (rischio === 'alto') return { bg: 'var(--pill-red-bg)', color: 'var(--pill-red-fg)' };
  if (rischio === 'medio') return { bg: 'var(--pill-amber-bg)', color: 'var(--pill-amber-fg)' };
  return { bg: 'var(--pill-green-bg)', color: 'var(--pill-green-fg)' };
}

function formattaData(valore: string | null): string {
  if (!valore) return '—';
  const d = new Date(valore);
  return Number.isNaN(d.getTime()) ? '—' : d.toLocaleDateString('it-IT');
}

function scaduta(riga: RigaCodaKyc): boolean {
  if (!riga.dataScadenza) return false;
  const d = new Date(riga.dataScadenza);
  return !Number.isNaN(d.getTime()) && d.getTime() < Date.now();
}

export function CompliancePage() {
  const toast = useToast();
  const [coda, setCoda] = useState<CodaKyc | null>(null);
  const [moduloAttivo, setModuloAttivo] = useState<boolean | null>(null);
  const [loading, setLoading] = useState(true);
  const [errore, setErrore] = useState('');
  const [selezionati, setSelezionati] = useState<Set<string>>(new Set());
  const [motivazione, setMotivazione] = useState('');
  const [inCorso, setInCorso] = useState(false);
  const [ultimiRifiutati, setUltimiRifiutati] = useState<Array<{ id: string; motivo: string }>>([]);

  const carica = useCallback(async () => {
    setLoading(true);
    setErrore('');
    try {
      const [moduli, datiCoda] = await Promise.all([fetchModuliTenant(), fetchCodaKycApi()]);
      setModuloAttivo(moduli.attivi.includes('kyc'));
      setCoda(datiCoda);
      // Dopo un caricamento la selezione può riferirsi a righe approvate: si tiene solo ciò che
      // è ancora approvabile, invece di svuotare sempre (l'operatore ricarica e ritrova la scelta).
      setSelezionati((prev) => {
        const approvabili = new Set(datiCoda.fascicoli.filter((f) => f.approvabile).map((f) => f.id));
        return new Set([...prev].filter((id) => approvabili.has(id)));
      });
    } catch (err) {
      setErrore(err instanceof Error ? err.message : 'Errore caricamento coda KYC');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void carica();
  }, [carica]);

  const approvabili = useMemo(() => (coda?.fascicoli ?? []).filter((f) => f.approvabile), [coda]);
  const tutteSelezionate = approvabili.length > 0 && approvabili.every((f) => selezionati.has(f.id));

  const toggle = (id: string) => {
    setSelezionati((prev) => {
      const nuovo = new Set(prev);
      if (nuovo.has(id)) nuovo.delete(id);
      else nuovo.add(id);
      return nuovo;
    });
  };

  const toggleTutte = () => {
    setSelezionati(tutteSelezionate ? new Set() : new Set(approvabili.map((f) => f.id)));
  };

  const approvaSelezionate = async () => {
    const ids = [...selezionati];
    if (ids.length === 0 || inCorso) return;
    const procedi = await confirm({
      titolo: `Approvare ${ids.length} ${ids.length === 1 ? 'pratica' : 'pratiche'}?`,
      messaggio:
        'L’approvazione chiude la verifica e abilita l’operatività a valle; resta scritta nello storico del fascicolo e nel registro di compliance. Le pratiche che non superano i controlli non verranno approvate e il motivo sarà mostrato.',
      confermaLabel: 'Approva',
    });
    if (!procedi) return;

    setInCorso(true);
    setUltimiRifiutati([]);
    try {
      const esito = await approvaMassivaKycApi(ids, motivazione.trim() || undefined);
      if (esito.approvati > 0) {
        toast.successo(`${esito.approvati} ${esito.approvati === 1 ? 'pratica approvata' : 'pratiche approvate'}.`);
      }
      if (esito.rifiutati.length > 0) {
        setUltimiRifiutati(esito.rifiutati);
        toast.errore(`${esito.rifiutati.length} ${esito.rifiutati.length === 1 ? 'pratica non approvata' : 'pratiche non approvate'}: vedi il motivo nella coda.`);
      }
      setMotivazione('');
      await carica();
    } catch (err) {
      toast.errore(err instanceof Error ? err.message : 'Approvazione non riuscita.');
    } finally {
      setInCorso(false);
    }
  };

  if (loading && !coda) {
    return (
      <div style={{ background: 'var(--card)', border: '1px solid var(--border)', borderRadius: 16, padding: 32, textAlign: 'center', color: 'var(--muted)' }}>
        Caricamento coda KYC…
      </div>
    );
  }

  if (moduloAttivo === false) {
    return (
      <div style={{ background: 'var(--card)', border: '1px solid var(--border)', borderRadius: 16, padding: 32 }}>
        <div style={{ fontSize: 16, fontWeight: 800, color: 'var(--text)', marginBottom: 8 }}>🛡️ Coda KYC</div>
        <p style={{ color: 'var(--muted)', fontSize: 13, margin: 0 }}>
          Il modulo Compliance/KYC non è attivo per questo studio. Si attiva da Impostazioni → Moduli.
        </p>
      </div>
    );
  }

  const rifiutatoPerId = new Map(ultimiRifiutati.map((r) => [r.id, r.motivo]));

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
      <div style={{ background: 'var(--card)', border: '1px solid var(--border)', borderRadius: 16, padding: 20, display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 14 }}>
        <div>
          <div style={{ fontSize: 18, fontWeight: 800, color: 'var(--text)', display: 'flex', alignItems: 'center', gap: 10 }}>
            <span>🛡️ Coda KYC / AML</span>
          </div>
          <div style={{ fontSize: 11, color: 'var(--muted)', marginTop: 3 }}>
            Le pratiche aperte dello studio, con il motivo per cui non sono ancora approvabili.
          </div>
        </div>
        <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
          <span style={{ fontSize: 11, background: 'var(--pill-indigo-bg)', color: 'var(--pill-indigo-fg)', padding: '6px 14px', borderRadius: 20, fontWeight: 600 }}>
            {coda?.totale ?? 0} in coda
          </span>
          <span style={{ fontSize: 11, background: 'var(--pill-green-bg)', color: 'var(--pill-green-fg)', padding: '6px 14px', borderRadius: 20, fontWeight: 600 }}>
            {approvabili.length} approvabili ora
          </span>
        </div>
      </div>

      {errore && (
        <div style={{ padding: 12, borderRadius: 8, background: 'var(--pill-red-bg)', color: 'var(--pill-red-fg)' }}>{errore}</div>
      )}

      {coda && !coda.profiloConfigurato && (
        <div style={{ padding: 14, borderRadius: 10, background: 'var(--pill-amber-bg)', color: 'var(--pill-amber-fg)', fontSize: 12 }}>
          ⚠ Il profilo regolatorio non è configurato: nessuna pratica può essere approvata finché non lo
          imposti in <strong>Impostazioni → Compliance &amp; AML</strong>. Le pratiche restano qui, in attesa.
        </div>
      )}

      {ultimiRifiutati.length > 0 && (
        <div style={{ padding: 14, borderRadius: 10, background: 'var(--pill-red-bg)', color: 'var(--pill-red-fg)', fontSize: 12 }}>
          <div style={{ fontWeight: 700, marginBottom: 6 }}>L’ultima approvazione ha lasciato fuori {ultimiRifiutati.length} {ultimiRifiutati.length === 1 ? 'pratica' : 'pratiche'}:</div>
          <ul style={{ margin: 0, paddingLeft: 18 }}>
            {ultimiRifiutati.map((r) => {
              const riga = coda?.fascicoli.find((f) => f.id === r.id);
              return <li key={r.id}>{riga?.cliente.nome ?? r.id}: {r.motivo}</li>;
            })}
          </ul>
        </div>
      )}

      <div style={{ background: 'var(--card)', border: '1px solid var(--border)', borderRadius: 14, padding: 16, display: 'flex', justifyContent: 'space-between', alignItems: 'flex-end', flexWrap: 'wrap', gap: 14 }}>
        <label style={{ display: 'flex', flexDirection: 'column', gap: 4, fontSize: 11, color: 'var(--muted)', fontWeight: 600 }}>
          Motivazione (facoltativa, finisce nello storico delle pratiche)
          <input
            type="text"
            value={motivazione}
            maxLength={500}
            onChange={(e) => setMotivazione(e.target.value)}
            placeholder="Es. verifica settimanale delle pratiche in attesa"
            style={{ width: 340, maxWidth: '70vw', fontSize: 12 }}
          />
        </label>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, color: 'var(--text)' }}>
            <input
              type="checkbox"
              checked={tutteSelezionate}
              onChange={toggleTutte}
              disabled={approvabili.length === 0}
              aria-label="Seleziona tutte le pratiche approvabili"
            />
            Tutte le approvabili
          </label>
          <button
            type="button"
            onClick={() => void approvaSelezionate()}
            disabled={selezionati.size === 0 || inCorso}
            style={{
              background: selezionati.size === 0 ? 'var(--card2)' : 'var(--green)',
              color: selezionati.size === 0 ? 'var(--muted)' : 'var(--on-accent, #fff)',
              border: '1px solid var(--border)',
              padding: '9px 16px',
              borderRadius: 8,
              fontSize: 12,
              fontWeight: 700,
              cursor: selezionati.size === 0 || inCorso ? 'not-allowed' : 'pointer',
            }}
          >
            {inCorso ? 'Approvazione…' : `Approva selezionate (${selezionati.size})`}
          </button>
        </div>
      </div>

      <div style={{ background: 'var(--card2)', border: '1px solid var(--border)', borderRadius: 16, padding: 20 }}>
        {!coda || coda.fascicoli.length === 0 ? (
          <div style={{ padding: 24, textAlign: 'center', color: 'var(--muted)' }}>
            Nessuna pratica in coda: tutte quelle aperte sono già state gestite.
          </div>
        ) : (
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
              <caption style={{ captionSide: 'top', textAlign: 'left', fontSize: 11, color: 'var(--muted)', paddingBottom: 8 }}>
                Pratiche KYC aperte, le approvabili per prime. Il motivo del blocco è quello che il server applica davvero.
              </caption>
              <thead>
                <tr style={{ borderBottom: '1px solid var(--border)', color: 'var(--muted)', textAlign: 'left' }}>
                  <th style={{ padding: 10 }} scope="col">Sel.</th>
                  <th style={{ padding: 10 }} scope="col">Cliente</th>
                  <th style={{ padding: 10 }} scope="col">Stato</th>
                  <th style={{ padding: 10 }} scope="col">Verifica</th>
                  <th style={{ padding: 10 }} scope="col">Rischio</th>
                  <th style={{ padding: 10 }} scope="col">Scadenza</th>
                  <th style={{ padding: 10 }} scope="col">Segnali</th>
                  <th style={{ padding: 10 }} scope="col">Perché non si approva</th>
                </tr>
              </thead>
              <tbody>
                {coda.fascicoli.map((riga) => {
                  const b = badgeRischio(riga.rischio);
                  const motivoRifiuto = rifiutatoPerId.get(riga.id);
                  return (
                    <tr key={riga.id} style={{ borderBottom: '1px solid var(--border)', opacity: riga.approvabile ? 1 : 0.85 }}>
                      <td style={{ padding: 10 }}>
                        <input
                          type="checkbox"
                          checked={selezionati.has(riga.id)}
                          onChange={() => toggle(riga.id)}
                          disabled={!riga.approvabile}
                          aria-label={`Seleziona la pratica di ${riga.cliente.nome}`}
                        />
                      </td>
                      <td style={{ padding: 10 }}>
                        <div style={{ fontWeight: 700, color: 'var(--text)' }}>{riga.cliente.nome}</div>
                        <div style={{ fontSize: 10, color: 'var(--muted)' }}>
                          {riga.soggetto && riga.soggetto !== riga.cliente.nome ? riga.soggetto : (riga.cliente.tipo === 'company' ? 'Società' : 'Persona fisica')}
                        </div>
                      </td>
                      <td style={{ padding: 10, color: 'var(--text)' }}>{ETICHETTA_STATO[riga.stato] ?? riga.stato}</td>
                      <td style={{ padding: 10, color: 'var(--muted)' }}>{ETICHETTA_LIVELLO[riga.livelloVerifica] ?? riga.livelloVerifica}</td>
                      <td style={{ padding: 10 }}>
                        <span style={{ fontSize: 10, fontWeight: 700, padding: '2px 8px', borderRadius: 10, background: b.bg, color: b.color }}>
                          {riga.rischio} · {riga.punteggioRischio}
                        </span>
                      </td>
                      <td style={{ padding: 10, color: scaduta(riga) ? 'var(--pill-red-fg)' : 'var(--muted)', fontWeight: scaduta(riga) ? 700 : 400 }}>
                        {formattaData(riga.dataScadenza)}{scaduta(riga) ? ' (scaduta)' : ''}
                      </td>
                      <td style={{ padding: 10 }}>
                        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                          {riga.screeningBloccante && (
                            <span style={{ fontSize: 10, fontWeight: 700, padding: '2px 8px', borderRadius: 8, background: 'var(--pill-red-bg)', color: 'var(--pill-red-fg)' }}>
                              screening aperto
                            </span>
                          )}
                          {riga.anomalieAperte > 0 && (
                            <span style={{ fontSize: 10, fontWeight: 700, padding: '2px 8px', borderRadius: 8, background: 'var(--pill-amber-bg)', color: 'var(--pill-amber-fg)' }}>
                              {riga.anomalieAperte} {riga.anomalieAperte === 1 ? 'anomalia' : 'anomalie'}
                            </span>
                          )}
                          {!riga.screeningBloccante && riga.anomalieAperte === 0 && (
                            <span style={{ fontSize: 10, color: 'var(--hint)' }}>—</span>
                          )}
                        </div>
                      </td>
                      <td style={{ padding: 10, maxWidth: 380 }}>
                        {riga.approvabile ? (
                          <span style={{ fontSize: 11, fontWeight: 700, color: 'var(--green)' }}>✓ Pronta per l’approvazione</span>
                        ) : (
                          <ul style={{ margin: 0, paddingLeft: 16, color: 'var(--muted)', fontSize: 11 }}>
                            {riga.motivi.map((m) => <li key={m}>{m}</li>)}
                          </ul>
                        )}
                        {motivoRifiuto && (
                          <div style={{ marginTop: 4, fontSize: 11, fontWeight: 700, color: 'var(--pill-red-fg)' }}>
                            Rifiutata ora: {motivoRifiuto}
                          </div>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
