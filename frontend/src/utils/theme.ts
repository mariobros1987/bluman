// Gestione del tema chiaro/scuro/sistema.
// Chiave localStorage: 'bluman-theme' con valori 'light' | 'dark' | 'system'.
// 'system' NON viene salvato come attributo fisso: si risolve a runtime sulla
// preferenza dell'OS e si aggiorna se l'OS cambia (watchSystemTheme).

export type ThemePref = 'light' | 'dark' | 'system';
export type ThemeResolved = 'light' | 'dark';

const KEY = 'bluman-theme';

export function getThemePref(): ThemePref {
  const v = (typeof localStorage !== 'undefined' && localStorage.getItem(KEY)) || 'system';
  return v === 'light' || v === 'dark' ? v : 'system';
}

export function systemPrefersDark(): boolean {
  return typeof matchMedia !== 'undefined' && matchMedia('(prefers-color-scheme: dark)').matches;
}

export function resolveTheme(pref: ThemePref = getThemePref()): ThemeResolved {
  if (pref === 'light' || pref === 'dark') return pref;
  return systemPrefersDark() ? 'dark' : 'light';
}

// Applica il tema risolto all'elemento <html> tramite data-theme.
export function applyTheme(pref: ThemePref = getThemePref()): ThemeResolved {
  const resolved = resolveTheme(pref);
  if (typeof document !== 'undefined') {
    document.documentElement.setAttribute('data-theme', resolved);
  }
  return resolved;
}

export function setThemePref(pref: ThemePref): ThemeResolved {
  if (typeof localStorage !== 'undefined') {
    if (pref === 'system') localStorage.removeItem(KEY);
    else localStorage.setItem(KEY, pref);
  }
  return applyTheme(pref);
}

// Da chiamare una volta a mount dell'app: applica il tema e, quando la
// preferenza è "system", segue i cambi dell'OS in tempo reale.
export function watchSystemTheme(): () => void {
  applyTheme();
  if (typeof matchMedia === 'undefined') return () => {};
  const mq = matchMedia('(prefers-color-scheme: dark)');
  const handler = () => { if (getThemePref() === 'system') applyTheme('system'); };
  mq.addEventListener('change', handler);
  return () => mq.removeEventListener('change', handler);
}
