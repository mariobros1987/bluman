// «Form Master» della Libreria: i form che il cliente compila per un articolo (titolare,
// 28/11/2026). Prima erano tre form scritti nel codice della pagina, e quelli creati qui
// sparivano al ricaricamento: ora si leggono e si salvano sul server (regola 3).
import React, { useState } from 'react';
import { creaFormMasterApi, eliminaFormMasterApi, type FormMaster } from '../../api/formMaster';
import { useFormMaster } from '../../hooks/useFormMaster';
import { confirm } from '../ui/ConfirmProvider';
import { Modal } from '../ui/Modal';
import { useToast } from '../ui/ToastProvider';

/** «a, b, c» o una domanda per riga → elenco di domande. */
function domandeDalTesto(testo: string): string[] {
  return testo.split(/[\n,]/).map((s) => s.trim()).filter(Boolean);
}

export function FormMasterSection() {
  const toast = useToast();
  const { form, errore, ricarica } = useFormMaster();
  const [nuovoAperto, setNuovoAperto] = useState(false);
  const [nome, setNome] = useState('');
  const [testoDomande, setTestoDomande] = useState('');
  const [salvataggio, setSalvataggio] = useState(false);

  const domande = domandeDalTesto(testoDomande);

  const crea = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!nome.trim() || domande.length === 0) return;
    setSalvataggio(true);
    try {
      await creaFormMasterApi({ nome: nome.trim(), campi: domande });
      toast.successo(`Form «${nome.trim()}» creato: ora si può indicare su un articolo.`);
      setNome('');
      setTestoDomande('');
      setNuovoAperto(false);
      await ricarica();
    } catch (err) {
      // Il modale resta aperto: un salvataggio fallito si dichiara, non si chiude (regola 3).
      toast.errore(`Form non creato: ${err instanceof Error ? err.message : 'errore di rete'}`);
    } finally {
      setSalvataggio(false);
    }
  };

  const elimina = async (f: FormMaster) => {
    if (!(await confirm({ messaggio: `Eliminare il form «${f.nome}»? I passaggi già nati nei progetti tengono le loro domande e risposte.`, confermaLabel: 'Elimina', pericolo: true }))) return;
    try {
      await eliminaFormMasterApi(f.id);
      toast.successo(`Form «${f.nome}» eliminato.`);
      await ricarica();
    } catch (err) {
      toast.errore(`Form non eliminato: ${err instanceof Error ? err.message : 'errore di rete'}`);
    }
  };

  return (
    <div style={{ background: 'var(--card)', border: '1px solid var(--border)', borderRadius: 16, padding: 22, display: 'flex', flexDirection: 'column', gap: 14 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 8 }}>
        <div>
          <div style={{ fontSize: 15, fontWeight: 700 }}>📋 Form per il cliente{form && !errore ? ` (${form.length})` : ''}</div>
          <div style={{ fontSize: 11, color: 'var(--muted)', marginTop: 2 }}>
            Le domande che il cliente compila per un articolo. Il form si indica sull'articolo, nel Catalogo Articoli: nei progetti
            nuovi diventa un passaggio del cliente, e se lo stesso cliente l'ha già compilato le risposte vengono riprese.
          </div>
        </div>
        <button type="button" className="btn btn-primary btn-sm" onClick={() => setNuovoAperto(true)}>+ Crea nuovo form</button>
      </div>

      {form === null ? (
        <div style={{ fontSize: 12, color: 'var(--muted)' }}>Lettura dei form…</div>
      ) : errore ? (
        <div role="alert" style={{ fontSize: 12, color: 'var(--pill-red-fg)' }}>
          Form non letti ({errore}).{' '}
          <button type="button" className="btn btn-sm btn-secondary" onClick={() => void ricarica()}>Riprova</button>
        </div>
      ) : form.length === 0 ? (
        <div style={{ fontSize: 12, color: 'var(--muted)' }}>
          Lo studio non ha ancora nessun form. Creane uno con le domande da fare al cliente.
        </div>
      ) : (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(320px, 1fr))', gap: 12 }}>
          {form.map((f) => (
            <div key={f.id} style={{ background: 'var(--card2)', border: '1px solid var(--border)', borderRadius: 12, padding: 14 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8, marginBottom: 6 }}>
                <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--indigo-l)' }}>📋 {f.nome}</div>
                <button
                  type="button"
                  className="btn btn-sm btn-danger"
                  disabled={f.articoli > 0}
                  title={f.articoli > 0 ? 'È indicato da un articolo: toglilo da lì prima di eliminarlo.' : 'Elimina il form'}
                  onClick={() => void elimina(f)}
                >
                  🗑️ Elimina
                </button>
              </div>
              <div style={{ fontSize: 11, color: 'var(--muted)', marginBottom: 8 }}>
                {f.campi.length} {f.campi.length === 1 ? 'domanda' : 'domande'} · {f.articoli === 0 ? 'nessun articolo lo indica' : f.articoli === 1 ? 'indicato da 1 articolo' : `indicato da ${f.articoli} articoli`}
              </div>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                {f.campi.map((c) => (
                  <span key={c} style={{ background: 'var(--pill-indigo-bg)', color: 'var(--purple)', padding: '2px 8px', borderRadius: 6, fontSize: 10, fontWeight: 600 }}>{c}</span>
                ))}
              </div>
            </div>
          ))}
        </div>
      )}

      {nuovoAperto && (
        <Modal onClose={() => setNuovoAperto(false)} overlayBackground="rgba(0,0,0,.75)" zIndex={100} labelledBy="titolo-nuovo-form">
          {(richiediChiusura) => (
            <form onSubmit={crea} style={{ background: 'var(--sidebar)', border: '1px solid var(--border)', borderRadius: 16, padding: 20, width: '100%', maxWidth: 460, display: 'flex', flexDirection: 'column', gap: 12 }}>
              <div id="titolo-nuovo-form" style={{ fontSize: 15, fontWeight: 600 }}>Nuovo form per il cliente</div>
              <div>
                <label htmlFor="form-nome" style={{ fontSize: 11, color: 'var(--muted)', display: 'block', marginBottom: 4 }}>Nome del form *</label>
                <input id="form-nome" value={nome} onChange={(e) => setNome(e.target.value)} placeholder="es. Dati societari e legale rappresentante" required maxLength={120} />
              </div>
              <div>
                <label htmlFor="form-domande" style={{ fontSize: 11, color: 'var(--muted)', display: 'block', marginBottom: 4 }}>Domande (una per riga, o separate da virgola) *</label>
                <textarea
                  id="form-domande"
                  value={testoDomande}
                  onChange={(e) => setTestoDomande(e.target.value)}
                  placeholder={'Ragione sociale\nPartita IVA\nLegale rappresentante'}
                  rows={5}
                  required
                  style={{ background: 'var(--card)', border: '1px solid var(--border)', borderRadius: 8, color: 'var(--text)', padding: 10, fontSize: 12, width: '100%' }}
                />
                <div style={{ fontSize: 11, color: 'var(--hint)', marginTop: 4 }}>
                  {domande.length === 0 ? 'Serve almeno una domanda.' : `${domande.length} ${domande.length === 1 ? 'domanda' : 'domande'}.`}
                </div>
              </div>
              <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 8 }}>
                <button type="button" className="btn btn-secondary" onClick={richiediChiusura}>Annulla</button>
                <button type="submit" className="btn btn-primary" disabled={salvataggio || !nome.trim() || domande.length === 0}>
                  {salvataggio ? 'Creazione…' : '+ Crea form'}
                </button>
              </div>
            </form>
          )}
        </Modal>
      )}
    </div>
  );
}
