// Utility helpers

import { API_BASE } from '../api/http';
import type { CategoriaModulo, StatoModulo, StatoMicrovoce, StatoProgetto, Articolo, ModuloTemplate, Progetto } from '../types';

// ─── Formatters ───────────────────────────────────────────────────
export const fmt = (n: number) => '€ ' + n.toLocaleString('it-IT');

// Normalizza un URL logo già scelto. NON inventa un default: un logo mancante
// resta vuoto, e sta al chiamante decidere il ripiego (per Bluecode `/logo.png`
// via getBrandLogoFallback, per gli altri studi il nome). Prima qui si tornava
// sempre `/logo.png`, il marchio Bluecode, che così trapelava su ogni tenant.
export function getFormattedLogoUrl(url?: string | null): string {
  if (!url || url.trim() === '') return '';
  if (url.startsWith('data:') || url.startsWith('http://') || url.startsWith('https://')) return url;
  // `API_BASE` e non l'indirizzo di Railway scritto a mano. Il backend salva i loghi del
  // ripiego locale come percorsi **relativi** (`/uploads/<nome>?firma=…`, da
  // `storageService.urlUploadFirmato`), e il commento lì accanto dice che a risolverli è
  // proprio questa funzione. Con l'indirizzo fisso, sul VPS — dove `API_BASE` è `/api`, il
  // prefisso che nginx toglie prima di consegnare la richiesta all'API — il logo veniva
  // chiesto a Railway, che è **un altro database con un altro volume**: il logo spariva.
  // Su Vercel l'indirizzo fisso coincide con `API_BASE` ed è corretto per caso, ed è il
  // motivo per cui il difetto non si era mai visto. Stessa risoluzione di `urlFileArchivio`
  // e `urlDocumentoAssoluto`: una sola regola in un solo posto.
  if (url.startsWith('/uploads')) return `${API_BASE}${url}`;
  return url;
}

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

export function resolveRighe(m: ModuloTemplate, articlesPool?: Articolo[]): ResolvedRiga[] {
  if (!m || !m.righe) return [];
  const pool = articlesPool && articlesPool.length > 0 ? articlesPool : [];
  return m.righe.map(r => {
    const embedded = (r as any).artObj;
    const foundInPool = pool.find(a => a.id === r.art);

    const art: Articolo = embedded || foundInPool || {
      id: r.art,
      n: (r as any).artName || 'Prestazione',
      cat: (m.cat || 'Societario') as CategoriaModulo,
      h: 5,
      p: 500,
      ver: 1,
    };
    const qty = r.qty || 1;
    const h = (r.oO != null ? r.oO : (art.h || 0)) * qty;
    const p = (r.oP != null ? r.oP : (art.p || 0)) * qty;
    return { art, qty, h, p, override: r.oO != null || r.oP != null };
  });
}

/**
 * Nome file leggibile per l'utente: dal nome grezzo o dall'URL toglie query (`?token=…`),
 * percorso, prefisso tenant-UUID (`00000000-…-000000000001_`) e prefisso timestamp (`1790…_`),
 * e accorcia un eventuale UUID nudo. Un nome normale («memorandum-struttura.pdf») resta intatto.
 * A video prima usciva l'intera stringa con tenant, timestamp e token — illeggibile.
 */
export function nomeFileLeggibile(nomeOrUrl?: string | null, fileUrl?: string | null): string {
  const grezzo = (nomeOrUrl && nomeOrUrl.trim()) || fileUrl || '';
  let base = grezzo.split('?')[0].split('/').pop() || '';
  try { base = decodeURIComponent(base); } catch { /* lascia base com'è */ }
  base = base.replace(/^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}_/, ''); // tenant UUID
  base = base.replace(/^\d{6,}_/, ''); // timestamp dell'upload
  base = base.replace(/^([0-9a-f]{8})[0-9a-f-]{20,}(\.[a-z0-9]+)?$/i, 'Documento $1$2'); // UUID nudo
  return base.trim() || 'Documento';
}

export function moduloH(m: ModuloTemplate, articlesPool?: Articolo[]): number {
  return resolveRighe(m, articlesPool).reduce((a, r) => a + r.h, 0);
}

export function moduloP(m: ModuloTemplate, articlesPool?: Articolo[]): number {
  return m.pkg != null ? m.pkg : resolveRighe(m, articlesPool).reduce((a, r) => a + r.p, 0);
}

// ─── Topological sort for library graph ───────────────────────────
export function levelOf(id: string, list?: ModuloTemplate[]): number {
  const pool = list || [];
  const m = pool.find(x => x.id === id);
  if (!m || !m.deps || !m.deps.length) return 0;
  return 1 + Math.max(...m.deps.map(d => levelOf(d, pool)), 0);
}

// ─── Iniziali per avatar ──────────────────────────────────────────
// Estratta dal vecchio store mock: è logica pura (titoli professionali, iniziali),
// non dati, quindi resta qui anche dopo la rimozione di mockData.ts.
export function extractInitialsFromName(name: string): string {
  if (!name) return 'OP';
  // Rimuovi prefissi e titoli professionali
  const clean = name.replace(/^(avv\.?|dr\.?|dott\.?|dott\.ssa|ing\.?|rag\.?|prof\.?|avvocato|dottore)\s+/i, '').trim();
  const parts = clean.split(/\s+/).filter(Boolean);
  if (parts.length === 0) return 'OP';
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}
