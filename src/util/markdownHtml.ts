// Il convertitore markdown → HTML per la guida in-app (`docs/manuale/`).
//
// Vive qui e non in una libreria per una ragione precisa: il sottoinsieme che le schede usano
// davvero è piccolo e **verificato** (`src/manuale.test.ts` converte tutti i file reali), mentre
// una dipendenza in più andrebbe tenuta aggiornata per leggere 20 file che scriviamo noi.
//
// ⚠️ Il punto pericoloso di un convertitore scritto a mano è l'escaping: `sanitizzaHtmlDocumento`
// **non** escapa il testo fuori dai tag (lo lascia passare com'è, perché il suo mestiere è togliere
// il markup, non aggiungerne), quindi un `<` non escapato qui diventerebbe markup là. Regola non
// negoziabile di questo file: **ogni frammento di testo passa da `escapeHtmlTesto` prima di finire
// nell'output**, e solo il markup che scriviamo noi non viene escapato. Dove si legge «esce
// escapato» in questo file, vuol dire questo.
//
// Il convertitore non è l'unica difesa: `src/domain/manuale.ts` gli fa seguire
// `sanitizzaHtmlDocumento`. Due reti per due mestieri diversi — qui la correttezza, là il confine.

import { escapeHtmlTesto } from './htmlSanitizer.js';

/** Un blocco del documento. La conversione è in due fasi (blocchi, poi rendering): una macchina a
 *  stati che emette mentre legge sbaglia i confini — e i confini sono tutto, in un elenco annidato. */
type Nodo =
  | { tipo: 'titolo'; livello: number; testo: string }
  | { tipo: 'paragrafo'; testo: string }
  | { tipo: 'codice'; linguaggio: string; righe: string[] }
  | { tipo: 'citazione'; testo: string }
  | { tipo: 'tabella'; intestazioni: string[]; righe: string[][] }
  | { tipo: 'elenco'; elementi: ElementoElenco[] }
  /** La riga `---`: una separazione, senza testo. */
  | { tipo: 'riga' };

interface ElementoElenco {
  /** Livello di annidamento: 0 è la riga a filo, 1 è rientrata di due spazi, e così via. */
  profondita: number;
  ordinato: boolean;
  testo: string;
}

const RE_FENCE = /^\s*```\s*([a-zA-Z0-9_+-]*)\s*$/;
const RE_TITOLO = /^(#{1,6})\s+(.*)$/;
const RE_ELEMENTO = /^(\s*)([-*]|\d+\.)\s+(.*)$/;
const RE_CITAZIONE = /^\s*>\s?(.*)$/;
/** La riga di trattini sotto l'intestazione di una tabella: `|---|---|` o `| :--- | ---: |`. */
const RE_SEPARATORE_TABELLA = /^\|?[\s:|-]+\|[\s:|-]*$/;

/**
 * Una riga di separazione: `---`, `***` o `___` (almeno tre), da soli sulla riga.
 *
 * Tre caratteri, perché con due `--` si scrivono cose come «l'intervallo 10--20» e una riga così
 * diventerebbe una riga di separazione. E il marcatore degli elenchi non entra in conflitto: quello
 * vuole uno spazio dopo di sé (`- voce`), questo non ne vuole nessuno.
 */
const RE_RIGA = /^\s*(?:-{3,}|\*{3,}|_{3,})\s*$/;

/**
 * `*corsivo*`, `**grassetto**`, `` `codice` `` — e nient'altro.
 *
 * Tre assenze sono scelte, non dimenticanze:
 * - **il corsivo è solo `*`, mai `_`**: le schede sono piene di identificatori come
 *   `moduliConcessi` e `moduliDisattivati` (le colonne `tenant`), e un `_` trattato come enfasi li
 *   spezzerebbe a metà parola — leggibile e sbagliato, che è il peggio;
 * - **l'apertura del corsivo deve stare a inizio riga o dopo uno spazio** (`(?<=^|\s)`). Senza
 *   questo vincolo un glob come `src/**\/*.ts` diventa `src/*<em>/</em>.ts`: gli asterischi sono
 *   tre, il markdown ne vede un'apertura e una chiusura intorno alla barra. Il markdown vero
 *   risolve il caso con la regola delle «flanking run»; qui basta la regola più stretta, perché
 *   nelle schede il corsivo comincia **sempre** dopo uno spazio o a inizio riga, e un caso che non
 *   si presenta non merita un parser. Se un giorno servisse `«*corsivo*»`, il ripiego è innocuo:
 *   gli asterischi restano a vista, che è un difetto che si vede;
 * - **i link `[testo](url)` non ci sono**: nessuna scheda ne ha uno, e una via che i file veri non
 *   esercitano è una via che nessuno ha provato. Se servirà, si aggiunge con il suo test.
 *
 * L'alternanza è ordine-sensibile: `**` va provato prima di `*`, altrimenti `**grassetto**`
 * diventerebbe un corsivo vuoto seguito da un asterisco.
 *
 * Il grassetto è `.+?` e non `[^*]+` perché deve poter **contenere** un corsivo: in
 * `01-progetti-motore-stato.md` c'è «**Un passaggio di tipo *Documento* nasce senza documento**», e
 * con `[^*]+` il `**` non trovava la chiusura, il corsivo interno veniva letto da solo e i quattro
 * asterischi del grassetto restavano a vista. Il `?` lo tiene pigro, così `**A** e **B**` si chiude
 * al primo `**` invece di inghiottire la riga.
 */
const RE_INLINE = /`([^`]*)`|\*\*(.+?)\*\*|(?<=^|\s)\*([^*\s][^*]*?)\*/g;

/** Rende la formattazione dentro una riga. Il testo che non è un costrutto esce **escapato**. */
function inline(testo: string): string {
  let out = '';
  let pos = 0;
  for (const m of testo.matchAll(RE_INLINE)) {
    if (m.index > pos) out += escapeHtmlTesto(testo.slice(pos, m.index));
    if (m[1] !== undefined) out += `<code>${escapeHtmlTesto(m[1])}</code>`;
    else if (m[2] !== undefined) out += `<strong>${inline(m[2])}</strong>`;
    else if (m[3] !== undefined) out += `<em>${inline(m[3])}</em>`;
    pos = m.index + m[0].length;
  }
  return out + escapeHtmlTesto(testo.slice(pos));
}

function dividiCelle(riga: string): string[] {
  // Si taglia il `|` di testa e di coda e poi si divide: `split('|')` con lo `slice(1, -1)`
  // mangerebbe l'ultima cella di una riga che non chiude col `|`, che è una forma che il markdown
  // accetta.
  return riga.trim().replace(/^\|/, '').replace(/\|$/, '').split('|').map((c) => c.trim());
}

/** Le righe che cominciano con `|` e hanno sotto un separatore sono una tabella; le altre no. */
function iniziaTabella(righe: string[], i: number): boolean {
  const corrente = righe[i]?.trim() ?? '';
  const prossima = righe[i + 1]?.trim() ?? '';
  return corrente.startsWith('|') && RE_SEPARATORE_TABELLA.test(prossima);
}
/**
 * Prima fase: le righe diventano blocchi.
 *
 * Il caso che rende necessario il buffer, e che una lettura riga-per-riga sbaglia sempre: in
 * `15-comunicazioni.md` un punto elenco continua sui righi seguenti, rientrati ma **senza** un
 * nuovo `-`. Quei righi appartengono all'elemento precedente, non a un paragrafo nuovo: è il
 * «lazy continuation» del markdown, ed è la differenza fra un elenco leggibile e diciannove
 * paragrafi staccati.
 */
function inBlocchi(markdown: string): Nodo[] {
  const righe = markdown.replace(/\r\n?/g, '\n').split('\n');
  const nodi: Nodo[] = [];

  let paragrafo: string[] | null = null;
  let citazione: string[] | null = null;
  let elenco: ElementoElenco[] | null = null;
  // Le righe non ancora unite di ogni elemento dell'elenco aperto: si uniscono alla chiusura,
  // perché è solo allora che si sa quali righi erano continuazioni.
  let righeElemento: string[][] = [];

  const chiudi = () => {
    if (paragrafo) { nodi.push({ tipo: 'paragrafo', testo: paragrafo.join(' ') }); paragrafo = null; }
    if (citazione) { nodi.push({ tipo: 'citazione', testo: citazione.join(' ') }); citazione = null; }
    if (elenco) {
      nodi.push({
        tipo: 'elenco',
        elementi: elenco.map((el, n) => ({ ...el, testo: (righeElemento[n] ?? []).join(' ') })),
      });
      elenco = null; righeElemento = [];
    }
  };

  for (let i = 0; i < righe.length; i += 1) {
    const riga = righe[i] ?? '';

    if (!riga.trim()) { chiudi(); continue; }

    // Blocco di codice: il contenuto è verbatim, quindi si consuma senza interpretare niente.
    const fence = riga.match(RE_FENCE);
    if (fence) {
      chiudi();
      const corpo: string[] = [];
      i += 1;
      while (i < righe.length && !RE_FENCE.test(righe[i] ?? '')) { corpo.push(righe[i] ?? ''); i += 1; }
      // Se il fence di chiusura non c'è, il blocco finisce col file: un fence aperto e mai chiuso
      // non deve far sparire il resto della scheda.
      nodi.push({ tipo: 'codice', linguaggio: fence[1] ?? '', righe: corpo });
      continue;
    }

    // Riga di separazione. Prima dei titoli e delle tabelle: `---` non è né l'uno né l'altra, e
    // lasciarla arrivare a `iniziaTabella` sarebbe chiederle di non somigliare a un separatore di
    // tabella — cosa che oggi è vera, ma per una ragione che non c'è scritta da nessuna parte.
    if (RE_RIGA.test(riga)) {
      chiudi();
      nodi.push({ tipo: 'riga' });
      continue;
    }

    const titolo = riga.match(RE_TITOLO);
    if (titolo) {
      chiudi();
      nodi.push({ tipo: 'titolo', livello: (titolo[1] ?? '#').length, testo: (titolo[2] ?? '').trim() });
      continue;
    }

    if (iniziaTabella(righe, i)) {
      chiudi();
      const intestazioni = dividiCelle(riga);
      i += 2; // la riga dell'intestazione e quella dei trattini
      const corpo: string[][] = [];
      while (i < righe.length && (righe[i] ?? '').trim().startsWith('|')) {
        corpo.push(dividiCelle(righe[i] ?? ''));
        i += 1;
      }
      i -= 1;
      nodi.push({ tipo: 'tabella', intestazioni, righe: corpo });
      continue;
    }

    const cit = riga.match(RE_CITAZIONE);
    if (cit) {
      if (paragrafo) { chiudi(); }
      if (elenco) { chiudi(); }
      citazione = citazione ?? [];
      citazione.push(cit[1] ?? '');
      continue;
    }

    const elemento = riga.match(RE_ELEMENTO);
    if (elemento) {
      if (paragrafo) chiudi();
      if (citazione) chiudi();
      if (!elenco) { elenco = []; righeElemento = []; }
      elenco.push({
        profondita: Math.floor((elemento[1] ?? '').replace(/\t/g, '  ').length / 2),
        ordinato: /\d/.test(elemento[2] ?? ''),
        testo: '',
      });
      righeElemento.push([elemento[3] ?? '']);
      continue;
    }

    // Riga di testo. Dentro un elenco è la continuazione dell'ultimo elemento; dentro una
    // citazione, un altro verso; altrimenti è un paragrafo che comincia o prosegue.
    if (elenco) { righeElemento[righeElemento.length - 1]?.push(riga.trim()); continue; }
    if (citazione) { citazione.push(riga.trim()); continue; }
    paragrafo = paragrafo ?? [];
    paragrafo.push(riga.trim());
  }

  chiudi();
  return nodi;
}

/**
 * Seconda fase: i blocchi diventano HTML.
 *
 * L'elenco è la parte che vale la pena spiegare, perché è l'unica che non si può emettere
 * leggendo una riga alla volta. Un `<ul>` annidato deve stare **dentro** il `<li>` del genitore,
 * quindi il `<li>` non si può chiudere appena lo si è scritto: si chiude quando si sa se
 * l'elemento successivo è allo stesso livello o più dentro. Da qui due pile — i tag aperti e, per
 * ogni livello, se c'è un `<li>` ancora da chiudere. E `liAperto[livello]` **non** è `pila[livello]`:
 * il primo dice se il testo dell'elemento è già stato emesso e attende il `</li>`, il secondo quale
 * tag di elenco è aperto lì.
 */
function rendiElenco(elementi: ElementoElenco[]): string {
  const out: string[] = [];
  const pila: ('ul' | 'ol')[] = [];
  const liAperto: boolean[] = [];
  let livello = 0;

  const chiudiLi = () => {
    if (liAperto[livello]) { out.push('</li>'); liAperto[livello] = false; }
  };

  for (const el of elementi) {
    const tag: 'ul' | 'ol' = el.ordinato ? 'ol' : 'ul';

    if (!pila.length) {
      out.push(`<${tag}>`); pila.push(tag); liAperto.push(false); livello = 0;
    } else if (el.profondita > livello) {
      // Si scende: il livello nuovo nasce **dentro** il `<li>` del genitore, che per questo resta
      // aperto. (Se il primo elemento fosse già rientrato, il `<ul>` finirebbe dentro un `<ul>`:
      // non è HTML elegante, ma è una forma che il markdown reale non produce e che il browser
      // rende come un elenco rientrato — il ripiego innocuo.)
      while (livello < el.profondita) {
        out.push(`<${tag}>`); pila.push(tag); liAperto.push(false); livello += 1;
      }
    } else {
      while (livello > el.profondita) {
        chiudiLi();
        out.push(`</${pila.pop()}>`); liAperto.pop(); livello -= 1;
      }
      chiudiLi();
      const attuale = pila[livello];
      if (attuale !== tag) {
        // Puntato e numerato che si scambiano allo stesso livello: si sostituisce il tag invece di
        // annidare, che è quello che la sorgente dice.
        out.push(`</${attuale}>`);
        pila[livello] = tag;
        out.push(`<${tag}>`);
      }
    }

    out.push(`<li>${inline(el.testo)}`);
    liAperto[livello] = true;
  }

  while (pila.length) {
    chiudiLi();
    out.push(`</${pila.pop()}>`); liAperto.pop(); livello -= 1;
  }
  return out.join('');
}

function rendi(nodi: Nodo[]): string {
  const out: string[] = [];
  for (const nodo of nodi) {
    switch (nodo.tipo) {
      case 'titolo':
        out.push(`<h${nodo.livello}>${inline(nodo.testo)}</h${nodo.livello}>`);
        break;
      case 'paragrafo':
        out.push(`<p>${inline(nodo.testo)}</p>`);
        break;
      case 'citazione':
        out.push(`<blockquote><p>${inline(nodo.testo)}</p></blockquote>`);
        break;
      case 'codice': {
        // Il linguaggio è già ristretto dal `RE_FENCE`, ma passa lo stesso dall'escaping: chi legge
        // questo file non deve doverlo dedurre da un'altra riga.
        const classe = nodo.linguaggio ? ` class="language-${escapeHtmlTesto(nodo.linguaggio)}"` : '';
        out.push(`<pre><code${classe}>${escapeHtmlTesto(nodo.righe.join('\n'))}</code></pre>`);
        break;
      }
      case 'tabella':
        out.push('<table><thead><tr>');
        for (const cella of nodo.intestazioni) out.push(`<th>${inline(cella)}</th>`);
        out.push('</tr></thead><tbody>');
        for (const riga of nodo.righe) {
          out.push('<tr>');
          // Una riga con meno celle dell'intestazione non è un errore da segnalare: si emette quel
          // che c'è, e il `<td>` mancante è visibile a chi legge.
          for (const cella of riga) out.push(`<td>${inline(cella)}</td>`);
          out.push('</tr>');
        }
        out.push('</tbody></table>');
        break;
      case 'elenco':
        out.push(rendiElenco(nodo.elementi));
        break;
      case 'riga':
        // `<hr>` e non `<hr />`: il sanitizzatore riscrive comunque i tag vuoti senza barra, e due
        // forme per la stessa cosa si leggono come due cose diverse.
        out.push('<hr>');
        break;
    }
  }
  return out.join('\n');
}

/**
 * Converte una scheda del manuale in HTML.
 *
 * L'HTML che esce è **già escapato** nel testo, ma non è ancora passato dal sanitizzatore: chi lo
 * serve deve farlo (`htmlScheda` in `src/domain/manuale.ts` è la catena completa). Non è una
 * ridondanza — è la stessa divisione di `src/routes/documenti.ts`, dove il confine sanitizza
 * qualunque cosa gli arrivi.
 */
export function convertiMarkdownInHtml(markdown: string): string {
  if (typeof markdown !== 'string' || !markdown) return '';
  return rendi(inBlocchi(markdown));
}

/** Toglie la formattazione dentro una riga, tenendone il testo: `` `x` `` e `**x**` diventano `x`. */
function spogliaInline(testo: string): string {
  let out = '';
  let pos = 0;
  for (const m of testo.matchAll(RE_INLINE)) {
    out += testo.slice(pos, m.index);
    // Il grassetto può contenere un corsivo, quindi si scende dentro il gruppo invece di prenderlo
    // com'è: senza la ricorsione `**Un tipo *Documento* qui**` lascerebbe gli asterischi del
    // corsivo nel testo piano — cioè nell'estratto della ricerca, che è dove si leggono.
    // Il gruppo 1 è il contenuto di un `code`, e lì la sintassi **è** il contenuto: non si tocca.
    out += m[1] ?? spogliaInline(m[2] ?? m[3] ?? '');
    pos = m.index + m[0].length;
  }
  return out + testo.slice(pos);
}

/**
 * Lo stesso markdown, ma in testo piano, **un rigo di sorgente per riga**.
 *
 * Serve alla ricerca dell'aiuto in-app, che mostra «il rigo che ha trovato» come estratto: se
 * l'estratto uscisse dal markdown grezzo mostrerebbe `**`, i `|` delle tabelle e i backtick, cioè
 * proprio la sintassi che la pagina esiste per non far vedere. Passa dagli stessi `inBlocchi` della
 * conversione HTML, quindi fence, tabelle ed elenchi si leggono allo stesso modo nei due percorsi —
 * due lettori diversi dello stesso file divergerebbero.
 *
 * Non è HTML e non passa dal sanitizzatore: non viene mai interpretato, viaggia in JSON e React lo
 * rende come testo. È anche il motivo per cui qui **non** si escapa niente.
 */
export function markdownInTestoPiano(markdown: string): string {
  if (typeof markdown !== 'string' || !markdown) return '';
  const righe: string[] = [];
  for (const nodo of inBlocchi(markdown)) {
    switch (nodo.tipo) {
      case 'titolo':
      case 'paragrafo':
      case 'citazione':
        righe.push(spogliaInline(nodo.testo));
        break;
      case 'codice':
        // Il codice resta com'è: chi cerca `distribuisci.sh` lo trova anche se compare solo là.
        righe.push(...nodo.righe);
        break;
      case 'tabella':
        righe.push(nodo.intestazioni.map(spogliaInline).join(' — '));
        for (const riga of nodo.righe) righe.push(riga.map(spogliaInline).join(' — '));
        break;
      case 'elenco':
        // Il rientro tiene la gerarchia, che nell'estratto è l'unica cosa che dice a quale punto
        // appartiene il rigo trovato.
        for (const el of nodo.elementi) righe.push('  '.repeat(el.profondita) + spogliaInline(el.testo));
        break;
      case 'riga':
        // Non porta testo: nell'estratto della ricerca non c'è niente da mostrare, e un rigo di
        // trattini sarebbe rumore in mezzo ai risultati.
        break;
    }
  }
  return righe.filter((r) => r.trim()).join('\n');
}

/** Il primo titolo di primo livello, fuori dai blocchi di codice. `null` se non c'è. */
export function titoloDelMarkdown(markdown: string): string | null {
  let dentroCodice = false;
  for (const riga of markdown.replace(/\r\n?/g, '\n').split('\n')) {
    // Il `README.md` contiene un `# NN · <Nome sezione>` dentro il fence del modello di scheda:
    // senza questo controllo il titolo della scheda sarebbe il segnaposto del modello.
    if (RE_FENCE.test(riga)) { dentroCodice = !dentroCodice; continue; }
    if (dentroCodice) continue;
    const m = riga.match(/^#\s+(.*)$/);
    if (m) return (m[1] ?? '').trim();
  }
  return null;
}
