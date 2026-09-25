/**
 * KYC/AML Fase K7 (Malta, spec §5.2) — monitoraggio continuo: quando una pratica approvata va
 * RIVISTA. PURO: nessun DB/HTTP. Cron e calendario chiamano queste funzioni con la scadenza del
 * fascicolo e/o la prossima revisione dell'ultimo RiskAssessment, così non divergono.
 */

/** Preavviso: la revisione si segnala da 30 giorni prima (come il rinnovo KYC legacy). */
export const GIORNI_PREAVVISO_REVISIONE_KYC = 30;

const GIORNO_MS = 24 * 60 * 60 * 1000;

function adData(v: Date | string | null | undefined): Date | null {
  if (!v) return null;
  const d = v instanceof Date ? v : new Date(v);
  return Number.isNaN(d.getTime()) ? null : d;
}

/** Solo una pratica approvata o già in revisione ha una revisione periodica da monitorare. */
export function statoSoggettoARevisione(stato: string): boolean {
  return stato === 'approvato' || stato === 'in_revisione';
}

/**
 * La data di revisione effettiva: la PIÙ VICINA (min) tra la scadenza del fascicolo e la prossima
 * revisione calcolata sul rischio. `null` se non ce n'è nessuna.
 */
export function dataRevisioneKyc(
  dataScadenza: Date | string | null | undefined,
  prossimaRevisione?: Date | string | null | undefined,
): Date | null {
  const a = adData(dataScadenza);
  const b = adData(prossimaRevisione);
  if (a && b) return a.getTime() <= b.getTime() ? a : b;
  return a ?? b;
}

/** Giorni alla revisione: positivo se futura, negativo se già passata. `null` se nessuna data. */
export function giorniAllaRevisioneKyc(
  dataScadenza: Date | string | null | undefined,
  prossimaRevisione?: Date | string | null | undefined,
  adesso: Date = new Date(),
): number | null {
  const d = dataRevisioneKyc(dataScadenza, prossimaRevisione);
  if (!d) return null;
  return Math.floor((d.getTime() - adesso.getTime()) / GIORNO_MS);
}

/**
 * §5.2 — la revisione è DOVUTA se il fascicolo è approvato/in revisione e la sua data di revisione
 * cade entro il preavviso (o è già passata). Uno stato diverso, o nessuna data, non è dovuta.
 */
export function revisioneKycDovuta(
  stato: string,
  dataScadenza: Date | string | null | undefined,
  prossimaRevisione?: Date | string | null | undefined,
  adesso: Date = new Date(),
): boolean {
  if (!statoSoggettoARevisione(stato)) return false;
  const giorni = giorniAllaRevisioneKyc(dataScadenza, prossimaRevisione, adesso);
  if (giorni === null) return false;
  return giorni <= GIORNI_PREAVVISO_REVISIONE_KYC;
}

/** Frase esplicativa (regola 12). Stringa vuota se la revisione non è dovuta. */
export function motivoRevisioneKyc(
  stato: string,
  dataScadenza: Date | string | null | undefined,
  prossimaRevisione?: Date | string | null | undefined,
  adesso: Date = new Date(),
): string {
  if (!revisioneKycDovuta(stato, dataScadenza, prossimaRevisione, adesso)) return '';
  const giorni = giorniAllaRevisioneKyc(dataScadenza, prossimaRevisione, adesso)!;
  const d = dataRevisioneKyc(dataScadenza, prossimaRevisione)!;
  const quando = d.toLocaleDateString('it-IT');
  if (giorni < 0) return `Revisione KYC scaduta dal ${quando} (${-giorni} giorni fa): riaprire la pratica in revisione.`;
  if (giorni === 0) return `Revisione KYC dovuta oggi (${quando}).`;
  return `Revisione KYC in scadenza tra ${giorni} giorni (${quando}).`;
}
