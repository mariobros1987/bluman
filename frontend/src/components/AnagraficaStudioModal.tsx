import { Modal } from './ui/Modal';
import type { StatoAnagraficaStudio } from '../api/client';

/**
 * La guida ai dati obbligatori dello studio: cosa manca, a cosa serve e dove si compila.
 *
 * Non è un elenco di buone pratiche: sono i campi senza i quali l'app **non compone** un
 * documento fiscale, e la lista arriva dal server (`src/domain/anagraficaStudio.ts`) perché è la
 * stessa che il controllo prima dell'XML SDI usa per rifiutare. Per ogni campo si dice dove
 * finisce il valore e cosa l'app scriveva al suo posto finché poteva inventare: è quella la
 * ragione per cui vale la pena compilarlo, e senza di essa la guida è una lista di caselle.
 *
 * Il modale è di **sola lettura**: non ha campi da compilare, quindi non diventa mai «sporco» e
 * si chiude subito senza la conferma di uscita di `ui/Modal` (`dirty={false}`). Chi vuole
 * compilare va in Impostazioni, dove i campi si scrivono davvero — così la scrittura passa da
 * `PATCH /tenant/info`, che è l'unica strada che il server valida.
 */
export function AnagraficaStudioModal({
  stato,
  onClose,
  onCompila,
  mostraCompila = true,
}: {
  stato: StatoAnagraficaStudio;
  onClose: () => void;
  onCompila: () => void;
  /**
   * Falso quando il modale si apre **dalle** Impostazioni: lì i campi sono già sotto gli occhi,
   * e un pulsante «Compila in Impostazioni» che riporta dove si è già sarebbe una bugia comoda.
   */
  mostraCompila?: boolean;
}) {
  const { letto, completa, mancanti } = stato;

  return (
    <Modal onClose={onClose} dirty={false} zIndex={1100} labelledBy="anagrafica-studio-titolo">
      <div
        style={{
          background: 'var(--sidebar)',
          border: '1px solid var(--border)',
          borderRadius: 16,
          padding: 22,
          width: '100%',
          maxWidth: 640,
          maxHeight: '85vh',
          overflowY: 'auto',
          display: 'flex',
          flexDirection: 'column',
          gap: 14,
        }}
      >
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 12 }}>
          <div>
            <div id="anagrafica-studio-titolo" style={{ fontSize: 15, fontWeight: 700 }}>
              Dati obbligatori dello studio
            </div>
            <div style={{ fontSize: 11.5, color: 'var(--muted)', marginTop: 3 }}>
              Le fatture elettroniche e i documenti dello studio portano questi dati al posto tuo.
            </div>
          </div>
          <button
            onClick={onClose}
            aria-label="Chiudi"
            style={{ background: 'var(--card2)', border: 'none', width: 26, height: 26, borderRadius: 6, color: 'var(--muted)', cursor: 'pointer', flexShrink: 0 }}
          >
            ✕
          </button>
        </div>

        {!letto && (
          // Non si sa se i dati ci sono, quindi non si dice né «mancano» né «ci sono». Il verso
          // dell'errore è questo: chi legge sa che la verifica non è avvenuta e può rifarla.
          <div style={{ background: 'var(--surface-1)', border: '1px solid var(--card2)', borderRadius: 10, padding: 14, fontSize: 11.5, color: 'var(--muted)', lineHeight: 1.55 }}>
            ℹ️ Non ho potuto leggere l'anagrafica dello studio: il server non ha risposto. Non è
            detto che manchi qualcosa — semplicemente non l'ho potuto verificare. Riapri questa
            guida (Impostazioni → Anagrafica) o ricarica la pagina.
          </div>
        )}

        {letto && completa && (
          <div style={{ background: 'var(--pill-green-bg, var(--surface-1))', border: '1px solid var(--green, var(--border))', borderRadius: 10, padding: 14, fontSize: 11.5, color: 'var(--pill-green-fg, var(--text))', lineHeight: 1.55 }}>
            ✓ L'anagrafica dello studio è completa: ragione sociale, partita IVA, codice fiscale,
            sede legale, regime fiscale e IBAN ci sono tutti. Nulla di quello che l'app scrive in
            un documento fiscale è inventato.
          </div>
        )}

        {letto && !completa && (
          <>
            <div style={{ background: 'var(--surface-1)', border: '1px solid var(--card2)', borderRadius: 10, padding: 14, fontSize: 11.5, color: 'var(--text)', lineHeight: 1.55 }}>
              ℹ️ Senza questi dati l'app <strong>rifiuta di comporre</strong> una fattura
              elettronica, invece di riempire i campi vuoti con un valore plausibile. Una P.IVA a
              zero sull'XML non è un documento incompleto: è un documento che dice il falso, e SdI
              lo scarta o — peggio — lo accetta.
            </div>

            <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              {mancanti.map(campo => (
                <div
                  key={campo.chiave}
                  style={{ background: 'var(--card2)', border: '1px solid var(--border)', borderRadius: 10, padding: '12px 14px' }}
                >
                  <div style={{ fontSize: 12.5, fontWeight: 700 }}>{campo.etichetta}</div>
                  <div style={{ fontSize: 11.5, color: 'var(--muted)', marginTop: 4, lineHeight: 1.5 }}>
                    Serve per {campo.dove}.
                  </div>
                  <div style={{ fontSize: 11, color: 'var(--amber, var(--muted))', marginTop: 5, lineHeight: 1.5 }}>
                    ⚠ {campo.senza}.
                  </div>
                </div>
              ))}
            </div>

            <div style={{ fontSize: 11, color: 'var(--muted)', lineHeight: 1.5 }}>
              Si compilano in <strong>Impostazioni → Anagrafica</strong>, con l'etichetta indicata
              qui sopra. Questa guida resta richiamabile da lì quando serve.
            </div>
          </>
        )}

        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 4 }}>
          <button
            onClick={onClose}
            style={{ background: 'transparent', border: '1px solid var(--border)', color: 'var(--text)', padding: '8px 14px', borderRadius: 8, fontSize: 12, cursor: 'pointer' }}
          >
            {letto && !completa ? 'Più tardi' : 'Chiudi'}
          </button>
          {letto && !completa && mostraCompila && (
            <button
              onClick={onCompila}
              style={{ background: 'var(--indigo)', color: '#fff', border: 'none', padding: '8px 16px', borderRadius: 8, fontSize: 12, fontWeight: 600, cursor: 'pointer' }}
            >
              Compila in Impostazioni
            </button>
          )}
        </div>
      </div>
    </Modal>
  );
}
