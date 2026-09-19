// §41 — Cartella dei modelli dello studio.
//
// È il posto dove si vede, tutto insieme, che carte ha lo studio: come sono intitolate, in che
// categoria stanno, se qualcuno le ha rilette e quali sono state messe da parte. Document Studio
// pesca da qui — la stessa `GET /documenti-template`, lo stesso elenco — così non esistono due
// librerie diverse a seconda di dove si guarda.
//
// Com'era prima di §41. L'elenco dei modelli si costruiva da tre chiavi di `localStorage`: un
// modello creato dal titolare non si vedeva sugli altri computer, archiviare valeva per un solo
// browser e svuotare la cache faceva sparire la libreria. Adesso la fonte è il database e questa
// pagina non tiene stato proprio: legge dalla cartella (`useCartellaTemplate`) e scrive con essa.
//
// Regola 7 applicata alla lettera in due punti:
//  • se la lettura dal server non riesce, si dice che l'elenco può essere incompleto — non si
//    mostra la sola dotazione di serie facendola passare per la libreria dello studio;
//  • un modello di serie che nessuno ha adottato non ha stato di revisione, e il badge scrive
//    «di serie · mai revisionato qui» invece di inventargli una bozza.

import { useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useCartellaTemplate } from '../hooks/useCartellaTemplate';
import { exportTemplatesAsJson, type DocumentTemplate } from '../utils/documentTemplates';
import { SchedaModello } from '../components/documenti/SchedaModello';
import { ModaleRevisioneModello } from '../components/documenti/ModaleRevisioneModello';

type FiltroStato = 'tutti' | 'approvato' | 'in_revisione' | 'bozza' | 'serie';

const ETICHETTA_CATEGORIA: Record<string, string> = {
  contratto: 'Contratti',
  nda: 'Riservatezza & NDA',
  engagement: 'Lettere d\'incarico',
  societario: 'Societario',
  delega: 'Deleghe & Procure',
  fiscale: 'Fiscale',
  trust: 'Trust & Patrimoni',
  compliance: 'Compliance & KYC',
};

function Riquadro({ etichetta, valore, sfondo, bordo, colore }: { etichetta: string; valore: string; sfondo: string; bordo: string; colore: string }) {
  return (
    <div style={{ background: sfondo, padding: 14, borderRadius: 12, border: `1px solid ${bordo}` }}>
      <div style={{ fontSize: 11, color: colore, textTransform: 'uppercase', fontWeight: 600, letterSpacing: 0.3 }}>{etichetta}</div>
      <div style={{ fontSize: 21, fontWeight: 700, color: '#fff', marginTop: 5 }}>{valore}</div>
    </div>
  );
}

const bottoneTesta: React.CSSProperties = {
  border: '1px solid var(--border)',
  background: 'var(--card2)',
  color: 'var(--text)',
  padding: '8px 13px',
  borderRadius: 9,
  fontSize: 12,
  fontWeight: 600,
  cursor: 'pointer',
};

export function CartellaModelliPage() {
  const navigate = useNavigate();
  const cartella = useCartellaTemplate();
  const fileRef = useRef<HTMLInputElement>(null);

  const [ricerca, setRicerca] = useState('');
  const [categoria, setCategoria] = useState('TUTTE');
  const [filtroStato, setFiltroStato] = useState<FiltroStato>('tutti');
  const [mostraArchiviati, setMostraArchiviati] = useState(false);
  const [inRevisione, setInRevisione] = useState<DocumentTemplate | null>(null);
  const [occupato, setOccupato] = useState<string | null>(null);
  const [messaggio, setMessaggio] = useState<{ ok: boolean; testo: string } | null>(null);

  const residuiLocali = useMemo(() => cartella.modelli.filter((m) => m.soloLocale), [cartella.modelli]);

  const conteggi = useMemo(() => {
    const attivi = cartella.modelli.filter((m) => !m.archiviato);
    return {
      attivi: attivi.length,
      approvati: attivi.filter((m) => m.statoRevisione === 'approvato').length,
      inRevisione: attivi.filter((m) => m.statoRevisione === 'in_revisione').length,
      bozze: attivi.filter((m) => m.statoRevisione === 'bozza').length,
      diSerie: attivi.filter((m) => m.diSerie).length,
      archiviati: cartella.modelli.filter((m) => m.archiviato).length,
    };
  }, [cartella.modelli]);

  const categorie = useMemo(() => {
    const presenti = new Set(cartella.modelli.map((m) => m.categoria));
    return ['TUTTE', ...Array.from(presenti).sort()];
  }, [cartella.modelli]);

  const visibili = useMemo(() => {
    const q = ricerca.trim().toLowerCase();
    return cartella.modelli.filter((m) => {
      if (Boolean(m.archiviato) !== mostraArchiviati) return false;
      if (categoria !== 'TUTTE' && m.categoria !== categoria) return false;
      if (filtroStato === 'serie' && !m.diSerie) return false;
      if (filtroStato !== 'tutti' && filtroStato !== 'serie' && (m.diSerie || m.statoRevisione !== filtroStato)) return false;
      if (!q) return true;
      return (
        m.titolo.toLowerCase().includes(q) ||
        (m.descrizione || '').toLowerCase().includes(q) ||
        (m.noteRevisione || '').toLowerCase().includes(q)
      );
    });
  }, [cartella.modelli, ricerca, categoria, filtroStato, mostraArchiviati]);

  const perCategoria = useMemo(() => {
    const gruppi = new Map<string, DocumentTemplate[]>();
    for (const m of visibili) {
      const chiave = m.categoria || 'societario';
      const elenco = gruppi.get(chiave);
      if (elenco) elenco.push(m);
      else gruppi.set(chiave, [m]);
    }
    return Array.from(gruppi.entries()).sort(([a], [b]) => a.localeCompare(b));
  }, [visibili]);

  /** Esegue un gesto sulla cartella tenendo il modello «occupato» finché il server non risponde. */
  const esegui = async (id: string, azione: () => Promise<{ ok: boolean; messaggio: string }>) => {
    setOccupato(id);
    const esito = await azione();
    setOccupato(null);
    setMessaggio({ ok: esito.ok, testo: esito.messaggio });
  };

  const nuovoModello = async () => {
    const titolo = window.prompt('Titolo del nuovo modello dello studio:');
    if (!titolo || !titolo.trim()) return;
    setOccupato('nuovo');
    const esito = await cartella.crea({
      titolo: titolo.trim(),
      categoria: categoria !== 'TUTTE' ? categoria : 'societario',
      descrizione: 'Modello dello studio da completare in Document Studio.',
      contenutoHtml: `<h1 style="text-align:center;font-size:18px;">${titolo.trim().toUpperCase()}</h1>\n<p style="font-size:11.5px;line-height:1.6;">Testo del modello. I segnaposto disponibili sono, fra gli altri, {{cliente.ragione_sociale}}, {{progetto.titolo}}, {{studio.ragione_sociale}} e {{data_odierna}}.</p>`,
    });
    setOccupato(null);
    setMessaggio({ ok: esito.ok, testo: esito.messaggio });
    // Un modello appena creato è vuoto: si apre subito dove si scrive.
    if (esito.ok && esito.modello) navigate(`/documents?tmplId=${esito.modello.id}`);
  };

  const esporta = () => {
    const contenuto = exportTemplatesAsJson();
    const blob = new Blob([contenuto], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `modelli-studio-${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    URL.revokeObjectURL(url);
    setMessaggio({
      ok: true,
      testo: cartella.erroreLettura
        ? 'File scaricato, ma attenzione: la lettura dal server non è riuscita, quindi contiene solo quello che c\'è in elenco adesso.'
        : `File scaricato con ${cartella.modelli.length} modelli (archiviati compresi).`,
    });
  };

  const importa = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const lettore = new FileReader();
    lettore.onload = async (ev) => {
      const testo = (ev.target?.result as string) || '';
      setOccupato('import');
      const esito = await cartella.importaDaJson(testo);
      setOccupato(null);
      setMessaggio({ ok: esito.ok, testo: esito.messaggio });
    };
    lettore.readAsText(file);
    e.target.value = '';
  };

  /**
   * Registra la revisione. Se il modello è di serie va prima adottato: la decisione ha bisogno
   * di una riga dello studio su cui stare, altrimenti si scriverebbe su una carta di tutti.
   */
  const salvaRevisione = async (stato: 'bozza' | 'in_revisione' | 'approvato', note: string) => {
    const modello = inRevisione;
    if (!modello) return { ok: false, messaggio: 'Nessun modello selezionato.' };
    let id = modello.id;
    if (modello.diSerie) {
      const adozione = await cartella.adotta(modello);
      if (!adozione.ok || !adozione.modello) return adozione;
      id = adozione.modello.id;
    }
    const esito = await cartella.revisiona(id, stato, note || undefined);
    if (esito.ok) setMessaggio({ ok: true, testo: esito.messaggio });
    return esito;
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 18 }}>
      {/* Testa: cosa è questa cartella e cosa si può fare */}
      <div style={{ background: 'var(--card)', border: '1px solid var(--border)', borderRadius: 16, padding: 18, display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 14, flexWrap: 'wrap' }}>
        <div style={{ minWidth: 260 }}>
          <h2 style={{ margin: 0, fontSize: 19 }}>🗂 Cartella Modelli dello Studio</h2>
          <p style={{ margin: '6px 0 0 0', fontSize: 12.5, color: 'var(--muted)', lineHeight: 1.6, maxWidth: 640 }}>
            Le carte a cui lo studio fa riferimento, con lo stato di revisione di ciascuna. Document
            Studio pesca da qui: è lo stesso elenco, letto dall'archivio dello studio e non da questo
            browser, quindi quello che si vede è quello che vedono i colleghi.
          </p>
        </div>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          <button type="button" onClick={() => void cartella.sincronizza()} disabled={cartella.caricamento} style={bottoneTesta}>
            {cartella.caricamento ? '⏳ Lettura…' : '🔄 Ricarica'}
          </button>
          <button type="button" onClick={esporta} style={bottoneTesta} title="Scarica tutti i modelli in un file JSON">
            ⬇ Esporta JSON
          </button>
          <input ref={fileRef} type="file" accept=".json" style={{ display: 'none' }} onChange={importa} />
          <button type="button" onClick={() => fileRef.current?.click()} disabled={occupato === 'import'} style={bottoneTesta}>
            {occupato === 'import' ? '⏳ Importazione…' : '⬆ Importa JSON'}
          </button>
          <button
            type="button"
            onClick={nuovoModello}
            disabled={occupato === 'nuovo'}
            style={{ ...bottoneTesta, background: 'var(--indigo)', border: 'none', color: '#fff' }}
          >
            {occupato === 'nuovo' ? '⏳ Creazione…' : '➕ Nuovo modello'}
          </button>
        </div>
      </div>

      {/* §41 — regola 7: se il server non ha risposto, l'elenco può essere incompleto e si dice. */}
      {cartella.erroreLettura && (
        <div style={{ background: 'var(--pill-red-bg)', border: '1px solid var(--pill-red-bg)', borderRadius: 12, padding: '12px 14px', fontSize: 12.5, color: 'var(--pill-red-fg)', lineHeight: 1.6 }}>
          ⚠️ <strong>Elenco possibilmente incompleto.</strong> La lettura dei modelli dello studio non è
          riuscita ({cartella.erroreLettura}). Quello che si vede sotto potrebbe non essere tutto quello
          che lo studio ha: prima di dire che un modello «non c'è», premere <strong>Ricarica</strong>.
        </div>
      )}

      {/* Modelli rimasti nel solo browser: si portano a database, non si cancellano in silenzio. */}
      {residuiLocali.length > 0 && (
        <div style={{ background: 'var(--pill-amber-bg)', border: '1px solid var(--pill-amber-bd)', borderRadius: 12, padding: '12px 14px', display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
          <div style={{ fontSize: 12.5, color: 'var(--pill-amber-fg)', lineHeight: 1.6, maxWidth: 660 }}>
            📌 <strong>{residuiLocali.length} modelli sono rimasti soltanto in questo browser.</strong> Erano
            stati importati quando la libreria non passava dal server: non hanno una riga nell'archivio
            dello studio, quindi nessun collega li vede. Portandoli nell'archivio diventano modelli
            dello studio; il residuo locale si scarta solo dopo la conferma del server.
          </div>
          <button
            type="button"
            onClick={() => void esegui('recupero', cartella.recuperaModelliLocali)}
            disabled={occupato === 'recupero'}
            style={{ ...bottoneTesta, background: 'var(--pill-amber-bg)', border: '1px solid var(--pill-amber-bd)', color: 'var(--pill-amber-fg)' }}
          >
            {occupato === 'recupero' ? '⏳ In corso…' : '⬆ Porta nell\'archivio dello studio'}
          </button>
        </div>
      )}

      {messaggio && (
        <div
          style={{
            background: messaggio.ok ? 'var(--pill-green-bg)' : 'var(--pill-red-bg)',
            border: `1px solid ${messaggio.ok ? 'var(--pill-green-bg)' : 'var(--pill-red-bg)'}`,
            color: messaggio.ok ? 'var(--pill-green-fg)' : 'var(--pill-red-fg)',
            borderRadius: 12,
            padding: '10px 14px',
            fontSize: 12.5,
            lineHeight: 1.6,
            display: 'flex',
            justifyContent: 'space-between',
            gap: 12,
          }}
        >
          <span>{messaggio.ok ? '✓' : '⚠️'} {messaggio.testo}</span>
          <button type="button" onClick={() => setMessaggio(null)} style={{ background: 'transparent', border: 'none', color: 'inherit', cursor: 'pointer', fontSize: 14 }}>
            ✕
          </button>
        </div>
      )}

      {/* Riquadri di sintesi: contano righe, non stime */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: 12 }}>
        <Riquadro etichetta="Modelli attivi" valore={String(conteggi.attivi)} sfondo="var(--surface-1)" bordo="var(--card2)" colore="var(--pill-indigo-fg)" />
        <Riquadro etichetta="Approvati" valore={String(conteggi.approvati)} sfondo="var(--pill-green-bg)" bordo="var(--pill-green-bg)" colore="var(--pill-green-fg)" />
        <Riquadro etichetta="In revisione" valore={String(conteggi.inRevisione)} sfondo="var(--pill-amber-bg)" bordo="var(--pill-amber-bd)" colore="var(--pill-amber-fg)" />
        <Riquadro etichetta="Bozze" valore={String(conteggi.bozze)} sfondo="var(--card)" bordo="var(--pill-slate-bd)" colore="var(--muted)" />
        <Riquadro etichetta="Di serie, mai adottati" valore={String(conteggi.diSerie)} sfondo="var(--surface-1)" bordo="var(--pill-blue-bg)" colore="var(--cat-societario)" />
        <Riquadro etichetta="Archiviati" valore={String(conteggi.archiviati)} sfondo="var(--pill-slate-bg)" bordo="var(--border)" colore="var(--muted)" />
      </div>

      {/* Filtri */}
      <div style={{ background: 'var(--card)', border: '1px solid var(--border)', borderRadius: 14, padding: 14, display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'center' }}>
        <input
          value={ricerca}
          onChange={(e) => setRicerca(e.target.value)}
          placeholder="🔍 Cerca per titolo, descrizione o nota di revisione…"
          style={{ flex: '1 1 240px', minWidth: 200, fontSize: 12 }}
        />
        <select value={categoria} onChange={(e) => setCategoria(e.target.value)} style={{ fontSize: 12, padding: '7px 9px' }}>
          {categorie.map((c) => (
            <option key={c} value={c}>{c === 'TUTTE' ? 'Tutte le categorie' : (ETICHETTA_CATEGORIA[c] || c)}</option>
          ))}
        </select>
        <select value={filtroStato} onChange={(e) => setFiltroStato(e.target.value as FiltroStato)} style={{ fontSize: 12, padding: '7px 9px' }}>
          <option value="tutti">Qualunque stato di revisione</option>
          <option value="approvato">Solo approvati</option>
          <option value="in_revisione">Solo in revisione</option>
          <option value="bozza">Solo bozze</option>
          <option value="serie">Solo di serie (mai adottati)</option>
        </select>
        <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, color: 'var(--muted)', cursor: 'pointer' }}>
          <input type="checkbox" checked={mostraArchiviati} onChange={(e) => setMostraArchiviati(e.target.checked)} />
          Mostra gli archiviati ({conteggi.archiviati})
        </label>
      </div>

      {/* Elenco raggruppato per categoria */}
      {cartella.caricamento && cartella.modelli.length === 0 ? (
        <div style={{ padding: 40, textAlign: 'center', color: 'var(--muted)', fontSize: 13 }}>⏳ Lettura dei modelli dello studio…</div>
      ) : perCategoria.length === 0 ? (
        <div style={{ background: 'var(--card)', border: '1px solid var(--border)', borderRadius: 14, padding: 40, textAlign: 'center', color: 'var(--muted)', fontSize: 13, lineHeight: 1.6 }}>
          {mostraArchiviati
            ? 'Nessun modello archiviato con questi filtri.'
            : cartella.letto
              ? 'Nessun modello corrisponde ai filtri impostati.'
              : 'Elenco non ancora letto dall\'archivio dello studio.'}
        </div>
      ) : (
        perCategoria.map(([cat, elenco]) => (
          <div key={cat} style={{ background: 'var(--card)', border: '1px solid var(--border)', borderRadius: 14, padding: 16 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12, gap: 10 }}>
              <div style={{ fontSize: 13.5, fontWeight: 700 }}>
                📁 {ETICHETTA_CATEGORIA[cat] || cat}
              </div>
              <div style={{ fontSize: 11.5, color: 'var(--muted)' }}>{elenco.length} {elenco.length === 1 ? 'modello' : 'modelli'}</div>
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(300px, 1fr))', gap: 12 }}>
              {elenco.map((m) => (
                <SchedaModello
                  key={m.id || m.titolo}
                  modello={m}
                  occupato={occupato === (m.id || m.titolo)}
                  onApri={() => navigate(m.id ? `/documents?tmplId=${m.id}` : '/documents')}
                  onRevisiona={() => setInRevisione(m)}
                  onArchivia={(archiviato) => void esegui(m.id || m.titolo, () => cartella.archivia(m, archiviato))}
                  onElimina={() => {
                    if (!window.confirm(`Eliminare il modello «${m.titolo}»?\n\nI documenti già generati nei progetti restano invariati.`)) return;
                    void esegui(m.id || m.titolo, () => cartella.elimina(m));
                  }}
                />
              ))}
            </div>
          </div>
        ))
      )}

      {inRevisione && (
        <ModaleRevisioneModello
          modello={inRevisione}
          onSalva={salvaRevisione}
          onChiudi={() => setInRevisione(null)}
        />
      )}
    </div>
  );
}
