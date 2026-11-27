// Il nome di ogni pagina: lo usano la barra in alto e la raccolta delle note della beta.
// Le chiavi sono gli indirizzi; le pagine con un identificativo nel percorso hanno il loro ramo
// in `titoloDellaPagina`.
export const TITOLI_PAGINE: Record<string, string> = {
  '/':          'Dashboard',
  '/projects':  'Progetti',
  '/clients':   'Clienti',
  '/compliance': 'Coda KYC / AML',
  '/calendar':  'Calendario',
  '/library':   'Libreria moduli',
  '/settings':  'Impostazioni',
  '/invoices':  'Fatture & SDI',
  '/documents': 'Document Studio',
  '/modelli':   'Cartella Modelli dello Studio',
  '/archivio':  'Archivio Documentale',
  '/audit':     'Log Audit',
  '/timesheet': 'Timesheet ore',
  // Senza questa riga la barra in alto direbbe «BluMan», cioè il nome dell'app al posto del nome
  // della pagina.
  '/aiuto':     'Aiuto',
  // Le pagine di contabilità e le altre che mancavano: in alto compariva «BluMan».
  '/fornitori': 'Fornitori e acquisti',
  '/liquidazione-iva': 'Liquidazione IVA',
  '/scadenzario': 'Scadenzario incassi',
  '/primanota': 'Prima Nota',
  '/banks':     'Banche e conti',
  '/retainers': 'Contratti Retainer',
  '/reports':   'Report',
  '/note-beta': 'Note della beta',
  '/admin/tenants': 'Multi-Tenant Admin',
};

/** Il nome della pagina per un indirizzo, esatto («/projects/6a3b…») o generale («/projects/:id»). */
export function titoloDellaPagina(percorso: string): string {
  return TITOLI_PAGINE[percorso]
    || (percorso.startsWith('/projects/') ? 'Dettaglio Progetto' : null)
    || (percorso.startsWith('/aiuto/') ? 'Aiuto' : null)
    || 'BluMan';
}
