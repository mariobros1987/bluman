// §40 — I documenti che non stanno in nessuna cartella, e come rimetterli a posto.
//
// L'archivio (§37) dichiarava «N documenti non compaiono in nessuna cartella» e si fermava lì: era
// un avviso senza rimedio. Questi documenti nascono da un progetto eliminato — `onDelete: SetNull`
// azzera le due chiavi e la carta resta a database senza cartella — quindi il file e le firme ci
// sono ancora, e vanno ricollocati, non ricreati.
//
// Le righe arrivano da `GET /documenti/non-collocati`. Non si mostra un elenco vuoto quando la
// lettura non riesce: «nessun documento sospeso» e «non ho potuto leggere» sono due cose diverse
// e qui si dicono diverse (regola 7).

import { useEffect, useState } from 'react';
import { documentiNonCollocatiApi, type DocumentoNonCollocato } from '../../api/client';
import { ModaleCollegaDocumento, type ProgettoScelta } from './ModaleCollegaDocumento';

interface Props {
  /** I progetti fra cui scegliere la nuova cartella. */
  progetti: ProgettoScelta[];
  /** §40 — l'archivio ricarica i conteggi: un documento ricollocato cambia i totali. */
  onArchivioCambiato?: () => void;
}

export function ElencoNonCollocati({ progetti, onArchivioCambiato }: Props) {
  const [documenti, setDocumenti] = useState<DocumentoNonCollocato[]>([]);
  const [caricamento, setCaricamento] = useState(true);
  const [errore, setErrore] = useState<string | null>(null);
  const [ricarica, setRicarica] = useState(0);
  const [daCollegare, setDaCollegare] = useState<DocumentoNonCollocato | null>(null);

  useEffect(() => {
    let annullato = false;
    setCaricamento(true);
    setErrore(null);
    documentiNonCollocatiApi()
      .then((righe) => {
        if (!annullato) setDocumenti(righe);
      })
      .catch((err) => {
        if (!annullato) setErrore(err instanceof Error ? err.message : 'Impossibile leggere i documenti non collocati.');
      })
      .finally(() => {
        if (!annullato) setCaricamento(false);
      });
    return () => {
      annullato = true;
    };
  }, [ricarica]);

  if (caricamento) {
    return <div style={{ padding: '2rem', textAlign: 'center', color: 'var(--muted)' }}>Lettura dei documenti non collocati…</div>;
  }

  if (errore) {
    return (
      <div style={{ padding: '1.25rem', borderRadius: 10, background: 'rgba(239,68,68,0.08)', border: '1px solid #b91c1c', color: '#fca5a5', fontSize: 13 }}>
        ⚠️ {errore}
      </div>
    );
  }

  if (documenti.length === 0) {
    return (
      <div style={{ padding: '2.5rem 1rem', textAlign: 'center', color: 'var(--muted)' }}>
        <div style={{ fontSize: 40, marginBottom: 10 }}>✅</div>
        <div style={{ fontSize: 14, fontWeight: 600 }}>Ogni documento sta in una cartella</div>
        <div style={{ fontSize: 12.5, marginTop: 6 }}>Nessun documento è rimasto senza progetto.</div>
      </div>
    );
  }

  return (
    <>
      {daCollegare && (
        <ModaleCollegaDocumento
          documento={{ id: daCollegare.id, nome: daCollegare.nome, progettoId: null, microvoceProgettoId: null }}
          progetti={progetti}
          onChiudi={() => setDaCollegare(null)}
          onCollegato={() => {
            setRicarica((n) => n + 1);
            onArchivioCambiato?.();
          }}
        />
      )}

      <div style={{ padding: '10px 14px', borderRadius: 10, background: 'rgba(251,191,36,0.08)', border: '1px solid #b45309', color: '#fcd34d', fontSize: 12.5, marginBottom: 16 }}>
        Il progetto a cui erano agganciati è stato eliminato: il file e le eventuali firme restano
        conservati a database. Scegliendo una cartella il documento torna visibile nel fascicolo, e
        lo spostamento resta scritto nel giornale di audit.
      </div>

      <table style={{ width: '100%', borderCollapse: 'collapse', textAlign: 'left' }}>
        <thead>
          <tr style={{ borderBottom: '2px solid var(--border)', color: 'var(--muted)', fontSize: 12, textTransform: 'uppercase' }}>
            <th style={{ padding: '10px 8px' }}>Documento</th>
            <th style={{ padding: '10px 8px' }}>Stato</th>
            <th style={{ padding: '10px 8px' }}>Caricato</th>
            <th style={{ padding: '10px 8px', textAlign: 'right' }}>Azione</th>
          </tr>
        </thead>
        <tbody>
          {documenti.map((d) => (
            <tr key={d.id} style={{ borderBottom: '1px solid var(--border)' }}>
              <td style={{ padding: '14px 8px' }}>
                <div style={{ fontWeight: 600, fontSize: 13.5, wordBreak: 'break-all' }}>📄 {d.nome}</div>
                <div style={{ fontSize: 11.5, color: 'var(--muted)', marginTop: 3 }}>
                  {d.categoriaDoc && d.categoriaDoc !== 'generico' ? d.categoriaDoc : 'Senza categoria'}
                  {d.versione > 1 ? ` · v${d.versione}` : ''}
                </div>
              </td>
              <td style={{ padding: '14px 8px', fontSize: 12.5, color: 'var(--muted)' }}>
                {d.isArchiviato ? '🗄 Archiviato' : d.statoDoc ?? '—'}
              </td>
              <td style={{ padding: '14px 8px', fontSize: 12.5, color: 'var(--muted)' }}>
                {new Date(d.createdAt).toLocaleDateString('it-IT')}
                {d.caricatoDa ? <div style={{ fontSize: 11 }}>{d.caricatoDa}</div> : null}
              </td>
              <td style={{ padding: '14px 8px', textAlign: 'right' }}>
                <button
                  onClick={() => setDaCollegare(d)}
                  style={{ background: 'var(--indigo)', border: 'none', color: '#fff', padding: '7px 12px', borderRadius: 7, cursor: 'pointer', fontSize: 12, fontWeight: 600 }}
                >
                  🔗 Scegli la cartella
                </button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </>
  );
}
