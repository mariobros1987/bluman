import { urlFileArchivio } from '../../api/client';
import type { DocumentoPortale } from '../../api/client';
import type { BersaglioFirma } from './types';
import { dataOraLeggibile } from './format';
import { docBoxStyle } from './styles';

export interface TabDocumentiProps {
  portalDocs: DocumentoPortale[];
  portalDocsErrore: string | null;
  portalDocsCaricamento: boolean;
  caricaDocumenti: (clienteIdSessione?: string | null) => Promise<void>;
  clientObj: any;
  storicoVersioniAperto: string | null;
  setStoricoVersioniAperto: (docId: string | null) => void;
  setSelectedViewerDoc: (doc: any | null) => void;
  scaricaDocumentoPortaleApi: (documentoId: string, formato: 'pdf' | 'docx') => Promise<{ ok: boolean } | null>;
  setSuccessSealModal: (valore: any) => void;
  clientName: string;
  setModificaDocTarget: (doc: DocumentoPortale | null) => void;
  setModificaDocTesto: (testo: string) => void;
  otpLoading: boolean;
  avviaFirmaDocumento: (doc: DocumentoPortale) => Promise<void>;
  caricamentoFirmato: boolean;
  leggiFileFirmato: (file: File) => Promise<void>;
  setBersaglioFirma: (bersaglio: BersaglioFirma) => void;
  setModalitaFirma: (modalita: 'otp' | 'manuale_scansionata' | 'qualificata_esterna') => void;
  setDocumentoDaCaricare: (doc: DocumentoPortale | null) => void;
}

export function TabDocumenti({
  portalDocs,
  portalDocsErrore,
  portalDocsCaricamento,
  caricaDocumenti,
  clientObj,
  storicoVersioniAperto,
  setStoricoVersioniAperto,
  setSelectedViewerDoc,
  scaricaDocumentoPortaleApi,
  setSuccessSealModal,
  clientName,
  setModificaDocTarget,
  setModificaDocTesto,
  otpLoading,
  avviaFirmaDocumento,
  caricamentoFirmato,
  leggiFileFirmato,
  setBersaglioFirma,
  setModalitaFirma,
  setDocumentoDaCaricare,
}: TabDocumentiProps) {
  return (
    <div style={docBoxStyle}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 12, marginBottom: 18 }}>
        <div>
          <div style={{ fontSize: 15, fontWeight: 700, marginBottom: 4 }}>📎 Vault Documenti Legali e Modelli In Incarico</div>
          <div style={{ fontSize: 11, color: 'var(--muted)' }}>
            Visualizza, scarica, firma con <strong>firma elettronica semplice</strong> (lettura, codice sul canale che scegli, firma grafometrica) oppure <strong>ricarica il PDF firmato a mano</strong>. Le firme sono registrate a database e visibili allo studio.
          </div>
        </div>
        <button
          type="button"
          onClick={() => caricaDocumenti(clientObj?.id)}
          disabled={portalDocsCaricamento}
          style={{ background: 'transparent', border: '1px solid var(--border)', color: 'var(--muted)', padding: '7px 14px', borderRadius: 8, fontSize: 11, cursor: portalDocsCaricamento ? 'default' : 'pointer' }}
        >
          {portalDocsCaricamento ? 'Aggiorno…' : '↻ Aggiorna elenco'}
        </button>
      </div>

      {/* Un errore di lettura non si traveste da fascicolo vuoto. */}
      {portalDocsErrore && (
        <div style={{ background: '#3b1219', border: '1px solid #7f1d1d', color: '#fecaca', borderRadius: 12, padding: 14, fontSize: 12, marginBottom: 14 }}>
          <strong>Non riesco a leggere i tuoi documenti.</strong> {portalDocsErrore}
          <div style={{ marginTop: 6, color: '#fca5a5', fontSize: 11 }}>
            Non significa che il fascicolo sia vuoto: riprova con «Aggiorna elenco» o avvisa lo studio.
          </div>
        </div>
      )}

      {!portalDocsErrore && portalDocs.length === 0 && (
        <div style={{ background: 'var(--card2)', border: '1px dashed var(--border)', borderRadius: 12, padding: 22, textAlign: 'center' }}>
          <div style={{ fontSize: 26, marginBottom: 8 }}>📂</div>
          <div style={{ fontSize: 13, fontWeight: 700, marginBottom: 4 }}>
            {portalDocsCaricamento ? 'Sto leggendo il tuo fascicolo…' : 'Nessun documento nel fascicolo'}
          </div>
          {!portalDocsCaricamento && (
            <div style={{ fontSize: 11.5, color: 'var(--muted)', lineHeight: 1.6 }}>
              Lo studio non ha ancora caricato documenti sulle attività del tuo incarico.
              Quando lo farà li troverai qui, con il testo integrale da leggere prima di firmare.
            </div>
          )}
        </div>
      )}

      <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
        {portalDocs.map((doc) => (
          <div
            key={doc.id}
            style={{
              background: doc.firmato ? '#0d2d22' : 'var(--card2)',
              border: `1px solid ${doc.firmato ? '#1a5c3c' : 'var(--border)'}`,
              borderRadius: 14,
              padding: 16,
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center',
              flexWrap: 'wrap',
              gap: 12,
              transition: 'all .2s ease',
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: 12, flex: 1, minWidth: 260 }}>
              <div style={{ fontSize: 26 }}>{doc.tipo === 'verbale_firma' ? '📜' : doc.firmato ? '🔒' : '📄'}</div>
              <div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                  <span style={{ fontSize: 13.5, fontWeight: 700, color: 'var(--text)' }}>{doc.nome}</span>
                  <span style={{ fontSize: 10, background: 'var(--card)', padding: '2px 6px', borderRadius: 6, color: 'var(--muted)', fontWeight: 600 }}>{doc.categoria}</span>
                  {doc.versione && doc.versione > 1 && (
                    doc.versioniPrecedenti && doc.versioniPrecedenti.length > 0 ? (
                      <button
                        type="button"
                        onClick={() => setStoricoVersioniAperto(storicoVersioniAperto === doc.id ? null : doc.id)}
                        title="Mostra o nascondi le versioni precedenti di questo documento"
                        style={{ fontSize: 10, background: 'var(--card)', padding: '2px 8px', borderRadius: 6, color: '#818cf8', fontWeight: 700, border: '1px solid #4338ca55', cursor: 'pointer' }}
                      >
                        🕘 v{doc.versione} · {doc.versioniPrecedenti.length} precedent{doc.versioniPrecedenti.length === 1 ? 'e' : 'i'}
                      </button>
                    ) : (
                      <span style={{ fontSize: 10, background: 'var(--card)', padding: '2px 6px', borderRadius: 6, color: 'var(--muted)', fontWeight: 600 }}>v{doc.versione}</span>
                    )
                  )}
                </div>
                {/* Da quale attività dell'incarico arriva il documento: il cliente sa a cosa
                    si riferisce senza doverlo chiedere. */}
                {doc.modulo && (
                  <div style={{ fontSize: 10.5, color: 'var(--muted)', marginTop: 3 }}>
                    {doc.modulo}{doc.progetto ? ` · ${doc.progetto}` : ''}
                  </div>
                )}
                <div style={{ fontSize: 10.5, color: doc.firmato ? '#a7f3d0' : 'var(--muted)', marginTop: 3 }}>
                  {doc.firmato
                    ? `✓ Firmato${doc.dataFirma ? ` il ${dataOraLeggibile(doc.dataFirma)}` : ''}${doc.canaleVerificato ? ` · ${doc.canaleVerificato}` : ''}`
                    : doc.tipo === 'verbale_firma'
                      ? '📜 Verbale di firma · atto certificativo della sottoscrizione, generato automaticamente'
                      : doc.statoScansione === 'in_corso'
                        ? '⏳ Controllo antivirus in corso: disponibile a breve'
                        : doc.statoScansione === 'infetto'
                          ? '⛔ Il controllo antivirus ha bloccato questo file: lo studio è stato avvisato'
                          : 'In attesa di lettura e sottoscrizione'}
                </div>
                {doc.documentoNonPiuDisponibile && (
                  <div style={{ fontSize: 10.5, color: '#fbbf24', marginTop: 3 }}>
                    Firma registrata: il file a cui si riferisce non è più nel fascicolo.
                  </div>
                )}
              </div>
            </div>

            <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
              {/* Apertura del documento vero. Prima questo pulsante mostrava un testo legale
                  composto dal portale: il file in archivio non veniva nemmeno aperto. */}
              <button
                type="button"
                disabled={!urlFileArchivio(doc.fileUrl) || !doc.scaricabile}
                title={
                  !doc.fileUrl
                    ? 'Nessun file allegato a questo documento'
                    : !doc.scaricabile
                      ? 'File non disponibile: controllo antivirus non superato o ancora in corso'
                      : undefined
                }
                onClick={() => setSelectedViewerDoc(doc)}
                style={{
                  background: '#1a1f3d',
                  border: '1px solid #4338ca',
                  color: doc.scaricabile && doc.fileUrl ? '#c7d2fe' : '#6b7280',
                  padding: '7px 14px',
                  borderRadius: 8,
                  fontSize: 11,
                  fontWeight: 700,
                  cursor: doc.scaricabile && doc.fileUrl ? 'pointer' : 'not-allowed',
                  display: 'flex',
                  alignItems: 'center',
                  gap: 6
                }}
              >
                👁 Apri il documento
              </button>

              {doc.scaricabile && urlFileArchivio(doc.fileUrl) && (
                <div style={{ display: 'flex', gap: 6 }}>
                  <button
                    type="button"
                    onClick={() => scaricaDocumentoPortaleApi(doc.id, 'pdf')}
                    style={{ background: '#1a1f3d', border: '1px solid #4338ca', color: '#c7d2fe', padding: '6px 10px', borderRadius: 8, fontSize: 11, fontWeight: 700, cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 4 }}
                    title="Scarica il PDF master generato dal motore (lo stesso file su cui è fissata l'impronta di firma)"
                  >
                    📥 PDF
                  </button>
                  {doc.fileDocxUrl && (
                    <button
                      type="button"
                      onClick={() => scaricaDocumentoPortaleApi(doc.id, 'docx')}
                      style={{ background: '#1e1b4b', border: '1px solid #3b82f6', color: '#93c5fd', padding: '6px 10px', borderRadius: 8, fontSize: 11, fontWeight: 700, cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 4 }}
                      title="Scarica la copia Word (.docx) generata dal motore server-side"
                    >
                      📝 Word
                    </button>
                  )}
                </div>
              )}

              {doc.firmato ? (
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <span style={{ background: '#064e3b', border: '1px solid #10b981', color: '#6ee7b7', padding: '5px 12px', borderRadius: 8, fontSize: 11, fontWeight: 800, display: 'flex', alignItems: 'center', gap: 4 }}>
                    <span>🔒</span> FIRMATO{doc.dataFirma ? ` IL ${new Date(doc.dataFirma).toLocaleDateString('it-IT')}` : ''}
                  </span>
                  <button
                    type="button"
                    onClick={() => {
                      setSuccessSealModal({
                        // Il frontend non inventa evidenze legali: ciò che manca dal sigillo
                        // server resta vuoto e la ricevuta lo mostra come "non registrato".
                        signatureId: doc.signatureId || `SIG-${doc.id.slice(0, 8).toUpperCase()}`,
                        signerName: doc.firmatarioNome || clientName,
                        documentoTitolo: doc.titolo || doc.nome,
                        documentoHash: doc.documentoHash || '',
                        timestampIso: doc.dataFirma || '',
                        canaleVerificato: doc.canaleVerificato || 'Verifica codice OTP',
                        ipAddress: doc.ipAddress || '',
                        standard: doc.standard || 'Firma Elettronica Semplice (OTP verificata) · art. 20 CAD',
                        firmaGrafometricaPng: doc.firmaGrafometricaPng,
                        fileUrl: doc.fileUrl,
                        documentoId: doc.id,
                        fileDocxUrl: doc.fileDocxUrl,
                      });
                    }}
                    style={{ background: '#1e1b4b', border: '1px solid #6366f1', color: '#c7d2fe', padding: '6px 12px', borderRadius: 8, fontSize: 11, fontWeight: 700, cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 4 }}
                  >
                    📜 Ricevuta di firma
                  </button>
                </div>
              ) : doc.tipo === 'verbale_firma' ? (
                /* Punto 2 piano gap — il verbale è un atto certificativo generato dal
                    sistema: si legge e si scarica, ma non si firma e non si manda in revisione. */
                <div style={{ fontSize: 11, color: '#a5b4fc', fontWeight: 700, background: '#1e1b4b', border: '1px solid #4338ca', padding: '7px 14px', borderRadius: 8, display: 'flex', alignItems: 'center', gap: 6 }}>
                  📜 Verbale di firma · atto certificativo della sottoscrizione
                </div>
              ) : (
                <>
                  {/* Richiedi Modifiche al documento */}
                  <button
                    type="button"
                    onClick={() => {
                      setModificaDocTarget(doc);
                      setModificaDocTesto('');
                    }}
                    style={{ background: '#27272a', border: '1px solid #52525b', color: '#fbbf24', padding: '7px 14px', borderRadius: 8, fontSize: 11, fontWeight: 700, cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 6 }}
                    title="Invia note o chiedi modifiche allo studio prima di firmare"
                  >
                    📝 Richiedi Modifiche
                  </button>

                  {/* La firma passa dal backend: codice sul canale scelto, impronta calcolata
                      dal server sul file in archivio, sigillo scritto a database. */}
                  <button
                    type="button"
                    disabled={!doc.richiedeFirma || otpLoading}
                    title={doc.richiedeFirma ? undefined : 'Documento non firmabile in questo momento'}
                    onClick={() => avviaFirmaDocumento(doc)}
                    style={{ background: doc.richiedeFirma ? 'var(--indigo)' : 'var(--card)', color: doc.richiedeFirma ? '#fff' : 'var(--muted)', border: 'none', padding: '7px 16px', borderRadius: 8, fontSize: 11, fontWeight: 700, cursor: doc.richiedeFirma && !otpLoading ? 'pointer' : 'default', boxShadow: doc.richiedeFirma ? '0 2px 10px rgba(99,102,241,.3)' : 'none', display: 'flex', alignItems: 'center', gap: 6 }}
                  >
                    ✍️ Firma con codice
                  </button>

                  <label style={{ background: '#1a1f3d', border: '1px solid #2d3260', color: '#818cf8', padding: '6px 14px', borderRadius: 8, fontSize: 11, fontWeight: 600, cursor: 'pointer', display: 'inline-flex', alignItems: 'center', gap: 4 }}>
                    <span>{caricamentoFirmato ? '⏳ Carico…' : '📤 Ricarica Firmato a Mano'}</span>
                    <input
                      type="file"
                      accept=".pdf,.doc,.docx"
                      style={{ display: 'none' }}
                      onChange={async e => {
                        const file = e.target.files?.[0];
                        if (!file) return;
                        await leggiFileFirmato(file);
                        setBersaglioFirma({ ambito: 'documento_vault', titolo: doc.titolo || doc.nome, riferimentoId: doc.id });
                        setModalitaFirma('manuale_scansionata');
                        setDocumentoDaCaricare(doc);
                        e.target.value = '';
                      }}
                    />
                  </label>
                </>
              )}
            </div>

            {/* Storico Richieste di Modifica inviate per questo Documento */}
            {doc.richiesteModifica && doc.richiesteModifica.length > 0 && (
              <div style={{ width: '100%', background: '#18181b', border: '1px solid #3f3f46', borderRadius: 10, padding: 12, marginTop: 10, display: 'flex', flexDirection: 'column', gap: 8 }}>
                <div style={{ fontSize: 11, fontWeight: 700, color: '#fbbf24', display: 'flex', alignItems: 'center', gap: 6 }}>
                  <span>💬 Le tue note e richieste di modifica per questo atto:</span>
                </div>
                {doc.richiesteModifica.map((rm) => (
                  <div key={rm.id} style={{ background: 'var(--card2)', padding: '8px 12px', borderRadius: 8, border: '1px solid var(--border)', fontSize: 11 }}>
                    <div style={{ color: 'var(--text)', fontStyle: 'italic' }}>«{rm.commento}»</div>
                    <div style={{ fontSize: 10, color: 'var(--muted)', marginTop: 4, display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 6 }}>
                      <span>Inviata il {new Date(rm.creatoAt).toLocaleString('it-IT')}</span>
                      <span style={{ fontWeight: 700, color: rm.stato === 'risolta' ? '#34d399' : '#fbbf24' }}>
                        {rm.stato === 'risolta' ? '✓ Risolta dallo studio' : '⏳ In esame dallo studio'}
                      </span>
                    </div>
                    {rm.rispostaStudio && (
                      <div style={{ marginTop: 6, paddingTop: 6, borderTop: '1px dashed var(--border)', color: '#93c5fd', fontSize: 10.5 }}>
                        <strong>Riscontro Advisor:</strong> {rm.rispostaStudio}
                      </div>
                    )}
                  </div>
                ))}
              </div>
            )}

            {/* §WF-DOC — Cronologia delle versioni: il percorso del documento è sempre
                ripercorribile all'indietro, dalla copia attuale fino a quella eventualmente
                già sottoscritta. I dati arrivano dal server (catena documentoPadreId):
                qui non viene inventato niente. */}
            {doc.versioniPrecedenti && doc.versioniPrecedenti.length > 0 && storicoVersioniAperto === doc.id && (
              <div style={{ width: '100%', background: 'var(--card)', border: '1px dashed #4338ca66', borderRadius: 10, padding: 12, marginTop: 10 }}>
                <div style={{ fontSize: 11, fontWeight: 700, color: '#818cf8', marginBottom: 8, display: 'flex', alignItems: 'center', gap: 6 }}>
                  🕘 Cronologia versioni — percorso del documento a ritroso
                </div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                  <div style={{ background: 'var(--card2)', padding: '7px 12px', borderRadius: 8, border: '1px solid var(--border)', fontSize: 11, display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                    <strong style={{ color: 'var(--text)' }}>v{doc.versione}</strong>
                    <span style={{ color: 'var(--muted)' }}>versione attuale{doc.caricatoIl ? ` · caricata il ${dataOraLeggibile(doc.caricatoIl)}` : ''}</span>
                    <span style={{ fontWeight: 700, color: doc.firmato ? '#34d399' : '#93c5fd' }}>
                      {doc.firmato
                        ? `✍️ Firmata${doc.dataFirma ? ` il ${dataOraLeggibile(doc.dataFirma)}` : ''}`
                        : 'In attesa di firma'}
                    </span>
                  </div>
                  {doc.versioniPrecedenti.map((v) => (
                    <div key={v.id} style={{ background: 'transparent', padding: '5px 12px 5px 22px', fontSize: 11, display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap', color: 'var(--muted)' }}>
                      <span style={{ color: '#4338ca' }}>↳</span>
                      <strong style={{ color: 'var(--muted)' }}>v{v.versione}</strong>
                      <span>{v.caricatoIl ? `caricata il ${dataOraLeggibile(v.caricatoIl)}` : 'data di caricamento non disponibile'}</span>
                      {v.firmatoAt ? (
                        <span style={{ fontWeight: 700, color: '#34d399' }}>✍️ Firmata il {dataOraLeggibile(v.firmatoAt)}</span>
                      ) : (
                        <span style={{ color: '#71717a' }}>nessuna firma registrata su questa versione</span>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
