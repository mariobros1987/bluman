import { chiaviDatiLocali, svuotaDatiLocali } from '../../utils/datiLocali';
import styles from '../../pages/Settings.module.css';

interface TabManutenzioneProps {
  chiaviLocali: string[];
  setChiaviLocali: (v: string[]) => void;
  chiaviRimosse: string[] | null;
  setChiaviRimosse: (v: string[] | null) => void;
  confermaSvuota: boolean;
  setConfermaSvuota: (v: boolean) => void;
}

// TAB 5: Manutenzione dei dati locali di questo browser
export function TabManutenzione({
  chiaviLocali,
  setChiaviLocali,
  chiaviRimosse,
  setChiaviRimosse,
  confermaSvuota,
  setConfermaSvuota,
}: TabManutenzioneProps) {
  return (
        <div className={styles.sectionBox}>
          <div style={{ fontSize: 14, fontWeight: 600 }}>Dati di lavoro salvati in questo browser</div>
          <div style={{ fontSize: 11, color: 'var(--muted)', marginTop: 2, lineHeight: 1.6 }}>
            Progetti, note, documenti e firme inseriti prima che la creazione passasse dal server sono
            rimasti nella memoria locale di <strong>questo</strong> browser, non a database. Restano visibili
            solo qui: il portale del cliente, che legge il database, non li vede. Se hai appena azzerato il
            database e nell'elenco compaiono ancora progetti vecchi, arrivano da qui.
          </div>

          <div style={{ background: 'var(--card2)', border: '1px solid var(--border)', borderRadius: 10, padding: 14, marginTop: 14 }}>
            <div style={{ fontSize: 12, fontWeight: 600, marginBottom: 8 }}>
              {chiaviLocali.length === 0
                ? '✓ Nessun dato di lavoro locale: questo browser legge solo dal database.'
                : `${chiaviLocali.length} voci di dati locali da rimuovere`}
            </div>
            {chiaviLocali.length > 0 && (
              <div style={{ maxHeight: 200, overflowY: 'auto', fontFamily: 'monospace', fontSize: 11, color: 'var(--muted)', display: 'flex', flexDirection: 'column', gap: 2 }}>
                {chiaviLocali.map(k => <div key={k}>{k}</div>)}
              </div>
            )}
            <div style={{ fontSize: 11, color: 'var(--muted)', marginTop: 10, paddingTop: 10, borderTop: '1px solid var(--border)' }}>
              Restano intatti: la tua sessione di accesso, il tenant corrente, l'anagrafica dello studio,
              il logo, la matrice permessi e il catalogo dei modelli.
            </div>
          </div>

          {chiaviRimosse && (
            <div style={{ background: 'var(--pill-green-bg)', border: '1px solid var(--pill-green-bg)', color: 'var(--green)', padding: '12px 16px', borderRadius: 10, fontSize: 12, marginTop: 14 }}>
              ✓ Rimosse {chiaviRimosse.length} voci. Ricarica la pagina per vedere l'elenco pulito.
            </div>
          )}

          <div style={{ display: 'flex', gap: 10, marginTop: 14, alignItems: 'center', flexWrap: 'wrap' }}>
            <button
              type="button"
              onClick={() => { setChiaviLocali(chiaviDatiLocali()); setChiaviRimosse(null); setConfermaSvuota(false); }}
              style={{ background: 'transparent', border: '1px solid var(--border)', color: 'var(--muted)', padding: '8px 16px', borderRadius: 8, fontSize: 12, cursor: 'pointer' }}
            >
              ↻ Ricontrolla
            </button>

            {!confermaSvuota ? (
              <button
                type="button"
                disabled={chiaviLocali.length === 0}
                onClick={() => setConfermaSvuota(true)}
                style={{ background: chiaviLocali.length === 0 ? 'var(--card2)' : 'var(--pill-red-bg)', border: '1px solid var(--red)', color: chiaviLocali.length === 0 ? 'var(--muted)' : 'var(--pill-red-fg)', padding: '8px 16px', borderRadius: 8, fontSize: 12, fontWeight: 600, cursor: chiaviLocali.length === 0 ? 'default' : 'pointer' }}
              >
                🧹 Svuota i dati locali di questo browser
              </button>
            ) : (
              <>
                <span style={{ fontSize: 12, color: 'var(--pill-red-fg)' }}>
                  ⚠️ L'operazione non si annulla: quello che sta solo qui va perso. Confermi?
                </span>
                <button
                  type="button"
                  onClick={() => setConfermaSvuota(false)}
                  style={{ background: 'transparent', border: '1px solid var(--border)', color: 'var(--muted)', padding: '8px 16px', borderRadius: 8, fontSize: 12, cursor: 'pointer' }}
                >
                  Annulla
                </button>
                <button
                  type="button"
                  onClick={() => { const rimosse = svuotaDatiLocali(); setChiaviRimosse(rimosse); setChiaviLocali(chiaviDatiLocali()); setConfermaSvuota(false); }}
                  style={{ background: 'var(--red)', border: 'none', color: '#fff', padding: '8px 16px', borderRadius: 8, fontSize: 12, fontWeight: 700, cursor: 'pointer' }}
                >
                  Sì, svuota
                </button>
              </>
            )}
          </div>
        </div>
  );
}
