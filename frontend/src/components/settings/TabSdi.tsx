import styles from '../../pages/Settings.module.css';
import { getStudioInfoForTenant } from '../../utils/tenant';

// TAB 4: Configurazione SDI
export function TabSdi() {
  /**
   * §7 — qui il campo era `<input value="SUBM70N" readOnly>`: un codice destinatario **scritto nel
   * sorgente**, per giunta quello di un'azienda che non è questa. È lo stesso codice che
   * `ClientsPage` ha smesso di assegnare ai clienti nuovi proprio perché non era il loro. Un campo
   * read-only etichettato «Codice Destinatario Default *» lo presentava come la configurazione
   * dello studio, e un operatore poteva copiarlo su una fattura. Ora si legge dall'anagrafica dello
   * studio (che è quella che finisce su intestazioni e documenti) e, se non c'è, resta vuoto: uno
   * studio maltese un codice SDI italiano non ce l'ha, e dirlo è meglio che inventarne uno.
   */
  const codiceSdi = getStudioInfoForTenant().codiceSdi || '';

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
              <input
                value={codiceSdi}
                readOnly
                placeholder="—"
                style={{ fontFamily: 'monospace', fontWeight: 700 }}
              />
              <div style={{ fontSize: 10, color: 'var(--muted)', marginTop: 4 }}>
                {codiceSdi
                  ? 'Letto dall\'anagrafica dello studio (Impostazioni → Anagrafica).'
                  : 'Vuoto: lo studio non ha un codice destinatario predefinito nell\'anagrafica. Il codice di ogni cliente resta nella scheda del cliente, ed è quello che finisce sull\'XML.'}
              </div>
            </div>
          </div>
        </div>
  );
}
