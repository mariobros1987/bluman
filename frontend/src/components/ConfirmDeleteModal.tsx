import React, { useState } from 'react';
import styles from './AnagraficaErpModal.module.css'; // Reusing standard modal styles

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
    <div className={styles.overlay}>
      <div className={styles.modal} style={{ maxWidth: '500px' }}>
        <div className={styles.header}>
          <h2>Elimina Progetto</h2>
          <button className={styles.closeBtn} onClick={onClose}>×</button>
        </div>

        <div className={styles.content} style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
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
              
              <div className={styles.formGroup}>
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

        <div className={styles.footer} style={{ justifyContent: 'space-between' }}>
          <button className={styles.secondaryBtn} onClick={onClose} disabled={isDeleting}>
            Annulla
          </button>
          {!hasInvoices && (
            <button 
              className={styles.primaryBtn} 
              style={{ backgroundColor: isMatch ? '#dc3545' : '#ccc', cursor: isMatch ? 'pointer' : 'not-allowed' }}
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
