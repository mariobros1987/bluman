import { CatBadge } from '../ui/CatBadge';
import { fmt } from '../../utils';
import { urlFileArchivio } from '../../api/client';
import type { DocumentoPortale } from '../../api/client';
import type { ModuloProposta } from './types';
import { Modal } from '../ui/Modal';

export interface DettaglioModuloModalProps {
  selectedModule: ModuloProposta;
  moduleSignatures: Record<string, { firmato: boolean; dataFirma: string; signerName: string }>;
  otpLoading: boolean;
  setSelectedModule: (modulo: ModuloProposta | null) => void;
  setSelectedViewerDoc: (doc: any | null) => void;
  setModificaDocTarget: (doc: DocumentoPortale | null) => void;
  setModificaDocTesto: (testo: string) => void;
  scaricaDocumentoClient: (fileUrl?: string | null, nomeFile?: string) => Promise<void>;
  avviaFirmaDocumento: (doc: DocumentoPortale) => Promise<void>;
  avviaFirmaModulo: (modulo: { id: string; nome: string }) => Promise<void>;
}

export function DettaglioModuloModal({
  selectedModule,
  moduleSignatures,
  otpLoading,
  setSelectedModule,
  setSelectedViewerDoc,
  setModificaDocTarget,
  setModificaDocTesto,
  scaricaDocumentoClient,
  avviaFirmaDocumento,
  avviaFirmaModulo,
}: DettaglioModuloModalProps) {
  return (
    <Modal onClose={() => setSelectedModule(null)} zIndex={10000} overlayBackground="rgba(0,0,0,.8)" dirty={false} labelledBy="dettaglio-modulo-titolo">
      <div style={{ background: 'var(--sidebar)', border: '1px solid var(--border)', borderRadius: 16, padding: 24, width: '100%', maxWidth: 640, maxHeight: '90vh', overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 18, boxShadow: '0 25px 60px rgba(0,0,0,.6)' }}>

        {/* Header Modale */}
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', borderBottom: '1px solid var(--border)', paddingBottom: 14 }}>
          <div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}>
              <CatBadge cat={selectedModule.cat} />
              <span style={{ fontSize: 10, color: 'var(--muted)', textTransform: 'uppercase', fontWeight: 800 }}>Fascicolo Operativo Modulo</span>
            </div>
            <h2 id="dettaglio-modulo-titolo" style={{ fontSize: 18, fontWeight: 800, margin: 0 }}>{selectedModule.nome}</h2>
            <div style={{ fontSize: 11.5, color: 'var(--muted)', marginTop: 4 }}>
              Valore Operazione: <strong style={{ color: 'var(--indigo-l)' }}>{fmt(selectedModule.prezzo)}</strong> · Stima Ore: <strong>{selectedModule.ore}h</strong>
            </div>
          </div>
          <button
            onClick={() => setSelectedModule(null)}
            aria-label="Chiudi"
            style={{ background: 'var(--card2)', border: 'none', width: 32, height: 32, borderRadius: 8, color: 'var(--muted)', cursor: 'pointer', fontSize: 14, fontWeight: 700 }}
          >
            ✕
          </button>
        </div>

        {/* Stato Conclusione / Firma Banner */}
        {moduleSignatures[selectedModule.id]?.firmato ? (
          <div style={{ background: 'var(--pill-green-bg)', border: '1.5px solid var(--green)', borderRadius: 12, padding: '14px 18px', display: 'flex', alignItems: 'center', gap: 12 }}>
            <div style={{ width: 36, height: 36, borderRadius: '50%', background: 'var(--green)', color: 'var(--pill-green-bg)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 18, fontWeight: 800 }}>✓</div>
            <div>
              <div style={{ fontSize: 13, fontWeight: 800, color: 'var(--green)' }}>✓ OPERAZIONE CONCLUSA & VALIDATA CON SUCCESSO</div>
              <div style={{ fontSize: 11, color: 'var(--pill-green-fg)', marginTop: 2 }}>
                Firmato digitalmente da <strong>{moduleSignatures[selectedModule.id].signerName}</strong> in data {moduleSignatures[selectedModule.id].dataFirma} · Firma Elettronica Semplice (OTP verificata) · art. 20 CAD
              </div>
            </div>
          </div>
        ) : selectedModule.stato === 'completato' ? (
          <div style={{ background: 'var(--pill-amber-bg)', border: '1.5px solid var(--amber)', borderRadius: 12, padding: '14px 18px', display: 'flex', alignItems: 'center', gap: 12 }}>
            <div style={{ width: 36, height: 36, borderRadius: '50%', background: 'var(--amber)', color: 'var(--pill-amber-bg)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 18, fontWeight: 800 }}>✍️</div>
            <div>
              <div style={{ fontSize: 13, fontWeight: 800, color: 'var(--amber)' }}>ATTIVITÀ OPERATIVE COMPLETATE — IN ATTESA DI FIRMA</div>
              <div style={{ fontSize: 11, color: 'var(--pill-amber-fg)', marginTop: 2 }}>
                L'operatore ha completato tutte le prestazioni previste. Verifica i passaggi sotto ed apponi la firma conclusiva per validare l'operazione.
              </div>
            </div>
          </div>
        ) : (
          <div style={{ background: 'var(--pill-indigo-bg)', border: '1.5px solid var(--indigo-d)', borderRadius: 12, padding: '14px 18px', display: 'flex', alignItems: 'center', gap: 12 }}>
            <div style={{ width: 36, height: 36, borderRadius: '50%', background: 'var(--indigo)', color: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 18, fontWeight: 800 }}>⏱</div>
            <div>
              <div style={{ fontSize: 13, fontWeight: 800, color: 'var(--pill-indigo-fg)' }}>
                {(selectedModule.percentuale ?? 0) > 0
                  ? `OPERAZIONE IN LAVORAZIONE (${selectedModule.percentuale}%)`
                  : 'OPERAZIONE NON ANCORA AVVIATA'}
              </div>
              <div style={{ fontSize: 11, color: 'var(--pill-indigo-fg)', marginTop: 2 }}>
                {/* Prima: `{selectedModule.percentuale || 75}%` con "il team sta eseguendo gli
                    ultimi adempimenti" — un modulo a 0% dichiarava al cliente il 75% e lavori
                    agli sgoccioli. Il ripiego scattava proprio quando il dato mancava. */}
                {(selectedModule.percentuale ?? 0) > 0
                  ? 'Le prestazioni previste sono in corso di esecuzione.'
                  : 'Nessuna prestazione risulta ancora avviata su questo modulo.'}
              </div>
            </div>
          </div>
        )}

        {/* Scheda Team Responsabile. Il riquadro "Data Esecuzione: Agosto 2026" che stava
            qui a destra era una data cablata nel sorgente, identica per ogni modulo di ogni
            cliente: `ModuloProposta` non porta nessuna data, quindi non c'era niente da
            mostrare. Rimosso anziché sostituito con la data di oggi, che sarebbe la stessa
            bugia con un numero diverso. */}
        <div style={{ background: 'var(--card2)', border: '1px solid var(--border)', borderRadius: 12, padding: 14, display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 10 }}>
          <div>
            <div style={{ fontSize: 10, color: 'var(--muted)', textTransform: 'uppercase', fontWeight: 700 }}>Advisor / Operatore Incaricato:</div>
            <div style={{ fontSize: 13, fontWeight: 700, marginTop: 2, color: selectedModule.operatore ? 'var(--text)' : 'var(--muted)' }}>
              {selectedModule.operatore ? `👤 ${selectedModule.operatore}` : 'Operatore non ancora assegnato'}
            </div>
          </div>
        </div>

        {/* Checklist Passaggi Operativi Svolti dall'Operatore */}
        <div>
          <div style={{ fontSize: 12, fontWeight: 800, textTransform: 'uppercase', letterSpacing: '.5px', color: 'var(--muted)', marginBottom: 10 }}>
            📋 Dettaglio Passaggi & Micro-Prestazioni Svolte ({selectedModule.passaggi?.length ?? 0}):
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {(selectedModule.passaggi ?? []).length === 0 && (
              <div style={{ background: 'var(--card)', border: '1px dashed var(--border)', borderRadius: 10, padding: '12px 14px', fontSize: 11.5, color: 'var(--muted)', lineHeight: 1.6 }}>
                Questo modulo non ha ancora micro-prestazioni registrate a database. L'elenco
                si popola man mano che l'operatore consuntiva le attività.
              </div>
            )}
            {(selectedModule.passaggi ?? []).map((p, pIdx) => (
              <div
                key={p.id || pIdx}
                style={{
                  background: 'var(--card)',
                  border: p.completato ? '1px solid var(--pill-green-bd)' : '1px solid var(--border)',
                  borderRadius: 10,
                  padding: '12px 14px',
                  display: 'flex',
                  flexDirection: 'column',
                  gap: 8,
                }}
              >
                <div style={{ display: 'flex', alignItems: 'flex-start', gap: 12 }}>
                  <div style={{ width: 22, height: 22, borderRadius: '50%', background: p.completato ? 'var(--pill-green-bg)' : 'var(--card2)', color: p.completato ? 'var(--green)' : 'var(--muted)', border: `1px solid ${p.completato ? 'var(--green)' : 'var(--border)'}`, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 11, fontWeight: 800, marginTop: 2 }}>
                    {p.completato ? '✓' : pIdx + 1}
                  </div>
                  <div style={{ flex: 1 }}>
                    <div style={{ fontSize: 12.5, fontWeight: 700, color: p.completato ? 'var(--text)' : 'var(--muted)' }}>
                      {p.titolo}
                    </div>
                    <div style={{ fontSize: 11, color: 'var(--muted)', marginTop: 2 }}>
                      {p.note ? `${p.note} · ` : ''}<span style={{ color: 'var(--indigo-l)' }}>Operatore: {p.operatore || 'Studio'}</span>{p.data ? ` (${p.data})` : ''}
                    </div>
                  </div>
                  <span style={{ fontSize: 10, fontWeight: 800, padding: '2px 8px', borderRadius: 8, background: p.completato ? 'var(--pill-green-bg)' : 'var(--card2)', color: p.completato ? 'var(--green)' : 'var(--muted)' }}>
                    {p.completato ? 'Completato ✓' : 'In Corso'}
                  </span>
                </div>

                {/* Documenti specifici collegati a questa micro-voce */}
                {p.documenti && p.documenti.length > 0 && (
                  <div style={{ marginTop: 4, paddingTop: 8, borderTop: '1px dashed var(--border)', display: 'flex', flexDirection: 'column', gap: 6 }}>
                    <div style={{ fontSize: 10, fontWeight: 700, color: 'var(--indigo-l)', textTransform: 'uppercase' }}>
                      📄 Documenti pubblicati per questa micro-fase:
                    </div>
                    {p.documenti.map((doc) => (
                      <div
                        key={doc.id}
                        style={{
                          background: doc.firmato ? '#064e3b30' : 'var(--card2)',
                          border: `1px solid ${doc.firmato ? 'var(--green)' : 'var(--indigo-d)'}`,
                          borderRadius: 8,
                          padding: '8px 12px',
                          display: 'flex',
                          justifyContent: 'space-between',
                          alignItems: 'center',
                          flexWrap: 'wrap',
                          gap: 8,
                        }}
                      >
                        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                          <span style={{ fontSize: 16 }}>{doc.tipo === 'verbale_firma' ? '📜' : doc.firmato ? '🔒' : '📄'}</span>
                          <div>
                            <div style={{ fontSize: 11.5, fontWeight: 700, color: 'var(--text)' }}>
                              {doc.nome}
                              {doc.versione && doc.versione > 1 && (
                                <span style={{ marginLeft: 6, fontSize: 9.5, background: 'var(--card)', padding: '1px 5px', borderRadius: 4, color: 'var(--indigo-l)', fontWeight: 600 }}>v{doc.versione}</span>
                              )}
                            </div>
                            <div style={{ fontSize: 10, color: doc.tipo === 'verbale_firma' ? 'var(--pill-indigo-fg)' : doc.firmato ? 'var(--green)' : doc.statoDoc === 'in_revisione' ? 'var(--amber)' : 'var(--pill-blue-fg)' }}>
                              {doc.tipo === 'verbale_firma' ? '📜 Verbale di firma · atto certificativo' : doc.firmato ? '✓ Firmato con OTP verificata' : doc.statoDoc === 'in_revisione' ? '⚠️ In attesa di riscontro modifica' : '🚀 Pubblicato dallo studio per la firma'}
                            </div>
                            {doc.versioniPrecedenti && doc.versioniPrecedenti.length > 0 && (
                              <div style={{ fontSize: 9.5, color: 'var(--pill-blue-fg)', marginTop: 2 }}>
                                🕘 v{doc.versione}: sostituisce {doc.versioniPrecedenti.map(v => `v${v.versione}${v.firmatoAt ? ' (firmata)' : ''}`).join(', ')} — cronologia completa nella scheda «Documenti & Contratti»
                              </div>
                            )}
                          </div>
                        </div>

                        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                          <button
                            type="button"
                            onClick={() => setSelectedViewerDoc(doc)}
                            style={{ background: 'var(--surface-1)', border: '1px solid var(--indigo-d)', color: 'var(--pill-indigo-fg)', padding: '5px 10px', borderRadius: 6, fontSize: 10.5, fontWeight: 700, cursor: 'pointer' }}
                          >
                            👁 Apri
                          </button>
                          {doc.scaricabile && urlFileArchivio(doc.fileUrl) && (
                            <button
                              type="button"
                              onClick={() => scaricaDocumentoClient(doc.fileUrl, doc.nome)}
                              style={{ background: 'transparent', border: '1px solid var(--border)', color: 'var(--muted)', padding: '5px 8px', borderRadius: 6, fontSize: 10.5, cursor: 'pointer', display: 'flex', alignItems: 'center' }}
                              title="Scarica il file"
                            >
                              ⬇
                            </button>
                          )}
                          {!doc.firmato && doc.tipo !== 'verbale_firma' && (
                            <>
                              <button
                                type="button"
                                onClick={() => { setModificaDocTarget(doc); setModificaDocTesto(''); }}
                                style={{ background: 'var(--pill-slate-bg)', border: '1px solid var(--hint)', color: 'var(--amber)', padding: '5px 10px', borderRadius: 6, fontSize: 10.5, fontWeight: 700, cursor: 'pointer' }}
                                title="Chiedi modifiche o note prima di firmare"
                              >
                                📝 Modifica
                              </button>
                              <button
                                type="button"
                                disabled={!doc.richiedeFirma || otpLoading}
                                onClick={() => avviaFirmaDocumento(doc)}
                                style={{ background: 'var(--indigo)', color: '#fff', border: 'none', padding: '5px 12px', borderRadius: 6, fontSize: 10.5, fontWeight: 700, cursor: 'pointer' }}
                              >
                                ✍️ Firma
                              </button>
                            </>
                          )}
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>

        {/* Documenti & Deliverables Prodotti */}
        <div>
          <div style={{ fontSize: 12, fontWeight: 800, textTransform: 'uppercase', letterSpacing: '.5px', color: 'var(--muted)', marginBottom: 10 }}>
            📎 Documenti & Fascicoli Prodotti dall'Operatore ({selectedModule.deliverables?.length ?? 0}):
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {(selectedModule.deliverables ?? []).length === 0 && (
              <div style={{ background: 'var(--card2)', border: '1px dashed var(--border)', borderRadius: 10, padding: '12px 14px', fontSize: 11.5, color: 'var(--muted)', lineHeight: 1.6 }}>
                Nessun documento è ancora stato pubblicato per questo modulo. I fascicoli
                prodotti compaiono qui e nella scheda "Documenti & Contratti" non appena lo Studio
                li pubblica.
              </div>
            )}
            {(selectedModule.deliverables ?? []).map((d, dIdx) => {
              const docReal = d.docCompleto;
              return (
                <div
                  key={d.id || dIdx}
                  style={{
                    background: d.firmato ? '#064e3b30' : 'var(--card2)',
                    border: `1px solid ${d.firmato ? 'var(--green)' : 'var(--border)'}`,
                    borderRadius: 10,
                    padding: '12px 14px',
                    display: 'flex',
                    justifyContent: 'space-between',
                    alignItems: 'center',
                    flexWrap: 'wrap',
                    gap: 8,
                  }}
                >
                  <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                    <span style={{ fontSize: 18 }}>{d.firmato ? '🔒' : '📄'}</span>
                    <div>
                      <div style={{ fontSize: 12.5, fontWeight: 700 }}>
                        {d.titolo}
                        {docReal?.versione && docReal.versione > 1 && (
                          <span style={{ marginLeft: 6, fontSize: 10, background: 'var(--card)', padding: '1px 5px', borderRadius: 4, color: 'var(--indigo-l)' }}>v{docReal.versione}</span>
                        )}
                      </div>
                      <div style={{ fontSize: 10.5, color: 'var(--muted)', marginTop: 2 }}>
                        {d.nomeFile} · Depositato il {d.data}
                        {d.firmato && <span style={{ color: 'var(--green)', fontWeight: 700, marginLeft: 6 }}>✓ Firmato</span>}
                      </div>
                      {docReal?.versioniPrecedenti && docReal.versioniPrecedenti.length > 0 && (
                        <div style={{ fontSize: 9.5, color: 'var(--pill-blue-fg)', marginTop: 2 }}>
                          🕘 v{docReal.versione}: sostituisce {docReal.versioniPrecedenti.map(v => `v${v.versione}${v.firmatoAt ? ' (firmata)' : ''}`).join(', ')} — cronologia completa nella scheda «Documenti & Contratti»
                        </div>
                      )}
                    </div>
                  </div>

                  <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
                    <button
                      type="button"
                      onClick={() => {
                        if (docReal) setSelectedViewerDoc(docReal);
                      }}
                      style={{ background: 'var(--surface-1)', border: '1px solid var(--indigo-d)', color: 'var(--pill-indigo-fg)', padding: '6px 12px', borderRadius: 6, fontSize: 11, fontWeight: 700, cursor: 'pointer' }}
                    >
                      👁 Apri Documento
                    </button>

                    {docReal?.scaricabile && urlFileArchivio(docReal.fileUrl) && (
                      <button
                        type="button"
                        onClick={() => scaricaDocumentoClient(docReal.fileUrl, d.nomeFile)}
                        style={{ background: 'transparent', border: '1px solid var(--border)', color: 'var(--muted)', padding: '6px 10px', borderRadius: 6, fontSize: 11, cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 4 }}
                      >
                        ⬇ Scarica
                      </button>
                    )}

                    {!d.firmato && docReal && docReal.tipo !== 'verbale_firma' && (
                      <>
                        <button
                          type="button"
                          onClick={() => { setModificaDocTarget(docReal); setModificaDocTesto(''); }}
                          style={{ background: 'var(--pill-slate-bg)', border: '1px solid var(--hint)', color: 'var(--amber)', padding: '6px 12px', borderRadius: 6, fontSize: 11, fontWeight: 700, cursor: 'pointer' }}
                          title="Invia note allo studio"
                        >
                          📝 Richiedi Modifiche
                        </button>
                        <button
                          type="button"
                          disabled={!docReal.richiedeFirma || otpLoading}
                          onClick={() => avviaFirmaDocumento(docReal)}
                          style={{ background: 'var(--indigo)', color: '#fff', border: 'none', padding: '6px 14px', borderRadius: 6, fontSize: 11, fontWeight: 700, cursor: 'pointer' }}
                        >
                          ✍️ Firma con codice
                        </button>
                      </>
                    )}
                  </div>
                </div>
              );
            })}
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
            <div style={{ fontSize: 12, color: 'var(--green)', fontWeight: 700, display: 'flex', alignItems: 'center', gap: 6 }}>
              <span>🔒 Conclusione firmata · firma registrata con OTP verificata</span>
            </div>
          ) : (
            <button
              onClick={() => { void avviaFirmaModulo(selectedModule); }}
              style={{
                background: 'var(--green)',
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
              <span>✍️ Firma la conclusione dell'operazione (firma semplice con codice OTP · art. 20 CAD)</span>
            </button>
          )}
        </div>

      </div>
    </Modal>
  );
}
