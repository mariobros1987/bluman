// §37 — Il contenuto di una cartella dell'archivio: i documenti di un progetto.
//
// Le righe arrivano da `GET /documenti?progettoId=…` (via `listaDocumentiProgetto`),
// che è l'unico posto che rinnova la firma HMAC degli URL /uploads/ e allega lo stato
// di firma letto dalla tabella `firma_elettronica`. Qui non si deduce niente: nessun
// badge «firmato» che non venga da un sigillo a database (regola 7).

import { useEffect, useState } from 'react';
import { listaDocumentiProgetto, scaricaDocumentoClient, urlFileArchivio, type DocumentoProgetto } from '../../api/client';

/** Il nome leggibile del file: senza il prefisso `${Date.now()}_` dell'archivio e senza query. */
export function nomeFileDocumento(d: DocumentoProgetto): string {
  const grezzo = (d.fileUrl || '').split('?')[0].split('/').pop() || '';
  const nome = decodeURIComponent(grezzo).replace(/^\d{13}_/, '');
  return nome || `Documento v${d.versione}`;
}

const ETICHETTA_TIPO: Record<string, string> = {
  template_vuoto: 'Modello vuoto',
  compilato: 'Generato',
  firmato: 'Copia firmata',
  allegato: 'Allegato',
  verbale_firma: 'Verbale di firma',
};

function Pillola({ testo, sfondo, colore }: { testo: string; sfondo: string; colore: string }) {
  return (
    <span style={{ padding: '3px 8px', borderRadius: 12, fontSize: 11, fontWeight: 600, background: sfondo, color: colore, whiteSpace: 'nowrap' }}>
      {testo}
    </span>
  );
}

function statoPillola(d: DocumentoProgetto) {
  if (d.isArchiviato) return <Pillola testo="🗄 Archiviato" sfondo="#334155" colore="#cbd5e1" />;
  if (d.firmato) return <Pillola testo="✓ Firmato" sfondo="#064e3b" colore="#6ee7b7" />;
  if (d.statoDoc === 'pubblicato') return <Pillola testo="📤 Pubblicato" sfondo="#1e3a8a" colore="#93c5fd" />;
  if (d.statoDoc === 'in_revisione') return <Pillola testo="✏️ In revisione" sfondo="#78350f" colore="#fcd34d" />;
  return <Pillola testo="Bozza" sfondo="#1f2937" colore="#9ca3af" />;
}

interface Props {
  progettoId: string;
  /** Mostra anche i documenti archiviati (il server li esclude per default). */
  includiArchiviati: boolean;
  /** Filtro testuale già normalizzato dalla pagina; stringa vuota = nessun filtro. */
  ricerca: string;
  onApriProgetto: () => void;
}

export function ElencoDocumentiCartella({ progettoId, includiArchiviati, ricerca, onApriProgetto }: Props) {
  const [documenti, setDocumenti] = useState<DocumentoProgetto[]>([]);
  const [caricamento, setCaricamento] = useState(true);
  const [errore, setErrore] = useState<string | null>(null);

  useEffect(() => {
    let annullato = false;
    setCaricamento(true);
    setErrore(null);
    listaDocumentiProgetto(progettoId, includiArchiviati)
      .then((righe) => {
        if (!annullato) setDocumenti(righe);
      })
      .catch((err) => {
        // Un errore di lettura non è «cartella vuota»: sono due cose diverse e si dicono diverse.
        if (!annullato) setErrore(err instanceof Error ? err.message : 'Impossibile leggere i documenti del progetto.');
      })
      .finally(() => {
        if (!annullato) setCaricamento(false);
      });
    return () => {
      annullato = true;
    };
  }, [progettoId, includiArchiviati]);

  const filtrati = ricerca
    ? documenti.filter((d) => {
        const testo = `${nomeFileDocumento(d)} ${d.categoriaDoc ?? ''} ${ETICHETTA_TIPO[d.tipo] ?? d.tipo} ${d.microvoceProgetto?.nome ?? ''}`;
        return testo.toLowerCase().includes(ricerca);
      })
    : documenti;

  if (caricamento) {
    return <div style={{ padding: '2rem', textAlign: 'center', color: 'var(--muted)' }}>Lettura dei documenti del progetto…</div>;
  }

  if (errore) {
    return (
      <div style={{ padding: '1.25rem', borderRadius: 10, background: 'rgba(239,68,68,0.08)', border: '1px solid #b91c1c', color: '#fca5a5', fontSize: 13 }}>
        ⚠️ {errore}
      </div>
    );
  }

  if (filtrati.length === 0) {
    return (
      <div style={{ padding: '2.5rem 1rem', textAlign: 'center', color: 'var(--muted)' }}>
        <div style={{ fontSize: 40, marginBottom: 10 }}>📂</div>
        <div style={{ fontSize: 14, fontWeight: 600, marginBottom: 6 }}>
          {documenti.length === 0 ? 'Questa cartella non contiene documenti' : 'Nessun documento corrisponde alla ricerca'}
        </div>
        <div style={{ fontSize: 12.5, marginBottom: 18 }}>
          {documenti.length === 0
            ? 'I documenti si caricano e si generano dalla scheda del progetto.'
            : 'Prova con un altro termine.'}
        </div>
        <button
          onClick={onApriProgetto}
          style={{ background: 'var(--indigo)', border: 'none', color: '#fff', padding: '9px 18px', borderRadius: 8, cursor: 'pointer', fontSize: 12.5, fontWeight: 600 }}
        >
          Apri la scheda del progetto ↗
        </button>
      </div>
    );
  }

  return (
    <table style={{ width: '100%', borderCollapse: 'collapse', textAlign: 'left' }}>
      <thead>
        <tr style={{ borderBottom: '2px solid var(--border)', color: 'var(--muted)', fontSize: 12, textTransform: 'uppercase' }}>
          <th style={{ padding: '10px 8px' }}>Documento</th>
          <th style={{ padding: '10px 8px' }}>Tipo</th>
          <th style={{ padding: '10px 8px' }}>Stato</th>
          <th style={{ padding: '10px 8px' }}>Caricato</th>
          <th style={{ padding: '10px 8px', textAlign: 'right' }}>File</th>
        </tr>
      </thead>
      <tbody>
        {filtrati.map((d) => {
          const nome = nomeFileDocumento(d);
          const urlPdf = urlFileArchivio(d.filePdfUrl || d.fileUrl);
          const urlDocx = urlFileArchivio(d.fileDocxUrl);
          return (
            <tr key={d.id} style={{ borderBottom: '1px solid var(--border)' }}>
              <td style={{ padding: '14px 8px' }}>
                <div style={{ fontWeight: 600, fontSize: 13.5, display: 'flex', alignItems: 'center', gap: 8 }}>
                  <span>{d.tipo === 'verbale_firma' ? '🧾' : d.firmato ? '🔐' : '📄'}</span>
                  <span style={{ wordBreak: 'break-all' }}>{nome}</span>
                  {d.versione > 1 && <Pillola testo={`v${d.versione}`} sfondo="#1f2937" colore="#9ca3af" />}
                </div>
                <div style={{ fontSize: 11.5, color: 'var(--muted)', marginTop: 3 }}>
                  {d.categoriaDoc && d.categoriaDoc !== 'generico' ? d.categoriaDoc : 'Fascicolo progetto'}
                  {d.microvoceProgetto?.nome ? ` · ${d.microvoceProgetto.nome}` : ''}
                  {d.livelloFirmaRichiesto && d.livelloFirmaRichiesto !== 'ses' ? ` · firma ${d.livelloFirmaRichiesto.toUpperCase()}` : ''}
                </div>
              </td>
              <td style={{ padding: '14px 8px', fontSize: 12.5, color: 'var(--muted)' }}>{ETICHETTA_TIPO[d.tipo] ?? d.tipo}</td>
              <td style={{ padding: '14px 8px' }}>{statoPillola(d)}</td>
              <td style={{ padding: '14px 8px', fontSize: 12.5, color: 'var(--muted)' }}>
                {new Date(d.createdAt).toLocaleDateString('it-IT')}
                {d.caricatoDa?.nome ? <div style={{ fontSize: 11 }}>{d.caricatoDa.nome}</div> : null}
              </td>
              <td style={{ padding: '14px 8px', textAlign: 'right' }}>
                <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', flexWrap: 'wrap' }}>
                  {urlPdf ? (
                    <a
                      href={urlPdf}
                      target="_blank"
                      rel="noreferrer"
                      style={{ background: 'transparent', border: '1px solid var(--border)', color: 'var(--text)', padding: '6px 10px', borderRadius: 6, fontSize: 12, textDecoration: 'none' }}
                    >
                      👁 Apri
                    </a>
                  ) : (
                    <span style={{ fontSize: 11.5, color: 'var(--muted)' }}>Nessun file collegato</span>
                  )}
                  {urlPdf && (
                    <button
                      onClick={() => scaricaDocumentoClient(d.filePdfUrl || d.fileUrl, nome)}
                      style={{ background: 'var(--card2)', border: '1px solid var(--border)', color: 'var(--text)', padding: '6px 10px', borderRadius: 6, fontSize: 12, cursor: 'pointer' }}
                    >
                      ⬇ PDF
                    </button>
                  )}
                  {urlDocx && (
                    <a
                      href={urlDocx}
                      target="_blank"
                      rel="noreferrer"
                      style={{ background: 'var(--card2)', border: '1px solid var(--border)', color: 'var(--text)', padding: '6px 10px', borderRadius: 6, fontSize: 12, textDecoration: 'none' }}
                    >
                      ⬇ Word
                    </a>
                  )}
                </div>
              </td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}
