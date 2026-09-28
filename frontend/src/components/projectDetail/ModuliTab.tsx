import { ModuloBlock } from './ModuloBlock';
import type { Progetto, ModuloProgetto } from '../../types';
import styles from '../../pages/ProjectDetail.module.css';

// ─── Tab Moduli & Microvoci ───────────────────────────────────────
export function ModuliTab({
  project,
  expanded,
  rawDbProject,
  onVaiAGrafo,
  onToggle,
  onOpenProc,
  onRefresh,
  onToggleMv,
  onOpenAssignMod,
  onOpenAssignMv,
  onOpenCalendarMv,
  onDeleteMod,
}: {
  project: Progetto;
  expanded: Set<number>;
  rawDbProject?: any;
  onVaiAGrafo: () => void;
  onToggle: (modId: number) => void;
  onOpenProc: (modId: number, vidx: number) => void;
  onRefresh: () => void;
  onToggleMv: (modId: number, vidx: number) => void;
  onOpenAssignMod: (mod: ModuloProgetto) => void;
  onOpenAssignMv: (mod: ModuloProgetto, vidx: number) => void;
  onOpenCalendarMv: (mod: ModuloProgetto, vidx: number) => void;
  onDeleteMod: (mod: ModuloProgetto, mIdx: number) => Promise<void>;
}) {
  return (
    <div>
      {/* Stato vuoto sincero. Prima qui c'era "Inizializzazione Moduli Operativi in
          Corso..." con un pulsante "Istanzia Subito" che scriveva tre moduli cablati
          (Analisi/Societario/Trust, 23.500 € complessivi) con ore GIÀ consuntivate e una
          micro-voce `s: 'done'` — e li salvava nel solo localStorage, mai a database:
          sparivano cambiando browser e la Dashboard non li vedeva. Dichiarava anche "Il
          preventivo è stato accettato dal cliente" senza saperlo. I moduli si aggiungono
          dalla Libreria, che passa dall'API. */}
      {(!project.mods || project.mods.length === 0) ? (
        <div className={styles.emptyMods} style={{ padding: 24, textAlign: 'center' }}>
          <div style={{ fontSize: 32, marginBottom: 8 }}>🗂</div>
          <div style={{ fontSize: 14, fontWeight: 700, marginBottom: 4 }}>Nessun modulo a database per questo progetto</div>
          <div style={{ fontSize: 11, color: 'var(--muted)', maxWidth: 520, margin: '0 auto 16px' }}>
            Il progetto esiste ma non ha ancora moduli operativi: non c'è niente da mostrare —
            né ore, né avanzamento, né importi. I moduli si aggiungono dalla Libreria e vengono
            salvati sul database.
          </div>
          <button
            onClick={onVaiAGrafo}
            style={{ background: 'var(--indigo)', color: '#fff', border: 'none', padding: '10px 22px', borderRadius: 8, fontSize: 12, fontWeight: 700, cursor: 'pointer' }}
          >
            + Aggiungi Modulo da Libreria
          </button>
        </div>
      ) : (
        project.mods.map((mod, mIdx) => (
          <ModuloBlock
            key={mod.id}
            mod={mod}
            open={expanded.has(mod.id)}
            onToggle={() => onToggle(mod.id)}
            onOpenProc={(vidx) => onOpenProc(mod.id, vidx)}
            rawDbModulo={rawDbProject?.moduli?.[mIdx]}
            moduliProgetto={(rawDbProject?.moduli ?? []).map((m: any) => ({ id: m.id, nome: m.nome }))}
            progettoId={rawDbProject?.id}
            onRefresh={onRefresh}
            onToggleMv={(vidx) => onToggleMv(mod.id, vidx)}
            onOpenAssignMod={() => onOpenAssignMod(mod)}
            onOpenAssignMv={(vidx) => onOpenAssignMv(mod, vidx)}
            onOpenCalendarMv={(vidx) => onOpenCalendarMv(mod, vidx)}
            onDeleteMod={() => onDeleteMod(mod, mIdx)}
          />
        ))
      )}
    </div>
  );
}
