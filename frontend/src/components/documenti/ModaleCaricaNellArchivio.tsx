// §40 — Caricare un documento direttamente nell'archivio, dentro una cartella.
//
// Prima si poteva caricare solo dalla scheda del progetto (`DocumentiTab`), e da lì la micro-voce
// non si sceglieva affatto: il documento finiva nel fascicolo e ci restava. Qui il file entra già
// collocato — progetto e, se serve, micro-voce — perché è nell'archivio che si ragiona per
// cartelle, ed è lì che si sa dove va la carta che si ha in mano.
//
// Il file viaggia in base64 verso `POST /documenti`, che è la stessa rotta della scheda progetto:
// scansione antivirus lato server (§28), riga nella tabella `documento`, audit con il nome di chi
// ha caricato. Nessun percorso alternativo e nessun salvataggio locale: se la chiamata non
// riesce, il documento non è stato archiviato e questo pannello lo dice (regola 3 e regola 7).

import { useState } from 'react';
import { salvaDocumentoApi } from '../../api/client';
import { useMicrovociProgetto } from '../../hooks/useMicrovociProgetto';

interface Props {
  progettoId: string;
  /** Il nome della cartella, solo per intestare il pannello. */
  nomeProgetto: string;
  onChiudi: () => void;
  /** Chiamata solo dopo che il server ha confermato l'archiviazione. */
  onCaricato: () => void;
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

/** Il contenuto base64 puro, senza il prefisso `data:...;base64,` che il server non vuole. */
function leggiBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const lettore = new FileReader();
    lettore.onload = () => resolve(((lettore.result as string) || '').split(',')[1] || '');
    lettore.onerror = () => reject(new Error('Lettura del file non riuscita.'));
    lettore.readAsDataURL(file);
  });
}

export function ModaleCaricaNellArchivio({ progettoId, nomeProgetto, onChiudi, onCaricato }: Props) {
  const [file, setFile] = useState<File | null>(null);
  const [microvoceId, setMicrovoceId] = useState('');
  const [categoria, setCategoria] = useState('');
  const [scadenza, setScadenza] = useState('');
  const [pubblica, setPubblica] = useState(false);
  const [caricamento, setCaricamento] = useState(false);
  const [errore, setErrore] = useState<string | null>(null);

  const { microvoci, caricamento: caricoMicrovoci, errore: erroreMicrovoci } = useMicrovociProgetto(progettoId);

  const invia = async () => {
    setErrore(null);
    if (!file) {
      setErrore('Scegliere il file da archiviare.');
      return;
    }
    setCaricamento(true);
    try {
      const contentBase64 = await leggiBase64(file);
      await salvaDocumentoApi({
        progettoId,
        // La micro-voce viaggia solo se scelta: il server verifica che appartenga a questo
        // progetto e rifiuta con 400 se non è così.
        ...(microvoceId ? { microvoceProgettoId: microvoceId } : {}),
        filename: file.name,
        contentBase64,
        categoriaDoc: categoria.trim() || 'Allegati Archivio',
        ...(scadenza ? { dataScadenzaDoc: scadenza } : {}),
        statoDoc: pubblica ? 'pubblicato' : 'bozza',
        tipo: 'allegato',
      });
      onCaricato();
      onChiudi();
    } catch (err) {
      setErrore(err instanceof Error ? err.message : 'Archiviazione non riuscita.');
    } finally {
      setCaricamento(false);
    }
  };

  return (
    <div
      onClick={onChiudi}
      style={{ position: 'fixed', inset: 0, background: 'rgba(2,6,23,0.72)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000, padding: 16 }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{ background: 'var(--card)', border: '1px solid var(--border)', borderRadius: 14, padding: '1.5rem', width: 'min(560px, 100%)', maxHeight: '90vh', overflowY: 'auto' }}
      >
        <h3 style={{ margin: 0, fontSize: 16 }}>⬆️ Carica un documento nell'archivio</h3>
        <p style={{ color: 'var(--muted)', fontSize: 12.5, margin: '6px 0 1.25rem 0' }}>
          Cartella di destinazione: <strong style={{ color: 'var(--text)' }}>{nomeProgetto}</strong>
        </p>

        <label style={{ display: 'block', fontSize: 12, color: 'var(--muted)', marginBottom: 6 }}>File</label>
        <input
          type="file"
          onChange={(e) => setFile(e.target.files?.[0] ?? null)}
          disabled={caricamento}
          style={{ ...stileCampo, padding: '8px 10px' }}
        />
        <div style={{ fontSize: 11, color: 'var(--muted)', marginTop: 6, marginBottom: '1.1rem' }}>
          {file ? `${file.name} · ${(file.size / 1024).toFixed(0)} KB` : 'Nessun file scelto.'}
        </div>

        <label style={{ display: 'block', fontSize: 12, color: 'var(--muted)', marginBottom: 6 }}>Micro-voce (facoltativa)</label>
        <select
          value={microvoceId}
          onChange={(e) => setMicrovoceId(e.target.value)}
          disabled={caricoMicrovoci || caricamento}
          style={stileCampo}
        >
          <option value="">— Nessuna: solo il fascicolo del progetto —</option>
          {microvoci.map((mv) => (
            <option key={mv.id} value={mv.id}>
              {mv.modulo} · {mv.nome}
            </option>
          ))}
        </select>
        <div style={{ fontSize: 11, color: erroreMicrovoci ? '#fca5a5' : 'var(--muted)', marginTop: 6, marginBottom: '1.1rem' }}>
          {caricoMicrovoci
            ? 'Lettura delle micro-voci del progetto…'
            : erroreMicrovoci
              ? `⚠️ ${erroreMicrovoci}`
              : microvoci.length === 0
                ? 'Questo progetto non ha micro-voci: il documento resta nel fascicolo.'
                : 'Collegando la micro-voce, il documento compare anche nella sua lavorazione.'}
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: 12 }}>
          <div>
            <label style={{ display: 'block', fontSize: 12, color: 'var(--muted)', marginBottom: 6 }}>Categoria</label>
            <input
              type="text"
              value={categoria}
              onChange={(e) => setCategoria(e.target.value)}
              placeholder="Allegati Archivio"
              disabled={caricamento}
              style={stileCampo}
            />
          </div>
          <div>
            <label style={{ display: 'block', fontSize: 12, color: 'var(--muted)', marginBottom: 6 }}>Scadenza (facoltativa)</label>
            <input type="date" value={scadenza} onChange={(e) => setScadenza(e.target.value)} disabled={caricamento} style={stileCampo} />
          </div>
        </div>

        <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12.5, color: 'var(--muted)', cursor: 'pointer', marginTop: '1.1rem' }}>
          <input type="checkbox" checked={pubblica} onChange={(e) => setPubblica(e.target.checked)} disabled={caricamento} />
          Pubblica subito nel portale del cliente
        </label>

        {errore && (
          <div style={{ marginTop: '1.1rem', padding: '10px 12px', borderRadius: 8, background: 'rgba(239,68,68,0.08)', border: '1px solid #b91c1c', color: '#fca5a5', fontSize: 12.5 }}>
            ⚠️ {errore}
          </div>
        )}

        <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end', marginTop: '1.5rem' }}>
          <button
            onClick={onChiudi}
            disabled={caricamento}
            style={{ background: 'transparent', border: '1px solid var(--border)', color: 'var(--text)', padding: '9px 16px', borderRadius: 8, cursor: 'pointer', fontSize: 12.5 }}
          >
            Annulla
          </button>
          <button
            onClick={invia}
            disabled={caricamento || !file}
            style={{ background: 'var(--indigo)', border: 'none', color: '#fff', padding: '9px 18px', borderRadius: 8, cursor: caricamento || !file ? 'default' : 'pointer', fontSize: 12.5, fontWeight: 600, opacity: caricamento || !file ? 0.6 : 1 }}
          >
            {caricamento ? 'Archiviazione…' : 'Archivia nella cartella'}
          </button>
        </div>
      </div>
    </div>
  );
}
