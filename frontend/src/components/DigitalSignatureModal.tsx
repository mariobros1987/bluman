import React, { useRef, useState } from 'react';
import type { SignatureData } from '../utils/pdfGenerator';
import { SmoothStrokeTracker, getCanvasCoordinates } from '../utils/smoothSignature';
import { Modal } from './ui/Modal';

interface DigitalSignatureModalProps {
  documentTitle: string;
  signerName: string;
  signerRole: string;
  onClose: () => void;
  onSigned: (signature: SignatureData) => void;
  /**
   * Piano di sovrapposizione. Serve quando il pad viene aperto sopra un'altra modale — per
   * esempio quella della firma SES, che sta a 11000: col valore predefinito il pad si
   * disegnerebbe dietro e il cliente vedrebbe soltanto lo sfondo scurirsi.
   */
  zIndex?: number;
  /** Testo sotto l'area di firma: chi firma legge cosa viene davvero registrato. */
  notaRegistrazione?: string;
}

export function DigitalSignatureModal({
  documentTitle,
  signerName,
  signerRole,
  onClose,
  onSigned,
  zIndex = 120,
  notaRegistrazione,
}: DigitalSignatureModalProps) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const [isDrawing, setIsDrawing] = useState(false);
  const [typedSignature, setTypedSignature] = useState(signerName);
  const [signatureMode, setSignatureMode] = useState<'draw' | 'type'>('draw');
  // La firma è su canvas: il tratto non genera eventi input nativi, quindi l'auto-dirty del
  // Modal non lo vedrebbe. Teniamo noi lo stato "modificato" (disegno o digitazione).
  const [modificato, setModificato] = useState(false);

  const trackerRef = useRef<SmoothStrokeTracker>(
    new SmoothStrokeTracker({ strokeColor: 'var(--pill-indigo-bg)', baseLineWidth: 2.5, minLineWidth: 1.6, maxLineWidth: 3.4 })
  );

  const startDrawing = (e: React.MouseEvent<HTMLCanvasElement> | React.TouchEvent<HTMLCanvasElement>) => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    setIsDrawing(true);
    setModificato(true);
    const { x, y } = getCanvasCoordinates(e, canvas);
    trackerRef.current.start(x, y);
  };

  const stopDrawing = () => {
    if (!isDrawing) return;
    setIsDrawing(false);
    const canvas = canvasRef.current;
    if (canvas) {
      const ctx = canvas.getContext('2d');
      if (ctx) {
        trackerRef.current.end(ctx);
      }
    }
  };

  const draw = (e: React.MouseEvent<HTMLCanvasElement> | React.TouchEvent<HTMLCanvasElement>) => {
    if (!isDrawing) return;
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const { x, y, pressure } = getCanvasCoordinates(e, canvas);
    trackerRef.current.move(x, y, ctx, Date.now(), pressure);
  };

  const clearCanvas = () => {
    const canvas = canvasRef.current;
    if (canvas) {
      const ctx = canvas.getContext('2d');
      if (ctx) {
        ctx.clearRect(0, 0, canvas.width, canvas.height);
      }
    }
    trackerRef.current.reset();
  };

  const handleConfirmSignature = () => {
    let signatureImgBase64 = '';

    if (signatureMode === 'draw') {
      const canvas = canvasRef.current;
      if (canvas) {
        signatureImgBase64 = canvas.toDataURL('image/png');
      }
    } else {
      // Genera canvas con testo firmato
      const tempCanvas = document.createElement('canvas');
      tempCanvas.width = 400;
      tempCanvas.height = 100;
      const ctx = tempCanvas.getContext('2d');
      if (ctx) {
        ctx.font = '30px "Brush Script MT", cursive, sans-serif';
        ctx.fillStyle = 'var(--pill-indigo-bg)';
        ctx.fillText(typedSignature || signerName, 20, 60);
        signatureImgBase64 = tempCanvas.toDataURL('image/png');
      }
    }

    const signatureResult: SignatureData = {
      signerName: signerName,
      signerRole: signerRole,
      signatureImageBase64: signatureImgBase64,
      timestamp: new Date().toLocaleString('it-IT'),
      // L'indirizzo IP lo conosce solo il server. Qui c'era una costante,
      // `'83.211.12.94 (eIDAS Verificato)'`, che compariva identica su ogni firma di ogni
      // cliente e in un verbale probatorio è un dato falso con l'aspetto di una prova.
      // Il valore vero viene registrato dal backend nel sigillo (campo `ipAddress` di
      // `firma_elettronica`), e vale `null` quando il proxy non lo espone.
      ipAddress: null,
    };

    onSigned(signatureResult);
  };

  return (
    <Modal onClose={onClose} overlayBackground="rgba(0,0,0,.8)" zIndex={zIndex} dirty={modificato} labelledBy="firma-digitale-titolo">
      {(richiediChiusura) => (
      <div style={{ background: 'var(--sidebar)', border: '1px solid var(--border)', borderRadius: 16, padding: 24, width: '100%', maxWidth: 520, display: 'flex', flexDirection: 'column', gap: 16 }}>
        <div>
          <div id="firma-digitale-titolo" style={{ fontSize: 16, fontWeight: 700, display: 'flex', alignItems: 'center', gap: 8 }}>
            <span>✍️ Apponi Firma Elettronica Semplice (art. 20 CAD)</span>
          </div>
          <div style={{ fontSize: 11, color: 'var(--muted)', marginTop: 4 }}>
            Documento: <strong>{documentTitle}</strong> · Firmatario: <strong>{signerName}</strong> ({signerRole})
          </div>
        </div>

        {/* Modalità Firma */}
        <div style={{ display: 'flex', gap: 10 }}>
          <button
            type="button"
            onClick={() => setSignatureMode('draw')}
            style={{
              flex: 1, padding: 8, borderRadius: 8, fontSize: 12, fontWeight: 600, cursor: 'pointer',
              background: signatureMode === 'draw' ? 'var(--surface-1)' : 'var(--card2)',
              border: `1px solid ${signatureMode === 'draw' ? 'var(--indigo-l)' : 'var(--border)'}`,
              color: signatureMode === 'draw' ? 'var(--indigo-l)' : 'var(--muted)',
            }}
          >
            ✏️ Disegna Firma su Canvas
          </button>
          <button
            type="button"
            onClick={() => setSignatureMode('type')}
            style={{
              flex: 1, padding: 8, borderRadius: 8, fontSize: 12, fontWeight: 600, cursor: 'pointer',
              background: signatureMode === 'type' ? 'var(--surface-1)' : 'var(--card2)',
              border: `1px solid ${signatureMode === 'type' ? 'var(--indigo-l)' : 'var(--border)'}`,
              color: signatureMode === 'type' ? 'var(--indigo-l)' : 'var(--muted)',
            }}
          >
            ⌨️ Digita Nome per Esteso
          </button>
        </div>

        {/* Area Firma Canvas / Text */}
        {signatureMode === 'draw' ? (
          <div>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 }}>
              <label style={{ fontSize: 11, color: 'var(--muted)' }}>Disegna con mouse o schermo touch *</label>
              <button onClick={clearCanvas} type="button" style={{ background: 'transparent', border: 'none', color: 'var(--amber)', fontSize: 11, cursor: 'pointer' }}>
                🧹 Cancella & Riavvia
              </button>
            </div>
            <canvas
              ref={canvasRef}
              width={470}
              height={140}
              onMouseDown={startDrawing}
              onMouseUp={stopDrawing}
              onMouseLeave={stopDrawing}
              onMouseMove={draw}
              onTouchStart={startDrawing}
              onTouchEnd={stopDrawing}
              onTouchMove={draw}
              style={{ background: '#ffffff', border: '2px dashed var(--indigo)', borderRadius: 10, cursor: 'crosshair', width: '100%', touchAction: 'none' }}
            />
          </div>
        ) : (
          <div>
            <label style={{ fontSize: 11, color: 'var(--muted)', display: 'block', marginBottom: 6 }}>Digitazione Nome & Cognome per Esteso *</label>
            <input
              type="text"
              value={typedSignature}
              onChange={e => { setTypedSignature(e.target.value); setModificato(true); }}
              placeholder="Nome Cognome"
              style={{ width: '100%', fontSize: 16, fontFamily: '"Brush Script MT", cursive, sans-serif', padding: 12 }}
            />
          </div>
        )}

        {/*
          Diceva "marca temporale ed IP esecutore": l'IP qui non c'è più, perché il browser non
          lo conosce e la costante che stava al suo posto era falsa. Chi apre il pad da un flusso
          che registra altro (per esempio la firma SES, dove il codice è già stato convalidato)
          passa la nota giusta con `notaRegistrazione`.
        */}
        <div style={{ background: 'var(--pill-green-bg)', border: '1px solid var(--pill-green-bd)', borderRadius: 8, padding: 10, fontSize: 11, color: 'var(--pill-green-fg)', lineHeight: 1.45 }}>
          {notaRegistrazione ??
            '✓ Il tratto grafico viene allegato al documento insieme alla data e ora di apposizione. Da solo non identifica il firmatario: vale come elemento a corredo della verifica già effettuata.'}
        </div>

        {/* Bottoni Azione */}
        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 10, marginTop: 4 }}>
          <button type="button" onClick={richiediChiusura} style={{ background: 'transparent', border: '1px solid var(--border)', color: 'var(--muted)', padding: '8px 16px', borderRadius: 8, fontSize: 12, cursor: 'pointer' }}>
            Annulla
          </button>
          <button type="button" onClick={handleConfirmSignature} style={{ background: 'var(--indigo)', color: 'var(--on-accent)', border: 'none', padding: '8px 20px', borderRadius: 8, fontSize: 12, fontWeight: 700, cursor: 'pointer', boxShadow: '0 4px 14px rgba(99,102,241,.3)' }}>
            ✓ Apponi Firma & Conferma
          </button>
        </div>
      </div>
      )}
    </Modal>
  );
}
