import { statoConfig } from '../../utils';

interface BadgeProps {
  stato: string;
  size?: 'sm' | 'md';
}

export function Badge({ stato, size = 'md' }: BadgeProps) {
  const { label, bg, color } = statoConfig(stato);
  const padding = size === 'sm' ? '2px 7px' : '3px 9px';
  const fontSize = size === 'sm' ? '10px' : '10px';

  return (
    <span style={{
      display: 'inline-flex', alignItems: 'center', gap: '5px',
      padding, borderRadius: '20px', fontSize, fontWeight: 700,
      background: bg, color,
    }}>
      <span style={{ width: 5, height: 5, borderRadius: '50%', background: color, flexShrink: 0 }} />
      {label}
    </span>
  );
}
