// La scheda «Da fare»: ciò che lo studio chiede al cliente, fase per fase.
//
// Sono i passaggi «a carico del cliente» che lo studio mette nelle attività di ogni fase: dati da
// compilare, documenti da rimandare, cose da confermare. L'elenco e il loro stato arrivano dal
// server con il riepilogo; qui si ordinano in quattro gruppi e si risponde.
import type { RichiestaCliente } from '../../api/canaleProtetto';
import { SchedaRichiesta } from './SchedaRichiesta';
import { docBoxStyle } from './styles';
import type { StatoRiepilogo } from './usePortalRiepilogo';

export interface TabRichiesteProps {
  stato: StatoRiepilogo;
  ricarica: () => void;
  anteprima: boolean;
}

function Gruppo({ titolo, spiegazione, richieste, nomiIncarichi, anteprima, onInviata }: {
  titolo: string;
  spiegazione: string;
  richieste: RichiestaCliente[];
  /** Con più incarichi ogni richiesta dichiara a quale appartiene. */
  nomiIncarichi: Map<string, string> | null;
  anteprima: boolean;
  onInviata: () => void;
}) {
  if (richieste.length === 0) return null;
  return (
    <section style={{ marginTop: 20 }}>
      <h3 style={{ fontSize: 13, fontWeight: 800, margin: '0 0 2px' }}>{titolo} ({richieste.length})</h3>
      <div style={{ fontSize: 11.5, color: 'var(--muted)', marginBottom: 10 }}>{spiegazione}</div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
        {richieste.map((r) => (
          <div key={r.id}>
            {nomiIncarichi && <div style={{ fontSize: 10.5, color: 'var(--muted)', fontWeight: 700, margin: '0 0 4px 2px' }}>Incarico: {nomiIncarichi.get(r.progettoId)}</div>}
            {/* La chiave porta lo stato: dopo l'invio la scheda riparte dai dati appena riletti. */}
            <SchedaRichiesta key={`${r.id}-${r.stato}-${r.inviataIl ?? ''}`} richiesta={r} anteprima={anteprima} onInviata={onInviata} />
          </div>
        ))}
      </div>
    </section>
  );
}

export function TabRichieste({ stato, ricarica, anteprima }: TabRichiesteProps) {
  if (stato.fase === 'caricamento') {
    return <div style={{ ...docBoxStyle, textAlign: 'center', color: 'var(--muted)', fontSize: 13 }}>⏳ Leggo le richieste dello studio…</div>;
  }
  if (stato.fase === 'errore') {
    return (
      <div style={docBoxStyle} role="alert">
        <div style={{ fontSize: 14, fontWeight: 700, marginBottom: 6 }}>Le richieste dello studio non si sono potute leggere</div>
        <div style={{ fontSize: 12, color: 'var(--muted)', marginBottom: 12 }}>{stato.messaggio} Non vuol dire che non ce ne siano: riprova.</div>
        <button type="button" className="btn btn-primary btn-sm" onClick={ricarica}>Riprova</button>
      </div>
    );
  }

  const progetti = stato.dati.progetti;
  const tutte = progetti.flatMap((p) => p.richieste);
  const nomiIncarichi = progetti.length > 1 ? new Map(progetti.map((p) => [p.id, p.nome])) : null;
  const daFare = tutte.filter((r) => r.stato === 'da_fare' && r.quando === 'ora');
  const piuAvanti = tutte.filter((r) => r.stato === 'da_fare' && r.quando === 'piu_avanti');
  const inviate = tutte.filter((r) => r.stato === 'inviata');
  const chiuse = tutte.filter((r) => r.stato === 'chiusa');
  const comuni = { nomiIncarichi, anteprima, onInviata: ricarica };

  return (
    <div style={docBoxStyle}>
      <h2 style={{ fontSize: 15, fontWeight: 800, margin: '0 0 4px' }}>📝 Da fare: le richieste dello studio</h2>
      <div style={{ fontSize: 11.5, color: 'var(--muted)', lineHeight: 1.5 }}>
        Per ogni fase dell'incarico lo studio può chiederti dei dati, un documento da compilare o una conferma. Rispondi da qui: dati e file arrivano allo studio nel canale protetto.
      </div>

      {tutte.length === 0 && (
        <div style={{ background: 'var(--card2)', border: '1px dashed var(--border)', borderRadius: 12, padding: 18, fontSize: 12.5, color: 'var(--muted)', lineHeight: 1.6, marginTop: 16 }}>
          Lo studio non ti ha chiesto niente, per ora. Quando ti serve fare qualcosa lo trovi qui e ricevi un avviso per email.
        </div>
      )}
      {tutte.length > 0 && daFare.length === 0 && (
        <div style={{ background: 'var(--pill-green-bg)', border: '1px solid var(--green)', borderRadius: 12, padding: '12px 16px', fontSize: 12.5, marginTop: 16 }}>
          ✓ Non hai richieste da evadere adesso.
        </div>
      )}

      <Gruppo titolo="Da fare adesso" spiegazione="Riguardano fasi già avviate: lo studio aspetta te per andare avanti." richieste={daFare} {...comuni} />
      <Gruppo titolo="Inviate, in controllo" spiegazione="Hai già risposto: lo studio le sta controllando. Finché non le chiude puoi correggerle." richieste={inviate} {...comuni} />
      <Gruppo titolo="Più avanti" spiegazione="Sono di fasi non ancora partite. Puoi già rispondere, ma non è urgente: lo studio le userà quando la fase inizia." richieste={piuAvanti} {...comuni} />
      <Gruppo titolo="Chiuse" spiegazione="Lo studio le ha controllate e chiuse." richieste={chiuse} {...comuni} />
    </div>
  );
}
