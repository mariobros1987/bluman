// «Storna incasso» (titolare, 28/11/2026): un incasso registrato per errore non si cancella, si
// annulla con una riga contraria. Il modale dice prima cosa succede e chiede il motivo, che resta
// nel registro con chi ha stornato. Quali incassi si possono stornare lo decide la stessa funzione
// che usa il server (`domain/stornoIncasso.ts`).
import React, { useState } from 'react';
import { stornaIncassoApi } from '../../api/client';
import { fmt } from '../../utils';
import { Modal } from '../ui/Modal';
import { useToast } from '../ui/ToastProvider';
import {
  incassiStornabili,
  LUNGHEZZA_MASSIMA_MOTIVO_STORNO,
  LUNGHEZZA_MINIMA_MOTIVO_STORNO,
} from '../../../../src/domain/stornoIncasso';

export interface IncassoDellaRata {
  id: string;
  importoIncassatoCentesimi: number;
  stornoDiId?: string | null;
  dataIncasso?: string | null;
  metodoPagamento?: string | null;
  riferimentoTransazione?: string | null;
}

export interface RataConIncassi {
  id: string;
  numeroRata: number;
  registrazioniRegistrate?: IncassoDellaRata[] | null;
  fattura?: { numero?: string | null } | null;
}

const campo: React.CSSProperties = { width: '100%', padding: '8px 12px', borderRadius: 8, border: '1px solid var(--border)', background: 'var(--bg)', color: 'var(--text)' };
const etichetta: React.CSSProperties = { fontSize: 12, color: 'var(--muted)', display: 'block', marginBottom: 4 };

function descriviIncasso(i: IncassoDellaRata): string {
  const giorno = i.dataIncasso ? new Date(i.dataIncasso).toLocaleDateString('it-IT') : 'data non indicata';
  const parti = [fmt(i.importoIncassatoCentesimi / 100), `del ${giorno}`];
  if (i.metodoPagamento) parti.push(i.metodoPagamento);
  if (i.riferimentoTransazione) parti.push(`rif. ${i.riferimentoTransazione}`);
  return parti.join(' · ');
}

export function StornaIncassoModal({ rata, onClose, onStornato }: {
  rata: RataConIncassi;
  onClose: () => void;
  /** Chiamato dopo che il server ha confermato: la pagina rilegge i suoi elenchi. */
  onStornato: () => void | Promise<void>;
}) {
  const toast = useToast();
  const stornabili = incassiStornabili(rata.registrazioniRegistrate ?? []);
  const [incassoId, setIncassoId] = useState(stornabili.length === 1 ? stornabili[0]!.id : '');
  const [motivo, setMotivo] = useState('');
  const [salvataggio, setSalvataggio] = useState(false);

  const motivoValido = motivo.trim().length >= LUNGHEZZA_MINIMA_MOTIVO_STORNO;

  const salva = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!incassoId || !motivoValido) return;
    setSalvataggio(true);
    try {
      await stornaIncassoApi(rata.id, incassoId, { motivo: motivo.trim() });
      toast.successo('Incasso stornato: la rata è di nuovo aperta e in Prima Nota c’è l’uscita contraria.');
      await onStornato();
      onClose();
    } catch (err) {
      // Il modale resta aperto: uno storno fallito si dichiara, non si chiude (regola 3).
      toast.errore(`Incasso non stornato: ${err instanceof Error ? err.message : 'errore di rete'}`);
    } finally {
      setSalvataggio(false);
    }
  };

  return (
    <Modal onClose={onClose} overlayBackground="rgba(0,0,0,0.7)" zIndex={1000} labelledBy="titolo-storna-incasso">
      {(richiediChiusura) => (
        <div style={{ background: 'var(--card)', borderRadius: 16, padding: '2rem', width: '100%', maxWidth: 480, border: '1px solid var(--border)' }}>
          <h3 id="titolo-storna-incasso" style={{ margin: '0 0 1rem 0' }}>Storna incasso — Rata #{rata.numeroRata}</h3>
          <p style={{ fontSize: 13, color: 'var(--muted)', margin: '0 0 1.25rem 0' }}>
            Fattura: <strong>{rata.fattura?.numero}</strong>. L'incasso non viene cancellato: si scrive una riga contraria,
            la rata torna da incassare e dal conto esce lo stesso importo. Resta scritto chi ha stornato e perché.
          </p>

          {stornabili.length === 0 ? (
            <>
              <div role="alert" style={{ fontSize: 13, color: 'var(--pill-amber-fg)', marginBottom: 16 }}>
                Su questa rata non c'è nessun incasso da stornare.
              </div>
              <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
                <button type="button" className="btn btn-secondary" onClick={richiediChiusura}>Chiudi</button>
              </div>
            </>
          ) : (
            <form onSubmit={salva} style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
              <fieldset style={{ border: 'none', padding: 0, margin: 0 }}>
                <legend style={etichetta}>Incasso da stornare *</legend>
                {stornabili.map((i) => (
                  <label key={i.id} style={{ display: 'flex', gap: 8, alignItems: 'center', fontSize: 14, padding: '4px 0' }}>
                    <input type="radio" name="incasso-da-stornare" value={i.id} checked={incassoId === i.id} onChange={() => setIncassoId(i.id)} />
                    {descriviIncasso(i)}
                  </label>
                ))}
              </fieldset>

              <div>
                <label htmlFor="storno-motivo" style={etichetta}>Motivo dello storno *</label>
                <textarea
                  id="storno-motivo"
                  required
                  rows={3}
                  minLength={LUNGHEZZA_MINIMA_MOTIVO_STORNO}
                  maxLength={LUNGHEZZA_MASSIMA_MOTIVO_STORNO}
                  placeholder="Es. incasso registrato sulla rata sbagliata"
                  value={motivo}
                  onChange={(e) => setMotivo(e.target.value)}
                  style={{ ...campo, resize: 'vertical' }}
                />
                <div style={{ fontSize: 11, color: 'var(--hint)', marginTop: 4 }}>
                  Almeno {LUNGHEZZA_MINIMA_MOTIVO_STORNO} caratteri: è ciò che si legge nel registro e nella nota del movimento.
                </div>
              </div>

              <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 10, marginTop: 10 }}>
                <button type="button" className="btn btn-secondary" onClick={richiediChiusura}>Annulla</button>
                <button type="submit" className="btn btn-danger" disabled={salvataggio || !incassoId || !motivoValido}>
                  {salvataggio ? 'Storno in corso...' : 'Storna incasso'}
                </button>
              </div>
            </form>
          )}
        </div>
      )}
    </Modal>
  );
}
