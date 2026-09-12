import { urlFileArchivio } from '../../api/client';
import type { DocumentoPortale } from '../../api/client';
import { dataOraLeggibile } from './format';

export interface DocumentViewerModalProps {
  selectedViewerDoc: any;
  clientName: string;
  clienteId?: string;
  otpLoading: boolean;
  setSelectedViewerDoc: (doc: any | null) => void;
  setModificaDocTarget: (doc: DocumentoPortale | null) => void;
  setModificaDocTesto: (testo: string) => void;
  setSuccessSealModal: (valore: any) => void;
  scaricaDocumentoPortaleApi: (documentoId: string, formato: 'pdf' | 'docx' | 'firmato', clienteId?: string) => Promise<{ ok: boolean } | null>;
  avviaFirmaDocumento: (doc: DocumentoPortale) => Promise<void>;
}

export function DocumentViewerModal({
  selectedViewerDoc,
  clientName,
  clienteId,
  otpLoading,
  setSelectedViewerDoc,
  setModificaDocTarget,
  setModificaDocTesto,
  setSuccessSealModal,
  scaricaDocumentoPortaleApi,
  avviaFirmaDocumento,
}: DocumentViewerModalProps) {
  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,.85)', backdropFilter: 'blur(4px)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 10000, padding: 20 }}>
      <div style={{ background: 'var(--sidebar)', border: '1px solid var(--border)', borderRadius: 16, width: '100%', maxWidth: 880, maxHeight: '90vh', display: 'flex', flexDirection: 'column', overflow: 'hidden', boxShadow: '0 20px 60px rgba(0,0,0,.6)' }}>
        {/* Top Modal Bar */}
        <div style={{ padding: '16px 20px', borderBottom: '1px solid var(--border)', display: 'flex', justifyContent: 'space-between', alignItems: 'center', background: 'var(--card)' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <span style={{ fontSize: 22 }}>📄</span>
            <div>
              <h3 style={{ margin: 0, fontSize: 15, fontWeight: 700 }}>{selectedViewerDoc.titolo || selectedViewerDoc.nome}</h3>
              <div style={{ fontSize: 11, color: 'var(--muted)', marginTop: 2 }}>
                {selectedViewerDoc.nome} · Cliente: <strong>{clientName}</strong> · Categoria: {selectedViewerDoc.categoria}
              </div>
            </div>
          </div>
          <button
            onClick={() => setSelectedViewerDoc(null)}
            style={{ background: 'transparent', border: 'none', color: 'var(--muted)', fontSize: 20, cursor: 'pointer', padding: '4px 8px' }}
          >
            ✕
          </button>
        </div>

        {/* Il file dell'archivio, mostrato per quello che è.
            Se firmato, mostra la copia sottoscritta con la firma incastonata. */}
        <div style={{ flex: 1, overflow: 'hidden', padding: 16, background: '#0f172a', display: 'flex', justifyContent: 'center' }}>
          {(() => {
            const url = urlFileArchivio(selectedViewerDoc.fileFirmatoUrl || selectedViewerDoc.filePdfUrl || selectedViewerDoc.fileUrl);

            if (!url) {
              return (
                <div style={{ alignSelf: 'center', textAlign: 'center', color: 'var(--muted)', fontSize: 12.5, maxWidth: 460, lineHeight: 1.7 }}>
                  A questo documento non è allegato nessun file.<br />
                  Se ti è stato chiesto di firmarlo, scrivilo allo studio dalla scheda Contatti: senza il file
                  la firma non può essere apposta.
                </div>
              );
            }

            return (
              <iframe
                src={url}
                title={selectedViewerDoc.nome}
                style={{ width: '100%', height: '100%', minHeight: 480, border: 'none', borderRadius: 8, background: '#ffffff' }}
              />
            );
          })()}
        </div>

        {/* Bottom Modal Actions */}
        <div style={{ padding: '14px 20px', borderTop: '1px solid var(--border)', display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 10, background: 'var(--card)' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            {urlFileArchivio(selectedViewerDoc.fileFirmatoUrl || selectedViewerDoc.filePdfUrl || selectedViewerDoc.fileUrl) && (
              <>
                <button
                  type="button"
                  onClick={() => scaricaDocumentoPortaleApi(selectedViewerDoc.id, selectedViewerDoc.firmato ? 'firmato' : 'pdf', clienteId)}
                  style={{ background: selectedViewerDoc.firmato ? '#064e3b' : '#1a1f3d', border: selectedViewerDoc.firmato ? '1px solid #10b981' : '1px solid #4338ca', color: selectedViewerDoc.firmato ? '#6ee7b7' : '#c7d2fe', padding: '8px 14px', borderRadius: 8, fontSize: 11, fontWeight: 700, cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 6 }}
                  title={selectedViewerDoc.firmato ? "Scarica l'atto sottoscritto con la firma del cliente" : "Scarica il PDF master generato dal motore"}
                >
                  {selectedViewerDoc.firmato ? '📥 Scarica Atto Firmato (PDF)' : '📥 Scarica PDF A4'}
                </button>
                {selectedViewerDoc.fileDocxUrl && (
                  <button
                    type="button"
                    onClick={() => scaricaDocumentoPortaleApi(selectedViewerDoc.id, 'docx', clienteId)}
                    style={{ background: '#1e1b4b', border: '1px solid #3b82f6', color: '#93c5fd', padding: '8px 14px', borderRadius: 8, fontSize: 11, fontWeight: 700, cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 6 }}
                    title="Scarica la copia Word (.docx) generata dal motore server-side"
                  >
                    📝 Scarica Word (.docx)
                  </button>
                )}
              </>
            )}

            {/* Pulsante Richiedi Modifiche integrato nel visualizzatore.
                Il verbale di firma (punto 2 piano gap) non accetta revisioni. */}
            {!selectedViewerDoc.firmato && selectedViewerDoc.tipo !== 'verbale_firma' && (
              <button
                type="button"
                onClick={() => {
                  setModificaDocTarget(selectedViewerDoc);
                  setModificaDocTesto('');
                }}
                style={{ background: '#27272a', border: '1px solid #52525b', color: '#fbbf24', padding: '8px 16px', borderRadius: 8, fontSize: 11.5, fontWeight: 700, cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 6 }}
                title="Invia note o chiedi modifiche allo studio prima di firmare"
              >
                📝 Richiedi Modifiche
              </button>
            )}
          </div>

          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <button
              type="button"
              onClick={() => setSelectedViewerDoc(null)}
              style={{ background: 'transparent', border: '1px solid var(--border)', color: 'var(--muted)', padding: '8px 16px', borderRadius: 8, fontSize: 12, cursor: 'pointer' }}
            >
              Chiudi Lettura
            </button>

            {selectedViewerDoc.firmato ? (
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <div style={{ background: '#0d2d22', border: '1px solid #1a5c3c', color: '#34d399', padding: '8px 16px', borderRadius: 8, fontSize: 12, fontWeight: 700 }}>
                  ✓ Documento già sottoscritto{selectedViewerDoc.dataFirma ? ` il ${dataOraLeggibile(selectedViewerDoc.dataFirma)}` : ''}
                </div>
                {/* Fix firma — l'atto sottoscritto, distinto dal PDF master: la rotta
                    formato=firmato serve il file firmato caricato oppure la copia con la
                    firma incastonata. Escluso il verbale (attesta, non è l'atto) e la
                    copia già firmata (il suo PDF È l'atto firmato). */}
                {selectedViewerDoc.tipo !== 'verbale_firma' && selectedViewerDoc.tipo !== 'firmato' && (
                  <button
                    type="button"
                    onClick={() => scaricaDocumentoPortaleApi(selectedViewerDoc.id, 'firmato', clienteId)}
                    style={{ background: '#059669', color: '#fff', border: 'none', padding: '8px 14px', borderRadius: 8, fontSize: 11, fontWeight: 700, cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 4 }}
                    title="Scarica l'atto come sottoscritto (file firmato caricato oppure copia con la firma incastonata), distinto dal PDF master e dalla ricevuta di firma"
                  >
                    ✍️ Atto firmato
                  </button>
                )}
                <button
                  type="button"
                  onClick={() => {
                    setSuccessSealModal({
                      // Stessa regola: niente evidenze inventate dal frontend. Ciò che il
                      // sigillo del server non ha inciso resta "non registrato", e il file
                      // offerto dalla ricevuta è l'atto sottoscritto (fileFirmatoUrl), non
                      // le master: il cliente scarica ciò che ha firmato, non la bozza.
                      signatureId: selectedViewerDoc.signatureId || '— non registrato —',
                      signerName: selectedViewerDoc.firmatarioNome || clientName,
                      documentoTitolo: selectedViewerDoc.titolo || selectedViewerDoc.nome,
                      documentoHash: selectedViewerDoc.documentoHash || '',
                      timestampIso: selectedViewerDoc.dataFirma || '',
                      canaleVerificato: selectedViewerDoc.canaleVerificato || '— non registrato —',
                      ipAddress: selectedViewerDoc.ipAddress || '',
                      standard: selectedViewerDoc.standard || null,
                      firmaGrafometricaPng: selectedViewerDoc.firmaGrafometricaPng,
                      fileUrl: selectedViewerDoc.fileFirmatoUrl,
                      documentoId: selectedViewerDoc.id,
                      fileDocxUrl: selectedViewerDoc.fileDocxUrl,
                      clienteId: clienteId,
                    });
                  }}
                  style={{ background: '#1e1b4b', border: '1px solid #6366f1', color: '#c7d2fe', padding: '8px 14px', borderRadius: 8, fontSize: 11, fontWeight: 700, cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 4 }}
                >
                  📜 Ricevuta di firma
                </button>
              </div>
            ) : selectedViewerDoc.tipo === 'verbale_firma' ? (
              /* Punto 2 piano gap — il verbale non si firma: attesta una firma già apposta. */
              <div style={{ background: '#1e1b4b', border: '1px solid #4338ca', color: '#a5b4fc', padding: '8px 16px', borderRadius: 8, fontSize: 11.5, fontWeight: 700, display: 'flex', alignItems: 'center', gap: 6 }}>
                📜 Atto certificativo · si consulta e si scarica
              </div>
            ) : (
              <button
                type="button"
                disabled={!selectedViewerDoc.richiedeFirma || otpLoading}
                onClick={() => avviaFirmaDocumento(selectedViewerDoc)}
                style={{ background: selectedViewerDoc.richiedeFirma ? 'var(--indigo)' : 'var(--card)', color: selectedViewerDoc.richiedeFirma ? '#fff' : 'var(--muted)', border: 'none', padding: '8px 22px', borderRadius: 8, fontSize: 12, fontWeight: 700, cursor: selectedViewerDoc.richiedeFirma && !otpLoading ? 'pointer' : 'default', boxShadow: selectedViewerDoc.richiedeFirma ? '0 4px 14px rgba(99,102,241,.35)' : 'none', display: 'flex', alignItems: 'center', gap: 6 }}
              >
                {otpLoading ? 'Invio il codice…' : '✍️ Ho letto: ricevi il codice e firma'}
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
