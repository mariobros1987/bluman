/**
 * Le regole di scadenza: una implementazione, due consumatori.
 *
 * Il test che conta più di tutti è **«la condizione del cron e quella del modulo coincidono»**.
 * Non verifica una funzione: verifica che l'estrazione non abbia cambiato il comportamento del
 * cron di un solo giorno. È l'unico modo di sapere che il calendario e le notifiche parlano della
 * stessa scadenza — ed è il motivo per cui le due implementazioni sono state unite.
 */
import { describe, expect, it } from 'vitest';
import {
  ANNO_MS,
  ETA_KYC_PRIMO_AVVISO,
  GIORNI_PREAVVISO_KYC,
  GIORNI_SOLLECITO_RATA,
  giornoSollecitoRata,
  giorniAlRinnovoKyc,
  kycInAvviso,
  rinnovoKyc,
  statoScadenza,
  tonoRata,
} from './scadenzeDerivate.js';

const GIORNO_MS = 24 * 60 * 60 * 1000;
const ADESSO = new Date('2026-09-17T10:00:00.000Z');

/** Una data a `giorni` di distanza da `ADESSO`, con lo stesso orario. */
function fraGiorni(giorni: number): Date {
  return new Date(ADESSO.getTime() + giorni * GIORNO_MS);
}

describe('il rinnovo KYC è l\'anniversario, e senza KYC non c\'è scadenza', () => {
  it('cade un anno dopo la verifica', () => {
    expect(rinnovoKyc('2026-03-04T00:00:00.000Z')?.toISOString()).toBe('2027-03-04T00:00:00.000Z');
  });

  it('senza KYC non c\'è nessuna data, non una data di oggi', () => {
    // La differenza è tutta qui: «nessuna scadenza» e «scade adesso» portano l'operatore a due
    // azioni opposte. Il calendario mostrava una data inventata proprio in questo caso.
    expect(rinnovoKyc(null)).toBeNull();
    expect(rinnovoKyc('')).toBeNull();
    expect(rinnovoKyc(undefined)).toBeNull();
  });

  it('una data illeggibile non diventa una data valida', () => {
    expect(rinnovoKyc('non-una-data')).toBeNull();
  });

  it('conta i giorni che mancano, e vanno sotto zero quando è passato', () => {
    expect(giorniAlRinnovoKyc(fraGiorni(-365), ADESSO)).toBe(0);
    expect(giorniAlRinnovoKyc(fraGiorni(-335), ADESSO)).toBe(30);
    expect(giorniAlRinnovoKyc(fraGiorni(-400), ADESSO)).toBe(-35);
  });
});

describe('la condizione del cron e quella del modulo sono la stessa', () => {
  /**
   * La condizione **come era scritta nel cron** prima dell'estrazione, ricopiata qui di proposito.
   *
   * Ricopiarla invece di importarla è il punto: se qualcuno «semplifica» il modulo, questo test
   * deve fallire. Un test che chiamasse due volte la stessa funzione non proverebbe niente.
   */
  function condizioneDelCron(dataKyc: Date, adesso: Date): boolean {
    const trentaGiorni = 30 * 24 * 60 * 60 * 1000;
    const kycAge = adesso.getTime() - dataKyc.getTime();
    return kycAge > (365 * 24 * 60 * 60 * 1000 - trentaGiorni);
  }

  it('coincide su 2001 età del KYC, da oggi a cinque anni e mezzo fa', () => {
    const discordanti: string[] = [];
    for (let quarti = 0; quarti <= 2000; quarti++) {
      const giorniFa = quarti / 4; // passi di sei ore, per non fermarsi sui confini tondi
      const dataKyc = new Date(ADESSO.getTime() - giorniFa * GIORNO_MS);
      const atteso = condizioneDelCron(dataKyc, ADESSO);
      const ottenuto = kycInAvviso(dataKyc, ADESSO);
      if (atteso !== ottenuto) {
        discordanti.push(`${giorniFa} giorni fa: cron=${atteso} modulo=${ottenuto}`);
      }
    }
    expect(discordanti).toEqual([]);
  });

  it('il confine cade 29 giorni prima del rinnovo, non 30', () => {
    // Qui c'è un off-by-one reale, ereditato dal cron e conservato di proposito. Il preavviso
    // dichiarato è 30 giorni, ma la condizione del cron è `>` e non `>=`: quando al rinnovo mancano
    // esattamente 30 giorni non si avvisa ancora, e il primo avviso parte il giorno dopo, a 29.
    //
    // Il test lo scrive invece di nasconderlo, per due motivi: perché smetta di essere invisibile, e
    // perché chi un giorno volesse «aggiustarlo» sappia che sta spostando di un giorno una notifica
    // che l'operatore riceve già — una decisione da prendere, non una svista da correggere.
    expect(giorniAlRinnovoKyc(fraGiorni(-ETA_KYC_PRIMO_AVVISO), ADESSO)).toBe(30);
    expect(kycInAvviso(fraGiorni(-ETA_KYC_PRIMO_AVVISO), ADESSO)).toBe(false);

    expect(giorniAlRinnovoKyc(fraGiorni(-ETA_KYC_PRIMO_AVVISO - 1), ADESSO)).toBe(29);
    expect(kycInAvviso(fraGiorni(-ETA_KYC_PRIMO_AVVISO - 1), ADESSO)).toBe(true);

    // E il preavviso dichiarato resta 30: è il giorno che l'operatore intende, non quello che riceve.
    expect(GIORNI_PREAVVISO_KYC).toBe(30);
    expect(ETA_KYC_PRIMO_AVVISO).toBe(335);
  });

  it('senza KYC non è mai in avviso', () => {
    expect(kycInAvviso(null, ADESSO)).toBe(false);
    expect(kycInAvviso('non-una-data', ADESSO)).toBe(false);
  });

  it('la costante del preavviso è quella che il cron usava', () => {
    expect(GIORNI_PREAVVISO_KYC).toBe(30);
    expect(ANNO_MS).toBe(365 * GIORNO_MS);
  });
});

describe('una rata si sollecita in tre momenti, non in una scala', () => {
  it('una settimana prima, il giorno stesso, tre giorni dopo', () => {
    // Il verso è quello del cron: positivo quando la scadenza deve ancora arrivare. Scritto al
    // contrario il sollecito partirebbe tre giorni **prima** e mai dopo la scadenza, cioè
    // esattamente quando non serve.
    expect(giornoSollecitoRata(fraGiorni(7), ADESSO)).toBe(7);
    expect(giornoSollecitoRata(fraGiorni(0), ADESSO)).toBe(0);
    expect(giornoSollecitoRata(fraGiorni(-3), ADESSO)).toBe(-3);
  });

  it('negli altri giorni non si sollecita', () => {
    for (const g of [-10, -8, -6, -1, 1, 2, 4, 6, 8, 30]) {
      expect(giornoSollecitoRata(fraGiorni(g), ADESSO)).toBeNull();
    }
  });

  it('i tre momenti sono esattamente quelli dichiarati', () => {
    expect([...GIORNI_SOLLECITO_RATA]).toEqual([7, 0, -3]);
  });

  it('una rata senza data non si sollecita', () => {
    expect(giornoSollecitoRata(null, ADESSO)).toBeNull();
    expect(giornoSollecitoRata('non-una-data', ADESSO)).toBeNull();
  });

  it('il tono distingue scaduta, oggi e vicina', () => {
    expect(tonoRata(7)).toBe('vicina');
    expect(tonoRata(0)).toBe('oggi');
    expect(tonoRata(-3)).toBe('scaduta');
  });
});

describe('una scadenza chiusa non è una scadenza mancata', () => {
  it('una rata incassata con data passata è «fatta», non «scaduta»', () => {
    // È la ragione per cui lo stato della sorgente entra nel calcolo: senza, il calendario
    // dipingerebbe di rosso ogni rata riscossa in ritardo, per sempre.
    expect(statoScadenza(fraGiorni(-30), true, ADESSO)).toBe('fatta');
    expect(statoScadenza(fraGiorni(-30), false, ADESSO)).toBe('scaduta');
  });

  it('una data futura e aperta è da fare', () => {
    expect(statoScadenza(fraGiorni(10), false, ADESSO)).toBe('da-fare');
  });

  it('oggi non è ancora scaduto', () => {
    expect(statoScadenza(fraGiorni(0), false, ADESSO)).toBe('da-fare');
  });

  it('una scadenza senza data resta da fare, aperta', () => {
    expect(statoScadenza(null, false, ADESSO)).toBe('da-fare');
    expect(statoScadenza(null, true, ADESSO)).toBe('fatta');
  });
});
