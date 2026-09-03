interface ProgressBarProps {
  value: number;       // 0-100
  color?: string;
  height?: number;
}

export function ProgressBar({ value, color = '#6366f1', height = 4 }: ProgressBarProps) {
  return (
    <div style={{ height, background: 'var(--border)', borderRadius: 2 }}>
      <div style={{
        height, width: `${Math.min(100, Math.max(0, value))}%`,
        background: color, borderRadius: 2,
        transition: 'width .3s ease',
      }} />
    </div>
  );
}
