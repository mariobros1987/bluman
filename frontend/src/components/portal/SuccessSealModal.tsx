import { livelloDaStandard, SOTTOTITOLO_RICEVUTA, NOTA_LEGALE_RICEVUTA } from './livelloFirma';

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

  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.85)', backdropFilter: 'blur(6px)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 12000, padding: 16 }}>
      <div style={{ background: 'var(--sidebar)', border: '1.5px solid #10b981', borderRadius: 20, width: '100%', maxWidth: 580, maxHeight: '90vh', overflowY: 'auto', display: 'flex', flexDirection: 'column', boxShadow: '0 25px 70px rgba(16,185,129,0.25)' }}>
        {/* Header Sigillo */}
        <div style={{ background: 'linear-gradient(135deg, #064e3b 0%, #022c22 100%)', padding: '20px 24px', borderBottom: '1px solid #059669', display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
            <div style={{ width: 44, height: 44, borderRadius: 12, background: '#10b981', color: '#064e3b', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 22, fontWeight: 900, boxShadow: '0 4px 14px rgba(16,185,129,0.4)' }}>
              ✓
            </div>
            <div>
              <div style={{ fontSize: 16, fontWeight: 800, color: '#ecfdf5' }}>
                Documento Sottoscritto con Successo
              </div>
              <div style={{ fontSize: 11, color: '#6ee7b7', fontWeight: 600, marginTop: 2 }}>
                {SOTTOTITOLO_RICEVUTA[livello]}
              </div>
            </div>
          </div>
          <button
            type="button"
            onClick={() => setSuccessSealModal(null)}
            style={{ background: 'transparent', border: 'none', color: '#a7f3d0', fontSize: 18, cursor: 'pointer', padding: 4 }}
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
              <span style={{ fontSize: 12, fontWeight: 700, color: '#c7d2fe' }}>
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
              <span style={{ fontSize: 11.5, fontFamily: 'monospace', fontWeight: 800, color: '#34d399', background: '#064e3b', padding: '2px 8px', borderRadius: 6 }}>
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

            {successSealModal.documentoHash && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                <span style={{ fontSize: 10.5, color: 'var(--muted)', fontWeight: 600 }}>Impronta Crittografica SHA-256 (Integrità Documento):</span>
                <span style={{ fontSize: 10, fontFamily: 'monospace', color: '#94a3b8', background: '#090d16', padding: '6px 8px', borderRadius: 6, wordBreak: 'break-all' }}>
                  {successSealModal.documentoHash}
                </span>
              </div>
            )}

            {/* Se è stata apposta la firma grafometrica visiva */}
            {successSealModal.firmaGrafometricaPng && (
              <div style={{ marginTop: 6, display: 'flex', flexDirection: 'column', gap: 6, background: '#ffffff', padding: 12, borderRadius: 8, border: '1px solid #cbd5e1' }}>
                <span style={{ fontSize: 10, fontWeight: 800, color: '#1e1b4b', textTransform: 'uppercase' }}>
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
                style={{ background: '#059669', color: '#fff', border: 'none', padding: '9px 16px', borderRadius: 10, fontSize: 11.5, fontWeight: 700, cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 6 }}
              >
                ✍️ Atto firmato
              </button>
              {/* §Punto-1 — la copia Word ha senso solo se esiste un .docx reale generato dal
                  motore: prima qui veniva fabbricato un .doc stub con testo inventato. */}
              {successSealModal.documentoId && successSealModal.fileDocxUrl && (
                <button
                  type="button"
                  onClick={() => scaricaDocumentoPortaleApi(successSealModal.documentoId, 'docx', clienteId || successSealModal.clienteId)}
                  style={{ background: '#1e1b4b', border: '1px solid #3b82f6', color: '#93c5fd', padding: '9px 16px', borderRadius: 10, fontSize: 11.5, fontWeight: 700, cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 6 }}
                >
                  📝 Copia Word (.docx)
                </button>
              )}
            </div>
          ) : <div />}

          <button
            type="button"
            onClick={() => setSuccessSealModal(null)}
            style={{ background: 'var(--indigo)', color: '#fff', border: 'none', padding: '9px 22px', borderRadius: 10, fontSize: 12, fontWeight: 700, cursor: 'pointer' }}
          >
            ✓ Chiudi e Continua
          </button>
        </div>
      </div>
    </div>
  );
}
