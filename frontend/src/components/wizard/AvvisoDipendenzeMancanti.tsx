// Nuovo progetto: se un modulo scelto di solito viene dopo un altro che non è stato scelto, lo si
// dice e si offre di aggiungerlo (titolare, 28/11/2026: avviso, non blocco). Il progetto si crea
// comunque.
import { dipendenzeMancanti } from '../../utils/dipendenzeModuli';

interface ModuloDelWizard { id: string; n: string; deps?: ReadonlyArray<string> | null }

export function AvvisoDipendenzeMancanti<M extends ModuloDelWizard>({ scelti, libreria, onAggiungi }: {
  scelti: ReadonlyArray<M>;
  libreria: ReadonlyArray<M>;
  onAggiungi: (idModulo: string) => void;
}) {
  const avvisi = dipendenzeMancanti(scelti, libreria);
  if (avvisi.length === 0) return null;
  return (
    <div role="status" style={{ background: 'var(--pill-amber-bg)', color: 'var(--pill-amber-fg)', border: '1px solid var(--pill-amber-bd)', borderRadius: 10, padding: '10px 14px', marginBottom: 14, fontSize: 12, lineHeight: 1.5 }}>
      {avvisi.flatMap(({ modulo, mancanti }) =>
        mancanti.map((prima) => (
          <div key={`${modulo.id}-${prima.id}`} style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap', padding: '2px 0' }}>
            <span>
              ⚠ «{modulo.n}» di solito viene dopo «{prima.n}»: aggiungerlo?
            </span>
            <button type="button" className="btn btn-sm btn-secondary" style={{ marginLeft: 'auto' }} onClick={() => onAggiungi(prima.id)}>
              Aggiungi «{prima.n}»
            </button>
          </div>
        )),
      )}
      <div style={{ fontSize: 11, opacity: 0.85, marginTop: 4 }}>
        È un avviso: il progetto si può creare anche senza.
      </div>
    </div>
  );
}
