import React, { useState } from 'react';
import {
  eliminaDocumentoApi,
  archiviaDocumentoApi,
  scaricaDocumentoClient,
  scaricaDocumentoWordClient,
} from '../../api/client';
import { isAdminStudio } from '../../utils/tenant';
import type { DocumentTemplate } from '../../utils/documentTemplates';
import type { DocumentoEntry } from './types';
import type { RecommendationResult } from './catalogoModelliStudio';
import { etichettaTipoFirma } from './passaggioUtils';
import { FirmaStudioModal } from '../documenti/FirmaStudioModal';
import { useToast } from '../ui/ToastProvider';
import { confirm } from '../ui/ConfirmProvider';

// ─── Tab 3: Documenti & Pre-screening AI ───────────────────────────────
export function TabDocumenti({
  recommendation,
  setShowCatalogModal,
  handleApplyTemplate,
  versionInputRef,
  handleFileNuovaVersione,
  documents,
  setSelectedDocPreview,
  handleRisolviRichiesta,
  handlePubblicaDocumento,
  handleRimettiInBozza,
  setVersionTargetDocId,
  persistDocuments,
  effProgettoId,
  handleSbloccaDocumento,
  uploadingDoc,
  handleFileUploadPassaggio,
}: {
  recommendation: RecommendationResult;
  setShowCatalogModal: React.Dispatch<React.SetStateAction<boolean>>;
  handleApplyTemplate: (tmpl: DocumentTemplate, stepId?: string) => void;
  versionInputRef: React.RefObject<HTMLInputElement | null>;
  handleFileNuovaVersione: (e: React.ChangeEvent<HTMLInputElement>) => void;
  documents: DocumentoEntry[];
  setSelectedDocPreview: React.Dispatch<React.SetStateAction<DocumentoEntry | null>>;
  handleRisolviRichiesta: (rid: string) => void;
  handlePubblicaDocumento: (docId: string) => void;
  handleRimettiInBozza: (docId: string) => void;
  setVersionTargetDocId: React.Dispatch<React.SetStateAction<string | null>>;
  persistDocuments: (newDocs: DocumentoEntry[]) => void;
  effProgettoId: string | undefined;
  handleSbloccaDocumento: (docId: string, nomeDoc: string) => void;
  uploadingDoc: boolean;
  handleFileUploadPassaggio: (e: React.ChangeEvent<HTMLInputElement>) => void;
}) {
  const toast = useToast();
  const [docPerFirmaStudio, setDocPerFirmaStudio] = useState<DocumentoEntry | null>(null);

  return (
          <div style={{ flex: 1, overflowY: 'auto', padding: 20, display: 'flex', flexDirection: 'column', gap: 18 }}>
            {/* Box Pre-screening & Suggerimento Modello Intelligente */}
            <div style={{ background: '#1e1b4b30', border: '1.5px solid var(--indigo)', borderRadius: 12, padding: 16 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, color: 'var(--indigo-l)', fontWeight: 700, fontSize: 12 }}>
                  <span>💡 Pre-screening AI Studio & Modello Consigliato</span>
                  <span style={{ fontSize: 10, background: 'var(--pill-indigo-bg)', color: 'var(--pill-indigo-fg)', padding: '2px 8px', borderRadius: 10, fontWeight: 700 }}>
                    {recommendation.confidence === 'high' ? '🎯 ALTA AFFINITÀ' : '💡 SUGGERIMENTO'}
                  </span>
                </div>
                <button
                  type="button"
                  onClick={() => setShowCatalogModal(true)}
                  style={{ background: 'transparent', border: 'none', color: 'var(--indigo-l)', fontSize: 11, cursor: 'pointer', textDecoration: 'underline', fontWeight: 600 }}
                >
                  Sfoglia tutti i 30 modelli ↗
                </button>
              </div>

              {recommendation.template ? (
                <div style={{ marginTop: 10 }}>
                  <div style={{ fontSize: 13.5, fontWeight: 800, color: 'var(--text)' }}>
                    📄 {recommendation.template.titolo}
                  </div>
                  <div style={{ fontSize: 11, color: 'var(--pill-slate-fg)', marginTop: 4, lineHeight: 1.4 }}>
                    {recommendation.reason}
                  </div>
                  <div style={{ display: 'flex', gap: 10, marginTop: 12, flexWrap: 'wrap' }}>
                    <button
                      type="button"
                      onClick={() => handleApplyTemplate(recommendation.template!)}
                      style={{ background: 'var(--indigo)', color: 'var(--on-accent)', border: 'none', padding: '7px 16px', borderRadius: 8, fontSize: 11.5, fontWeight: 700, cursor: 'pointer', boxShadow: '0 4px 12px rgba(99,102,241,0.3)' }}
                    >
                      ⚡ Collega Modello Consigliato (1-Click)
                    </button>
                    <button
                      type="button"
                      onClick={() => setShowCatalogModal(true)}
                      style={{ background: 'var(--card2)', border: '1px solid var(--border)', color: 'var(--text)', padding: '7px 14px', borderRadius: 8, fontSize: 11.5, fontWeight: 600, cursor: 'pointer' }}
                    >
                      📂 Scegli Altro Modello Studio
                    </button>
                  </div>
                </div>
              ) : (
                <div style={{ fontSize: 11, color: 'var(--muted)', marginTop: 8 }}>
                  Nessun modello consigliato in modo automatico per questo tipo di attività.
                </div>
              )}
            </div>

            {/* Input file nascosto per caricare nuove versioni di documenti */}
            <input
              type="file"
              ref={versionInputRef}
              style={{ display: 'none' }}
              accept=".pdf,.doc,.docx,.jpg,.jpeg,.png,.xlsx,.xls,.txt,.p7m,.xml"
              onChange={handleFileNuovaVersione}
            />

            {/* Lista Documenti Effettivamente Collegati */}
            <div>
              <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--muted)', textTransform: 'uppercase', letterSpacing: '.5px', marginBottom: 10 }}>
                Documenti Collegati a questa Microvoce ({documents.length})
              </div>

              {documents.length === 0 ? (
                <div style={{ padding: 24, textAlign: 'center', background: 'var(--card)', border: '1px dashed var(--border)', borderRadius: 10, color: 'var(--muted)', fontSize: 12 }}>
                  <div style={{ fontSize: 24, marginBottom: 6 }}>📭</div>
                  <strong>Nessun documento collegato a questa voce.</strong>
                  <div style={{ fontSize: 11, marginTop: 4 }}>
                    Questa attività non ha atti o contratti forzati. Puoi associare il modello consigliato sopra o caricare un file personalizzato in bozza.
                  </div>
                </div>
              ) : (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                  {documents.map(d => {
                    const st = d.statoDoc || (d.firmato ? 'firmato' : 'bozza');
                    const hasAperte = d.richiesteModifica && d.richiesteModifica.some(r => r.stato === 'aperta');

                    return (
                      <div
                        key={d.id}
                        style={{
                          background: 'var(--card)',
                          border: st === 'in_revisione' || hasAperte ? '1.5px solid var(--amber)' : (st === 'pubblicato' ? '1.5px solid var(--cat-societario)' : (st === 'firmato' ? '1.5px solid var(--green)' : '1px solid var(--border)')),
                          borderRadius: 10,
                          padding: 14,
                          display: 'flex',
                          flexDirection: 'column',
                          gap: 10,
                        }}
                      >
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', flexWrap: 'wrap', gap: 8 }}>
                          <div
                            onClick={() => setSelectedDocPreview(d)}
                            style={{ display: 'flex', alignItems: 'center', gap: 10, cursor: 'pointer', flex: 1, minWidth: 200 }}
                            title="Clicca per visualizzare"
                          >
                            <div style={{ fontSize: 24 }}>📄</div>
                            <div>
                              <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
                                <span style={{ fontSize: 13, fontWeight: 700, color: 'var(--indigo-l)', textDecoration: 'underline' }}>{d.nome}</span>
                                {d.versione && (
                                  <span style={{ fontSize: 9.5, fontWeight: 700, padding: '1px 6px', borderRadius: 6, background: 'var(--card2)', border: '1px solid var(--border)', color: 'var(--text)' }}>
                                    v{d.versione}
                                  </span>
                                )}
                              </div>
                              <div style={{ fontSize: 10, color: 'var(--muted)', marginTop: 2 }}>
                                {d.dimensione} · Caricato il {d.dataCaricamento}
                              </div>
                            </div>
                          </div>

                          {/* Stato Workflow Badge */}
                          <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
                            {st === 'bozza' && (
                              <span style={{ background: 'var(--pill-slate-bg)', color: 'var(--muted)', border: '1px solid var(--border)', padding: '3px 8px', borderRadius: 12, fontSize: 10, fontWeight: 700 }}>
                                🔒 BOZZA (Cliente non vede)
                              </span>
                            )}
                            {st === 'pubblicato' && (
                              <span style={{ background: '#1e3a8a30', color: 'var(--indigo-l)', border: '1px solid var(--indigo-d)', padding: '3px 8px', borderRadius: 12, fontSize: 10, fontWeight: 700 }}>
                                🚀 PUBBLICATO (In attesa di firma)
                              </span>
                            )}
                            {st === 'in_revisione' && (
                              <span style={{ background: '#451a0330', color: 'var(--amber)', border: '1px solid var(--pill-amber-bd)', padding: '3px 8px', borderRadius: 12, fontSize: 10, fontWeight: 700 }}>
                                ⚠️ IN REVISIONE (Modifica richiesta)
                              </span>
                            )}
                            {st === 'firmato' && (
                              <span style={{ background: '#064e3b30', color: 'var(--green)', border: '1px solid var(--green)', padding: '3px 8px', borderRadius: 12, fontSize: 10, fontWeight: 700 }}>
                                {/* §WF-DOC / regola 7 — l'etichetta dice il tipo di firma che c'è stato
                                    davvero: prima diceva "CON OTP" anche su una firma qualificata
                                    esterna o su un cartaceo scansionato, promettendo più del vero. */}
                                ✅ FIRMATO CLIENTE{etichettaTipoFirma(d.firma?.tipoFirma) ? ` — ${etichettaTipoFirma(d.firma?.tipoFirma)}` : ''}
                              </span>
                            )}
                            {d.firmatoDaStudio && (
                              <span style={{ background: '#1e1b4b50', color: 'var(--indigo-l)', border: '1px solid var(--indigo-d)', padding: '3px 8px', borderRadius: 12, fontSize: 10, fontWeight: 700 }}>
                                🏛️ FIRMATO STUDIO ({d.firmaStudio?.firmatarioNome || 'Professionista'})
                              </span>
                            )}
                          </div>
                        </div>

                        {/* §WF-DOC — sigillo di firma cliente */}
                        {st === 'firmato' && (
                          <div style={{ background: '#064e3b25', border: '1px solid var(--green)', borderRadius: 8, padding: '9px 12px', display: 'flex', flexDirection: 'column', gap: 3 }}>
                            <div style={{ fontSize: 11.5, fontWeight: 700, color: 'var(--green)' }}>
                              🔒 Documento sottoscritto dal cliente
                              {d.firma?.firmatoAt ? ` il ${new Date(d.firma.firmatoAt).toLocaleString('it-IT')}` : ''}
                            </div>
                            <div style={{ fontSize: 10, color: 'var(--muted)' }}>
                              {d.firma?.signatureId
                                ? <>Riferimento firma: <code style={{ fontSize: 9.5 }}>{d.firma.signatureId}</code></>
                                : 'Riferimento firma non disponibile su questo documento.'}
                            </div>
                            <div style={{ fontSize: 10, color: 'var(--muted)' }}>
                              Stato terminale: pubblicazione, nuove versioni ed eliminazione sono bloccate.
                              {' '}Solo l'amministratore dello studio può riaprirlo, motivando lo sblocco.
                            </div>
                          </div>
                        )}

                        {/* Sigillo di firma Studio / Professionista */}
                        {d.firmatoDaStudio && (
                          <div style={{ background: '#1e1b4b30', border: '1px solid var(--indigo)', borderRadius: 8, padding: '9px 12px', display: 'flex', flexDirection: 'column', gap: 3 }}>
                            <div style={{ fontSize: 11.5, fontWeight: 700, color: 'var(--indigo-l)' }}>
                              🏛️ Sottoscritto dallo Studio: {d.firmaStudio?.firmatarioNome} {d.firmaStudio?.firmatarioRuolo ? `(${d.firmaStudio.firmatarioRuolo})` : ''}
                              {d.firmaStudio?.firmatoAt ? ` il ${new Date(d.firmaStudio.firmatoAt).toLocaleString('it-IT')}` : ''}
                            </div>
                            {d.firmaStudio?.signatureId && (
                              <div style={{ fontSize: 10, color: 'var(--muted)' }}>
                                Sigillo Studio: <code style={{ fontSize: 9.5 }}>{d.firmaStudio.signatureId}</code> ({d.firmaStudio.valoreLegale?.toUpperCase() || 'SES'})
                              </div>
                            )}
                          </div>
                        )}

                        {/* Note / Richieste di Modifica del Cliente */}
                        {d.richiesteModifica && d.richiesteModifica.length > 0 && (
                          <div style={{ background: '#27180430', border: '1px solid var(--pill-amber-bg)', borderRadius: 8, padding: '10px 12px', display: 'flex', flexDirection: 'column', gap: 6 }}>
                            <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--amber)', display: 'flex', alignItems: 'center', gap: 4 }}>
                              <span>💬 Richieste di Modifica del Cliente ({d.richiesteModifica.length}):</span>
                            </div>
                            {d.richiesteModifica.map(rm => (
                              <div key={rm.id} style={{ fontSize: 11, background: 'var(--card)', padding: '6px 10px', borderRadius: 6, border: '1px solid var(--border)', display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8 }}>
                                <div style={{ flex: 1 }}>
                                  <div style={{ color: 'var(--text)', fontStyle: 'italic' }}>«{rm.commento}»</div>
                                  <div style={{ fontSize: 9.5, color: 'var(--muted)', marginTop: 2 }}>
                                    Inviato da {rm.cliente?.nome || 'Cliente'} il {new Date(rm.creatoAt).toLocaleString('it-IT')}
                                    {rm.rispostaStudio && <span style={{ color: 'var(--cat-societario)' }}> · Risposta studio: {rm.rispostaStudio}</span>}
                                  </div>
                                </div>
                                <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                                  {rm.stato === 'aperta' ? (
                                    <button
                                      type="button"
                                      onClick={() => handleRisolviRichiesta(rm.id)}
                                      style={{ background: 'var(--green)', color: 'var(--on-accent)', border: 'none', padding: '3px 8px', borderRadius: 6, fontSize: 9.5, fontWeight: 700, cursor: 'pointer' }}
                                    >
                                      ✓ Segna Risolta
                                    </button>
                                  ) : (
                                    <span style={{ fontSize: 9.5, color: 'var(--green)', fontWeight: 700 }}>✓ Risolta</span>
                                  )}
                                </div>
                              </div>
                            ))}
                          </div>
                        )}

                        {/* Barra Azioni Operatore */}
                        <div style={{ display: 'flex', justifyContent: 'flex-end', alignItems: 'center', gap: 6, flexWrap: 'wrap', borderTop: '1px solid var(--border)', paddingTop: 8 }}>
                          {/* Pulsante Pubblica al Cliente */}
                          {(st === 'bozza' || st === 'in_revisione') && (
                            <button
                              type="button"
                              onClick={() => handlePubblicaDocumento(d.id)}
                              style={{ background: 'var(--cat-societario)', color: 'var(--on-accent)', border: 'none', padding: '5px 12px', borderRadius: 6, fontSize: 11, fontWeight: 700, cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 4 }}
                              title="Pubblica questo documento nel portale cliente per consentirne la visione e la firma"
                            >
                              🚀 Pubblica al Cliente
                            </button>
                          )}

                          {/* Pulsante Firma Studio */}
                          {!d.firmatoDaStudio && (
                            <button
                              type="button"
                              onClick={() => setDocPerFirmaStudio(d)}
                              style={{ background: 'var(--pill-indigo-bg)', border: '1px solid var(--pill-indigo-bd)', color: 'var(--pill-indigo-fg)', padding: '5px 10px', borderRadius: 6, fontSize: 10.5, fontWeight: 700, cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 4 }}
                              title="Apponi la firma dello studio / professionista incaricato sul documento"
                            >
                              ✍️ Firma Studio
                            </button>
                          )}

                          {/* Pulsante Rimetti in Bozza */}
                          {st === 'pubblicato' && (
                            <button
                              type="button"
                              onClick={() => handleRimettiInBozza(d.id)}
                              style={{ background: 'var(--card2)', border: '1px solid var(--border)', color: 'var(--muted)', padding: '5px 10px', borderRadius: 6, fontSize: 10.5, fontWeight: 600, cursor: 'pointer' }}
                              title="Nascondi temporaneamente al cliente per modifiche interne"
                            >
                              🔒 Rimetti in Bozza
                            </button>
                          )}

                          {/* Pulsante Carica Nuova Versione — §WF-DOC: non su un atto firmato.
                              Il server rifiuta comunque la richiesta (409), qui evitiamo di
                              offrire un comando che non può funzionare. */}
                          {st !== 'firmato' && (
                            <button
                              type="button"
                              onClick={() => {
                                setVersionTargetDocId(d.id);
                                versionInputRef.current?.click();
                              }}
                              style={{ background: 'var(--card2)', border: '1px solid var(--border)', color: 'var(--text)', padding: '5px 10px', borderRadius: 6, fontSize: 10.5, fontWeight: 600, cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 4 }}
                              title="Carica una versione aggiornata (es. v2) mantenendo lo storico"
                            >
                              📤 Carica Nuova Versione (v{(d.versione || 1) + 1})
                            </button>
                          )}

                          {d.fileUrl && (
                            <>
                              <button
                                type="button"
                                onClick={() => scaricaDocumentoClient(d.fileFirmatoUrl || d.filePdfUrl || d.fileUrl, d.nome)}
                                style={{ background: 'var(--pill-green-bg)', border: '1px solid var(--pill-green-bd)', color: 'var(--pill-green-fg)', padding: '5px 8px', borderRadius: 6, fontSize: 11, cursor: 'pointer', fontWeight: 600, display: 'flex', alignItems: 'center', gap: 3 }}
                                title={st === 'firmato' || d.firmato ? "Scarica l'atto con la firma del cliente" : "Scarica in formato PDF A4"}
                              >
                                {st === 'firmato' || d.firmato ? '📥 PDF Firmato' : '📥 PDF'}
                              </button>
                              <button
                                type="button"
                                onClick={() => (d.fileDocxUrl
                                  ? scaricaDocumentoClient(d.fileDocxUrl, d.nome.replace(/\.(pdf|docx?)$/i, '') + '.docx')
                                  : scaricaDocumentoWordClient(d.fileUrl, d.nome))}
                                style={{ background: 'var(--pill-indigo-bg)', border: '1px solid var(--indigo-l)', color: 'var(--pill-blue-fg)', padding: '5px 8px', borderRadius: 6, fontSize: 11, cursor: 'pointer', fontWeight: 600, display: 'flex', alignItems: 'center', gap: 3 }}
                                title="Scarica in formato Microsoft Word (.doc)"
                              >
                                📝 Word
                              </button>
                            </>
                          )}

                          <button
                            type="button"
                            onClick={() => setSelectedDocPreview(d)}
                            style={{ background: 'var(--indigo)', color: 'var(--on-accent)', border: 'none', padding: '5px 10px', borderRadius: 6, fontSize: 11, cursor: 'pointer', fontWeight: 600 }}
                          >
                            👁 Visualizza
                          </button>

                          {/* Eliminazione — §WF-DOC: un atto firmato non si cancella.
                              Sparirebbe il file e al cliente resterebbe una firma orfana. */}
                          {st !== 'firmato' && (
                            <button
                              type="button"
                              onClick={async () => {
                                if (await confirm({ messaggio: `Sei sicuro di voler eliminare il documento "${d.nome}"?`, confermaLabel: 'Elimina', pericolo: true })) {
                                  if (effProgettoId && !d.id.startsWith('d-')) {
                                    try {
                                      await eliminaDocumentoApi(d.id);
                                    } catch (err: any) {
                                      // Prima l'errore finiva nella console e il documento
                                      // veniva togliato dall'elenco locale comunque: sul
                                      // database restava, e alla riapertura della micro-voce
                                      // ricompariva. Se il server non l'ha cancellato,
                                      // l'operatore deve saperlo adesso.
                                      console.error('Eliminazione documento non riuscita:', err);
                                      toast.errore(
                                        `Eliminazione non riuscita: ${err?.message || 'errore imprevisto'}. ` +
                                        'Il documento è ancora archiviato sul server e resta visibile.'
                                      );
                                      return;
                                    }
                                  }
                                  const nextDocs = documents.filter(doc => doc.id !== d.id);
                                  persistDocuments(nextDocs);
                                }
                              }}
                              style={{ background: 'var(--card2)', border: '1px solid var(--border)', color: 'var(--red)', padding: '5px 8px', borderRadius: 6, fontSize: 11, cursor: 'pointer', fontWeight: 600 }}
                            >
                              🗑 Elimina
                            </button>
                          )}

                          {/* §WF-DOC — stato terminale: il documento è sottoscritto dal cliente.
                              Restano solo lettura e download; per rilavorarlo serve lo sblocco
                              dell'admin dello studio, che ne registra la motivazione. */}
                          {st === 'firmato' && (
                            isAdminStudio() ? (
                              <>
                                <button
                                  type="button"
                                  onClick={() => handleSbloccaDocumento(d.id, d.nome)}
                                  style={{ background: 'var(--pill-red-bg)', border: '1px solid var(--pill-red-bd)', color: 'var(--pill-red-fg)', padding: '5px 10px', borderRadius: 6, fontSize: 10.5, fontWeight: 700, cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 4 }}
                                  title="Riapri in bozza questo documento firmato: la motivazione viene registrata nell'audit e il cliente ne viene informato"
                                >
                                  🔓 Sblocca per modifiche (admin)
                                </button>
                                {/* Punto 3 piano gap — alternativa alla cancellazione vietata:
                                    l'admin toglie il documento firmato dalle liste operative,
                                    file e sigillo restano conservati nello storico. */}
                                {effProgettoId && !d.id.startsWith('d-') && (
                                  <button
                                    type="button"
                                    onClick={async () => {
                                      if (!(await confirm({
                                        titolo: `Il documento "${d.nome}" è firmato dal cliente: non può essere eliminato.`,
                                        messaggio: 'Vuoi archiviarlo? Scomparirà dalle liste operative ma il file e la firma restano conservati nello storico.',
                                        confermaLabel: 'Archivia',
                                      }))) return;
                                      try {
                                        await archiviaDocumentoApi(d.id);
                                        const nextDocs = documents.filter(doc => doc.id !== d.id);
                                        persistDocuments(nextDocs);
                                      } catch (err: any) {
                                        console.error('Archiviazione documento non riuscita:', err);
                                        toast.errore(
                                          `Archiviazione non riuscita: ${err?.message || 'errore imprevisto'}. ` +
                                          'Il documento è ancora presente sul server.'
                                        );
                                      }
                                    }}
                                    style={{ background: 'var(--pill-indigo-bg)', border: '1px solid var(--pill-indigo-bd)', color: 'var(--pill-indigo-fg)', padding: '5px 10px', borderRadius: 6, fontSize: 10.5, fontWeight: 700, cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 4 }}
                                    title="Nascondi questo documento firmato dalle liste operative: il file e la firma restano conservati nello storico"
                                  >
                                    🗄 Archivia
                                  </button>
                                )}
                              </>
                            ) : (
                              <span
                                style={{ fontSize: 10.5, color: 'var(--muted)', fontStyle: 'italic', padding: '5px 8px' }}
                                title="Solo l'amministratore dello studio può riaprire un documento firmato"
                              >
                                🔒 Bloccato dalla firma del cliente — sblocco riservato all'admin
                              </span>
                            )
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>

            {/* Caricamento Documento Reale dal Disco → DB */}
            <div style={{ background: 'var(--card2)', border: '1px solid var(--border)', borderRadius: 12, padding: 14, display: 'flex', flexDirection: 'column', gap: 10 }}>
              <div style={{ fontSize: 11.5, fontWeight: 700, color: 'var(--text)' }}>
                📎 Carica Nuovo Documento dal Computer nel Fascicolo Progetto:
              </div>
              <div style={{ fontSize: 10.5, color: 'var(--muted)' }}>
                💡 Il documento viene salvato in <strong>Bozza Interna</strong>: sarai tu a cliccare <strong>"🚀 Pubblica al Cliente"</strong> quando è pronto per la firma.
              </div>
              {!effProgettoId && (
                <div style={{ fontSize: 10.5, color: 'var(--amber)', background: '#2d1a0530', border: '1px solid var(--pill-amber-bg)', borderRadius: 6, padding: '6px 10px' }}>
                  ⚠️ Progetto non ancora a database: il documento verrà salvato solo localmente e non sarà visibile al cliente.
                </div>
              )}
              <label
                style={{
                  display: 'flex', alignItems: 'center', gap: 10, cursor: uploadingDoc ? 'not-allowed' : 'pointer',
                  background: 'var(--card)', border: '1.5px dashed var(--border)', borderRadius: 8, padding: '10px 14px',
                  opacity: uploadingDoc ? 0.6 : 1,
                }}
              >
                <span style={{ fontSize: 20 }}>📁</span>
                <span style={{ fontSize: 11.5, color: 'var(--muted)' }}>
                  {uploadingDoc ? '⏳ Caricamento in corso...' : 'Clicca per selezionare un file (PDF, DOCX, JPG, PNG…)'}
                </span>
                <input
                  type="file"
                  accept=".pdf,.doc,.docx,.jpg,.jpeg,.png,.xlsx,.xls,.txt,.p7m,.xml"
                  style={{ display: 'none' }}
                  disabled={uploadingDoc}
                  onChange={handleFileUploadPassaggio}
                />
              </label>
            </div>

            {/* Modal Firma Studio */}
            {docPerFirmaStudio && (
              <FirmaStudioModal
                doc={{
                  id: docPerFirmaStudio.id,
                  tipo: 'compilato',
                  fileUrl: docPerFirmaStudio.fileUrl || '',
                  versione: docPerFirmaStudio.versione || 1,
                  createdAt: docPerFirmaStudio.dataCaricamento || '',
                  categoriaDoc: null,
                  statoScansione: 'pulito',
                  dataScadenzaDoc: null,
                  progettoId: effProgettoId || null,
                  microvoceProgettoId: null,
                  firmato: docPerFirmaStudio.firmato,
                  firmatoDaStudio: docPerFirmaStudio.firmatoDaStudio,
                  firmatoDaCliente: docPerFirmaStudio.firmatoDaCliente,
                  firmaStudio: docPerFirmaStudio.firmaStudio,
                  firma: docPerFirmaStudio.firma as any,
                }}
                onClose={() => setDocPerFirmaStudio(null)}
                onSigned={(updated) => {
                  setDocPerFirmaStudio(null);
                  if (updated) {
                    persistDocuments(
                      documents.map((x) =>
                        x.id === updated.id
                          ? {
                              ...x,
                              firmato: true,
                              firmatoDaStudio: true,
                              firmaStudio: updated.firmaStudio,
                              fileFirmatoUrl: updated.fileFirmatoUrl || x.fileFirmatoUrl,
                            }
                          : x
                      )
                    );
                  }
                }}
              />
            )}
          </div>
  );
}
