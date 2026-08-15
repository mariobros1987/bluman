import React, { useState } from 'react';

interface ConfirmDeleteModalProps {
  isOpen: boolean;
  onClose: () => void;
  onConfirm: () => Promise<void>;
  projectName: string;
  hasInvoices: boolean;
}

export const ConfirmDeleteModal: React.FC<ConfirmDeleteModalProps> = ({
  isOpen,
  onClose,
  onConfirm,
  projectName,
  hasInvoices
}) => {
  const [inputValue, setInputValue] = useState('');
  const [isDeleting, setIsDeleting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!isOpen) return null;

  const isMatch = inputValue === projectName;

  const handleConfirm = async () => {
    if (!isMatch || hasInvoices) return;
    setIsDeleting(true);
    setError(null);
    try {
      await onConfirm();
      onClose();
    } catch (err: any) {
      setError(err.message || 'Errore durante l\'eliminazione del progetto.');
    } finally {
      setIsDeleting(false);
    }
  };

  return (
    <div style={overlayStyle}>
      <div style={modalStyle}>
        <div style={headerStyle}>
          <h2>Elimina Progetto</h2>
          <button style={closeBtnStyle} onClick={onClose}>×</button>
        </div>

        <div style={contentStyle}>
          {hasInvoices ? (
            <div style={{ backgroundColor: '#fff3cd', color: '#856404', padding: '1rem', borderRadius: '4px', border: '1px solid #ffeeba' }}>
              <strong>⚠️ Attenzione (Blocco Fiscale):</strong> Impossibile eliminare direttamente questo progetto perché contiene Fatture o Note di Credito emesse. 
              Per legge i documenti contabili non possono essere rimossi. Ti suggeriamo di <strong>Archiviare</strong> il progetto invece di eliminarlo.
            </div>
          ) : (
            <>
              <p>
                Stai per eliminare definitivamente il progetto <strong>{projectName}</strong>. 
                Questa operazione eliminerà anche tutti i preventivi, i moduli e le microvoci associate e non può essere annullata.
              </p>
              
              <div style={formGroupStyle}>
                <label>Per confermare, digita esattamente il nome del progetto:</label>
                <input 
                  type="text" 
                  value={inputValue}
                  onChange={(e) => setInputValue(e.target.value)}
                  placeholder={projectName}
                  style={{ marginTop: '0.5rem', padding: '0.5rem', width: '100%', border: '1px solid #ccc', borderRadius: '4px' }}
                />
              </div>
            </>
          )}

          {error && <div style={{ color: 'red', marginTop: '0.5rem' }}>{error}</div>}
        </div>

        <div style={footerStyle}>
          <button style={secondaryBtnStyle} onClick={onClose} disabled={isDeleting}>
            Annulla
          </button>
          {!hasInvoices && (
            <button 
              style={{ ...primaryBtnStyle, backgroundColor: isMatch ? '#dc3545' : '#ccc', cursor: isMatch ? 'pointer' : 'not-allowed' }}
              disabled={!isMatch || isDeleting}
              onClick={handleConfirm}
            >
              {isDeleting ? 'Eliminazione...' : 'Conferma Eliminazione'}
            </button>
          )}
        </div>
      </div>
    </div>
  );
};

const overlayStyle: React.CSSProperties = { position: 'fixed', inset: 0, background: 'rgba(0,0,0,.7)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000, padding: 16 };
const modalStyle: React.CSSProperties = { background: 'var(--card)', borderRadius: 12, width: '100%', maxWidth: '500px', display: 'flex', flexDirection: 'column', maxHeight: '90vh', border: '1px solid var(--border)', overflow: 'hidden' };
const headerStyle: React.CSSProperties = { display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '16px 20px', borderBottom: '1px solid var(--border)', background: 'var(--card2)' };
const closeBtnStyle: React.CSSProperties = { background: 'transparent', border: 'none', fontSize: 24, cursor: 'pointer', color: 'var(--muted)' };
const contentStyle: React.CSSProperties = { padding: '20px', overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: '1rem' };
const formGroupStyle: React.CSSProperties = { display: 'flex', flexDirection: 'column', gap: 6 };
const footerStyle: React.CSSProperties = { padding: '16px 20px', borderTop: '1px solid var(--border)', display: 'flex', justifyContent: 'space-between', background: 'var(--card2)' };
const secondaryBtnStyle: React.CSSProperties = { background: 'transparent', border: '1px solid var(--border)', color: 'var(--text)', padding: '8px 16px', borderRadius: 8, cursor: 'pointer', fontWeight: 600 };
const primaryBtnStyle: React.CSSProperties = { background: 'var(--indigo)', border: 'none', color: 'white', padding: '8px 16px', borderRadius: 8, cursor: 'pointer', fontWeight: 600 };

