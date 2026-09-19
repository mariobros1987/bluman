// §41 — Il pannello che registra una revisione su un modello dello studio.
//
// Registra una decisione, non una modifica del testo: chi la prende, quando, con quale nota. Per
// questo lo stato di revisione ha una rotta sua (`PATCH /documenti-template/:id/revisione`) e non
// viaggia insieme al contenuto — se viaggiassero insieme, salvare una virgola equivarrebbe a
// riapprovare, e «approvato» finirebbe scritto su un testo che nessuno ha riletto.
//
// Chi valuta se il passaggio di stato è ammesso è il server (`decidiRevisione`): questo pannello
// non ripete la regola, la chiede, e mostra la risposta che è arrivata.

import { useState } from 'react';
import type { DocumentTemplate } from '../../utils/documentTemplates';
import type { EsitoGesto } from '../../hooks/useCartellaTemplate';

type Stato = 'bozza' | 'in_revisione' | 'approvato';

interface Props {
  modello: DocumentTemplate;
  /** Salva la decisione. La regola su cosa è ammesso sta nel server: qui si mostra l'esito. */
  onSalva: (stato: Stato, note: string) => Promise<EsitoGesto>;
  onChiudi: () => void;
}

const stileCampo: React.CSSProperties = {
  width: '100%',
  padding: '9px 11px',
  borderRadius: 8,
  border: '1px solid var(--border)',
  background: 'var(--bg)',
  color: 'var(--text)',
  fontSize: 13,
};

const SPIEGA: Record<Stato, string> = {
  bozza: 'Il testo è in lavorazione. Chi lo usa sa che non è stato validato.',
  in_revisione: 'Qualcuno lo sta rileggendo. Resta utilizzabile, ma la rilettura non è finita.',
  approvato: 'Il testo è stato riletto e va bene così. Modificarlo dopo fa decadere l\'approvazione.',
};

export function ModaleRevisioneModello({ modello, onSalva, onChiudi }: Props) {
  const [stato, setStato] = useState<Stato>((modello.statoRevisione as Stato) || 'bozza');
  const [note, setNote] = useState<string>(modello.noteRevisione || '');
  const [salvataggio, setSalvataggio] = useState(false);
  const [errore, setErrore] = useState<string | null>(null);

  const invia = async () => {
    setErrore(null);
    setSalvataggio(true);
    const esito = await onSalva(stato, note.trim());
    setSalvataggio(false);
    if (!esito.ok) {
      setErrore(esito.messaggio);
      return;
    }
    onChiudi();
  };

  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,.75)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 200, padding: 16 }}>
      <div style={{ background: 'var(--sidebar)', border: '1px solid var(--border)', borderRadius: 16, padding: 22, width: '100%', maxWidth: 520, display: 'flex', flexDirection: 'column', gap: 14 }}>
        <div>
          <div style={{ fontSize: 16, fontWeight: 700 }}>🔎 Revisione del modello</div>
          <div style={{ fontSize: 12, color: 'var(--muted)', marginTop: 4 }}>{modello.titolo}</div>
        </div>

        {modello.diSerie && (
          <div style={{ fontSize: 11.5, color: 'var(--pill-blue-fg)', background: 'var(--surface-1)', border: '1px solid var(--pill-blue-bg)', borderRadius: 8, padding: '8px 10px', lineHeight: 1.5 }}>
            Questo modello arriva col programma e nessuno in questo studio lo ha ancora adottato.
            Registrando la revisione viene creata la copia dello studio: da lì in avanti è una carta
            vostra, e le modifiche non toccano gli altri studi.
          </div>
        )}

        <div>
          <label style={{ fontSize: 11, color: 'var(--muted)', display: 'block', marginBottom: 4 }}>Stato di revisione</label>
          <select value={stato} onChange={(e) => setStato(e.target.value as Stato)} style={stileCampo}>
            <option value="bozza">✎ Bozza</option>
            <option value="in_revisione">◑ In revisione</option>
            <option value="approvato">✓ Approvato</option>
          </select>
          <div style={{ fontSize: 11, color: 'var(--muted)', marginTop: 6, lineHeight: 1.5 }}>{SPIEGA[stato]}</div>
        </div>

        <div>
          <label style={{ fontSize: 11, color: 'var(--muted)', display: 'block', marginBottom: 4 }}>
            Nota di revisione (facoltativa, resta nel registro)
          </label>
          <textarea
            value={note}
            onChange={(e) => setNote(e.target.value)}
            rows={4}
            placeholder="es. Aggiornato il richiamo normativo all'art. 3; verificato con lo studio notarile."
            style={{ ...stileCampo, resize: 'vertical', fontFamily: 'inherit' }}
          />
        </div>

        {modello.versione ? (
          <div style={{ fontSize: 11, color: 'var(--muted)' }}>
            Versione corrente: v{modello.versione}
            {modello.revisionatoDaNome ? ` · ultima decisione di ${modello.revisionatoDaNome}` : ''}
            {modello.revisionatoAt ? ` il ${new Date(modello.revisionatoAt).toLocaleDateString('it-IT')}` : ''}
          </div>
        ) : null}

        {errore && (
          <div style={{ fontSize: 12, color: 'var(--pill-red-fg)', background: 'var(--pill-red-bg)', border: '1px solid var(--pill-red-bg)', borderRadius: 8, padding: '8px 10px' }}>
            ⚠️ {errore}
          </div>
        )}

        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
          <button
            type="button"
            onClick={onChiudi}
            disabled={salvataggio}
            style={{ background: 'transparent', border: '1px solid var(--border)', color: 'var(--muted)', padding: '8px 14px', borderRadius: 8, fontSize: 12, cursor: 'pointer' }}
          >
            Annulla
          </button>
          <button
            type="button"
            onClick={invia}
            disabled={salvataggio}
            style={{ background: 'var(--indigo)', color: '#fff', border: 'none', padding: '8px 16px', borderRadius: 8, fontSize: 12, fontWeight: 700, cursor: salvataggio ? 'default' : 'pointer', opacity: salvataggio ? 0.7 : 1 }}
          >
            {salvataggio ? 'Registrazione…' : '✓ Registra revisione'}
          </button>
        </div>
      </div>
    </div>
  );
}
