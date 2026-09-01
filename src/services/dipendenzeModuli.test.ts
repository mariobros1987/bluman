// Test della verifica anti-ciclo del grafo delle dipendenze — §7ter.
//
// Funzione pura, nessun DB: il grafo è costruito a mano in ogni caso. La
// semantica degli archi è A→B = «A dipende da B»; il salvataggio reale è una
// sostituzione completa delle dipendenze del modulo editato.

import { describe, it, expect } from 'vitest';
import { trovaCicloDipendenze, type ArcoDipendenza } from './dipendenzeModuli.js';

// L'arco A→B: A dipende da B.
const arco = (a: string, b: string): ArcoDipendenza => ({
  moduloTemplateId: a,
  dipendeDaModuloTemplateId: b,
});

describe('trovaCicloDipendenze (§7ter)', () => {
  it('rifiuta il ciclo diretto: A dipende da B che dipende da A', () => {
    // B dipende già da A; assegnare ad A la dipendenza da B chiude A→B→A.
    const ciclo = trovaCicloDipendenze([arco('B', 'A')], 'A', ['B']);
    expect(ciclo).toEqual(['A', 'B', 'A']);
  });

  it('rifiuta l\'auto-dipendenza: A dipende da sé stesso', () => {
    const ciclo = trovaCicloDipendenze([], 'A', ['A']);
    expect(ciclo).toEqual(['A', 'A']);
  });

  it('rifiuta il ciclo lungo: la catena C→A→B→C', () => {
    // A dipende da B, B dipende da C; assegnare a C la dipendenza da A
    // chiude il cerchio a distanza.
    const ciclo = trovaCicloDipendenze([arco('A', 'B'), arco('B', 'C')], 'C', ['A']);
    expect(ciclo).toEqual(['C', 'A', 'B', 'C']);
  });

  it('consente la riparazione: svuotare le dipendenze di un modulo già in ciclo', () => {
    // Grafo corrotto (A↔B già presenti): togliere le dipendenze ad A deve
    // restare possibile — rifiutarlo renderebbe il danno irreparabile.
    const ciclo = trovaCicloDipendenze([arco('A', 'B'), arco('B', 'A')], 'A', []);
    expect(ciclo).toBeNull();
  });

  it('non attribuisce un ciclo pre-esistente che non coinvolge la modifica', () => {
    // B e C sono già in ciclo fra loro; la nuova dipendenza A→B non lo crea.
    const ciclo = trovaCicloDipendenze([arco('B', 'C'), arco('C', 'B')], 'A', ['B']);
    expect(ciclo).toBeNull();
  });

  it('consente la modifica quando nessun ciclo si chiude', () => {
    const archi = [arco('A', 'B'), arco('B', 'C'), arco('D', 'C')];
    expect(trovaCicloDipendenze(archi, 'A', ['C'])).toBeNull();
    expect(trovaCicloDipendenze(archi, 'D', ['B'])).toBeNull();
  });

  it('usa le nuove dipendenze al posto delle vecchie del modulo editato', () => {
    // A dipendeva da B (arco vecchio): la modifica lo sposta su C. L'arco
    // vecchio NON conta — altrimenti una semplice sostituzione verrebbe
    // rifiutata come se tenesse vivo il passato.
    const ciclo = trovaCicloDipendenze([arco('A', 'B'), arco('B', 'A')], 'A', ['C']);
    expect(ciclo).toBeNull();
  });
});
