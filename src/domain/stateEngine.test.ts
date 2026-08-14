import { describe, it, expect } from 'vitest';
import {
  valutaSegnaleRischio,
  calcolaPercentualeMicrovoce,
  calcolaStatoModulo,
  calcolaPercentualeModulo,
  calcolaPercentualeProgetto,
  calcolaStatoProgetto,
  registraConsuntivazione,
  marcaRitardoManuale,
  risolviRitardoManuale,
  risolviDipendenze,
  type ModuloConDipendenze,
} from './stateEngine.js';
import type { MicrovoceInput } from './types.js';

function mv(overrides: Partial<MicrovoceInput> = {}): MicrovoceInput {
  return { id: 'mv1', stato: 'active', orePreventivate: 10, oreConsuntivate: 5, ...overrides };
}

// ── §16.1 ────────────────────────────────────────────────────────────────

describe('valutaSegnaleRischio (§16.1)', () => {
  it('si attiva solo se stato=active e ore consuntivate > preventivate', () => {
    expect(valutaSegnaleRischio(mv({ stato: 'active', orePreventivate: 10, oreConsuntivate: 12 })).segnaleRischio).toBe(true);
  });

  it('NON si attiva se le ore non sono sforate', () => {
    expect(valutaSegnaleRischio(mv({ stato: 'active', orePreventivate: 10, oreConsuntivate: 8 })).segnaleRischio).toBe(false);
  });

  it('NON si attiva su stato blocked anche con ore sforate — è uno stato manuale diverso (§7bis)', () => {
    const r = valutaSegnaleRischio(mv({ stato: 'blocked', orePreventivate: 10, oreConsuntivate: 15 }));
    expect(r.segnaleRischio).toBe(false);
    expect(r.oreExtra).toBe(5); // ore_extra si calcola comunque, è un dato indipendente dal flag
  });

  it('ore_extra è sempre >= 0, mai negativo', () => {
    expect(valutaSegnaleRischio(mv({ oreConsuntivate: 2, orePreventivate: 10 })).oreExtra).toBe(0);
  });
});

describe('calcolaPercentualeMicrovoce (§16.1)', () => {
  it('done → 100 sempre, anche con ore preventivate=0', () => {
    expect(calcolaPercentualeMicrovoce(mv({ stato: 'done', orePreventivate: 0, oreConsuntivate: 0 }))).toBe(100);
  });

  it('pending e attesa_dipendenza → 0', () => {
    expect(calcolaPercentualeMicrovoce(mv({ stato: 'pending' }))).toBe(0);
    expect(calcolaPercentualeMicrovoce(mv({ stato: 'attesa_dipendenza' }))).toBe(0);
  });

  it('active con ore sforate resta sotto 100 — non si marca "completata" da sola', () => {
    const pct = calcolaPercentualeMicrovoce(mv({ stato: 'active', orePreventivate: 10, oreConsuntivate: 50 }));
    expect(pct).toBe(99);
  });

  it('active con ore parziali calcola la percentuale reale', () => {
    expect(calcolaPercentualeMicrovoce(mv({ stato: 'active', orePreventivate: 10, oreConsuntivate: 4 }))).toBe(40);
  });
});

// ── §16.2 ────────────────────────────────────────────────────────────────

describe('calcolaStatoModulo (§16.2) — precedenza blocked > delayed > done > attesa_dipendenza > in_progress > pending', () => {
  it('blocked vince su tutto', () => {
    const stato = calcolaStatoModulo([{ stato: 'blocked' }, { stato: 'done' }, { stato: 'delayed' }]);
    expect(stato).toBe('blocked');
  });

  it('delayed vince su done ma non su blocked', () => {
    expect(calcolaStatoModulo([{ stato: 'delayed' }, { stato: 'done' }])).toBe('delayed');
  });

  it('tutte done → done', () => {
    expect(calcolaStatoModulo([{ stato: 'done' }, { stato: 'done' }])).toBe('done');
  });

  it('tutte attesa_dipendenza → attesa_dipendenza', () => {
    expect(calcolaStatoModulo([{ stato: 'attesa_dipendenza' }, { stato: 'attesa_dipendenza' }])).toBe('attesa_dipendenza');
  });

  it('mix pending/attesa_dipendenza (non tutte uguali) → pending, non attesa_dipendenza', () => {
    // regola esplicita: "tutte attesa_dipendenza" — un mix ricade nel default pending
    expect(calcolaStatoModulo([{ stato: 'pending' }, { stato: 'attesa_dipendenza' }])).toBe('pending');
  });

  it('almeno una active → in_progress', () => {
    expect(calcolaStatoModulo([{ stato: 'active' }, { stato: 'pending' }])).toBe('in_progress');
  });

  it('tutte pending → pending', () => {
    expect(calcolaStatoModulo([{ stato: 'pending' }, { stato: 'pending' }])).toBe('pending');
  });

  it('modulo senza micro-voci → pending (guardia contro array vuoto)', () => {
    expect(calcolaStatoModulo([])).toBe('pending');
  });

  it('non muta l\'array di input (§16.6 — sola lettura)', () => {
    const input = [{ stato: 'active' as const }];
    const copia = JSON.parse(JSON.stringify(input));
    calcolaStatoModulo(input);
    expect(input).toEqual(copia);
  });
});

describe('calcolaPercentualeModulo (§16.2) — media pesata, non semplice', () => {
  it('una micro-voce da 10h pesa più di una da 1h', () => {
    const microvoci = [
      mv({ orePreventivate: 10, oreConsuntivate: 10, stato: 'done' }), // 100%, peso 10
      mv({ orePreventivate: 1, oreConsuntivate: 0, stato: 'pending' }), // 0%, peso 1
    ];
    // media pesata attesa: (100*10 + 0*1) / 11 ≈ 90.9, ben lontana dalla media semplice 50
    expect(calcolaPercentualeModulo(microvoci)).toBeCloseTo(90.9, 1);
  });

  it('modulo senza ore preventivate non genera division by zero', () => {
    expect(calcolaPercentualeModulo([mv({ orePreventivate: 0, oreConsuntivate: 0 })])).toBe(0);
  });
});

// ── §16.3 ────────────────────────────────────────────────────────────────

describe('calcolaPercentualeProgetto e calcolaStatoProgetto (§16.3)', () => {
  it('media pesata sulle ore dei moduli', () => {
    const pct = calcolaPercentualeProgetto([
      { orePreventivate: 40, percentuale: 100 },
      { orePreventivate: 10, percentuale: 0 },
    ]);
    expect(pct).toBeCloseTo(80, 1);
  });

  it('tutti i moduli done → completed', () => {
    expect(calcolaStatoProgetto([{ stato: 'done' }, { stato: 'done' }])).toBe('completed');
  });

  it('anche un solo modulo non done → in_progress, mai pre_project', () => {
    expect(calcolaStatoProgetto([{ stato: 'done' }, { stato: 'pending' }])).toBe('in_progress');
  });

  it('nessun modulo ancora istanziato → in_progress (pre_project è gestito altrove, mai qui)', () => {
    expect(calcolaStatoProgetto([])).toBe('in_progress');
  });
});

// ── §16.4 ────────────────────────────────────────────────────────────────

describe('registraConsuntivazione (§16.4)', () => {
  it('somma le ore e ricalcola il segnale di rischio', () => {
    const r = registraConsuntivazione(mv({ orePreventivate: 10, oreConsuntivate: 8, stato: 'active' }), 5);
    expect(r.microvoce.oreConsuntivate).toBe(13);
    expect(r.microvoce.segnaleRischio).toBe(true);
    expect(r.microvoce.oreExtra).toBe(3);
  });

  it('segnala il passaggio da false a true, non solo lo stato finale', () => {
    const r1 = registraConsuntivazione(mv({ orePreventivate: 10, oreConsuntivate: 3, stato: 'active' }), 2);
    expect(r1.segnaleRischioAppenaAttivato).toBe(false); // 5/10, ancora sotto

    const r2 = registraConsuntivazione(mv({ orePreventivate: 10, oreConsuntivate: 9, stato: 'active' }), 5);
    expect(r2.segnaleRischioAppenaAttivato).toBe(true); // 14/10, appena sforato
  });

  it('rifiuta ore non positive', () => {
    expect(() => registraConsuntivazione(mv(), 0)).toThrow();
    expect(() => registraConsuntivazione(mv(), -1)).toThrow();
  });

  it('non muta l\'oggetto originale (pura)', () => {
    const originale = mv({ oreConsuntivate: 5 });
    registraConsuntivazione(originale, 3);
    expect(originale.oreConsuntivate).toBe(5);
  });
});

describe('marcaRitardoManuale (§16.4, §7bis)', () => {
  it('rifiuta causa_nota vuota', () => {
    expect(() => marcaRitardoManuale(mv(), 'blocked', '')).toThrow(/causaNota/);
    expect(() => marcaRitardoManuale(mv(), 'blocked', '   ')).toThrow(/causaNota/);
  });

  it('accetta e trascrive una causa valida', () => {
    const r = marcaRitardoManuale(mv(), 'blocked', 'KYC respinto dalla banca');
    expect(r.stato).toBe('blocked');
    expect(r.causaNota).toBe('KYC respinto dalla banca');
  });
});

describe('risolviRitardoManuale (§16.4)', () => {
  it('riporta la micro-voce ad active e azzera la causa', () => {
    const bloccata = { ...mv({ stato: 'blocked' }), causaNota: 'qualcosa' };
    const r = risolviRitardoManuale(bloccata);
    expect(r.stato).toBe('active');
    expect(r.causaNota).toBeNull();
  });
});

// ── §16.5 ────────────────────────────────────────────────────────────────

describe('risolviDipendenze (§16.5)', () => {
  const grafo: ModuloConDipendenze[] = [
    { id: 'M01', stato: 'done', dipendeDa: [] },
    { id: 'M02', stato: 'in_progress', dipendeDa: ['M01'] },
    { id: 'M03', stato: 'attesa_dipendenza', dipendeDa: ['M02'] },
    // M04 dipende da DUE moduli: si sblocca solo quando entrambi sono done
    { id: 'M04', stato: 'attesa_dipendenza', dipendeDa: ['M01', 'M02'] },
  ];

  it('sblocca solo i dipendenti diretti del modulo appena completato', () => {
    const sbloccati = risolviDipendenze(grafo, 'M01');
    expect(sbloccati).toEqual(['M02']); // M02 dipende solo da M01 → si sblocca
    // M04 dipende ANCHE da M02 (non ancora done) → non deve sbloccarsi
    expect(sbloccati).not.toContain('M04');
  });

  it('non sblocca un modulo con dipendenze multiple finché non sono TUTTE done', () => {
    // M02 non è 'done' nel grafo di base: completarlo ora
    const grafoConM02Done = grafo.map((m) => (m.id === 'M02' ? { ...m, stato: 'done' as const } : m));
    const sbloccati = risolviDipendenze(grafoConM02Done, 'M02');
    expect(sbloccati).toContain('M03'); // dipende solo da M02
    expect(sbloccati).toContain('M04'); // ora M01 E M02 sono entrambi done
  });

  it('è idempotente: chiamarla due volte con lo stesso input produce lo stesso risultato', () => {
    const r1 = risolviDipendenze(grafo, 'M01');
    const r2 = risolviDipendenze(grafo, 'M01');
    expect(r1).toEqual(r2);
  });

  it('non muta l\'array di input', () => {
    const copia = JSON.parse(JSON.stringify(grafo));
    risolviDipendenze(grafo, 'M01');
    expect(grafo).toEqual(copia);
  });

  it('nessun dipendente → array vuoto, non un errore', () => {
    expect(risolviDipendenze(grafo, 'M03')).toEqual([]);
  });
});
