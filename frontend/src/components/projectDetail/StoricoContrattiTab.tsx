import { fmt } from '../../utils';
import { RichiesteAddendumTab } from './RichiesteAddendumTab';
import type { Progetto } from '../../types';

// ─── Tab Storico Contrattuale & Cronologia Addendum ───────────────
export function StoricoContrattiTab({
  project,
}: {
  project: Progetto;
}) {
  return (
    <div style={{ background: 'var(--card)', border: '1px solid var(--border)', borderRadius: 14, padding: 20 }}>
      <div style={{ fontSize: 16, fontWeight: 700, marginBottom: 4 }}>📜 Storico Contrattuale & Cronologia Addendum d'Ordine</div>
      <div style={{ fontSize: 11, color: 'var(--muted)', marginBottom: 20 }}>
        Registro delle versioni contrattuali, firma elettronica semplice ed addendum d'ordine per <strong>{project.cl}</strong> (Incarico: <em>{project.n}</em>).
      </div>

      {/* Baseline Contratto Iniziale */}
      <div style={{
        background: project.st === 'pre_project' ? 'rgba(217, 119, 6, 0.08)' : 'var(--pill-green-bg)',
        border: `1px solid ${project.st === 'pre_project' ? 'var(--amber)' : 'var(--pill-green-bg)'}`,
        borderRadius: 12,
        padding: 16,
        marginBottom: 16
      }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8, flexWrap: 'wrap', gap: 8 }}>
          <div>
            <span style={{
              background: project.st === 'pre_project' ? 'var(--amber)' : 'var(--green)',
              color: project.st === 'pre_project' ? 'var(--pill-amber-bg)' : 'var(--pill-green-bg)',
              fontSize: 10,
              fontWeight: 800,
              padding: '2px 8px',
              borderRadius: 10,
              textTransform: 'uppercase'
            }}>
              {project.st === 'pre_project' ? '✍️ PROPOSTA D\'ORDINE IN ATTESA DI FIRMA (v1.0)' : '🔒 CONTRATTO FIRMATO & CONGELATO (v1.0)'}
            </span>
            <div style={{ fontSize: 13, fontWeight: 700, color: '#fff', marginTop: 4 }}>
              Engagement Letter — {project.n}
            </div>
            <div style={{ fontSize: 10, color: project.st === 'pre_project' ? 'var(--pill-amber-fg)' : 'var(--pill-green-fg)' }}>
              {project.st === 'pre_project'
                ? `Generata in data ${project.start} · In attesa di validazione e firma del cliente (OTP)`
                : `Stipula: ${project.start} · Firma con OTP verificata`}
            </div>
          </div>
          <div style={{ fontSize: 16, fontWeight: 800, color: project.st === 'pre_project' ? 'var(--amber)' : 'var(--green)' }}>
            {fmt(project.val)}
          </div>
        </div>
        <div style={{ fontSize: 11, color: project.st === 'pre_project' ? 'var(--pill-amber-fg)' : 'var(--pill-green-fg)' }}>
          • Moduli Iniziali Incorporati: {project.mods && project.mods.length > 0 ? project.mods.map(m => m.n).join(', ') : 'Nessun modulo ancora incorporato'}
        </div>
      </div>

      {/* Richieste addendum dal portale cliente (§2.5) */}
      <div style={{ borderTop: '1px solid var(--border)', paddingTop: 16, marginTop: 16 }}>
        <div style={{ fontSize: 13, fontWeight: 700, marginBottom: 10 }}>Richieste d'Integrazione ricevute dal Portale Cliente:</div>
        <RichiesteAddendumTab progettoId={String(project.id)} />
      </div>
    </div>
  );
}
