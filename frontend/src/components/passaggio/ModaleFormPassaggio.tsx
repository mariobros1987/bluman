import { useState } from 'react';
import type { Passaggio } from '../../types';
import { Modal } from '../ui/Modal';
import { closeBtnStyle } from './passaggioStyles';

/**
 * «📋 Dati da raccogliere dal cliente» — la scheda che raccoglie e conserva le risposte di un
 * passaggio di tipo `form`.
 *
 * **Perché esiste di nuovo, e perché non è com'era.** Anche questa era stata cancellata da
 * `8b1d9e21`, insieme alla scheda «Aggiungi Azione»: il pulsante è rimasto, il modale no. Ma
 * ripristinarla alla lettera avrebbe rimesso in circolazione tre cose che non stanno bene in un
 * fascicolo:
 *
 *  1. **la scritta verde «✓ Dati verificati dal sistema KYC»**. Nessun controllo KYC aveva
 *     verificato niente: era un'etichetta fissa. In uno studio che va a Malta sotto FIAU/MFSA una
 *     rassicurazione di conformità che nessuno ha prodotto è peggio di nessuna rassicurazione —
 *     è la stessa regola per cui `SpunteStato` si rifiuta di disegnare due spunte su un messaggio
 *     che nessun canale ha accettato;
 *  2. **la precompilazione con dati inventati**: `TabPassaggi` riempiva i campi con
 *     `'IT99887766554'`, `'IT99C0306903200100000001234'`, `'DBNMRI85M12H501Z'` — una partita IVA,
 *     un IBAN e un codice fiscale veri nella forma e falsi nella sostanza, mostrati come se fossero
 *     del cliente. Qui i campi partono **vuoti**, e si riempiono solo con quello che è già stato
 *     salvato per questo passaggio;
 *  3. un `alert()` di browser per dire «salvato»: il resto dell'applicazione usa i toast, e il
 *     messaggio lo dà la shell, che è l'unica a sapere se il salvataggio è riuscito davvero.
 *
 * **Dove finiscono le risposte.** In `passaggio_progetto.risposte_form_json`, la colonna che
 * esisteva dal primo giorno e non aveva ancora nessuno scrittore (vedi `src/routes/progetti.ts`).
 * Il gemello `campi_form_json` porta le domande, e lo popola l'istanziazione dal modello.
 *
 * **Cosa NON fa: chiudere il passaggio.** Salvare i dati e dichiarare conclusa un'azione sono due
 * decisioni diverse, e il ✓ sulla scheda è già il posto della seconda. Un tasto che fa entrambe
 * direbbe «completato» di un modulo compilato a metà.
 */
export function ModaleFormPassaggio({
  step,
  nomeCliente,
  onChiudi,
  onSalva,
}: {
  step: Passaggio;
  nomeCliente: string;
  onChiudi: () => void;
  /** Consegna le risposte alla shell, che le lega al passaggio e le salva. */
  onSalva: (risposte: Record<string, string>) => void;
}) {
  // Lo stesso ripiego di `TabPassaggi`, **nello stesso punto**: la scheda fa `s.fields || [trio]`,
  // quindi un elenco vuoto resta vuoto (`[]` è un valore vero) e solo l'assenza fa scattare il
  // ripiego. Qui il `??` dice la stessa cosa. La prima stesura usava `fields.length > 0`, e con un
  // passaggio a campi vuoti il modale chiedeva tre cose che la scheda non nominava — cioè le due
  // viste divergono proprio nel caso in cui l'operatore ha dichiarato che non c'è niente da
  // chiedere.
  const campi = step.fields ?? ['Ragione Sociale', 'P.IVA / VAT', 'Legale Rappresentante'];

  const [risposte, setRisposte] = useState<Record<string, string>>(() => ({ ...(step.risposte ?? {}) }));

  const salvate = Object.values(risposte).filter((v) => v.trim() !== '').length;

  return (
    <Modal
      onClose={onChiudi}
      overlayBackground="rgba(0,0,0,0.8)"
      zIndex={10000}
      labelledBy="form-passaggio-titolo"
    >
      {(richiediChiusura) => (
        <div style={{ background: 'var(--sidebar)', border: '1px solid var(--border)', borderRadius: 16, width: '100%', maxWidth: 540, padding: 22, boxShadow: '0 16px 48px rgba(0,0,0,.6)' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 14, borderBottom: '1px solid var(--border)', paddingBottom: 12 }}>
            <div>
              <div id="form-passaggio-titolo" style={{ fontSize: 15, fontWeight: 700, color: 'var(--text)' }}>
                📋 Dati del form
              </div>
              <div style={{ fontSize: 11, color: 'var(--muted)', marginTop: 2 }}>
                {step.title} · Cliente {nomeCliente}
              </div>
            </div>
            <button aria-label="Chiudi" onClick={richiediChiusura} style={closeBtnStyle}>✕</button>
          </div>

          <div style={{ fontSize: 11, color: 'var(--muted)', lineHeight: 1.55, marginBottom: 14 }}>
            I dati che il cliente ha comunicato. Restano scritti sul passaggio e si rileggono qui alla
            riapertura.
          </div>

          <div style={{ display: 'flex', flexDirection: 'column', gap: 12, marginBottom: 20, maxHeight: 300, overflowY: 'auto' }}>
            {campi.map((campo, i) => (
              <div key={`${campo}-${i}`} style={{ background: 'var(--card2)', border: '1px solid var(--border)', borderRadius: 8, padding: 10 }}>
                <label
                  htmlFor={`form-campo-${i}`}
                  style={{ fontSize: 10, fontWeight: 700, color: 'var(--indigo-l)', display: 'block', marginBottom: 4, textTransform: 'uppercase' }}
                >
                  📝 {campo}
                </label>
                <input
                  id={`form-campo-${i}`}
                  type="text"
                  value={risposte[campo] ?? ''}
                  onChange={(e) => setRisposte((prev) => ({ ...prev, [campo]: e.target.value }))}
                  placeholder={`Valore per ${campo}…`}
                  style={{ fontSize: 12, padding: 6, width: '100%' }}
                />
              </div>
            ))}
          </div>

          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
            {/* Il conteggio al posto della vecchia rassicurazione KYC: dice una cosa che è vera e
                verificabile guardando i campi qui sopra. */}
            <span style={{ fontSize: 10, color: 'var(--muted)' }}>
              {salvate > 0 ? `${salvate} ${salvate === 1 ? 'campo compilato' : 'campi compilati'}` : 'Nessun campo compilato'}
              {' · '}per completare l'azione usa il ✓ sulla scheda
            </span>
            <div style={{ display: 'flex', gap: 8 }}>
              <button
                type="button"
                onClick={richiediChiusura}
                style={{ background: 'transparent', border: '1px solid var(--border)', color: 'var(--muted)', padding: '7px 14px', borderRadius: 8, fontSize: 11, cursor: 'pointer' }}
              >
                Annulla
              </button>
              <button
                type="button"
                onClick={() => onSalva(risposte)}
                style={{ background: 'var(--indigo)', color: '#fff', border: 'none', padding: '7px 16px', borderRadius: 8, fontSize: 11, fontWeight: 700, cursor: 'pointer' }}
              >
                ✓ Salva i dati
              </button>
            </div>
          </div>
        </div>
      )}
    </Modal>
  );
}
