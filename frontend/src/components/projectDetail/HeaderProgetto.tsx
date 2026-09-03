import { Badge } from '../ui/Badge';
import { ProgressBar } from '../ui/ProgressBar';
import { fmt } from '../../utils';
import type { Progetto } from '../../types';
import styles from '../../pages/ProjectDetail.module.css';

// Header
export function HeaderProgetto({
  project,
  color,
  puoRicalcolare,
  ricalcolando,
  onBack,
  onRinomina,
  onApriCliente,
  onModificaValore,
  onApriAccessi,
  onRicalcola,
  onArchivia,
  onElimina,
}: {
  project: Progetto;
  color: string;
  puoRicalcolare: boolean;
  ricalcolando: boolean;
  onBack: () => void;
  onRinomina: () => void;
  onApriCliente: () => void;
  onModificaValore: () => void;
  onApriAccessi: () => void;
  onRicalcola: () => void;
  onArchivia: () => void;
  onElimina: () => void;
}) {
  return (
    <div className={styles.header}>
      <button className={styles.backBtn} onClick={onBack}>←</button>
      <div className={styles.headerInfo}>
        <h1 className={styles.title} style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <span>{project.n}</span>
          <span
            style={{ fontSize: 13, color: 'var(--muted)', cursor: 'pointer' }}
            title="Modifica Titolo Progetto (Admin)"
            onClick={onRinomina}
          >
            ✏️
          </span>
        </h1>
        <div className={styles.meta}>
          <span
            onClick={onApriCliente}
            style={{ cursor: 'pointer', color: 'var(--indigo-l)', textDecoration: 'underline', fontWeight: 600 }}
            title="Vai all'Anagrafica Specifica Cliente"
          >
            {project.ct === 'individual' ? '👤' : '🏢'} {project.cl}
          </span>
          <span>📅 {project.start} → {project.due}</span>
          <span
            style={{ cursor: 'pointer' }}
            title="Valore Incarico (Modificabile dall'Admin)"
            onClick={onModificaValore}
          >
            💶 {fmt(project.val)} ✏️
          </span>
          <Badge stato={project.st} />
          <button
            onClick={onApriAccessi}
            style={{ background: '#1a1f3d', border: '1px solid #2d3260', color: '#818cf8', padding: '4px 10px', borderRadius: 8, fontSize: 11, fontWeight: 600, cursor: 'pointer', marginLeft: 8 }}
          >
            👥 Accessi Progetto
          </button>
          {/* §16 — Ricalcolo dell'avanzamento. Le letture mostrano già i valori calcolati in
              memoria: questo pulsante li PERSISTE, scrivendo solo le righe divergenti (stati e
              segnali di rischio; le percentuali derivano e non hanno colonna). Serve quando lo
              stato a database si è disallineato da quello che il motore calcola. */}
          {puoRicalcolare && (
            <button
              disabled={ricalcolando}
              onClick={onRicalcola}
              title="Persiste a database gli stati calcolati dal motore §16, solo dove divergono"
              style={{ background: '#1a2e1f', border: '1px solid #2f5d3a', color: '#6ee7a0', padding: '4px 10px', borderRadius: 8, fontSize: 11, fontWeight: 600, cursor: ricalcolando ? 'wait' : 'pointer', marginLeft: 8, opacity: ricalcolando ? 0.6 : 1 }}
            >
              {ricalcolando ? '⏳ Ricalcolo…' : '🔄 Ricalcola avanzamento'}
            </button>
          )}
          <button
            onClick={onArchivia}
            style={{ background: '#2d3748', border: '1px solid #4a5568', color: '#fff', padding: '4px 10px', borderRadius: 8, fontSize: 11, fontWeight: 600, cursor: 'pointer', marginLeft: 8 }}
          >
            {project.st === 'archived' ? '↩️ Ripristina' : '📁 Archivia'}
          </button>
          <button
            onClick={onElimina}
            style={{ background: '#7f1d1d', border: '1px solid #991b1b', color: '#fca5a5', padding: '4px 10px', borderRadius: 8, fontSize: 11, fontWeight: 600, cursor: 'pointer', marginLeft: 8 }}
          >
            🗑 Elimina
          </button>
        </div>
      </div>
      <div className={styles.headerProgress}>
        <div style={{ fontSize: 11, color: 'var(--muted)', marginBottom: 4, textAlign: 'right' }}>
          Avanzamento globale <span style={{ color, fontWeight: 700 }}>{project.pct}%</span>
        </div>
        <ProgressBar value={project.pct} color={color} height={6} />
      </div>
    </div>
  );
}
