import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { describe, expect, it } from 'vitest';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const codice = (relativo: string) => fs.readFileSync(path.join(root, relativo), 'utf8').replace(/\/\/.*$/gm, '');

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
});
