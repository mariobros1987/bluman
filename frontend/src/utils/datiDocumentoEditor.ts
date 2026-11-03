/**
 * 3.14 — I dati di studio e progetto che Document Studio inserisce nei documenti.
 *
 * Vengono solo da ciò che il server ha restituito (anagrafica `GET /tenant/info`, progetti):
 * nessun importo inventato (era `8500`), nessuno studio dimostrativo (era
 * `getStudioInfoForTenant`). Il dato che manca è un segnaposto evidente, lo stesso di
 * `resolveDocumentTemplateHtml`.
 */

export const mancante = (campo: string) => `[DATO MANCANTE: ${campo}]`;

/** Valore del progetto in euro: `totalePreventivo`/`val` sono già in euro, `valoreTotale`/`valoreCentesimi` in centesimi. */
export function valoreProgettoEuro(p: any): number | null {
  if (p?.totalePreventivo != null) return Number(p.totalePreventivo);
  if (p?.val != null) return Number(p.val);
  const centesimi = p?.valoreTotale ?? p?.valoreCentesimi;
  return centesimi != null ? Number(centesimi) / 100 : null;
}

/**
 * «€ 1.234,50», o il segnaposto se il valore non c'è. Zero è un dato e si stampa.
 * Lo usa anche `resolveDocumentTemplateHtml` (3.15): un solo formato dell'importo nei documenti.
 * `useGrouping: 'always'`: per `it-IT` il separatore delle migliaia scatterebbe solo da 10.000.
 */
export function importoEuroTesto(valore: number | null | undefined): string {
  if (valore == null || Number.isNaN(Number(valore))) return mancante('valore del progetto');
  return `€ ${Number(valore).toLocaleString('it-IT', { minimumFractionDigits: 2, maximumFractionDigits: 2, useGrouping: 'always' })}`;
}

const testo = (v: unknown, campo: string) => (typeof v === 'string' && v.trim() ? v : mancante(campo));

/** I campi dello studio per i segnaposto `{{studio.*}}`, dall'anagrafica letta dal server (o null). */
export function datiStudioDocumento(tenantInfo: any) {
  return {
    ragioneSociale: testo(tenantInfo?.ragioneSociale, 'ragione sociale dello studio'),
    piva: testo(tenantInfo?.piva, 'partita IVA dello studio'),
    sedeLegale: testo(tenantInfo?.sedeLegale, 'sede legale dello studio'),
    iban: testo(tenantInfo?.iban, 'IBAN dello studio'),
    leadAdvisor: testo(tenantInfo?.leadAdvisorNome, 'responsabile dello studio'),
    telefono: testo(tenantInfo?.telefono, 'telefono dello studio'),
    email: testo(tenantInfo?.email, 'email dello studio'),
  };
}
