import { useEffect, useState } from 'react';
import { getThemePref, setThemePref, type ThemePref } from '../../utils/theme';

// Toggle a 3 stati: Sistema → Chiaro → Scuro → Sistema.
const ORDINE: ThemePref[] = ['system', 'light', 'dark'];
const META: Record<ThemePref, { icona: string; label: string }> = {
  system: { icona: '💻', label: 'Tema: Sistema' },
  light:  { icona: '☀️', label: 'Tema: Chiaro' },
  dark:   { icona: '🌙', label: 'Tema: Scuro' },
};

export function ThemeToggle() {
  const [pref, setPref] = useState<ThemePref>('system');

  useEffect(() => { setPref(getThemePref()); }, []);

  const ciclo = () => {
    const next = ORDINE[(ORDINE.indexOf(pref) + 1) % ORDINE.length];
    setThemePref(next);
    setPref(next);
  };

  const meta = META[pref];
  return (
    <button
      onClick={ciclo}
      title={`${meta.label} — clicca per cambiare`}
      aria-label={meta.label}
      style={{
        background: 'var(--card2)',
        border: '1px solid var(--border)',
        color: 'var(--text)',
        borderRadius: 20,
        padding: '4px 10px',
        fontSize: 14,
        lineHeight: 1,
        cursor: 'pointer',
        display: 'flex',
        alignItems: 'center',
        gap: 6,
        transition: 'all var(--t)',
      }}
    >
      <span aria-hidden>{meta.icona}</span>
    </button>
  );
}
