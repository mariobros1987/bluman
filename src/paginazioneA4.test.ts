/**
 * §38 — presidio della geometria A4 e dell'impaginazione.
 *
 * Com'era: i PDF prodotti dall'editor arrivavano fino al bordo del foglio. Non per un margine
 * sbagliato — 20 mm erano dichiarati e applicati come `padding` — ma perché il contenuto era un
 * unico blocco più alto della pagina e nessuno lo spezzava: `overflow` visibile, quindi il testo
 * continuava a essere disegnato dentro e oltre il margine inferiore.
 *
 * Qui si presidia la parte che si può presidiare senza un browser: che i millimetri diventino i
 * pixel giusti, che l'area utile scenda del piè di pagina invece di un numero deciso a mano, e che
 * la distribuzione dei blocchi non lasci mai una pagina più piena dell'area utile — la condizione
 * che, se violata, si vede come inchiostro sul margine.
 *
 * La misura delle altezze vive nel browser (`frontend/src/utils/pdfA4.ts`): lì il presidio è il
 * fatto che il numero magico non esista più, e lo controlla la parte finale di questo file.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { soloCodice } from './util/soloCodice.js';
import { A4_MM, A4_PX, altezzaUtile, impagina, mmInPx } from './util/paginaA4.js';

const RADICE = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const MISURATORE = 'frontend/src/utils/pdfA4.ts';
const GENERATORE = 'frontend/src/utils/pdfGenerator.ts';

const codiceMisuratore = soloCodice(readFileSync(join(RADICE, MISURATORE), 'utf8'));
const codiceGeneratore = soloCodice(readFileSync(join(RADICE, GENERATORE), 'utf8'));

describe('§38 — la geometria del foglio discende dai millimetri', () => {
  it('traduce i millimetri nei CSS pixel del layout', () => {
    expect(mmInPx(210)).toBe(794);
    expect(mmInPx(297)).toBe(1123);
    expect(mmInPx(20)).toBe(76);
  });

  it('l\'area stampabile è il foglio meno i due margini, non un numero a parte', () => {
    expect(A4_PX.larghezzaStampabile).toBe(A4_PX.larghezza - 2 * A4_PX.margine);
    expect(A4_PX.altezzaStampabile).toBe(A4_PX.altezza - 2 * A4_PX.margine);
    expect(A4_PX.larghezzaStampabile).toBe(642);
    expect(A4_PX.altezzaStampabile).toBe(971);
    // I 20 mm sono l'unico numero scritto: il resto si ricava.
    expect(A4_MM.margine).toBe(20);
  });

  it('il piè di pagina si sottrae all\'area utile', () => {
    expect(altezzaUtile(0)).toBe(A4_PX.altezzaStampabile);
    expect(altezzaUtile(40)).toBe(A4_PX.altezzaStampabile - 40);
    // Un piè di pagina più alto del foglio non produce un'area negativa.
    expect(altezzaUtile(5000)).toBe(0);
  });
});

describe('§38 — nessuna pagina più piena dell\'area utile', () => {
  it('riempie le pagine nell\'ordine ricevuto', () => {
    const pagine = impagina([{ altezza: 400 }, { altezza: 400 }, { altezza: 400 }], 900);
    expect(pagine.map(p => p.indici)).toEqual([[0, 1], [2]]);
    expect(pagine[0]?.altezza).toBe(800);
  });

  it('non lascia mai una pagina oltre il limite, su mille blocchi casuali', () => {
    // È l'invariante che il vecchio impaginatore violava: qui si controlla sulla distribuzione,
    // non su un caso scelto bene.
    const blocchi = Array.from({ length: 1000 }, (_, i) => ({ altezza: ((i * 37) % 220) + 12 }));
    const limite = altezzaUtile(42);
    for (const pagina of impagina(blocchi, limite)) {
      if (pagina.debordante) continue;
      expect(pagina.altezza).toBeLessThanOrEqual(limite);
    }
  });

  it('stampa ogni blocco una volta sola e nell\'ordine', () => {
    const blocchi = Array.from({ length: 50 }, (_, i) => ({ altezza: 100 + (i % 7) * 30 }));
    const ordine = impagina(blocchi, 500).flatMap(p => p.indici);
    expect(ordine).toEqual(blocchi.map((_, i) => i));
  });

  it('un blocco più alto della pagina sta da solo ed è dichiarato debordante', () => {
    const pagine = impagina([{ altezza: 100 }, { altezza: 3000 }, { altezza: 100 }], 900);
    expect(pagine.map(p => p.indici)).toEqual([[0], [1], [2]]);
    expect(pagine[1]?.debordante).toBe(true);
    expect(pagine[0]?.debordante).toBe(false);
    expect(pagine[2]?.debordante).toBe(false);
  });

  it('non apre un foglio bianco davanti a un primo blocco troppo alto', () => {
    const pagine = impagina([{ altezza: 3000 }], 900);
    expect(pagine).toHaveLength(1);
    expect(pagine[0]?.indici).toEqual([0]);
  });

  it('senza blocchi non produce pagine: il foglio bianco lo decide chi disegna', () => {
    expect(impagina([], 900)).toEqual([]);
  });
});

describe('§38 — il misuratore non torna a un\'altezza decisa a mano', () => {
  it('l\'area utile arriva da `altezzaUtile`, non da una costante', () => {
    expect(codiceMisuratore).toContain('altezzaUtile(');
    expect(codiceMisuratore).not.toMatch(/maxPageContentHeight/);
    // 900 era il numero magico: nessun letterale simile deve tornare come budget di pagina.
    expect(codiceMisuratore).not.toMatch(/=\s*9\d\d\s*;/);
    expect(codiceGeneratore).not.toMatch(/maxPageContentHeight/);
  });

  it('la geometria del foglio è quella condivisa, non una seconda copia', () => {
    expect(codiceMisuratore).toMatch(/from\s+'(\.\.\/)+src\/util\/paginaA4'/);
    expect(codiceMisuratore).not.toMatch(/A4_SPECS\s*=/);
    expect(codiceGeneratore).not.toMatch(/widthPx:\s*794/);
  });

  it('conta i margini verticali dei blocchi: `offsetHeight` da solo non li vede', () => {
    // Era l'altra metà del difetto: `offsetHeight` esclude i margini, e il CSS della pagina ne
    // mette fino a 26 px per blocco. Venti blocchi bastavano a sfondare il foglio.
    expect(codiceMisuratore).toContain('marginTop');
    expect(codiceMisuratore).toContain('marginBottom');
  });

  it('la pagina non lascia sconfinare il contenuto nel margine', () => {
    // Ultima difesa: se un blocco resta più alto della pagina, viene tagliato al margine invece
    // di essere disegnato fino al bordo del foglio.
    expect(codiceMisuratore).toMatch(/overflow\s*=\s*'hidden'/);
  });
});
