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

      {/* Baseline Contratto Iniziale.
          §52 — Fase B: lo stato mostrato viene dal dato REALE di firma
          (EngagementLetter.statoFirma / firmatoAt, esposto dal backend via `project.statoFirma`),
          non più dedotto da `project.st`. Un progetto passa a `in_progress` anche solo accettando
          un preventivo, SENZA che il cliente abbia mai firmato: firma verificata (OTP) e avvio
          del progetto sono due fatti distinti. Tre stati distinti, senza mai affermare una firma
          non provata:
            • firmata      (statoFirma === 'completata') → verde, con la data reale di firma;
            • in attesa    (pre_project, oppure statoFirma === 'in_attesa') → ambra;
            • non tracciata (statoFirma assente: progetti locali/legacy o nessuna letter emessa)
                            → neutro, «emessa», con nota esplicita che la firma non è tracciata qui. */}
      {(() => {
        const firmata = project.statoFirma === 'completata';
        const inAttesa = project.st === 'pre_project' || project.statoFirma === 'in_attesa';
        const bordo = firmata ? 'var(--green)' : inAttesa ? 'var(--amber)' : 'var(--border)';
        const sfondo = firmata ? 'rgba(22, 163, 74, 0.08)' : inAttesa ? 'rgba(217, 119, 6, 0.08)' : 'var(--surface-1)';
        const testoColore = firmata ? 'var(--pill-green-fg)' : inAttesa ? 'var(--pill-amber-fg)' : 'var(--muted)';
        const badge = firmata
          ? '🔒 ENGAGEMENT LETTER FIRMATA (v1.0)'
          : inAttesa
            ? '✍️ ENGAGEMENT LETTER IN ATTESA DI FIRMA (v1.0)'
            : '📄 ENGAGEMENT LETTER EMESSA (v1.0)';
        const badgeSfondo = firmata ? 'var(--green)' : inAttesa ? 'var(--amber)' : 'var(--pill-slate-bg)';
        const badgeTesto = firmata || inAttesa ? 'var(--on-accent)' : 'var(--muted)';
        const riga = firmata
          ? `Firmata dal cliente con OTP verificata${project.firmatoAt ? ` il ${project.firmatoAt}` : ''} · Contratto congelato (v1.0)`
          : inAttesa
            ? `Generata in data ${project.start} · In attesa di validazione e firma del cliente (OTP)`
            : `Emessa il ${project.start} · Progetto avviato. Lo stato della firma elettronica non è tracciato per questo incarico.`;
        return (
          <div style={{
            background: sfondo,
            border: `1px solid ${bordo}`,
            borderRadius: 12,
            padding: 16,
            marginBottom: 16
          }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8, flexWrap: 'wrap', gap: 8 }}>
              <div>
                <span style={{
                  background: badgeSfondo,
                  color: badgeTesto,
                  fontSize: 10,
                  fontWeight: 800,
                  padding: '2px 8px',
                  borderRadius: 10,
                  textTransform: 'uppercase'
                }}>
                  {badge}
                </span>
                <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--text)', marginTop: 4 }}>
                  Engagement Letter — {project.n}
                </div>
                <div style={{ fontSize: 10, color: testoColore }}>
                  {riga}
                </div>
              </div>
              <div style={{ fontSize: 16, fontWeight: 800, color: firmata ? 'var(--green)' : inAttesa ? 'var(--amber)' : 'var(--text)' }}>
                {fmt(project.val)}
              </div>
            </div>
            <div style={{ fontSize: 11, color: testoColore }}>
              • Moduli Iniziali Incorporati: {project.mods && project.mods.length > 0 ? project.mods.map(m => m.n).join(', ') : 'Nessun modulo ancora incorporato'}
            </div>
          </div>
        );
      })()}

      {/* Richieste addendum dal portale cliente (§2.5) */}
      <div style={{ borderTop: '1px solid var(--border)', paddingTop: 16, marginTop: 16 }}>
        <div style={{ fontSize: 13, fontWeight: 700, marginBottom: 10 }}>Richieste d'Integrazione ricevute dal Portale Cliente:</div>
        <RichiesteAddendumTab progettoId={String(project.id)} />
      </div>
    </div>
  );
}
