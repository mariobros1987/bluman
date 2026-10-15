import { describe, it, expect } from 'vitest';
import { calcolaLiquidazioneIvaPeriodo, determinaPeriodoFiscale } from './lipeEngine.js';

// Test aggiunti con l'audit 21/09/2026: prima il motore LIPE non esisteva in test ed
// escludeva le note di credito, sovrastimando l'IVA a debito su operazioni stornate.

const F = (imponibile: number, iva: number, extra: Partial<any> = {}) => ({
  totaleImponibileCentesimi: imponibile,
  totaleIvaCentesimi: iva,
  tipoDocumento: 'fattura',
  ...extra,
});
const NC = (imponibile: number, iva: number, extra: Partial<any> = {}) => ({
  totaleImponibileCentesimi: imponibile,
  totaleIvaCentesimi: iva,
  tipoDocumento: 'nota_credito',
  ...extra,
});

describe('calcolaLiquidazioneIvaPeriodo — note di credito e stati', () => {
  it('la Nota di Credito SOTTRAE dall\'IVA a debito (storno stesso periodo → 0)', () => {
    const r = calcolaLiquidazioneIvaPeriodo(
      '2026-09',
      [F(100000, 22000), NC(100000, 22000)],
      [],
      0,
    );
    expect(r.ivaDebitoCent).toBe(0);
    expect(r.totaleImponibileVenditeCent).toBe(0);
    expect(r.saldoIvaCent).toBe(0);
    expect(r.stato).toBe('a_pareggio');
  });

  it('senza la NC il debito è pieno (regressione: prova che la NC conta davvero)', () => {
    const r = calcolaLiquidazioneIvaPeriodo('2026-09', [F(100000, 22000)], [], 0);
    expect(r.ivaDebitoCent).toBe(22000);
    expect(r.importoDaVersareCent).toBe(22000);
  });

  it('la fattura annullata concorre nel suo periodo (lo storno lo fa la NC nel suo)', () => {
    // Fattura di settembre annullata; la NC cade in ottobre → settembre resta a debito pieno.
    const r = calcolaLiquidazioneIvaPeriodo(
      '2026-09',
      [F(100000, 22000, { stato: 'annullata' })],
      [],
      0,
    );
    expect(r.ivaDebitoCent).toBe(22000);
  });

  it('esclude bozze e split payment dal debito', () => {
    const r = calcolaLiquidazioneIvaPeriodo(
      '2026-09',
      [
        F(100000, 22000),
        F(50000, 11000, { stato: 'bozza' }),
        F(30000, 6600, { esigibilitaIva: 'split' }),
      ],
      [],
      0,
    );
    expect(r.ivaDebitoCent).toBe(22000);
  });

  it('sottrae l\'IVA a credito degli acquisti e riporta il credito', () => {
    const r = calcolaLiquidazioneIvaPeriodo('2026-09', [F(100000, 22000)], [{ imponibileCentesimi: 200000, ivaCentesimi: 44000 }], 0);
    expect(r.saldoIvaCent).toBe(22000 - 44000);
    expect(r.stato).toBe('credito');
    expect(r.creditoRiportabileCent).toBe(22000);
  });

  it('determinaPeriodoFiscale gestisce mensile e trimestrale', () => {
    expect(determinaPeriodoFiscale('2026-09').codicePeriodo).toBe('2026-09');
    expect(determinaPeriodoFiscale('2026-Q3').codicePeriodo).toBe('2026-Q3');
  });
});

// ─────────────────────────────────────────────────────────────────────
// L'esigibilità differita
// ─────────────────────────────────────────────────────────────────────
//
// Art. 6, comma 4, del DPR 633/72: per queste operazioni l'IVA è esigibile **al pagamento**, non
// alla data del documento. Il motore la conta nel periodo della fattura, cioè in anticipo — e fino
// al 15/10/2026 lo faceva **in silenzio**, mentre la stessa fattura partiva verso lo SdI con
// `<EsigibilitaIVA>D</EsigibilitaIVA>`. Le due metà dell'app dicevano cose diverse della stessa
// fattura, e solo una delle due arrivava al commercialista.
//
// Questi test tengono ferme due cose insieme: che il totale **non** cambi — spostare l'IVA
// all'incasso, senza garanzia che gli incassi siano registrati a sistema, farebbe sparire l'IVA da
// tutte le liquidazioni — e che il prospetto **lo dica**, nominando i documenti. Se un giorno si
// deciderà di spostare l'esigibilità al pagamento, è il primo test qui sotto che dovrà cambiare.

describe('calcolaLiquidazioneIvaPeriodo — esigibilità differita', () => {
  it('conta la differita nel debito (in anticipo, non mai) e la dichiara a parte', () => {
    const r = calcolaLiquidazioneIvaPeriodo(
      '2026-09',
      [F(100000, 22000, { esigibilitaIva: 'differita', numero: 'FT-2026/012' })],
      [],
      0,
    );
    expect(r.ivaDebitoCent).toBe(22000);
    expect(r.differitaTrattataComeImmediata).toEqual({
      count: 1,
      imponibileCent: 100000,
      ivaDebitoCent: 22000,
      documenti: ['FT-2026/012'],
    });
  });

  it('senza differite il blocco c\'è ed è vuoto — «nessuna», non «non lo so»', () => {
    // La distinzione è il punto: `count: 0` è un'affermazione, un campo assente è una domanda senza
    // risposta. Il motore risponde sempre; semmai è il filo — o un backend di una versione
    // precedente — a non portare il campo, e infatti lì il frontend non disegna niente invece di
    // disegnare zero.
    const r = calcolaLiquidazioneIvaPeriodo('2026-09', [F(100000, 22000)], [], 0);
    expect(r.differitaTrattataComeImmediata).toEqual({
      count: 0,
      imponibileCent: 0,
      ivaDebitoCent: 0,
      documenti: [],
    });
  });

  it('la differita non è lo split: la prima entra nel debito, il secondo no', () => {
    // Si assomigliano solo nel nome. Nello split l'IVA non è mai dello studio — la versa il
    // committente — quindi escluderla è completo; nella differita è dello studio, solo più tardi.
    // Trattarle allo stesso modo vorrebbe dire non dichiarare IVA dovuta.
    const r = calcolaLiquidazioneIvaPeriodo(
      '2026-09',
      [
        F(100000, 22000, { esigibilitaIva: 'differita', numero: 'FT-2026/012' }),
        F(30000, 6600, { esigibilitaIva: 'split', numero: 'FT-2026/013' }),
      ],
      [],
      0,
    );
    expect(r.ivaDebitoCent).toBe(22000);
    expect(r.differitaTrattataComeImmediata.count).toBe(1);
    expect(r.differitaTrattataComeImmediata.documenti).toEqual(['FT-2026/012']);
  });

  it('la nota di credito su una differita storna anche nella segnalazione', () => {
    // Il segnalato è un importo, non un conteggio: una NC che storna una differita deve abbassarlo,
    // o il prospetto direbbe «hai IVA differita per 220 €» su un'operazione che non esiste più.
    const r = calcolaLiquidazioneIvaPeriodo(
      '2026-09',
      [
        F(100000, 22000, { esigibilitaIva: 'differita', numero: 'FT-2026/012' }),
        NC(100000, 22000, { esigibilitaIva: 'differita', numero: 'NC-2026/003' }),
      ],
      [],
      0,
    );
    expect(r.ivaDebitoCent).toBe(0);
    expect(r.differitaTrattataComeImmediata.ivaDebitoCent).toBe(0);
    expect(r.differitaTrattataComeImmediata.count).toBe(2);
    expect(r.differitaTrattataComeImmediata.documenti).toEqual(['FT-2026/012', 'NC-2026/003']);
  });

  it('ripiega sull\'id quando il numero non c\'è, invece di non nominare il documento', () => {
    // Un documento che non si può nominare non si può andare a controllare, e questa segnalazione
    // esiste esattamente perché qualcuno ci vada a guardare.
    const r = calcolaLiquidazioneIvaPeriodo(
      '2026-09',
      [F(100000, 22000, { esigibilitaIva: 'differita', id: 'f-abc' })],
      [],
      0,
    );
    expect(r.differitaTrattataComeImmediata.documenti).toEqual(['f-abc']);
  });
});
