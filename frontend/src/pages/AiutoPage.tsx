// ❓ Aiuto — il manuale dentro l'app.
//
// Le schede **non** sono scritte qui: sono i file di `docs/manuale/`, letti dal backend a runtime
// (§ «Help in-app» in quel README). Questa pagina fa tre cose e nient'altro: mostra l'indice,
// cerca nel testo, e rende la scheda che il server ha già sanitizzato.
//
// Due cose che non sono ovvie leggendo il codice:
//
// - **`dangerouslySetInnerHTML` è il posto giusto qui, ed è l'unico di questa pagina.** L'HTML
//   arriva dal backend dopo `sanitizzaHtmlDocumento`, e il confine della fiducia sta là: nel bundle
//   del browser il sanitizzatore non esiste e non deve esistere. Questa pagina non tocca l'HTML, lo
//   consegna. (I file che possono usare quel sink sono un elenco chiuso, presidiato da
//   `src/p0HtmlUploadPolicy.test.ts`.)
// - **`letto: false` non è un indice vuoto.** Se il backend non risponde, la pagina lo dice. Un
//   indice vuoto sarebbe «non c'è aiuto», che è l'opposto di «non ho potuto leggere» — e chi legge
//   non andrebbe a cercare il guasto (§7).
//
// La leggibilità è parte del compito, non una rifinitura: le schede sono scritte per essere lette
// da una persona, e una pagina che le mostra a 120 caratteri per riga con i titoli appiccicati al
// paragrafo successivo le fa sembrare quello che non sono. La misura del testo, l'aria fra le
// sezioni e le tabelle stanno in `AiutoPage.module.css`, e sono lì per questo.

import { useEffect, useMemo, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import {
  fetchIndiceManualeApi,
  fetchSchedaManualeApi,
  type IndiceManualeApi,
  type SchedaApertaApi,
  type SchedaManualeApi,
} from '../api/client';
import styles from './AiutoPage.module.css';

/**
 * Il confronto della ricerca: senza maiuscole e **senza accenti**.
 *
 * In italiano non è un lusso: chi cerca «perche» o «attivita» sta scrivendo la parola giusta senza
 * l'accento, e un motore che risponde «nessun risultato» a una parola che c'è si fa considerare
 * rotto. Il testo mostrato resta quello vero — si normalizza solo per confrontare.
 */
function normalizza(testo: string): string {
  return testo.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
}

/**
 * Il rigo da mostrare come estratto, ritagliato intorno alla parola trovata.
 *
 * La posizione è quella nella stringa **normalizzata**, che con gli accenti può essere lunga
 * qualche carattere in più dell'originale: la finestra può quindi risultare spostata di poco. È
 * accettabile — serve a far vedere *dove* sta la parola, non a ritagliarla al pixel.
 */
function estratto(riga: string, posizione: number, larghezza = 96): string {
  const testo = riga.trim();
  if (testo.length <= larghezza * 1.5) return testo;
  const inizio = Math.max(0, Math.min(posizione - Math.floor(larghezza / 2), testo.length - larghezza));
  const coda = inizio + larghezza < testo.length ? '…' : '';
  return `${inizio > 0 ? '…' : ''}${testo.slice(inizio, inizio + larghezza).trim()}${coda}`;
}

/** Il primo rigo della scheda che contiene la ricerca, o `null` se non c'è. */
function rigaTrovata(scheda: SchedaManualeApi, cercato: string): string | null {
  // Il titolo si prova per primo: chi cerca «scadenzario» vuole la scheda dello scadenzario, non
  // il primo rigo in cui la parola compare di sfuggita.
  if (normalizza(scheda.titolo).includes(cercato)) return scheda.titolo;
  for (const riga of scheda.testo.split('\n')) {
    const posizione = normalizza(riga).indexOf(cercato);
    if (posizione >= 0) return estratto(riga, posizione);
  }
  return null;
}

export function AiutoPage() {
  const { slug } = useParams<{ slug?: string }>();
  const navigate = useNavigate();

  // `null` = sto leggendo. Non è la stessa cosa di «letto ma vuoto», ed è la distinzione su cui
  // poggia tutto il resto della pagina.
  const [indice, setIndice] = useState<IndiceManualeApi | null>(null);
  const [scheda, setScheda] = useState<SchedaApertaApi | null>(null);
  const [cerca, setCerca] = useState('');
  const [indiceVisibile, setIndiceVisibile] = useState(false);

  useEffect(() => {
    let annullato = false;
    fetchIndiceManualeApi().then(esito => { if (!annullato) setIndice(esito); });
    return () => { annullato = true; };
  }, []);

  useEffect(() => {
    if (!slug) { setScheda(null); return; }
    let annullato = false;
    setScheda(null);
    fetchSchedaManualeApi(slug).then(esito => { if (!annullato) setScheda(esito); });
    return () => { annullato = true; };
  }, [slug]);

  // `/aiuto` senza scheda apre la prima: l'indice da solo è una schermata vuota a destra, e la
  // prima scheda è quello che si vuole leggere quando non si sa da dove cominciare. `replace`
  // perché entrare in «Aiuto» e finire su `01-…` non deve lasciare due voci nella cronologia.
  useEffect(() => {
    if (slug || !indice?.letto) return;
    const prima = indice.schede[0];
    if (prima) navigate(`/aiuto/${prima.slug}`, { replace: true });
  }, [slug, indice, navigate]);

  /** I risultati della ricerca, o `null` quando non si sta cercando. */
  const risultati = useMemo(() => {
    const cercato = normalizza(cerca.trim());
    if (!cercato || !indice) return null;
    return indice.schede
      .map(s => ({ scheda: s, riga: rigaTrovata(s, cercato) }))
      .filter((r): r is { scheda: SchedaManualeApi; riga: string } => r.riga !== null);
  }, [cerca, indice]);

  const apri = (slugScheda: string) => {
    setIndiceVisibile(false);
    navigate(`/aiuto/${slugScheda}`);
  };

  if (!indice) {
    return <div className={styles.attesa}>Carico il manuale…</div>;
  }

  if (!indice.letto) {
    // §7 — il manuale non c'è **in questa installazione**, e va detto così. Un indice vuoto
    // direbbe «non c'è niente da leggere», che è una conclusione diversa e sbagliata.
    return (
      <div className={styles.avviso}>
        <div className={styles.avvisoTitolo}>Il manuale non è disponibile in questa installazione</div>
        <p>
          Le schede non sono state lette dal server. Non è che non ce ne siano: è che non si sono
          potute leggere. Se il problema resta, i file delle schede mancano dal backend.
        </p>
      </div>
    );
  }

  const schedaCorrente = indice.schede.find(s => s.slug === slug);

  return (
    <div className={`${styles.pagina} ${indiceVisibile ? styles.indiceAperto : ''}`}>
      <aside className={styles.colonnaIndice}>
        <div className={styles.intestazioneIndice}>
          <h2 className={styles.titoloIndice}>Manuale</h2>
          <button
            type="button"
            className={styles.pulsanteIndice}
            aria-expanded={indiceVisibile}
            onClick={() => setIndiceVisibile(v => !v)}
          >
            {indiceVisibile ? '✕ Chiudi' : '☰ Schede'}
          </button>
        </div>

        <input
          type="search"
          className={styles.campoRicerca}
          placeholder="Cerca nel manuale…"
          value={cerca}
          onChange={e => setCerca(e.target.value)}
          aria-label="Cerca nel manuale"
        />

        {risultati ? (
          // Durante la ricerca l'elenco **è** il risultato: non si filtra l'indice lasciando le
          // voci senza riscontro, perché il rigo trovato è la cosa che dice se è quello che si
          // cercava.
          <nav className={styles.elencoSchede} aria-label="Risultati della ricerca">
            <div className={styles.conteggio}>
              {risultati.length === 0
                ? `Nessuna scheda contiene «${cerca.trim()}».`
                : `${risultati.length} ${risultati.length === 1 ? 'scheda' : 'schede'} per «${cerca.trim()}»`}
            </div>
            {risultati.map(({ scheda: s, riga }) => (
              <button
                key={s.slug}
                type="button"
                className={`${styles.voce} ${s.slug === slug ? styles.voceAttiva : ''}`}
                onClick={() => apri(s.slug)}
              >
                <span className={styles.voceTitolo}>
                  <span className={styles.numero}>{s.numero}</span> {s.titolo}
                  {s.riservata && <span className={styles.lucchetto} title="Riservata all'amministratore della piattaforma">🔒</span>}
                </span>
                <span className={styles.estratto}>{riga}</span>
              </button>
            ))}
          </nav>
        ) : (
          <nav className={styles.elencoSchede} aria-label="Schede del manuale">
            {indice.schede.map(s => (
              <button
                key={s.slug}
                type="button"
                className={`${styles.voce} ${s.slug === slug ? styles.voceAttiva : ''}`}
                onClick={() => apri(s.slug)}
                aria-current={s.slug === slug ? 'page' : undefined}
              >
                <span className={styles.voceTitolo}>
                  <span className={styles.numero}>{s.numero}</span> {s.titolo}
                  {s.riservata && <span className={styles.lucchetto} title="Riservata all'amministratore della piattaforma">🔒</span>}
                </span>
              </button>
            ))}
          </nav>
        )}
      </aside>

      <main className={styles.colonnaScheda}>
        {scheda === null && (
          <div className={styles.attesa}>
            {schedaCorrente ? `Apro «${schedaCorrente.titolo}»…` : 'Apro la scheda…'}
          </div>
        )}

        {scheda && !scheda.letto && (
          <div className={styles.avviso}>
            <div className={styles.avvisoTitolo}>Questa scheda non si può leggere</div>
            {/* Le parole sono del server: un 403 e un 404 sono due cose diverse, e il server le sa
                distinguere meglio di qui. Ricostruirle in pagina sarebbe indovinare. */}
            <p>{scheda.errore}</p>
          </div>
        )}

        {scheda?.letto && (
          <>
            {scheda.riservata && (
              <div className={styles.notaRiservata}>
                🔒 Questa scheda è riservata all’amministratore della piattaforma.
              </div>
            )}
            {/* L'HTML è sanitizzato dal server: qui non si tocca, si consegna. Vedi l'intestazione. */}
            <article className={styles.testo} dangerouslySetInnerHTML={{ __html: scheda.html }} />
          </>
        )}
      </main>
    </div>
  );
}
