/**
 * Il manuale, letto da `docs/manuale/` per l'aiuto dentro l'app.
 *
 * I file `.md` restano **l'unica fonte**: questa non è una copia dell'aiuto, è la sua lettura a
 * runtime. La ragione è la regola che il `README.md` del manuale già si dà — «quando si cambia il
 * comportamento di una sezione, si aggiorna la sua scheda». Se l'aiuto in-app fosse scritto a mano,
 * quella regola avrebbe due destinazioni e una delle due resterebbe indietro: è la classe di guasto
 * di `src/canaliCoerenza.test.ts`, tre copie della stessa verità che divergono.
 *
 * Due cose che questo modulo fa e che non si vedono leggendolo:
 *
 * - **il testo che esce è già filtrato per ruolo.** Un collaboratore non deve poter leggere nella
 *   ricerca parole che poi non trova nella pagina: sarebbe un risultato che porta a un vicolo cieco
 *   senza dirlo. Per questo `contenutoPerRuolo` è **una sola** funzione, e la usano sia la scheda
 *   sia il testo indicizzato.
 * - **l'HTML che esce è già sanitizzato.** `convertiMarkdownInHtml` escapa il testo (altrimenti un
 *   `<` scritto in una scheda diventerebbe markup, perché `sanitizzaHtmlDocumento` **non** escapa
 *   il testo fuori dai tag), e `sanitizzaHtmlDocumento` è il confine: qualunque cosa abbia fatto il
 *   convertitore, quello che esce è quello che la CSP permette. Due reti per due mestieri diversi,
 *   la stessa composizione di `src/routes/documenti.ts`.
 *
 * Non c'è una cache: una scheda si legge in millisecondi, e una cache andrebbe invalidata quando si
 * modifica un `.md` — cioè introdurrebbe un modo di vedere l'aiuto vecchio mentre lo si scrive.
 */

import { readFile, readdir } from 'node:fs/promises';
import path from 'node:path';
import { convertiMarkdownInHtml, markdownInTestoPiano, titoloDelMarkdown } from '../util/markdownHtml.js';
import { sanitizzaHtmlDocumento } from '../util/htmlSanitizer.js';

/**
 * Le schede che **solo** il super admin vede.
 *
 * È un elenco esplicito e non si deduce dai titoli: `19-infra-deploy.md` apre con
 * `## 👤 Cosa fa e come si usa`, quindi la regola non può venire da un `## 🔧`. L'app è multitenant
 * e la §19 nomina l'indirizzo del VPS, il backup notturno, rclone/Dropbox e i file di nginx: è il
 * manuale dell'operatore, non dello studio.
 *
 * `src/manuale.test.ts` verifica che ogni slug elencato **esista**: così un file rinominato fa
 * fallire il test invece di esporre in silenzio quello che doveva restare riservato.
 */
export const SCHEDE_RISERVATE: readonly string[] = ['19-infra-deploy'];

/**
 * Lo slug di una scheda: due cifre, un trattino, e il nome. Il controllo sta **prima** di toccare il
 * disco: senza, `GET /manuale/..%2F..%2F.env` chiede un file che esiste. La regex è l'unico cancello
 * — non c'è un secondo controllo più avanti, e non deve servirci.
 */
const RE_SLUG = /^\d{2}-[a-z0-9-]+$/;

/** La sezione che si toglie a chi non è super admin. */
const RE_NOTA_TECNICA = /^##\s+🔧/;

/** Il ruolo che vede tutto. Il confronto è con `!==`, quindi qualunque altro valore (o `undefined`) è «no». */
const RUOLO_COMPLETO = 'super_admin';

export interface SchedaManuale {
  /** Il nome del file senza `.md`, ed è anche l'identificatore che viaggia nell'URL. */
  slug: string;
  /** Le due cifre iniziali: l'ordine in cui il manuale si legge. */
  numero: string;
  /** Il primo `# ` della scheda. Se manca, lo slug — non un titolo inventato. */
  titolo: string;
  /** Vero se la scheda è in `SCHEDE_RISERVATE`. La pagina ci mette il lucchetto. */
  riservata: boolean;
}

/** Una scheda dell'indice, con il testo su cui la ricerca dell'app cerca. */
export interface SchedaIndicizzata extends SchedaManuale {
  /** Il contenuto **visibile al ruolo**, in testo piano, un rigo di sorgente per riga. */
  testo: string;
}

export interface StatoIndice {
  /** Falso quando la cartella del manuale non si è potuta leggere. Vedi `indiceManuale`. */
  letto: boolean;
  schede: SchedaIndicizzata[];
}

/**
 * L'esito della lettura di una scheda. Non è un `letto: boolean` come altrove perché la rotta deve
 * saper distinguere quattro cose fra loro: «va bene», «è riservata» (403), «non c'è» (404) e «non ho
 * potuto leggere» (503). Un booleano le collasserebbe, e la prima a sparire sarebbe la differenza
 * fra un 403 e un 404 — cioè fra «non ti è permesso» e «non esiste», che è esattamente la
 * distinzione che non si vuole perdere.
 */
export type EsitoScheda =
  | { esito: 'ok'; scheda: SchedaManuale; html: string }
  | { esito: 'riservata' }
  | { esito: 'assente' }
  | { esito: 'non-leggibile' };

/** La cartella del manuale. In Docker il `WORKDIR` è `/app` e `docs/` non è nel `.dockerignore`. */
function cartella(): string {
  return path.join(process.cwd(), 'docs', 'manuale');
}

/**
 * Quello che un ruolo può vedere di una scheda, in markdown — o `null` se non può vederne niente.
 *
 * Il taglio è **da `## 🔧 Nota tecnica` in giù**, non solo di quella sezione: la nota tecnica è
 * l'ultima di ogni scheda (19 file su 19), quindi tutto ciò che segue è, di fatto, parte di essa.
 * Il taglio salta i blocchi di codice, perché un `## 🔧` dentro un fence è testo, non un titolo —
 * è lo stesso errore che `titoloDelMarkdown` evita per il titolo.
 *
 * Chi non è super admin **non** riceve il markdown con la parte tecnica vuota: riceve `null` se la
 * scheda è riservata, e il markdown tagliato altrimenti. Nessuna via di mezzo, perché una via di
 * mezzo è una cosa che si può dimenticare di controllare a valle.
 */
export function contenutoPerRuolo(markdown: string, riservata: boolean, ruolo: string): string | null {
  if (ruolo === RUOLO_COMPLETO) return markdown;
  if (riservata) return null;

  const righe = markdown.replace(/\r\n?/g, '\n').split('\n');
  const tenute: string[] = [];
  let dentroCodice = false;
  for (const riga of righe) {
    if (/^\s*```/.test(riga)) dentroCodice = !dentroCodice;
    if (!dentroCodice && RE_NOTA_TECNICA.test(riga)) break;
    tenute.push(riga);
  }
  return tenute.join('\n');
}

/** L'esito della lettura di un file di scheda. */
type Lettura = { letto: true; markdown: string } | { letto: false; assente: boolean };

async function leggiScheda(slug: string): Promise<Lettura> {
  try {
    return { letto: true, markdown: await readFile(path.join(cartella(), `${slug}.md`), 'utf8') };
  } catch (e) {
    // «Il file non c'è» e «il file non si apre» non sono la stessa cosa: la prima è una scheda in
    // meno (404), la seconda è un'installazione rotta (503), e si aggiustano in modi diversi. Un
    // `catch` che le collassa manda chi indaga a cercare una scheda che esiste.
    const assente = (e as NodeJS.ErrnoException | null)?.code === 'ENOENT';
    return { letto: false, assente };
  }
}

/**
 * L'indice delle schede, filtrato per ruolo e con il testo per la ricerca.
 *
 * Le schede sono i file `NN-nome.md` in ordine di nome: lo zero-padding rende l'ordine alfabetico
 * quello giusto, quindi non serve un ordinamento numerico. Il titolo viene dal primo `# ` di
 * ciascun file, **non** da una tabella scritta a mano: l'indice non è una seconda copia del manuale.
 *
 * Il `README.md` resta l'indice *degli sviluppatori* e non entra qui: le sue ultime sezioni («Il
 * modello di scheda», «Fonti») sono per chi scrive il manuale, non per chi lo legge in app.
 *
 * Se la cartella non si legge (immagine costruita senza `docs/`, cwd sbagliata) — o se **una sola**
 * scheda non si apre — restituisce `letto: false` e un elenco vuoto. **Non** un indice vuoto con
 * `letto: true`: «non ho potuto guardare» non è «non c'è niente da leggere», ed è la differenza fra
 * una pagina che dice «l'aiuto non è disponibile in questa installazione» e una che dice «non c'è
 * aiuto», che sarebbero la stessa schermata con due significati opposti.
 */
export async function indiceManuale(ruolo: string): Promise<StatoIndice> {
  let nomi: string[];
  try {
    const voci = await readdir(cartella(), { withFileTypes: true });
    nomi = voci.filter(v => v.isFile()).map(v => v.name).sort();
  } catch {
    return { letto: false, schede: [] };
  }

  const schede: SchedaIndicizzata[] = [];
  for (const nome of nomi) {
    if (!nome.endsWith('.md')) continue;
    const slug = nome.slice(0, -'.md'.length);
    if (!RE_SLUG.test(slug)) continue;

    const riservata = SCHEDE_RISERVATE.includes(slug);
    const lettura = await leggiScheda(slug);
    // Una scheda che non si legge **annulla l'indice**, invece di sparire in silenzio: un elenco a
    // cui manca una voce senza dirlo è la stessa bugia di un elenco vuoto — chi legge conclude che
    // quella parte del manuale non esiste, e non lo va a cercare. Meglio «non disponibile in questa
    // installazione», che è vero e si va a controllare.
    if (!lettura.letto) return { letto: false, schede: [] };
    const markdown = lettura.markdown;
    const contenuto = contenutoPerRuolo(markdown, riservata, ruolo);
    if (contenuto === null) continue;

    schede.push({
      slug,
      numero: slug.slice(0, 2),
      titolo: titoloDelMarkdown(markdown) ?? slug,
      riservata,
      testo: markdownInTestoPiano(contenuto),
    });
  }
  return { letto: true, schede };
}

/**
 * Una scheda, in HTML pronto da mostrare.
 *
 * L'ordine dei controlli è voluto: lo slug si valida **prima** di qualunque cosa, poi si guarda il
 * ruolo, e solo dopo si legge il file. Così un non-super-admin che chiede una scheda riservata
 * ottiene 403 senza che il disco venga toccato — non può nemmeno dedurre dal tempo di risposta se
 * quel file esiste.
 *
 * Il caso `non-leggibile` esiste per un file che c'è ma non si apre: è un guasto dell'installazione,
 * non una scheda mancante, e va detto con un codice diverso (503) perché le due cose si aggiustano
 * in modi diversi.
 */
export async function htmlScheda(slug: string, ruolo: string): Promise<EsitoScheda> {
  if (!RE_SLUG.test(slug)) return { esito: 'assente' };
  const riservata = SCHEDE_RISERVATE.includes(slug);
  if (riservata && ruolo !== RUOLO_COMPLETO) return { esito: 'riservata' };

  const lettura = await leggiScheda(slug);
  if (!lettura.letto) return { esito: lettura.assente ? 'assente' : 'non-leggibile' };

  const contenuto = contenutoPerRuolo(lettura.markdown, riservata, ruolo) ?? '';
  return {
    esito: 'ok',
    scheda: {
      slug,
      numero: slug.slice(0, 2),
      titolo: titoloDelMarkdown(lettura.markdown) ?? slug,
      riservata,
    },
    html: sanitizzaHtmlDocumento(convertiMarkdownInHtml(contenuto)),
  };
}
