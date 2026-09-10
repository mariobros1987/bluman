// §37 — Il contenuto di una cartella dell'archivio: i documenti di un progetto.
//
// Le righe arrivano da `GET /documenti?progettoId=…` (via `listaDocumentiProgetto`),
// che è l'unico posto che rinnova la firma HMAC degli URL /uploads/ e allega lo stato
// di firma letto dalla tabella `firma_elettronica`. Qui non si deduce niente: nessun
// badge «firmato» che non venga da un sigillo a database (regola 7).
//
// §40 — La cartella non è più in sola lettura: da qui si carica un documento (già collocato) e si
// aggancia o si sposta la micro-voce. Le due operazioni le fanno `ModaleCaricaNellArchivio` e
// `ModaleCollegaDocumento`; qui si ricarica l'elenco solo dopo la conferma del server, perché una
// riga che compare senza che il server l'abbia scritta è la bugia che la regola 3 vieta.

import { useEffect, useState } from 'react';
import { listaDocumentiProgetto, scaricaDocumentoClient, urlFileArchivio, type DocumentoProgetto } from '../../api/client';
import { ModaleCollegaDocumento, type ProgettoScelta } from './ModaleCollegaDocumento';
import { ModaleCaricaNellArchivio } from './ModaleCaricaNellArchivio';

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
  /** Il nome della cartella: serve ai pannelli di caricamento e collegamento. */
  nomeProgetto: string;
  /** I progetti fra cui si può spostare un documento (li conosce già la pagina archivio). */
  progetti: ProgettoScelta[];
  /** Mostra anche i documenti archiviati (il server li esclude per default). */
  includiArchiviati: boolean;
  /** Filtro testuale già normalizzato dalla pagina; stringa vuota = nessun filtro. */
  ricerca: string;
  onApriProgetto: () => void;
  /** §40 — l'archivio ricarica i conteggi: un documento caricato o spostato li cambia. */
  onArchivioCambiato?: () => void;
}

export function ElencoDocumentiCartella({ progettoId, nomeProgetto, progetti, includiArchiviati, ricerca, onApriProgetto, onArchivioCambiato }: Props) {
  const [documenti, setDocumenti] = useState<DocumentoProgetto[]>([]);
  const [caricamento, setCaricamento] = useState(true);
  const [errore, setErrore] = useState<string | null>(null);
  const [ricarica, setRicarica] = useState(0);
  const [daCollegare, setDaCollegare] = useState<DocumentoProgetto | null>(null);
  const [caricaAperto, setCaricaAperto] = useState(false);

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
  }, [progettoId, includiArchiviati, ricarica]);

  /** Dopo una scrittura confermata dal server: si rilegge l'elenco e si avvisa l'archivio. */
  const dopoScrittura = () => {
    setRicarica((n) => n + 1);
    onArchivioCambiato?.();
  };

  const pannelli = (
    <>
      {caricaAperto && (
        <ModaleCaricaNellArchivio
          progettoId={progettoId}
          nomeProgetto={nomeProgetto}
          onChiudi={() => setCaricaAperto(false)}
          onCaricato={dopoScrittura}
        />
      )}
      {daCollegare && (
        <ModaleCollegaDocumento
          documento={{
            id: daCollegare.id,
            nome: nomeFileDocumento(daCollegare),
            progettoId: daCollegare.progettoId,
            microvoceProgettoId: daCollegare.microvoceProgettoId,
          }}
          progetti={progetti}
          onChiudi={() => setDaCollegare(null)}
          onCollegato={dopoScrittura}
        />
      )}
    </>
  );

  const barraAzioni = (
    <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 10, marginBottom: 14 }}>
      <button
        onClick={() => setCaricaAperto(true)}
        style={{ background: 'var(--indigo)', border: 'none', color: '#fff', padding: '8px 14px', borderRadius: 8, cursor: 'pointer', fontSize: 12.5, fontWeight: 600 }}
      >
        ⬆️ Carica in questa cartella
      </button>
    </div>
  );

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
      <>
        {pannelli}
        {barraAzioni}
        <div style={{ padding: '2.5rem 1rem', textAlign: 'center', color: 'var(--muted)' }}>
          <div style={{ fontSize: 40, marginBottom: 10 }}>📂</div>
          <div style={{ fontSize: 14, fontWeight: 600, marginBottom: 6 }}>
            {documenti.length === 0 ? 'Questa cartella non contiene documenti' : 'Nessun documento corrisponde alla ricerca'}
          </div>
          <div style={{ fontSize: 12.5, marginBottom: 18 }}>
            {documenti.length === 0
              ? 'Puoi caricare un documento qui sopra, oppure generarlo dalla scheda del progetto.'
              : 'Prova con un altro termine.'}
          </div>
          <button
            onClick={onApriProgetto}
            style={{ background: 'var(--card2)', border: '1px solid var(--border)', color: 'var(--text)', padding: '9px 18px', borderRadius: 8, cursor: 'pointer', fontSize: 12.5, fontWeight: 600 }}
          >
            Apri la scheda del progetto ↗
          </button>
        </div>
      </>
    );
  }

  return (
    <>
      {pannelli}
      {barraAzioni}
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
            // Fix firma — l'atto sottoscritto esiste come file separato solo nel flusso con
            // file caricato (FEQ/SES manuale): per le copie §36 (tipo 'firmato') il PDF È
            // l'atto firmato, e il verbale (tipo 'verbale_firma') attesta, non sottoscrive.
            const urlAttoFirmato = d.firma?.fileFirmatoUrl ?? null;
            const mostraAttoFirmato = Boolean(urlAttoFirmato) && d.tipo !== 'verbale_firma' && d.tipo !== 'firmato';
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
                    {d.microvoceProgetto?.nome ? ` · ${d.microvoceProgetto.nome}` : ' · nessuna micro-voce'}
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
                    {/* Fix firma — l'atto come sottoscritto, distinto dal PDF master e dal
                        verbale: il file firmato caricato (FEQ/SES), con l'estensione vera
                        dedotta dall'URL (.p7m/.docx/…), non arbitrariamente .pdf. */}
                    {mostraAttoFirmato && urlAttoFirmato && (
                      <button
                        onClick={() => {
                          const estensione = (urlAttoFirmato.split('?')[0].match(/\.([a-zA-Z0-9]+)$/) || [])[1]?.toLowerCase() || '';
                          const nomeBase = (nome.replace(/\.[^/.]+$/, '') || 'Documento').replace(/[^a-zA-Z0-9_-]/g, '_');
                          void scaricaDocumentoClient(urlAttoFirmato, estensione ? `${nomeBase}_firmato.${estensione}` : `${nomeBase}_firmato`);
                        }}
                        title="L'atto come sottoscritto (file firmato), distinto dal PDF master e dal verbale di firma"
                        style={{ background: '#059669', border: 'none', color: '#fff', padding: '6px 10px', borderRadius: 6, fontSize: 12, fontWeight: 600, cursor: 'pointer' }}
                      >
                        ✍️ Atto firmato
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
                    {/* §40 — anche un documento firmato si può spostare: il contenuto non viene
                        toccato e il sigillo è calcolato sul file, non sulla cartella. */}
                    <button
                      onClick={() => setDaCollegare(d)}
                      title="Collega il documento a una micro-voce o spostalo in un altro progetto"
                      style={{ background: 'var(--card2)', border: '1px solid var(--border)', color: 'var(--text)', padding: '6px 10px', borderRadius: 6, fontSize: 12, cursor: 'pointer' }}
                    >
                      🔗 Collega
                    </button>
                  </div>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </>
  );
}
