/**
 * §1ter.5 (B1) — le date del calendario, in un posto solo.
 *
 * Prima di questo file la griglia del mese era costruita a mano dentro la pagina, con
 * `31` come numero di giorni e `Agosto 2026` come intestazione scritta nel sorgente. La
 * correzione non è «usare `new Date()`»: è **decidere una convenzione e scriverla una volta**,
 * perché le due pagine che mostrano un calendario (la griglia dello studio e il minicalendario
 * del modale di pianificazione) devono rispondere alla stessa domanda — «questa scadenza cade
 * il 15 o il 16?» — e due aritmetiche delle date scritte due volte divergono sempre.
 *
 * ## La convenzione, e perché è questa
 *
 * **Un giorno del calendario è una stringa `AAAA-MM-GG`, e si legge in UTC.**
 *
 * La ragione sta nel backend, che colloca le scadenze derivate a mezzogiorno UTC
 * (`src/services/calendarioEventi.ts`, `ORA_SCADENZA_UTC`) proprio perché quell'istante cada
 * nello stesso giorno civile in ogni fuso da UTC−11 a UTC+11. Se qui leggessi il giorno in ora
 * locale, a Roma d'estate (UTC+2) mezzogiorno UTC diventerebbe le 14:00 del giorno giusto —
 * bene — ma per un evento scritto a mezzanotte UTC il giorno scivolerebbe indietro di uno, e
 * la rata del 15 comparirebbe il 14. Leggendo in UTC l'istante e il giorno coincidono sempre,
 * e la stessa cosa vale per ciò che questa pagina scrive: vedi `istanteDaGiornoEOra`.
 *
 * **«Oggi» invece è il giorno locale del browser**, ed è l'unica eccezione deliberata: è il
 * giorno in cui la persona sta vivendo, quello che legge sull'orologio. Il caso in cui le due
 * cose divergono è la mezzanotte italiana, quando a Roma è già il 19 e in UTC è ancora il 18:
 * l'utente si aspetta che la casella evidenziata sia la sua giornata, e ha ragione.
 */

/** Un giorno civile del calendario: `AAAA-MM-GG`. */
export type GiornoIso = string;

const MESI = [
  'Gennaio', 'Febbraio', 'Marzo', 'Aprile', 'Maggio', 'Giugno',
  'Luglio', 'Agosto', 'Settembre', 'Ottobre', 'Novembre', 'Dicembre',
];

/** Due cifre, con lo zero davanti: `7` → `'07'`. */
function due(n: number): string {
  return String(n).padStart(2, '0');
}

/**
 * Se una stringa è un'ora del giorno, e non solo quattro cifre.
 *
 * Il controllo di forma da solo non basta, ed è un difetto che il test ha trovato subito:
 * `25:99` ha la forma giusta e supera `/^\d{2}:\d{2}$/`, quindi finiva dentro l'istante
 * producendo `2026-09-24T25:99:00.000Z`. Non è una data non valida per JavaScript — quella
 * stringa lì `new Date` la rifiuta, con `Invalid Date` — ma il punto è che il difetto sarebbe
 * arrivato al server, che risponde 400 con un messaggio su `dataInizio` mentre il campo che
 * l'utente ha sbagliato è l'ora. Un intervallo esplicito dice la verità: 00–23 e 00–59.
 */
function oraValida(ora: string): boolean {
  const parti = /^(\d{2}):(\d{2})$/.exec(ora);
  if (!parti) return false;
  return Number(parti[1]) <= 23 && Number(parti[2]) <= 59;
}

/** Il giorno civile che contiene un istante, letto in UTC. Vedi la convenzione in testa. */
export function giornoDi(istanteIso: string): GiornoIso {
  return istanteIso.slice(0, 10);
}

/**
 * Se una stringa è un giorno `AAAA-MM-GG`, e non qualcosa che ci somiglia.
 *
 * Serve al confine con i dati che **non** sono dati: `Progetto.start` è
 * `new Date(...).toLocaleDateString()`, cioè `18/09/2026` in italiano e `9/18/2026` in inglese, e
 * `Progetto.due` è la costante letterale `'30 giorni'` (i termini di pagamento, non una scadenza).
 * `giornoDi` su `'18/09/2026'` restituisce `'18/09/2026'` — dieci caratteri sono dieci caratteri —
 * e da lì `aggiungiGiorni` costruisce `Invalid Date`: un intervallo non valido nella richiesta, e
 * un 400 dal server che parla di `da`/`a` mentre il campo sbagliato è un altro.
 *
 * Il controllo è di forma **e** di valore, perché `2026-13-45` ha la forma giusta. La verifica
 * rotonda è che l'istante a mezzogiorno UTC di quel giorno si riformatti nella stessa stringa: se
 * `Date` l'ha normalizzata (il 45 di un mese di 31 giorni diventa il 14 del mese dopo), il valore
 * era fuori scala.
 *
 * **È la verifica rotonda a portare il peso, e la forma è solo la via corta.** Provato per
 * mutazione: togliendo la verifica rotonda un test cade (`2026-13-45`), togliendo la forma **non
 * ne cade nessuno** — perché `new Date('18/09/2026T12:00:00.000Z')` è già `Invalid Date`. Chi
 * trovasse ridondante una delle due righe lo sappia: è la seconda a non potersi togliere, e la
 * prima a poter sparire in silenzio.
 */
export function eGiornoIso(valore: unknown): valore is GiornoIso {
  if (typeof valore !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(valore)) return false;
  const istante = new Date(`${valore}T12:00:00.000Z`);
  return !Number.isNaN(istante.getTime()) && istante.toISOString().slice(0, 10) === valore;
}

/**
 * L'istante da scrivere per una scadenza fissata a un giorno e a un'ora.
 *
 * L'ora scelta diventa l'ora **UTC**, e non è una scorciatoia: è ciò che rende l'andata e il
 * ritorno identici. Scrivendo `12:00` come ora locale di Roma, il backend conserverebbe le
 * 10:00 UTC, e `giornoDi` — che legge in UTC — restituirebbe lo stesso giorno solo per fortuna
 * (cioè finché l'ora scelta non è prima delle 02:00). Un evento delle 00:30 finirebbe sul
 * giorno precedente: la stessa rata spostata di un giorno, che è l'errore che questa
 * convenzione esiste per non commettere.
 *
 * `ora` assente significa «non è un appuntamento, è una scadenza»: l'istante è la mezzanotte
 * UTC, e `oraDi` restituirà `null`, che l'interfaccia mostra come «tutto il giorno» invece di
 * inventare le 00:00.
 */
export function istanteDaGiornoEOra(giorno: GiornoIso, ora?: string | null): string {
  if (!ora || !oraValida(ora)) return `${giorno}T00:00:00.000Z`;
  return `${giorno}T${ora}:00.000Z`;
}

/**
 * L'ora di un istante, letto in UTC, o `null` se non ne porta una.
 *
 * `null` per la mezzanotte, ed è la convenzione di `istanteDaGiornoEOra`: la mezzanotte è
 * l'assenza di un'ora, non l'ora zero.
 *
 * **Le righe derivate non passano di qui**: una scadenza derivata sta a mezzogiorno UTC, che è
 * una cuscinetto del backend e non un appuntamento — mostrarla come «12:00» accanto a ogni
 * rata inventerebbe un orario che nessuno ha fissato. È `oraMostrata` a fare quella
 * distinzione, ed è l'unico posto dove va fatta.
 */
export function oraDi(istanteIso: string): string | null {
  const ora = istanteIso.slice(11, 16);
  if (!/^\d{2}:\d{2}$/.test(ora)) return null;
  return ora === '00:00' ? null : ora;
}

/** L'ora da mostrare per un evento: le derivate non ne hanno una. Vedi `oraDi`. */
export function oraMostrata(evento: { dataInizio: string; generato: boolean }): string | null {
  return evento.generato ? null : oraDi(evento.dataInizio);
}

/** Il giorno di oggi, nel fuso del browser. Vedi la convenzione in testa. */
export function oggi(adesso: Date = new Date()): GiornoIso {
  return `${adesso.getFullYear()}-${due(adesso.getMonth() + 1)}-${due(adesso.getDate())}`;
}

/** Il giorno che contiene un istante, spostato di `n` giorni. In UTC, quindi immune all'ora legale. */
export function aggiungiGiorni(giorno: GiornoIso, n: number): GiornoIso {
  const d = new Date(`${giorno}T12:00:00.000Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

/** Quanti giorni ha il mese. Il giorno 0 del mese successivo è l'ultimo di questo. */
export function giorniNelMese(anno: number, mese: number): number {
  return new Date(Date.UTC(anno, mese + 1, 0)).getUTCDate();
}

/** L'ultimo giorno del mese che contiene `giorno`. */
export function fineMese(giorno: GiornoIso): GiornoIso {
  const { anno, mese } = meseDi(giorno);
  return `${anno}-${due(mese + 1)}-${due(giorniNelMese(anno, mese))}`;
}

/** L'anno e il mese (0-11) che contengono un giorno. */
export function meseDi(giorno: GiornoIso): { anno: number; mese: number } {
  return { anno: Number(giorno.slice(0, 4)), mese: Number(giorno.slice(5, 7)) - 1 };
}

/** Il mese che segue, con l'anno che avanza a dicembre. */
export function meseSuccessivo(anno: number, mese: number): { anno: number; mese: number } {
  return mese === 11 ? { anno: anno + 1, mese: 0 } : { anno, mese: mese + 1 };
}

/** Il mese che precede, con l'anno che arretra a gennaio. */
export function mesePrecedente(anno: number, mese: number): { anno: number; mese: number } {
  return mese === 0 ? { anno: anno - 1, mese: 11 } : { anno, mese: mese - 1 };
}

/** L'intestazione del mese: `Settembre 2026`. */
export function etichettaMese(anno: number, mese: number): string {
  return `${MESI[mese]} ${anno}`;
}

/** L'intestazione di un giorno: `18 settembre 2026`. Minuscolo, per l'uso dentro una frase. */
export function etichettaGiorno(giorno: GiornoIso): string {
  const { anno, mese } = meseDi(giorno);
  return `${Number(giorno.slice(8, 10))} ${MESI[mese].toLowerCase()} ${anno}`;
}

/** L'intervallo da chiedere al server per un mese: dal primo all'ultimo giorno, estremi inclusi. */
export function intervalloDelMese(anno: number, mese: number): { da: GiornoIso; a: GiornoIso } {
  const da = `${anno}-${due(mese + 1)}-01`;
  return { da, a: fineMese(da) };
}

/** Una casella della griglia del mese. */
export interface CellaGiorno {
  giorno: GiornoIso;
  numero: number;
  /** Falso per i giorni di coda del mese precedente o successivo, che completano le settimane. */
  nelMese: boolean;
}

/**
 * Le caselle della griglia, con la settimana che comincia di lunedì.
 *
 * La griglia non è «i giorni del mese»: è un rettangolo di settimane intere, quindi comincia
 * con i giorni di coda del mese precedente e finisce con quelli del successivo. Portarli è
 * necessario perché le colonne restino allineate sotto le intestazioni Lun…Dom; ed è anche
 * comodo, perché una scadenza del 1° del mese prossimo si vede già dove cadrà.
 *
 * Lunedì come primo giorno non è una preferenza grafica: è l'ordine delle intestazioni che la
 * pagina mostrava già, e cambiarlo avrebbe spostato ogni evento di colonna. `getUTCDay()`
 * restituisce 0 per la domenica, quindi l'offset lunedì-primo è `(giorno + 6) % 7`.
 */
export function grigliaDelMese(anno: number, mese: number): CellaGiorno[] {
  const primo = new Date(Date.UTC(anno, mese, 1));
  const offset = (primo.getUTCDay() + 6) % 7;
  const totale = giorniNelMese(anno, mese);

  const caselle: CellaGiorno[] = [];

  for (let i = offset; i > 0; i--) {
    const giorno = aggiungiGiorni(`${anno}-${due(mese + 1)}-01`, -i);
    caselle.push({ giorno, numero: Number(giorno.slice(8, 10)), nelMese: false });
  }

  for (let n = 1; n <= totale; n++) {
    caselle.push({ giorno: `${anno}-${due(mese + 1)}-${due(n)}`, numero: n, nelMese: true });
  }

  // Si completa l'ultima settimana: senza, l'ultima riga avrebbe meno di sette caselle e le
  // colonne non sarebbero più colonne.
  let coda = 1;
  while (caselle.length % 7 !== 0) {
    const giorno = aggiungiGiorni(`${anno}-${due(mese + 1)}-${due(totale)}`, coda);
    caselle.push({ giorno, numero: Number(giorno.slice(8, 10)), nelMese: false });
    coda++;
  }

  return caselle;
}

/**
 * Gli eventi che cadono in un giorno.
 *
 * Non è `dataInizio === giorno`: un evento che comincia il 10 e finisce il 12 occupa tre
 * caselle. Il server manda già le righe che **attraversano** l'intervallo chiesto (la sua
 * condizione è `dataInizio <= a && dataFine >= da`) proprio per questo, e ridurle qui a un
 * confronto sull'inizio butterebbe via la seconda metà di quella risposta: l'evento lungo
 * sarebbe visibile il primo giorno e sparirebbe negli altri due.
 *
 * Il confronto è fra stringhe `AAAA-MM-GG`, che per questo formato è anche un confronto
 * cronologico: nessuna data da costruire, nessun fuso da sbagliare.
 */
export function eventiDelGiorno<T extends { dataInizio: string; dataFine: string }>(
  eventi: T[],
  giorno: GiornoIso,
): T[] {
  return eventi.filter((e) => giornoDi(e.dataInizio) <= giorno && giornoDi(e.dataFine) >= giorno);
}
