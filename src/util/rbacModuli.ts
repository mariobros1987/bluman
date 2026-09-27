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
// schema.prisma, più «reports»): una chiave senza riga su database ricade sul
// default per ruolo (`permessoDefaultPerRuolo`, allineato al frontend), non su
// «accesso pieno», quindi mappare una rotta a una chiave che nessuno può
// configurare non è codice morto — l'advisor passa comunque, i collaboratori
// partono ristretti.
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
  | 'communications'
  | 'documents'
  | 'library'
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
  // L'invio dai canali dello studio è governato dalla matrice: l'admin decide, per ogni
  // collaboratore (interno o esterno), chi può spedire (write), chi solo consultare la chat
  // (read → il POST di invio è bloccato) e chi no (denied). Nessuna riga = permesso (default).
  // Solo le rotte di INVIO, non quelle in arrivo. La lettura fascicolo comunicazioni resta libera.
  ['/comunicazioni/invia-email', 'communications'],
  ['/comunicazioni/invia-whatsapp', 'communications'],
  ['/comunicazioni/invia-signal', 'communications'],
  ['/comunicazioni/invia-telegram', 'communications'],
  // Vault documentale e Document Studio (§01): la matrice vale anche via API, non solo nell'UI. Un
  // collaboratore con documents=read consulta ma non carica/firma/elimina; denied blocca; write pieno.
  // NB: il portale cliente (/portal/documenti) NON è qui (ruolo cliente, gestito a parte).
  ['/documenti-template', 'documents'],
  ['/documenti', 'documents'],
  // Libreria: catalogo articoli e moduli template (gestione). GET resta consentito con read; le
  // reference-data condivise (giurisdizioni) restano fuori dalla mappa per non rompere il wizard.
  ['/moduli-template', 'library'],
  ['/articoli', 'library'],
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

export type LivelloPermesso = 'denied' | 'read' | 'write';

/**
 * Default per ruolo quando NON esiste una riga `PermessoModulo`, allineato a `getUserPermission` del
 * frontend (`frontend/src/utils/rbac.ts`). Chiude il buco «server default permissivo ⇄ UI restrittiva
 * per ruolo»: prima «nessuna riga» = accesso pieno lato API, e un collaboratore_esterno senza matrice
 * configurata poteva leggere via API IBAN/CF/UBO di tutti i clienti (rilievo audit sicurezza, Alta).
 * `super_admin` non passa di qui (bypassa a monte nell'hook); il ruolo `cliente` ha il suo guard.
 * L'advisor resta pieno su tutto tranne l'audit.
 */
export function permessoDefaultPerRuolo(ruolo: string | undefined, modulo: ModuloChiaveRbac): LivelloPermesso {
  if (ruolo === 'advisor') {
    return modulo === 'audit' ? 'denied' : 'write';
  }
  if (ruolo === 'collaboratore_interno' || ruolo === 'operator') {
    if (modulo === 'projects' || modulo === 'communications') return 'write';
    if (modulo === 'clients' || modulo === 'documents' || modulo === 'library') return 'read';
    return 'denied';
  }
  if (ruolo === 'collaboratore_esterno') {
    if (modulo === 'projects' || modulo === 'communications') return 'write';
    if (modulo === 'documents') return 'read';
    return 'denied';
  }
  return 'denied';
}
