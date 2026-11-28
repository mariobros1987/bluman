// Titolare, 28/11/2026 — risposte 3 e 7: gli importi proposti in fattura vengono dal listino (o
// dal prezzo del modulo ripartito in proporzione al listino), e lo sconto del progetto si toglie
// in proporzione. Prima: prezzo del modulo diviso in parti uguali (7 × 1.643 = 11.501 ≠ 11.500).
import { describe, it, expect } from 'vitest';
import {
  conImportiProposti,
  senzaListino,
  notaScontoProgetto,
  importiVociModulo,
  prezziModuliScontati,
  ripartisciPerPesi,
  scontoApplicabile,
} from './domain/importiFatturabili.js';

const somma = (v: number[]) => v.reduce((a, b) => a + b, 0);

describe('ripartisciPerPesi — torna sempre al centesimo', () => {
  it('11.500 € in 7 parti uguali: la somma è 11.500, non 11.501', () => {
    const quote = ripartisciPerPesi(1_150_000, [1, 1, 1, 1, 1, 1, 1]);
    expect(somma(quote)).toBe(1_150_000);
    expect(Math.max(...quote) - Math.min(...quote)).toBeLessThanOrEqual(1);
  });

  it('i centesimi che avanzano vanno ai resti più alti, a parità al primo', () => {
    expect(ripartisciPerPesi(100, [1, 1, 1])).toEqual([34, 33, 33]);
    expect(ripartisciPerPesi(100, [2, 1])).toEqual([67, 33]);
  });

  it('pesi tutti a zero = parti uguali; nessun peso = niente', () => {
    expect(ripartisciPerPesi(90, [0, 0, 0])).toEqual([30, 30, 30]);
    expect(ripartisciPerPesi(90, [])).toEqual([]);
  });

  it('importi grandi non perdono centesimi', () => {
    const quote = ripartisciPerPesi(999_999_999_99, [333_333_333, 333_333_334, 1]);
    expect(somma(quote)).toBe(999_999_999_99);
  });
});

describe('importiVociModulo — listino, o prezzo del modulo in proporzione al listino', () => {
  it('prezzo del modulo uguale alla somma dei listini → ogni attività vale il suo listino', () => {
    expect(importiVociModulo(300_000, [100_000, 150_000, 50_000])).toEqual({
      importi: [100_000, 150_000, 50_000], criterio: 'listino',
    });
  });

  it('prezzo a pacchetto diverso → ripartito in proporzione al listino, e la somma è il prezzo', () => {
    const r = importiVociModulo(240_000, [100_000, 150_000, 50_000])!;
    expect(r.criterio).toBe('proporzionale_listino');
    expect(r.importi).toEqual([80_000, 120_000, 40_000]);
    expect(somma(importiVociModulo(1_150_000, [200_000, 300_000, 123_457])!.importi)).toBe(1_150_000);
  });

  it('nessun listino → parti uguali, dichiarate', () => {
    expect(importiVociModulo(100, [0, 0, 0])).toEqual({ importi: [34, 33, 33], criterio: 'parti_uguali' });
  });

  it('modulo senza prezzo o senza attività → niente da proporre', () => {
    expect(importiVociModulo(0, [100])).toBeNull();
    expect(importiVociModulo(1000, [])).toBeNull();
  });
});

describe('sconto del progetto', () => {
  it('non è mai negativo né più della somma dei moduli', () => {
    expect(scontoApplicabile(1000, -5)).toBe(0);
    expect(scontoApplicabile(1000, 400)).toBe(400);
    expect(scontoApplicabile(1000, 5000)).toBe(1000);
  });

  it('si toglie da ogni modulo in proporzione al suo prezzo, e il totale torna', () => {
    const netti = prezziModuliScontati([1_150_000, 500_000, 210_000], 186_000);
    expect(somma(netti)).toBe(1_860_000 - 186_000);
    expect(netti).toEqual([1_035_000, 450_000, 189_000]);
    expect(prezziModuliScontati([1000, 2000], 0)).toEqual([1000, 2000]);
  });
});

describe('notaScontoProgetto — lo sconto si dichiara in fattura', () => {
  it('dice lo sconto e il totale su cui è stato concordato', () => {
    const nota = notaScontoProgetto(1_860_000, 100_000)!;
    expect(nota).toMatch(/^Sconto concordato sul progetto: /);
    expect(nota.replace(/\s/g, ' ')).toContain('1.000,00 €');
    expect(nota.replace(/\s/g, ' ')).toContain('18.600,00 €');
  });

  it('senza sconto non scrive niente', () => {
    expect(notaScontoProgetto(1_860_000, 0)).toBeNull();
  });
});

describe('conImportiProposti — ciò che legge la pagina del progetto', () => {
  const progetto = {
    id: 'p-1',
    scontoCentesimi: 10_000,
    moduli: [
      { id: 'm-1', prezzo: 60_000, microvoci: [{ id: 'a', articolo: { prezzoDefault: 20_000 } }, { id: 'b', articolo: { prezzoDefault: 40_000 } }] },
      { id: 'm-2', prezzo: 40_000, microvoci: [] },
      { id: 'm-3', prezzo: 0, microvoci: [{ id: 'c', articolo: { prezzoDefault: 5_000 } }] },
    ],
  };

  it('ogni attività riceve il suo importo al netto dello sconto, e il totale è il valore del progetto', () => {
    const r: any = conImportiProposti(progetto);
    expect(r.sommaModuliCentesimi).toBe(100_000);
    expect(r.scontoApplicatoCentesimi).toBe(10_000);
    expect(r.moduli[0].prezzoNettoCentesimi).toBe(54_000);
    expect(r.moduli[0].criterioRipartizione).toBe('proporzionale_listino');
    expect(r.moduli[0].microvoci.map((m: any) => m.importoPropostoCentesimi)).toEqual([18_000, 36_000]);
    expect(r.moduli[1].prezzoNettoCentesimi).toBe(36_000);
    // Un modulo senza prezzo non propone importi: resta «importo mancante».
    expect(r.moduli[2].microvoci[0].importoPropostoCentesimi).toBeNull();
    expect(r.moduli[2].criterioRipartizione).toBeNull();
  });

  it('il listino dell’articolo serve al conto e non esce: né per lo studio né per il cliente', () => {
    expect((conImportiProposti(progetto) as any).moduli[0].microvoci[0].articolo).toBeUndefined();
    const perCliente: any = senzaListino(progetto);
    expect(perCliente.moduli[0].microvoci[0]).toEqual({ id: 'a' });
    expect(perCliente.moduli[0].microvoci[0].importoPropostoCentesimi).toBeUndefined();
  });

  it('non modifica il progetto ricevuto, e regge un progetto senza moduli', () => {
    conImportiProposti(progetto);
    expect((progetto.moduli[0]!.microvoci[0] as any).importoPropostoCentesimi).toBeUndefined();
    expect(conImportiProposti({ moduli: null }).sommaModuliCentesimi).toBe(0);
  });
});
