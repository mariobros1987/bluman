import React, { useRef, useState, useMemo } from 'react';
import { firmaStudioDocumentoApi, richiediOtpStudioApi, type FirmaStudioPayload, type DocumentoProgetto } from '../../api/documenti';

interface FirmaStudioModalProps {
  doc: DocumentoProgetto;
  onClose: () => void;
  onSigned: (updatedDoc?: DocumentoProgetto) => void;
}

export function FirmaStudioModal({ doc, onClose, onSigned }: FirmaStudioModalProps) {
  const user = useMemo(() => {
    try {
      const raw = typeof localStorage !== 'undefined' ? localStorage.getItem('bluman_user') : null;
      return raw ? JSON.parse(raw) : null;
    } catch {
      return null;
    }
  }, []);
  const [modalita, setModalita] = useState<'grafometrica' | 'fea_otp' | 'qualificata_esterna' | 'manuale_scansionata'>('grafometrica');
  
  // Firmatario
  const [ruoloDichiarato, setRuoloDichiarato] = useState(
    user?.ruolo === 'advisor' ? 'Senior Legal & Tax Advisor' : 'Professionista Incaricato'
  );
  
  // Pad Grafometrica
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const [isDrawing, setIsDrawing] = useState(false);
  const [signatureMode, setSignatureMode] = useState<'draw' | 'type'>('draw');
  const [typedSignature, setTypedSignature] = useState(user?.nome || 'Firma Professionista');

  // OTP FEA
  const [canaleOtp, setCanaleOtp] = useState<'email' | 'whatsapp'>('email');
  const [cellulareWhatsapp, setCellulareWhatsapp] = useState('');
  const [otpInviato, setOtpInviato] = useState(false);
  const [recapitoMascherato, setRecapitoMascherato] = useState('');
  const [codiceOtp, setCodiceOtp] = useState('');
  const [invioOtpInCorso, setInvioOtpInCorso] = useState(false);

  // File Upload (FEQ / Scansione)
  const [uploadedFile, setUploadedFile] = useState<{ filename: string; contentBase64: string } | null>(null);

  // Stati generali
  const [loading, setLoading] = useState(false);
  const [errore, setErrore] = useState<string | null>(null);

  // Disegno su Canvas
  const startDrawing = (e: React.MouseEvent<HTMLCanvasElement> | React.TouchEvent<HTMLCanvasElement>) => {
    setIsDrawing(true);
    draw(e);
  };

  const stopDrawing = () => {
    setIsDrawing(false);
    const canvas = canvasRef.current;
    if (canvas) {
      const ctx = canvas.getContext('2d');
      if (ctx) ctx.beginPath();
    }
  };

  const draw = (e: React.MouseEvent<HTMLCanvasElement> | React.TouchEvent<HTMLCanvasElement>) => {
    if (!isDrawing) return;
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const rect = canvas.getBoundingClientRect();
    const clientX = 'touches' in e ? e.touches[0].clientX : (e as React.MouseEvent).clientX;
    const clientY = 'touches' in e ? e.touches[0].clientY : (e as React.MouseEvent).clientY;

    const x = clientX - rect.left;
    const y = clientY - rect.top;

    ctx.lineWidth = 2.5;
    ctx.lineCap = 'round';
    ctx.strokeStyle = '#1e1b4b';

    ctx.lineTo(x, y);
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(x, y);
  };

  const clearCanvas = () => {
    const canvas = canvasRef.current;
    if (canvas) {
      const ctx = canvas.getContext('2d');
      if (ctx) ctx.clearRect(0, 0, canvas.width, canvas.height);
    }
  };

  const ottieniImmagineFirma = (): string => {
    if (signatureMode === 'draw') {
      const canvas = canvasRef.current;
      return canvas ? canvas.toDataURL('image/png') : '';
    } else {
      const tempCanvas = document.createElement('canvas');
      tempCanvas.width = 400;
      tempCanvas.height = 100;
      const ctx = tempCanvas.getContext('2d');
      if (ctx) {
        ctx.font = '30px "Brush Script MT", cursive, sans-serif';
        ctx.fillStyle = '#1e1b4b';
        ctx.fillText(typedSignature || user?.nome || 'Firma', 20, 60);
        return tempCanvas.toDataURL('image/png');
      }
      return '';
    }
  };

  // Richiesta OTP FEA
  const handleRichiediOtp = async () => {
    setErrore(null);
    setInvioOtpInCorso(true);
    try {
      const res = await richiediOtpStudioApi(doc.id, canaleOtp, cellulareWhatsapp || undefined);
      if (res.ok) {
        setOtpInviato(true);
        setRecapitoMascherato(res.recapitoMascherato);
      }
    } catch (err: any) {
      setErrore(err.message || 'Errore durante la richiesta OTP');
    } finally {
      setInvioOtpInCorso(false);
    }
  };

  // Lettura file base64 per FEQ o Scansione
  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    setErrore(null);
    const file = e.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = () => {
      const b64 = reader.result as string;
      setUploadedFile({ filename: file.name, contentBase64: b64 });
    };
    reader.onerror = () => {
      setErrore('Impossibile leggere il file selezionato');
    };
    reader.readAsDataURL(file);
  };

  // Invio Firma al Backend
  const handleSubmitFirma = async () => {
    setErrore(null);
    setLoading(true);

    try {
      const payload: FirmaStudioPayload = {
        modalita,
        ruoloDichiarato: ruoloDichiarato.trim() || undefined,
      };

      if (modalita === 'grafometrica' || modalita === 'fea_otp') {
        const png = ottieniImmagineFirma();
        if (!png) {
          setErrore('Inserisci la firma grafica o testuale prima di confermare.');
          setLoading(false);
          return;
        }
        payload.firmaGrafometricaPng = png;

        if (modalita === 'fea_otp') {
          if (!codiceOtp || !/^\d{6}$/.test(codiceOtp.trim())) {
            setErrore('Inserisci il codice OTP di 6 cifre ricevuto.');
            setLoading(false);
            return;
          }
          payload.otp = codiceOtp.trim();
        }
      } else {
        if (!uploadedFile) {
          setErrore('Seleziona il file firmato prima di procedere.');
          setLoading(false);
          return;
        }
        payload.filename = uploadedFile.filename;
        payload.contentBase64 = uploadedFile.contentBase64;
      }

      const res = await firmaStudioDocumentoApi(doc.id, payload);
      if (res.ok) {
        onSigned({
          ...doc,
          firmato: true,
          firmatoDaStudio: true,
          firmaStudio: res.firma,
          fileFirmatoUrl: res.fileFirmatoUrl || doc.fileUrl,
        });
        onClose();
      }
    } catch (err: any) {
      setErrore(err.message || 'Errore durante la firma del documento');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div
      style={{
        position: 'fixed',
        inset: 0,
        backgroundColor: 'rgba(0, 0, 0, 0.75)',
        backdropFilter: 'blur(6px)',
        zIndex: 9999,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: 16,
      }}
    >
      <div
        style={{
          background: '#0f172a',
          border: '1px solid #334155',
          borderRadius: 16,
          width: '100%',
          maxWidth: 620,
          maxHeight: '90vh',
          display: 'flex',
          flexDirection: 'column',
          boxShadow: '0 25px 50px -12px rgba(0, 0, 0, 0.7)',
          overflow: 'hidden',
          color: '#f8fafc',
        }}
      >
        {/* Header */}
        <div
          style={{
            padding: '16px 20px',
            borderBottom: '1px solid #1e293b',
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            background: '#1e293b50',
          }}
        >
          <div>
            <div style={{ fontSize: 16, fontWeight: 800, color: '#f8fafc', display: 'flex', alignItems: 'center', gap: 8 }}>
              <span>🏛️ Sottoscrizione Documento — Studio BluMan</span>
            </div>
            <div style={{ fontSize: 11.5, color: '#94a3b8', marginTop: 2 }}>
              Firmatario: <strong style={{ color: '#e2e8f0' }}>{user?.nome || 'Operatore di Studio'}</strong> ({user?.email})
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            style={{
              background: 'transparent',
              border: 'none',
              color: '#94a3b8',
              fontSize: 20,
              cursor: 'pointer',
              lineHeight: 1,
            }}
          >
            ✕
          </button>
        </div>

        {/* Modal Body */}
        <div style={{ padding: 20, overflowY: 'auto', flex: 1, display: 'flex', flexDirection: 'column', gap: 16 }}>
          {/* Selettore Modalità */}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 6, background: '#1e293b', padding: 4, borderRadius: 10 }}>
            <button
              type="button"
              onClick={() => setModalita('grafometrica')}
              style={{
                padding: '8px 4px',
                borderRadius: 8,
                border: 'none',
                background: modalita === 'grafometrica' ? '#3b82f6' : 'transparent',
                color: modalita === 'grafometrica' ? '#fff' : '#94a3b8',
                fontSize: 11,
                fontWeight: 700,
                cursor: 'pointer',
                textAlign: 'center',
              }}
            >
              ✍️ Grafometrica (SES)
            </button>
            <button
              type="button"
              onClick={() => setModalita('fea_otp')}
              style={{
                padding: '8px 4px',
                borderRadius: 8,
                border: 'none',
                background: modalita === 'fea_otp' ? '#6366f1' : 'transparent',
                color: modalita === 'fea_otp' ? '#fff' : '#94a3b8',
                fontSize: 11,
                fontWeight: 700,
                cursor: 'pointer',
                textAlign: 'center',
              }}
            >
              🔐 Avanzata (FEA OTP)
            </button>
            <button
              type="button"
              onClick={() => setModalita('qualificata_esterna')}
              style={{
                padding: '8px 4px',
                borderRadius: 8,
                border: 'none',
                background: modalita === 'qualificata_esterna' ? '#10b981' : 'transparent',
                color: modalita === 'qualificata_esterna' ? '#fff' : '#94a3b8',
                fontSize: 11,
                fontWeight: 700,
                cursor: 'pointer',
                textAlign: 'center',
              }}
            >
              📁 Qualificata (FEQ)
            </button>
            <button
              type="button"
              onClick={() => setModalita('manuale_scansionata')}
              style={{
                padding: '8px 4px',
                borderRadius: 8,
                border: 'none',
                background: modalita === 'manuale_scansionata' ? '#f59e0b' : 'transparent',
                color: modalita === 'manuale_scansionata' ? '#fff' : '#94a3b8',
                fontSize: 11,
                fontWeight: 700,
                cursor: 'pointer',
                textAlign: 'center',
              }}
            >
              🖨️ Cartacea Scan
            </button>
          </div>

          {/* Qualifica / Ruolo firmatario */}
          <div>
            <label style={{ fontSize: 11, fontWeight: 700, color: '#94a3b8', textTransform: 'uppercase', letterSpacing: '.5px', display: 'block', marginBottom: 6 }}>
              Titolo / Ruolo del Firmatario
            </label>
            <input
              type="text"
              value={ruoloDichiarato}
              onChange={(e) => setRuoloDichiarato(e.target.value)}
              placeholder="Es. Senior Legal & Tax Advisor, Managing Partner..."
              style={{
                width: '100%',
                padding: '8px 12px',
                background: '#1e293b',
                border: '1px solid #334155',
                borderRadius: 8,
                color: '#fff',
                fontSize: 12.5,
              }}
            />
          </div>

          {/* Sezione per GRAFOMETRICA o FEA_OTP (Pad di firma) */}
          {(modalita === 'grafometrica' || modalita === 'fea_otp') && (
            <div>
              {/* Opzioni FEA OTP */}
              {modalita === 'fea_otp' && (
                <div style={{ background: '#1e1b4b40', border: '1px solid #4338ca', borderRadius: 10, padding: 14, marginBottom: 14 }}>
                  <div style={{ fontSize: 12, fontWeight: 700, color: '#a5b4fc', marginBottom: 8 }}>
                    📲 Autenticazione a 2 Fattori (OTP Verificato):
                  </div>
                  <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
                    <select
                      value={canaleOtp}
                      onChange={(e) => setCanaleOtp(e.target.value as 'email' | 'whatsapp')}
                      style={{ padding: '6px 10px', background: '#0f172a', border: '1px solid #4338ca', borderRadius: 6, color: '#fff', fontSize: 12 }}
                    >
                      <option value="email">Email ({user?.email})</option>
                      <option value="whatsapp">WhatsApp Business</option>
                    </select>

                    {canaleOtp === 'whatsapp' && (
                      <input
                        type="text"
                        value={cellulareWhatsapp}
                        onChange={(e) => setCellulareWhatsapp(e.target.value)}
                        placeholder="+39 333..."
                        style={{ padding: '6px 10px', background: '#0f172a', border: '1px solid #4338ca', borderRadius: 6, color: '#fff', fontSize: 12, width: 140 }}
                      />
                    )}

                    <button
                      type="button"
                      onClick={handleRichiediOtp}
                      disabled={invioOtpInCorso}
                      style={{
                        padding: '6px 14px',
                        background: '#6366f1',
                        color: '#fff',
                        border: 'none',
                        borderRadius: 6,
                        fontSize: 11.5,
                        fontWeight: 700,
                        cursor: 'pointer',
                      }}
                    >
                      {invioOtpInCorso ? 'Invio in corso...' : (otpInviato ? '🔄 Reinvia OTP' : '✉️ Ricevi Codice OTP')}
                    </button>
                  </div>

                  {otpInviato && (
                    <div style={{ marginTop: 12, display: 'flex', alignItems: 'center', gap: 10 }}>
                      <span style={{ fontSize: 11, color: '#86efac' }}>
                        ✓ Codice inviato a {recapitoMascherato}
                      </span>
                      <input
                        type="text"
                        maxLength={6}
                        value={codiceOtp}
                        onChange={(e) => setCodiceOtp(e.target.value)}
                        placeholder="Inserisci OTP a 6 cifre"
                        style={{
                          padding: '6px 10px',
                          background: '#0f172a',
                          border: '1.5px solid #10b981',
                          borderRadius: 6,
                          color: '#fff',
                          fontSize: 13,
                          fontWeight: 800,
                          letterSpacing: '2px',
                          width: 170,
                          textAlign: 'center',
                        }}
                      />
                    </div>
                  )}
                </div>
              )}

              {/* Toggle Disegna / Digita */}
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 }}>
                <span style={{ fontSize: 11, fontWeight: 700, color: '#94a3b8', textTransform: 'uppercase' }}>
                  Firma Grafica
                </span>
                <div style={{ display: 'flex', gap: 6 }}>
                  <button
                    type="button"
                    onClick={() => setSignatureMode('draw')}
                    style={{
                      padding: '3px 8px',
                      borderRadius: 4,
                      border: 'none',
                      background: signatureMode === 'draw' ? '#3b82f6' : '#1e293b',
                      color: signatureMode === 'draw' ? '#fff' : '#94a3b8',
                      fontSize: 10,
                      cursor: 'pointer',
                    }}
                  >
                    Disegna con mouse/touch
                  </button>
                  <button
                    type="button"
                    onClick={() => setSignatureMode('type')}
                    style={{
                      padding: '3px 8px',
                      borderRadius: 4,
                      border: 'none',
                      background: signatureMode === 'type' ? '#3b82f6' : '#1e293b',
                      color: signatureMode === 'type' ? '#fff' : '#94a3b8',
                      fontSize: 10,
                      cursor: 'pointer',
                    }}
                  >
                    Digita Nome
                  </button>
                </div>
              </div>

              {signatureMode === 'draw' ? (
                <div style={{ position: 'relative', background: '#fff', borderRadius: 8, overflow: 'hidden' }}>
                  <canvas
                    ref={canvasRef}
                    width={580}
                    height={120}
                    onMouseDown={startDrawing}
                    onMouseUp={stopDrawing}
                    onMouseLeave={stopDrawing}
                    onMouseMove={draw}
                    onTouchStart={startDrawing}
                    onTouchEnd={stopDrawing}
                    onTouchMove={draw}
                    style={{ display: 'block', width: '100%', height: 120, cursor: 'crosshair', touchAction: 'none' }}
                  />
                  <button
                    type="button"
                    onClick={clearCanvas}
                    style={{
                      position: 'absolute',
                      right: 8,
                      bottom: 8,
                      background: '#e2e8f0',
                      border: '1px solid #cbd5e1',
                      borderRadius: 4,
                      padding: '2px 8px',
                      fontSize: 10,
                      color: '#475569',
                      cursor: 'pointer',
                    }}
                  >
                    Cancella
                  </button>
                </div>
              ) : (
                <div style={{ background: '#1e293b', padding: 12, borderRadius: 8 }}>
                  <input
                    type="text"
                    value={typedSignature}
                    onChange={(e) => setTypedSignature(e.target.value)}
                    placeholder="Nome completo..."
                    style={{
                      width: '100%',
                      padding: 8,
                      background: '#0f172a',
                      border: '1px solid #334155',
                      borderRadius: 6,
                      color: '#fff',
                      fontSize: 14,
                      fontFamily: '"Brush Script MT", cursive, sans-serif',
                    }}
                  />
                </div>
              )}
            </div>
          )}

          {/* Sezione per FEQ QUALIFICATA ESTERNA */}
          {modalita === 'qualificata_esterna' && (
            <div style={{ background: '#064e3b25', border: '1px solid #059669', borderRadius: 10, padding: 16 }}>
              <div style={{ fontSize: 12.5, fontWeight: 700, color: '#34d399', marginBottom: 6 }}>
                📁 Firma Elettronica Qualificata (FEQ · CAdES / PAdES)
              </div>
              <div style={{ fontSize: 11, color: '#94a3b8', lineHeight: 1.5, marginBottom: 12 }}>
                Hai firmato l'atto all'esterno utilizzando una SmartCard, Token USB o Firma Remota con certificato qualificato?
                Carica il file firmato con estensione <code>.p7m</code> o <code>.pdf</code>.
              </div>
              <input
                type="file"
                accept=".p7m,.pdf"
                onChange={handleFileUpload}
                style={{ fontSize: 12, color: '#94a3b8' }}
              />
              {uploadedFile && (
                <div style={{ marginTop: 8, fontSize: 11.5, color: '#10b981', fontWeight: 700 }}>
                  ✓ File pronto: {uploadedFile.filename}
                </div>
              )}
            </div>
          )}

          {/* Sezione per SCANSIONE CARTACEA */}
          {modalita === 'manuale_scansionata' && (
            <div style={{ background: '#78350f25', border: '1px solid #b45309', borderRadius: 10, padding: 16 }}>
              <div style={{ fontSize: 12.5, fontWeight: 700, color: '#fbbf24', marginBottom: 6 }}>
                🖨️ Copia Cartacea Stampata e Controfirmata (SES)
              </div>
              <div style={{ fontSize: 11, color: '#94a3b8', lineHeight: 1.5, marginBottom: 12 }}>
                Hai stampato il documento e apposto la firma autografa tradizionale?
                Carica la scansione leggibile in formato PDF o immagine (JPEG/PNG).
              </div>
              <input
                type="file"
                accept=".pdf,.jpg,.jpeg,.png"
                onChange={handleFileUpload}
                style={{ fontSize: 12, color: '#94a3b8' }}
              />
              {uploadedFile && (
                <div style={{ marginTop: 8, fontSize: 11.5, color: '#f59e0b', fontWeight: 700 }}>
                  ✓ Scansione pronta: {uploadedFile.filename}
                </div>
              )}
            </div>
          )}

          {/* Alert Errore */}
          {errore && (
            <div style={{ background: '#7f1d1d40', border: '1px solid #ef4444', color: '#fca5a5', padding: '10px 14px', borderRadius: 8, fontSize: 11.5 }}>
              ⚠️ {errore}
            </div>
          )}
        </div>

        {/* Modal Footer */}
        <div
          style={{
            padding: '14px 20px',
            borderTop: '1px solid #1e293b',
            display: 'flex',
            justifyContent: 'flex-end',
            alignItems: 'center',
            gap: 10,
            background: '#1e293b50',
          }}
        >
          <button
            type="button"
            onClick={onClose}
            style={{
              padding: '8px 16px',
              background: '#334155',
              border: 'none',
              borderRadius: 8,
              color: '#cbd5e1',
              fontSize: 12,
              fontWeight: 600,
              cursor: 'pointer',
            }}
          >
            Annulla
          </button>
          <button
            type="button"
            onClick={handleSubmitFirma}
            disabled={loading}
            style={{
              padding: '8px 20px',
              background: '#3b82f6',
              border: 'none',
              borderRadius: 8,
              color: '#fff',
              fontSize: 12.5,
              fontWeight: 700,
              cursor: 'pointer',
              boxShadow: '0 4px 12px rgba(59, 130, 246, 0.4)',
              display: 'flex',
              alignItems: 'center',
              gap: 6,
            }}
          >
            {loading ? 'Apposizione in corso...' : '🏛️ Apponi Firma Studio'}
          </button>
        </div>
      </div>
    </div>
  );
}
