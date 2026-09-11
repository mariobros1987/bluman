/**
 * Svuota i dati di lavoro tenuti nel `localStorage` di questo browser.
 *
 * Per storia del progetto una parte del lavoro dello studio non è mai arrivata a database: è
 * rimasta nel browser di chi l'ha inserita, sotto chiavi `bluman_*`. È il motivo per cui il
 * portale del cliente — che legge il database — mostrava meno cose di quante lo studio ne
 * vedesse: non erano due letture diverse dello stesso dato, erano due archivi diversi.
 *
 * Da qui nasce un effetto pratico fastidioso: azzerare il database non basta a ripulire lo
 * schermo. I progetti cancellati sul server ricompaiono nell'elenco, perché `Projects.tsx`
 * rimette in lista la copia locale di ogni progetto che a database non trova. Per collaudare
 * davvero da zero bisogna svuotare anche questa parte.
 *
 * Si ragiona per lista di ciò che RESTA, non di ciò che si cancella: una chiave nuova
 * introdotta domani viene cancellata insieme alle altre invece di sopravvivere di nascosto e
 * falsare il collaudo successivo. Restano la sessione (altrimenti si viene buttati fuori),
 * l'identità del tenant, la configurazione dello studio e il catalogo dei modelli — le stesse
 * cose che `scripts/reset-dati-prova.mjs` tiene in piedi a database.
 */

/** Chiavi esatte che sopravvivono. */
const RESTANO_ESATTE = [
  'bluman_jwt_token',       // sessione operatore
  'bluman_portal_token',    // sessione del portale cliente
  'bluman_token',           // sessione (nome storico)
  'bluman_user',            // utente collegato
  'bluman_client_user',     // sessione del portale cliente
  'bluman_tenant_id',       // tenant corrente
  'bluman_tenant_info',     // anagrafica studio
  'bluman_logo_url',        // logo studio
  'bluman_unauthorized',    // flag di sessione scaduta
  'bluman_custom_document_templates',
  'bluman_archived_template_ids',
  'bluman_deleted_template_ids',
];

/** Prefissi che sopravvivono (la chiave finisce con un id variabile). */
const RESTANO_PREFISSI = [
  'bluman_rbac_permissions_',      // matrice permessi per utente
  'bluman_avatar_color_',
  'bluman_avatar_initials_',
  'bluman_master_templates_bundle_', // catalogo modelli per tenant
];

export function chiaviDatiLocali(): string[] {
  const trovate: string[] = [];
  for (let i = 0; i < localStorage.length; i++) {
    const chiave = localStorage.key(i);
    if (!chiave || !chiave.startsWith('bluman_')) continue;
    if (RESTANO_ESATTE.includes(chiave)) continue;
    if (RESTANO_PREFISSI.some(p => chiave.startsWith(p))) continue;
    trovate.push(chiave);
  }
  return trovate.sort();
}

/**
 * Cancella e restituisce l'elenco di ciò che è stato tolto, così chi preme il pulsante vede
 * cosa è successo invece di doversi fidare di un «fatto».
 */
export function svuotaDatiLocali(): string[] {
  const chiavi = chiaviDatiLocali();
  for (const chiave of chiavi) localStorage.removeItem(chiave);
  return chiavi;
}
