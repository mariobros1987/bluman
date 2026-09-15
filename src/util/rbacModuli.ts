// RBAC lato server: la mappa rotta → modulo della Matrice Permessi.
//
// Fino a settembre 2026 la matrice PermessoModulo era consultata solo dal
// frontend (Sidebar e guard di App nascondono le pagine): l'API restava aperta
// a chiunque avesse un JWT valido, e un collaboratore con «invoices: denied»
// poteva chiamare POST /invoices con curl. L'enforcement vive nell'hook
// onRequest di server.ts, che usa questa mappa per tradurre il pattern di
// rotta nella chiave modulo.
//
// Le chiavi sono SOLO quelle che la matrice dello studio gestisce davvero
// (OperatorDetailModal — le stesse elencate nel commento a PermessoModulo in
// schema.prisma, più «reports»): una chiave senza riga su database significa
// «nessuna restrizione» (default permissivo, vedi sotto), quindi mappare una
// rotta a una chiave che nessuno può configurare sarebbe codice morto.
// Le rotte fuori da questa mappa (auth, notifiche, documenti, portale, tenant,
// admin, webhooks, cron, fornitori, timesheet, search…) non passano dal RBAC
// per modulo: restano protette dall'autenticazione e dai guard di ruolo
// esistenti. Il criterio per allargare la mappa è sempre lo stesso: prima si
// aggiunge la chiave alla matrice lato frontend, poi qui la rotta.

/** Le chiavi modulo che la Matrice Permessi dello studio può configurare. */
export type ModuloChiaveRbac =
  | 'projects'
  | 'clients'
  | 'invoices'
  | 'scadenzario'
  | 'primanota'
  | 'banks'
  | 'retainers'
  | 'reports'
  | 'audit';

/**
 * Pattern di rotta → chiave modulo, dal più specifico al più generico: la
 * prima corrispondenza vince. Senza l'ordine, `/invoices/scadenze/:id/incassi`
 * (scadenzario) cadrebbe nel prefisso `/invoices` (fatture).
 */
const ROTTE_MODULO: ReadonlyArray<readonly [prefisso: string, modulo: ModuloChiaveRbac]> = [
  // Scadenzario e solleciti vivono sotto il prefisso /invoices ma appartengono
  // al modulo Scadenzario Incassi, non al registro fatture.
  ['/invoices/scadenzario', 'scadenzario'],
  ['/invoices/scadenze', 'scadenzario'],
  ['/invoices/solleciti', 'scadenzario'],
  // La via adapter per emettere fattura da scheda progetto: muove la
  // contabilità, non il progetto.
  ['/progetti/:id/fatture', 'invoices'],
  ['/progetti', 'projects'],
  ['/preventivi', 'projects'],
  ['/microvoci', 'projects'],
  ['/passaggi', 'projects'],
  ['/checklist', 'projects'],
  ['/operatori-suggeriti', 'projects'],
  ['/clienti', 'clients'],
  ['/invoices', 'invoices'],
  ['/fatture', 'invoices'],
  ['/contratti-ricorrenti', 'retainers'],
  ['/prima-nota', 'primanota'],
  ['/conti-bancari', 'banks'],
  ['/reports', 'reports'],
  ['/audit-logs', 'audit'],
];

/**
 * La chiave modulo cui appartiene una rotta, o undefined se la rotta non è
 * soggetta al RBAC per modulo. `patternRotta` è il pattern di Fastify
 * (`/clienti/:id`), non l'URL della richiesta: i parametri già risolti non
 * devono influire sul mapping.
 */
export function moduloDellaRotta(patternRotta: string | undefined): ModuloChiaveRbac | undefined {
  if (!patternRotta) return undefined;
  for (const [prefisso, modulo] of ROTTE_MODULO) {
    if (patternRotta === prefisso || patternRotta.startsWith(`${prefisso}/`)) return modulo;
  }
  return undefined;
}
