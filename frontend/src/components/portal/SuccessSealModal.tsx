import { useState } from 'react';
import { livelloDaStandard, SOTTOTITOLO_RICEVUTA, NOTA_LEGALE_RICEVUTA } from './livelloFirma';
import { Modal } from '../ui/Modal';
import { scaricaMarcaTemporaleApi } from '../../api/firma';

export interface SuccessSealModalProps {
  successSealModal: any;
  clientName: string;
  clienteId?: string;
  setSuccessSealModal: (valore: any) => void;
  scaricaDocumentoClient: (fileUrl?: string | null, nomeFile?: string) => Promise<void>;
  scaricaDocumentoPortaleApi: (documentoId: string, formato: 'pdf' | 'docx' | 'firmato', clienteId?: string) => Promise<{ ok: boolean } | null>;
}

export function SuccessSealModal({
  successSealModal,
  clientName,
  clienteId,
  setSuccessSealModal,
  scaricaDocumentoClient,
  scaricaDocumentoPortaleApi,
}: SuccessSealModalProps) {
  // Il livello si deriva dallo standard inciso dal server nel sigillo: copre il
  // flusso OTP, la firma con file (FEQ) e la ricevuta riaperta dai documenti.
  const livello = livelloDaStandard(successSealModal.standard);
  const marca = successSealModal.marcaTemporale;
  const [scaricandoMarca, setScaricandoMarca] = useState(false);
  const [erroreMarca, setErroreMarca] = useState<string | null>(null);

  /**
   * Il token arriva in base64 perché è DER binario. Il file che si scarica è il token
   * RFC 3161 vero — il TimeStampToken, non la risposta che lo conteneva — e si verifica con
   * `openssl ts -verify -token_in -digest <impronta> -in <file>.tsr -CAfile <CA della TSA>`.
   */
  async function scaricaMarcaTemporale() {
    if (!marca?.ok || !successSealModal.id) return;
    setScaricandoMarca(true);
    setErroreMarca(null);
    try {
      const esito = await scaricaMarcaTemporaleApi(successSealModal.id);
      const byte = Uint8Array.from(atob(esito.tokenBase64), (c) => c.charCodeAt(0));
      const blob = new Blob([byte], { type: 'application/timestamp-reply' });
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      const nomeBase = (successSealModal.documentoTitolo || 'Documento_Firmato').replace(/[^a-zA-Z0-9_-]/g, '_');
      link.download = `${nomeBase}_${successSealModal.signatureId}.tsr`;
      link.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch (err) {
      setErroreMarca(err instanceof Error ? err.message : 'Download della marca temporale non riuscito.');
    } finally {
      setScaricandoMarca(false);
    }
  }

  return (
    <Modal onClose={() => setSuccessSealModal(null)} zIndex={12000} overlayBackground="rgba(0,0,0,0.85)" dirty={false} labelledBy="success-seal-titolo">
      <div style={{ background: 'var(--sidebar)', border: '1.5px solid var(--green)', borderRadius: 20, width: '100%', maxWidth: 580, maxHeight: '90vh', overflowY: 'auto', display: 'flex', flexDirection: 'column', boxShadow: '0 25px 70px rgba(16,185,129,0.25)' }}>
        {/* Header Sigillo */}
        <div style={{ background: 'linear-gradient(135deg, var(--pill-green-bg) 0%, var(--pill-green-bg) 100%)', padding: '20px 24px', borderBottom: '1px solid var(--green)', display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
            <div style={{ width: 44, height: 44, borderRadius: 12, background: 'var(--green)', color: 'var(--pill-green-bg)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 22, fontWeight: 900, boxShadow: '0 4px 14px rgba(16,185,129,0.4)' }}>
              ✓
            </div>
            <div>
              <div id="success-seal-titolo" style={{ fontSize: 16, fontWeight: 800, color: 'var(--pill-green-fg)' }}>
                Documento Sottoscritto con Successo
              </div>
              <div style={{ fontSize: 11, color: 'var(--pill-green-fg)', fontWeight: 600, marginTop: 2 }}>
                {SOTTOTITOLO_RICEVUTA[livello]}
              </div>
            </div>
          </div>
          <button
            type="button"
            onClick={() => setSuccessSealModal(null)}
            aria-label="Chiudi"
            style={{ background: 'transparent', border: 'none', color: 'var(--pill-green-fg)', fontSize: 18, cursor: 'pointer', padding: 4 }}
          >
            ✕
          </button>
        </div>

        {/* Body Sigillo Certificato */}
        <div style={{ padding: '24px', display: 'flex', flexDirection: 'column', gap: 16 }}>
          <div style={{ background: 'var(--card)', border: '1px solid var(--border)', borderRadius: 14, padding: 16, display: 'flex', flexDirection: 'column', gap: 10 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', borderBottom: '1px solid var(--border)', paddingBottom: 8 }}>
              <span style={{ fontSize: 11, color: 'var(--muted)', fontWeight: 600 }}>Atto Sottoscritto:</span>
              <span style={{ fontSize: 12.5, fontWeight: 800, color: 'var(--text)', textAlign: 'right', maxWidth: '65%', wordBreak: 'break-word' }}>
                📄 {successSealModal.documentoTitolo || 'Atto Studio'}
              </span>
            </div>

            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', borderBottom: '1px solid var(--border)', paddingBottom: 8 }}>
              <span style={{ fontSize: 11, color: 'var(--muted)', fontWeight: 600 }}>Firmatario:</span>
              <span style={{ fontSize: 12, fontWeight: 700, color: 'var(--pill-indigo-fg)' }}>
                👤 {successSealModal.signerName || clientName}
              </span>
            </div>

            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', borderBottom: '1px solid var(--border)', paddingBottom: 8 }}>
              <span style={{ fontSize: 11, color: 'var(--muted)', fontWeight: 600 }}>Data e Ora Registrazione (UTC):</span>
              <span style={{ fontSize: 11.5, fontWeight: 700, color: 'var(--text)' }}>
                📅 {successSealModal.timestampIso ? new Date(successSealModal.timestampIso).toLocaleString('it-IT', { dateStyle: 'full', timeStyle: 'medium' }) : 'Data e ora non registrate'}
              </span>
            </div>

            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', borderBottom: '1px solid var(--border)', paddingBottom: 8 }}>
              <span style={{ fontSize: 11, color: 'var(--muted)', fontWeight: 600 }}>Signature ID / Sigillo Univoco:</span>
              <span style={{ fontSize: 11.5, fontFamily: 'monospace', fontWeight: 800, color: 'var(--green)', background: 'var(--pill-green-bg)', padding: '2px 8px', borderRadius: 6 }}>
                🔑 {successSealModal.signatureId}
              </span>
            </div>

            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', borderBottom: '1px solid var(--border)', paddingBottom: 8 }}>
              <span style={{ fontSize: 11, color: 'var(--muted)', fontWeight: 600 }}>Canale Autenticato:</span>
              <span style={{ fontSize: 11.5, fontWeight: 600, color: 'var(--text)' }}>
                {successSealModal.canaleVerificato || '— non registrato —'}
              </span>
            </div>

            {successSealModal.ipAddress && (
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', borderBottom: '1px solid var(--border)', paddingBottom: 8 }}>
                <span style={{ fontSize: 11, color: 'var(--muted)', fontWeight: 600 }}>Indirizzo IP Connessione:</span>
                <span style={{ fontSize: 11, fontFamily: 'monospace', color: 'var(--muted)' }}>
                  🌐 {successSealModal.ipAddress}
                </span>
              </div>
            )}

            {marca && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 4, borderBottom: '1px solid var(--border)', paddingBottom: 8 }}>
                <span style={{ fontSize: 11, color: 'var(--muted)', fontWeight: 600 }}>
                  Marca Temporale RFC 3161:
                </span>
                {marca.ok ? (
                  <>
                    <span style={{ fontSize: 11.5, fontWeight: 700, color: 'var(--text)' }}>
                      🕒 {marca.genTime ? new Date(marca.genTime).toLocaleString('it-IT', { dateStyle: 'full', timeStyle: 'medium' }) : 'ora non registrata'}
                      {marca.tsa ? ` · ${marca.tsa}` : ''}
                    </span>
                    {marca.serialNumber && (
                      <span style={{ fontSize: 10, fontFamily: 'monospace', color: 'var(--muted)', wordBreak: 'break-all' }}>
                        Seriale: {marca.serialNumber}{marca.policy ? ` · Policy ${marca.policy}` : ''}
                      </span>
                    )}
                    <span style={{ fontSize: 10, color: 'var(--muted)' }}>
                      Il token è conservato con la firma: prova che il sigillo esisteva all'ora attestata.
                    </span>
                    {marca.avviso && (
                      <span style={{ fontSize: 10, color: 'var(--muted)' }}>{marca.avviso}</span>
                    )}
                  </>
                ) : (
                  <span style={{ fontSize: 11, color: 'var(--amber, #b45309)' }}>
                    ⚠️ Non ottenuta{marca.tsa ? ` dalla TSA ${marca.tsa}` : ''}
                    {marca.errore ? `: ${marca.errore}` : ''}. La firma resta valida.
                  </span>
                )}
                {erroreMarca && (
                  <span style={{ fontSize: 10, color: 'var(--red, #b91c1c)' }}>{erroreMarca}</span>
                )}
              </div>
            )}

            {successSealModal.documentoHash && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                <span style={{ fontSize: 10.5, color: 'var(--muted)', fontWeight: 600 }}>Impronta Crittografica SHA-256 (Integrità Documento):</span>
                <span style={{ fontSize: 10, fontFamily: 'monospace', color: 'var(--muted)', background: 'var(--surface-2)', padding: '6px 8px', borderRadius: 6, wordBreak: 'break-all' }}>
                  {successSealModal.documentoHash}
                </span>
              </div>
            )}

            {/* Se è stata apposta la firma grafometrica visiva */}
            {successSealModal.firmaGrafometricaPng && (
              <div data-theme="light" style={{ marginTop: 6, display: 'flex', flexDirection: 'column', gap: 6, background: '#ffffff', padding: 12, borderRadius: 8, border: '1px solid var(--pill-slate-fg)' }}>
                <span style={{ fontSize: 10, fontWeight: 800, color: 'var(--pill-indigo-fg)', textTransform: 'uppercase' }}>
                  Tratto Grafometrico Sottoscritto:
                </span>
                <img
                  src={successSealModal.firmaGrafometricaPng}
                  alt="Firma Grafometrica"
                  style={{ height: 48, objectFit: 'contain', alignSelf: 'flex-start' }}
                />
              </div>
            )}
          </div>

          {/* Informazione Legale */}
          <div style={{ fontSize: 10.5, color: 'var(--muted)', lineHeight: 1.4, background: 'rgba(0,0,0,0.2)', padding: 10, borderRadius: 8 }}>
            {NOTA_LEGALE_RICEVUTA[livello]}
          </div>
        </div>

        {/* Footer Azioni */}
        <div style={{ padding: '16px 24px', borderTop: '1px solid var(--border)', background: 'var(--card)', display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 10 }}>
          {successSealModal.fileUrl ? (
            <div style={{ display: 'flex', gap: 8 }}>
              <button
                type="button"
                onClick={async () => {
                  // Fix firma — l'atto sottoscritto si scarica dalla rotta del portale quando
                  // il documento sta nel fascicolo: il server restituisce il nome file vero
                  // con l'estensione giusta (.p7m/.docx compresi). Il download diretto resta
                  // per le firme orfane (id "firma-…" che la rotta non può risolvere) e come
                  // ripiego se la rotta non risponde; in quel caso l'estensione non si dà per
                  // scontata: si deduce dal fileUrl, se c'è, altrimenti resta il titolo.
                  const idRotta = typeof successSealModal.documentoId === 'string' && !successSealModal.documentoId.startsWith('firma-');
                  if (idRotta) {
                    const esito = await scaricaDocumentoPortaleApi(successSealModal.documentoId, 'firmato', clienteId || successSealModal.clienteId);
                    if (esito?.ok) return;
                  }
                  const estensione = (successSealModal.fileUrl.split('?')[0].match(/\.([a-zA-Z0-9]+)$/) || [])[1]?.toLowerCase() || '';
                  const nomeBase = (successSealModal.documentoTitolo || 'Documento_Firmato').replace(/[^a-zA-Z0-9_-]/g, '_');
                  await scaricaDocumentoClient(successSealModal.fileUrl, estensione ? `${nomeBase}.${estensione}` : `${nomeBase}_firmato`);
                }}
                style={{ background: 'var(--green)', color: '#fff', border: 'none', padding: '9px 16px', borderRadius: 10, fontSize: 11.5, fontWeight: 700, cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 6 }}
              >
                ✍️ Atto firmato
              </button>
              {/* §Punto-1 — la copia Word ha senso solo se esiste un .docx reale generato dal
                  motore: prima qui veniva fabbricato un .doc stub con testo inventato. */}
              {successSealModal.documentoId && successSealModal.fileDocxUrl && (
                <button
                  type="button"
                  onClick={() => scaricaDocumentoPortaleApi(successSealModal.documentoId, 'docx', clienteId || successSealModal.clienteId)}
                  style={{ background: 'var(--pill-indigo-bg)', border: '1px solid var(--indigo-l)', color: 'var(--pill-blue-fg)', padding: '9px 16px', borderRadius: 10, fontSize: 11.5, fontWeight: 700, cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 6 }}
                >
                  📝 Copia Word (.docx)
                </button>
              )}
            </div>
          ) : <div />}

          {marca?.ok && successSealModal.id && (
            <button
              type="button"
              onClick={scaricaMarcaTemporale}
              disabled={scaricandoMarca}
              title="Token RFC 3161 (DER): si verifica con openssl ts -verify -token_in"
              style={{ background: 'var(--surface-2)', border: '1px solid var(--border)', color: 'var(--text)', padding: '9px 16px', borderRadius: 10, fontSize: 11.5, fontWeight: 700, cursor: scaricandoMarca ? 'wait' : 'pointer', display: 'flex', alignItems: 'center', gap: 6 }}
            >
              🕒 {scaricandoMarca ? 'Preparo il token…' : 'Marca temporale (.tsr)'}
            </button>
          )}

          <button
            type="button"
            onClick={() => setSuccessSealModal(null)}
            style={{ background: 'var(--indigo)', color: '#fff', border: 'none', padding: '9px 22px', borderRadius: 10, fontSize: 12, fontWeight: 700, cursor: 'pointer' }}
          >
            ✓ Chiudi e Continua
          </button>
        </div>
      </div>
    </Modal>
  );
}
