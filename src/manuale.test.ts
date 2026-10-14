import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import {
  SCHEDE_RISERVATE,
  contenutoPerRuolo,
  htmlScheda,
  indiceManuale,
} from './domain/manuale.js';
import { convertiMarkdownInHtml } from './util/markdownHtml.js';

/**
 * Il manuale dentro l'app: lettura, filtro per ruolo, e la catena convertitore → sanitizzatore.
 *
 * Il grosso di questi test non prova una funzione su una stringa inventata: prova **i file veri** di
 * `docs/manuale/` (lo stesso metodo di `src/infrastrutturaDeploy.test.ts` e `src/credenziali.test.ts`).
 * È la sola difesa che copre la scheda numero venti, scritta fra sei mesi da qualcuno che non ha
 * letto `markdownHtml.ts` e usa un costrutto che il convertitore non conosce. Un convertitore che
 * non capisce una riga non lancia: la lascia passare come testo, o la mangia. Qui si vede.
 */

const RADICE = path.resolve(import.meta.dirname, '..');
const CARTELLA_MANUALE = path.join(RADICE, 'docs', 'manuale');

/** I file del manuale come stanno su disco adesso. */
const FILE_MANUALE = readdirSync(CARTELLA_MANUALE).filter(n => n.endsWith('.md')).sort();

/** Le schede: i file `NN-nome.md`. Il `README.md` è l'indice degli sviluppatori, non una scheda. */
const SCHEDE = FILE_MANUALE.filter(n => /^\d{2}-[a-z0-9-]+\.md$/.test(n));

/** Il testo di una scheda senza i blocchi di codice: la sintassi lì dentro è contenuto, non markdown. */
function senzaCodice(html: string): string {
  return html.replace(/<pre>[\s\S]*?<\/pre>/g, '').replace(/<code>[\s\S]*?<\/code>/g, '');
}

describe('📖 il manuale — i file veri si convertono tutti', () => {
  it('trova le 19 schede e il README', () => {
    // Se questo numero cambia, è cambiato il manuale: il test è il posto dove accorgersene.
    expect(SCHEDE).toHaveLength(19);
    expect(FILE_MANUALE).toContain('README.md');
  });

  it('ogni scheda ha un titolo, e nessun titolo è quello del modello di scheda', () => {
    for (const nome of FILE_MANUALE) {
      const html = convertiMarkdownInHtml(readFileSync(path.join(CARTELLA_MANUALE, nome), 'utf8'));
      // `titoloDelMarkdown` salta i blocchi di codice proprio per il README, che contiene
      // `# NN · <Nome sezione>` dentro il fence del modello: senza il salto, il titolo sarebbe il
      // segnaposto.
      expect(html, nome).toMatch(/<h1>[^<]+<\/h1>/);
      expect(html, nome).not.toContain('<h1>NN ·');
    }
  });

  it('nessuna scheda esce con la sintassi a vista', () => {
    // È la verifica che conta per chi legge: un `**` o un `|` che arriva sullo schermo non è un
    // dettaglio estetico, è il manuale che sembra scritto da una macchina.
    for (const nome of FILE_MANUALE) {
      const html = senzaCodice(
        convertiMarkdownInHtml(readFileSync(path.join(CARTELLA_MANUALE, nome), 'utf8')),
      );
      expect(html, nome).not.toContain('**');
      expect(html, nome).not.toContain('```');
      expect(html, nome).not.toContain('](');
      // Nessun rigo comincia per `#` (sarebbe un titolo non riconosciuto) o per `|` (una tabella
      // non riconosciuta): sono i due costrutti che degradano in silenzio, restando leggibili.
      for (const riga of html.split('\n')) {
        expect(riga.trimStart().startsWith('#'), `${nome} → ${riga}`).toBe(false);
        expect(riga.trimStart().startsWith('|'), `${nome} → ${riga}`).toBe(false);
      }
    }
  });

  it('ogni scheda finisce con la sua nota tecnica, che è l’ultima sezione di tutte', () => {
    // Il taglio per ruolo presuppone che `## 🔧 Nota tecnica` sia in fondo: se un domani qualcuno
    // scrivesse una sezione **dopo** la nota tecnica, quella sezione sparirebbe dai collaboratori
    // senza che nessuno lo decida. Qui si scopre subito.
    for (const nome of SCHEDE) {
      const markdown = readFileSync(path.join(CARTELLA_MANUALE, nome), 'utf8');
      const indice = markdown.search(/^##\s+🔧/m);
      expect(indice, nome).toBeGreaterThan(-1);
      const dopo = markdown.slice(indice);
      expect(dopo.match(/^##\s/gm), nome).toHaveLength(1);
    }
  });

  it('il README non è una scheda e non entra nell’indice dell’app', async () => {
    // Le sue ultime sezioni («Il modello di scheda», «Fonti») parlano a chi scrive il manuale.
    const indice = await indiceManuale('super_admin');
    expect(indice.schede.map(s => s.slug)).not.toContain('README');
  });
});

describe('🔒 le schede riservate', () => {
  it('ogni slug riservato esiste davvero', () => {
    // Il presidio che rende l'elenco una lista e non un'ipotesi: se `19-infra-deploy.md` viene
    // rinominato, la §19 smetterebbe di essere riservata **in silenzio** (nessun file, nessun
    // filtro) e finirebbe nell'indice di tutti. Così invece il test cade e si vede.
    for (const slug of SCHEDE_RISERVATE) {
      expect(SCHEDE, slug).toContain(`${slug}.md`);
    }
  });

  it('la §19 non è deducibile da un titolo: comincia con la parte utente', () => {
    // Il motivo per cui `SCHEDE_RISERVATE` è un elenco esplicito e non «i file con un 🔧».
    const markdown = readFileSync(path.join(CARTELLA_MANUALE, '19-infra-deploy.md'), 'utf8');
    expect(markdown).toContain('## 👤 Cosa fa e come si usa');
  });

  it('a un collaboratore la scheda riservata non si apre, e non si legge', async () => {
    const esito = await htmlScheda('19-infra-deploy', 'advisor');
    expect(esito.esito).toBe('riservata');
    expect(JSON.stringify(esito)).not.toContain('<h1>');
  });

  it('al super admin sì', async () => {
    const esito = await htmlScheda('19-infra-deploy', 'super_admin');
    expect(esito.esito).toBe('ok');
    if (esito.esito !== 'ok') return;
    expect(esito.scheda.riservata).toBe(true);
    expect(esito.html).toContain('<h1>');
  });

  it('un ruolo sconosciuto è trattato come collaboratore, non come super admin', async () => {
    // Il confronto è `ruolo !== 'super_admin'`, quindi `undefined`, `''` e `'admin'` sono tutti
    // «no». Il verso giusto dell'errore: nel dubbio non si mostra.
    expect((await htmlScheda('19-infra-deploy', '')).esito).toBe('riservata');
    expect((await htmlScheda('19-infra-deploy', undefined as unknown as string)).esito).toBe('riservata');
  });
});

describe('✂️ il filtro per ruolo', () => {
  it('toglie la nota tecnica a chi non è super admin, e solo quella', () => {
    const markdown = readFileSync(path.join(CARTELLA_MANUALE, '05-fatture-sdi.md'), 'utf8');
    const collaboratore = contenutoPerRuolo(markdown, false, 'advisor');
    expect(collaboratore).not.toBeNull();
    expect(collaboratore).not.toContain('contabilitaRegistro.ts');
    expect(collaboratore).not.toContain('🔧');
    // La parte utente resta **intera**: un filtro che taglia troppo è un filtro che toglie l'aiuto.
    expect(collaboratore).toContain('## 👤 Cosa fa e come si usa');
    expect(collaboratore).toContain('## 🔗 Collegamenti');
    expect(collaboratore).toContain('## ⚠️ Stati limite & errori');

    // E al super admin la stessa scheda arriva intera.
    expect(contenutoPerRuolo(markdown, false, 'super_admin')).toBe(markdown);
  });

  it('la ricerca di un collaboratore non indicizza la parte che non vedrà', async () => {
    // È la trappola silenziosa: se il `testo` dell'indice uscisse dal file grezzo, un collaboratore
    // troverebbe `contabilitaRegistro.ts`, sceglierebbe la scheda, e non ci sarebbe. Un risultato
    // che porta a un vicolo cieco senza dirlo — cioè la cosa che questo progetto vieta.
    const collaboratore = await indiceManuale('advisor');
    const superAdmin = await indiceManuale('super_admin');
    const testoDi = (i: typeof collaboratore, slug: string) =>
      i.schede.find(s => s.slug === slug)?.testo ?? '';

    expect(testoDi(collaboratore, '05-fatture-sdi')).not.toContain('contabilitaRegistro.ts');
    expect(testoDi(superAdmin, '05-fatture-sdi')).toContain('contabilitaRegistro.ts');
  });

  it('il collaboratore non vede la scheda riservata, il super admin sì — e sono 18 contro 19', async () => {
    const collaboratore = await indiceManuale('advisor');
    const superAdmin = await indiceManuale('super_admin');
    expect(superAdmin.schede).toHaveLength(19);
    expect(collaboratore.schede).toHaveLength(18);
    expect(collaboratore.schede.map(s => s.slug)).not.toContain('19-infra-deploy');
  });

  it('nessun testo indicizzato contiene la sintassi del markdown', async () => {
    // Il `testo` è quello che la pagina mostra come estratto della ricerca: se portasse i `**` e i
    // `|` del sorgente, l'aiuto in-app mostrerebbe proprio la sintassi che esiste per non farsi
    // vedere. Il taglio per ruolo passa dagli stessi blocchi della conversione HTML.
    const indice = await indiceManuale('super_admin');
    for (const scheda of indice.schede) {
      expect(scheda.testo, scheda.slug).not.toContain('**');
      expect(scheda.testo, scheda.slug).not.toContain('```');
      for (const riga of scheda.testo.split('\n')) {
        expect(riga.startsWith('|'), `${scheda.slug} → ${riga}`).toBe(false);
        expect(riga.startsWith('#'), `${scheda.slug} → ${riga}`).toBe(false);
      }
    }
  });
});

describe('🧭 l’indice', () => {
  it('è in ordine di lettura, e il numero viene dallo slug', async () => {
    const indice = await indiceManuale('super_admin');
    expect(indice.letto).toBe(true);
    const numeri = indice.schede.map(s => s.numero);
    expect(numeri).toEqual([...numeri].sort());
    expect(numeri[0]).toBe('01');
    expect(numeri[numeri.length - 1]).toBe('19');
    // Il titolo viene dal primo `#` del file, non da una tabella scritta a mano: l'indice non è una
    // seconda copia del manuale, e non deve poter divergere da quello che le schede dicono.
    expect(indice.schede[4]?.titolo).toBe('05 · Fatture / Note di Credito & SDI');
  });

  it('un titolo vuoto non diventa un titolo inventato', () => {
    // Il ripiego è lo slug: nel dubbio si mostra il nome del file, che è vero, invece di una
    // descrizione plausibile che nessuno ha scritto.
    expect(convertiMarkdownInHtml('# 05 · Fatture')).toContain('<h1>05 · Fatture</h1>');
  });
});

describe('🚫 lo slug non arriva mai al filesystem così com’è', () => {
  const OSTILI = [
    '../../.env',
    '..%2F..%2F.env',
    '..',
    // Il caso che conta più di tutti: **quasi** giusto. Una regex scritta di fretta, o un
    // `replace('.md', '')` buttato lì, lo lascerebbe passare e leggerebbe il file giusto — quindi
    // non se ne accorgerebbe nessuno.
    '05-fatture-sdi.md',
    '',
    'README',
    '/etc/passwd',
    '05-Fatture',
    '..\\..\\.env',
  ];

  it('rifiuta gli slug malformati con «assente»', async () => {
    // La regex è l'unico cancello — non c'è un secondo controllo più avanti — quindi si prova da qui.
    for (const slug of OSTILI) {
      expect((await htmlScheda(slug, 'super_admin')).esito, slug).toBe('assente');
    }
    // E vale per entrambi i ruoli: il controllo sullo slug viene **prima** di quello sul ruolo,
    // quindi non esiste un ruolo che scavalchi il filesystem.
    for (const slug of OSTILI) {
      expect((await htmlScheda(slug, 'advisor')).esito, slug).toBe('assente');
    }
  });

  it('ma lo slug buono — quello senza `.md` — passa', async () => {
    // Il controllo che impedisce al test qui sopra di essere soddisfatto da una regex troppo stretta
    // che rifiuta tutto: `05-fatture-sdi` è nell'elenco degli ostili **con** l'estensione.
    expect((await htmlScheda('05-fatture-sdi', 'advisor')).esito).toBe('ok');
  });
});

describe('🛡️ convertitore e sanitizzatore sono entrambi in catena', () => {
  it('l’HTML di una scheda esce dal sanitizzatore, non solo dal convertitore', () => {
    // Un test di comportamento qui non può esistere: sull'output di `convertiMarkdownInHtml` il
    // sanitizzatore è un no-op — il convertitore emette solo tag che l'allowlist già ammette, ed è
    // giusto così. Ma un no-op che sparisce non si nota, e allora sparirebbe anche la rete che
    // copre il giorno in cui il convertitore comincia a emettere qualcosa di troppo. Quindi si
    // guarda il sorgente: è lo stesso presidio statico di `src/credenziali.test.ts`.
    const sorgente = readFileSync(path.join(RADICE, 'src', 'domain', 'manuale.ts'), 'utf8');
    expect(sorgente).toContain("import { sanitizzaHtmlDocumento }");
    expect(sorgente).toMatch(/sanitizzaHtmlDocumento\(\s*convertiMarkdownInHtml\(/);
  });

  it('una scheda ostile non produce né script né gestori di evento', () => {
    // La prima metà della catena, provata sul contenuto vero: il testo di una scheda non diventa
    // markup. (`markdownHtml.test.ts` lo prova sull'unità; qui si prova attraverso il taglio per
    // ruolo, che è la funzione che il dominio applica prima di convertire.)
    const ostile = [
      '# 99 · Prova',
      '',
      '## 👤 Cosa fa',
      'Un <script>alert(1)</script> e un <img src=x onerror="alert(2)"> nel testo.',
      '',
      '## 🔧 Nota tecnica',
      'Solo per il super admin.',
    ].join('\n');
    const perTutti = convertiMarkdownInHtml(contenutoPerRuolo(ostile, false, 'advisor') ?? '');
    expect(perTutti).not.toContain('<script>');
    // `[^>]*` non attraversa un `>`, quindi questo confronto non può essere soddisfatto dal testo
    // che *segue* un tag vero: se `onerror` sopravvivesse come attributo, il tag lo porterebbe.
    // (Cercare la parola `onerror` e basta non direbbe niente: nel testo escapato resta scritta,
    // ed è giusto che ci resti — è testo, non markup.)
    expect(perTutti).not.toMatch(/<\w+[^>]*onerror/);
    expect(perTutti).toContain('&lt;script&gt;');
    expect(perTutti).toContain('&lt;img src=x onerror=&quot;alert(2)&quot;&gt;');
    expect(perTutti).not.toContain('Nota tecnica');
  });
});
