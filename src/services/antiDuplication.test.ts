import { describe, it, expect } from 'vitest';

interface Microvoce {
  n: string;
  hE: number;
  hA: number;
  s: string;
  vn?: string;
}

interface Modulo {
  id: string | number;
  n: string;
  v: Microvoce[];
}

function processaAssegnazioneModuloConAntiDuplicazione(
  targetProjectMods: Modulo[],
  nuovoModuloRighe: Array<{ nome: string; oreEstimate: number }>
) {
  const existingNames = new Set<string>();
  const existingStatuses = new Map<string, string>();

  targetProjectMods.forEach(m => {
    (m.v || []).forEach(mv => {
      const clean = (mv.n || '').toLowerCase().trim();
      existingNames.add(clean);
      existingStatuses.set(clean, mv.s || 'pending');
    });
  });

  const microvociFinali = nuovoModuloRighe.map(r => {
    const clean = (r.nome || '').toLowerCase().trim();
    const isDup = existingNames.has(clean);
    const isDone = isDup && (existingStatuses.get(clean) === 'done' || existingStatuses.get(clean) === 'completed');

    if (isDone) {
      return {
        n: r.nome,
        hE: 0, // 0 ore per evitare doppio addebito
        hA: r.oreEstimate,
        s: 'done',
        vn: '✓ Già ultimato nel progetto precedente (Evitato doppione)',
      };
    }

    return {
      n: r.nome,
      hE: r.oreEstimate,
      hA: 0,
      s: 'pending',
    };
  });

  return microvociFinali;
}

describe('Engine Anti-Duplicazione & Controllo Articoli Lavorati', () => {
  const mockProjectMods: Modulo[] = [
    {
      id: 'm1',
      n: 'Analisi Patrimoniale Iniziale',
      v: [
        { n: 'Raccolta documentazione cliente', hE: 2, hA: 2, s: 'done' },
        { n: 'Analisi struttura patrimoniale', hE: 4, hA: 4, s: 'done' },
        { n: 'Verifica KYC ed UBO', hE: 3, hA: 3, s: 'done' },
      ],
    },
  ];

  const nuovoModuloInArrivo = [
    { nome: 'Raccolta documentazione cliente', oreEstimate: 2 }, // Doppione già ultimato!
    { nome: 'Verifica KYC ed UBO', oreEstimate: 3 },            // Doppione già ultimato!
    { nome: 'Redazione Deed of Trust', oreEstimate: 10 },        // Nuovo!
  ];

  it('deve identificare correttamente gli articoli duplicati e contrassegnarli a 0 ore stimate', () => {
    const risultato = processaAssegnazioneModuloConAntiDuplicazione(mockProjectMods, nuovoModuloInArrivo);

    expect(risultato).toHaveLength(3);

    const docClient = risultato.find(r => r.n === 'Raccolta documentazione cliente');
    const uboTask = risultato.find(r => r.n === 'Verifica KYC ed UBO');
    const trustTask = risultato.find(r => r.n === 'Redazione Deed of Trust');

    // Verifica doppione 1
    expect(docClient?.s).toBe('done');
    expect(docClient?.hE).toBe(0);
    expect(docClient?.vn).toContain('Evitato doppione');

    // Verifica doppione 2
    expect(uboTask?.s).toBe('done');
    expect(uboTask?.hE).toBe(0);

    // Verifica task nuovo
    expect(trustTask?.s).toBe('pending');
    expect(trustTask?.hE).toBe(10);
    expect(trustTask?.vn).toBeUndefined();
  });

  it('non deve alterare le ore stimate se il progetto cliente non ha doppioni', () => {
    const moduliInArrivoNuovi = [
      { nome: 'Apertura conto corrente Malta', oreEstimate: 4 },
      { nome: 'Istanza autorizzativa MFSA', oreEstimate: 8 },
    ];

    const risultato = processaAssegnazioneModuloConAntiDuplicazione(mockProjectMods, moduliInArrivoNuovi);

    expect(risultato).toHaveLength(2);
    expect(risultato.every(r => r.s === 'pending')).toBe(true);
    expect(risultato[0]?.hE).toBe(4);
    expect(risultato[1]?.hE).toBe(8);
  });
});
