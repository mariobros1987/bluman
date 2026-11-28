// La riga, sopra i moduli, che dice allo studio cosa è in mano al cliente: quanti passaggi «a carico
// del cliente» sono aperti, quanti hanno già una sua risposta da controllare, e il tasto per
// avvisarlo. L'avviso è un gesto dell'operatore e non parte a ogni salvataggio: così il cliente
// riceve un avviso solo quando lo studio ha finito di preparare le richieste.
import { useState } from 'react';
import { avvisaClienteRichiesteApi } from '../../api/canaleProtetto';

interface PassaggioLetto {
  chi?: string;
  stato?: string;
  rispostaClienteAt?: string | null;
}

/** I passaggi a carico del cliente non ancora chiusi, letti dal progetto com'è a database. */
function passaggiDelClienteAperti(moduli: unknown): PassaggioLetto[] {
  if (!Array.isArray(moduli)) return [];
  return moduli
    .flatMap((modulo) => (Array.isArray(modulo?.microvoci) ? modulo.microvoci : []))
    .flatMap((microvoce) => (Array.isArray(microvoce?.passaggi) ? (microvoce.passaggi as PassaggioLetto[]) : []))
    .filter((passaggio) => passaggio?.chi === 'cliente' && passaggio.stato !== 'done');
}

export function RichiesteAlCliente({ progettoId, moduli }: { progettoId?: string; moduli: unknown }) {
  const [invio, setInvio] = useState(false);
  const [esito, setEsito] = useState<{ tipo: 'ok' | 'err'; testo: string } | null>(null);

  const aperti = passaggiDelClienteAperti(moduli);
  if (!progettoId || aperti.length === 0) return null;
  const conRisposta = aperti.filter((p) => Boolean(p.rispostaClienteAt)).length;

  const avvisa = async () => {
    setInvio(true);
    setEsito(null);
    try {
      const { richieste } = await avvisaClienteRichiesteApi(progettoId);
      setEsito({
        tipo: 'ok',
        testo: `Cliente avvisato: ${richieste === 1 ? '1 richiesta' : `${richieste} richieste`} da completare. Lo vede nel portale, alla scheda «Da fare».`,
      });
    } catch (err) {
      setEsito({ tipo: 'err', testo: err instanceof Error ? err.message : 'Il cliente non è stato avvisato.' });
    } finally {
      setInvio(false);
    }
  };

  return (
    <div style={{ background: 'var(--card)', border: '1px solid var(--border)', borderRadius: 10, padding: '10px 14px', marginBottom: 12 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
        <div style={{ fontSize: 12, color: 'var(--text)' }}>
          <strong>📝 In mano al cliente:</strong>{' '}
          {aperti.length === 1 ? '1 passaggio aperto' : `${aperti.length} passaggi aperti`}
          {conRisposta > 0 && (
            <span style={{ color: 'var(--amber)', fontWeight: 700 }}>
              {' '}· {conRisposta === 1 ? '1 ha già la sua risposta' : `${conRisposta} hanno già la sua risposta`}: controllala dalla voce e chiudi il passaggio col ✓
            </span>
          )}
        </div>
        <button
          type="button"
          className="btn btn-sm"
          onClick={avvisa}
          disabled={invio}
          title="Manda al cliente un avviso nel portale, e un'email se non ne ha già uno da leggere: dice quante richieste ha da completare, non cosa contengono. Conta i passaggi «a carico del cliente» salvati, senza risposta, nelle fasi già avviate."
        >
          {invio ? 'Avviso…' : '📣 Avvisa il cliente'}
        </button>
      </div>
      {esito && (
        <div role={esito.tipo === 'err' ? 'alert' : 'status'} style={{ fontSize: 11, marginTop: 6, color: esito.tipo === 'err' ? 'var(--red)' : 'var(--green)' }}>
          {esito.testo}
        </div>
      )}
    </div>
  );
}
