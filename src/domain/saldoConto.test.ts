import { describe, it, expect } from 'vitest';
import { deltaSaldoCentesimi, saldoContoCentesimi } from './saldoConto.js';

// Il saldo è la definizione di una regola contabile, quindi si prova come una regola: sui casi che
// si incontrano davvero (un conto con un saldo iniziale, entrate, uscite) e su quello che il codice
// sbagliava — il segno. Un conto che parte da zero e incassa 1.000 € non ha saldo −1.000 €.

describe('deltaSaldoCentesimi — il segno lo dà il tipo, non l\'importo', () => {
  it('entrata somma, uscita sottrae', () => {
    expect(deltaSaldoCentesimi('entrata', 100000)).toBe(100000);
    expect(deltaSaldoCentesimi('uscita', 100000)).toBe(-100000);
  });

  it('l\'importo è un modulo: un importo negativo non ribalta il segno del tipo', () => {
    // In Prima Nota l'importo è sempre positivo (l'import CSV normalizza con `Math.abs`, lo schema
    // chiede un importo maggiore di zero). Se una riga negativa entrasse comunque, il saldo deve
    // sbagliare in modo **visibile** — non restituire per caso il risultato giusto.
    expect(deltaSaldoCentesimi('uscita', -100000)).toBe(100000);
  });
});

describe('saldoContoCentesimi — il saldo è saldo iniziale più movimenti', () => {
  it('senza movimenti il saldo è quello iniziale', () => {
    expect(saldoContoCentesimi(250000, [])).toBe(250000);
  });

  it('somma le entrate e sottrae le uscite', () => {
    const saldo = saldoContoCentesimi(100000, [
      { tipo: 'entrata', importoCentesimi: 122000 },
      { tipo: 'entrata', importoCentesimi: 50000 },
      { tipo: 'uscita', importoCentesimi: 22000 },
    ]);
    expect(saldo).toBe(250000);
  });

  it('un conto senza saldo iniziale può andare in negativo: è un fatto, non un errore', () => {
    // Uno scoperto di conto esiste, e arrotondarlo a zero sarebbe la solita bugia comoda.
    expect(saldoContoCentesimi(0, [{ tipo: 'uscita', importoCentesimi: 15000 }])).toBe(-15000);
  });

  it('l\'ordine dei movimenti non conta (il saldo è una somma, non un estratto conto)', () => {
    const movimenti = [
      { tipo: 'entrata' as const, importoCentesimi: 30000 },
      { tipo: 'uscita' as const, importoCentesimi: 10000 },
      { tipo: 'entrata' as const, importoCentesimi: 5000 },
    ];
    expect(saldoContoCentesimi(0, movimenti)).toBe(saldoContoCentesimi(0, [...movimenti].reverse()));
  });

  it('un rimborso storna esattamente l\'incasso che l\'ha preceduto', () => {
    // È il caso della Nota di Credito totale, il percorso che non toccava il saldo: se il rimborso
    // non arrivasse fra i movimenti del conto, questo conto direbbe di avere denaro che è uscito.
    const dopoIncasso = saldoContoCentesimi(0, [{ tipo: 'entrata', importoCentesimi: 122000 }]);
    const dopoRimborso = saldoContoCentesimi(0, [
      { tipo: 'entrata', importoCentesimi: 122000 },
      { tipo: 'uscita', importoCentesimi: 122000 },
    ]);
    expect(dopoIncasso).toBe(122000);
    expect(dopoRimborso).toBe(0);
  });
});
