// Lo sconto concordato sul progetto (titolare, 28/11/2026). Con moduli presenti il valore del
// progetto è la somma dei moduli meno lo sconto: qui si scrive solo lo sconto, il valore lo
// ricalcola e lo salva il server, che scrive nel registro chi l'ha cambiato.
import React, { useState } from 'react';
import { salvaScontoProgettoApi } from '../../api/client';
import { fmt } from '../../utils';
import { Modal } from '../ui/Modal';
import { useToast } from '../ui/ToastProvider';

export function ScontoProgettoModal({ progettoId, sommaModuliCentesimi, scontoCentesimi, onClose, onSalvato }: {
  progettoId: string;
  sommaModuliCentesimi: number;
  scontoCentesimi: number;
  onClose: () => void;
  /** Chiamato dopo che il server ha confermato: la pagina rilegge il progetto. */
  onSalvato: () => void | Promise<void>;
}) {
  const toast = useToast();
  const [sconto, setSconto] = useState(scontoCentesimi > 0 ? (scontoCentesimi / 100).toFixed(2) : '');
  const [salvataggio, setSalvataggio] = useState(false);

  const scontoCent = sconto.trim() === '' ? 0 : Math.round(Number(sconto) * 100);
  const valido = Number.isFinite(scontoCent) && scontoCent >= 0 && (scontoCent === 0 || scontoCent < sommaModuliCentesimi);

  const salva = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!valido) return;
    setSalvataggio(true);
    try {
      await salvaScontoProgettoApi(progettoId, scontoCent);
      toast.successo(scontoCent > 0 ? `Sconto di ${fmt(scontoCent / 100)} salvato sul progetto.` : 'Sconto tolto dal progetto.');
      await onSalvato();
      onClose();
    } catch (err) {
      // Il modale resta aperto: un salvataggio fallito si dichiara, non si chiude (regola 3).
      toast.errore(`Sconto non salvato: ${err instanceof Error ? err.message : 'errore di rete'}`);
    } finally {
      setSalvataggio(false);
    }
  };

  return (
    <Modal onClose={onClose} overlayBackground="rgba(0,0,0,0.7)" zIndex={1000} labelledBy="titolo-sconto-progetto">
      {(richiediChiusura) => (
        <div style={{ background: 'var(--card)', borderRadius: 16, padding: '2rem', width: '100%', maxWidth: 440, border: '1px solid var(--border)' }}>
          <h3 id="titolo-sconto-progetto" style={{ margin: '0 0 1rem 0' }}>Sconto sul progetto</h3>
          <p style={{ fontSize: 13, color: 'var(--muted)', margin: '0 0 1.25rem 0' }}>
            Il valore del progetto è la somma dei prezzi dei moduli meno lo sconto. Lo sconto si toglie dagli importi
            proposti in fattura in proporzione, e la fattura lo dichiara.
          </p>
          <form onSubmit={salva} style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 14 }}>
              <span>Somma dei moduli</span>
              <strong>{fmt(sommaModuliCentesimi / 100)}</strong>
            </div>
            <div>
              <label htmlFor="sconto-progetto" style={{ fontSize: 12, color: 'var(--muted)', display: 'block', marginBottom: 4 }}>Sconto (€)</label>
              <input
                id="sconto-progetto"
                type="number"
                step="0.01"
                min="0"
                placeholder="0,00"
                value={sconto}
                onChange={(e) => setSconto(e.target.value)}
                style={{ width: '100%', padding: '8px 12px', borderRadius: 8, border: '1px solid var(--border)', background: 'var(--bg)', color: 'var(--text)', fontSize: 16, fontWeight: 700 }}
              />
              {!valido && (
                <div role="alert" style={{ fontSize: 11, color: 'var(--pill-red-fg)', marginTop: 4 }}>
                  Lo sconto deve essere più basso della somma dei moduli.
                </div>
              )}
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 14 }}>
              <span>Valore del progetto</span>
              <strong>{valido ? fmt((sommaModuliCentesimi - scontoCent) / 100) : '—'}</strong>
            </div>
            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 10, marginTop: 10 }}>
              <button type="button" className="btn btn-secondary" onClick={richiediChiusura}>Annulla</button>
              <button type="submit" className="btn btn-primary" disabled={salvataggio || !valido}>
                {salvataggio ? 'Salvataggio...' : 'Salva sconto'}
              </button>
            </div>
          </form>
        </div>
      )}
    </Modal>
  );
}
