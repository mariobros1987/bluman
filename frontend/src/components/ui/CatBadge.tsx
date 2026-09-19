import React from 'react';
import { catCls } from '../../utils';
import type { CategoriaModulo } from '../../types';

interface CatBadgeProps {
  cat: CategoriaModulo | string;
}

export function CatBadge({ cat }: CatBadgeProps) {
  const cls = catCls(cat);
  const styles: Record<string, React.CSSProperties> = {
    cA: { background: 'var(--surface-1)', color: 'var(--indigo-l)' },
    cS: { background: 'var(--surface-1)', color: 'var(--cat-societario)' },
    cT: { background: 'var(--pill-indigo-bg)', color: 'var(--purple)' },
    cB: { background: 'var(--pill-green-bg)', color: 'var(--pill-green-fg)' },
    cF: { background: 'var(--pill-amber-bg)', color: 'var(--amber)' },
    cL: { background: 'var(--card)', color: 'var(--muted)' },
    cI: { background: 'var(--pill-purple-bg)', color: 'var(--cat-ip)' },
    cC: { background: 'var(--pill-amber-bg)', color: 'var(--cat-compliance)' },
  };
  return (
    <span style={{
      display: 'inline-flex', alignItems: 'center',
      fontSize: 10, fontWeight: 600,
      padding: '2px 7px', borderRadius: 20,
      ...styles[cls],
    }}>
      {cat}
    </span>
  );
}
