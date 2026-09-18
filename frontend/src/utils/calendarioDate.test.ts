/**
 * §1ter.5 (B1) — l'aritmetica delle date del calendario.
 *
 * Questi test esistono perché la pagina che sostituiscono sbagliava **in silenzio**: la
 * griglia era di agosto 2026 qualunque fosse il giorno, costruita su una costante `31`, e
 * l'intestazione era una stringa scritta a mano. Un errore così non produce un'eccezione —
 * produce un calendario che si guarda e sembra giusto, con le scadenze nel mese sbagliato.
 *
 * Le proprietà qui sotto sono scelte per non sopravvivere a quella mutazione: riportando
 * `etichettaMese` a una costante, riportando `grigliaDelMese` a trentuno caselle, o leggendo
 * il giorno in ora locale invece che in UTC, almeno un test cade.
 */
import { describe, expect, it } from 'vitest';
import {
  aggiungiGiorni,
  eGiornoIso,
  etichettaGiorno,
  etichettaMese,
  eventiDelGiorno,
  fineMese,
  giornoDi,
  giorniNelMese,
  grigliaDelMese,
  intervalloDelMese,
  istanteDaGiornoEOra,
  meseDi,
  mesePrecedente,
  meseSuccessivo,
  oggi,
  oraDi,
  oraMostrata,
} from './calendarioDate';

describe('il mese mostrato è quello vero', () => {
  it('l\'intestazione nomina il mese che le si chiede', () => {
    // La mutazione da intercettare è la costante «Agosto 2026» che era nel sorgente.
    expect(etichettaMese(2026, 8)).toBe('Settembre 2026');
    expect(etichettaMese(2026, 0)).toBe('Gennaio 2026');
    expect(etichettaMese(2027, 11)).toBe('Dicembre 2027');
  });

  it('l\'intervallo chiesto al server copre il mese intero, estremi inclusi', () => {
    // «a» è l'ultimo giorno, non il primo del mese dopo: il server spinge da solo il limite a
    // fine giornata, quindi chiedere il 1° ottobre escluderebbe tutto il 30 settembre.
    expect(intervalloDelMese(2026, 8)).toEqual({ da: '2026-09-01', a: '2026-09-30' });
    expect(intervalloDelMese(2026, 1)).toEqual({ da: '2026-02-01', a: '2026-02-28' });
  });

  it('febbraio bisestile finisce il 29', () => {
    // Il 2028 è bisestile. Una tabella di «30 giorni» scritta a mano sbaglia qui.
    expect(giorniNelMese(2028, 1)).toBe(29);
    expect(fineMese('2028-02-10')).toBe('2028-02-29');
    expect(intervalloDelMese(2028, 1)).toEqual({ da: '2028-02-01', a: '2028-02-29' });
  });

  it('il mese precedente e il successivo attraversano il capodanno', () => {
    expect(meseSuccessivo(2026, 11)).toEqual({ anno: 2027, mese: 0 });
    expect(mesePrecedente(2026, 0)).toEqual({ anno: 2025, mese: 11 });
    expect(meseSuccessivo(2026, 8)).toEqual({ anno: 2026, mese: 9 });
  });
});

describe('la griglia del mese', () => {
  it('settembre 2026 comincia di martedì e ha trenta giorni', () => {
    const celle = grigliaDelMese(2026, 8);

    // Il 1° settembre 2026 è un martedì: con la settimana che comincia di lunedì resta una sola
    // casella di coda, il 31 agosto.
    expect(celle[0]).toEqual({ giorno: '2026-08-31', numero: 31, nelMese: false });
    expect(celle[1]).toEqual({ giorno: '2026-09-01', numero: 1, nelMese: true });

    const delMese = celle.filter((c) => c.nelMese);
    expect(delMese).toHaveLength(30);
    expect(delMese[29].giorno).toBe('2026-09-30');
  });

  it('è sempre un rettangolo di settimane intere, e comincia sempre di lunedì', () => {
    // La proprietà che tiene allineate le colonne. Vale per ogni mese di diversi anni: se
    // l'offset o la coda fossero sbagliati, il conteggio non tornerebbe per qualcuno di questi.
    for (let anno = 2024; anno <= 2028; anno++) {
      for (let mese = 0; mese < 12; mese++) {
        const celle = grigliaDelMese(anno, mese);
        expect(celle.length % 7, `${anno}-${mese + 1} non è un rettangolo`).toBe(0);
        // `getUTCDay() === 1` è lunedì: la prima casella deve esserlo.
        expect(new Date(`${celle[0].giorno}T12:00:00Z`).getUTCDay(), `${anno}-${mese + 1} non comincia di lunedì`).toBe(1);
        // E i giorni del mese devono esserci tutti, di fila e senza buchi.
        const delMese = celle.filter((c) => c.nelMese);
        expect(delMese).toHaveLength(giorniNelMese(anno, mese));
        expect(delMese[0].giorno).toBe(`${anno}-${String(mese + 1).padStart(2, '0')}-01`);
      }
    }
  });

  it('agosto 2026 ha sei settimane: il primo è un sabato', () => {
    // Il caso che la pagina sbagliava mostrando comunque trentacinque caselle: qui la coda è di
    // cinque giorni, e le caselle del mese restano trentuno.
    const celle = grigliaDelMese(2026, 7);
    expect(celle[0].giorno).toBe('2026-07-27');
    expect(celle.filter((c) => c.nelMese)).toHaveLength(31);
    expect(celle).toHaveLength(42);
  });
});

describe('il giorno di un istante si legge in UTC', () => {
  it('un istante a mezzanotte resta il giorno che dichiara', () => {
    // È la proprietà che il backend dà per scontata collocando le scadenze a mezzogiorno UTC.
    expect(giornoDi('2026-09-15T00:00:00.000Z')).toBe('2026-09-15');
    expect(giornoDi('2026-09-15T12:00:00.000Z')).toBe('2026-09-15');
    expect(giornoDi('2026-09-15T23:59:59.999Z')).toBe('2026-09-15');
  });

  it('andata e ritorno coincidono anche per un orario a cavallo della mezzanotte', () => {
    // La scrittura e la lettura devono essere l'una l'inversa dell'altra. Scrivendo l'ora come
    // ora **locale**, le 00:30 di Roma diventerebbero le 22:30 UTC del giorno prima e questa
    // riga tornerebbe `2026-09-23`: la rata spostata di un giorno, che è l'errore vero.
    for (const ora of ['00:00', '00:30', '09:00', '23:59']) {
      const istante = istanteDaGiornoEOra('2026-09-24', ora);
      expect(giornoDi(istante), `l'ora ${ora} ha spostato il giorno`).toBe('2026-09-24');
      if (ora !== '00:00') expect(oraDi(istante)).toBe(ora);
    }
  });

  it('senza ora l\'istante è la mezzanotte, e non è un appuntamento', () => {
    expect(istanteDaGiornoEOra('2026-09-24')).toBe('2026-09-24T00:00:00.000Z');
    expect(istanteDaGiornoEOra('2026-09-24', '')).toBe('2026-09-24T00:00:00.000Z');
    expect(oraDi(istanteDaGiornoEOra('2026-09-24'))).toBeNull();
    // Un'ora fuori forma non produce una data non valida, che il server rifiuterebbe con un 400
    // di cui l'utente non saprebbe cosa farsi.
    expect(istanteDaGiornoEOra('2026-09-24', '25:99')).toBe('2026-09-24T00:00:00.000Z');
  });

  it('le scadenze derivate non mostrano un orario', () => {
    // Il backend le colloca a mezzogiorno UTC come cuscinetto contro i fusi: mostrarlo come
    // «12:00» accanto a ogni rata inventerebbe un appuntamento che nessuno ha fissato.
    expect(oraMostrata({ dataInizio: '2026-09-15T12:00:00.000Z', generato: true })).toBeNull();
    expect(oraMostrata({ dataInizio: '2026-09-15T10:30:00.000Z', generato: false })).toBe('10:30');
    expect(oraMostrata({ dataInizio: '2026-09-15T00:00:00.000Z', generato: false })).toBeNull();
  });
});

describe('oggi', () => {
  it('è il giorno del browser, non quello UTC', () => {
    // Il caso vero è la notte italiana: a Roma è già il 19 e in UTC è ancora il 18. La casella
    // evidenziata deve essere la giornata di chi guarda lo schermo.
    const mezzanotteEmezzaItaliana = new Date(2026, 8, 19, 0, 30);
    expect(oggi(mezzanotteEmezzaItaliana)).toBe('2026-09-19');

    // E il giorno prima, a fine giornata.
    expect(oggi(new Date(2026, 8, 18, 23, 45))).toBe('2026-09-18');
  });
});

describe('aggiungere giorni', () => {
  it('attraversa il mese e l\'anno', () => {
    expect(aggiungiGiorni('2026-09-30', 1)).toBe('2026-10-01');
    expect(aggiungiGiorni('2026-01-01', -1)).toBe('2025-12-31');
    expect(aggiungiGiorni('2028-02-28', 1)).toBe('2028-02-29');
    expect(aggiungiGiorni('2026-09-18', 3)).toBe('2026-09-21');
  });

  it('non sbaglia il giorno in cui cambia l\'ora legale', () => {
    // In Italia l'ora legale finisce l'ultima domenica di ottobre: il 25/10/2026. Aggiungere
    // giorni con `setDate` su una data locale, in quel fine settimana, può restituire lo stesso
    // giorno due volte. L'aritmetica qui è in UTC, quindi non se ne accorge nemmeno.
    expect(aggiungiGiorni('2026-10-24', 1)).toBe('2026-10-25');
    expect(aggiungiGiorni('2026-10-25', 1)).toBe('2026-10-26');
    expect(aggiungiGiorni('2026-10-24', 7)).toBe('2026-10-31');
  });
});

describe('gli eventi di un giorno', () => {
  const eventi = [
    { id: 'uno', dataInizio: '2026-09-15T12:00:00.000Z', dataFine: '2026-09-15T12:00:00.000Z' },
    { id: 'lungo', dataInizio: '2026-09-10T09:00:00.000Z', dataFine: '2026-09-12T18:00:00.000Z' },
    { id: 'altro-mese', dataInizio: '2026-10-01T09:00:00.000Z', dataFine: '2026-10-01T09:00:00.000Z' },
  ];

  it('un evento di un giorno cade nel suo giorno e in nessun altro', () => {
    expect(eventiDelGiorno(eventi, '2026-09-15').map((e) => e.id)).toEqual(['uno']);
    expect(eventiDelGiorno(eventi, '2026-09-14')).toEqual([]);
  });

  it('un evento lungo occupa tutti i giorni che attraversa', () => {
    // Non è `dataInizio === giorno`. Il server manda le righe che attraversano l'intervallo
    // chiesto, quindi ridurle a un confronto sull'inizio nasconderebbe l'evento dal secondo
    // giorno in poi — con la riga già arrivata e scartata qui.
    expect(eventiDelGiorno(eventi, '2026-09-10').map((e) => e.id)).toEqual(['lungo']);
    expect(eventiDelGiorno(eventi, '2026-09-11').map((e) => e.id)).toEqual(['lungo']);
    expect(eventiDelGiorno(eventi, '2026-09-12').map((e) => e.id)).toEqual(['lungo']);
    expect(eventiDelGiorno(eventi, '2026-09-13')).toEqual([]);
  });

  it('l\'ultimo istante di un giorno lo include', () => {
    // Il confine è il caso che si sbaglia per primo: l'evento che finisce alle 23:59 deve
    // comparire quel giorno, non il successivo.
    const aCavallo = [
      { id: 'coda', dataInizio: '2026-09-17T08:00:00.000Z', dataFine: '2026-09-17T23:59:59.999Z' },
    ];
    expect(eventiDelGiorno(aCavallo, '2026-09-17').map((e) => e.id)).toEqual(['coda']);
    expect(eventiDelGiorno(aCavallo, '2026-09-18')).toEqual([]);
  });
});

describe('le etichette', () => {
  it('il giorno si nomina per esteso', () => {
    expect(etichettaGiorno('2026-09-18')).toBe('18 settembre 2026');
    expect(etichettaGiorno('2027-01-01')).toBe('1 gennaio 2027');
  });

  it('un giorno si sa scomporre nel suo mese', () => {
    expect(meseDi('2026-09-18')).toEqual({ anno: 2026, mese: 8 });
    expect(meseDi('2026-01-01')).toEqual({ anno: 2026, mese: 0 });
  });
});

describe('riconoscere un giorno da qualcosa che gli somiglia', () => {
  it('accetta i giorni veri', () => {
    expect(eGiornoIso('2026-09-18')).toBe(true);
    expect(eGiornoIso('2028-02-29')).toBe(true); // bisestile
    expect(eGiornoIso('2026-01-01')).toBe(true);
  });

  it('rifiuta la data locale che il progetto porta al posto di una data', () => {
    // Il difetto che questo test presidia, trovato scrivendo lo scadenzario del fascicolo:
    // `Progetto.start` è `toLocaleDateString()`, quindi `18/09/2026` in italiano e `9/18/2026` in
    // inglese. `giornoDi` ne prende i dieci caratteri e restituisce `'18/09/2026'`, che sembra un
    // giorno, non lo è, e fa produrre `Invalid Date` a `aggiungiGiorni`.
    expect(eGiornoIso('18/09/2026')).toBe(false);
    expect(eGiornoIso('9/18/2026')).toBe(false);
  });

  it('rifiuta i termini di pagamento scambiati per una scadenza', () => {
    // `Progetto.due` è la costante `'30 giorni'`: il nome del campo invita a leggerlo come una
    // data, e non lo è.
    expect(eGiornoIso('30 giorni')).toBe(false);
  });

  it('rifiuta i giorni che hanno la forma giusta e il valore sbagliato', () => {
    // `2026-13-45` supera `/^\d{4}-\d{2}-\d{2}$/`: il tredicesimo mese non esiste, e `Date` lo
    // normalizza nel 14 del mese successivo invece di rifiutarlo. La verifica rotonda è l'unico
    // controllo che se ne accorge.
    expect(eGiornoIso('2026-13-45')).toBe(false);
    expect(eGiornoIso('2026-02-30')).toBe(false);
    expect(eGiornoIso('2027-02-29')).toBe(false); // 2027 non è bisestile
    expect(eGiornoIso('2026-00-10')).toBe(false);
    expect(eGiornoIso('2026-09-31')).toBe(false);
  });

  it('rifiuta ciò che non è nemmeno una stringa', () => {
    expect(eGiornoIso(null)).toBe(false);
    expect(eGiornoIso(undefined)).toBe(false);
    expect(eGiornoIso(20260918)).toBe(false);
    expect(eGiornoIso('')).toBe(false);
    // Un istante completo non è un giorno: chi ha una data e ora deve passare da `giornoDi`, che è
    // esplicito sul fatto che la lettura avviene in UTC. Accettarlo qui nasconderebbe quella scelta.
    expect(eGiornoIso('2026-09-18T09:00:00.000Z')).toBe(false);
  });
});
