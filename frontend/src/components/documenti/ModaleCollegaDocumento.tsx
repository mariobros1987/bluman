// §40 — Il pannello che collega un documento a un progetto e a una micro-voce.
//
// È l'unico posto dell'interfaccia che sposta una carta da una cartella all'altra. Serve due casi
// con lo stesso codice, perché la decisione da prendere è la stessa:
//
//  - un documento già in una cartella, che va agganciato alla micro-voce giusta (o staccato);
//  - un documento «non collocato», il cui progetto è stato eliminato: qui il progetto si sceglie
//    da zero fra tutti quelli dell'archivio.
//
// Chi decide se il collegamento sta in piedi è il server (`decidiCollocazione`): questo pannello
// non replica la regola, la chiede. Se il server risponde 400 perché la micro-voce appartiene a
// un altro progetto, il messaggio che si legge qui è quello del server — così quello che l'utente
// vede è quello che è stato davvero valutato, non una seconda versione della regola scritta qui.

import { useEffect, useState } from 'react';
import { collegaDocumentoApi } from '../../api/client';
import { useMicrovociProgetto } from '../../hooks/useMicrovociProgetto';
import { Modal } from '../ui/Modal';

export interface ProgettoScelta {
  id: string;
  nome: string;
  /** Il cliente, per distinguere due progetti omonimi di clienti diversi. */
  cliente: string;
}

interface Props {
  documento: { id: string; nome: string; progettoId: string | null; microvoceProgettoId: string | null };
  /** I progetti dell'archivio fra cui si può scegliere. */
  progetti: ProgettoScelta[];
  /** `true` quando il progetto non si cambia (documento già nella cartella giusta): resta la micro-voce. */
  progettoBloccato?: boolean;
  onChiudi: () => void;
  /** Chiamata solo dopo che il server ha confermato la scrittura. */
  onCollegato: () => void;
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

export function ModaleCollegaDocumento({ documento, progetti, progettoBloccato = false, onChiudi, onCollegato }: Props) {
  const [progettoId, setProgettoId] = useState<string>(documento.progettoId ?? '');
  const [microvoceId, setMicrovoceId] = useState<string>(documento.microvoceProgettoId ?? '');
  const [salvataggio, setSalvataggio] = useState(false);
  const [errore, setErrore] = useState<string | null>(null);

  const { microvoci, caricamento: caricoMicrovoci, errore: erroreMicrovoci } = useMicrovociProgetto(progettoId);

  // Cambiando progetto la micro-voce scelta prima non vale più: appartiene all'altro progetto ed
  // è esattamente il collegamento che il server rifiuta. Si azzera invece di restare a schermo.
  useEffect(() => {
    if (progettoId !== documento.progettoId) setMicrovoceId('');
  }, [progettoId, documento.progettoId]);

  const invia = async () => {
    setErrore(null);
    if (!progettoId) {
      setErrore('Scegliere il progetto: un documento senza progetto non compare in nessuna cartella.');
      return;
    }
    setSalvataggio(true);
    try {
      await collegaDocumentoApi(documento.id, {
        progettoId,
        // Stringa vuota = «nessuna micro-voce»: va inviato `null`, che è una scrittura e stacca
        // il collegamento precedente. Ometterlo lascerebbe il documento agganciato com'era.
        microvoceProgettoId: microvoceId || null,
      });
      onCollegato();
      onChiudi();
    } catch (err) {
      setErrore(err instanceof Error ? err.message : 'Collegamento non riuscito.');
    } finally {
      setSalvataggio(false);
    }
  };

  return (
    <Modal onClose={onChiudi} overlayBackground="rgba(2,6,23,0.72)" zIndex={1000} labelledBy="collega-doc-titolo">
      {(richiediChiusura) => (
      <div
        style={{ background: 'var(--card)', border: '1px solid var(--border)', borderRadius: 14, padding: '1.5rem', width: 'min(560px, 100%)', maxHeight: '90vh', overflowY: 'auto' }}
      >
        <h3 id="collega-doc-titolo" style={{ margin: 0, fontSize: 16 }}>🔗 Collega il documento a una cartella</h3>
        <p style={{ color: 'var(--muted)', fontSize: 12.5, margin: '6px 0 1.25rem 0', wordBreak: 'break-all' }}>{documento.nome}</p>

        <label style={{ display: 'block', fontSize: 12, color: 'var(--muted)', marginBottom: 6 }}>Progetto</label>
        <select
          value={progettoId}
          onChange={(e) => setProgettoId(e.target.value)}
          disabled={progettoBloccato || salvataggio}
          style={{ ...stileCampo, marginBottom: 4, opacity: progettoBloccato ? 0.7 : 1 }}
        >
          <option value="">— Scegli il progetto —</option>
          {progetti.map((p) => (
            <option key={p.id} value={p.id}>
              {p.cliente} · {p.nome}
            </option>
          ))}
        </select>
        <div style={{ fontSize: 11, color: 'var(--muted)', marginBottom: '1.1rem' }}>
          {progettoBloccato
            ? 'Il documento resta in questa cartella: qui si sceglie solo la micro-voce.'
            : 'Spostando il documento in un altro progetto, la micro-voce va riscelta fra quelle di quel progetto.'}
        </div>

        <label style={{ display: 'block', fontSize: 12, color: 'var(--muted)', marginBottom: 6 }}>Micro-voce (facoltativa)</label>
        <select
          value={microvoceId}
          onChange={(e) => setMicrovoceId(e.target.value)}
          disabled={!progettoId || caricoMicrovoci || salvataggio}
          style={stileCampo}
        >
          <option value="">— Nessuna: solo il fascicolo del progetto —</option>
          {microvoci.map((mv) => (
            <option key={mv.id} value={mv.id}>
              {mv.modulo} · {mv.nome}
            </option>
          ))}
        </select>
        <div style={{ fontSize: 11, color: erroreMicrovoci ? 'var(--pill-red-fg)' : 'var(--muted)', marginTop: 6 }}>
          {!progettoId
            ? 'Scegli prima il progetto.'
            : caricoMicrovoci
              ? 'Lettura delle micro-voci del progetto…'
              : erroreMicrovoci
                ? `⚠️ ${erroreMicrovoci}`
                : microvoci.length === 0
                  ? 'Questo progetto non ha micro-voci: il documento resta nel fascicolo.'
                  : `${microvoci.length} micro-voc${microvoci.length === 1 ? 'e' : 'i'} in questo progetto.`}
        </div>

        {errore && (
          <div style={{ marginTop: '1.1rem', padding: '10px 12px', borderRadius: 8, background: 'rgba(239,68,68,0.08)', border: '1px solid var(--pill-red-bd)', color: 'var(--pill-red-fg)', fontSize: 12.5 }}>
            ⚠️ {errore}
          </div>
        )}

        <div style={{ fontSize: 11, color: 'var(--muted)', marginTop: '1.1rem', lineHeight: 1.5 }}>
          Lo spostamento resta scritto nel giornale di audit con il nome di chi lo ha fatto, la cartella
          di partenza e quella di arrivo. Il file e le firme non vengono toccati.
        </div>

        <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end', marginTop: '1.5rem' }}>
          <button
            onClick={richiediChiusura}
            disabled={salvataggio}
            style={{ background: 'transparent', border: '1px solid var(--border)', color: 'var(--text)', padding: '9px 16px', borderRadius: 8, cursor: 'pointer', fontSize: 12.5 }}
          >
            Annulla
          </button>
          <button
            onClick={invia}
            disabled={salvataggio || !progettoId}
            style={{ background: 'var(--indigo)', border: 'none', color: '#fff', padding: '9px 18px', borderRadius: 8, cursor: salvataggio || !progettoId ? 'default' : 'pointer', fontSize: 12.5, fontWeight: 600, opacity: salvataggio || !progettoId ? 0.6 : 1 }}
          >
            {salvataggio ? 'Collegamento…' : 'Collega'}
          </button>
        </div>
      </div>
      )}
    </Modal>
  );
}
