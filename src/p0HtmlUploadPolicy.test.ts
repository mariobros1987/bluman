import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { describe, expect, it } from 'vitest';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const codice = (relativo: string) => fs.readFileSync(path.join(root, relativo), 'utf8').replace(/\/\/.*$/gm, '');

/**
 * L'elenco **chiuso** dei file del frontend che possono consegnare HTML a `dangerouslySetInnerHTML`.
 *
 * È la difesa che il resto di questo file non copre: le prove qui sopra guardano *dentro* i sink che
 * conosciamo — che sanitizzino, che non incorporino iframe — ma nessuna si accorge di un sink
 * **nuovo**. Un `dangerouslySetInnerHTML` aggiunto in un componente qualunque è esattamente la forma
 * con cui l'XSS rientra dopo essere stato chiuso una volta: la riga sembra innocua perché il dato
 * «viene dal nostro database», e il nostro database contiene quello che ci ha scritto un cliente.
 *
 * Aggiungere un file a questo elenco è una decisione, e va presa qui: se il nuovo sink consegna
 * HTML che non è passato da `sanitizzaHtmlDocumento`, il posto giusto è prima del sink, non qui.
 * `AiutoPage.tsx` è nell'elenco per il motivo già scritto nella sua intestazione: l'HTML arriva dal
 * backend **già sanitizzato**, e il confine della fiducia è là.
 */
const SINK_HTML_AMMESSI = [
  'frontend/src/components/projectDetail/DocumentiTab.tsx',
  'frontend/src/components/portal/TabProposta.tsx',
  'frontend/src/pages/AiutoPage.tsx',
];

/** Il marcatore del sink vero, non la parola nei commenti: `={{` distingue l'uso dalla citazione. */
const SINK = 'dangerouslySetInnerHTML={{';

function tsxSotto(cartella: string, acc: string[] = []): string[] {
  let voci: string[];
  try {
    voci = fs.readdirSync(cartella);
  } catch {
    return acc; // cartella assente in alcuni checkout: non è un guasto di questo test
  }
  for (const voce of voci) {
    if (voce === 'node_modules' || voce === 'dist') continue;
    const percorso = path.join(cartella, voce);
    if (fs.statSync(percorso).isDirectory()) tsxSotto(percorso, acc);
    else if (/\.tsx?$/.test(voce)) acc.push(percorso);
  }
  return acc;
}

describe('policy P0 HTML e download', () => {
  it('sanitizza le tre scritture dei modelli e la generazione inline', () => {
    const modelli = codice('src/routes/modelliDocumento.ts');
    const documenti = codice('src/routes/documenti.ts');
    expect(modelli).toContain("import { sanitizzaHtmlDocumento }");
    expect(modelli.match(/sanitizzaHtmlDocumento\(/g)?.length).toBeGreaterThanOrEqual(3);
    expect(modelli).toContain('contenutoHtml: contenutoSanitizzato');
    expect(documenti).toContain('htmlTemplate = sanitizzaHtmlDocumento(htmlTemplate)');
    expect(documenti).toContain('sanitizzaHtmlDocumento(risolviTagDocumento(htmlTemplate, contesto))');
  });

  it('forza attachment e nosniff sulla route download locale', () => {
    const catalogo = codice('src/routes/catalogo.ts');
    expect(catalogo).toContain("reply.header('X-Content-Type-Options', 'nosniff')");
    expect(catalogo).toContain('`attachment; filename="${nomePulito}"`');
    expect(catalogo).not.toMatch(/isAnteprima|image\/svg\+xml|text\/html/);
  });

  it('applica la difesa frontend ai sink e non incorpora file in iframe', () => {
    const tab = codice('frontend/src/components/projectDetail/DocumentiTab.tsx');
    const editor = codice('frontend/src/pages/DocumentEditorPage.tsx');
    expect(tab).toContain('scomponiDocumento(sanitizzaHtmlDocumento(selectedPreviewDoc.contenutoHtml))');
    expect(tab).not.toContain('<iframe');
    expect(editor).toContain('const htmlSicuro = sanitizzaHtmlDocumento(htmlContent)');
    expect(editor).not.toContain('<iframe');
    expect(editor).not.toContain('readAsDataURL(file)');
  });

  it('i sink HTML del frontend sono esattamente quelli dichiarati', () => {
    const file = tsxSotto(path.join(root, 'frontend', 'src'));

    // La rete di sicurezza del test stesso: se la camminata si rompesse (una cartella rinominata,
    // un `include` di vitest cambiato) l'elenco tornerebbe vuoto e il confronto qui sotto
    // passerebbe... no, fallirebbe — ma con un messaggio che parla di sink invece che di cartella.
    // Questa riga dice subito quale delle due cose è andata storta.
    expect(file.length).toBeGreaterThan(20);

    const conSink = file
      // I commenti si tolgono **prima** di cercare: un commento che *nomina* il sink non è un sink,
      // e questo file è pieno di commenti che lo nominano.
      .filter((percorso) => fs.readFileSync(percorso, 'utf8').replace(/\/\/.*$/gm, '').includes(SINK))
      .map((percorso) => path.relative(root, percorso).split(path.sep).join('/'))
      .sort();

    // Ambedue i lati si ordinano: l'elenco qui sopra si legge nell'ordine che ha senso per chi lo
    // legge, e l'ordine non è mai il motivo per cui questo test fallisce.
    expect(conSink).toEqual([...SINK_HTML_AMMESSI].sort());
  });
});
