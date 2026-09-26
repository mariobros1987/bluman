/**
 * KYC/AML Fase K9 (Malta, spec §5.4/§8.9/§11) — conservazione/retention del fascicolo. PURO: nessun
 * DB/HTTP. Cron, calendario e rotte chiamano queste funzioni con la data di chiusura, gli anni di
 * conservazione (config tenant), l'eventuale proroga e l'esito, così non divergono.
 *
 * Regola d'oro §8.9: **nessuna cancellazione fisica prima della scadenza**. La scadenza si calcola
 * dalla fine del rapporto (`chiusoAt`) più `retentionYears`, salvo proroga motivata per il fascicolo.
 */

/** Preavviso: la scadenza di conservazione si segnala da 60 giorni prima (orizzonte lungo, non 30). */
export const GIORNI_PREAVVISO_RETENTION = 60;

const GIORNO_MS = 24 * 60 * 60 * 1000;

function adData(v: Date | string | null | undefined): Date | null {
  if (!v) return null;
  const d = v instanceof Date ? v : new Date(v);
  return Number.isNaN(d.getTime()) ? null : d;
}

/**
 * Scadenza di conservazione = `chiusoAt` + `retentionYears`, salvo una proroga più avanti nel tempo.
 * `null` se il fascicolo non è chiuso (senza fine del rapporto non parte alcun termine).
 */
export function dataScadenzaRetention(
  chiusoAt: Date | string | null | undefined,
  retentionYears: number,
  prorogaAl?: Date | string | null | undefined,
): Date | null {
  const chiuso = adData(chiusoAt);
  if (!chiuso) return null;
  const base = new Date(chiuso);
  base.setFullYear(base.getFullYear() + Math.max(0, Math.floor(retentionYears)));
  const proroga = adData(prorogaAl);
  // La proroga vale solo se sposta la scadenza PIÙ AVANTI: non si accorcia la conservazione.
  return proroga && proroga.getTime() > base.getTime() ? proroga : base;
}

/** Giorni alla scadenza: positivo se futura, negativo se già passata. `null` se nessuna scadenza. */
export function giorniAllaScadenzaRetention(
  scadenza: Date | string | null | undefined,
  adesso: Date = new Date(),
): number | null {
  const d = adData(scadenza);
  if (!d) return null;
  return Math.floor((d.getTime() - adesso.getTime()) / GIORNO_MS);
}

/** La conservazione è conclusa quando l'MLRO ha registrato un esito (cancellazione o anonimizzazione). */
export function retentionConclusa(esito: string | null | undefined): boolean {
  return !!esito && esito.trim() !== '';
}

/**
 * §5.4 — la scadenza di conservazione è DOVUTA (va portata all'MLRO) se non è ancora stata conclusa e
 * la scadenza cade entro il preavviso (o è già passata). Un fascicolo non chiuso non ha scadenza.
 */
export function retentionDovuta(
  scadenza: Date | string | null | undefined,
  esito: string | null | undefined,
  adesso: Date = new Date(),
): boolean {
  if (retentionConclusa(esito)) return false;
  const giorni = giorniAllaScadenzaRetention(scadenza, adesso);
  if (giorni === null) return false;
  return giorni <= GIORNI_PREAVVISO_RETENTION;
}

/**
 * §8.9 — l'esito (cancellazione/anonimizzazione) si può registrare SOLO a scadenza raggiunta e se non
 * è già stato registrato. Prima della scadenza nessuna cancellazione fisica: il gate è qui, una volta.
 */
export function puoRegistrareEsitoRetention(
  scadenza: Date | string | null | undefined,
  esito: string | null | undefined,
  adesso: Date = new Date(),
): boolean {
  if (retentionConclusa(esito)) return false;
  const giorni = giorniAllaScadenzaRetention(scadenza, adesso);
  if (giorni === null) return false;
  return giorni <= 0;
}

/** Frase esplicativa (regola 12). Stringa vuota se non c'è nulla da dire. */
export function motivoRetention(
  scadenza: Date | string | null | undefined,
  esito: string | null | undefined,
  adesso: Date = new Date(),
): string {
  if (retentionConclusa(esito)) {
    const etichetta = esito === 'cancellato' ? 'cancellazione' : 'anonimizzazione';
    return `Conservazione conclusa con ${etichetta} dei dati.`;
  }
  const d = adData(scadenza);
  if (!d) return '';
  const giorni = giorniAllaScadenzaRetention(scadenza, adesso)!;
  const quando = d.toLocaleDateString('it-IT');
  if (giorni < 0) return `Conservazione scaduta dal ${quando} (${-giorni} giorni fa): l’MLRO deve confermare cancellazione o anonimizzazione.`;
  if (giorni === 0) return `Conservazione in scadenza oggi (${quando}): decisione dell’MLRO.`;
  if (giorni <= GIORNI_PREAVVISO_RETENTION) return `Conservazione in scadenza tra ${giorni} giorni (${quando}).`;
  return `In conservazione fino al ${quando}.`;
}
