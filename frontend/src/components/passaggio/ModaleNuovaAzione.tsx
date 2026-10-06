import React, { useState } from 'react';
import type { Passaggio } from '../../types';
import { Modal } from '../ui/Modal';
import { closeBtnStyle } from './passaggioStyles';

/**
 * «➕ Aggiungi Azione»: la scheda che crea un passaggio nuovo nella checklist di una micro-voce.
 *
 * **Perché esiste di nuovo.** Non è una funzione mai scritta: era stata **cancellata per sbaglio**.
 * Il commit `8b1d9e21` («remove auto-forced default documents, implement smart AI pre-screening…»)
 * portò via, in un colpo solo, lo stato, l'handler e il JSX di questa scheda — lasciando il pulsante
 * in `TabPassaggi` a chiamare un `setShowAddStepModal` il cui valore nessuno leggeva più. Il sintomo
 * per l'operatore era esattamente «il pulsante non fa niente».
 *
 * **Due cose non sono state ripristinate com'erano, ed è deliberato:**
 *
 *  1. l'handler originale inventava un documento per il tipo `doc`
 *     (`file: \`Documento_${project.cl}.pdf\``): un nome di file che non esiste, che avrebbe
 *     disegnato un passaggio «da firmare» su un atto che nessuno aveva collegato. Era esattamente
 *     ciò che quel commit stava togliendo — rimetterlo avrebbe ricostruito il problema. Col tipo
 *     `doc` il passaggio nasce **senza** documento, e `TabPassaggi` mostra lo stato vuoto con
 *     «Collega Consigliato» / «Scegli Modello», che è il modo giusto di legare un atto;
 *  2. per il tipo `form` l'handler inventava due campi (`'Dato Richiesto 1'`, `'Dato Richiesto 2'`).
 *     Qui i campi li scrive l'operatore, separati da virgola: sono la sua domanda, e indovinarla al
 *     posto suo era il motivo per cui la scheda sembrava compilata quando non lo era. Se non ne
 *     scrive nessuno il campo resta indefinito, e `TabPassaggi` mostra il suo ripiego dichiarato.
 *
 * Lo stato del form vive **qui** e non nella shell: si azzera da solo alla chiusura, perché il
 * componente smonta, e non lascia quattro `useState` in più in un file che ne ha già molti. La
 * shell riceve solo il passaggio già composto da `onCrea`.
 */
export function ModaleNuovaAzione({
  onChiudi,
  onCrea,
}: {
  onChiudi: () => void;
  onCrea: (dati: {
    title: string;
    desc: string;
    type: Passaggio['type'];
    who: Passaggio['who'];
    fields?: string[];
  }) => void;
}) {
  const [titolo, setTitolo] = useState('');
  const [descrizione, setDescrizione] = useState('');
  const [tipo, setTipo] = useState<Passaggio['type']>('check');
  const [chi, setChi] = useState<Passaggio['who']>('operatore');
  const [campi, setCampi] = useState('');

  const campiDelForm = campi
    .split(',')
    .map((c) => c.trim())
    .filter(Boolean);

  const invia = (e: React.FormEvent) => {
    e.preventDefault();
    const title = titolo.trim();
    if (!title) return;
    onCrea({
      title,
      // Il ripiego è lo stesso testo dell'handler originale: una riga vuota in checklist non dice
      // a nessuno che cosa manca.
      desc: descrizione.trim() || 'Azione operativa di processo.',
      type: tipo,
      who: chi,
      // Solo per il tipo «form», e solo se l'operatore ha scritto qualcosa: un array vuoto sarebbe
      // una risposta diversa da «nessun campo», e `TabPassaggi` distingue i due casi.
      fields: tipo === 'form' && campiDelForm.length > 0 ? campiDelForm : undefined,
    });
  };

  return (
    <Modal
      onClose={onChiudi}
      overlayBackground="rgba(0,0,0,0.8)"
      zIndex={10000}
      labelledBy="nuova-azione-titolo"
    >
      {(richiediChiusura) => (
        <div style={{ background: 'var(--sidebar)', border: '1px solid var(--border)', borderRadius: 16, width: '100%', maxWidth: 480, padding: 22, boxShadow: '0 16px 48px rgba(0,0,0,.6)' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 14, borderBottom: '1px solid var(--border)', paddingBottom: 12 }}>
            <div id="nuova-azione-titolo" style={{ fontSize: 15, fontWeight: 700, color: 'var(--text)' }}>
              ➕ Aggiungi Azione alla Checklist
            </div>
            <button aria-label="Chiudi" onClick={richiediChiusura} style={closeBtnStyle}>✕</button>
          </div>

          <form onSubmit={invia} style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            <div>
              <label htmlFor="na-titolo" style={{ fontSize: 11, fontWeight: 600, color: 'var(--muted)', display: 'block', marginBottom: 4 }}>
                Titolo del Passaggio / Azione *
              </label>
              <input
                id="na-titolo"
                type="text"
                value={titolo}
                onChange={(e) => setTitolo(e.target.value)}
                placeholder="es. Verifica Visura Camerale Storica o Bonifico Caparra"
                required
                autoFocus
                style={{ fontSize: 12, padding: 8, width: '100%' }}
              />
            </div>

            <div>
              <label htmlFor="na-desc" style={{ fontSize: 11, fontWeight: 600, color: 'var(--muted)', display: 'block', marginBottom: 4 }}>
                Descrizione / Istruzioni Operative
              </label>
              <textarea
                id="na-desc"
                value={descrizione}
                onChange={(e) => setDescrizione(e.target.value)}
                placeholder="Dettagli sulle azioni richieste all'operatore o al cliente..."
                rows={2}
                style={{ fontSize: 12, padding: 8, width: '100%', background: 'var(--card)', border: '1px solid var(--border)', borderRadius: 6, color: 'var(--text)' }}
              />
            </div>

            <div style={{ display: 'flex', gap: 12 }}>
              <div style={{ flex: 1 }}>
                <label htmlFor="na-tipo" style={{ fontSize: 11, fontWeight: 600, color: 'var(--muted)', display: 'block', marginBottom: 4 }}>
                  Tipo di Passaggio
                </label>
                <select
                  id="na-tipo"
                  value={tipo}
                  onChange={(e) => setTipo(e.target.value as Passaggio['type'])}
                  style={{ fontSize: 11, padding: 6, width: '100%', background: 'var(--card)', border: '1px solid var(--border)', borderRadius: 6, color: 'var(--text)' }}
                >
                  <option value="check">Verifica / Checkmark</option>
                  <option value="doc">Documento / Firma PDF</option>
                  <option value="form">Form / Questionario Dati</option>
                  <option value="info">Info / Istruzioni</option>
                </select>
              </div>

              <div style={{ flex: 1 }}>
                <label htmlFor="na-chi" style={{ fontSize: 11, fontWeight: 600, color: 'var(--muted)', display: 'block', marginBottom: 4 }}>
                  Assegnato a
                </label>
                <select
                  id="na-chi"
                  value={chi}
                  onChange={(e) => setChi(e.target.value as Passaggio['who'])}
                  style={{ fontSize: 11, padding: 6, width: '100%', background: 'var(--card)', border: '1px solid var(--border)', borderRadius: 6, color: 'var(--text)' }}
                >
                  <option value="operatore">👤 Operatore Studio</option>
                  <option value="cliente">🧑‍💼 Cliente Committente</option>
                </select>
              </div>
            </div>

            {tipo === 'form' && (
              <div>
                <label htmlFor="na-campi" style={{ fontSize: 11, fontWeight: 600, color: 'var(--muted)', display: 'block', marginBottom: 4 }}>
                  Dati da chiedere al cliente
                </label>
                <input
                  id="na-campi"
                  type="text"
                  value={campi}
                  onChange={(e) => setCampi(e.target.value)}
                  placeholder="Ragione Sociale, P.IVA, Legale Rappresentante"
                  style={{ fontSize: 12, padding: 8, width: '100%' }}
                />
                <div style={{ fontSize: 10.5, color: 'var(--muted)', marginTop: 4 }}>
                  Separati da virgola. Si compilano poi da «📋 Dati da raccogliere dal cliente» sulla scheda.
                </div>
              </div>
            )}

            {/* Il tipo «doc» non allega niente da solo, e va detto qui invece di lasciarlo
                scoprire: l'operatore che sceglie «Documento» e non vede arrivare nessun file
                deve sapere che è il comportamento voluto, non un guasto. */}
            {tipo === 'doc' && (
              <div style={{ fontSize: 10.5, color: 'var(--muted)', background: 'var(--card2)', border: '1px solid var(--border)', borderRadius: 8, padding: 8 }}>
                Il passaggio nasce senza documento: si collega un atto dalla scheda, con «⚡ Collega
                Consigliato» o «📂 Scegli Modello». Nessun file viene inventato dal titolo.
              </div>
            )}

            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 14 }}>
              <button
                type="button"
                onClick={richiediChiusura}
                style={{ background: 'transparent', border: '1px solid var(--border)', color: 'var(--muted)', padding: '7px 14px', borderRadius: 8, fontSize: 11, cursor: 'pointer' }}
              >
                Annulla
              </button>
              <button
                type="submit"
                style={{ background: 'var(--indigo)', color: '#fff', border: 'none', padding: '7px 16px', borderRadius: 8, fontSize: 11, fontWeight: 700, cursor: 'pointer' }}
              >
                + Salva Passaggio
              </button>
            </div>
          </form>
        </div>
      )}
    </Modal>
  );
}
