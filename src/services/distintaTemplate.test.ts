// Le regole della distinta: una micro-voce per nome, una per unità di quantità, override che
// vincono sui default dell'articolo compreso lo zero, passaggi in ordine.
//
// Erano dentro l'istanziazione; ora le usano in due — l'istanziazione e il ripristino delle
// voci di un modulo vuoto. Un test qui presidia le due strade insieme, perché il rischio di
// una seconda copia era proprio che le due dicessero cose diverse.
import { describe, it, expect } from 'vitest';
import { microvociDaDistinta, risolviRigheDistinta, type RigaDistintaGrezza } from './distintaTemplate.js';

function riga(over: Partial<RigaDistintaGrezza> = {}): RigaDistintaGrezza {
  return {
    id: 'rd-1',
    articoloId: 'art-1',
    articoloVersione: 3,
    quantita: 1,
    ordine: 1,
    overrideOre: null,
    overridePrezzo: null,
    articolo: {
      nome: 'Atto costitutivo',
      oreDefault: 4,
      prezzoDefault: 50000,
      passaggiTemplate: [
        { titolo: 'Secondo', tipo: 'verifica', chi: 'operatore', ordine: 2, descrizione: null, campiFormJson: null },
        { titolo: 'Primo', tipo: 'documento', chi: 'cliente', ordine: 1, descrizione: 'Bozza', campiFormJson: null },
      ],
    },
    ...over,
  };
}

describe('risolviRigheDistinta', () => {
  it('applica gli override e ordina i passaggi per `ordine`', () => {
    const [r] = risolviRigheDistinta([riga({ overrideOre: 6, overridePrezzo: 70000 })]);
    expect(r!.oreEffettive).toBe(6);
    expect(r!.prezzoEffettivo).toBe(70000);
    expect(r!.passaggi.map((p) => p.titolo)).toEqual(['Primo', 'Secondo']);
  });

  it('lo zero è un override, non un\'assenza: «ore incluse: 0» resta 0', () => {
    const [r] = risolviRigheDistinta([riga({ overrideOre: 0, overridePrezzo: 0 })]);
    expect(r!.oreEffettive).toBe(0);
    expect(r!.prezzoEffettivo).toBe(0);
  });

  it('senza override usano i default dell\'articolo', () => {
    const [r] = risolviRigheDistinta([riga()]);
    expect(r!.oreEffettive).toBe(4);
    expect(r!.prezzoEffettivo).toBe(50000);
  });
});

describe('microvociDaDistinta', () => {
  it('una voce per unità di quantità, tutte dalla stessa riga di distinta', () => {
    const microvoci = microvociDaDistinta(risolviRigheDistinta([riga({ quantita: 3 })]));
    expect(microvoci).toHaveLength(3);
    expect(microvoci.every((m) => m.rigaDistintaId === 'rd-1')).toBe(true);
    expect(microvoci.every((m) => m.passaggi.length === 2)).toBe(true);
  });

  it('due righe con lo stesso nome non generano voci gemelle (seed duplicati)', () => {
    const righe = risolviRigheDistinta([
      riga({ id: 'rd-1' }),
      riga({ id: 'rd-2', articoloId: 'art-2' }), // stesso articolo.nome, id diverso
    ]);
    const microvoci = microvociDaDistinta(righe);
    expect(microvoci).toHaveLength(1);
    expect(microvoci[0]!.rigaDistintaId).toBe('rd-1');
  });

  it('il confronto dei nomi ignora maiuscole e spazi ai bordi', () => {
    const righe = risolviRigheDistinta([
      riga({ id: 'rd-1' }),
      riga({ id: 'rd-2', articolo: { ...riga().articolo, nome: '  ATTO COSTITUTIVO ' } }),
    ]);
    expect(microvociDaDistinta(righe)).toHaveLength(1);
  });

  it('le voci già presenti nel modulo non si ricreano (ripristino)', () => {
    const righe = risolviRigheDistinta([riga({ id: 'rd-1', quantita: 2 })]);
    const microvoci = microvociDaDistinta(righe, new Set(['atto costitutivo']));
    expect(microvoci).toHaveLength(0);
  });

  it('una distinta vuota non produce niente — e chi chiama lo dichiara', () => {
    expect(microvociDaDistinta([])).toEqual([]);
  });
});
