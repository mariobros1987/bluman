// §37 — Archivio documentale dello studio: navigazione Cliente → Progetto → Documenti.
//
// L'albero delle cartelle con i conteggi arriva da `GET /documenti/archivio`; le carte di
// un progetto le serve `GET /documenti?progettoId=…` (componente `ElencoDocumentiCartella`).
// Nessuna migrazione e nessun nuovo dato: ogni numero mostrato qui è una riga che il
// database ha già. Niente conteggi ricostruiti da localStorage — se l'API non risponde la
// pagina lo dice, invece di mostrare un archivio vuoto che sembra vero (regola 7).
//
// §40 — L'archivio scrive: dentro una cartella si carica un documento già collocato, e da ogni
// riga si aggancia la micro-voce o si sposta la carta in un altro progetto. I documenti rimasti
// senza cartella (progetto eliminato) hanno la loro vista, raggiungibile dall'avviso in testa.

import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { archivioDocumentiApi, type ClienteArchivio, type ProgettoArchivio, type TotaliArchivio } from '../api/client';
import { ElencoDocumentiCartella } from '../components/documenti/ElencoDocumentiCartella';
import { ElencoNonCollocati } from '../components/documenti/ElencoNonCollocati';
import type { ProgettoScelta } from '../components/documenti/ModaleCollegaDocumento';

const STATO_PROGETTO: Record<string, string> = {
  pre_project: 'Pre-progetto',
  in_corso: 'In corso',
  completato: 'Completato',
  sospeso: 'Sospeso',
  annullato: 'Annullato',
};

function dataBreve(iso: string | null): string {
  if (!iso) return '—';
  return new Date(iso).toLocaleDateString('it-IT');
}

function Riquadro({ etichetta, valore, sfondo, bordo, colore }: { etichetta: string; valore: string; sfondo: string; bordo: string; colore: string }) {
  return (
    <div style={{ background: sfondo, padding: 16, borderRadius: 12, border: `1px solid ${bordo}` }}>
      <div style={{ fontSize: 11.5, color: colore, textTransform: 'uppercase', fontWeight: 600, letterSpacing: 0.3 }}>{etichetta}</div>
      <div style={{ fontSize: 22, fontWeight: 700, color: '#fff', marginTop: 6 }}>{valore}</div>
    </div>
  );
}

function CartellaCard({
  icona,
  titolo,
  sottotitolo,
  contatori,
  onClick,
}: {
  icona: string;
  titolo: string;
  sottotitolo: string;
  contatori: { documenti: number; firmati: number; daFirmare: number; archiviati: number; ultimoCaricamento: string | null };
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      style={{
        textAlign: 'left',
        background: 'var(--card2)',
        border: '1px solid var(--border)',
        borderRadius: 12,
        padding: 16,
        cursor: 'pointer',
        color: 'var(--text)',
        display: 'flex',
        flexDirection: 'column',
        gap: 10,
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
        <span style={{ fontSize: 26 }}>{icona}</span>
        <div style={{ minWidth: 0 }}>
          <div style={{ fontWeight: 700, fontSize: 14, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{titolo}</div>
          <div style={{ fontSize: 11.5, color: 'var(--muted)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{sottotitolo}</div>
        </div>
      </div>
      <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', fontSize: 11.5, color: 'var(--muted)' }}>
        <span>📄 {contatori.documenti} doc.</span>
        {contatori.firmati > 0 && <span style={{ color: 'var(--pill-green-fg)' }}>✓ {contatori.firmati} firmati</span>}
        {contatori.daFirmare > 0 && <span style={{ color: 'var(--pill-amber-fg)' }}>⏳ {contatori.daFirmare} da firmare</span>}
        {contatori.archiviati > 0 && <span>🗄 {contatori.archiviati}</span>}
      </div>
      <div style={{ fontSize: 11, color: 'var(--muted)' }}>Ultimo caricamento: {dataBreve(contatori.ultimoCaricamento)}</div>
    </button>
  );
}

export function ArchivioDocumentiPage() {
  const navigate = useNavigate();
  const [clienti, setClienti] = useState<ClienteArchivio[]>([]);
  const [totali, setTotali] = useState<TotaliArchivio | null>(null);
  const [caricamento, setCaricamento] = useState(true);
  const [errore, setErrore] = useState<string | null>(null);

  const [clienteId, setClienteId] = useState<string | null>(null);
  const [progettoId, setProgettoId] = useState<string | null>(null);
  const [ricerca, setRicerca] = useState('');
  const [includiArchiviati, setIncludiArchiviati] = useState(false);
  const [nascondiVuote, setNascondiVuote] = useState(true);
  // §40 — la vista dei documenti rimasti senza cartella: si apre dall'avviso in testa.
  const [vistaNonCollocati, setVistaNonCollocati] = useState(false);

  // §40 — dopo un caricamento o uno spostamento i conteggi delle cartelle non sono più quelli:
  // si rileggono dal server invece di aggiustarli a mano qui (che è come si inventano i numeri).
  const [ricaricaArchivio, setRicaricaArchivio] = useState(0);

  useEffect(() => {
    let annullato = false;
    archivioDocumentiApi()
      .then((dati) => {
        if (annullato) return;
        setClienti(dati.clienti);
        setTotali(dati.totali);
      })
      .catch((err) => {
        if (!annullato) setErrore(err instanceof Error ? err.message : "Impossibile leggere l'archivio documentale.");
      })
      .finally(() => {
        if (!annullato) setCaricamento(false);
      });
    return () => {
      annullato = true;
    };
  }, [ricaricaArchivio]);

  const filtro = ricerca.trim().toLowerCase();
  const cliente = clienteId ? clienti.find((c) => c.id === clienteId) ?? null : null;
  const progetto: ProgettoArchivio | null = progettoId ? cliente?.progetti.find((p) => p.id === progettoId) ?? null : null;

  // §40 — tutte le cartelle in cui un documento può essere spostato, col nome del cliente
  // accanto: due progetti omonimi di clienti diversi sono indistinguibili senza.
  const progettiScelta = useMemo<ProgettoScelta[]>(
    () =>
      clienti.flatMap((c) =>
        c.progetti.map((p) => ({ id: p.id, nome: p.numeroContratto ? `${p.nome} (${p.numeroContratto})` : p.nome, cliente: c.nome })),
      ),
    [clienti],
  );

  const clientiVisibili = useMemo(() => {
    return clienti.filter((c) => {
      if (nascondiVuote && c.documenti === 0 && c.archiviati === 0) return false;
      if (!filtro) return true;
      const testo = `${c.nome} ${c.progetti.map((p) => `${p.nome} ${p.numeroContratto ?? ''}`).join(' ')}`;
      return testo.toLowerCase().includes(filtro);
    });
  }, [clienti, filtro, nascondiVuote]);

  const progettiVisibili = useMemo(() => {
    if (!cliente) return [];
    return cliente.progetti.filter((p) => {
      if (nascondiVuote && p.documenti === 0 && p.archiviati === 0) return false;
      if (!filtro) return true;
      return `${p.nome} ${p.numeroContratto ?? ''}`.toLowerCase().includes(filtro);
    });
  }, [cliente, filtro, nascondiVuote]);

  return (
    <div style={{ padding: '2rem' }}>
      <div style={{ marginBottom: '1.5rem' }}>
        <h2 style={{ margin: 0 }}>📂 Archivio Documentale Studio</h2>
        <p style={{ color: 'var(--muted)', margin: '4px 0 0 0', fontSize: 14 }}>
          Tutte le carte dello studio in una gerarchia sola: Cliente → Progetto → Documenti.
        </p>
      </div>

      {/* Percorso di navigazione */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap', marginBottom: '1.25rem', fontSize: 13 }}>
        <button
          onClick={() => {
            setClienteId(null);
            setProgettoId(null);
            setVistaNonCollocati(false);
          }}
          style={{ background: 'transparent', border: 'none', color: clienteId || vistaNonCollocati ? 'var(--indigo-l)' : 'var(--text)', fontWeight: 700, cursor: 'pointer', padding: 0, fontSize: 13 }}
        >
          Archivio
        </button>
        {vistaNonCollocati && (
          <>
            <span style={{ color: 'var(--muted)' }}>/</span>
            <span style={{ fontWeight: 700 }}>Documenti senza cartella</span>
          </>
        )}
        {cliente && (
          <>
            <span style={{ color: 'var(--muted)' }}>/</span>
            <button
              onClick={() => setProgettoId(null)}
              style={{ background: 'transparent', border: 'none', color: progetto ? 'var(--indigo-l)' : 'var(--text)', fontWeight: 700, cursor: 'pointer', padding: 0, fontSize: 13 }}
            >
              {cliente.nome}
            </button>
          </>
        )}
        {progetto && (
          <>
            <span style={{ color: 'var(--muted)' }}>/</span>
            <span style={{ fontWeight: 700 }}>{progetto.nome}</span>
          </>
        )}
      </div>

      {errore && (
        <div style={{ padding: '1.25rem', borderRadius: 10, background: 'rgba(239,68,68,0.08)', border: '1px solid var(--pill-red-bd)', color: 'var(--pill-red-fg)', fontSize: 13, marginBottom: '1.25rem' }}>
          ⚠️ {errore}
          <div style={{ color: 'var(--muted)', marginTop: 6, fontSize: 12 }}>
            L'archivio si legge solo dal database: finché la lettura non riesce, questa pagina non mostra numeri.
          </div>
        </div>
      )}

      {totali && !progetto && (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(190px, 1fr))', gap: '1rem', marginBottom: '1.75rem' }}>
          <Riquadro etichetta="Documenti a database" valore={String(totali.documenti)} sfondo="var(--pill-slate-bg)" bordo="var(--pill-slate-bd)" colore="var(--muted)" />
          <Riquadro etichetta="Firmati dal cliente" valore={String(totali.firmati)} sfondo="var(--pill-green-bg)" bordo="var(--pill-green-bd)" colore="var(--pill-green-fg)" />
          <Riquadro etichetta="Pubblicati da firmare" valore={String(totali.daFirmare)} sfondo="var(--pill-amber-bg)" bordo="var(--pill-amber-bd)" colore="var(--pill-amber-fg)" />
          <Riquadro etichetta="Archiviati" valore={String(totali.archiviati)} sfondo="var(--pill-indigo-bg)" bordo="var(--indigo-d)" colore="var(--pill-indigo-fg)" />
        </div>
      )}

      {totali && totali.nonCollocati > 0 && !vistaNonCollocati && (
        <div style={{ padding: '10px 14px', borderRadius: 10, background: 'rgba(251,191,36,0.08)', border: '1px solid var(--pill-amber-bd)', color: 'var(--pill-amber-fg)', fontSize: 12.5, marginBottom: '1.25rem', display: 'flex', gap: 12, alignItems: 'center', flexWrap: 'wrap' }}>
          <span style={{ flex: 1, minWidth: 240 }}>
            🗂 {totali.nonCollocati} document{totali.nonCollocati === 1 ? 'o' : 'i'} non compare in nessuna cartella: il progetto a cui era
            agganciato è stato eliminato. Il file e le firme restano conservati a database.
          </span>
          {/* §40 — l'avviso ora porta al rimedio: prima si poteva solo leggerlo. */}
          <button
            onClick={() => {
              setVistaNonCollocati(true);
              setClienteId(null);
              setProgettoId(null);
            }}
            style={{ background: 'var(--amber)', border: 'none', color: '#fff', padding: '7px 13px', borderRadius: 7, cursor: 'pointer', fontSize: 12, fontWeight: 600, whiteSpace: 'nowrap' }}
          >
            Ricollocali →
          </button>
        </div>
      )}

      <div style={{ background: 'var(--card)', borderRadius: 12, padding: '1.5rem', border: '1px solid var(--border)' }}>
        {vistaNonCollocati ? (
          <div style={{ display: 'flex', gap: 16, marginBottom: '1.5rem', flexWrap: 'wrap', alignItems: 'center', justifyContent: 'space-between' }}>
            <div style={{ fontWeight: 700, fontSize: 14 }}>🗂 Documenti senza cartella</div>
            <button
              onClick={() => setVistaNonCollocati(false)}
              style={{ background: 'var(--card2)', border: '1px solid var(--border)', color: 'var(--text)', padding: '8px 14px', borderRadius: 8, cursor: 'pointer', fontSize: 12.5 }}
            >
              ← Torna alle cartelle
            </button>
          </div>
        ) : (
          <div style={{ display: 'flex', gap: 16, marginBottom: '1.5rem', flexWrap: 'wrap', alignItems: 'center' }}>
            <input
              type="text"
              placeholder={progetto ? 'Cerca un documento in questa cartella…' : 'Cerca un cliente o un progetto…'}
              value={ricerca}
              onChange={(e) => setRicerca(e.target.value)}
              style={{ padding: '8px 12px', borderRadius: 8, border: '1px solid var(--border)', background: 'var(--bg)', color: 'var(--text)', flex: 1, minWidth: 220 }}
            />
            {progetto ? (
              <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12.5, color: 'var(--muted)', cursor: 'pointer' }}>
                <input type="checkbox" checked={includiArchiviati} onChange={(e) => setIncludiArchiviati(e.target.checked)} />
                Mostra anche gli archiviati
              </label>
            ) : (
              <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12.5, color: 'var(--muted)', cursor: 'pointer' }}>
                <input type="checkbox" checked={nascondiVuote} onChange={(e) => setNascondiVuote(e.target.checked)} />
                Nascondi le cartelle senza documenti
              </label>
            )}
            {progetto && (
              <button
                onClick={() => navigate(`/projects/${progetto.id}`)}
                style={{ background: 'var(--indigo)', border: 'none', color: '#fff', padding: '8px 14px', borderRadius: 8, cursor: 'pointer', fontSize: 12.5, fontWeight: 600 }}
              >
                Scheda progetto ↗
              </button>
            )}
          </div>
        )}

        {caricamento ? (
          <div style={{ padding: '2rem', textAlign: 'center', color: 'var(--muted)' }}>Lettura dell'archivio documentale…</div>
        ) : vistaNonCollocati ? (
          <ElencoNonCollocati progetti={progettiScelta} onArchivioCambiato={() => setRicaricaArchivio((n) => n + 1)} />
        ) : progetto ? (
          <ElencoDocumentiCartella
            progettoId={progetto.id}
            nomeProgetto={progetto.nome}
            progetti={progettiScelta}
            includiArchiviati={includiArchiviati}
            ricerca={filtro}
            onApriProgetto={() => navigate(`/projects/${progetto.id}`)}
            onArchivioCambiato={() => setRicaricaArchivio((n) => n + 1)}
          />
        ) : cliente ? (
          progettiVisibili.length === 0 ? (
            <div style={{ padding: '2.5rem 1rem', textAlign: 'center', color: 'var(--muted)', fontSize: 13.5 }}>
              {cliente.progetti.length === 0
                ? 'Questo cliente non ha ancora progetti: le cartelle nascono con il progetto.'
                : 'Nessun progetto corrisponde ai filtri attivi.'}
            </div>
          ) : (
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(260px, 1fr))', gap: '1rem' }}>
              {progettiVisibili.map((p) => (
                <CartellaCard
                  key={p.id}
                  icona="📁"
                  titolo={p.nome}
                  sottotitolo={`${p.numeroContratto ? `${p.numeroContratto} · ` : ''}${STATO_PROGETTO[p.stato] ?? p.stato}`}
                  contatori={p}
                  onClick={() => setProgettoId(p.id)}
                />
              ))}
            </div>
          )
        ) : clientiVisibili.length === 0 ? (
          <div style={{ padding: '2.5rem 1rem', textAlign: 'center', color: 'var(--muted)', fontSize: 13.5 }}>
            {clienti.length === 0
              ? 'Nessun cliente in anagrafica: l’archivio si popola dai progetti dei clienti.'
              : 'Nessuna cartella corrisponde ai filtri attivi.'}
          </div>
        ) : (
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(260px, 1fr))', gap: '1rem' }}>
            {clientiVisibili.map((c) => (
              <CartellaCard
                key={c.id}
                icona={c.tipo === 'company' ? '🏢' : '👤'}
                titolo={c.nome}
                sottotitolo={`${c.progetti.length} progett${c.progetti.length === 1 ? 'o' : 'i'}`}
                contatori={c}
                onClick={() => {
                  setClienteId(c.id);
                  setProgettoId(null);
                  setRicerca('');
                }}
              />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
