// Il convertitore del manuale. Due cose si provano qui, e la seconda conta più della prima:
// che i costrutti che le schede usano davvero si leggano, e che **il testo esca sempre escapato**.
// La seconda è l'unica ragione per cui questo file esiste come test separato: un convertitore
// scritto a mano che non escapa è un buco, non un difetto di resa — e `sanitizzaHtmlDocumento`
// non lo copre, perché il suo mestiere è togliere il markup, non aggiungerne al posto giusto.
import { describe, expect, it } from 'vitest';
import { convertiMarkdownInHtml, markdownInTestoPiano, titoloDelMarkdown } from './markdownHtml.js';

describe('convertiMarkdownInHtml — il testo non diventa mai markup', () => {
  it('escala i caratteri attivi invece di lasciarli passare', () => {
    // `sanitizzaHtmlDocumento` lascia il testo fuori dai tag **com'è**: se l'escaping non lo fa
    // questo file, non lo fa nessuno.
    const html = convertiMarkdownInHtml('Un <script>alert(1)</script> nel testo & nel resto.');
    expect(html).toBe('<p>Un &lt;script&gt;alert(1)&lt;/script&gt; nel testo &amp; nel resto.</p>');
  });

  it('escala anche dentro il codice inline e nel blocco di codice', () => {
    // Il contenuto di un blocco è verbatim: è proprio il posto dove si scrive `<div>` parlando di
    // HTML, quindi è il posto dove un convertitore sbaglia più spesso.
    const inlineCode = convertiMarkdownInHtml('Il tag `<div onclick="x">` qui.');
    expect(inlineCode).toContain('<code>&lt;div onclick=&quot;x&quot;&gt;</code>');

    const blocco = convertiMarkdownInHtml('```html\n<b>grassetto</b> & <i>corsivo</i>\n```');
    expect(blocco).toBe('<pre><code class="language-html">&lt;b&gt;grassetto&lt;/b&gt; &amp; &lt;i&gt;corsivo&lt;/i&gt;</code></pre>');
  });

  it('un linguaggio con caratteri fuori posto non apre un blocco, e non può uscire dall’attributo', () => {
    // Il caso vero è il secondo: `RE_FENCE` restringe il linguaggio a `[a-zA-Z0-9_+-]`, quindi le
    // virgolette non ci passano. Questo test tiene ferma la restrizione, perché è il genere di cosa
    // che si allarga per distrazione — e l'attributo è l'unico posto di questo file dove il testo
    // di una scheda finisce dentro il markup invece che dentro il testo.
    const html = convertiMarkdownInHtml('```x" onload="alert(1)\nciao\n```');
    // Nessun **tag** porta quell'attributo: le virgolette sono diventate `&quot;` e sono rimaste
    // testo. (`[^>]*` non attraversa un `>`, quindi il confronto non può essere soddisfatto dal
    // testo che *segue* un tag vero.)
    expect(html).not.toMatch(/<\w+[^>]*onload/);
    expect(html).toContain('&quot;');
  });
});

describe('convertiMarkdownInHtml — i costrutti che le schede usano', () => {
  it('unisce i righi di un paragrafo con uno spazio, non con un a capo', () => {
    // Le schede sono scritte a capo a ~100 colonne. Se i righi diventassero `<br>` la guida
    // sarebbe una pagina a scaletta: è il difetto che si vede subito e non si capisce da dove viene.
    const html = convertiMarkdownInHtml('Prima parte del discorso\nche continua sul rigo dopo.\n\nAltro paragrafo.');
    expect(html).toBe('<p>Prima parte del discorso che continua sul rigo dopo.</p>\n<p>Altro paragrafo.</p>');
  });

  it('rende grassetto, corsivo e codice', () => {
    const html = convertiMarkdownInHtml('**forte** e *piano* con `codice` in mezzo.');
    expect(html).toBe('<p><strong>forte</strong> e <em>piano</em> con <code>codice</code> in mezzo.</p>');
  });

  it('rende il corsivo dentro il grassetto', () => {
    // Forma vera, da `01-progetti-motore-stato.md`: «**Un passaggio di tipo *Documento* nasce senza
    // documento**». Con un grassetto che non ammette asterischi dentro, il `**` non trovava la
    // chiusura e i quattro asterischi finivano **a vista** nella scheda: il difetto peggiore, perché
    // la frase resta leggibile e sembra solo scritta male.
    const html = convertiMarkdownInHtml('**Un passaggio di tipo *Documento* nasce senza documento**: qui.');
    expect(html).toBe('<p><strong>Un passaggio di tipo <em>Documento</em> nasce senza documento</strong>: qui.</p>');
  });

  it('due grassetti sulla stessa riga si chiudono ognuno al suo posto', () => {
    // Il motivo del `?` pigro: senza, `.+` arriverebbe all'ultimo `**` della riga e il primo
    // grassetto si mangerebbe tutto quello in mezzo.
    expect(convertiMarkdownInHtml('**A** e **B**'))
      .toBe('<p><strong>A</strong> e <strong>B</strong></p>');
  });

  it('nel testo piano la formattazione sparisce anche quando è annidata', () => {
    // L'estratto della ricerca esce da qui: se restasse `**…*…*…**` mostrerebbe la sintassi che
    // l'aiuto in-app esiste per non far vedere.
    expect(markdownInTestoPiano('**Un tipo *Documento* qui** e `codice`.')).toBe('Un tipo Documento qui e codice.');
  });

  it('nel testo piano il contenuto del codice resta com’è', () => {
    // Dentro un `code` la sintassi **è** il contenuto: toglierla falserebbe quello che c'è scritto.
    expect(markdownInTestoPiano('Il comando `rm -rf *` qui.')).toBe('Il comando rm -rf * qui.');
  });

  it('non scambia per corsivo gli identificatori con trattino basso', () => {
    // `moduliConcessi` e `moduliDisattivati` sono colonne del database e compaiono in chiaro nelle
    // schede: un `_` trattato come enfasi le spezzerebbe a metà, restando leggibile — cioè
    // sbagliato senza sembrarlo. Per questo il corsivo è solo `*`.
    const html = convertiMarkdownInHtml('Le colonne moduliConcessi e moduli_disattivati del tenant.');
    expect(html).toContain('moduliConcessi');
    expect(html).toContain('moduli_disattivati');
    expect(html).not.toContain('<em>');
  });

  it('rende i titoli al livello giusto', () => {
    expect(convertiMarkdownInHtml('# Uno\n\n### Tre')).toBe('<h1>Uno</h1>\n<h3>Tre</h3>');
  });

  it('rende una tabella con il codice dentro le celle', () => {
    // La tabella dell'indice in `README.md` ha i nomi dei file fra backtick dentro le celle: se le
    // celle non passassero dal rendering inline, l'indice mostrerebbe i backtick.
    const html = convertiMarkdownInHtml([
      '| # | File | Stato |',
      '|---|------|-------|',
      '| 05 | `05-fatture-sdi.md` | pronto |',
      '| 16 | `16-impostazioni.md` | pronto |',
    ].join('\n'));
    // Le asserzioni sono sui pezzi e non sulla forma compatta: il rendering scrive un `<th>`/`<td>`
    // per riga (è il modo in cui questo file resta leggibile), e fissare gli a capo nel test
    // significherebbe romperlo alla prima rifinitura dell'indentazione.
    expect(html).toContain('<table><thead><tr>');
    expect(html).toContain('<th>#</th>');
    expect(html).toContain('<th>File</th>');
    expect(html).toContain('</tr></thead><tbody>');
    expect(html).toContain('<td><code>05-fatture-sdi.md</code></td>');
    expect(html).toContain('<td>16</td>');
    expect(html).toContain('</tbody></table>');
    expect(html).not.toContain('|');
  });

  it('una riga con i `|` ma senza separatore sotto non è una tabella', () => {
    const html = convertiMarkdownInHtml('| non | è | una | tabella |');
    expect(html).not.toContain('<table>');
  });

  it('annida i sotto-elenchi dentro l’elemento genitore', () => {
    // Questa è la forma che `15-comunicazioni.md` usa per davvero. Un `<ul>` chiuso prima del
    // tempo non è un difetto estetico: il sotto-elenco diventa un fratello invece di un figlio, e
    // la gerarchia — che è il contenuto — sparisce.
    const html = convertiMarkdownInHtml([
      '- Primo punto',
      '  - Sotto-punto',
      '  - Altro sotto-punto',
      '- Secondo punto',
    ].join('\n'));
    expect(html).toBe('<ul><li>Primo punto<ul><li>Sotto-punto</li><li>Altro sotto-punto</li></ul></li><li>Secondo punto</li></ul>');
  });

  it('attribuisce al punto precedente i righi rientrati senza trattino', () => {
    // Il «lazy continuation»: in `15-comunicazioni.md` mezzo elenco è scritto così. Senza, ogni
    // continuazione diventerebbe un paragrafo staccato fuori dall'elenco.
    const html = convertiMarkdownInHtml([
      '- **Un punto**: comincia qui',
      '  e continua sul rigo dopo,',
      '  sempre dentro lo stesso punto.',
      '- Il punto dopo.',
    ].join('\n'));
    expect(html).toBe('<ul><li><strong>Un punto</strong>: comincia qui e continua sul rigo dopo, sempre dentro lo stesso punto.</li><li>Il punto dopo.</li></ul>');
  });

  it('rende un elenco numerato, e lo distingue dal puntato', () => {
    expect(convertiMarkdownInHtml('1. Primo\n2. Secondo'))
      .toBe('<ol><li>Primo</li><li>Secondo</li></ol>');
  });

  it('rende la citazione', () => {
    // Solo il `README.md` ne ha, e il README non entra nella guida in-app: il costrutto resta
    // perché è contenuto vero del repo, e la conversione lo incontra nei test sui file reali.
    const html = convertiMarkdownInHtml('> Documentazione funzionale dell’applicazione,\n> una scheda per sezione.');
    expect(html).toBe('<blockquote><p>Documentazione funzionale dell’applicazione, una scheda per sezione.</p></blockquote>');
  });

  it('un blocco di codice mai chiuso non fa sparire il resto della scheda', () => {
    const html = convertiMarkdownInHtml('Prima.\n\n```\ncodice senza chiusura');
    expect(html).toContain('<p>Prima.</p>');
    expect(html).toContain('<pre><code>codice senza chiusura</code></pre>');
  });

  it('un glob con gli asterischi non diventa corsivo', () => {
    // Il caso vero, trovato convertendo le schede: `src/**/*.ts` ha tre asterischi, e una regola
    // d'apertura larga ne legge uno che apre e uno che chiude **intorno alla barra**, producendo
    // `src/*<em>/</em>.ts`. Resta leggibile e dice un'altra cosa: è il difetto peggiore, perché non
    // si vede. Il confronto è sull'intera stringa, non su `not.toContain('<em>')`: un domani la
    // regressione potrebbe essere un `<strong>` o un'omissione, e il test deve prenderle tutte.
    expect(convertiMarkdownInHtml('Un glob tipo src/**/*.ts nel testo.'))
      .toBe('<p>Un glob tipo src/**/*.ts nel testo.</p>');
  });

  it('rende la riga di separazione, e non la scambia per un elenco', () => {
    // Nessuna scheda ha oggi un `---`, quindi questa è una via che nessun file vero esercita: sta
    // qui perché il costrutto è nel modello del manuale, e una forma che il convertitore non
    // conosce non fallisce — esce come tre trattini in mezzo al testo, che nessuno segnala.
    const html = convertiMarkdownInHtml('Prima.\n\n---\n\nDopo.');
    expect(html).toBe('<p>Prima.</p>\n<hr>\n<p>Dopo.</p>');
  });

  it('due trattini in mezzo a una riga non sono una separazione', () => {
    // La soglia è a tre proprio per questo: `10--20` e `--flag` sono testo, e con due trattini
    // bastavano a spezzare il paragrafo in due. L'apostrofo esce come `&#39;` — è `escapeHtmlTesto`,
    // e il confronto lo tiene fermo: se un giorno l'escaping sparisse, questo test lo direbbe.
    const html = convertiMarkdownInHtml("L'intervallo 10--20 e l'opzione --verbose.");
    expect(html).toBe('<p>L&#39;intervallo 10--20 e l&#39;opzione --verbose.</p>');
  });

  it('la separazione non finisce nell’estratto della ricerca', () => {
    expect(markdownInTestoPiano('Prima.\n\n---\n\nDopo.')).toBe('Prima.\nDopo.');
  });
});

describe('titoloDelMarkdown', () => {
  it('prende il primo titolo di primo livello', () => {
    expect(titoloDelMarkdown('# 05 · Fatture / Note di Credito & SDI\n\n## 👤 Cosa fa')).toBe('05 · Fatture / Note di Credito & SDI');
  });

  it('salta i titoli che stanno dentro un blocco di codice', () => {
    // `README.md` contiene `# NN · <Nome sezione>` dentro il fence del modello di scheda: senza
    // questo salto il titolo della scheda sarebbe il segnaposto del modello.
    const md = '# Manuale BluMan\n\n```markdown\n# NN · <Nome sezione>\n```\n';
    expect(titoloDelMarkdown(md)).toBe('Manuale BluMan');
  });

  it('senza titolo restituisce null invece di inventarne uno', () => {
    expect(titoloDelMarkdown('## Solo un sottotitolo\n\ntesto')).toBeNull();
  });
});
