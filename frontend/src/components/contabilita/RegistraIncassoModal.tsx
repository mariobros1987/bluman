// «Registra incasso» di una rata: un modale solo per Scadenzario e Registro Fatture (prima erano
// due moduli diversi, e quello del Registro non chiedeva né la data né il conto).
//
// Il conto è obbligatorio (titolare, 28/11/2026): lo sceglie chi registra, e senza conti l'incasso
// non si registra — il modale manda a Banche e conti invece di scrivere un movimento fuori da ogni
// saldo. Una lettura dei conti fallita è un errore dichiarato, non «nessun conto».
import React, { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { fetchContiBancariApi, registraIncassoApi } from '../../api/client';
import { oggi } from '../../utils/calendarioDate';
import { fmt } from '../../utils';
import { Modal } from '../ui/Modal';
import { useToast } from '../ui/ToastProvider';

export interface RataDaIncassare {
  id: string;
  numeroRata: number;
  importoCentesimi: number | null;
  registrazioniRegistrate?: Array<{ importoIncassatoCentesimi?: number | null }> | null;
  fattura?: { numero?: string | null; contoAccreditoId?: string | null; cliente?: { nome?: string | null } | null } | null;
}

interface Conto { id: string; nomeConto: string; banca?: string | null; isDefault?: boolean }

const campo: React.CSSProperties = { width: '100%', padding: '8px 12px', borderRadius: 8, border: '1px solid var(--border)', background: 'var(--bg)', color: 'var(--text)' };
const etichetta: React.CSSProperties = { fontSize: 12, color: 'var(--muted)', display: 'block', marginBottom: 4 };

/** Quanto resta da incassare della rata: l'importo meno ciò che è già registrato (storni compresi). */
function residuoCentesimi(rata: RataDaIncassare): number {
  const incassato = (rata.registrazioniRegistrate ?? []).reduce((tot, r) => tot + (r.importoIncassatoCentesimi ?? 0), 0);
  return Math.max(0, (rata.importoCentesimi ?? 0) - incassato);
}

export function RegistraIncassoModal({ rata, onClose, onRegistrato }: {
  rata: RataDaIncassare;
  onClose: () => void;
  /** Chiamato dopo che il server ha confermato: la pagina rilegge i suoi elenchi. */
  onRegistrato: () => void | Promise<void>;
}) {
  const toast = useToast();
  const navigate = useNavigate();
  const [importo, setImporto] = useState((residuoCentesimi(rata) / 100).toFixed(2));
  const [dataIncasso, setDataIncasso] = useState(oggi());
  const [contoId, setContoId] = useState('');
  const [metodo, setMetodo] = useState('bonifico');
  const [riferimento, setRiferimento] = useState('');
  const [note, setNote] = useState('');
  const [salvataggio, setSalvataggio] = useState(false);
  /** `null` = lettura in corso. */
  const [conti, setConti] = useState<Conto[] | null>(null);
  const [erroreConti, setErroreConti] = useState<string | null>(null);

  const caricaConti = () => {
    setErroreConti(null);
    setConti(null);
    fetchContiBancariApi({ rigettaSuErrore: true })
      .then((elenco) => {
        const letti: Conto[] = Array.isArray(elenco) ? elenco : [];
        setConti(letti);
        // Si propone il conto indicato sulla fattura, altrimenti il predefinito: è una proposta,
        // la scelta resta di chi registra.
        const proposto = letti.find((c) => c.id === rata.fattura?.contoAccreditoId) || letti.find((c) => c.isDefault);
        setContoId((attuale) => attuale || proposto?.id || '');
      })
      .catch((err) => { setConti([]); setErroreConti(err instanceof Error ? err.message : 'Errore di rete'); });
  };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(caricaConti, []);

  const senzaConti = conti !== null && !erroreConti && conti.length === 0;

  const salva = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!importo || !contoId) return;
    setSalvataggio(true);
    try {
      await registraIncassoApi(rata.id, {
        importoIncassatoCentesimi: Math.round(parseFloat(importo) * 100),
        dataIncasso,
        contoBancarioId: contoId,
        metodoPagamento: metodo,
        riferimentoTransazione: riferimento || undefined,
        noteOperatore: note || undefined,
      });
      toast.successo('Incasso registrato: lo trovi anche in Prima Nota.');
      await onRegistrato();
      onClose();
    } catch (err) {
      // Il modale resta aperto: un salvataggio fallito si dichiara, non si chiude (regola 3).
      toast.errore(`Incasso non registrato: ${err instanceof Error ? err.message : 'errore di rete'}`);
    } finally {
      setSalvataggio(false);
    }
  };

  return (
    <Modal onClose={onClose} overlayBackground="rgba(0,0,0,0.7)" zIndex={1000} labelledBy="titolo-registra-incasso">
      {(richiediChiusura) => (
        <div style={{ background: 'var(--card)', borderRadius: 16, padding: '2rem', width: '100%', maxWidth: 480, border: '1px solid var(--border)' }}>
          <h3 id="titolo-registra-incasso" style={{ margin: '0 0 1rem 0' }}>Registrazione Incasso Rata #{rata.numeroRata}</h3>
          <p style={{ fontSize: 13, color: 'var(--muted)', margin: '0 0 1.25rem 0' }}>
            Fattura: <strong>{rata.fattura?.numero}</strong>
            {rata.fattura?.cliente?.nome ? <> | Cliente: <strong>{rata.fattura.cliente.nome}</strong></> : null}
            {' '}| Importo Rata: <strong>{fmt((rata.importoCentesimi || 0) / 100)}</strong>
          </p>

          <form onSubmit={salva} style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
            <div>
              <label htmlFor="incasso-importo" style={etichetta}>Importo Incassato Effettivo (€) *</label>
              <input id="incasso-importo" type="number" step="0.01" min="0.01" required value={importo} onChange={(e) => setImporto(e.target.value)} style={{ ...campo, fontSize: 16, fontWeight: 700 }} />
            </div>

            <div>
              <label htmlFor="incasso-data" style={etichetta}>Data dell'incasso *</label>
              <input id="incasso-data" type="date" required max={oggi()} value={dataIncasso} onChange={(e) => setDataIncasso(e.target.value)} style={campo} />
              <div style={{ fontSize: 11, color: 'var(--hint)', marginTop: 4 }}>
                Il giorno in cui il denaro è arrivato: è la data che finisce in Prima Nota.
              </div>
            </div>

            <div>
              <label htmlFor="incasso-conto" style={etichetta}>Conto su cui è entrato il denaro *</label>
              <select id="incasso-conto" required value={contoId} onChange={(e) => setContoId(e.target.value)} disabled={!conti || conti.length === 0} style={campo}>
                <option value="">{conti === null ? 'Lettura dei conti…' : conti.length === 0 ? 'Nessun conto disponibile' : 'Scegli il conto…'}</option>
                {(conti ?? []).map((c) => (
                  <option key={c.id} value={c.id}>{c.nomeConto}{c.banca ? ` — ${c.banca}` : ''}{c.isDefault ? ' (predefinito)' : ''}</option>
                ))}
              </select>
              {erroreConti ? (
                <div role="alert" style={{ fontSize: 11, color: 'var(--pill-red-fg)', marginTop: 4 }}>
                  Elenco dei conti non letto ({erroreConti}): senza conto l'incasso non si può registrare.{' '}
                  <button type="button" className="btn btn-sm btn-secondary" onClick={caricaConti}>Riprova</button>
                </div>
              ) : senzaConti ? (
                <div role="alert" style={{ fontSize: 11, color: 'var(--pill-amber-fg)', marginTop: 4 }}>
                  Lo studio non ha ancora un conto: l'incasso si registra dopo averne creato uno.{' '}
                  <button type="button" className="btn btn-sm btn-secondary" onClick={() => navigate('/banks')}>Apri Banche e conti</button>
                </div>
              ) : (
                <div style={{ fontSize: 11, color: 'var(--hint)', marginTop: 4 }}>
                  Obbligatorio: il saldo di questo conto sale dell'importo incassato.
                </div>
              )}
            </div>

            <div>
              <label htmlFor="incasso-metodo" style={etichetta}>Metodo Pagamento</label>
              <select id="incasso-metodo" value={metodo} onChange={(e) => setMetodo(e.target.value)} style={campo}>
                <option value="bonifico">Bonifico Bancario</option>
                <option value="carta">Carta di Credito</option>
                <option value="contanti">Contanti</option>
                <option value="assegno">Assegno</option>
              </select>
            </div>

            <div>
              <label htmlFor="incasso-cro" style={etichetta}>CRO / Riferimento Transazione Bancaria</label>
              <input id="incasso-cro" type="text" placeholder="Es. CRO-987654321" value={riferimento} onChange={(e) => setRiferimento(e.target.value)} style={campo} />
            </div>

            <div>
              <label htmlFor="incasso-note" style={etichetta}>Note Operatore (Opzionale)</label>
              <input id="incasso-note" type="text" placeholder="Note interne dell'operatore..." value={note} onChange={(e) => setNote(e.target.value)} style={campo} />
            </div>

            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 10, marginTop: 10 }}>
              <button type="button" className="btn btn-secondary" onClick={richiediChiusura}>Annulla</button>
              <button type="submit" className="btn btn-success" disabled={salvataggio || !contoId}>
                {salvataggio ? 'Registrazione...' : 'Conferma & Scrivi in Prima Nota'}
              </button>
            </div>
          </form>
        </div>
      )}
    </Modal>
  );
}
