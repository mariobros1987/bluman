import styles from '../../pages/Settings.module.css';

// TAB 4: Configurazione SDI
export function TabSdi() {
  return (
        <div className={styles.sectionBox}>
          <div style={{ fontSize: 14, fontWeight: 600 }}>Fatturazione Elettronica — Invio Manuale</div>
          <div style={{ fontSize: 11, color: 'var(--muted)', marginTop: 2 }}>
            Nessun provider SdI collegato: il sistema prepara l'XML della fattura, la trasmissione è a cura
            dell'operatore tramite il portale «Fatture & Corrispettivi» dell'Agenzia delle Entrate o il proprio
            intermediario. L'esito reale (consegnata/scartata) si registra dal webhook esiti.
          </div>

          <div className={styles.grid2} style={{ marginTop: 14 }}>
            <div className={styles.field}>
              <label>Provider Fatturazione</label>
              <input value="Nessuno — invio manuale (Fatture & Corrispettivi / intermediario)" readOnly style={{ background: 'var(--card2)' }} />
            </div>
            <div className={styles.field}>
              <label>Codice Destinatario Default *</label>
              <input value="SUBM70N" readOnly style={{ fontFamily: 'monospace', fontWeight: 700 }} />
            </div>
          </div>
        </div>
  );
}
