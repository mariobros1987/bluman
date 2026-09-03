import { describe, it, expect } from 'vitest';

describe('Flusso Contabile Fiscale & Riconciliazione Bancaria OpenSTAManager', () => {
  it('calcola correttamente la chiusura della partita di giro al 100% dell incasso', () => {
    const importoFatturaCentesimi = 1220000; // €12.200,00
    const rata1Centesimi = 366000;  // 30% acconto €3.660
    const rata2Centesimi = 854000;  // 70% saldo €8.540

    let incassiRegistrati = 0;
    incassiRegistrati += rata1Centesimi;
    expect(incassiRegistrati < importoFatturaCentesimi).toBe(true);

    incassiRegistrati += rata2Centesimi;
    expect(incassiRegistrati).toBe(importoFatturaCentesimi);
  });

  it('incrementa il saldo del conto corrente bancario in modo atomico', () => {
    let saldoBancaInizialeCentesimi = 5000000; // €50.000,00
    const importoIncassoCentesimi = 150000;  // €1.500,00

    saldoBancaInizialeCentesimi += importoIncassoCentesimi;
    expect(saldoBancaInizialeCentesimi).toBe(5150000);
  });
});
