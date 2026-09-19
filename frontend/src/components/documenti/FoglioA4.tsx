/**
 * §39 — Il foglio A4 dell'editor: la stessa geometria con cui si stampa, visibile mentre si scrive.
 *
 * Com'era: il canvas di Document Studio disegnava un foglio largo `780px` alto `1050px` con margini
 * `50px 60px`. Nessuno dei tre numeri discendeva dall'A4 che poi si stampava (794 × 1123 px con
 * margini da 76 px): l'area di scrittura era 660 px contro i 642 px stampabili, quindi una riga che
 * nell'editor stava dentro il foglio, nel PDF sporgeva. Da qui «alcuni arrivano fino alla fine del
 * foglio» anche dopo aver corretto l'impaginatore (§38).
 *
 * Com'è: le misure arrivano da `src/util/paginaA4.ts`, le stesse che usa il PDF, e i margini si
 * VEDONO — due guide verticali e una orizzontale, più una linea rossa dove l'impaginatore chiuderà
 * il foglio. Il foglio è un nastro continuo e non una pila di pagine separate: spezzare davvero un
 * `contentEditable` in pagine è il lavoro dell'impaginatore, che vive al momento dell'esportazione;
 * qui si mostra dove taglierà, e la linea dice «indicativo» perché l'impaginatore chiude
 * sull'ultimo blocco intero, quindi lì o poco prima.
 *
 * Intestazione e piè di pagina stanno dentro il foglio, bloccati: si sbloccano con un doppio clic e
 * si ribloccano al clic fuori o con Esc. Quello che si modifica viene restituito al chiamante, che
 * ha il compito di salvarlo (regola 3): un blocco modificato che vive solo nel DOM non è salvato.
 */
import React, { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { A4_PX, altezzaUtile } from '../../../../src/util/paginaA4';

/** Un blocco che si vede sempre, si modifica solo dopo un doppio clic, e va salvato da chi lo passa. */
export interface BloccoBloccabile {
  /** L'HTML mostrato. Cambiandolo dall'esterno il blocco si aggiorna, se non è in modifica. */
  html: string;
  /**
   * Chiamata al riblocco con l'HTML nuovo, solo se è cambiato: chi la riceve deve salvarlo.
   *
   * Senza questa funzione il blocco non si sblocca affatto: è il caso delle anteprime, dove non
   * esiste un posto in cui salvare la modifica. Un doppio clic che lascia scrivere e poi butta via
   * quello che si è scritto è la bugia che la regola 7 vieta.
   */
  onModifica?: (html: string) => void;
  /** Come si chiama il blocco nell'avviso: «Intestazione dello studio», «Piè di pagina». */
  etichetta: string;
}

function BloccoSbloccabile({ blocco, avvisoSotto }: { blocco: BloccoBloccabile; avvisoSotto: boolean }) {
  const rif = useRef<HTMLDivElement | null>(null);
  const [aperto, setAperto] = useState(false);
  const [sopra, setSopra] = useState(false);
  const modificabile = typeof blocco.onModifica === 'function';

  // Mentre è in modifica l'HTML non viene riscritto: riscriverlo a ogni tasto sposterebbe il cursore.
  useEffect(() => {
    if (!aperto && rif.current && rif.current.innerHTML !== blocco.html) {
      rif.current.innerHTML = blocco.html;
    }
  }, [blocco.html, aperto]);

  const riblocca = () => {
    if (!aperto) return;
    setAperto(false);
    const html = rif.current?.innerHTML ?? '';
    if (html !== blocco.html) blocco.onModifica?.(html);
  };

  return (
    <div
      style={{ position: 'relative' }}
      onMouseEnter={() => setSopra(modificabile)}
      onMouseLeave={() => setSopra(false)}
    >
      <div
        ref={rif}
        contentEditable={aperto}
        suppressContentEditableWarning
        onDoubleClick={() => { if (modificabile) setAperto(true); }}
        onBlur={riblocca}
        onKeyDown={(e) => { if (e.key === 'Escape') { e.preventDefault(); riblocca(); } }}
        title={!modificabile ? blocco.etichetta : aperto ? `${blocco.etichetta}: modifica in corso` : `${blocco.etichetta}: doppio clic per modificare`}
        style={{
          outline: aperto ? '2px dashed var(--indigo-d)' : sopra ? '1px dashed var(--muted)' : '1px dashed transparent',
          outlineOffset: 4,
          borderRadius: 4,
          background: aperto ? 'rgba(67, 56, 202, 0.045)' : 'transparent',
          cursor: aperto ? 'text' : 'default',
        }}
      />
      {(sopra || aperto) && (
        <div
          style={{
            position: 'absolute',
            right: 0,
            ...(avvisoSotto ? { bottom: -17 } : { top: -17 }),
            fontSize: 8.5,
            fontWeight: 700,
            letterSpacing: 0.2,
            color: aperto ? 'var(--indigo-d)' : 'var(--muted)',
            whiteSpace: 'nowrap',
            pointerEvents: 'none',
          }}
        >
          {aperto
            ? `✏️ ${blocco.etichetta} sbloccata — clic fuori o Esc per bloccare`
            : `🔒 ${blocco.etichetta} — doppio clic per modificare`}
        </div>
      )}
    </div>
  );
}

export interface ProprietaFoglioA4 {
  /** Il corpo del documento: l'area editabile, o l'HTML di un'anteprima. */
  children: React.ReactNode;
  intestazione?: BloccoBloccabile;
  piede?: BloccoBloccabile;
  /** Il colore della scrivania attorno al foglio. */
  sfondo?: string;
}

/**
 * Il foglio, con i margini disegnati e il punto in cui l'impaginatore chiuderà la pagina.
 *
 * Il foglio è sempre largo `A4_PX.larghezza`: è quella larghezza che decide dove va a capo una riga,
 * e deve essere identica a quella della stampa. Per stare in una colonna più stretta si riduce con
 * una `scale`, che non cambia dove vanno a capo le righe — restringere il foglio, invece, sì.
 */
export function FoglioA4({ children, intestazione, piede, sfondo = 'var(--pill-slate-bd)' }: ProprietaFoglioA4) {
  const contenitore = useRef<HTMLDivElement | null>(null);
  const flusso = useRef<HTMLDivElement | null>(null);
  const zonaPiede = useRef<HTMLDivElement | null>(null);
  const [scala, setScala] = useState(1);
  const [altezzaFlusso, setAltezzaFlusso] = useState(0);
  const [altezzaPiede, setAltezzaPiede] = useState(0);

  useLayoutEffect(() => {
    const el = contenitore.current;
    if (!el) return;
    const misura = () => {
      const disponibile = el.clientWidth - 2;
      setScala((precedente) => {
        const nuova = Math.min(1, Math.max(0.35, disponibile / A4_PX.larghezza));
        return Math.abs(nuova - precedente) < 0.002 ? precedente : nuova;
      });
    };
    misura();
    const osservatore = new ResizeObserver(misura);
    osservatore.observe(el);
    return () => osservatore.disconnect();
  }, []);

  // Le altezze si osservano invece di calcolarle: il testo che si scrive cambia l'altezza del
  // flusso, e la riga rossa deve spostarsi mentre si scrive, non al prossimo salvataggio.
  useLayoutEffect(() => {
    const misura = () => {
      const alto = flusso.current?.offsetHeight ?? 0;
      const altoPiede = zonaPiede.current?.offsetHeight ?? 0;
      setAltezzaFlusso((precedente) => (precedente === alto ? precedente : alto));
      setAltezzaPiede((precedente) => (precedente === altoPiede ? precedente : altoPiede));
    };
    misura();
    const osservatore = new ResizeObserver(misura);
    if (flusso.current) osservatore.observe(flusso.current);
    if (zonaPiede.current) osservatore.observe(zonaPiede.current);
    return () => osservatore.disconnect();
  }, []);

  const budget = Math.max(1, altezzaUtile(altezzaPiede));
  const pagine = Math.max(1, Math.ceil(altezzaFlusso / budget));
  const altezzaFoglio = Math.max(A4_PX.altezza, A4_PX.margine * 2 + pagine * budget + altezzaPiede);
  const guidaMargine = '1px dashed rgba(148, 163, 184, 0.85)';

  return (
    <div
      ref={contenitore}
      style={{
        background: sfondo,
        padding: '26px 16px',
        borderRadius: 14,
        boxShadow: 'inset 0 2px 10px rgba(0,0,0,0.3)',
        overflow: 'hidden',
      }}
    >
      <div style={{ position: 'relative', height: altezzaFoglio * scala }}>
        <div
          data-theme="light"
          style={{
            position: 'absolute',
            top: 0,
            left: '50%',
            width: A4_PX.larghezza,
            height: altezzaFoglio,
            transform: `translateX(-50%) scale(${scala})`,
            transformOrigin: 'top center',
            background: '#ffffff',
            color: 'var(--text)',
            boxShadow: '0 10px 30px rgba(0,0,0,0.4)',
          }}
        >
          {/* Le guide: si vedono, non si toccano e non finiscono nel PDF. */}
          <div aria-hidden style={{ position: 'absolute', inset: 0, pointerEvents: 'none', zIndex: 2 }}>
            <div style={{ position: 'absolute', top: 0, bottom: 0, left: A4_PX.margine, borderLeft: guidaMargine }} />
            <div style={{ position: 'absolute', top: 0, bottom: 0, right: A4_PX.margine, borderRight: guidaMargine }} />
            <div style={{ position: 'absolute', left: 0, right: 0, top: A4_PX.margine, borderTop: guidaMargine }} />
            <div style={{ position: 'absolute', left: 0, right: 0, bottom: A4_PX.margine, borderBottom: guidaMargine }} />
            {Array.from({ length: pagine }, (_, k) => (
              <div
                key={k}
                style={{
                  position: 'absolute',
                  left: 0,
                  right: 0,
                  top: A4_PX.margine + (k + 1) * budget,
                  borderTop: '1px dashed rgba(239, 68, 68, 0.75)',
                }}
              >
                <span style={{ position: 'absolute', right: 4, top: 2, fontSize: 8.5, fontWeight: 700, color: 'var(--red)' }}>
                  fine foglio {k + 1} (indicativo)
                </span>
              </div>
            ))}
          </div>

          <div
            style={{
              padding: `${A4_PX.margine}px`,
              paddingBottom: A4_PX.margine + altezzaPiede + 14,
              boxSizing: 'border-box',
              fontFamily: "'Inter', sans-serif",
            }}
          >
            <div ref={flusso}>
              {intestazione ? <BloccoSbloccabile blocco={intestazione} avvisoSotto={false} /> : null}
              {children}
            </div>
          </div>

          {piede ? (
            <div
              ref={zonaPiede}
              style={{ position: 'absolute', left: A4_PX.margine, right: A4_PX.margine, bottom: A4_PX.margine, zIndex: 3 }}
            >
              <BloccoSbloccabile blocco={piede} avvisoSotto />
            </div>
          ) : null}
        </div>
      </div>

      <div style={{ marginTop: 12, textAlign: 'center', fontSize: 9.5, color: 'rgba(255,255,255,0.62)', lineHeight: 1.5 }}>
        Foglio A4 reale · {A4_PX.larghezza}×{A4_PX.altezza} px · margini {A4_PX.margine} px (20 mm) — le guide tratteggiate sono
        il limite di stampa e non vengono stampate. Il piè di pagina viene ristampato in fondo a ogni foglio del PDF.
      </div>
    </div>
  );
}
