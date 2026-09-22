import type { DocumentoPortale } from '../../api/client';
import type { LivelloFirmaPortale } from './livelloFirma';
import { Modal } from '../ui/Modal';

export interface InvioManualeModalProps {
  documentoDaCaricare: DocumentoPortale;
  fileFirmato: { nome: string; base64: string };
  modalitaFirma: 'otp' | 'manuale_scansionata' | 'qualificata_esterna';
  setModalitaFirma: (modalita: 'otp' | 'manuale_scansionata' | 'qualificata_esterna') => void;
  otpError: string | null;
  setOtpError: (errore: string | null) => void;
  setDocumentoDaCaricare: (doc: DocumentoPortale | null) => void;
  setFileFirmato: (file: { nome: string; base64: string } | null) => void;
  caricamentoFirmato: boolean;
  confermaFirmaConFile: () => Promise<boolean>;
  /**
   * Piano firma §3 — livello che il documento esige. Con 'feq' la sottoscrizione
   * scansionata non è ammessa (il server la respingerebbe con 409): il selettore
   * della modalità resta bloccato su "firma qualificata". Default omesso = ses,
   * modalità liberamente scelta come oggi.
   */
  livelloRichiesto?: LivelloFirmaPortale;
}

export function InvioManualeModal({
  documentoDaCaricare,
  fileFirmato,
  modalitaFirma,
  setModalitaFirma,
  otpError,
  setOtpError,
  setDocumentoDaCaricare,
  setFileFirmato,
  caricamentoFirmato,
  confermaFirmaConFile,
  livelloRichiesto = 'ses',
}: InvioManualeModalProps) {
  const chiudi = () => { setDocumentoDaCaricare(null); setFileFirmato(null); setOtpError(null); };
  return (
    <Modal onClose={chiudi} overlayBackground="rgba(0,0,0,.8)" zIndex={11000} labelledBy="invio-manuale-titolo">
      {(richiediChiusura) => (
      <div style={{ background: 'var(--sidebar)', border: '1px solid var(--border)', borderRadius: 16, padding: 24, width: '100%', maxWidth: 520, display: 'flex', flexDirection: 'column', gap: 16 }}>
        <div>
          <div id="invio-manuale-titolo" style={{ fontSize: 15, fontWeight: 700, marginBottom: 6 }}>📤 Invio del documento firmato a mano</div>
          <div style={{ fontSize: 11.5, color: 'var(--muted)', lineHeight: 1.6 }}>
            Stai inviando allo studio il file firmato per <strong>{documentoDaCaricare.titolo || documentoDaCaricare.nome}</strong>.
            Il documento e la sua impronta vengono registrati a database: la prova della firma è il file stesso.
          </div>
        </div>

        <div style={{ background: 'var(--card2)', border: '1px solid var(--border)', borderRadius: 10, padding: 12, fontSize: 11.5 }}>
          <div style={{ color: 'var(--muted)', marginBottom: 3 }}>File selezionato</div>
          <div style={{ fontWeight: 700, wordBreak: 'break-all' }}>{fileFirmato.nome}</div>
        </div>

        <label style={{ fontSize: 11.5, color: 'var(--muted)', display: 'flex', flexDirection: 'column', gap: 6 }}>
          Se hai firmato con un provider di firma digitale, indicalo: cambia il valore probatorio scritto accanto alla firma.
          <select
            value={livelloRichiesto === 'feq' ? 'qualificata_esterna' : modalitaFirma === 'qualificata_esterna' ? 'qualificata_esterna' : 'manuale_scansionata'}
            onChange={(e) => setModalitaFirma(e.target.value as 'manuale_scansionata' | 'qualificata_esterna')}
            disabled={livelloRichiesto === 'feq'}
            style={{ padding: '8px 10px', borderRadius: 8, background: 'var(--card)', color: 'var(--text)', border: '1px solid var(--border)', fontSize: 12, opacity: livelloRichiesto === 'feq' ? 0.75 : 1 }}
          >
            <option value="manuale_scansionata">Firmato a penna e scansionato</option>
            <option value="qualificata_esterna">Firmato con firma digitale qualificata</option>
          </select>
        </label>
        {livelloRichiesto === 'feq' && (
          <div style={{ background: 'var(--pill-purple-bg)', border: '1px solid var(--purple)', color: 'var(--pill-purple-fg)', borderRadius: 10, padding: 10, fontSize: 11, lineHeight: 1.5 }}>
            🔐 Questo documento esige Firma Elettronica Qualificata: la sottoscrizione scansionata
            non è ammessa, quindi la modalità è fissata su firma digitale con provider qualificato.
          </div>
        )}

        {otpError && (
          <div style={{ background: 'var(--pill-red-bg)', border: '1px solid var(--pill-red-bg)', color: 'var(--pill-red-fg)', borderRadius: 10, padding: 12, fontSize: 11.5 }}>
            {otpError}
          </div>
        )}

        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 10 }}>
          <button
            type="button"
            onClick={richiediChiusura}
            style={{ background: 'transparent', border: '1px solid var(--border)', color: 'var(--muted)', padding: '9px 16px', borderRadius: 8, fontSize: 12, cursor: 'pointer' }}
          >
            Annulla
          </button>
          <button
            type="button"
            disabled={caricamentoFirmato}
            onClick={async () => {
              const esito = await confermaFirmaConFile();
              // La modale resta aperta se l'invio è fallito: l'errore è lì sopra, e chiuderla
              // farebbe credere che il file sia arrivato.
              if (esito) setDocumentoDaCaricare(null);
            }}
            style={{ background: 'var(--indigo)', color: '#fff', border: 'none', padding: '9px 20px', borderRadius: 8, fontSize: 12, fontWeight: 700, cursor: caricamentoFirmato ? 'default' : 'pointer' }}
          >
            {caricamentoFirmato ? 'Invio in corso…' : 'Invia allo studio'}
          </button>
        </div>
      </div>
      )}
    </Modal>
  );
}
