import { useState } from 'react';
import { useTeamMembers, extractInitialsFromName } from '../../hooks/useTeamMembers';
import type { PersonaVisualizzata } from '../../types';

interface AvatarProps {
  id: number | string;
  size?: number;
  showTooltip?: boolean;
  showTitle?: boolean;
}

export function Avatar({ id, size = 24, showTooltip = true }: AvatarProps) {
  const [hovered, setHovered] = useState(false);
  const { team: teamList } = useTeamMembers();
  
  // Ricerca robusta nel team caricato dal database
  const idStr = String(id || '').trim().toLowerCase();
  const idNum = typeof id === 'number' ? id : parseInt(idStr.replace(/\D/g, ''), 10);

  // §1ter.6 (C1) — il tipo qui è `PersonaVisualizzata`, non `TeamMember`: questo ripiego
  // disegna qualcuno che **non è** un membro dello studio (un id che non risolve più, un
  // assegnatario storico, un progetto vecchio). Chiedergli un `dbId` costringerebbe a
  // inventarne uno, cioè a rifare l'errore da cui viene questa correzione. Un avatar non
  // assegna lavoro, quindi non gli serve un identificativo di database.
  const m: PersonaVisualizzata = teamList.find(t =>
    String(t.id) === idStr ||
    (idNum && t.id === idNum) ||
    // §1ter.6 (C1) — anche l'uuid. L'API restituisce l'assegnatario di una micro-voce come
    // `risorsa.id` (l'uuid di `bluman_user`), non come id numerico della UI: senza questa
    // riga l'avatar di un compito assegnato non si risolverebbe e mostrerebbe il segnaposto.
    // Cercare qui l'uuid invece di tradurlo a monte è ciò che rende il disegno indipendente
    // dall'ordine di caricamento: questo componente ha un suo `useTeamMembers`, quindi si
    // ri-renderizza quando la squadra arriva, mentre la pagina che ha tradotto l'id una
    // volta sola resterebbe ferma su un valore calcolato prima.
    t.dbId === idStr ||
    t.n.toLowerCase() === idStr ||
    (idStr.includes('mario') && t.n.toLowerCase().includes('mario'))
  ) || {
    id: idNum || 1,
    i: idStr.includes('mario') ? 'MD' : extractInitialsFromName(idStr),
    c: idStr.includes('mario') ? 'var(--indigo-l)' : 'var(--indigo)',
    n: idStr.includes('mario') ? 'Avv. Mario Dibenedetto' : `Operatore Studio #${id || 1}`,
    r: idStr.includes('mario') ? 'Legal Counsel & Partner' : 'Studio Advisor',
  };

  const displayName = m.n || 'Operatore Studio';
  const displayRole = m.r || 'Studio Advisor';
  const displayInitials = m.i || extractInitialsFromName(displayName);
  const displayColor = m.c || 'var(--indigo)';

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
          background: displayColor,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          fontSize: size < 24 ? 9 : size < 32 ? 11 : 13,
          fontWeight: 700,
          color: '#fff',
          flexShrink: 0,
          border: '2px solid var(--card, var(--pill-slate-bg))',
          boxShadow: hovered ? `0 0 12px ${displayColor}bb` : '0 2px 4px rgba(0,0,0,0.2)',
          cursor: 'pointer',
          transition: 'all .18s cubic-bezier(0.4, 0, 0.2, 1)',
          transform: hovered ? 'scale(1.15) translateY(-2px)' : 'scale(1)',
          zIndex: hovered ? 50 : 1,
          letterSpacing: '0.4px',
          userSelect: 'none',
        }}
      >
        {displayInitials}
      </div>

      {/* Floating Interactive Pop-up / Card on Hover */}
      {showTooltip && hovered && (
        <div
          style={{
            position: 'absolute',
            bottom: 'calc(100% + 8px)',
            left: '50%',
            transform: 'translateX(-50%)',
            background: 'rgba(15, 23, 42, 0.96)',
            backdropFilter: 'blur(10px)',
            border: `1px solid ${displayColor}88`,
            boxShadow: '0 12px 28px -4px rgba(0, 0, 0, 0.75), 0 0 16px rgba(99, 102, 241, 0.25)',
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
            <span style={{ width: 7, height: 7, borderRadius: '50%', background: displayColor, flexShrink: 0, boxShadow: `0 0 6px ${displayColor}` }} />
            <span style={{ fontSize: 12, fontWeight: 700, color: 'var(--pill-sky-fg)' }}>
              {displayName}
            </span>
          </div>
          <div style={{ fontSize: 10, color: 'var(--muted)', fontWeight: 500 }}>
            {displayRole}
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
