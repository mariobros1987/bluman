import React from 'react';
import { catCls } from '../../utils';
import type { CategoriaModulo } from '../../types';

interface CatBadgeProps {
  cat: CategoriaModulo | string;
}

export function CatBadge({ cat }: CatBadgeProps) {
  const cls = catCls(cat);
  const styles: Record<string, React.CSSProperties> = {
    cA: { background: '#1a1f3d', color: '#818cf8' },
    cS: { background: '#0d2233', color: '#60b8f4' },
    cT: { background: '#200f40', color: '#a78bfa' },
    cB: { background: '#0d2d22', color: '#34d399' },
    cF: { background: '#2d2000', color: '#f59e0b' },
    cL: { background: '#1e2030', color: '#94a3b8' },
    cI: { background: '#2d0d25', color: '#f472b6' },
    cC: { background: '#1a1208', color: '#fb923c' },
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
