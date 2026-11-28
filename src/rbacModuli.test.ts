import { describe, expect, it } from 'vitest';
import { moduloDellaRotta, permessoDefaultPerRuolo, PREFISSI_VIETATI_ESTERNO, rottaVietataAllEsterno } from './util/rbacModuli.js';

// La mappa rotta → modulo è il cuore dell'enforcement RBAC: se una rotta finisce
// nel modulo sbagliato, la matrice dello studio restringe (o lascia aperto) il
// pezzo di API sbagliato. Questi test fissano i casi di confine.

describe('moduloDellaRotta — mappa pattern → chiave modulo', () => {
  it('le rotte di scadenzario e solleciti restano sotto scadenzario, non invoices', () => {
    expect(moduloDellaRotta('/invoices/scadenzario')).toBe('scadenzario');
    expect(moduloDellaRotta('/invoices/scadenze/:id/incassi')).toBe('scadenzario');
    // Lo storno di un incasso è Scadenzario come l'incasso: storna chi può incassare.
    expect(moduloDellaRotta('/invoices/scadenze/:id/incassi/:incassoId/storno')).toBe('scadenzario');
    expect(moduloDellaRotta('/invoices/scadenze/:id/anteprima-sollecito')).toBe('scadenzario');
    expect(moduloDellaRotta('/invoices/solleciti/insoluti')).toBe('scadenzario');
  });

  it('la via adapter da scheda progetto emette fatture: modulo invoices, non projects', () => {
    expect(moduloDellaRotta('/progetti/:id/fatture')).toBe('invoices');
    // Ma il resto del progetto resta projects, con e senza parametri.
    expect(moduloDellaRotta('/progetti')).toBe('projects');
    expect(moduloDellaRotta('/progetti/:id')).toBe('projects');
    expect(moduloDellaRotta('/progetti/:id/moduli/:moduloId')).toBe('projects');
    expect(moduloDellaRotta('/progetti/:id/sconto')).toBe('projects');
    // I form che il cliente compila per un articolo sono Libreria, come gli articoli.
    expect(moduloDellaRotta('/form-master')).toBe('library');
    expect(moduloDellaRotta('/form-master/:id')).toBe('library');
    // Eccezione speculare, dallo stesso criterio: la chat del cliente è materia del modulo
    // Comunicazioni, non del progetto. «Segna come letto» invece resta un'azione di servizio
    // sulla scheda — se stesse su communications, chi ha `read` non riuscirebbe mai a spegnere
    // la campanella, perché `read` blocca ogni metodo diverso da GET/HEAD.
    expect(moduloDellaRotta('/progetti/:id/comunicazioni')).toBe('communications');
    expect(moduloDellaRotta('/progetti/:id/comunicazioni/segna-lette')).toBe('projects');
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

  it('documents, library e communications passano dalla matrice (enforcement server §01/§06)', () => {
    expect(moduloDellaRotta('/documenti')).toBe('documents');
    expect(moduloDellaRotta('/documenti/:id')).toBe('documents');
    expect(moduloDellaRotta('/documenti/:id/firma-studio')).toBe('documents');
    expect(moduloDellaRotta('/documenti-template')).toBe('documents');
    expect(moduloDellaRotta('/moduli-template')).toBe('library');
    expect(moduloDellaRotta('/articoli')).toBe('library');
    expect(moduloDellaRotta('/comunicazioni/invia-email')).toBe('communications');
    expect(moduloDellaRotta('/comunicazioni/invia-whatsapp')).toBe('communications');
  });

  it('voce 4 — anche la LETTURA della casella passa dalla matrice, come l\'invio (09/10/2026)', () => {
    // Prima erano mappate le sole quattro rotte di invio, e la lettura della posta in ingresso
    // restava libera: un collaboratore con `communications: denied` non poteva scrivere ai
    // clienti ma poteva leggere tutta la loro corrispondenza chiamando queste rotte con curl.
    // Non era una scelta, era un'asimmetria che nessuno aveva chiesto.
    expect(moduloDellaRotta('/comunicazioni/email-in-arrivo')).toBe('communications');
    expect(moduloDellaRotta('/comunicazioni/poll-imap-allegati')).toBe('communications');
    expect(moduloDellaRotta('/comunicazioni/signal-in-arrivo')).toBe('communications');
    // Il fascicolo dentro le schede è la stessa conversazione del cliente, quindi lo stesso modulo.
    expect(moduloDellaRotta('/progetti/:id/comunicazioni')).toBe('communications');
    expect(moduloDellaRotta('/microvoci/:id/comunicazioni')).toBe('communications');
  });

  it('ciclo passivo e liquidazione IVA seguono la chiave invoices, come nel menu', () => {
    // Fino al 18/11/2026 questo file affermava il contrario (`toBeUndefined`): l'app nascondeva
    // le pagine a chi aveva invoices=denied, ma le API rispondevano a qualunque collaboratore.
    expect(moduloDellaRotta('/fornitori')).toBe('invoices');
    expect(moduloDellaRotta('/fornitori/:id')).toBe('invoices');
    expect(moduloDellaRotta('/fatture-ricevute')).toBe('invoices');
    expect(moduloDellaRotta('/fatture-ricevute/:id/paga')).toBe('invoices');
    expect(moduloDellaRotta('/fatture-ricevute/import-xml')).toBe('invoices');
    expect(moduloDellaRotta('/liquidazione-iva')).toBe('invoices');
    expect(moduloDellaRotta('/liquidazione-iva/:periodo/marca-versata')).toBe('invoices');
  });

  it('le rotte fuori dalla matrice non passano dal RBAC per modulo', () => {
    // Hanno i loro guard (autenticazione, ruolo cliente, segreti webhook):
    // mapparle a chiavi che la matrice non gestisce sarebbe codice morto.
    expect(moduloDellaRotta('/auth/me')).toBeUndefined();
    expect(moduloDellaRotta('/tenant/utenti')).toBeUndefined();
    expect(moduloDellaRotta('/admin/tenants')).toBeUndefined();
    expect(moduloDellaRotta('/timesheet')).toBeUndefined();
    expect(moduloDellaRotta('/search')).toBeUndefined();
    expect(moduloDellaRotta('/portal/fatture')).toBeUndefined();
    // Reference-data condivise fuori mappa di proposito (servono al wizard anche a chi non ha 'library').
    expect(moduloDellaRotta('/giurisdizioni')).toBeUndefined();
    expect(moduloDellaRotta(undefined)).toBeUndefined();
  });

  it('un prefisso simile ma diverso non cattura la rotta', () => {
    // startsWith nudo farebbe cadere /progettistica in projects.
    expect(moduloDellaRotta('/progettistica')).toBeUndefined();
    expect(moduloDellaRotta('/clienti-privati/:id')).toBeUndefined();
  });
});

describe('rottaVietataAllEsterno — rotte fuori matrice chiuse al collaboratore esterno (A2)', () => {
  it.each(PREFISSI_VIETATI_ESTERNO.map((p) => [p]))('%s e le sue sotto-rotte sono vietate', (prefisso) => {
    expect(rottaVietataAllEsterno(prefisso)).toBe(true);
    expect(rottaVietataAllEsterno(`${prefisso}/:id`)).toBe(true);
  });

  it('un prefisso simile ma diverso non è vietato', () => {
    expect(rottaVietataAllEsterno('/kyc-pubblico')).toBe(false);
    expect(rottaVietataAllEsterno('/firme-digitali')).toBe(false);
    expect(rottaVietataAllEsterno('/contabilita/anteprima-fascicolo-commercialista-bis')).toBe(false);
  });

  it('le rotte di lavoro del collaboratore restano libere', () => {
    expect(rottaVietataAllEsterno('/progetti/:id')).toBe(false);
    expect(rottaVietataAllEsterno('/documenti')).toBe(false);
    expect(rottaVietataAllEsterno(undefined)).toBe(false);
  });
});

// L'accentratore delle mail ha una chiave sua: dentro c'è tutta la posta di un cliente, non la sua
// conversazione con lo studio, quindi non eredita il default «write» di `communications`.
describe('posta dei clienti — chiave `posta`, negata finché lo studio non la concede', () => {
  it('ogni rotta /posta passa dalla matrice con la chiave posta, non communications', () => {
    expect(moduloDellaRotta('/posta/messaggi')).toBe('posta');
    expect(moduloDellaRotta('/posta/messaggi/:id')).toBe('posta');
    expect(moduloDellaRotta('/posta/caselle/:id/scollega')).toBe('posta');
    expect(moduloDellaRotta('/posta/clienti/:id/inoltro')).toBe('posta');
    // Un prefisso simile non la cattura.
    expect(moduloDellaRotta('/postali')).toBeUndefined();
  });

  it('senza una riga in matrice la vede solo chi risponde dello studio', () => {
    expect(permessoDefaultPerRuolo('advisor', 'posta')).toBe('write');
    expect(permessoDefaultPerRuolo('collaboratore_interno', 'posta')).toBe('denied');
    expect(permessoDefaultPerRuolo('operator', 'posta')).toBe('denied');
    expect(permessoDefaultPerRuolo('collaboratore_esterno', 'posta')).toBe('denied');
  });

  it('il collaboratore esterno è fuori prima della matrice: nessuna riga gliela apre', () => {
    expect(rottaVietataAllEsterno('/posta')).toBe(true);
    expect(rottaVietataAllEsterno('/posta/messaggi/:id')).toBe(true);
  });
});
