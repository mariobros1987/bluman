import React from 'react';
import { TEAM } from '../../store/mockData';

interface AvatarProps {
  id: number;
  size?: number;
  showTitle?: boolean;
}

export function Avatar({ id, size = 24, showTitle = true }: AvatarProps) {
  const m = TEAM.find(t => t.id === id) || { i: '?', c: '#888', n: 'Unknown', r: '' };
  return (
    <div
      title={showTitle ? `${m.n} — ${m.r}` : undefined}
      style={{
        width: size, height: size,
        borderRadius: '50%',
        background: m.c,
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        fontSize: size < 24 ? 9 : 11,
        fontWeight: 600, color: '#fff', flexShrink: 0,
        border: '2px solid var(--card)',
      }}
    >
      {m.i}
    </div>
  );
}

interface AvatarGroupProps {
  ids: number[];
  size?: number;
}

export function AvatarGroup({ ids, size = 24 }: AvatarGroupProps) {
  return (
    <div style={{ display: 'flex' }}>
      {ids.map((id, i) => (
        <div key={id} style={{ marginLeft: i === 0 ? 0 : -6 }}>
          <Avatar id={id} size={size} />
        </div>
      ))}
    </div>
  );
}
