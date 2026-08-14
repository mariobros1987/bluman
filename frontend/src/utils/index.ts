// Utility helpers

import type { CategoriaModulo, StatoModulo, StatoMicrovoce, StatoProgetto, Articolo, ModuloTemplate, Progetto } from '../types';
import { ARTICOLI, MLIB } from '../store/mockData';

// ─── Formatters ───────────────────────────────────────────────────
export const fmt = (n: number) => '€ ' + n.toLocaleString('it-IT');

// ─── Category color class ─────────────────────────────────────────
export function catCls(cat: CategoriaModulo | string): string {
  const map: Record<string, string> = {
    Analisi: 'cA', Societario: 'cS', Trust: 'cT', Banking: 'cB',
    Fiscale: 'cF', Legale: 'cL', IP: 'cI', Compliance: 'cC',
  };
  return map[cat] || 'cL';
}

// ─── Status config ────────────────────────────────────────────────
interface StatusConfig { label: string; bg: string; color: string; }

export function statoConfig(s: StatoModulo | StatoMicrovoce | StatoProgetto | string): StatusConfig {
  const map: Record<string, StatusConfig> = {
    done:               { label: 'Completato',       bg: '#0d2d22', color: '#34d399' },
    completed:          { label: 'Completato',       bg: '#0d2d22', color: '#34d399' },
    in_progress:        { label: 'In corso',         bg: '#1a1f3d', color: '#818cf8' },
    active:             { label: 'In corso',         bg: '#1a1f3d', color: '#818cf8' },
    pending:            { label: 'In attesa',        bg: '#1e2030', color: '#7b7f9e' },
    delayed:            { label: 'Ritardo',          bg: '#2d1a05', color: '#f59e0b' },
    blocked:            { label: 'Bloccato',         bg: '#2d0d0d', color: '#f87171' },
    pre_project:        { label: 'Pre-progetto',     bg: '#20134a', color: '#a78bfa' },
    attesa_dipendenza:  { label: 'Attesa dipendenza',bg: '#241a3d', color: '#a78bfa' },
  };
  return map[s] || map.pending;
}

// ─── Progress bar color ───────────────────────────────────────────
export function progressColor(p: Progetto | null): string {
  if (!p) return '#6366f1';
  if (p.mods?.some(m => m.st === 'blocked')) return '#ef4444';
  if (p.delay) return '#f59e0b';
  if (p.mods?.some(m => m.waitDep)) return '#a78bfa';
  if (p.st === 'completed') return '#10b981';
  return '#6366f1';
}

// ─── Library helpers ─────────────────────────────────────────────
interface ResolvedRiga { art: Articolo; qty: number; h: number; p: number; override: boolean; }

export function resolveRighe(m: ModuloTemplate): ResolvedRiga[] {
  return m.righe.map(r => {
    const art = ARTICOLI.find(a => a.id === r.art)!;
    const qty = r.qty || 1;
    const h = (r.oO != null ? r.oO : art.h) * qty;
    const p = (r.oP != null ? r.oP : art.p) * qty;
    return { art, qty, h, p, override: r.oO != null || r.oP != null };
  });
}

export function moduloH(m: ModuloTemplate): number {
  return resolveRighe(m).reduce((a, r) => a + r.h, 0);
}

export function moduloP(m: ModuloTemplate): number {
  return m.pkg != null ? m.pkg : resolveRighe(m).reduce((a, r) => a + r.p, 0);
}

// ─── Topological sort for library graph ───────────────────────────
const lvlCache: Record<string, number> = {};
export function levelOf(id: string): number {
  if (lvlCache[id] !== undefined) return lvlCache[id];
  const m = MLIB.find(x => x.id === id);
  if (!m || !m.deps.length) { lvlCache[id] = 0; return 0; }
  lvlCache[id] = 1 + Math.max(...m.deps.map(levelOf));
  return lvlCache[id];
}
