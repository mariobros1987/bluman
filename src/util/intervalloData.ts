// Filtri per intervallo di date sulle liste (progetti, fatture, scadenzario, documenti).
//
// File PURO: nessuna dipendenza (né Prisma né service), così è testabile in isolamento e non
// tira dentro il database. La normalizzazione inizio/fine giorno UTC segue la stessa semantica
// di `inizioGiornoUtc`/`fineGiornoUtc` in `services/calendarioEventi.ts`, qui ridefinita per non
// dipendere da un service. Il parser respinge le date impossibili (2026-02-30, 2026-13-01):
// prima non c'era alcun parser `dataDa/dataA` nel backend, quindi la difesa vive qui.

const RE_ISO = /^\d{4}-\d{2}-\d{2}$/;

/**
 * `YYYY-MM-DD` → Date a mezzanotte UTC, oppure `null` se il formato o la data non sono validi.
 * Il controllo del round-trip dei componenti respinge l'overflow silenzioso del costruttore
 * (es. `2026-02-30` che `Date.UTC` interpreterebbe come 2 marzo).
 */
export function parseDataIso(valore: string | undefined | null): Date | null {
  if (!valore || !RE_ISO.test(valore)) return null;
  const parti = valore.split('-');
  const anno = Number(parti[0]);
  const mese = Number(parti[1]);
  const giorno = Number(parti[2]);
  const d = new Date(Date.UTC(anno, mese - 1, giorno));
  if (d.getUTCFullYear() !== anno || d.getUTCMonth() !== mese - 1 || d.getUTCDate() !== giorno) {
    return null;
  }
  return d;
}

/** Il primo istante del giorno UTC che contiene `istante`. */
export function inizioGiornoUtc(istante: Date): Date {
  return new Date(Date.UTC(istante.getUTCFullYear(), istante.getUTCMonth(), istante.getUTCDate(), 0, 0, 0, 0));
}

/** L'ultimo istante del giorno UTC che contiene `istante`. */
export function fineGiornoUtc(istante: Date): Date {
  return new Date(Date.UTC(istante.getUTCFullYear(), istante.getUTCMonth(), istante.getUTCDate(), 23, 59, 59, 999));
}

/** Intervallo normalizzato ai bordi-giorno UTC. `null` su un estremo = aperto da quel lato. */
export interface IntervalloData {
  da: Date | null;
  a: Date | null;
}

/**
 * Interpreta i due estremi (stringhe `YYYY-MM-DD`) in un intervallo normalizzato: `da` all'inizio
 * del giorno, `a` alla fine del giorno (così `a` include l'intera giornata finale). Un estremo
 * assente o stringa vuota lascia quel lato aperto; un estremo PRESENTE ma malformato è un errore
 * (il chiamante risponde 400). `presente` dice se almeno un estremo filtra.
 */
export function leggiIntervalloData(dataDa?: string, dataA?: string):
  | { ok: true; intervallo: IntervalloData; presente: boolean }
  | { ok: false; errore: string } {
  let da: Date | null = null;
  let a: Date | null = null;
  if (dataDa !== undefined && dataDa !== '') {
    const p = parseDataIso(dataDa);
    if (!p) return { ok: false, errore: 'Parametro dataDa non valido (atteso YYYY-MM-DD).' };
    da = inizioGiornoUtc(p);
  }
  if (dataA !== undefined && dataA !== '') {
    const p = parseDataIso(dataA);
    if (!p) return { ok: false, errore: 'Parametro dataA non valido (atteso YYYY-MM-DD).' };
    a = fineGiornoUtc(p);
  }
  return { ok: true, intervallo: { da, a }, presente: da !== null || a !== null };
}

/**
 * Filtro Prisma per un SINGOLO campo data (non-nullable): `{ gte?, lte? }`, o `undefined` se
 * l'intervallo è vuoto — così si assegna direttamente: `if (f) where.data = f;`.
 */
export function filtroData({ da, a }: IntervalloData): { gte?: Date; lte?: Date } | undefined {
  if (!da && !a) return undefined;
  const f: { gte?: Date; lte?: Date } = {};
  if (da) f.gte = da;
  if (a) f.lte = a;
  return f;
}
