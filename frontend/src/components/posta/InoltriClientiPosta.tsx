// La raccolta per inoltro: per ogni cliente, l'indirizzo personale verso cui imposta l'inoltro
// automatico dalla sua casella. Il «+codice» nell'indirizzo è ciò che attribuisce la posta a lui.
import { useMemo, useState } from 'react';
import { impostaInoltroClienteApi, type ClienteInoltro } from '../../api/posta';
import { useConfirm } from '../ui/ConfirmProvider';
import { useToast } from '../ui/ToastProvider';

interface Props {
  /** L'indirizzo della casella di raccolta attiva, o `null` se non ce n'è una. */
  casellaDiRaccolta: string | null;
  clienti: ClienteInoltro[];
  onCambiato: () => void;
}

export function InoltriClientiPosta({ casellaDiRaccolta, clienti, onCambiato }: Props) {
  const toast = useToast();
  const conferma = useConfirm();
  const [cerca, setCerca] = useState('');
  const [occupato, setOccupato] = useState<string | null>(null);

  const visibili = useMemo(() => {
    const ago = cerca.trim().toLowerCase();
    return ago ? clienti.filter((c) => c.nome.toLowerCase().includes(ago) || (c.email ?? '').toLowerCase().includes(ago)) : clienti;
  }, [clienti, cerca]);

  const imposta = async (c: ClienteInoltro, attivo: boolean) => {
    if (!attivo) {
      const ok = await conferma({
        titolo: `Disattivare l’inoltro di ${c.nome}?`,
        messaggio: 'L’indirizzo personale smette di valere: se in seguito lo riattivi ne riceve uno nuovo, e il cliente dovrà aggiornare l’inoltro nella sua casella. I messaggi già raccolti restano.',
        confermaLabel: 'Disattiva',
        pericolo: true,
      });
      if (!ok) return;
    }
    setOccupato(c.id);
    try {
      await impostaInoltroClienteApi(c.id, attivo);
      toast.successo(attivo ? `Inoltro attivato per ${c.nome}.` : `Inoltro disattivato per ${c.nome}.`);
      onCambiato();
    } catch (err) {
      toast.errore(err instanceof Error ? err.message : 'L’inoltro del cliente non è stato aggiornato');
    } finally {
      setOccupato(null);
    }
  };

  const copia = async (indirizzo: string) => {
    try {
      await navigator.clipboard.writeText(indirizzo);
      toast.successo('Indirizzo copiato.');
    } catch {
      // Il browser può negare gli appunti (pagina non sicura, permesso tolto): l'indirizzo resta a schermo da selezionare.
      toast.attenzione('Il browser non ha lasciato copiare: seleziona l’indirizzo a mano.');
    }
  };

  return (
    <section aria-label="Inoltro dei clienti" style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
      <div>
        <div style={{ fontSize: 15, fontWeight: 800, color: 'var(--text)' }}>Inoltro dei clienti</div>
        <div style={{ fontSize: 12, color: 'var(--muted)' }}>
          Per chi non dà le credenziali: il cliente imposta nella sua casella l’inoltro automatico verso il suo indirizzo personale.
          Quello che arriva lì viene attribuito a lui in automatico, perché il codice dopo il «+» è solo suo.
        </div>
      </div>

      {!casellaDiRaccolta && (
        <div role="alert" style={{ background: 'var(--pill-amber-bg)', border: '1px solid var(--pill-amber-bd)', color: 'var(--pill-amber-fg)', borderRadius: 10, padding: 10, fontSize: 12 }}>
          Non c’è una casella di raccolta attiva: senza quella l’indirizzo di inoltro non esiste. Collegala qui sopra come «Casella di raccolta dello studio».
        </div>
      )}

      {clienti.length === 0 ? (
        <div style={{ border: '1px dashed var(--border)', borderRadius: 12, padding: 20, textAlign: 'center', color: 'var(--muted)', fontSize: 13 }}>Nessun cliente in anagrafica.</div>
      ) : (
        <>
          {clienti.length > 8 && (
            <input aria-label="Cerca un cliente" value={cerca} onChange={(e) => setCerca(e.target.value)} placeholder="Cerca un cliente" style={{ padding: 8, fontSize: 13, maxWidth: 280 }} />
          )}
          {visibili.length === 0 && <div style={{ fontSize: 13, color: 'var(--muted)' }}>Nessun cliente con questo nome.</div>}
          {visibili.map((c) => (
            <div key={c.id} style={{ background: 'var(--card2)', border: '1px solid var(--border)', borderRadius: 12, padding: 12, display: 'flex', justifyContent: 'space-between', gap: 12, alignItems: 'center', flexWrap: 'wrap' }}>
              <div style={{ minWidth: 0, flex: '1 1 260px' }}>
                <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--text)' }}>{c.nome}</div>
                <div style={{ fontSize: 12, color: 'var(--muted)', overflowWrap: 'anywhere' }}>{c.email || 'Indirizzo email non indicato in anagrafica'}</div>
                {c.aliasPosta && (
                  <div style={{ fontSize: 12, marginTop: 6, display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
                    {c.indirizzoInoltro ? (
                      <>
                        <span style={{ color: 'var(--muted)' }}>Inoltra a</span>
                        <code style={{ color: 'var(--text)', fontWeight: 600, overflowWrap: 'anywhere' }}>{c.indirizzoInoltro}</code>
                        <button type="button" className="btn btn-sm btn-secondary" onClick={() => void copia(c.indirizzoInoltro as string)}>Copia</button>
                      </>
                    ) : (
                      <span style={{ color: 'var(--pill-amber-fg)' }}>Inoltro attivo, ma manca la casella di raccolta: l’indirizzo compare quando la colleghi.</span>
                    )}
                  </div>
                )}
              </div>
              <button type="button" className={`btn btn-sm ${c.aliasPosta ? 'btn-secondary' : 'btn-primary'}`} disabled={occupato !== null} onClick={() => void imposta(c, !c.aliasPosta)}>
                {occupato === c.id ? 'Attendi…' : c.aliasPosta ? 'Disattiva l’inoltro' : 'Attiva l’inoltro'}
              </button>
            </div>
          ))}
        </>
      )}

      <div style={{ fontSize: 11, color: 'var(--muted)' }}>
        Se il fornitore della casella di raccolta non consegna gli indirizzi con il «+», BluMan riconosce comunque il cliente dal suo indirizzo
        in anagrafica, quando è fra i destinatari o è il mittente. Quello che non riconosce resta in «Da smistare» e si attribuisce a mano.
      </div>
    </section>
  );
}
