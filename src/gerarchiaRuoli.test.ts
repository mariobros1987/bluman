/**
 * §2bis — la gerarchia dei ruoli come proprietà verificabile, non come intenzione.
 *
 * Il file è separato da `server.test.ts` perché è l'unico che sostituisce il client Prisma
 * con un finto: `POST /tenant/utenti` parla direttamente col database, quindi senza mock
 * non si può osservare cosa succede *dopo* i controlli di ruolo — che è esattamente il
 * punto in cui stava il difetto.
 *
 * Il difetto, per memoria: i due `super_admin` del database avevano `tenant_id` valorizzato
 * (`seedFull.ts` li creava così e `prismaApp.listaUtenti()` li riassegnava a ogni lettura).
 * Il controllo che impedisce di modificare un utente di un altro studio confronta
 * `esistente.tenant_id` col tenant corrente: per un super_admin finito nel tenant
 * dell'advisor quel confronto era vero, il controllo passava, e l'`update` successivo
 * riscriveva `ruolo` a `collaboratore_interno`. Il responsabile di un singolo studio
 * poteva declassare il super admin della piattaforma.
 *
 * La migrazione `20260819190000_super_admin_senza_tenant` ha rimesso a NULL quei
 * `tenant_id`, e con NULL è RLS a nascondere la riga. Questi test coprono l'altro lato:
 * il guard applicativo deve reggere anche se un domani una riga tornasse fuori invariante.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';

/** Righe restituite dal finto client, riscritte da ogni test prima dell'uso. */
const stato: {
  esistente: any;
  update: any[];
  create: any[];
  findManyEsplode: boolean;
} = { esistente: null, update: [], create: [], findManyEsplode: false };

vi.mock('./util/prismaClient.js', async importOriginal => {
  // Il contesto tenant resta quello vero: è un AsyncLocalStorage, non tocca il database, e
  // gli hook di `buildServer` lo usano su ogni richiesta.
  const reale = await importOriginal<typeof import('./util/prismaClient.js')>();

  const utente = {
    findUnique: async () => stato.esistente,
    findFirst: async () => stato.esistente,
    findMany: async () => {
      if (stato.findManyEsplode) throw new Error('database irraggiungibile (simulato)');
      return stato.esistente ? [stato.esistente] : [];
    },
    update: async (args: any) => {
      stato.update.push(args);
      return { ...stato.esistente, ...args.data };
    },
    create: async (args: any) => {
      stato.create.push(args);
      return { id: 'usr-nuovo', ...args.data };
    },
  };

  const finto: any = { user: utente, auditLog: { create: async () => ({}) } };

  return {
    ...reale,
    prisma: finto,
    prismaAmministrativo: () => finto,
  };
});

// Importati dopo `vi.mock` di proposito: `server.js` risolve `prismaClient.js` al momento
// del proprio import, e deve trovare il finto.
const { buildServer } = await import('./server.js');
const { InMemoryApp } = await import('./adapters/inMemoryApp.js');
const { signJwt } = await import('./util/jwt.js');

const TENANT = '00000000-0000-0000-0000-000000000001';

function token(ruolo: 'super_admin' | 'advisor' | 'collaboratore_interno') {
  return signJwt({ userId: `usr-${ruolo}`, tenantId: TENANT, email: `${ruolo}@studio.example`, ruolo });
}

function server() {
  return buildServer(new InMemoryApp()) as any;
}

/** La riga fuori invariante: un super_admin che appartiene al tenant dell'advisor. */
const SUPER_ADMIN_CON_TENANT = {
  id: 'usr-super',
  email: 'super@studio.example',
  nome: 'Super Admin',
  ruolo: 'super_admin',
  tenantId: TENANT,
  passwordHash: 'hash-finto',
  stato: 'attivo',
};

beforeEach(() => {
  stato.esistente = null;
  stato.update = [];
  stato.create = [];
  stato.findManyEsplode = false;
});

describe('§2bis — una riga super_admin la modifica solo un super_admin', () => {
  it("l'advisor riceve 403 e l'update non viene nemmeno tentato", async () => {
    stato.esistente = SUPER_ADMIN_CON_TENANT;

    const res = await server().inject({
      method: 'POST',
      url: '/tenant/utenti',
      headers: { authorization: `Bearer ${token('advisor')}` },
      payload: { nome: 'Declassato', email: SUPER_ADMIN_CON_TENANT.email, ruolo: 'collaboratore_interno' },
    });

    expect(res.statusCode).toBe(403);
    // La verifica che conta: non basta la risposta giusta, la scrittura non deve avvenire.
    expect(stato.update).toEqual([]);
  });

  it('il super_admin invece passa', async () => {
    stato.esistente = SUPER_ADMIN_CON_TENANT;

    const res = await server().inject({
      method: 'POST',
      url: '/tenant/utenti',
      headers: { authorization: `Bearer ${token('super_admin')}` },
      payload: { nome: 'Super Admin Rinominato', email: SUPER_ADMIN_CON_TENANT.email },
    });

    expect(res.statusCode).toBe(201);
    expect(stato.update).toHaveLength(1);
  });

  it('un collaboratore non arriva nemmeno al controllo: 403 sul ruolo richiedente', async () => {
    stato.esistente = SUPER_ADMIN_CON_TENANT;

    const res = await server().inject({
      method: 'POST',
      url: '/tenant/utenti',
      headers: { authorization: `Bearer ${token('collaboratore_interno')}` },
      payload: { nome: 'X', email: SUPER_ADMIN_CON_TENANT.email },
    });

    expect(res.statusCode).toBe(403);
    expect(stato.update).toEqual([]);
  });
});

describe('§2bis — il tenant assegnato al nuovo utente', () => {
  it('un super_admin creato non appartiene a nessun tenant (tenantId null)', async () => {
    // È l'invariante su cui si appoggia la policy RLS di `user`: le righe senza tenant sono
    // visibili al solo super_admin. Se la create le assegnasse un tenant, il super admin
    // nuovo nascerebbe già dentro lo studio corrente.
    const res = await server().inject({
      method: 'POST',
      url: '/tenant/utenti',
      headers: { authorization: `Bearer ${token('super_admin')}` },
      payload: { nome: 'Secondo Super', email: 'secondo@studio.example', ruolo: 'super_admin' },
    });

    expect(res.statusCode).toBe(201);
    expect(stato.create).toHaveLength(1);
    expect(stato.create[0].data.tenantId).toBeNull();
    expect(stato.create[0].data.ruolo).toBe('super_admin');
  });

  it('un collaboratore creato da un advisor appartiene al tenant di chi lo crea', async () => {
    const res = await server().inject({
      method: 'POST',
      url: '/tenant/utenti',
      headers: { authorization: `Bearer ${token('advisor')}` },
      payload: { nome: 'Collaboratore', email: 'collab@studio.example', ruolo: 'collaboratore_interno' },
    });

    expect(res.statusCode).toBe(201);
    expect(stato.create[0].data.tenantId).toBe(TENANT);
    expect(stato.create[0].data.ruolo).toBe('collaboratore_interno');
  });

  it("un advisor non può promuovere a super_admin passando il ruolo nel corpo", async () => {
    const res = await server().inject({
      method: 'POST',
      url: '/tenant/utenti',
      headers: { authorization: `Bearer ${token('advisor')}` },
      payload: { nome: 'Aspirante', email: 'aspirante@studio.example', ruolo: 'super_admin' },
    });

    expect(res.statusCode).toBe(403);
    expect(stato.create).toEqual([]);
  });
});

describe('GET /tenant/utenti — un errore di lettura non diventa un elenco vuoto', () => {
  it('risponde 503 invece di ripiegare su un secondo percorso di scrittura', async () => {
    // Il ripiego di prima chiamava `app.listaUtenti()`, che faceva ancora `upsert` sugli
    // stessi utenti riassegnandoli al tenant corrente: un fallimento di lettura si
    // trasformava in una scrittura non richiesta. E un elenco vuoto avrebbe fatto sembrare
    // lo studio senza collaboratori.
    stato.findManyEsplode = true;

    const res = await server().inject({
      method: 'GET',
      url: '/tenant/utenti',
      headers: { authorization: `Bearer ${token('advisor')}` },
    });

    expect(res.statusCode).toBe(503);
    expect(res.json().errore).toMatch(/non disponibile/i);
  });

  it("non restituisce mai l'hash della password", async () => {
    stato.esistente = SUPER_ADMIN_CON_TENANT;

    const res = await server().inject({
      method: 'GET',
      url: '/tenant/utenti',
      headers: { authorization: `Bearer ${token('super_admin')}` },
    });

    expect(res.statusCode).toBe(200);
    const corpo = res.json();
    expect(corpo).toHaveLength(1);
    expect(corpo[0]).not.toHaveProperty('passwordHash');
    expect(JSON.stringify(corpo)).not.toContain('hash-finto');
  });
});
