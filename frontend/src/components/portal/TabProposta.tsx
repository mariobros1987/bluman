import { CatBadge } from '../ui/CatBadge';
import { fmt } from '../../utils';
import { downloadRealPdf } from '../../utils/pdfGenerator';
import { FoglioA4 } from '../documenti/FoglioA4';
import { scomponiDocumento } from '../../../../src/util/intestazionePiede';
import { getStudioInfoForTenant, getCurrentTenantId, getTenantStorageKey, BLUECODE_TENANT_ID } from '../../utils/tenant';
import type { CanaleOtp, CanaleFirma, RichiestaAddendum } from '../../api/client';
import type { ModuloProposta, BersaglioFirma } from './types';
import { dataOraLeggibile } from './format';
import { docBoxStyle } from './styles';

export interface TabPropostaProps {
  signed: boolean;
  eidasSeal: any;
  clientName: string;
  moduliProposti: ModuloProposta[];
  totalValue: number;
  addendumErrore: string | null;
  nuovaRichiestaAddendum: string;
  setNuovaRichiestaAddendum: (testo: string) => void;
  progettoAttivo: any;
  inviaNuovaRichiestaAddendum: () => Promise<void>;
  invioAddendum: boolean;
  addendumMsg: { text: string; type: 'success' | 'error' } | null;
  addendums: RichiestaAddendum[];
  moduleSignatures: Record<string, { firmato: boolean; dataFirma: string; signerName: string }>;
  setSelectedModule: (modulo: ModuloProposta | null) => void;
  getResolvedEngagementHtml: () => string;
  modalitaFirma: 'otp' | 'manuale_scansionata' | 'qualificata_esterna';
  setModalitaFirma: (modalita: 'otp' | 'manuale_scansionata' | 'qualificata_esterna') => void;
  otpError: string | null;
  setOtpError: (errore: string | null) => void;
  canaliFirma: CanaleFirma[];
  otpCanale: CanaleOtp;
  setOtpCanale: (canale: CanaleOtp) => void;
  nomeCanale: Record<CanaleOtp, string>;
  usaRecapitoDiverso: boolean;
  setUsaRecapitoDiverso: (valore: boolean) => void;
  recapitoDichiarato: string;
  setRecapitoDichiarato: (recapito: string) => void;
  canaleCorrente: CanaleFirma | undefined;
  botTelegram: string | null;
  otpModalOpen: boolean;
  inviaCodiceFirma: (opzioni?: { reinvio?: boolean; bersaglio?: BersaglioFirma; canale?: CanaleOtp }) => Promise<boolean>;
  TITOLO_MANDATO: string;
  loading: boolean;
  otpLoading: boolean;
  fileFirmato: { nome: string; base64: string } | null;
  leggiFileFirmato: (file: File) => Promise<void>;
  confermaFirmaConFile: () => Promise<boolean>;
  caricamentoFirmato: boolean;
}

export function TabProposta({
  signed,
  eidasSeal,
  clientName,
  moduliProposti,
  totalValue,
  addendumErrore,
  nuovaRichiestaAddendum,
  setNuovaRichiestaAddendum,
  progettoAttivo,
  inviaNuovaRichiestaAddendum,
  invioAddendum,
  addendumMsg,
  addendums,
  moduleSignatures,
  setSelectedModule,
  getResolvedEngagementHtml,
  modalitaFirma,
  setModalitaFirma,
  otpError,
  setOtpError,
  canaliFirma,
  otpCanale,
  setOtpCanale,
  nomeCanale,
  usaRecapitoDiverso,
  setUsaRecapitoDiverso,
  recapitoDichiarato,
  setRecapitoDichiarato,
  canaleCorrente,
  botTelegram,
  otpModalOpen,
  inviaCodiceFirma,
  TITOLO_MANDATO,
  loading,
  otpLoading,
  fileFirmato,
  leggiFileFirmato,
  confermaFirmaConFile,
  caricamentoFirmato,
}: TabPropostaProps) {
  // §39 — l'HTML del mandato può portare l'intestazione e il piede propri dello studio, marcati
  // dentro il documento al momento del salvataggio: qui si rimettono al loro posto sul foglio.
  // Un mandato salvato prima di §39 non li ha: torna tutto come corpo, come si vedeva prima.
  const partiProposta = scomponiDocumento(getResolvedEngagementHtml());

  return (
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
                  {/* Repertorio e marca temporale vengono dal sigillo di firma emesso dal server
                      (/portal/verify-otp-and-sign). Prima erano cablati: mostravano data, ora e
                      IP di una firma che non era quella del cliente collegato. */}
                  {eidasSeal?.signatureId && (
                    <span style={{ fontSize: 11, color: '#34d399', fontFamily: 'monospace' }}>{eidasSeal.signatureId}</span>
                  )}
                </div>
                <h3 style={{ fontSize: 17, fontWeight: 700, color: '#fff', margin: 0 }}>Engagement Letter & Proposta d'Ordine Iniziale (v1.0)</h3>
                {eidasSeal?.timestampIso ? (
                  <div style={{ fontSize: 11, color: '#a7f3d0', marginTop: 4 }}>
                    Stipulato il: <strong>{new Date(eidasSeal.timestampIso).toLocaleString('it-IT')}</strong>
                    {eidasSeal.sha256Digest && <> · Impronta SHA-256: <span style={{ fontFamily: 'monospace' }}>{String(eidasSeal.sha256Digest).slice(0, 16)}…</span></>}
                  </div>
                ) : (
                  <div style={{ fontSize: 11, color: '#fbbf24', marginTop: 4 }}>
                    Firma registrata su questo dispositivo, ma il sigillo di firma non è disponibile:
                    non possiamo mostrarne marca temporale né impronta. Richiedi allo studio la copia con evidenza di firma.
                  </div>
                )}
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
                    // Le evidenze di firma vengono SOLO dal sigillo di firma emesso dal server.
                    // Prima erano due firmatari cablati con data e indirizzi IP inventati, e la
                    // controfirma dello studio non esiste in nessun registro: il PDF attestava
                    // una firma che nessuno aveva apposto. Senza sigillo il PDF esce senza
                    // pagina di evidenze, non con evidenze finte.
                    const evidenzeFirma = eidasSeal?.timestampIso
                      ? [{
                          signerName: eidasSeal.signerName || clientName,
                          signerRole: 'Cliente Incarico (Legale Rappresentante)',
                          timestamp: new Date(eidasSeal.timestampIso).toLocaleString('it-IT'),
                          ipAddress: eidasSeal.ipAddress || 'non registrato',
                        }]
                      : [];
                    await downloadRealPdf(`Engagement_Letter_v1.0_${clientName.replace(/\s+/g, '_')}`, htmlContent, evidenzeFirma);
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
              {moduliProposti.length === 0 ? (
                <div style={{ fontSize: 11.5, color: 'var(--muted)', background: 'rgba(0,0,0,0.2)', padding: '10px 12px', borderRadius: 6 }}>
                  Nessun modulo è ancora stato istanziato su questo progetto: l'elenco delle
                  prestazioni comparirà qui appena lo Studio lo predispone.
                </div>
              ) : moduliProposti.map((m, idx) => (
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

          {/* 📜 ADDENDUM D'ORDINE — richieste del cliente gestite dallo studio (§2.5) */}
          <div style={{ borderTop: '2px dashed var(--border)', paddingTop: 20, marginTop: 24 }}>
            <div style={{ marginBottom: 16 }}>
              <div style={{ fontSize: 14, fontWeight: 700 }}>📜 Richieste d'Integrazione & Addendum</div>
              <div style={{ fontSize: 11, color: 'var(--muted)', marginTop: 2 }}>
                Descrivi la modifica o il modulo aggiuntivo che ti serve: lo studio preparerà l'addendum e lo troverai qui, pronto per la firma.
              </div>
            </div>

            {addendumErrore && (
              <div style={{ background: '#2d1516', border: '1px solid #7f1d1d', color: '#fca5a5', borderRadius: 10, padding: 10, fontSize: 11, marginBottom: 14 }}>
                ⚠️ {addendumErrore}
              </div>
            )}

            <div style={{ background: 'var(--card2)', border: '1px solid var(--border)', borderRadius: 12, padding: 16, marginBottom: 14 }}>
              <textarea
                value={nuovaRichiestaAddendum}
                onChange={(e) => setNuovaRichiestaAddendum(e.target.value)}
                placeholder="Es. Vorrei aggiungere il modulo Tax Refund Malta al contratto in corso…"
                rows={3}
                style={{ width: '100%', boxSizing: 'border-box', background: 'var(--card)', border: '1px solid var(--border)', borderRadius: 8, padding: 10, fontSize: 12, color: 'var(--text)', resize: 'vertical', fontFamily: 'inherit', outline: 'none' }}
              />
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: 8, gap: 10, flexWrap: 'wrap' }}>
                <div style={{ fontSize: 10, color: 'var(--muted)' }}>
                  {progettoAttivo ? (<>Riferimento progetto: <b style={{ color: 'var(--text)' }}>{progettoAttivo.nome}</b></>) : 'La richiesta sarà agganciata al progetto attivo del portale'}
                </div>
                <button
                  onClick={() => void inviaNuovaRichiestaAddendum()}
                  disabled={invioAddendum || !nuovaRichiestaAddendum.trim()}
                  style={{ background: invioAddendum || !nuovaRichiestaAddendum.trim() ? 'var(--muted)' : 'var(--indigo)', color: '#fff', border: 'none', padding: '7px 14px', borderRadius: 8, fontSize: 11, fontWeight: 600, cursor: invioAddendum || !nuovaRichiestaAddendum.trim() ? 'default' : 'pointer', opacity: invioAddendum ? 0.6 : 1 }}
                >
                  {invioAddendum ? 'Invio in corso…' : '➕ Invia richiesta allo studio'}
                </button>
              </div>
              {addendumMsg && (
                <div style={{ fontSize: 11, marginTop: 8, fontWeight: 600, color: addendumMsg.type === 'success' ? '#34d399' : '#fca5a5' }}>
                  {addendumMsg.text}
                </div>
              )}
            </div>

            {addendums.length === 0 ? (
              <div style={{ background: 'var(--card2)', border: '1px solid var(--border)', borderRadius: 10, padding: 16, textAlign: 'center', fontSize: 11, color: 'var(--muted)' }}>
                Nessuna richiesta di addendum inviata. Il contratto base è attualmente la versione attiva.
              </div>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
                {addendums.map((add) => {
                  const badgeStato: Record<string, { testo: string; colore: string; sfondo: string }> = {
                    richiesta: { testo: '📨 INVIATA — IN ATTESA', colore: '#000', sfondo: 'var(--amber)' },
                    in_preparazione: { testo: '⚙️ IN PREPARAZIONE', colore: '#fff', sfondo: 'var(--indigo)' },
                    pronta: { testo: '✅ PRONTA', colore: '#000', sfondo: '#34d399' },
                    rifiutata: { testo: '⛔ RIFIUTATA', colore: '#fff', sfondo: '#b91c1c' },
                  };
                  const badge = badgeStato[add.stato] ?? badgeStato.richiesta;
                  return (
                    <div key={add.id} style={{ background: add.stato === 'pronta' ? '#0d2d22' : 'var(--card2)', border: `1px solid ${add.stato === 'pronta' ? '#1a5c3c' : 'var(--border)'}`, borderRadius: 12, padding: 16 }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6, flexWrap: 'wrap' }}>
                        <span style={{ background: badge.sfondo, color: badge.colore, fontSize: 9, fontWeight: 800, padding: '2px 6px', borderRadius: 10 }}>
                          {badge.testo}
                        </span>
                        {add.progetto && (
                          <span style={{ fontSize: 9, fontWeight: 700, color: 'var(--muted)', border: '1px solid var(--border)', padding: '2px 6px', borderRadius: 10 }}>
                            {add.progetto.nome}
                          </span>
                        )}
                        <span style={{ fontSize: 10, color: 'var(--muted)', marginLeft: 'auto' }}>Richiesta del {dataOraLeggibile(add.createdAt)}</span>
                      </div>

                      <div style={{ fontSize: 12, color: 'var(--text)', whiteSpace: 'pre-wrap', marginBottom: add.rispostaStudio ? 10 : 0 }}>
                        {add.testoRichiesta}
                      </div>

                      {add.rispostaStudio && (
                        <div style={{ background: 'var(--card)', border: '1px solid var(--border)', borderRadius: 8, padding: 10, fontSize: 11, color: 'var(--muted)' }}>
                          <b style={{ color: 'var(--text)' }}>Risposta dello studio:</b>{' '}
                          <span style={{ whiteSpace: 'pre-wrap' }}>{add.rispostaStudio}</span>
                        </div>
                      )}
                    </div>
                  );
                })}
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
                <div style={{ fontSize: 12, fontWeight: 700, color: '#34d399', marginBottom: 4 }}>3️⃣ Firma con OTP verificata</div>
                <div style={{ fontSize: 11, color: 'var(--muted)', lineHeight: 1.4 }}>Apponi la firma elettronica semplice (OTP verificata · art. 20 CAD) e scarica l'attestazione PDF.</div>
              </div>
            </div>
          </div>

          <div style={{ borderBottom: '1px solid var(--border)', paddingBottom: 16, marginBottom: 20, display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', flexWrap: 'wrap', gap: 12 }}>
            <div>
              <div style={{ fontSize: 10, textTransform: 'uppercase', color: 'var(--indigo-l)', fontWeight: 700, letterSpacing: '.5px', marginBottom: 4 }}>
                {/* §2.8: il numero della lettera d'incarico è del progetto, assegnato dal
                    backend alla creazione. Prima era cablato EL-2026-089 per tutti. */}
                ENGAGEMENT LETTER & PROPOSTA D'ORDINE N. {progettoAttivo?.numeroContratto || '— numero in assegnazione —'}
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
            {moduliProposti.length === 0
              ? 'Moduli di Consulenza — nessuno ancora istanziato su questo progetto'
              : `Moduli di Consulenza Incorporati (${moduliProposti.length}) — Clicca su ciascun modulo per esaminare l'attività svolta dall'operatore`}
          </div>

          {moduliProposti.length === 0 && (
            <div style={{ background: 'var(--card2)', border: '1px dashed var(--border)', borderRadius: 12, padding: 18, fontSize: 12, color: 'var(--muted)', marginBottom: 24, lineHeight: 1.6 }}>
              Questo progetto non ha ancora moduli operativi a database. Non compaiono
              prestazioni, operatori né percentuali di avanzamento perché non ce ne sono:
              appena lo Studio istanzia i moduli dell'incarico li trovi qui, ciascuno con
              il proprio stato reale.
            </div>
          )}

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
                          ⏱ IN LAVORAZIONE ({m.percentuale ?? 0}%)
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
                  Leggi attentamente le clausole, i moduli incorporati, i corrispettivi e le condizioni legali prima di apporre la firma.
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

            {/*
              §39 — Il foglio A4 vero, non un riquadro bianco qualunque.
              Prima era un `div` con `padding: 36px 32px` e larghezza a fisarmonica: il cliente
              leggeva un testo che andava a capo in punti diversi da quelli del PDF che poi firmava.
              Ora la larghezza e i margini sono quelli della stampa (`src/util/paginaA4.ts`), e
              l'intestazione e il piede che il documento porta con sé finiscono al loro posto —
              qui non si sbloccano, perché nel portale non c'è nessun posto in cui salvarli.
            */}
            <div style={{ maxHeight: 640, overflowY: 'auto', borderRadius: 14 }}>
              <FoglioA4
                intestazione={partiProposta.intestazione ? { html: partiProposta.intestazione, etichetta: 'Intestazione' } : undefined}
                piede={partiProposta.piede ? { html: partiProposta.piede, etichetta: 'Piè di pagina' } : undefined}
              >
                <div
                  style={{ fontFamily: "'Segoe UI', Roboto, Helvetica, Arial, sans-serif" }}
                  dangerouslySetInnerHTML={{ __html: partiProposta.corpo }}
                />
              </FoglioA4>
            </div>
          </div>

          <div style={{ borderTop: '1px solid var(--border)', paddingTop: 20 }}>
            <div style={{ fontSize: 13, fontWeight: 700, marginBottom: 6 }}>Accettazione & Apposizione Firma Elettronica Semplice</div>
            <p style={{ fontSize: 11.5, color: 'var(--muted)', lineHeight: 1.5, marginBottom: 14 }}>
              Conferma la proposta contrattuale mediante <strong>Firma Elettronica Semplice (OTP verificata)</strong> ai sensi dell'art. 20 del CAD.
            </p>

            {/* ── COME VUOI FIRMARE (§1.3) ─────────────────────────────────── */}
            <div style={{ background: 'var(--card2)', border: '1px solid var(--border)', borderRadius: 12, padding: 16, marginBottom: 14 }}>
              <div style={{ fontSize: 11.5, fontWeight: 800, color: 'var(--text)', marginBottom: 10 }}>
                ✍️ Scegli come firmare il mandato:
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: 10 }}>
                {([
                  { id: 'otp' as const, icona: '📲', titolo: 'Firma online con codice OTP', nota: 'Ricevi un codice e firmi qui, in un minuto' },
                  { id: 'manuale_scansionata' as const, icona: '🖊', titolo: 'Scarica, firma a penna e ricarica', nota: 'Stampi il PDF, lo firmi e lo ricarichi' },
                  { id: 'qualificata_esterna' as const, icona: '🪪', titolo: 'Firma digitale del mio provider', nota: 'Aruba, InfoCert, Namirial, CNS…' },
                ]).map((m) => (
                  <button
                    key={m.id}
                    type="button"
                    onClick={() => { setModalitaFirma(m.id); setOtpError(null); }}
                    style={{
                      background: modalitaFirma === m.id ? '#1e1b4b' : 'var(--card)',
                      border: `1.5px solid ${modalitaFirma === m.id ? '#6366f1' : 'var(--border)'}`,
                      borderRadius: 10,
                      padding: '10px 14px',
                      textAlign: 'left',
                      cursor: 'pointer',
                      display: 'flex',
                      alignItems: 'center',
                      gap: 10,
                    }}
                  >
                    <span style={{ fontSize: 20 }}>{m.icona}</span>
                    <div>
                      <div style={{ fontSize: 12, fontWeight: 700, color: modalitaFirma === m.id ? '#a5b4fc' : 'var(--text)' }}>{m.titolo}</div>
                      <div style={{ fontSize: 10, color: 'var(--muted)' }}>{m.nota}</div>
                    </div>
                  </button>
                ))}
              </div>
            </div>

            {modalitaFirma === 'otp' ? (
              <>
                {/* 📲 SCELTA CANALE DI RICEZIONE DEL CODICE (§1.1, §1.4) */}
                <div style={{ background: 'var(--card2)', border: '1px solid var(--border)', borderRadius: 12, padding: 16, marginBottom: 18 }}>
                  <div style={{ fontSize: 11.5, fontWeight: 800, color: 'var(--text)', marginBottom: 4 }}>
                    📲 Dove vuoi ricevere il codice di firma?
                  </div>
                  <div style={{ fontSize: 10.5, color: 'var(--muted)', marginBottom: 10 }}>
                    La scelta è tua ogni volta. I recapiti sono quelli della tua scheda anagrafica.
                  </div>

                  {canaliFirma.length === 0 ? (
                    <div style={{ fontSize: 11.5, color: '#fbbf24', background: 'rgba(251,191,36,.08)', border: '1px solid rgba(251,191,36,.3)', borderRadius: 8, padding: 10 }}>
                      ⚠️ Non è stato possibile leggere i canali di invio disponibili. Ricarica la pagina o contatta lo Studio: senza un canale attivo il codice non può essere spedito.
                    </div>
                  ) : (
                    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: 10, marginBottom: 14 }}>
                      {canaliFirma.map((c) => {
                        const stile: Record<CanaleOtp, { icona: string; sfondo: string; bordo: string; testo: string }> = {
                          whatsapp: { icona: '🟢', sfondo: '#0d2d22', bordo: '#059669', testo: '#34d399' },
                          email: { icona: '✉️', sfondo: '#1e1b4b', bordo: '#6366f1', testo: '#818cf8' },
                          telegram: { icona: '✈️', sfondo: '#0c2b3f', bordo: '#0ea5e9', testo: '#38bdf8' },
                        };
                        const s = stile[c.canale];
                        const scelto = otpCanale === c.canale;
                        return (
                          <button
                            key={c.canale}
                            type="button"
                            disabled={!c.disponibile}
                            title={c.disponibile ? undefined : c.motivo}
                            onClick={() => { setOtpCanale(c.canale); setOtpError(null); setUsaRecapitoDiverso(false); }}
                            style={{
                              background: scelto ? s.sfondo : 'var(--card)',
                              border: `1.5px solid ${scelto ? s.bordo : 'var(--border)'}`,
                              borderRadius: 10,
                              padding: '10px 14px',
                              textAlign: 'left',
                              cursor: c.disponibile ? 'pointer' : 'not-allowed',
                              opacity: c.disponibile ? 1 : 0.5,
                              display: 'flex',
                              alignItems: 'center',
                              gap: 10,
                            }}
                          >
                            <span style={{ fontSize: 20 }}>{s.icona}</span>
                            <div style={{ minWidth: 0 }}>
                              <div style={{ fontSize: 12, fontWeight: 700, color: scelto ? s.testo : 'var(--text)' }}>
                                {nomeCanale[c.canale]}
                              </div>
                              {/* Il recapito è mascherato: serve a farti riconoscere il tuo, non a mostrarlo per intero. */}
                              <div style={{ fontSize: 10, color: 'var(--muted)', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                                {c.disponibile ? c.recapitoMascherato : c.motivo}
                              </div>
                            </div>
                          </button>
                        );
                      })}
                    </div>
                  )}

                  {/* Recapito diverso da quello in anagrafica (§1.2) */}
                  {canaleCorrente?.disponibile && otpCanale !== 'telegram' && (
                    <div>
                      <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 11, color: 'var(--muted)', cursor: 'pointer' }}>
                        <input
                          type="checkbox"
                          checked={usaRecapitoDiverso}
                          onChange={(e) => { setUsaRecapitoDiverso(e.target.checked); setRecapitoDichiarato(''); }}
                        />
                        <span>
                          {otpCanale === 'email'
                            ? "Voglio ricevere il codice a un altro indirizzo email"
                            : 'Voglio ricevere il codice su un altro numero'}
                        </span>
                      </label>
                      {usaRecapitoDiverso && (
                        <div style={{ marginTop: 8 }}>
                          <input
                            type={otpCanale === 'email' ? 'email' : 'tel'}
                            value={recapitoDichiarato}
                            onChange={(e) => setRecapitoDichiarato(e.target.value)}
                            placeholder={otpCanale === 'email' ? 'nome@dominio.it' : '+39 ...'}
                            style={{ fontSize: 12, padding: '8px 12px', borderRadius: 8, background: 'var(--card)', color: 'var(--text)', border: '1px solid var(--border)', minWidth: 260 }}
                          />
                          <div style={{ fontSize: 10, color: '#fbbf24', marginTop: 6, lineHeight: 1.4 }}>
                            Il recapito che indichi qui viene registrato nel verbale di firma come dichiarato da te
                            e diverso da quello della tua scheda anagrafica.
                          </div>
                        </div>
                      )}
                    </div>
                  )}

                  {/* Telegram: la chat va attivata dal cliente, il codice non può arrivare prima */}
                  {otpCanale === 'telegram' && !canaleCorrente?.disponibile && botTelegram && (
                    <div style={{ fontSize: 11, color: 'var(--muted)', marginTop: 4 }}>
                      Per usare questo canale scrivi una volta a{' '}
                      <a href={`https://t.me/${botTelegram}`} target="_blank" rel="noreferrer" style={{ color: '#38bdf8', fontWeight: 700 }}>
                        @{botTelegram}
                      </a>{' '}
                      e poi ricarica la pagina.
                    </div>
                  )}
                </div>

                {otpError && !otpModalOpen && (
                  <div style={{ fontSize: 11.5, color: '#f87171', background: 'rgba(239,68,68,.08)', border: '1px solid rgba(239,68,68,.3)', borderRadius: 8, padding: 10, marginBottom: 12 }}>
                    ⚠️ {otpError}
                  </div>
                )}

                <button
                  // Il bersaglio va dichiarato qui e non lasciato a quello che c'è in stato:
                  // dopo aver firmato un documento del fascicolo `bersaglioFirma` punta
                  // ancora a quel documento, e il mandato finirebbe registrato con
                  // l'ambito e il riferimento di un altro atto.
                  onClick={() => inviaCodiceFirma({ bersaglio: { ambito: 'engagement_letter', titolo: TITOLO_MANDATO } })}
                  disabled={loading || otpLoading || !canaleCorrente?.disponibile || (usaRecapitoDiverso && !recapitoDichiarato.trim())}
                  style={{
                    background: canaleCorrente?.disponibile ? 'var(--indigo)' : 'var(--card)',
                    color: canaleCorrente?.disponibile ? '#fff' : 'var(--muted)',
                    border: canaleCorrente?.disponibile ? 'none' : '1px solid var(--border)',
                    padding: '12px 28px',
                    borderRadius: 10,
                    fontSize: 13,
                    fontWeight: 700,
                    cursor: canaleCorrente?.disponibile ? 'pointer' : 'not-allowed',
                    boxShadow: canaleCorrente?.disponibile ? '0 4px 20px rgba(99,102,241,.4)' : 'none',
                    display: 'flex',
                    alignItems: 'center',
                    gap: 8,
                  }}
                >
                  <span>
                    {otpLoading
                      ? 'Invio del codice in corso…'
                      : `📲 Invia il codice via ${nomeCanale[otpCanale]} e firma`}
                  </span>
                </button>
              </>
            ) : (
              <>
                {/* FIRMA A PENNA O CON PROVIDER ESTERNO: SCARICA, FIRMA, RICARICA */}
                <div style={{ background: 'var(--card2)', border: '1px solid var(--border)', borderRadius: 12, padding: 16, marginBottom: 14 }}>
                  <div style={{ fontSize: 11.5, color: 'var(--muted)', lineHeight: 1.6, marginBottom: 12 }}>
                    {modalitaFirma === 'manuale_scansionata' ? (
                      <>
                        <strong style={{ color: 'var(--text)' }}>1.</strong> Scarica il PDF del mandato ·{' '}
                        <strong style={{ color: 'var(--text)' }}>2.</strong> Firmalo a penna ·{' '}
                        <strong style={{ color: 'var(--text)' }}>3.</strong> Ricarica qui la scansione o la foto.
                      </>
                    ) : (
                      <>
                        <strong style={{ color: 'var(--text)' }}>1.</strong> Scarica il PDF del mandato ·{' '}
                        <strong style={{ color: 'var(--text)' }}>2.</strong> Firmalo con il tuo dispositivo o servizio
                        di firma digitale (.p7m o PDF firmato) · <strong style={{ color: 'var(--text)' }}>3.</strong> Ricaricalo qui.
                      </>
                    )}
                  </div>

                  <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'center' }}>
                    <button
                      type="button"
                      onClick={async () => {
                        await downloadRealPdf(`Mandato_${clientName.replace(/\s+/g, '_')}`, getResolvedEngagementHtml());
                      }}
                      style={{ background: '#1a1f3d', border: '1px solid #4338ca', color: '#c7d2fe', padding: '10px 18px', borderRadius: 8, fontSize: 11.5, fontWeight: 700, cursor: 'pointer' }}
                    >
                      📥 Scarica il PDF da firmare
                    </button>

                    <label style={{ background: 'var(--card)', border: '1px solid var(--border)', color: 'var(--text)', padding: '10px 18px', borderRadius: 8, fontSize: 11.5, fontWeight: 700, cursor: 'pointer' }}>
                      📎 {fileFirmato ? 'Cambia file' : 'Carica il documento firmato'}
                      <input
                        type="file"
                        accept={modalitaFirma === 'manuale_scansionata' ? 'application/pdf,image/png,image/jpeg' : 'application/pdf,.p7m'}
                        style={{ display: 'none' }}
                        onChange={async (e) => {
                          const file = e.target.files?.[0];
                          if (file) { setOtpError(null); await leggiFileFirmato(file); }
                        }}
                      />
                    </label>

                    {fileFirmato && (
                      <span style={{ fontSize: 11, color: '#34d399', fontWeight: 700 }}>✓ {fileFirmato.nome}</span>
                    )}
                  </div>

                  {modalitaFirma === 'qualificata_esterna' && (
                    // Detto come sta: il certificato non viene verificato dalla piattaforma, e questo
                    // finisce scritto anche nel verbale. Prometterne la validazione sarebbe una firma
                    // dichiarata valida da noi senza che nessuno l'abbia controllata.
                    <div style={{ fontSize: 10.5, color: 'var(--muted)', marginTop: 12, lineHeight: 1.5 }}>
                      La validità della firma qualificata è attestata dal tuo provider. La piattaforma
                      registra la ricezione del file da questa sessione autenticata e ne calcola
                      l'impronta, ma non verifica il certificato di firma.
                    </div>
                  )}
                </div>

                {otpError && (
                  <div style={{ fontSize: 11.5, color: '#f87171', background: 'rgba(239,68,68,.08)', border: '1px solid rgba(239,68,68,.3)', borderRadius: 8, padding: 10, marginBottom: 12 }}>
                    ⚠️ {otpError}
                  </div>
                )}

                <button
                  onClick={() => confermaFirmaConFile()}
                  disabled={!fileFirmato || caricamentoFirmato}
                  style={{
                    background: fileFirmato ? 'var(--indigo)' : 'var(--card)',
                    color: fileFirmato ? '#fff' : 'var(--muted)',
                    border: fileFirmato ? 'none' : '1px solid var(--border)',
                    padding: '12px 28px',
                    borderRadius: 10,
                    fontSize: 13,
                    fontWeight: 700,
                    cursor: fileFirmato ? 'pointer' : 'not-allowed',
                    boxShadow: fileFirmato ? '0 4px 20px rgba(99,102,241,.4)' : 'none',
                  }}
                >
                  {caricamentoFirmato ? 'Caricamento e registrazione…' : '🔒 Deposita il documento firmato'}
                </button>
              </>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
