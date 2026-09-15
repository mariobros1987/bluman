import { describe, expect, it } from 'vitest';
import { moduloDellaRotta } from './util/rbacModuli.js';

// La mappa rotta → modulo è il cuore dell'enforcement RBAC: se una rotta finisce
// nel modulo sbagliato, la matrice dello studio restringe (o lascia aperto) il
// pezzo di API sbagliato. Questi test fissano i casi di confine.

describe('moduloDellaRotta — mappa pattern → chiave modulo', () => {
  it('le rotte di scadenzario e solleciti restano sotto scadenzario, non invoices', () => {
    expect(moduloDellaRotta('/invoices/scadenzario')).toBe('scadenzario');
    expect(moduloDellaRotta('/invoices/scadenze/:id/incassi')).toBe('scadenzario');
    expect(moduloDellaRotta('/invoices/scadenze/:id/anteprima-sollecito')).toBe('scadenzario');
    expect(moduloDellaRotta('/invoices/solleciti/insoluti')).toBe('scadenzario');
  });

  it('la via adapter da scheda progetto emette fatture: modulo invoices, non projects', () => {
    expect(moduloDellaRotta('/progetti/:id/fatture')).toBe('invoices');
    // Ma il resto del progetto resta projects, con e senza parametri.
    expect(moduloDellaRotta('/progetti')).toBe('projects');
    expect(moduloDellaRotta('/progetti/:id')).toBe('projects');
    expect(moduloDellaRotta('/progetti/:id/moduli/:moduloId')).toBe('projects');
  });

  it('mappa i prefissi dei moduli della matrice', () => {
    expect(moduloDellaRotta('/clienti')).toBe('clients');
    expect(moduloDellaRotta('/clienti/:id')).toBe('clients');
    expect(moduloDellaRotta('/invoices')).toBe('invoices');
    expect(moduloDellaRotta('/invoices/:id/emetti')).toBe('invoices');
    expect(moduloDellaRotta('/fatture/tutte')).toBe('invoices');
    expect(moduloDellaRotta('/contratti-ricorrenti/:id/genera-fattura')).toBe('retainers');
    expect(moduloDellaRotta('/prima-nota/import-csv')).toBe('primanota');
    expect(moduloDellaRotta('/conti-bancari')).toBe('banks');
    expect(moduloDellaRotta('/reports/:tipo/export')).toBe('reports');
    expect(moduloDellaRotta('/audit-logs')).toBe('audit');
  });

  it('le rotte fuori dalla matrice non passano dal RBAC per modulo', () => {
    // Hanno i loro guard (autenticazione, ruolo cliente, segreti webhook):
    // mapparle a chiavi che la matrice non gestisce sarebbe codice morto.
    expect(moduloDellaRotta('/auth/me')).toBeUndefined();
    expect(moduloDellaRotta('/documenti')).toBeUndefined();
    expect(moduloDellaRotta('/documenti/:id')).toBeUndefined();
    expect(moduloDellaRotta('/tenant/utenti')).toBeUndefined();
    expect(moduloDellaRotta('/admin/tenants')).toBeUndefined();
    expect(moduloDellaRotta('/fornitori')).toBeUndefined();
    expect(moduloDellaRotta('/fatture-ricevute')).toBeUndefined();
    expect(moduloDellaRotta('/timesheet')).toBeUndefined();
    expect(moduloDellaRotta('/search')).toBeUndefined();
    expect(moduloDellaRotta('/portal/fatture')).toBeUndefined();
    expect(moduloDellaRotta(undefined)).toBeUndefined();
  });

  it('un prefisso simile ma diverso non cattura la rotta', () => {
    // startsWith nudo farebbe cadere /progettistica in projects.
    expect(moduloDellaRotta('/progettistica')).toBeUndefined();
    expect(moduloDellaRotta('/clienti-privati/:id')).toBeUndefined();
  });
});
