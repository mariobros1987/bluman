// Quale scheda dell'Aiuto spiega la pagina in cui ci si trova: è ciò che apre il «?» accanto al
// titolo. Le schede sono i file di `docs/manuale/` (un test verifica che esistano tutte).
const SCHEDA_PER_PAGINA: Record<string, string> = {
  '/': '21-dashboard',
  '/projects': '01-progetti-motore-stato',
  '/clients': '02-clienti',
  '/compliance': '22-coda-kyc',
  '/calendar': '14-calendario',
  '/timesheet': '27-timesheet',
  '/invoices': '05-fatture-sdi',
  '/fornitori': '23-fornitori-acquisti',
  '/liquidazione-iva': '08-lipe-iva',
  '/scadenzario': '06-scadenzario-solleciti',
  '/primanota': '07-prima-nota',
  '/banks': '24-banche-conti',
  '/retainers': '09-retainer',
  '/documents': '10-documenti',
  '/modelli': '29-cartella-modelli',
  '/archivio': '10-documenti',
  '/reports': '26-report',
  '/library': '03-libreria',
  '/audit': '28-log-audit',
  '/settings': '16-impostazioni',
  '/note-beta': '30-aiuto',
  '/admin/tenants': '31-multi-tenant-admin',
};

export const SCHEDE_AIUTO_DELLE_PAGINE: ReadonlyArray<string> = Object.values(SCHEDA_PER_PAGINA);

/** Lo slug della scheda che spiega questo indirizzo, oppure `null` (per esempio dentro l'Aiuto stesso). */
export function schedaAiutoDellaPagina(pathname: string): string | null {
  if (pathname.startsWith('/aiuto')) return null;
  if (SCHEDA_PER_PAGINA[pathname]) return SCHEDA_PER_PAGINA[pathname] ?? null;
  // Le pagine di dettaglio prendono la scheda della loro sezione: `/projects/<id>` → Progetti.
  const sezione = Object.keys(SCHEDA_PER_PAGINA).filter((p) => p !== '/' && pathname.startsWith(`${p}/`)).sort((a, b) => b.length - a.length)[0];
  return sezione ? SCHEDA_PER_PAGINA[sezione] ?? null : null;
}
