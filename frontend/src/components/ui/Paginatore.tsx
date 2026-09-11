import type { MetaPaginazione } from '../../api/paginazione';

interface PaginatoreProps {
  meta: MetaPaginazione;
  onPageChange: (page: number) => void;
  onLimitChange: (limit: number) => void;
}

export function Paginatore({ meta, onPageChange, onLimitChange }: PaginatoreProps) {
  const primaRiga = meta.totale === 0 ? 0 : (meta.page - 1) * meta.limit + 1;
  const ultimaRiga = Math.min(meta.page * meta.limit, meta.totale);

  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12, flexWrap: 'wrap', marginTop: 16 }}>
      <span style={{ color: 'var(--muted)', fontSize: 12 }}>
        {primaRiga}–{ultimaRiga} di {meta.totale}
      </span>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <label style={{ color: 'var(--muted)', fontSize: 12 }}>
          Righe{' '}
          <select
            value={meta.limit}
            onChange={(event) => onLimitChange(Number(event.target.value))}
            style={{ padding: '6px 8px', borderRadius: 6, border: '1px solid var(--border)', background: 'var(--card2)', color: 'var(--text)' }}
          >
            {[25, 50, 100, 200].map((limit) => <option key={limit} value={limit}>{limit}</option>)}
          </select>
        </label>
        <button type="button" disabled={meta.page <= 1} onClick={() => onPageChange(meta.page - 1)}>
          ← Precedente
        </button>
        <span style={{ minWidth: 90, textAlign: 'center', fontSize: 12 }}>
          Pagina {meta.pagine === 0 ? 0 : meta.page} di {meta.pagine}
        </span>
        <button type="button" disabled={meta.pagine === 0 || meta.page >= meta.pagine} onClick={() => onPageChange(meta.page + 1)}>
          Successiva →
        </button>
      </div>
    </div>
  );
}
