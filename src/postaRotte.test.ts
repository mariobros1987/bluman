// Accentratore delle mail — le rotte. Si guarda ciò che conta: chi può vedere la posta dei
// clienti, che la password di una casella non esca mai, e che lo smistamento non attraversi
// né gli studi né i clienti.
import { describe, it, expect, vi, beforeEach } from 'vitest';

const stato = vi.hoisted(() => ({
  utente: { id: 'u-1', ruolo: 'advisor' } as { id: string; ruolo: string },
  permesso: null as null | { livello: string },
  caselle: [] as any[],
  casellaCreata: null as any,
  casellaAggiornata: null as any,
  messaggio: null as any,
  messaggioAggiornato: null as any,
  whereElenco: null as any,
  progetto: null as any,
  cliente: null as any,
  clienteAggiornato: null as any,
  audit: [] as any[],
  guastoLettura: false,
}));

vi.mock('./util/prismaClient.js', () => {
  const prisma: any = {
    user: {
      findFirst: async (args: any) => (args?.where?.id === stato.utente.id ? { ruolo: stato.utente.ruolo, stato: 'attivo', sessionVersion: 0 } : null),
      findUnique: async () => ({ nome: 'Lorenzo Marino', email: 'lorenzo@studio.example', ruolo: stato.utente.ruolo }),
    },
    tenant: { findUnique: async () => ({ id: 't-1', moduliDisattivati: [] }), findFirst: async () => ({ id: 't-1', moduliDisattivati: [] }) },
    permessoModulo: { findUnique: async () => stato.permesso },
    auditLog: { create: async (args: any) => { stato.audit.push(args.data); return {}; } },
    casellaPosta: {
      findMany: async () => stato.caselle,
      findFirst: async (args: any) => stato.caselle.find((c) => !args?.where?.id || c.id === args.where.id) ?? null,
      create: async (args: any) => { stato.casellaCreata = args.data; return { id: 'cas-nuova', cliente: null, ...args.data }; },
      update: async (args: any) => { stato.casellaAggiornata = args.data; return { ...stato.caselle[0], ...args.data }; },
    },
    messaggioPosta: {
      findMany: async (args: any) => {
        if (stato.guastoLettura) throw new Error('db giù');
        stato.whereElenco = args.where;
        return [{ id: 'm-1', testo: 'Gentile   cliente,\n\nil saldo è pronto', oggetto: 'Saldo' }];
      },
      count: async () => 1,
      findFirst: async () => stato.messaggio,
      update: async (args: any) => { stato.messaggioAggiornato = args.data; return { ...stato.messaggio, ...args.data, testo: null }; },
    },
    progetto: { findFirst: async () => stato.progetto },
    cliente: {
      findFirst: async (args: any) => (args?.where?.aliasPosta ? null : stato.cliente),
      findMany: async () => (stato.cliente ? [stato.cliente] : []),
      update: async (args: any) => { stato.clienteAggiornato = args.data; return { ...stato.cliente, ...args.data }; },
    },
  };
  return {
    attivaContestoTenant: () => {},
    conContestoInTransazione: async (_tx: any, fn: any) => fn(),
    contestoTenant: { run: (_c: unknown, fn: () => unknown) => fn() },
    prisma,
    prismaAmministrativo: () => prisma,
  };
});

const { buildServer } = await import('./server.js');
const { InMemoryApp } = await import('./adapters/inMemoryApp.js');
const { signJwt } = await import('./util/jwt.js');
const { decifraSegreto } = await import('./util/cifraturaSegreti.js');

const TENANT = '00000000-0000-0000-0000-000000000001';
const CLIENTE = '11111111-1111-4111-8111-111111111111';
const ALTRO_CLIENTE = '22222222-2222-4222-8222-222222222222';
const PROGETTO = '33333333-3333-4333-8333-333333333333';
const CASELLA = '44444444-4444-4444-8444-444444444444';

async function chiama(method: 'GET' | 'POST' | 'PATCH', url: string, payload?: Record<string, unknown>) {
  const server = buildServer(new InMemoryApp()) as any;
  const tok = signJwt({ userId: stato.utente.id, tenantId: TENANT, email: 'lorenzo@studio.example', ruolo: stato.utente.ruolo as any, sessionVersion: 0 });
  const res = await server.inject({ method, url, payload, headers: { authorization: `Bearer ${tok}` } });
  await server.close();
  return res;
}

const casellaValida = {
  nome: 'Raccolta clienti', indirizzo: 'Raccolta@Studio.example', host: 'imap.example.com', utente: 'raccolta@studio.example',
  password: 'pw-della-casella', tipo: 'raccolta',
};

beforeEach(() => {
  stato.utente = { id: 'u-1', ruolo: 'advisor' };
  stato.permesso = null;
  stato.caselle = [];
  stato.casellaCreata = null;
  stato.casellaAggiornata = null;
  stato.messaggio = null;
  stato.messaggioAggiornato = null;
  stato.whereElenco = null;
  stato.progetto = null;
  stato.cliente = null;
  stato.clienteAggiornato = null;
  stato.audit.length = 0;
  stato.guastoLettura = false;
});

describe('chi vede la posta dei clienti', () => {
  it('il responsabile dello studio sì', async () => {
    const res = await chiama('GET', '/posta/messaggi');
    expect(res.statusCode, res.body).toBe(200);
  });

  it('un collaboratore interno no, finché l’admin non gliela apre dalla matrice', async () => {
    stato.utente = { id: 'u-2', ruolo: 'collaboratore_interno' };
    expect((await chiama('GET', '/posta/messaggi')).statusCode).toBe(403);

    stato.permesso = { livello: 'read' };
    expect((await chiama('GET', '/posta/messaggi')).statusCode).toBe(200);
    // «read» consulta e basta: non smista e non lancia la raccolta.
    expect((await chiama('PATCH', '/posta/messaggi/m-1', { letto: true })).statusCode).toBe(403);
    expect((await chiama('POST', '/posta/raccogli')).statusCode).toBe(403);
  });

  it('un collaboratore esterno mai, nemmeno con la matrice aperta', async () => {
    stato.utente = { id: 'u-3', ruolo: 'collaboratore_esterno' };
    stato.permesso = { livello: 'write' };
    expect((await chiama('GET', '/posta/messaggi')).statusCode).toBe(403);
    expect((await chiama('GET', '/posta/stato')).statusCode).toBe(403);
  });

  it('la configurazione è del responsabile anche per chi ha «write» sulla posta', async () => {
    stato.utente = { id: 'u-2', ruolo: 'collaboratore_interno' };
    stato.permesso = { livello: 'write' };
    expect((await chiama('GET', '/posta/caselle')).statusCode).toBe(403);
    expect((await chiama('POST', '/posta/caselle', casellaValida)).statusCode).toBe(403);
    expect((await chiama('POST', `/posta/clienti/${CLIENTE}/inoltro`, { attivo: true })).statusCode).toBe(403);
    expect(stato.casellaCreata).toBeNull();
  });
});

describe('GET /posta/messaggi', () => {
  it('filtra sullo studio della sessione, sulla coda non archiviata, e dà l’anteprima su una riga', async () => {
    const res = await chiama('GET', `/posta/messaggi?vista=da_smistare&letti=no&clienteId=${CLIENTE}`);
    expect(res.statusCode, res.body).toBe(200);
    expect(stato.whereElenco).toMatchObject({ tenantId: TENANT, archiviatoAt: null, lettoAt: null, clienteId: CLIENTE });
    const corpo = res.json();
    expect(corpo.totale).toBe(1);
    expect(corpo.messaggi[0]).toEqual({ id: 'm-1', oggetto: 'Saldo', anteprima: 'Gentile cliente, il saldo è pronto' });
  });

  it('un errore di lettura è un errore, non «nessun messaggio»', async () => {
    stato.guastoLettura = true;
    const res = await chiama('GET', '/posta/messaggi');
    expect(res.statusCode).toBe(500);
    expect(res.json().errore).toBe('I messaggi non sono stati letti.');
  });
});

describe('PATCH /posta/messaggi/:id — smistamento', () => {
  it('scegliendo il progetto il messaggio prende il suo cliente, e resta scritto chi l’ha smistato', async () => {
    stato.messaggio = { id: 'm-1', oggetto: 'Saldo', clienteId: null, progettoId: null, attribuzione: 'da_smistare' };
    stato.progetto = { clienteId: CLIENTE };
    stato.cliente = { id: CLIENTE };
    const res = await chiama('PATCH', '/posta/messaggi/m-1', { progettoId: PROGETTO });
    expect(res.statusCode, res.body).toBe(200);
    expect(stato.messaggioAggiornato).toEqual({ clienteId: CLIENTE, progettoId: PROGETTO, attribuzione: 'manuale', criterio: null });
    expect(stato.audit[0]).toMatchObject({ tenantId: TENANT, userId: 'u-1', ruolo: 'advisor', azione: 'POSTA_MESSAGGIO_SMISTATO' });
  });

  it('rifiuta un progetto che non è del cliente indicato', async () => {
    stato.messaggio = { id: 'm-1', oggetto: 'Saldo', clienteId: null, progettoId: null, attribuzione: 'da_smistare' };
    stato.progetto = { clienteId: ALTRO_CLIENTE };
    const res = await chiama('PATCH', '/posta/messaggi/m-1', { clienteId: CLIENTE, progettoId: PROGETTO });
    expect(res.statusCode).toBe(400);
    expect(stato.messaggioAggiornato).toBeNull();
  });

  it('un cliente che non è dello studio non si trova: niente attribuzione', async () => {
    stato.messaggio = { id: 'm-1', oggetto: 'Saldo', clienteId: null, progettoId: null, attribuzione: 'da_smistare' };
    stato.cliente = null;
    const res = await chiama('PATCH', '/posta/messaggi/m-1', { clienteId: CLIENTE });
    expect(res.statusCode).toBe(404);
    expect(stato.messaggioAggiornato).toBeNull();
  });

  it('`clienteId: null` toglie l’attribuzione e il messaggio torna da smistare', async () => {
    stato.messaggio = { id: 'm-1', oggetto: 'Saldo', clienteId: CLIENTE, progettoId: PROGETTO, attribuzione: 'automatica' };
    const res = await chiama('PATCH', '/posta/messaggi/m-1', { clienteId: null });
    expect(res.statusCode, res.body).toBe(200);
    expect(stato.messaggioAggiornato).toEqual({ clienteId: null, progettoId: null, attribuzione: 'da_smistare', criterio: null });
  });

  it('segnare letto non tocca l’attribuzione e non scrive nel registro', async () => {
    stato.messaggio = { id: 'm-1', oggetto: 'Saldo', clienteId: CLIENTE, progettoId: null, attribuzione: 'automatica' };
    const res = await chiama('PATCH', '/posta/messaggi/m-1', { letto: true });
    expect(res.statusCode, res.body).toBe(200);
    expect(Object.keys(stato.messaggioAggiornato)).toEqual(['lettoAt', 'lettoDa']);
    expect(stato.messaggioAggiornato.lettoDa).toBe('u-1');
    expect(stato.audit).toHaveLength(0);
  });
});

describe('le caselle e la loro password', () => {
  it('la password si salva cifrata e non torna mai nella risposta', async () => {
    const res = await chiama('POST', '/posta/caselle', casellaValida);
    expect(res.statusCode, res.body).toBe(201);
    expect(res.body).not.toContain('pw-della-casella');
    expect(res.body).not.toContain('passwordCifrata');
    expect(res.json()).toMatchObject({ indirizzo: 'raccolta@studio.example', tipo: 'raccolta', passwordSalvata: true });
    expect(stato.casellaCreata.tenantId).toBe(TENANT);
    expect(stato.casellaCreata.passwordCifrata).not.toContain('pw-della-casella');
    expect(decifraSegreto(stato.casellaCreata.passwordCifrata, 'casella-posta').chiaro).toBe('pw-della-casella');
    expect(JSON.stringify(stato.audit)).not.toContain('pw-della-casella');
  });

  it('l’elenco delle caselle dice solo se la password c’è', async () => {
    stato.caselle = [{ id: CASELLA, nome: 'Raccolta', passwordCifrata: 'v1:abc' }];
    const res = await chiama('GET', '/posta/caselle');
    expect(res.json()).toEqual([{ id: CASELLA, nome: 'Raccolta', passwordSalvata: true }]);
  });

  it('la casella di un cliente non si collega senza la dichiarazione dell’autorizzazione', async () => {
    stato.cliente = { nome: 'Mario Rossi' };
    const senza = await chiama('POST', '/posta/caselle', { ...casellaValida, tipo: 'cliente', clienteId: CLIENTE });
    expect(senza.statusCode).toBe(400);
    expect(senza.json().errore).toContain('autorizzato per iscritto');
    expect(stato.casellaCreata).toBeNull();

    const con = await chiama('POST', '/posta/caselle', { ...casellaValida, tipo: 'cliente', clienteId: CLIENTE, consensoCliente: true });
    expect(con.statusCode, con.body).toBe(201);
    expect(stato.casellaCreata).toMatchObject({ tipo: 'cliente', clienteId: CLIENTE, consensoDichiaratoDa: 'u-1' });
    expect(stato.casellaCreata.consensoDichiaratoAt).toBeInstanceOf(Date);
    expect(stato.audit[0].dettagli).toContain('autorizzazione scritta');
  });

  it('un server interno non è una casella: la politica di rete vale anche qui', async () => {
    const res = await chiama('POST', '/posta/caselle', { ...casellaValida, host: 'localhost' });
    expect(res.statusCode).toBe(400);
    expect(stato.casellaCreata).toBeNull();
  });

  it('scollegare ferma la raccolta e cancella la password', async () => {
    stato.caselle = [{ id: CASELLA, indirizzo: 'raccolta@studio.example', passwordCifrata: 'v1:abc', attiva: true }];
    const res = await chiama('POST', `/posta/caselle/${CASELLA}/scollega`);
    expect(res.statusCode, res.body).toBe(200);
    expect(stato.casellaAggiornata).toEqual({ attiva: false, passwordCifrata: null, ultimoErrore: null });
    expect(res.json().passwordSalvata).toBe(false);
    expect(stato.audit[0].azione).toBe('POSTA_CASELLA_SCOLLEGATA');
  });

  it('cambiare server o utenza azzera il segnalibro: è un’altra casella', async () => {
    stato.caselle = [{ id: CASELLA, indirizzo: 'raccolta@studio.example', host: 'imap.example.com', utente: 'a@studio.example', cartella: 'INBOX', passwordCifrata: 'v1:abc' }];
    const res = await chiama('PATCH', `/posta/caselle/${CASELLA}`, { utente: 'b@studio.example' });
    expect(res.statusCode, res.body).toBe(200);
    expect(stato.casellaAggiornata).toEqual({ utente: 'b@studio.example', uidValidity: null, ultimoUid: 0 });
  });
});

describe('POST /posta/clienti/:id/inoltro', () => {
  it('attiva: genera l’alias, scrive chi e quando, e dà l’indirizzo di inoltro', async () => {
    stato.cliente = { id: CLIENTE, nome: 'Mario Rossi', aliasPosta: null };
    stato.caselle = [{ id: CASELLA, indirizzo: 'raccolta@studio.example' }];
    const res = await chiama('POST', `/posta/clienti/${CLIENTE}/inoltro`, { attivo: true });
    expect(res.statusCode, res.body).toBe(200);
    const alias = stato.clienteAggiornato.aliasPosta;
    expect(alias).toMatch(/^[a-km-np-z2-9]{8}$/);
    expect(stato.clienteAggiornato.postaAttivataDa).toBe('u-1');
    expect(res.json().indirizzoInoltro).toBe(`raccolta+${alias}@studio.example`);
    expect(stato.audit[0].azione).toBe('POSTA_INOLTRO_ATTIVATO');
  });

  it('chi è già attivo tiene il suo alias', async () => {
    stato.cliente = { id: CLIENTE, nome: 'Mario Rossi', aliasPosta: 'k7m2p9xq' };
    const res = await chiama('POST', `/posta/clienti/${CLIENTE}/inoltro`, { attivo: true });
    expect(res.statusCode, res.body).toBe(200);
    expect(stato.clienteAggiornato).toEqual({ aliasPosta: 'k7m2p9xq' });
    expect(stato.audit).toHaveLength(0);
  });

  it('disattiva: toglie l’alias', async () => {
    stato.cliente = { id: CLIENTE, nome: 'Mario Rossi', aliasPosta: 'k7m2p9xq' };
    const res = await chiama('POST', `/posta/clienti/${CLIENTE}/inoltro`, { attivo: false });
    expect(res.statusCode, res.body).toBe(200);
    expect(stato.clienteAggiornato).toEqual({ aliasPosta: null, postaAttivataAt: null, postaAttivataDa: null });
    expect(stato.audit[0].azione).toBe('POSTA_INOLTRO_DISATTIVATO');
  });
});
