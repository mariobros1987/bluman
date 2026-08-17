import React from 'react';
import { TEAM, getTeamMembersList } from '../../store/mockData';

interface AvatarProps {
  id: number | string;
  size?: number;
  showTitle?: boolean;
}

export function Avatar({ id, size = 24, showTitle = true }: AvatarProps) {
  const teamList = getTeamMembersList();
  const m = teamList.find(t => String(t.id) === String(id) || t.n.toLowerCase() === String(id).toLowerCase())
    || TEAM.find(t => String(t.id) === String(id))
    || { i: String(id).slice(0, 2).toUpperCase() || '?', c: '#6366f1', n: `Operatore #${id}`, r: 'Studio Advisor' };
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
  ids: (number | string)[];
  size?: number;
}

export function AvatarGroup({ ids = [], size = 24 }: AvatarGroupProps) {
  const safeIds = Array.isArray(ids) ? ids : [];
  return (
    <div style={{ display: 'flex' }}>
      {safeIds.map((id, i) => (
        <div key={`${id}-${i}`} style={{ marginLeft: i === 0 ? 0 : -6 }}>
          <Avatar id={id} size={size} />
        </div>
      ))}
    </div>
  );
}
