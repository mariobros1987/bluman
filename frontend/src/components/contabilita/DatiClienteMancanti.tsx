// La fattura non parte se al cliente mancano i dati fiscali (titolare, 28/11/2026): il server
// elenca cosa manca, e qui lo si mostra con il pulsante che porta alla scheda del cliente.
// Le tre pagine che emettono (progetto, Registro Fatture, Retainer) usano lo stesso hook.
import { useState } from 'react';
import type { ReactNode } from 'react';
import { useNavigate } from 'react-router-dom';
import { ErroreDatiClienteMancanti } from '../../api/erroriEmissione';
import { Modal } from '../ui/Modal';

/**
 * `intercetta(err)` va chiamato nel `catch` dell'emissione: se l'errore è «mancano i dati del
 * cliente» apre il modale e risponde `true` (la pagina non mostra il suo toast generico).
 */
export function useDatiClienteMancanti(): { intercetta: (err: unknown) => boolean; modale: ReactNode } {
  const navigate = useNavigate();
  const [errore, setErrore] = useState<ErroreDatiClienteMancanti | null>(null);

  const intercetta = (err: unknown): boolean => {
    if (!(err instanceof ErroreDatiClienteMancanti)) return false;
    setErrore(err);
    return true;
  };

  const modale = errore ? (
    <Modal onClose={() => setErrore(null)} overlayBackground="rgba(0,0,0,0.7)" zIndex={1100} labelledBy="titolo-dati-cliente-mancanti">
      {(richiediChiusura) => (
        <div style={{ background: 'var(--card)', borderRadius: 16, padding: '2rem', width: '100%', maxWidth: 460, border: '1px solid var(--border)' }}>
          <h3 id="titolo-dati-cliente-mancanti" style={{ margin: '0 0 1rem 0' }}>La fattura non si può emettere</h3>
          <p style={{ fontSize: 14, margin: '0 0 8px 0' }}>
            Nella scheda di <strong>{errore.clienteNome}</strong> {errore.datiMancanti.length === 1 ? 'manca' : 'mancano'}:
          </p>
          <ul style={{ margin: '0 0 1rem 1.2rem', padding: 0, fontSize: 14 }}>
            {errore.datiMancanti.map((d) => <li key={d}>{d}</li>)}
          </ul>
          <p style={{ fontSize: 12, color: 'var(--muted)', margin: '0 0 1.25rem 0' }}>
            Senza questi dati il documento fiscale uscirebbe incompleto. Completa la scheda e riprova: non è stato emesso niente e nessun numero è stato usato.
          </p>
          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 10 }}>
            <button type="button" className="btn btn-secondary" onClick={richiediChiusura}>Chiudi</button>
            <button
              type="button"
              className="btn btn-primary"
              onClick={() => navigate(`/clients?client=${encodeURIComponent(errore.clienteNome)}`)}
            >
              Apri la scheda del cliente
            </button>
          </div>
        </div>
      )}
    </Modal>
  ) : null;

  return { intercetta, modale };
}
