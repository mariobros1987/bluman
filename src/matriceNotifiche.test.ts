/**
 * Punto 4 piano gap — matrice dei trigger di notifica.
 *
 * Copre le righe della matrice che prima restavano mute (solo audit log, campanella
 * silenziosa) più i due gap simmetrici cliente→studio:
 *
 *   cliente → studio (evento `messaggio_cliente`):
 *   - richiesta di modifica su un documento pubblicato;
 *   - richiesta di addendum su un progetto;
 *   - proposta di modifica dei dati anagrafici.
 *
 *   studio → cliente (eventi nuovi `risposta_addendum` / `risposta_proposta_dati`):
 *   - addendum portato a 'pronta' o 'rifiutata' (ma NON 'in_preparazione': rumore interno);
 *   - proposta dati confermata o rifiutata (con motivazione se scritta).
 *
 * Harness identico a verbaleFirma.test.ts: client Prisma mockato (nessun tocco di
 * Supabase), `user.findMany` restituisce un utente attivo così `notificaStudio` scrive
 * davvero le righe nel registro `stato.notifiche`.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';

/** Stato restituito dal finto client, riscritto da ogni test prima dell'uso. */
const stato = {
  cliente: null as any,
  documento: null as any,
  progetto: null as any,
  propostaPendente: null as any,
  proposta: null as any,
  richiestaAddendum: null as any,
  // Registri per asserire cosa il server ha scritto davvero.
  notifiche: [] as any[],
  audit: [] as any[],
};

vi.mock('./util/prismaClient.js', async importOriginal => {
  const reale = await importOriginal<typeof import('./util/prismaClient.js')>();

  const finto: any = {
    cliente: {
      findFirst: async (args: any) =>
        args?.select?.sessionVersion && args?.where?.id === CLIENTE_ID
          ? { id: CLIENTE_ID, tenantId: TENANT_STUDIO, sessionVersion: 0 }
          : stato.cliente,
      update: async (args: any) => ({ ...stato.cliente, ...args.data }),
    },
    documento: {
      findFirst: async () => stato.documento,
      update: async (args: any) => ({ ...stato.documento, ...args.data }),
    },
    progetto: { findFirst: async () => stato.progetto },
    propostaDatiFiscale: {
      findFirst: async () => stato.proposta ?? stato.propostaPendente,
      create: async (args: any) => ({ ...args.data, id: 'pdf-1' }),
      update: async (args: any) => ({ ...(stato.proposta ?? stato.propostaPendente), ...args.data }),
    },
    richiestaAddendum: {
      findFirst: async () => stato.richiestaAddendum,
      create: async (args: any) => ({ ...args.data, id: 'add-1', progetto: stato.progetto }),
      update: async (args: any) => ({ ...stato.richiestaAddendum, ...args.data }),
    },
    richiestaModificaDocumento: {
      create: async (args: any) => ({ ...args.data, id: 'rm-1' }),
    },
    // Un utente attivo del tenant: senza, notificaStudio uscirebbe subito senza scrivere.
    user: {
      findFirst: async (args: any) =>
        args?.where?.id === 'usr-advisor'
          ? { id: 'usr-advisor', tenantId: TENANT_STUDIO, ruolo: 'advisor', stato: 'attivo', sessionVersion: 0 }
          : null,
      findMany: async () => [{ id: 'usr-advisor' }],
    },
    notifica: {
      create: async (args: any) => {
        stato.notifiche.push(args.data);
        return { id: `not-${stato.notifiche.length}`, ...args.data };
      },
    },
    auditLog: {
      create: async (args: any) => {
        stato.audit.push(args.data);
        return {};
      },
    },
    $transaction: async (fn: any) => (typeof fn === 'function' ? fn(finto) : Promise.all(fn)),
  };

  return { ...reale, prisma: finto, prismaAmministrativo: () => finto };
});

// Come in verbaleFirma.test.ts: l'import del server non deve toccare lo storage reale.
vi.mock('./services/storageService.js', async importOriginal => {
  const reale = await importOriginal<typeof import('./services/storageService.js')>();
  return {
    ...reale,
    uploadDocumento: async (filename: string) => ({
      ok: true,
      url: `https://storage.example/${filename}`,
      name: filename,
      size: '1 KB',
    }),
  };
});

// Importati dopo `vi.mock`: `server.js` risolve i moduli mockati al proprio import.
const { buildServer } = await import('./server.js');
const { InMemoryApp } = await import('./adapters/inMemoryApp.js');
const { signJwt } = await import('./util/jwt.js');

const TENANT_STUDIO = '00000000-0000-0000-0000-000000000001';
const CLIENTE_ID = 'cli-42';

function tokenCliente() {
  return signJwt({
    userId: `client-${CLIENTE_ID}`,
    tenantId: TENANT_STUDIO,
    email: 'cliente@esempio.it',
    ruolo: 'cliente',
    sessionVersion: 0,
  });
}

function tokenAdvisor() {
  return signJwt({
    userId: 'usr-advisor',
    tenantId: TENANT_STUDIO,
    email: 'advisor@studio.example',
    ruolo: 'advisor',
    sessionVersion: 0,
  });
}

function serverConToken(token: string) {
  const server = buildServer(new InMemoryApp());
  const injectOriginale = server.inject.bind(server);
  (server as any).inject = (opts: any) =>
    injectOriginale({
      ...opts,
      headers: { authorization: `Bearer ${token}`, ...(opts?.headers || {}) },
    });
  return server;
}

const PROGETTO_BASE = { id: 'prj-1', nome: 'Progetto Alpha' };
const CLIENTE_BASE = {
  id: CLIENTE_ID,
  nome: 'Rossi Costruzioni SRL',
  piva: '01234567890',
  codiceFiscale: 'RSSMRA80A01H501U',
  iban: 'IT60X0542811101000000123456',
  ubo: null,
  sedeLegale: 'Via Roma 1',
  referentiJson: {},
};

beforeEach(() => {
  stato.cliente = null;
  stato.documento = null;
  stato.progetto = null;
  stato.propostaPendente = null;
  stato.proposta = null;
  stato.richiestaAddendum = null;
  stato.notifiche = [];
  stato.audit = [];
});

describe('Punto 4 — trigger cliente → studio (messaggio_cliente)', () => {
  it('la richiesta di modifica su un documento avvisa lo studio con link al progetto', async () => {
    stato.documento = {
      id: 'doc-1',
      fileUrl: 'https://storage.example/contratto.pdf',
      tipo: 'compilato',
      progetto: { id: PROGETTO_BASE.id, nome: PROGETTO_BASE.nome, cliente: { nome: CLIENTE_BASE.nome } },
      microvoceProgetto: null,
      caricatoDaUser: null,
    };
    const server = serverConToken(tokenCliente());

    const res = await server.inject({
      method: 'POST',
      url: '/portal/documenti/doc-1/richiesta-modifica',
      payload: { commento: 'Cambiare la data di scadenza del pagamento' },
    });

    expect(res.statusCode).toBe(200);
    const notifica = stato.notifiche.find((n) => n.tipoEvento === 'messaggio_cliente');
    expect(notifica).toBeTruthy();
    expect(notifica.destinatarioId).toBe('usr-advisor');
    expect(notifica.destinatarioTipo).toBe('user');
    expect(notifica.oggetto).toBe('Richiesta di modifica documento');
    expect(notifica.corpo).toContain('Rossi Costruzioni SRL');
    expect(notifica.corpo).toContain('Cambiare la data di scadenza');
    expect(notifica.link).toBe('/projects/prj-1');
  });

  it('la richiesta di addendum avvisa lo studio con link al progetto', async () => {
    stato.progetto = PROGETTO_BASE;
    stato.cliente = { nome: CLIENTE_BASE.nome };
    const server = serverConToken(tokenCliente());

    const res = await server.inject({
      method: 'POST',
      url: '/portal/addendum',
      payload: { progettoId: 'prj-1', testoRichiesta: 'Aggiungere la consulenza IVA trimestrale' },
    });

    expect(res.statusCode).toBe(201);
    const notifica = stato.notifiche.find((n) => n.tipoEvento === 'messaggio_cliente');
    expect(notifica).toBeTruthy();
    expect(notifica.destinatarioId).toBe('usr-advisor');
    expect(notifica.oggetto).toBe('Richiesta di addendum');
    expect(notifica.corpo).toContain('Rossi Costruzioni SRL');
    expect(notifica.corpo).toContain('Progetto Alpha');
    expect(notifica.link).toBe('/projects/prj-1');
  });

  it('la proposta di modifica dati avvisa lo studio con il campo in chiaro e link ai clienti', async () => {
    stato.cliente = CLIENTE_BASE;
    stato.propostaPendente = null;
    const server = serverConToken(tokenCliente());

    const res = await server.inject({
      method: 'POST',
      url: '/portal/proposte-dati',
      payload: { campo: 'iban', valoreProposto: 'IT99A0123456789012345678901' },
    });

    expect(res.statusCode).toBe(201);
    const notifica = stato.notifiche.find((n) => n.tipoEvento === 'messaggio_cliente');
    expect(notifica).toBeTruthy();
    expect(notifica.destinatarioId).toBe('usr-advisor');
    expect(notifica.oggetto).toBe('Proposta di modifica dati');
    // L'etichetta in chiaro, non il nome tecnico «iban».
    expect(notifica.corpo).toContain('IBAN');
    expect(notifica.corpo).toContain('IT99A0123456789012345678901');
    expect(notifica.link).toBe('/clients');
  });
});

describe('Punto 4 — trigger studio → cliente (risposta_addendum)', () => {
  const richiestaBase = {
    id: 'add-1',
    clienteId: CLIENTE_ID,
    progettoId: 'prj-1',
    stato: 'richiesta',
    testoRichiesta: 'Aggiungere la consulenza IVA',
    rispostaStudio: null,
    progetto: PROGETTO_BASE,
    cliente: { id: CLIENTE_ID, nome: CLIENTE_BASE.nome },
  };

  it("l'addendum pronto avvisa il cliente con link alla sezione Proposta", async () => {
    stato.richiestaAddendum = richiestaBase;
    const server = serverConToken(tokenAdvisor());

    const res = await server.inject({
      method: 'POST',
      url: '/addendum/add-1/stato',
      payload: { stato: 'pronta', rispostaStudio: 'Predisposto il documento ADD-2026-01' },
    });

    expect(res.statusCode).toBe(200);
    const notifica = stato.notifiche.find((n) => n.tipoEvento === 'risposta_addendum');
    expect(notifica).toBeTruthy();
    expect(notifica.destinatarioClienteId).toBe(CLIENTE_ID);
    expect(notifica.destinatarioTipo).toBe('cliente');
    expect(notifica.oggetto).toBe('Addendum pronto');
    expect(notifica.corpo).toContain('Progetto Alpha');
    expect(notifica.link).toBe('/portal/proposal');
  });

  it("l'addendum rifiutato avvisa il cliente riportando la risposta dello studio", async () => {
    stato.richiestaAddendum = richiestaBase;
    const server = serverConToken(tokenAdvisor());

    const res = await server.inject({
      method: 'POST',
      url: '/addendum/add-1/stato',
      payload: { stato: 'rifiutata', rispostaStudio: 'La prestazione non rientra nel mandato.' },
    });

    expect(res.statusCode).toBe(200);
    const notifica = stato.notifiche.find((n) => n.tipoEvento === 'risposta_addendum');
    expect(notifica).toBeTruthy();
    expect(notifica.oggetto).toBe('Richiesta di addendum rifiutata');
    expect(notifica.corpo).toContain('La prestazione non rientra nel mandato.');
  });

  it("il passaggio a in_preparazione NON avvisa il cliente (lavorazione interna)", async () => {
    stato.richiestaAddendum = richiestaBase;
    const server = serverConToken(tokenAdvisor());

    const res = await server.inject({
      method: 'POST',
      url: '/addendum/add-1/stato',
      payload: { stato: 'in_preparazione' },
    });

    expect(res.statusCode).toBe(200);
    expect(stato.notifiche.filter((n) => n.destinatarioClienteId)).toHaveLength(0);
    // L'audit resta: solo la campanella del cliente tace.
    expect(stato.audit.some((a) => a.azione === 'STATO_ADDENDUM')).toBe(true);
  });
});

describe('Punto 4 — trigger studio → cliente (risposta_proposta_dati)', () => {
  const propostaBase = {
    id: 'pdf-1',
    clienteId: CLIENTE_ID,
    campo: 'iban',
    valoreAttuale: CLIENTE_BASE.iban,
    valoreProposto: 'IT99A0123456789012345678901',
    notaCliente: null,
    stato: 'in_attesa',
    cliente: { id: CLIENTE_ID, referentiJson: {} },
  };

  it('la proposta confermata avvisa il cliente con il campo in chiaro', async () => {
    stato.proposta = propostaBase;
    stato.cliente = CLIENTE_BASE;
    const server = serverConToken(tokenAdvisor());

    const res = await server.inject({
      method: 'POST',
      url: '/proposte-dati/pdf-1/conferma',
      payload: {},
    });

    expect(res.statusCode).toBe(200);
    const notifica = stato.notifiche.find((n) => n.tipoEvento === 'risposta_proposta_dati');
    expect(notifica).toBeTruthy();
    expect(notifica.destinatarioClienteId).toBe(CLIENTE_ID);
    expect(notifica.oggetto).toBe('Proposta di modifica accettata');
    expect(notifica.corpo).toContain('IBAN');
    expect(notifica.link).toBe('/portal/proposal');
  });

  it('la proposta rifiutata avvisa il cliente con la motivazione dello studio', async () => {
    stato.proposta = { ...propostaBase, cliente: undefined };
    const server = serverConToken(tokenAdvisor());

    const res = await server.inject({
      method: 'POST',
      url: '/proposte-dati/pdf-1/rifiuta',
      payload: { notaStudio: 'IBAN non intestato alla società.' },
    });

    expect(res.statusCode).toBe(200);
    const notifica = stato.notifiche.find((n) => n.tipoEvento === 'risposta_proposta_dati');
    expect(notifica).toBeTruthy();
    expect(notifica.oggetto).toBe('Proposta di modifica rifiutata');
    expect(notifica.corpo).toContain('IBAN');
    expect(notifica.corpo).toContain('IBAN non intestato alla società.');
    expect(notifica.link).toBe('/portal/proposal');
  });
});
