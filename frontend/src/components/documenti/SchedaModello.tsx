// §41 — La scheda di un modello nella cartella dello studio.
//
// Dice tre cose che servono per decidere se usare quella carta: com'è intitolata, se qualcuno
// l'ha riletta (badge di revisione, con chi e quando nel tooltip) e che livello di firma esige
// il documento che ne nascerà. Niente conteggi ricostruiti a schermo: quello che si legge qui
// arriva dalla riga a database, e dove il dato non c'è si scrive che non c'è.

import { BadgeRevisione } from '../ui/BadgeRevisione';
import type { DocumentTemplate } from '../../utils/documentTemplates';

const ETICHETTA_FIRMA: Record<string, string> = {
  ses: 'SES — firma semplice',
  fea: 'FEA — firma avanzata',
  feq: 'FEQ — firma qualificata',
};

const bottone: React.CSSProperties = {
  border: '1px solid var(--border)',
  background: 'var(--card2)',
  color: 'var(--text)',
  padding: '5px 10px',
  borderRadius: 8,
  fontSize: 11,
  fontWeight: 600,
  cursor: 'pointer',
};

interface Props {
  modello: DocumentTemplate;
  /** Vero mentre un'operazione su QUESTO modello è in corso: i pulsanti si spengono. */
  occupato?: boolean;
  onApri: () => void;
  onRevisiona: () => void;
  onArchivia: (archiviato: boolean) => void;
  onElimina: () => void;
}

export function SchedaModello({ modello, occupato = false, onApri, onRevisiona, onArchivia, onElimina }: Props) {
  const archiviato = Boolean(modello.archiviato);

  return (
    <div
      style={{
        background: 'var(--card2)',
        border: `1px solid ${archiviato ? '#3f3f46' : 'var(--border)'}`,
        borderRadius: 12,
        padding: 14,
        display: 'flex',
        flexDirection: 'column',
        gap: 10,
        opacity: archiviato ? 0.72 : 1,
      }}
    >
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 10 }}>
        <div style={{ minWidth: 0 }}>
          <div style={{ fontSize: 13.5, fontWeight: 700, lineHeight: 1.35 }}>{modello.titolo}</div>
          <div style={{ fontSize: 11, color: 'var(--muted)', marginTop: 3, textTransform: 'uppercase', letterSpacing: 0.3 }}>
            {modello.categoria}
          </div>
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 5, flexShrink: 0 }}>
          <BadgeRevisione modello={modello} />
          {archiviato && (
            <span style={{ fontSize: 9, fontWeight: 700, color: '#a1a1aa', background: '#27272a', border: '1px solid #3f3f46', padding: '1px 6px', borderRadius: 20 }}>
              🗄 Archiviato
            </span>
          )}
          {modello.soloLocale && (
            <span
              title="Questo modello esiste solo in questo browser: non ha una riga nell'archivio dello studio."
              style={{ fontSize: 9, fontWeight: 700, color: '#fcd34d', background: '#2d2000', border: '1px solid #713f12', padding: '1px 6px', borderRadius: 20 }}
            >
              ⚠ Solo su questo computer
            </span>
          )}
        </div>
      </div>

      {modello.descrizione ? (
        <div style={{ fontSize: 11.5, color: 'var(--muted)', lineHeight: 1.5 }}>{modello.descrizione}</div>
      ) : (
        <div style={{ fontSize: 11.5, color: 'var(--muted)', fontStyle: 'italic' }}>Nessuna descrizione.</div>
      )}

      {modello.noteRevisione ? (
        <div style={{ fontSize: 11, color: '#cbd5e1', background: 'var(--card)', border: '1px solid var(--border)', borderRadius: 8, padding: '6px 8px', lineHeight: 1.5 }}>
          <strong style={{ color: 'var(--muted)' }}>Nota di revisione:</strong> {modello.noteRevisione}
        </div>
      ) : null}

      <div style={{ fontSize: 10.5, color: 'var(--muted)' }}>
        ✍ {ETICHETTA_FIRMA[modello.livelloFirmaRichiesto || 'ses'] || modello.livelloFirmaRichiesto}
      </div>

      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', borderTop: '1px solid var(--border)', paddingTop: 10 }}>
        <button
          type="button"
          onClick={onApri}
          disabled={occupato}
          style={{ ...bottone, background: 'var(--indigo)', border: 'none', color: '#fff' }}
          title="Apre il modello in Document Studio"
        >
          📝 Apri in Document Studio
        </button>
        <button
          type="button"
          onClick={onRevisiona}
          disabled={occupato}
          style={bottone}
          title="Registra lo stato di revisione: chi ha riletto la carta, quando e con quale nota"
        >
          🔎 Revisione
        </button>
        <button
          type="button"
          onClick={() => onArchivia(!archiviato)}
          disabled={occupato}
          style={bottone}
          title={archiviato ? 'Rimette il modello fra quelli attivi' : 'Lo toglie dagli elenchi operativi di tutto lo studio, conservandolo'}
        >
          {archiviato ? '♻️ Ripristina' : '🗄 Archivia'}
        </button>
        {!modello.diSerie && !modello.soloLocale && (
          <button
            type="button"
            onClick={onElimina}
            disabled={occupato}
            style={{ ...bottone, background: '#2a1218', border: '1px solid #5b2130', color: '#f87171' }}
            title="Elimina la riga del modello. I documenti già generati nei progetti restano invariati."
          >
            🗑 Elimina
          </button>
        )}
      </div>
    </div>
  );
}
