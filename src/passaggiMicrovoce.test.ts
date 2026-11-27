// I passaggi interni di un'attività: lo stesso passaggio porta sempre alla stessa riga, ed
// eliminarlo lo toglie davvero. Misurato il 27/11 sul database di prova: una spunta creava
// quattro righe nuove, due spunte otto, e un passaggio eliminato tornava alla riapertura.
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { idPassaggio, salvaPassaggiMicrovoce } from './services/passaggiMicrovoce.js';

const stato = vi.hoisted(() => ({
  ruolo: 'advisor',
  userId: 'u-1',
  microvoce: { id: 'mv-1', nome: 'Presentazione al cliente' } as { id: string; nome: string } | null,
  righe: new Map<string, { id: string; titolo: string; microvoceProgettoId: string }>(),
  audit: [] as any[],
  guasto: false,
}));

vi.mock('./util/prismaClient.js', () => {
  const prisma: any = {
    user: { findFirst: async () => ({ ruolo: stato.ruolo, stato: 'attivo', sessionVersion: 0 }), findUnique: async () => ({ nome: 'Lorenzo', email: 'l@studio.example' }) },
    cliente: { findFirst: async () => ({ sessionVersion: 0 }) },
    tenant: { findUnique: async () => ({ id: 't-1', moduliDisattivati: [] }), findFirst: async () => ({ id: 't-1', moduliDisattivati: [] }) },
    permessoModulo: { findUnique: async () => null },
    auditLog: { create: async (a: any) => { stato.audit.push(a.data); return {}; } },
    microvoceProgetto: { findFirst: async () => stato.microvoce },
    passaggioProgetto: {
      findFirst: async (a: any) => {
        if (stato.guasto) throw new Error('db giù');
        const r = stato.righe.get(a.where.id);
        return r && r.microvoceProgettoId === a.where.microvoceProgettoId ? r : null;
      },
      delete: async (a: any) => { stato.righe.delete(a.where.id); return {}; },
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

const TENANT = '00000000-0000-0000-0000-000000000001';
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-5[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

async function elimina(url: string) {
  const server = buildServer(new InMemoryApp()) as any;
  const tok = signJwt({ userId: stato.userId, tenantId: TENANT, email: 'l@studio.example', ruolo: stato.ruolo as any, sessionVersion: 0 });
  const res = await server.inject({ method: 'DELETE', url, headers: { authorization: `Bearer ${tok}` } });
  await server.close();
  return res;
}

/** Un `passaggio_progetto` in memoria che si comporta come la tabella: una chiave, una riga. */
function tabella() {
  const righe = new Map<string, any>();
  return {
    righe,
    client: {
      passaggioProgetto: {
        upsert: async (a: any) => {
          const r = righe.get(a.where.id);
          if (r && r.microvoceProgettoId === a.where.microvoceProgettoId) { Object.assign(r, a.update); return r; }
          if (r) throw new Error('chiave già presente');
          righe.set(a.create.id, { ...a.create });
          return a.create;
        },
        create: async (a: any) => { const id = `auto-${righe.size}`; righe.set(id, { id, ...a.data }); return a.data; },
      },
    },
  };
}

const QUATTRO = ['s1', 's2', 's3', 's4'].map((id, i) => ({ id, title: `Passaggio ${i + 1}`, type: 'info', who: 'operatore', stato: 'pending' }));
const DOVE = { tenantId: TENANT, microvoce: { id: 'mv-1', nome: 'Presentazione al cliente' } };

beforeEach(() => {
  stato.ruolo = 'advisor';
  stato.userId = 'u-1';
  stato.microvoce = { id: 'mv-1', nome: 'Presentazione al cliente' };
  stato.righe.clear();
  stato.audit.length = 0;
  stato.guasto = false;
});

describe('idPassaggio', () => {
  it('un id di database resta com’è', () => {
    expect(idPassaggio('mv-1', '8F14E45F-EA0D-4B1A-9C2F-0D5C9A7B3E21')).toBe('8f14e45f-ea0d-4b1a-9c2f-0d5c9a7b3e21');
  });

  it('un nome della pagina dà sempre lo stesso id sulla stessa attività, e uno diverso su un’altra', () => {
    const a = idPassaggio('mv-1', 's1');
    expect(a).toMatch(UUID);
    expect(idPassaggio('mv-1', 's1')).toBe(a);
    expect(idPassaggio('mv-2', 's1')).not.toBe(a);
    expect(idPassaggio('mv-1', 's2')).not.toBe(a);
  });

  it('senza nome non c’è id', () => {
    expect(idPassaggio('mv-1', undefined)).toBeUndefined();
    expect(idPassaggio('mv-1', '  ')).toBeUndefined();
  });
});

describe('salvaPassaggiMicrovoce', () => {
  it('tre salvataggi dei quattro passaggi predefiniti lasciano quattro righe, con le spunte dell’ultimo', async () => {
    const t = tabella();
    await salvaPassaggiMicrovoce(t.client, DOVE, QUATTRO);
    await salvaPassaggiMicrovoce(t.client, DOVE, QUATTRO.map((p, i) => (i === 0 ? { ...p, stato: 'done' } : p)));
    const esito = await salvaPassaggiMicrovoce(t.client, DOVE, QUATTRO.map((p, i) => (i <= 1 ? { ...p, stato: 'done' } : p)));

    expect(esito).toEqual([]);
    expect(t.righe.size).toBe(4);
    expect([...t.righe.values()].filter((r) => r.stato === 'done')).toHaveLength(2);
  });

  it('dopo la rilettura la pagina manda gli id di database: sono le stesse righe', async () => {
    const t = tabella();
    await salvaPassaggiMicrovoce(t.client, DOVE, QUATTRO);
    const riletti = [...t.righe.values()].map((r) => ({ id: r.id, title: r.titolo, type: 'info', who: 'operatore', stato: 'done' }));
    await salvaPassaggiMicrovoce(t.client, DOVE, riletti);

    expect(t.righe.size).toBe(4);
    expect([...t.righe.values()].every((r) => r.stato === 'done')).toBe(true);
  });

  it('l’id di un passaggio di un’altra attività non viene toccato, e si dichiara', async () => {
    const t = tabella();
    const altrui = '8f14e45f-ea0d-4b1a-9c2f-0d5c9a7b3e21';
    t.righe.set(altrui, { id: altrui, microvoceProgettoId: 'mv-altra', titolo: 'Non mio', stato: 'pending' });
    const esito = await salvaPassaggiMicrovoce(t.client, DOVE, [{ id: altrui, title: 'Tentativo', type: 'info', stato: 'done' }]);

    expect(esito.join(' ')).toContain('Tentativo');
    expect(t.righe.get(altrui).titolo).toBe('Non mio');
    expect(t.righe.get(altrui).stato).toBe('pending');
  });
});

describe('DELETE /microvoci/:id/passaggi/:passaggioId', () => {
  it('toglie il passaggio, anche nominato col nome della pagina, e lo scrive nel registro', async () => {
    const id = idPassaggio('mv-1', 's3')!;
    stato.righe.set(id, { id, titolo: 'Dati aggiuntivi dal cliente', microvoceProgettoId: 'mv-1' });

    const res = await elimina('/microvoci/mv-1/passaggi/s3');

    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ ok: true, eliminato: true });
    expect(stato.righe.size).toBe(0);
    expect(stato.audit[0]).toMatchObject({ azione: 'PASSAGGIO_ELIMINATO', userId: 'u-1', ruolo: 'advisor' });
  });

  it('un passaggio mai salvato non è un errore: niente da togliere', async () => {
    const res = await elimina('/microvoci/mv-1/passaggi/s3');
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ ok: true, eliminato: false });
    expect(stato.audit).toHaveLength(0);
  });

  it('il passaggio di un’altra attività resta dov’è', async () => {
    const altrui = '8f14e45f-ea0d-4b1a-9c2f-0d5c9a7b3e21';
    stato.righe.set(altrui, { id: altrui, titolo: 'Non mio', microvoceProgettoId: 'mv-altra' });
    const res = await elimina(`/microvoci/mv-1/passaggi/${altrui}`);
    expect(res.json()).toEqual({ ok: true, eliminato: false });
    expect(stato.righe.has(altrui)).toBe(true);
  });

  it('attività inesistente → 404; guasto del database → 500 dichiarato', async () => {
    stato.microvoce = null;
    expect((await elimina('/microvoci/mv-x/passaggi/s3')).statusCode).toBe(404);
    stato.microvoce = { id: 'mv-1', nome: 'Presentazione al cliente' };
    stato.guasto = true;
    const res = await elimina('/microvoci/mv-1/passaggi/s3');
    expect(res.statusCode).toBe(500);
    expect(res.json().errore).toContain('non è stato eliminato');
  });

  it('il cliente del portale non può', async () => {
    stato.ruolo = 'cliente';
    stato.userId = 'client-cli-1';
    expect((await elimina('/microvoci/mv-1/passaggi/s3')).statusCode).toBe(403);
  });
});
