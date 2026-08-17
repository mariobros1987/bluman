import React, { useState } from 'react';
import { TEAM, getTeamMembersList } from '../../store/mockData';

interface AvatarProps {
  id: number | string;
  size?: number;
  showTooltip?: boolean;
  showTitle?: boolean;
}

export function Avatar({ id, size = 24, showTooltip = true }: AvatarProps) {
  const [hovered, setHovered] = useState(false);
  const teamList = getTeamMembersList();
  
  // Ricerca intelligente dell'operatore per ID, nome o email
  const m = teamList.find(t => String(t.id) === String(id) || t.n.toLowerCase() === String(id).toLowerCase())
    || TEAM.find(t => String(t.id) === String(id))
    || {
      id: id,
      i: String(id).slice(0, 2).toUpperCase() || 'OP',
      c: '#6366f1',
      n: `Operatore #${id}`,
      r: 'Studio Advisor',
    };

  return (
    <div
      style={{ position: 'relative', display: 'inline-flex' }}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
    >
      <div
        style={{
          width: size,
          height: size,
          borderRadius: '50%',
          background: m.c,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          fontSize: size < 24 ? 9 : size < 32 ? 11 : 13,
          fontWeight: 700,
          color: '#fff',
          flexShrink: 0,
          border: '2px solid var(--card, #1e293b)',
          boxShadow: hovered ? `0 0 10px ${m.c}aa` : '0 2px 4px rgba(0,0,0,0.2)',
          cursor: 'pointer',
          transition: 'all .18s cubic-bezier(0.4, 0, 0.2, 1)',
          transform: hovered ? 'scale(1.14) translateY(-2px)' : 'scale(1)',
          zIndex: hovered ? 50 : 1,
          letterSpacing: '0.4px',
          userSelect: 'none',
        }}
      >
        {m.i}
      </div>

      {/* Floating Interactive Pop-up / Tooltip on Hover */}
      {showTooltip && hovered && (
        <div
          style={{
            position: 'absolute',
            bottom: 'calc(100% + 8px)',
            left: '50%',
            transform: 'translateX(-50%)',
            background: 'rgba(15, 23, 42, 0.96)',
            backdropFilter: 'blur(8px)',
            border: `1px solid ${m.c}88`,
            boxShadow: '0 12px 28px -4px rgba(0, 0, 0, 0.7), 0 0 16px rgba(99, 102, 241, 0.25)',
            borderRadius: 8,
            padding: '7px 12px',
            whiteSpace: 'nowrap',
            zIndex: 99999,
            pointerEvents: 'none',
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            gap: 2,
            minWidth: 130,
            textAlign: 'center',
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6 }}>
            <span style={{ width: 7, height: 7, borderRadius: '50%', background: m.c, flexShrink: 0, boxShadow: `0 0 6px ${m.c}` }} />
            <span style={{ fontSize: 12, fontWeight: 700, color: '#f8fafc' }}>
              {m.n}
            </span>
          </div>
          <div style={{ fontSize: 10, color: '#94a3b8', fontWeight: 500 }}>
            {m.r}
          </div>
          {/* Arrow */}
          <div
            style={{
              position: 'absolute',
              top: '100%',
              left: '50%',
              transform: 'translateX(-50%)',
              width: 0,
              height: 0,
              borderLeft: '5px solid transparent',
              borderRight: '5px solid transparent',
              borderTop: '5px solid rgba(15, 23, 42, 0.96)',
            }}
          />
        </div>
      )}
    </div>
  );
}

interface AvatarGroupProps {
  ids: (number | string)[];
  size?: number;
  showTooltip?: boolean;
}

export function AvatarGroup({ ids = [], size = 24, showTooltip = true }: AvatarGroupProps) {
  const safeIds = Array.isArray(ids) ? ids : [];
  return (
    <div style={{ display: 'flex', alignItems: 'center' }}>
      {safeIds.map((id, i) => (
        <div key={`${id}-${i}`} style={{ marginLeft: i === 0 ? 0 : -6 }}>
          <Avatar id={id} size={size} showTooltip={showTooltip} />
        </div>
      ))}
    </div>
  );
}
