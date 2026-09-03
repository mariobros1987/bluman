/**
 * Punto 3 piano gap — un documento firmato dal cliente non si cancella MAI, per nessuno
 * (nemmeno per l'admin dello studio): l'unica uscita è l'archiviazione. E un modulo di
 * progetto non può più morire con un 500 opaco quando lo si elimina (FK RESTRICT su
 * micro-voci/accessi/dipendenze): la cancellazione ora rimuove lo scaffolding in
 * transazione, con i guard 409 per le ore consuntivate e le righe di fattura.
 *
 * Il client Prisma è mockato (come in accessoCliente.test.ts) perché tutti questi
 * endpoint parlano col database: senza mock non si potrebbe osservare cosa accade
 * *dopo* la lettura del documento, cioè dove stanno i guard.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';

/** Stato restituito dal finto client, riscritto da ogni test prima dell'uso. */
const stato = {
  documento: null as any,
  firmeCollegate: 0,
  otpPendenti: 0,
  modulo: null as any,
  righeFattura: 0,
  // Registri per asserire cosa il server ha scritto davvero.
  documentiCancellati: [] as string[],
  documentiAggiornati: [] as any[],
  moduliCancellati: [] as string[],
  microvociCancellate: [] as string[],
  audit: [] as any[],
};

vi.mock('./util/prismaClient.js', async importOriginal => {
  const reale = await importOriginal<typeof import('./util/prismaClient.js')>();

  const finto: any = {
    documento: {
      findFirst: async () => stato.documento,
      update: async (args: any) => {
        stato.documentiAggiornati.push(args);
        return { ...stato.documento, ...args.data };
      },
      updateMany: async () => ({ count: 0 }),
      delete: async (args: any) => {
        stato.documentiCancellati.push(args.where.id);
        return stato.documento;
      },
    },
    firmaElettronica: { count: async () => stato.firmeCollegate },
    codiceOtp: { count: async () => stato.otpPendenti },
    richiestaModificaDocumento: { deleteMany: async () => ({ count: 0 }) },
    passaggioProgetto: {
      updateMany: async () => ({ count: 0 }),
      deleteMany: async () => ({ count: 0 }),
    },
    moduloProgetto: {
      findFirst: async () => stato.modulo,
      delete: async (args: any) => {
        stato.moduliCancellati.push(args.where.id);
        return stato.modulo;
      },
    },
    fatturaRiga: { count: async () => stato.righeFattura },
    accessoRisorsa: { deleteMany: async () => ({ count: 0 }) },
    microvoceProgetto: {
      deleteMany: async (args: any) => {
        stato.microvociCancellate.push(...(args.where?.id?.in ?? []));
        return { count: 0 };
      },
    },
    moduloProgettoDipendenza: { deleteMany: async () => ({ count: 0 }) },
    auditLog: {
      create: async (args: any) => {
        stato.audit.push(args.data);
        return {};
      },
    },
    // La transazione interattiva del delete modulo esegue il callback sullo stesso client.
    $transaction: async (fn: any) => (typeof fn === 'function' ? fn(finto) : fn),
  };

  return { ...reale, prisma: finto, prismaAmministrativo: () => finto };
});

// Importati dopo `vi.mock`: `server.js` risolve `prismaClient.js` al proprio import.
const { buildServer } = await import('./server.js');
const { InMemoryApp } = await import('./adapters/inMemoryApp.js');
const { signJwt } = await import('./util/jwt.js');

const TENANT_STUDIO = '00000000-0000-0000-0000-000000000001';

function tokenAdvisor() {
  return signJwt({ userId: 'usr-advisor', tenantId: TENANT_STUDIO, email: 'advisor@studio.example', ruolo: 'advisor' });
}

function tokenSuperAdmin() {
  // In produzione il super_admin ha tenant_id NULL a database, ma il JWT porta comunque
  // un tenantId (l'hook di autenticazione dei super_admin usa il tenant di default).
  return signJwt({ userId: 'usr-super', tenantId: TENANT_STUDIO, email: 'super@studio.example', ruolo: 'super_admin' });
}

function tokenCliente() {
  return signJwt({
    userId: 'client-cli-42',
    tenantId: TENANT_STUDIO,
    email: 'cliente@esempio.it',
    ruolo: 'cliente',
  });
}

function serverConToken(token: string | null) {
  const server = buildServer(new InMemoryApp());
  const injectOriginale = server.inject.bind(server);
  (server as any).inject = (opts: any) =>
    injectOriginale({
      ...opts,
      headers: { ...(token ? { authorization: `Bearer ${token}` } : {}), ...(opts?.headers || {}) },
    });
  return server;
}

function documentoBase(overrides: Record<string, unknown> = {}) {
  return {
    id: 'doc-1',
    tenantId: TENANT_STUDIO,
    fileUrl: 'contratto.pdf',
    statoDoc: 'bozza',
    isArchiviato: false,
    ...overrides,
  };
}

beforeEach(() => {
  stato.documento = null;
  stato.firmeCollegate = 0;
  stato.otpPendenti = 0;
  stato.modulo = null;
  stato.righeFattura = 0;
  stato.documentiCancellati = [];
  stato.documentiAggiornati = [];
  stato.moduliCancellati = [];
  stato.microvociCancellate = [];
  stato.audit = [];
});

describe('Punto 3 — DELETE /documenti/:id su documento firmato', () => {
  it('senza token rifiuta: 401', async () => {
    const server = serverConToken(null);
    const res = await server.inject({ method: 'DELETE', url: '/documenti/doc-1' });
    expect(res.statusCode).toBe(401);
  });

  it('rifiuta con 409 anche al super_admin: un documento firmato non si elimina per nessuno', async () => {
    stato.documento = documentoBase({ statoDoc: 'firmato' });
    const server = serverConToken(tokenSuperAdmin());
    const res = await server.inject({ method: 'DELETE', url: '/documenti/doc-1' });
    expect(res.statusCode).toBe(409);
    expect(res.json().errore).toBe('Il documento è firmato dal cliente: non può essere eliminato, solo archiviato.');
    expect(stato.documentiCancellati).toHaveLength(0);
  });

  it('rifiuta con 409 anche all\'advisor dello studio', async () => {
    stato.documento = documentoBase({ statoDoc: 'firmato' });
    const server = serverConToken(tokenAdvisor());
    const res = await server.inject({ method: 'DELETE', url: '/documenti/doc-1' });
    expect(res.statusCode).toBe(409);
    expect(stato.documentiCancellati).toHaveLength(0);
  });

  it('un sigillo collegato blocca l\'eliminazione anche se lo stato non è tornato "firmato"', async () => {
    stato.documento = documentoBase({ statoDoc: 'pubblicato' });
    stato.firmeCollegate = 1;
    const server = serverConToken(tokenAdvisor());
    const res = await server.inject({ method: 'DELETE', url: '/documenti/doc-1' });
    expect(res.statusCode).toBe(409);
    expect(res.json().errore).toMatch(/collegata una firma elettronica/);
    expect(stato.documentiCancellati).toHaveLength(0);
  });

  it('un codice di firma ancora pendente blocca l\'eliminazione', async () => {
    stato.documento = documentoBase({ statoDoc: 'pubblicato' });
    stato.otpPendenti = 1;
    const server = serverConToken(tokenAdvisor());
    const res = await server.inject({ method: 'DELETE', url: '/documenti/doc-1' });
    expect(res.statusCode).toBe(409);
    expect(res.json().errore).toMatch(/codice di firma in attesa/);
    expect(stato.documentiCancellati).toHaveLength(0);
  });

  it('un documento non firmato, senza firme né OTP pendenti, viene eliminato davvero', async () => {
    stato.documento = documentoBase({ statoDoc: 'bozza' });
    const server = serverConToken(tokenAdvisor());
    const res = await server.inject({ method: 'DELETE', url: '/documenti/doc-1' });
    expect(res.statusCode).toBe(200);
    expect(res.json().ok).toBe(true);
    expect(stato.documentiCancellati).toEqual(['doc-1']);
    expect(stato.audit.some(a => a.azione === 'DOCUMENTO_RIMOSSO')).toBe(true);
  });

  it('documento inesistente → 404', async () => {
    stato.documento = null;
    const server = serverConToken(tokenAdvisor());
    const res = await server.inject({ method: 'DELETE', url: '/documenti/doc-inesistente' });
    expect(res.statusCode).toBe(404);
  });
});

describe('Punto 3 — PATCH /documenti/:id/archivia', () => {
  it('il cliente non può archiviare: 403', async () => {
    stato.documento = documentoBase({ statoDoc: 'firmato' });
    const server = serverConToken(tokenCliente());
    const res = await server.inject({ method: 'PATCH', url: '/documenti/doc-1/archivia' });
    expect(res.statusCode).toBe(403);
    expect(res.json().errore).toBe("Solo l'amministratore dello studio può archiviare un documento.");
    expect(stato.documentiAggiornati).toHaveLength(0);
  });

  it('un operatore semplice non può archiviare: 403', async () => {
    stato.documento = documentoBase({ statoDoc: 'firmato' });
    const tokenOperatore = signJwt({
      userId: 'usr-oper',
      tenantId: TENANT_STUDIO,
      email: 'operatore@studio.example',
      ruolo: 'collaboratore_interno',
    });
    const server = serverConToken(tokenOperatore);
    const res = await server.inject({ method: 'PATCH', url: '/documenti/doc-1/archivia' });
    expect(res.statusCode).toBe(403);
  });

  it('documento inesistente → 404', async () => {
    stato.documento = null;
    const server = serverConToken(tokenAdvisor());
    const res = await server.inject({ method: 'PATCH', url: '/documenti/doc-inesistente/archivia' });
    expect(res.statusCode).toBe(404);
  });

  it('l\'advisor archivia un documento firmato: resta a database, marcato archiviato, con audit', async () => {
    stato.documento = documentoBase({ statoDoc: 'firmato' });
    const server = serverConToken(tokenAdvisor());
    const res = await server.inject({ method: 'PATCH', url: '/documenti/doc-1/archivia' });
    expect(res.statusCode).toBe(200);
    expect(res.json().ok).toBe(true);
    expect(stato.documentiCancellati).toHaveLength(0);
    expect(stato.documentiAggiornati).toHaveLength(1);
    const aggiornamento = stato.documentiAggiornati[0];
    expect(aggiornamento.where).toEqual({ id: 'doc-1' });
    expect(aggiornamento.data.isArchiviato).toBe(true);
    expect(aggiornamento.data.archiviatoDaId).toBe('usr-advisor');
    expect(stato.audit.some(a => a.azione === 'DOCUMENTO_ARCHIVIATO')).toBe(true);
  });

  it('ri-archiviare un documento già archiviato è idempotente: nessuna scrittura', async () => {
    stato.documento = documentoBase({ statoDoc: 'firmato', isArchiviato: true });
    const server = serverConToken(tokenAdvisor());
    const res = await server.inject({ method: 'PATCH', url: '/documenti/doc-1/archivia' });
    expect(res.statusCode).toBe(200);
    expect(res.json().messaggio).toBe('Il documento era già archiviato.');
    expect(stato.documentiAggiornati).toHaveLength(0);
  });
});

describe('Fix produzione — DELETE /progetti/:id/moduli/:moduloId', () => {
  const URL_MODULO = '/progetti/proj-1/moduli/mod-1';

  it('il cliente non può eliminare moduli: 403', async () => {
    const server = serverConToken(tokenCliente());
    const res = await server.inject({ method: 'DELETE', url: URL_MODULO });
    expect(res.statusCode).toBe(403);
  });

  it('modulo inesistente → 404', async () => {
    stato.modulo = null;
    const server = serverConToken(tokenAdvisor());
    const res = await server.inject({ method: 'DELETE', url: URL_MODULO });
    expect(res.statusCode).toBe(404);
  });

  it('un modulo con ore consuntivate non si elimina: 409 leggibile', async () => {
    stato.modulo = {
      id: 'mod-1',
      nome: 'Contabilità',
      microvoci: [
        { id: 'mv-1', nome: 'Registrazione fatture', oreConsuntivate: 3.5 },
        { id: 'mv-2', nome: 'Liquidazioni', oreConsuntivate: 0 },
      ],
    };
    const server = serverConToken(tokenAdvisor());
    const res = await server.inject({ method: 'DELETE', url: URL_MODULO });
    expect(res.statusCode).toBe(409);
    expect(res.json().errore).toBe('Il modulo «Contabilità» ha 3.5 ore consuntivate e non può essere eliminato. Azzerare prima le ore.');
    expect(stato.moduliCancellati).toHaveLength(0);
  });

  it('un modulo richiamato in fattura non si elimina: 409', async () => {
    stato.modulo = { id: 'mod-1', nome: 'Bilanci', microvoci: [{ id: 'mv-1', nome: 'Bozza', oreConsuntivate: 0 }] };
    stato.righeFattura = 2;
    const server = serverConToken(tokenAdvisor());
    const res = await server.inject({ method: 'DELETE', url: URL_MODULO });
    expect(res.statusCode).toBe(409);
    expect(res.json().errore).toBe('Il modulo «Bilanci» è richiamato in 2 righe di fattura e non può essere eliminato.');
    expect(stato.moduliCancellati).toHaveLength(0);
  });

  it('un modulo pulito viene eliminato in transazione insieme allo scaffolding (micro-voci comprese): niente più 500 da FK RESTRICT', async () => {
    stato.modulo = {
      id: 'mod-1',
      nome: 'Adempimenti',
      microvoci: [
        { id: 'mv-1', nome: 'IVA', oreConsuntivate: 0 },
        { id: 'mv-2', nome: 'ISA', oreConsuntivate: 0 },
      ],
    };
    const server = serverConToken(tokenAdvisor());
    const res = await server.inject({ method: 'DELETE', url: URL_MODULO });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ ok: true, moduloId: 'mod-1' });
    // Prima le micro-voci (FK RESTRICT), poi il modulo: l'ordine che evita il P2003.
    expect(stato.microvociCancellate).toEqual(['mv-1', 'mv-2']);
    expect(stato.moduliCancellati).toEqual(['mod-1']);
    expect(stato.audit.some(a => a.azione === 'MODULO_ELIMINATO')).toBe(true);
  });
});
