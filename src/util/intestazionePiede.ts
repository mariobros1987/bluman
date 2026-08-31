/**
 * §39 — Intestazione e piè di pagina del documento: due blocchi che viaggiano dentro l'HTML salvato.
 *
 * In Document Studio il foglio mostra l'intestazione dello studio in alto e il piè di pagina in
 * basso. Erano disegnati dal componente e ricostruiti da zero al momento dell'esportazione: due
 * copie della stessa cosa, e nessun modo di modificarli per un singolo documento — un atto
 * intestato a un'altra sede, o senza intestazione perché va su carta prestampata, non si poteva
 * fare. Ora si possono sbloccare e modificare, e quello che si modifica viene salvato (regola 3):
 * non basta che si veda nell'editor, deve tornare identico alla riapertura e finire nel PDF.
 *
 * Il modo scelto è marcare i due blocchi dentro lo stesso HTML del documento, invece di aggiungere
 * due colonne alla tabella: un documento resta un documento, e chi lo legge senza sapere di questi
 * marcatori vede comunque intestazione, corpo e piede nell'ordine giusto.
 *
 * Le funzioni stanno in `src/util/` perché il vitest del progetto esclude `frontend/**` (come
 * `paginaA4.ts` e `dominioMittente.ts`): il giro di andata e ritorno è presidiato da
 * `src/intestazionePiede.test.ts`, ed è il presidio che conta — un documento che perde la propria
 * intestazione al salvataggio la perde per sempre.
 */

/** L'attributo che marca i due blocchi. Cambiarlo rende illeggibili i documenti già salvati. */
export const ATTRIBUTO_BLOCCO = 'data-bluman-blocco';

export interface PartiDocumento {
  /** HTML dell'intestazione, o `null` se il documento non ne porta una propria. */
  intestazione: string | null;
  /** Il corpo, cioè quello che si scrive nell'area editabile. */
  corpo: string;
  /** HTML del piè di pagina, o `null` se il documento non ne porta uno proprio. */
  piede: string | null;
}

/** Il `<div>` marcato che avvolge un blocco. */
function involucro(nome: 'intestazione' | 'piede', contenuto: string): string {
  return `<div ${ATTRIBUTO_BLOCCO}="${nome}">${contenuto}</div>`;
}

/**
 * Rimette insieme le tre parti in un unico HTML salvabile.
 *
 * Un blocco vuoto non viene scritto: l'assenza di intestazione è un'informazione, e un involucro
 * vuoto alla riapertura diventerebbe un'intestazione bianca da cui non si torna indietro.
 */
export function componiDocumento(parti: Partial<PartiDocumento>): string {
  const pezzi: string[] = [];
  const intestazione = (parti.intestazione ?? '').trim();
  const piede = (parti.piede ?? '').trim();
  if (intestazione) pezzi.push(involucro('intestazione', intestazione));
  pezzi.push(parti.corpo ?? '');
  if (piede) pezzi.push(involucro('piede', piede));
  return pezzi.join('\n');
}

/**
 * Trova il `</div>` che chiude il tag aperto a `dopoApertura`, contando le annidature.
 *
 * Restituisce `-1` quando la chiusura manca: in quel caso chi chiama lascia tutto nel corpo,
 * perché tagliare a caso un HTML malformato significa perdere testo del documento.
 */
function fineDiv(html: string, dopoApertura: number): number {
  const tag = /<\s*(\/?)div\b[^>]*>/gi;
  tag.lastIndex = dopoApertura;
  let aperti = 1;
  let trovato: RegExpExecArray | null;
  while ((trovato = tag.exec(html)) !== null) {
    aperti += trovato[1] === '/' ? -1 : 1;
    if (aperti === 0) return trovato.index;
  }
  return -1;
}

/** Estrae il blocco marcato: il contenuto, e l'HTML rimasto senza quel blocco. */
function estrai(html: string, nome: 'intestazione' | 'piede'): { contenuto: string | null; resto: string } {
  const apertura = new RegExp(`<\\s*div\\b[^>]*${ATTRIBUTO_BLOCCO}\\s*=\\s*["']${nome}["'][^>]*>`, 'i');
  const inizio = apertura.exec(html);
  if (!inizio) return { contenuto: null, resto: html };

  const dopoApertura = inizio.index + inizio[0].length;
  const chiusura = fineDiv(html, dopoApertura);
  if (chiusura === -1) return { contenuto: null, resto: html };

  const fineTag = html.indexOf('>', chiusura);
  return {
    contenuto: html.slice(dopoApertura, chiusura),
    resto: html.slice(0, inizio.index) + html.slice(fineTag === -1 ? chiusura : fineTag + 1),
  };
}

/**
 * Separa intestazione, corpo e piede di un HTML salvato.
 *
 * Un documento salvato prima di §39 non porta i marcatori: torna tutto come corpo, con
 * intestazione e piede a `null`. Chi chiama in quel caso userà quelli dello studio — che è
 * esattamente il comportamento di prima.
 */
export function scomponiDocumento(html: string): PartiDocumento {
  const sorgente = html ?? '';
  const testa = estrai(sorgente, 'intestazione');
  const coda = estrai(testa.resto, 'piede');
  return {
    intestazione: testa.contenuto === null ? null : testa.contenuto.trim(),
    corpo: coda.resto.trim(),
    piede: coda.contenuto === null ? null : coda.contenuto.trim(),
  };
}
