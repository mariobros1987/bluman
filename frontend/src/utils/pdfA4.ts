/**
 * §38 — Il misuratore che decide dove finisce una pagina.
 *
 * Vive nel browser perché è l'unico posto dove si può sapere quanto è alto un paragrafo. La
 * geometria del foglio e la distribuzione dei blocchi stanno invece in `src/util/paginaA4.ts`:
 * sono aritmetica, e da lì le vede il presidio `src/paginazioneA4.test.ts` (il vitest del progetto
 * esclude `frontend/**`).
 *
 * Cosa faceva sconfinare il testo fino al bordo del foglio, prima:
 *
 *   1. si spezzava solo tra i **figli diretti** dell'HTML ricevuto, e ogni chiamante passa un
 *      unico `<div>` che avvolge il documento: un solo figlio, nessun punto di taglio. Il blocco
 *      restava su una pagina alta 1123 px con overflow visibile e continuava a essere disegnato
 *      dentro e oltre il margine inferiore;
 *   2. le altezze venivano lette con `offsetHeight`, che **esclude i margini verticali**, mentre
 *      il CSS della pagina ne mette fino a 26 px per blocco: venti paragrafi bastavano a sfondare
 *      il foglio anche quando i tagli c'erano;
 *   3. il contenuto veniva misurato in un contenitore **senza il CSS della pagina**: si misurava
 *      un `h1` da 32 px di default per poi stamparne uno da 16 pt.
 *
 * Ora si scende dentro i contenitori fino a trovare blocchi che entrano in una pagina, si misura
 * con i margini, si misura con gli stessi stili con cui si stampa, e i contenitori attraversati
 * vengono **ricostruiti** attorno ai blocchi su ogni pagina, così nessuno stile viene perso.
 */
import { A4_PX, altezzaUtile, impagina } from '../../../src/util/paginaA4';

/** La classe su cui è appeso il CSS del foglio: la porta anche il contenitore di misura. */
export const CLASSE_PAGINA = 'bluman-a4-physical-page';

/** Tipografia del foglio. Misurare con altri valori significa misurare un altro documento. */
export const TIPOGRAFIA_PAGINA = {
  fontFamily: "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif",
  fontSize: '10.5pt',
  lineHeight: '1.6',
  color: '#1e293b',
} as const;

/** Il CSS del foglio, unico per la misura e per la stampa. */
export const CSS_PAGINA = `
  .${CLASSE_PAGINA} p { margin: 0 0 10px 0; text-align: justify; text-justify: inter-word; line-height: 1.6; }
  .${CLASSE_PAGINA} h1 { font-size: 16pt; font-weight: 800; color: #1e1b4b; margin: 10px 0 16px 0; text-align: center; text-transform: uppercase; letter-spacing: 0.5px; line-height: 1.3; }
  .${CLASSE_PAGINA} h2 { font-size: 12.5pt; font-weight: 700; color: #1e1b4b; margin: 14px 0 8px 0; line-height: 1.35; }
  .${CLASSE_PAGINA} h3 { font-size: 11pt; font-weight: 700; color: #1e1b4b; margin: 12px 0 6px 0; line-height: 1.4; }
  .${CLASSE_PAGINA} h4 { font-size: 10pt; font-weight: 700; color: #4338ca; margin: 10px 0 4px 0; }
  .${CLASSE_PAGINA} ul, .${CLASSE_PAGINA} ol { margin: 0 0 10px 0; padding-left: 20px; }
  .${CLASSE_PAGINA} li { margin-bottom: 4px; line-height: 1.5; }
  .${CLASSE_PAGINA} table { width: 100%; border-collapse: collapse; margin: 12px 0; font-size: 9pt; }
  .${CLASSE_PAGINA} th, .${CLASSE_PAGINA} td { padding: 6px 8px; border: 1px solid #cbd5e1; vertical-align: top; }
  .${CLASSE_PAGINA} th { background: #f1f5f9; font-weight: 700; color: #1e1b4b; text-align: left; }
  .${CLASSE_PAGINA} strong { font-weight: 700; color: #0f172a; }
  .${CLASSE_PAGINA} code { font-family: monospace; background: #f1f5f9; padding: 1px 4px; border-radius: 4px; font-size: 9pt; }
  .${CLASSE_PAGINA} img { max-width: 100%; }
`;

/**
 * Un blocco stampabile: l'elemento, la catena di contenitori che lo avvolgeva nell'HTML di
 * partenza (cloni senza figli, da ricostruire su ogni pagina) e l'altezza misurata con i margini.
 */
interface BloccoPiatto {
  elemento: HTMLElement;
  catena: HTMLElement[];
  altezza: number;
}

/** Altezza occupata sul foglio: `offsetHeight` non conta i margini verticali, che occupano. */
function altezzaConMargini(el: HTMLElement): number {
  const stile = getComputedStyle(el);
  const sopra = parseFloat(stile.marginTop) || 0;
  const sotto = parseFloat(stile.marginBottom) || 0;
  return el.offsetHeight + sopra + sotto;
}

/** Vero se almeno un figlio è di livello blocco: solo lì si può tagliare senza rompere una riga. */
function haFigliDiBlocco(el: HTMLElement): boolean {
  return Array.from(el.children).some((figlio) => {
    const display = getComputedStyle(figlio).display;
    return display !== 'none' && !display.startsWith('inline') && display !== 'contents';
  });
}

/**
 * Il testo scritto direttamente dentro un contenitore diventa un blocco a sé.
 *
 * Senza questo passaggio `<div>testo<p>…</p></div>` perderebbe «testo» nella discesa: i figli
 * elemento si vedono, i nodi di testo no.
 */
function normalizzaTestiSciolti(el: HTMLElement): void {
  for (const nodo of Array.from(el.childNodes)) {
    if (nodo.nodeType !== 3 || !(nodo.textContent ?? '').trim()) continue;
    const involucro = document.createElement('div');
    involucro.appendChild(nodo.cloneNode(true));
    el.replaceChild(involucro, nodo);
  }
}

/**
 * Spezza in più pezzi una foglia più alta di una pagina — un paragrafo lunghissimo, una cella.
 *
 * I pezzi nascono accanto all'originale, così ereditano lo stesso contesto (larghezza, font,
 * padding degli antenati) e le misure valgono. I nodi figli vengono spostati uno per uno; quando
 * nemmeno un nodo da solo entra, se è testo si cerca l'ultima parola che ci sta. Un'immagine
 * indivisibile resta dov'è: la pagina la taglierà al margine invece di lasciarla sconfinare.
 */
function spezza(originale: HTMLElement, budget: number): Array<{ elemento: HTMLElement; altezza: number }> {
  const genitore = originale.parentNode;
  if (!genitore) return [{ elemento: originale, altezza: altezzaConMargini(originale) }];

  const pezzi: Array<{ elemento: HTMLElement; altezza: number }> = [];
  const coda: Node[] = Array.from(originale.childNodes).map((n) => n.cloneNode(true));
  let corrente = originale.cloneNode(false) as HTMLElement;
  genitore.insertBefore(corrente, originale);

  const chiudi = () => {
    pezzi.push({ elemento: corrente, altezza: altezzaConMargini(corrente) });
    corrente = originale.cloneNode(false) as HTMLElement;
    genitore.insertBefore(corrente, originale);
  };

  while (coda.length > 0) {
    const nodo = coda.shift() as Node;
    corrente.appendChild(nodo);
    if (altezzaConMargini(corrente) <= budget) continue;

    corrente.removeChild(nodo);
    if (corrente.childNodes.length > 0) {
      chiudi();
      coda.unshift(nodo);
      continue;
    }

    if (nodo.nodeType === 3) {
      // Le parole si dividono tenendo gli spazi come elementi dell'elenco: rimontandole si
      // riottiene il testo esatto, senza spazi persi né aggiunti.
      const parole = (nodo.textContent ?? '').split(/(\s+)/);
      const sonda = document.createTextNode('');
      corrente.appendChild(sonda);
      let basso = 1;
      let alto = parole.length;
      let quante = 1;
      while (basso <= alto) {
        const mezzo = (basso + alto) >> 1;
        sonda.textContent = parole.slice(0, mezzo).join('');
        if (altezzaConMargini(corrente) <= budget) {
          quante = mezzo;
          basso = mezzo + 1;
        } else {
          alto = mezzo - 1;
        }
      }
      sonda.textContent = parole.slice(0, quante).join('');
      const resto = parole.slice(quante).join('');
      chiudi();
      // Anche nel caso peggiore — una parola più larga del foglio — `quante` è almeno 1: la coda
      // si accorcia sempre, quindi il ciclo termina.
      if (resto) coda.unshift(document.createTextNode(resto));
      continue;
    }

    corrente.appendChild(nodo);
    chiudi();
  }

  if (corrente.childNodes.length > 0) pezzi.push({ elemento: corrente, altezza: altezzaConMargini(corrente) });
  else genitore.removeChild(corrente);

  genitore.removeChild(originale);
  return pezzi;
}

/**
 * Scende nell'albero finché ogni blocco entra in una pagina.
 *
 * Un contenitore che ci sta viene preso intero: è quello che tiene insieme un'intestazione con la
 * sua tabella. Uno che non ci sta viene attraversato, e il suo clone senza figli entra nella catena
 * dei blocchi che ne discendono, per essere ricostruito su ogni pagina che li ospita.
 */
function appiattisci(el: HTMLElement, catena: HTMLElement[], budget: number, fuori: BloccoPiatto[]): void {
  const altezza = altezzaConMargini(el);
  if (altezza <= budget) {
    fuori.push({ elemento: el, catena, altezza });
    return;
  }

  normalizzaTestiSciolti(el);
  if (el.children.length > 0 && haFigliDiBlocco(el)) {
    const catenaFiglio = [...catena, el.cloneNode(false) as HTMLElement];
    for (const figlio of Array.from(el.children) as HTMLElement[]) {
      appiattisci(figlio, catenaFiglio, budget, fuori);
    }
    return;
  }

  for (const pezzo of spezza(el, budget)) {
    fuori.push({ elemento: pezzo.elemento, catena, altezza: pezzo.altezza });
  }
}

/** Firma della catena di contenitori: due blocchi con la stessa firma condividono i contenitori. */
function firmaCatena(catena: HTMLElement[]): string {
  return catena.map((el) => `${el.tagName}|${el.getAttribute('style') ?? ''}|${el.className}`).join('»');
}

/** Rimonta i blocchi di una pagina dentro i contenitori da cui provengono. */
function ricostruisci(blocchi: BloccoPiatto[]): DocumentFragment {
  const frammento = document.createDocumentFragment();
  let firmaPrecedente: string | null = null;
  let ancora: Node = frammento;

  for (const blocco of blocchi) {
    const firma = firmaCatena(blocco.catena);
    if (firma !== firmaPrecedente) {
      firmaPrecedente = firma;
      ancora = frammento;
      for (const antenato of blocco.catena) {
        const clone = antenato.cloneNode(false) as HTMLElement;
        ancora.appendChild(clone);
        ancora = clone;
      }
    }
    ancora.appendChild(blocco.elemento);
  }

  return frammento;
}

/** Applica al nodo la tipografia del foglio: misura e stampa devono usare la stessa. */
function applicaTipografia(el: HTMLElement): void {
  el.style.fontFamily = TIPOGRAFIA_PAGINA.fontFamily;
  el.style.fontSize = TIPOGRAFIA_PAGINA.fontSize;
  el.style.lineHeight = TIPOGRAFIA_PAGINA.lineHeight;
  el.style.color = TIPOGRAFIA_PAGINA.color;
}

/** Il piè di pagina, identico in misura e in stampa. */
function creaPiede(html: string): HTMLElement {
  const piede = document.createElement('div');
  piede.style.borderTop = '1px solid #e2e8f0';
  piede.style.paddingTop = '8px';
  piede.style.marginTop = '16px';
  piede.style.display = 'flex';
  piede.style.justifyContent = 'space-between';
  piede.style.alignItems = 'center';
  piede.style.fontSize = '8.5pt';
  piede.style.color = '#94a3b8';
  piede.innerHTML = html;
  return piede;
}

export interface OpzioniPagine {
  /** Contenuto del piè di pagina, che conosce il numero di pagina e il totale. */
  piede?: (pagina: number, totale: number) => string;
}

/**
 * Costruisce i fogli A4 fisici da stampare, già appesi al documento e fuori dal viewport.
 *
 * Chi chiama li rende con html2canvas e poi li rimuove. Il contenuto di ogni foglio è garantito
 * dentro i margini: quello che non ci sta è finito sul foglio successivo, e quello che non è stato
 * possibile spezzare viene tagliato al margine invece di essere disegnato fino al bordo.
 */
export function creaPagineA4(contenutoHtml: string, opzioni: OpzioniPagine = {}): HTMLElement[] {
  const misura = document.createElement('div');
  misura.className = CLASSE_PAGINA;
  misura.style.position = 'fixed';
  misura.style.top = '0';
  misura.style.left = '-99999px';
  misura.style.width = `${A4_PX.larghezzaStampabile}px`;
  applicaTipografia(misura);
  const stile = document.createElement('style');
  stile.textContent = CSS_PAGINA;
  misura.appendChild(stile);
  document.body.appendChild(misura);

  const contenuto = document.createElement('div');
  contenuto.style.width = '100%';
  contenuto.innerHTML = contenutoHtml;
  misura.appendChild(contenuto);

  // L'area utile si ricava dal piè di pagina misurato per davvero, non da un numero deciso a mano.
  let altezzaPiede = 0;
  if (opzioni.piede) {
    const provaPiede = creaPiede(opzioni.piede(1, 1));
    misura.appendChild(provaPiede);
    altezzaPiede = altezzaConMargini(provaPiede);
    misura.removeChild(provaPiede);
  }
  const budget = altezzaUtile(altezzaPiede);

  normalizzaTestiSciolti(contenuto);
  const blocchi: BloccoPiatto[] = [];
  for (const figlio of Array.from(contenuto.children) as HTMLElement[]) {
    appiattisci(figlio, [], budget, blocchi);
  }

  const pagine = impagina(blocchi, budget);
  const fogli: HTMLElement[] = [];
  const totale = Math.max(1, pagine.length);

  (pagine.length > 0 ? pagine : [{ indici: [], altezza: 0, debordante: false }]).forEach((pagina, idx) => {
    const foglio = document.createElement('div');
    foglio.className = CLASSE_PAGINA;
    foglio.style.position = 'fixed';
    foglio.style.top = '0';
    foglio.style.left = `${idx * (A4_PX.larghezza + 60)}px`;
    foglio.style.width = `${A4_PX.larghezza}px`;
    foglio.style.height = `${A4_PX.altezza}px`;
    foglio.style.padding = `${A4_PX.margine}px`;
    foglio.style.boxSizing = 'border-box';
    foglio.style.background = '#ffffff';
    foglio.style.zIndex = '-9999';
    foglio.style.display = 'flex';
    foglio.style.flexDirection = 'column';
    foglio.style.justifyContent = 'space-between';
    applicaTipografia(foglio);

    const cssFoglio = document.createElement('style');
    cssFoglio.textContent = CSS_PAGINA;
    foglio.appendChild(cssFoglio);

    const corpo = document.createElement('div');
    corpo.style.width = '100%';
    // `1 1 0` con `min-height: 0` costringe il corpo allo spazio che resta invece di crescere col
    // contenuto: è questa coppia che rende efficace `overflow: hidden`, l'ultima difesa contro
    // l'inchiostro sul margine.
    corpo.style.flex = '1 1 0';
    corpo.style.minHeight = '0';
    corpo.style.overflow = 'hidden';
    corpo.appendChild(ricostruisci(pagina.indici.map((i) => blocchi[i] as BloccoPiatto)));
    foglio.appendChild(corpo);

    if (opzioni.piede) foglio.appendChild(creaPiede(opzioni.piede(idx + 1, totale)));

    document.body.appendChild(foglio);
    fogli.push(foglio);
  });

  document.body.removeChild(misura);
  return fogli;
}




