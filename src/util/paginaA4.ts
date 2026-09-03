/**
 * §38 — La geometria del foglio A4 e la distribuzione dei blocchi sulle pagine.
 *
 * Com'era: la geometria stava in `A4_SPECS` dentro `frontend/src/utils/pdfGenerator.ts`, e
 * l'impaginatore accanto usava `const maxPageContentHeight = 900` — un numero che non discendeva
 * da quella geometria (l'area stampabile è 971 px) e che non teneva conto del piè di pagina. Ma il
 * difetto vero era un altro: l'impaginatore spezzava soltanto tra i **figli diretti** dell'HTML
 * ricevuto, e ogni chiamante gli passa un unico `<div>` che avvolge tutto il documento. Un solo
 * figlio: nessun punto dove spezzare. Quel blocco finiva su una pagina alta 1123 px con
 * `overflow` visibile, quindi il testo continuava a essere disegnato oltre il margine inferiore
 * fino al bordo del foglio, e il resto veniva tagliato da html2canvas. È il «alcuni arrivano fino
 * alla fine del foglio»: i documenti costruiti con un contenitore, sì; la guida dei canali, che
 * passa una sequenza di elementi fratelli, no.
 *
 * Com'è: la geometria è calcolata dai millimetri una volta sola, e la distribuzione dei blocchi
 * sulle pagine è una funzione pura che riceve le altezze già misurate. Sta in `src/util/` e non
 * accanto al PDF perché il vitest del progetto esclude `frontend/**` (come per
 * `dominioMittente.ts`): così il presidio `src/paginazioneA4.test.ts` può esercitare l'algoritmo
 * senza un DOM, e il misuratore che vive nel browser resta l'unica parte non testabile qui.
 */

/** I CSS pixel per pollice: è la scala con cui il browser traduce i millimetri. */
export const DPI_CSS = 96;

/** Millimetri in CSS pixel, arrotondati come li arrotonda il layout. */
export function mmInPx(mm: number): number {
  return Math.round((mm * DPI_CSS) / 25.4);
}

/** Il foglio, in millimetri: ISO 216 A4 e il margine di 20 mm su tutti e quattro i lati. */
export const A4_MM = {
  larghezza: 210,
  altezza: 297,
  margine: 20,
} as const;

/**
 * Lo stesso foglio in CSS pixel: 794 × 1123 con margini da 76 px, area stampabile 642 × 971.
 * Nessuno di questi numeri è scritto a mano — se il margine cambia, cambiano tutti insieme.
 */
export const A4_PX = {
  larghezza: mmInPx(A4_MM.larghezza),
  altezza: mmInPx(A4_MM.altezza),
  margine: mmInPx(A4_MM.margine),
  larghezzaStampabile: mmInPx(A4_MM.larghezza) - 2 * mmInPx(A4_MM.margine),
  altezzaStampabile: mmInPx(A4_MM.altezza) - 2 * mmInPx(A4_MM.margine),
} as const;

/**
 * L'altezza che resta ai contenuti quando sul foglio c'è anche un piè di pagina.
 *
 * Il piè di pagina va misurato, non stimato: è l'errore che «900» commetteva al contrario,
 * scontando 71 px di area stampabile senza sapere quanti ne servissero davvero.
 */
export function altezzaUtile(altezzaPiede = 0): number {
  return Math.max(0, A4_PX.altezzaStampabile - Math.max(0, altezzaPiede));
}

/** Un blocco già misurato: l'altezza include i margini verticali, perché occupano foglio. */
export interface BloccoMisurato {
  altezza: number;
}

export interface PaginaImpaginata {
  /** Indici dei blocchi ricevuti, nell'ordine di stampa. */
  indici: number[];
  /** Somma delle altezze dei blocchi della pagina. */
  altezza: number;
  /**
   * Vero quando la pagina contiene un unico blocco più alto dell'area utile: chi disegna deve
   * saperlo, perché quel blocco andrà tagliato o ridotto invece di sconfinare nel margine.
   */
  debordante: boolean;
}

/**
 * Distribuisce i blocchi sulle pagine riempiendole nell'ordine ricevuto.
 *
 * Regole, tutte e tre volute:
 *   - un blocco che non entra nello spazio rimasto apre la pagina successiva;
 *   - un blocco più alto dell'intera area utile sta da solo sulla sua pagina, marcata
 *     `debordante`, invece di trascinare con sé i vicini (chi lo disegna lo spezza o lo riduce);
 *   - una pagina non resta mai vuota: senza questa condizione un primo blocco troppo alto
 *     produrrebbe un foglio bianco davanti a sé.
 */
export function impagina(blocchi: BloccoMisurato[], altezzaDisponibile: number): PaginaImpaginata[] {
  const limite = Math.max(1, altezzaDisponibile);
  const pagine: PaginaImpaginata[] = [];
  let corrente: PaginaImpaginata | null = null;

  blocchi.forEach((blocco, indice) => {
    const altezza = Math.max(0, blocco.altezza);
    const troppoAlto = altezza > limite;

    if (corrente && (troppoAlto || corrente.altezza + altezza > limite)) corrente = null;

    if (!corrente) {
      corrente = { indici: [], altezza: 0, debordante: false };
      pagine.push(corrente);
    }

    corrente.indici.push(indice);
    corrente.altezza += altezza;
    if (troppoAlto) {
      corrente.debordante = true;
      // Un blocco che riempie più di un foglio chiude la pagina: quello che segue va sul prossimo.
      corrente = null;
    }
  });

  return pagine;
}
