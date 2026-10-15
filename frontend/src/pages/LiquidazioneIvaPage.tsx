import React, { useState, useEffect } from 'react';
import type {
  LiquidazioneIvaRecord,
  CalcoloLipeResponse,
} from '../api/liquidazioneIva';
import {
  fetchLiquidazioniIvaApi,
  calcolaLipeApi,
  salvaLipeApi,
  marcaVersataLipeApi,
} from '../api/liquidazioneIva';
import { EsportaFascicoloCommercialistaModal } from '../components/contabilita/EsportaFascicoloCommercialistaModal';

export const LiquidazioneIvaPage: React.FC = () => {
  const currentYear = new Date().getFullYear();
  const currentQuarter = Math.ceil((new Date().getMonth() + 1) / 3);

  const [tipoPeriodo, setTipoPeriodo] = useState<'trimestrale' | 'mensile'>('trimestrale');
  const [anno, setAnno] = useState(currentYear);
  const [trimestre, setTrimestre] = useState(currentQuarter);
  const [mese, setMese] = useState(new Date().getMonth() + 1);
  const [creditoPrecedenteEur, setCreditoPrecedenteEur] = useState('0');

  const [calcolo, setCalcolo] = useState<CalcoloLipeResponse | null>(null);
  const [storico, setStorico] = useState<LiquidazioneIvaRecord[]>([]);
  const [loadingCalcolo, setLoadingCalcolo] = useState(false);
  const [loadingAzione, setLoadingAzione] = useState(false);
  const [errore, setErrore] = useState<string | null>(null);
  const [messaggioSuccesso, setMessaggioSuccesso] = useState<string | null>(null);
  const [showExportModal, setShowExportModal] = useState(false);

  // Modal versamento
  const [isModalVersamentoOpen, setIsModalVersamentoOpen] = useState(false);
  const [dataVersamento, setDataVersamento] = useState(new Date().toISOString().split('T')[0]);
  const [riferimentoF24, setRiferimentoF24] = useState('');

  const periodoCodice =
    tipoPeriodo === 'trimestrale' ? `${anno}-Q${trimestre}` : `${anno}-${String(mese).padStart(2, '0')}`;

  const caricaStorico = async () => {
    try {
      const res = await fetchLiquidazioniIvaApi();
      setStorico(res);
    } catch (err) {
      console.error('Errore recupero storico LIPE:', err);
    }
  };

  useEffect(() => {
    caricaStorico();
  }, []);

  const eseguiCalcolo = async () => {
    setLoadingCalcolo(true);
    setErrore(null);
    setMessaggioSuccesso(null);
    try {
      const creditoCent = Math.round((parseFloat(creditoPrecedenteEur || '0') || 0) * 100);
      const res = await calcolaLipeApi(periodoCodice, creditoCent);
      setCalcolo(res);
    } catch (err: any) {
      setErrore(err?.message || 'Errore durante il calcolo della Liquidazione IVA.');
    } finally {
      setLoadingCalcolo(false);
    }
  };

  useEffect(() => {
    eseguiCalcolo();
  }, [tipoPeriodo, anno, trimestre, mese]);

  const handleSalva = async () => {
    if (!calcolo) return;
    setLoadingAzione(true);
    setErrore(null);
    try {
      const creditoCent = Math.round((parseFloat(creditoPrecedenteEur || '0') || 0) * 100);
      const res = await salvaLipeApi(periodoCodice, creditoCent);
      setCalcolo(res.riepilogo);
      setMessaggioSuccesso(`Liquidazione IVA periodo ${periodoCodice} salvata con successo a database.`);
      await caricaStorico();
    } catch (err: any) {
      setErrore(err?.message || 'Errore salvataggio liquidazione IVA.');
    } finally {
      setLoadingAzione(false);
    }
  };

  const handleConfermaVersamento = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!calcolo) return;
    setLoadingAzione(true);
    setErrore(null);
    try {
      await marcaVersataLipeApi(periodoCodice, {
        dataVersamento,
        registraPrimaNota: true,
        riferimentoTransazione: riferimentoF24.trim() || `F24-${periodoCodice}`,
      });
      setIsModalVersamentoOpen(false);
      setMessaggioSuccesso(`Versamento F24 registrato con successo in Prima Nota per il periodo ${periodoCodice}.`);
      await eseguiCalcolo();
      await caricaStorico();
    } catch (err: any) {
      setErrore(err?.message || 'Errore registrazione versamento F24.');
    } finally {
      setLoadingAzione(false);
    }
  };

  // Assente quando risponde un backend di una versione precedente: in quel caso non si disegna
  // l'avviso, ma non si scrive nemmeno «nessuna differita» — che sarebbe un'affermazione su un
  // dato che non è arrivato.
  const differita = calcolo?.differitaTrattataComeImmediata;

  return (
    <div style={{ padding: '24px 32px', maxWidth: '1400px', margin: '0 auto' }}>
      {/* Header */}
      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          marginBottom: '24px',
          flexWrap: 'wrap',
          gap: '16px',
        }}
      >
        <div>
          <h1 style={{ fontSize: '1.8rem', fontWeight: 800, margin: 0, display: 'flex', alignItems: 'center', gap: '10px' }}>
            <span>📑</span> Liquidazione IVA Periodica (LIPE) & F24
          </h1>
          <p style={{ margin: '4px 0 0 0', color: 'var(--text-muted)', fontSize: '0.95rem' }}>
            Calcolo automatico IVA a Debito (Vendite) vs IVA a Credito (Acquisti), compensazioni e prospetto F24.
          </p>
        </div>

        {/* Selettore Periodo */}
        <div
          className="card"
          style={{
            padding: '10px 16px',
            display: 'flex',
            alignItems: 'center',
            gap: '12px',
            flexWrap: 'wrap',
          }}
        >
          <div style={{ display: 'flex', gap: '4px', background: 'var(--bg-secondary)', padding: '3px', borderRadius: '8px' }}>
            <button
              type="button"
              className={`btn btn-sm ${tipoPeriodo === 'trimestrale' ? 'btn-primary' : 'btn-secondary'}`}
              onClick={() => setTipoPeriodo('trimestrale')}
              style={{ padding: '4px 10px', fontSize: '0.8rem' }}
            >
              Trimestrale
            </button>
            <button
              type="button"
              className={`btn btn-sm ${tipoPeriodo === 'mensile' ? 'btn-primary' : 'btn-secondary'}`}
              onClick={() => setTipoPeriodo('mensile')}
              style={{ padding: '4px 10px', fontSize: '0.8rem' }}
            >
              Mensile
            </button>
          </div>

          <select
            className="input-field"
            value={anno}
            onChange={(e) => setAnno(parseInt(e.target.value, 10))}
            style={{ width: '90px' }}
          >
            {[currentYear - 2, currentYear - 1, currentYear, currentYear + 1].map((y) => (
              <option key={y} value={y}>
                {y}
              </option>
            ))}
          </select>

          {tipoPeriodo === 'trimestrale' ? (
            <select
              className="input-field"
              value={trimestre}
              onChange={(e) => setTrimestre(parseInt(e.target.value, 10))}
              style={{ width: '130px' }}
            >
              <option value={1}>1° Trimestre (Q1)</option>
              <option value={2}>2° Trimestre (Q2)</option>
              <option value={3}>3° Trimestre (Q3)</option>
              <option value={4}>4° Trimestre (Q4)</option>
            </select>
          ) : (
            <select
              className="input-field"
              value={mese}
              onChange={(e) => setMese(parseInt(e.target.value, 10))}
              style={{ width: '130px' }}
            >
              {[
                { v: 1, l: 'Gennaio' },
                { v: 2, l: 'Febbraio' },
                { v: 3, l: 'Marzo' },
                { v: 4, l: 'Aprile' },
                { v: 5, l: 'Maggio' },
                { v: 6, l: 'Giugno' },
                { v: 7, l: 'Luglio' },
                { v: 8, l: 'Agosto' },
                { v: 9, l: 'Settembre' },
                { v: 10, l: 'Ottobre' },
                { v: 11, l: 'Novembre' },
                { v: 12, l: 'Dicembre' },
              ].map((m) => (
                <option key={m.v} value={m.v}>
                  {m.l}
                </option>
              ))}
            </select>
          )}

          <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
            <span style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>Cred. Prec. (€):</span>
            <input
              type="number"
              className="input-field"
              value={creditoPrecedenteEur}
              onChange={(e) => setCreditoPrecedenteEur(e.target.value)}
              placeholder="0"
              style={{ width: '80px', padding: '4px 8px', fontSize: '0.85rem' }}
            />
          </div>

          <button
            type="button"
            className="btn btn-secondary btn-sm"
            onClick={eseguiCalcolo}
            disabled={loadingCalcolo}
          >
            {loadingCalcolo ? '🔄...' : '🔄 Ricalcola'}
          </button>

          <button
            type="button"
            className="btn btn-primary btn-sm"
            onClick={() => setShowExportModal(true)}
            style={{ fontWeight: 600 }}
          >
            📦 Esporta Fascicolo Commercialista (ZIP)
          </button>
        </div>
      </div>

      {errore && (
        <div
          style={{
            padding: '12px 16px',
            background: 'rgba(239, 68, 68, 0.1)',
            border: '1px solid var(--red)',
            color: 'var(--red)',
            borderRadius: '8px',
            marginBottom: '16px',
            fontSize: '0.9rem',
          }}
        >
          ⚠️ {errore}
        </div>
      )}

      {messaggioSuccesso && (
        <div
          style={{
            padding: '12px 16px',
            background: 'rgba(16, 185, 129, 0.1)',
            border: '1px solid var(--green)',
            color: 'var(--green)',
            borderRadius: '8px',
            marginBottom: '16px',
            fontSize: '0.9rem',
            fontWeight: 600,
          }}
        >
          ✓ {messaggioSuccesso}
        </div>
      )}

      {/* KPI & Summary Grid */}
      {calcolo && (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(300px, 1fr))', gap: '20px', marginBottom: '28px' }}>
          {/* Vendite / Debito */}
          <div className="card" style={{ padding: '20px 24px', borderLeft: '4px solid var(--cat-societario)' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '8px' }}>
              <span style={{ fontSize: '0.85rem', fontWeight: 700, color: 'var(--text-muted)', textTransform: 'uppercase' }}>
                Fatture Attive (Vendite)
              </span>
              <span style={{ fontSize: '1.2rem' }}>📈</span>
            </div>
            <div style={{ fontSize: '1.1rem', color: 'var(--text-muted)' }}>
              Imponibile: €{(calcolo.totaleImponibileVenditeCent / 100).toLocaleString('it-IT', { minimumFractionDigits: 2 })}
            </div>
            <div style={{ fontSize: '1.8rem', fontWeight: 800, color: 'var(--cat-societario)', marginTop: '6px' }}>
              €{(calcolo.ivaDebitoCent / 100).toLocaleString('it-IT', { minimumFractionDigits: 2 })}
            </div>
            <div style={{ fontSize: '0.8rem', color: 'var(--text-muted)', marginTop: '4px' }}>
              IVA a Debito verso Erario
            </div>
          </div>

          {/* Acquisti / Credito */}
          <div className="card" style={{ padding: '20px 24px', borderLeft: '4px solid var(--green)' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '8px' }}>
              <span style={{ fontSize: '0.85rem', fontWeight: 700, color: 'var(--text-muted)', textTransform: 'uppercase' }}>
                Fatture Passive (Acquisti)
              </span>
              <span style={{ fontSize: '1.2rem' }}>🛒</span>
            </div>
            <div style={{ fontSize: '1.1rem', color: 'var(--text-muted)' }}>
              Imponibile: €{(calcolo.totaleImponibileAcquistiCent / 100).toLocaleString('it-IT', { minimumFractionDigits: 2 })}
            </div>
            <div style={{ fontSize: '1.8rem', fontWeight: 800, color: 'var(--green)', marginTop: '6px' }}>
              €{(calcolo.ivaCreditoCent / 100).toLocaleString('it-IT', { minimumFractionDigits: 2 })}
            </div>
            <div style={{ fontSize: '0.8rem', color: 'var(--text-muted)', marginTop: '4px' }}>
              IVA a Credito Detraibile
            </div>
          </div>

          {/* Saldo Periodo */}
          <div
            className="card"
            style={{
              padding: '20px 24px',
              borderLeft: `4px solid ${calcolo.stato === 'debito' ? 'var(--red)' : calcolo.stato === 'credito' ? 'var(--green)' : 'var(--muted)'}`,
              background: calcolo.stato === 'debito' ? 'rgba(239, 68, 68, 0.03)' : 'var(--card)',
            }}
          >
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '8px' }}>
              <span style={{ fontSize: '0.85rem', fontWeight: 700, color: 'var(--text-muted)', textTransform: 'uppercase' }}>
                Posizione Fiscale {periodoCodice}
              </span>
              <span style={{ fontSize: '1.2rem' }}>
                {calcolo.stato === 'debito' ? '🔴' : calcolo.stato === 'credito' ? '🟢' : '⚪'}
              </span>
            </div>

            <div
              style={{
                fontSize: '1.8rem',
                fontWeight: 800,
                color: calcolo.stato === 'debito' ? 'var(--red)' : calcolo.stato === 'credito' ? 'var(--green)' : 'var(--text)',
                marginTop: '6px',
              }}
            >
              {calcolo.stato === 'debito' && `€${(calcolo.importoDaVersareCent / 100).toLocaleString('it-IT', { minimumFractionDigits: 2 })}`}
              {calcolo.stato === 'credito' && `+€${(calcolo.creditoRiportabileCent / 100).toLocaleString('it-IT', { minimumFractionDigits: 2 })}`}
              {calcolo.stato === 'a_pareggio' && '€0,00'}
            </div>

            <div style={{ fontSize: '0.85rem', fontWeight: 600, marginTop: '4px' }}>
              {calcolo.stato === 'debito' && '⚠️ IVA da Versare all’Erario con Modello F24'}
              {calcolo.stato === 'credito' && '✓ Credito IVA riportabile al periodo successivo'}
              {calcolo.stato === 'a_pareggio' && 'Posizione IVA a pareggio'}
            </div>

            {/* Stato Versamento */}
            <div style={{ marginTop: '12px' }}>
              {calcolo.registrazioneEsistente?.versata ? (
                <span
                  style={{
                    display: 'inline-block',
                    padding: '4px 10px',
                    borderRadius: '6px',
                    background: 'rgba(16, 185, 129, 0.15)',
                    color: 'var(--green)',
                    fontSize: '0.85rem',
                    fontWeight: 700,
                  }}
                >
                  ✓ F24 Versato il {calcolo.registrazioneEsistente.dataVersamento ? new Date(calcolo.registrazioneEsistente.dataVersamento).toLocaleDateString('it-IT') : ''}
                </span>
              ) : (
                <div style={{ display: 'flex', gap: '8px' }}>
                  <button
                    type="button"
                    className="btn btn-sm btn-secondary"
                    onClick={handleSalva}
                    disabled={loadingAzione}
                  >
                    💾 Salva LIPE
                  </button>
                  {calcolo.stato === 'debito' && (
                    <button
                      type="button"
                      className="btn btn-sm btn-primary"
                      onClick={() => setIsModalVersamentoOpen(true)}
                      disabled={loadingAzione}
                    >
                      💳 Salda con F24
                    </button>
                  )}
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* La parte di debito IVA che ha una data di esigibilità **diversa** da quella che il
          prospetto le attribuisce. Non è un errore di calcolo da correggere qui: è una regola
          fiscale che l'app non applica, e che non ha il diritto di applicare in silenzio. Il
          perché per esteso è in `src/services/lipeEngine.ts`: il totale non cambia — cambia che
          adesso si sa. */}
      {calcolo && differita && differita.count > 0 && (
        <div
          className="card"
          style={{
            marginBottom: '28px',
            padding: '16px 20px',
            borderLeft: '4px solid var(--amber)',
            background: 'rgba(245, 158, 11, 0.08)',
          }}
        >
          <div style={{ fontWeight: 700, marginBottom: '6px', color: 'var(--amber)' }}>
            ⚠️{' '}
            {differita.count === 1
              ? '1 documento a esigibilità differita è contato in questo periodo'
              : `${differita.count} documenti a esigibilità differita sono contati in questo periodo`}
          </div>
          <div style={{ fontSize: '0.9rem', lineHeight: 1.5 }}>
            IVA{' '}
            <strong>
              €{(differita.ivaDebitoCent / 100).toLocaleString('it-IT', { minimumFractionDigits: 2 })}
            </strong>{' '}
            su €{(differita.imponibileCent / 100).toLocaleString('it-IT', { minimumFractionDigits: 2 })} di
            imponibile. Per l'<strong>art. 6, comma 4, del DPR 633/72</strong> l'IVA di queste operazioni
            diventa esigibile <strong>al pagamento</strong>, quindi il periodo giusto può essere un altro —
            e sono fatture già trasmesse allo SdI con <code>EsigibilitaIVA = D</code>, cioè dichiarando
            esattamente questo.
          </div>
          <div style={{ fontSize: '0.9rem', lineHeight: 1.5, marginTop: '8px', color: 'var(--text-muted)' }}>
            Il totale qui sopra <strong>non cambia</strong>: l'anno chiude in pari, perché è la stessa IVA
            che entrerà più avanti. Cambia il periodo, e cambia che adesso lo si sa. L'app non sposta da
            sola l'IVA al momento dell'incasso perché dovrebbe fidarsi che <em>ogni</em> incasso sia
            registrato qui dentro: una differita mai incassata a sistema uscirebbe da <em>tutte</em> le
            liquidazioni, in silenzio. Come trattarle è una decisione fiscale ancora aperta.
          </div>
          <div style={{ fontSize: '0.85rem', marginTop: '10px', color: 'var(--text-muted)' }}>
            Documenti: {differita.documenti.join(' · ')}
          </div>
        </div>
      )}

      {/* Prospetto F24 Dettagliato */}
      {calcolo && calcolo.prospettoF24.righe.length > 0 && (
        <div className="card" style={{ marginBottom: '28px', padding: '20px 24px' }}>
          <h3 style={{ margin: '0 0 16px 0', fontSize: '1.2rem', fontWeight: 700, display: 'flex', alignItems: 'center', gap: '8px' }}>
            <span>🏛️</span> Prospetto Compilazione Modello F24 — Sezione Erario
          </h3>

          <div style={{ overflowX: 'auto' }}>
            <table className="table" style={{ width: '100%', borderCollapse: 'collapse' }}>
              <thead>
                <tr style={{ background: 'var(--bg-secondary)', textAlign: 'left', fontSize: '0.85rem' }}>
                  <th style={{ padding: '10px 14px' }}>Sezione</th>
                  <th style={{ padding: '10px 14px' }}>Codice Tributo</th>
                  <th style={{ padding: '10px 14px' }}>Anno Riferimento</th>
                  <th style={{ padding: '10px 14px' }}>Descrizione Tributo</th>
                  <th style={{ padding: '10px 14px', textAlign: 'right' }}>Importo a Debito Versato</th>
                </tr>
              </thead>
              <tbody>
                {calcolo.prospettoF24.righe.map((r, i) => (
                  <tr key={i} style={{ borderBottom: '1px solid var(--border)' }}>
                    <td style={{ padding: '12px 14px', fontWeight: 600 }}>{r.sezione}</td>
                    <td style={{ padding: '12px 14px', fontFamily: 'monospace', fontWeight: 700, color: 'var(--primary)', fontSize: '1rem' }}>
                      {r.codiceTributo}
                    </td>
                    <td style={{ padding: '12px 14px' }}>{r.annoRiferimento}</td>
                    <td style={{ padding: '12px 14px' }}>{r.descrizione}</td>
                    <td style={{ padding: '12px 14px', textAlign: 'right', fontWeight: 800, color: 'var(--red)', fontSize: '1.05rem' }}>
                      €{(r.importoDebitoCent / 100).toLocaleString('it-IT', { minimumFractionDigits: 2 })}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Storico Liquidazioni */}
      <div className="card" style={{ padding: '20px 24px' }}>
        <h3 style={{ margin: '0 0 16px 0', fontSize: '1.2rem', fontWeight: 700, display: 'flex', alignItems: 'center', gap: '8px' }}>
          <span>📚</span> Storico Liquidazioni IVA Salvate
        </h3>

        {storico.length === 0 ? (
          <div style={{ textAlign: 'center', padding: '30px 20px', color: 'var(--text-muted)' }}>
            Nessuna liquidazione IVA ancora consolidata per questo tenant. Seleziona un periodo sopra e premi "Salva LIPE".
          </div>
        ) : (
          <div style={{ overflowX: 'auto' }}>
            <table className="table" style={{ width: '100%', borderCollapse: 'collapse' }}>
              <thead>
                <tr style={{ background: 'var(--bg-secondary)', textAlign: 'left', fontSize: '0.85rem' }}>
                  <th style={{ padding: '10px 14px' }}>Periodo</th>
                  <th style={{ padding: '10px 14px', textAlign: 'right' }}>IVA a Debito</th>
                  <th style={{ padding: '10px 14px', textAlign: 'right' }}>IVA a Credito</th>
                  <th style={{ padding: '10px 14px', textAlign: 'right' }}>Saldo Fiscale</th>
                  <th style={{ padding: '10px 14px', textAlign: 'center' }}>Stato Versamento</th>
                </tr>
              </thead>
              <tbody>
                {storico.map((s) => (
                  <tr key={s.id} style={{ borderBottom: '1px solid var(--border)' }}>
                    <td style={{ padding: '12px 14px', fontWeight: 700, color: 'var(--primary)' }}>{s.periodo}</td>
                    <td style={{ padding: '12px 14px', textAlign: 'right' }}>€{(s.ivaDebitoCentesimi / 100).toFixed(2)}</td>
                    <td style={{ padding: '12px 14px', textAlign: 'right', color: 'var(--text-muted)' }}>
                      €{(s.ivaCreditoCentesimi / 100).toFixed(2)}
                    </td>
                    <td
                      style={{
                        padding: '12px 14px',
                        textAlign: 'right',
                        fontWeight: 800,
                        color: s.saldoCentesimi > 0 ? 'var(--red)' : 'var(--green)',
                      }}
                    >
                      €{(s.saldoCentesimi / 100).toFixed(2)}
                    </td>
                    <td style={{ padding: '12px 14px', textAlign: 'center' }}>
                      {s.versata ? (
                        <span style={{ padding: '3px 8px', borderRadius: '6px', background: 'rgba(16, 185, 129, 0.15)', color: 'var(--green)', fontWeight: 600, fontSize: '0.8rem' }}>
                          ✓ Versata ({s.dataVersamento ? new Date(s.dataVersamento).toLocaleDateString('it-IT') : ''})
                        </span>
                      ) : (
                        <span style={{ padding: '3px 8px', borderRadius: '6px', background: 'rgba(245, 158, 11, 0.15)', color: 'var(--amber)', fontWeight: 600, fontSize: '0.8rem' }}>
                          ⏳ Da Versare
                        </span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Modale Versamento F24 */}
      {isModalVersamentoOpen && (
        <div className="modal-overlay" style={{ zIndex: 1100 }}>
          <div className="modal-container" style={{ maxWidth: '500px', width: '90%' }}>
            <div className="modal-header">
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                <span style={{ fontSize: '1.4rem' }}>🏛️</span>
                <h3 style={{ margin: 0, fontWeight: 700 }}>Registra Versamento F24</h3>
              </div>
              <button className="btn-close" onClick={() => setIsModalVersamentoOpen(false)}>
                ✕
              </button>
            </div>

            <form onSubmit={handleConfermaVersamento} style={{ padding: '20px 24px' }}>
              <div
                style={{
                  background: 'var(--bg-secondary)',
                  padding: '12px 16px',
                  borderRadius: '8px',
                  marginBottom: '16px',
                  border: '1px solid var(--border)',
                }}
              >
                <div style={{ fontSize: '0.85rem', color: 'var(--text-muted)' }}>Periodo di Riferimento: {periodoCodice}</div>
                <div style={{ fontSize: '1.2rem', fontWeight: 800, color: 'var(--red)', marginTop: '4px' }}>
                  Importo da Versare: €{((calcolo?.importoDaVersareCent || 0) / 100).toFixed(2)}
                </div>
              </div>

              <div style={{ display: 'grid', gridTemplateColumns: '1fr', gap: '14px' }}>
                <div>
                  <label style={{ display: 'block', fontSize: '0.85rem', fontWeight: 600, marginBottom: '4px' }}>
                    Data Effettiva di Versamento F24 *
                  </label>
                  <input
                    type="date"
                    className="input-field"
                    required
                    value={dataVersamento}
                    onChange={(e) => setDataVersamento(e.target.value)}
                    style={{ width: '100%' }}
                  />
                </div>

                <div>
                  <label style={{ display: 'block', fontSize: '0.85rem', fontWeight: 600, marginBottom: '4px' }}>
                    Riferimento Transazione Bancaria / Quietanza F24
                  </label>
                  <input
                    type="text"
                    className="input-field"
                    value={riferimentoF24}
                    onChange={(e) => setRiferimentoF24(e.target.value)}
                    placeholder={`es. F24-${periodoCodice}-QUIETANZA-001`}
                    style={{ width: '100%' }}
                  />
                </div>
              </div>

              <div
                style={{
                  display: 'flex',
                  justifyContent: 'flex-end',
                  gap: '10px',
                  marginTop: '20px',
                  borderTop: '1px solid var(--border)',
                  paddingTop: '16px',
                }}
              >
                <button type="button" className="btn btn-secondary" onClick={() => setIsModalVersamentoOpen(false)}>
                  Annulla
                </button>
                <button type="submit" className="btn btn-primary" disabled={loadingAzione}>
                  {loadingAzione ? 'Registrazione...' : 'Conferma Saldo F24 & Scrivi Prima Nota'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* MODAL EXPORT FASCICOLO COMMERICALISTA ZIP */}
      <EsportaFascicoloCommercialistaModal
        isOpen={showExportModal}
        onClose={() => setShowExportModal(false)}
      />
    </div>
  );
};
export default LiquidazioneIvaPage;
