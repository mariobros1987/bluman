/**
 * §2bis — archiviare e riattivare un operatore, come proprietà verificabile.
 *
 * Il difetto che questi test esistono per impedire non è un errore di battitura: è
 * l'**autobloccaggio**. Uno studio che archivia il proprio ultimo responsabile non ha più
 * nessuno che possa creare utenti (`POST /tenant/utenti` risponde 403 a chiunque non sia
 * advisor o super admin) né riattivare chi è stato archiviato. Si chiude fuori da solo, con
 * l'unica chiave rimasta dentro.
 *
 * L'altro invariante è che `User.stato` e il periodo aperto non divergano mai. Un test che
 * guardasse solo la risposta HTTP non lo vedrebbe: la risposta è la stessa sia che il periodo
 * sia stato chiuso sia che non lo sia. Qui si guarda cosa è finito nella tabella.
 *
 * Il client Prisma è sostituito da un finto, come in `gerarchiaRuoli.test.ts`: la rotta parla
 * direttamente col database, e senza finto non si può osservare cosa succede *dopo* i
 * controlli — che è esattamente il punto in cui stanno le regole.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';

const TENANT = '00000000-0000-0000-0000-000000000001';
const ALTRO_TENANT = '00000000-0000-0000-0000-000000000002';

interface RigaPeriodo {
  id: string;
  tenantId: string;
  userId: string;
  dal: Date;
  al: Date | null;
  /** Lo stato dell'utenza prima dell'archiviazione: `invitato` torna `invitato`. */
  statoPrecedente?: string | null;
  motivo?: string | null;
  creatoDa?: string | null;
}

const stato: {
  utenti: Map<string, any>;
  periodi: RigaPeriodo[];
  altriAdvisor: number;
  scrittureUtente: Array<{ where: any; data: any }>;
  audit: any[];
  contatore: number;
} = {
  utenti: new Map(),
  periodi: [],
  altriAdvisor: 0,
  scrittureUtente: [],
  audit: [],
  contatore: 0,
};

vi.mock('./util/prismaClient.js', async importOriginal => {
  // Il contesto tenant resta quello vero: è un AsyncLocalStorage, non tocca il database, e gli
  // hook di `buildServer` lo usano su ogni richiesta.
  const reale = await importOriginal<typeof import('./util/prismaClient.js')>();

  function filtraPeriodi(where: any): RigaPeriodo[] {
    let righe = stato.periodi.filter(
      p =>
        (where.tenantId === undefined || p.tenantId === where.tenantId) &&
        (where.userId === undefined || p.userId === where.userId),
    );
    if (where.al === null) righe = righe.filter(p => p.al === null);
    else if (where.al && where.al.not !== undefined) righe = righe.filter(p => p.al !== null);
    return righe;
  }

  const periodoCollaborazione = {
    findFirst: async ({ where, orderBy }: any) => {
      const righe = filtraPeriodi(where).sort((a, b) =>
        orderBy?.dal === 'desc' ? b.dal.getTime() - a.dal.getTime() : a.dal.getTime() - b.dal.getTime(),
      );
      return righe[0] ?? null;
    },
    update: async ({ where, data }: any) => {
      const riga = stato.periodi.find(p => p.id === where.id);
      if (!riga) throw new Error(`periodo ${where.id} inesistente`);
      Object.assign(riga, data);
      return riga;
    },
    create: async ({ data }: any) => {
      const riga: RigaPeriodo = {
        id: `per-${++stato.contatore}`,
        al: null,
        motivo: null,
        creatoDa: null,
        ...data,
      };
      stato.periodi.push(riga);
      return riga;
    },
  };

  const utente = {
    // L'hook di autenticazione e la guardia della rotta leggono la stessa tabella.
    findFirst: async ({ where }: any) => stato.utenti.get(where?.id) ?? null,
    // Anche per email: `POST /tenant/utenti` decide da lì se creare o aggiornare, e senza
    // questo ramo un re-invito sembrerebbe sempre una persona nuova.
    findUnique: async ({ where }: any) =>
      (where?.id ? stato.utenti.get(where.id) : undefined) ??
      [...stato.utenti.values()].find(u => u.email === where?.email) ??
      null,
    count: async () => stato.altriAdvisor,
    update: async ({ where, data }: any) => {
      stato.scrittureUtente.push({ where, data });
      const riga = stato.utenti.get(where.id);
      if (riga) {
        if (data.stato) riga.stato = data.stato;
        if (data.sessionVersion?.increment) riga.sessionVersion += data.sessionVersion.increment;
      }
      return riga ?? { id: where.id };
    },
    // La riga creata entra in tabella come le altre: chi crea una persona poi la archivia, e
    // per archiviarne una la rotta deve poterla rileggere da qui.
    create: async ({ data }: any) => {
      const riga = { stato: 'invitato', sessionVersion: 0, ...data, id: `usr-${++stato.contatore}` };
      stato.utenti.set(riga.id, riga);
      return riga;
    },
    findMany: async () => {
      // Il finto rispetta l'`include` della rotta: senza la relazione qui, il test
      // sull'elenco non direbbe niente su cosa arriva davvero al browser.
      return [...stato.utenti.values()].map(u => ({
        ...u,
        periodiCollaborazione: filtraPeriodi({ tenantId: u.tenantId, userId: u.id }).sort(
          (a, b) => a.dal.getTime() - b.dal.getTime(),
        ),
      }));
    },
  };

  const finto: any = {
    user: utente,
    periodoCollaborazione,
    auditLog: {
      create: async ({ data }: any) => {
        stato.audit.push(data);
        return data;
      },
    },
    // La transazione del servizio: il `tx` è lo stesso finto, quindi le scritture finiscono
    // nelle stesse tabelle in memoria. `$executeRaw` serve a `conContestoInTransazione`, che
    // reimposta la variabile di sessione su cui filtrano le policy RLS.
    $transaction: async (fn: any) => fn(finto),
    $executeRaw: async () => ({}),
  };

  return { ...reale, prisma: finto, prismaAmministrativo: () => finto };
});

// Importati dopo `vi.mock` di proposito: `server.js` risolve `prismaClient.js` al momento del
// proprio import, e deve trovare il finto.
const { buildServer } = await import('./server.js');
const { InMemoryApp } = await import('./adapters/inMemoryApp.js');
const { signJwt } = await import('./util/jwt.js');

function token(userId: string, ruolo: string, tenantId = TENANT) {
  return signJwt({
    userId,
    tenantId,
    email: `${userId}@studio.example`,
    ruolo: ruolo as any,
    sessionVersion: 0,
  });
}

function server() {
  return buildServer(new InMemoryApp()) as any;
}

/** La riga di periodo all'indice dato: fa fallire il test invece di restituire `undefined`. */
function periodo(indice: number): RigaPeriodo {
  const riga = stato.periodi[indice];
  if (!riga) throw new Error(`nessun periodo all'indice ${indice} (ce ne sono ${stato.periodi.length})`);
  return riga;
}

/** La scrittura su `user` all'indice dato, con lo stesso controllo. */
function scritturaUtente(indice: number): { where: any; data: any } {
  const riga = stato.scrittureUtente[indice];
  if (!riga) throw new Error(`nessuna scrittura su user all'indice ${indice}`);
  return riga;
}

/** La voce di audit all'indice dato, con lo stesso controllo. */
function voceAudit(indice: number): any {
  const riga = stato.audit[indice];
  if (!riga) throw new Error(`nessuna voce di audit all'indice ${indice}`);
  return riga;
}

/** Mette a database una persona dello studio. Restituisce la riga, così i test la leggono. */
function persona(id: string, opts: Partial<{ ruolo: string; stato: string; tenantId: string | null }> = {}) {
  const riga = {
    id,
    nome: id,
    email: `${id}@studio.example`,
    ruolo: opts.ruolo ?? 'collaboratore_interno',
    stato: opts.stato ?? 'attivo',
    tenantId: opts.tenantId === undefined ? TENANT : opts.tenantId,
    sessionVersion: 0,
    passwordHash: 'hash-finto',
  };
  stato.utenti.set(id, riga);
  return riga;
}

/** Il periodo aperto di chi è in forza: è l'invariante che le rotte devono mantenere. */
function inForza(userId: string, dal = new Date(2024, 2, 12), tenantId = TENANT) {
  const riga: RigaPeriodo = { id: `per-aperto-${userId}`, tenantId, userId, dal, al: null };
  stato.periodi.push(riga);
  return riga;
}

beforeEach(() => {
  stato.utenti = new Map();
  stato.periodi = [];
  stato.altriAdvisor = 1;
  stato.scrittureUtente = [];
  stato.audit = [];
  stato.contatore = 0;

  // L'attore di ogni test: esiste sempre, è attivo e ha la stessa `sessionVersion` del token,
  // altrimenti l'hook di autenticazione respinge la richiesta prima di arrivare alla rotta.
  persona('usr-advisor', { ruolo: 'advisor' });
  persona('usr-super', { ruolo: 'super_admin', tenantId: null });
  persona('usr-collab', { ruolo: 'collaboratore_interno' });
});

describe('archiviare un operatore — chi può, e chi no', () => {
  it('un collaboratore non arriva nemmeno al controllo: 403 sul ruolo richiedente', async () => {
    persona('usr-target');
    inForza('usr-target');

    const res = await server().inject({
      method: 'POST',
      url: '/tenant/utenti/usr-target/disattiva',
      headers: { authorization: `Bearer ${token('usr-collab', 'collaboratore_interno')}` },
      payload: {},
    });

    expect(res.statusCode).toBe(403);
    expect(stato.scrittureUtente).toEqual([]);
    expect(periodo(0).al).toBeNull();
  });

  it("un advisor non archivia una persona di un altro studio: 403, e il periodo resta aperto", async () => {
    persona('usr-altrove', { tenantId: ALTRO_TENANT });
    inForza('usr-altrove', new Date(2024, 2, 12), ALTRO_TENANT);

    const res = await server().inject({
      method: 'POST',
      url: '/tenant/utenti/usr-altrove/disattiva',
      headers: { authorization: `Bearer ${token('usr-advisor', 'advisor')}` },
      payload: {},
    });

    expect(res.statusCode).toBe(403);
    expect(periodo(0).al).toBeNull();
    expect(stato.scrittureUtente).toEqual([]);
  });

  it('un advisor non archivia un super admin della piattaforma: 403', async () => {
    const res = await server().inject({
      method: 'POST',
      url: '/tenant/utenti/usr-super/disattiva',
      headers: { authorization: `Bearer ${token('usr-advisor', 'advisor')}` },
      payload: {},
    });

    expect(res.statusCode).toBe(403);
  });

  it('nessuno archivia sé stesso: 400, e niente viene scritto', async () => {
    inForza('usr-advisor');

    const res = await server().inject({
      method: 'POST',
      url: '/tenant/utenti/usr-advisor/disattiva',
      headers: { authorization: `Bearer ${token('usr-advisor', 'advisor')}` },
      payload: {},
    });

    expect(res.statusCode).toBe(400);
    expect(res.json().errore).toContain('fatti archiviare da un altro responsabile');
    expect(periodo(0).al).toBeNull();
    expect(stato.scrittureUtente).toEqual([]);
  });

  it("l'ultimo responsabile attivo non si archivia: 400, e niente viene scritto", async () => {
    persona('usr-altro-advisor', { ruolo: 'advisor' });
    inForza('usr-altro-advisor');
    stato.altriAdvisor = 0; // è l'ultimo rimasto

    const res = await server().inject({
      method: 'POST',
      url: '/tenant/utenti/usr-altro-advisor/disattiva',
      headers: { authorization: `Bearer ${token('usr-advisor', 'advisor')}` },
      payload: {},
    });

    expect(res.statusCode).toBe(400);
    expect(res.json().errore).toContain('ultimo responsabile attivo');
    expect(periodo(0).al).toBeNull();
    expect(stato.scrittureUtente).toEqual([]);
  });

  it('un super admin di piattaforma non si archivia da qui: 400', async () => {
    // Un *altro* super admin: se il bersaglio fosse chi agisce, scatterebbe prima il controllo
    // sull'archiviare sé stessi e il test non direbbe niente su questo ramo.
    persona('usr-super-2', { ruolo: 'super_admin', tenantId: null });

    const res = await server().inject({
      method: 'POST',
      url: '/tenant/utenti/usr-super-2/disattiva',
      headers: { authorization: `Bearer ${token('usr-super', 'super_admin')}` },
      payload: {},
    });

    expect(res.statusCode).toBe(400);
    expect(res.json().errore).toContain('non appartiene a uno studio');
  });
});

describe('archiviare un operatore — cosa scrive', () => {
  it('chiude il periodo aperto con la data indicata, spegne l\'utenza e la sfasa', async () => {
    persona('usr-target');
    inForza('usr-target', new Date(2024, 2, 12));

    const res = await server().inject({
      method: 'POST',
      url: '/tenant/utenti/usr-target/disattiva',
      headers: { authorization: `Bearer ${token('usr-advisor', 'advisor')}` },
      payload: { dataFine: '2026-09-30', motivo: 'Fine collaborazione' },
    });

    expect(res.statusCode).toBe(200);

    // Il periodo è chiuso, al giorno chiesto, con il motivo e con chi l'ha chiuso.
    expect(stato.periodi).toHaveLength(1);
    expect(periodo(0).al).toEqual(new Date(2026, 8, 30));
    expect(periodo(0).motivo).toBe('Fine collaborazione');
    expect(periodo(0).creatoDa).toBe('usr-advisor');

    // L'invariante: `stato` spento **e** periodo chiuso, nella stessa transazione.
    expect(stato.scrittureUtente).toHaveLength(1);
    expect(scritturaUtente(0).data.stato).toBe('disattivato');
    expect(scritturaUtente(0).data.sessionVersion).toEqual({ increment: 1 });
  });

  it('senza data nel corpo usa oggi, che è quello che la UI precompila', async () => {
    persona('usr-target');
    inForza('usr-target');

    const res = await server().inject({
      method: 'POST',
      url: '/tenant/utenti/usr-target/disattiva',
      headers: { authorization: `Bearer ${token('usr-advisor', 'advisor')}` },
      payload: {},
    });

    expect(res.statusCode).toBe(200);
    const oggi = new Date();
    const fine = periodo(0).al!;
    expect(fine.getFullYear()).toBe(oggi.getFullYear());
    expect(fine.getMonth()).toBe(oggi.getMonth());
    expect(fine.getDate()).toBe(oggi.getDate());
  });

  it('una fine che precede l\'inizio è respinta: 400, e il periodo resta aperto', async () => {
    persona('usr-target');
    inForza('usr-target', new Date(2024, 2, 12));

    const res = await server().inject({
      method: 'POST',
      url: '/tenant/utenti/usr-target/disattiva',
      headers: { authorization: `Bearer ${token('usr-advisor', 'advisor')}` },
      payload: { dataFine: '2024-03-01' },
    });

    expect(res.statusCode).toBe(400);
    expect(periodo(0).al).toBeNull();
    expect(stato.scrittureUtente).toEqual([]);
  });

  it('entrare e uscire nello stesso giorno si può: il confronto è fra giorni, non fra istanti', async () => {
    persona('usr-target');
    // L'istante dell'invito, non la mezzanotte: è quello che scrive `apriPeriodoIniziale`, ed è
    // quello che copia il backfill da `created_at`. Con `dal` = oggi alle 09:14 e `dataFine` =
    // oggi, un confronto fra istanti risponderebbe 400 a chi viene archiviato il giorno stesso.
    inForza('usr-target', new Date(2026, 9, 1, 9, 14));

    const res = await server().inject({
      method: 'POST',
      url: '/tenant/utenti/usr-target/disattiva',
      headers: { authorization: `Bearer ${token('usr-advisor', 'advisor')}` },
      payload: { dataFine: '2026-10-01' },
    });

    expect(res.statusCode).toBe(200);
    expect(periodo(0).al).toEqual(new Date(2026, 9, 1));
  });

  it('una data inesistente è respinta invece di scivolare al mese dopo', async () => {
    persona('usr-target');
    inForza('usr-target');

    const res = await server().inject({
      method: 'POST',
      url: '/tenant/utenti/usr-target/disattiva',
      headers: { authorization: `Bearer ${token('usr-advisor', 'advisor')}` },
      payload: { dataFine: '2026-02-31' },
    });

    expect(res.statusCode).toBe(400);
    expect(periodo(0).al).toBeNull();
  });

  it('archiviare due volte la stessa persona è un 409, non un secondo periodo chiuso', async () => {
    persona('usr-target');
    inForza('usr-target', new Date(2026, 8, 1));
    const res1 = await server().inject({
      method: 'POST',
      url: '/tenant/utenti/usr-target/disattiva',
      headers: { authorization: `Bearer ${token('usr-advisor', 'advisor')}` },
      payload: { dataFine: '2026-09-30' },
    });
    expect(res1.statusCode).toBe(200);

    persona('usr-target', { stato: 'disattivato' });
    const res2 = await server().inject({
      method: 'POST',
      url: '/tenant/utenti/usr-target/disattiva',
      headers: { authorization: `Bearer ${token('usr-advisor', 'advisor')}` },
      payload: { dataFine: '2026-10-01' },
    });

    expect(res2.statusCode).toBe(409);
  });

  it("l'audit si scrive solo quando l'archiviazione è davvero avvenuta", async () => {
    persona('usr-target');
    inForza('usr-target', new Date(2026, 8, 1));

    // Rifiutata: nessuna traccia agli atti di un'archiviazione che non c'è stata.
    await server().inject({
      method: 'POST',
      url: '/tenant/utenti/usr-target/disattiva',
      headers: { authorization: `Bearer ${token('usr-advisor', 'advisor')}` },
      payload: { dataFine: '2026-01-01' },
    });
    expect(stato.audit).toEqual([]);

    await server().inject({
      method: 'POST',
      url: '/tenant/utenti/usr-target/disattiva',
      headers: { authorization: `Bearer ${token('usr-advisor', 'advisor')}` },
      payload: { dataFine: '2026-09-30' },
    });
    expect(stato.audit).toHaveLength(1);
    expect(voceAudit(0).azione).toBe('UTENTE_DISATTIVATO');
  });
});

describe('riattivare un operatore archiviato', () => {
  it('apre un NUOVO periodo e riaccende l\'utenza, senza toccare il precedente', async () => {
    persona('usr-target', { stato: 'disattivato' });
    // Una stagione già conclusa: chi rientra dopo due anni ha due righe nella sua storia.
    const prima: RigaPeriodo = {
      id: 'per-1',
      tenantId: TENANT,
      userId: 'usr-target',
      dal: new Date(2020, 0, 10),
      al: new Date(2022, 5, 30),
    };
    stato.periodi.push(prima);

    const res = await server().inject({
      method: 'POST',
      url: '/tenant/utenti/usr-target/riattiva',
      headers: { authorization: `Bearer ${token('usr-advisor', 'advisor')}` },
      payload: { dataInizio: '2026-10-01' },
    });

    expect(res.statusCode).toBe(200);
    expect(stato.periodi).toHaveLength(2);

    // Il periodo vecchio è intatto: è il motivo per cui questa tabella esiste.
    expect(prima.al).toEqual(new Date(2022, 5, 30));

    const nuovo = periodo(1);
    expect(nuovo.dal).toEqual(new Date(2026, 9, 1));
    expect(nuovo.al).toBeNull();
    expect(nuovo.creatoDa).toBe('usr-advisor');

    expect(stato.scrittureUtente).toHaveLength(1);
    expect(scritturaUtente(0).data.stato).toBe('attivo');
    expect(voceAudit(0).azione).toBe('UTENTE_RIATTIVATO');
  });

  it('riattivare chi è già in forza è un 409: «in forza» deve avere un significato solo', async () => {
    persona('usr-target');
    inForza('usr-target');

    const res = await server().inject({
      method: 'POST',
      url: '/tenant/utenti/usr-target/riattiva',
      headers: { authorization: `Bearer ${token('usr-advisor', 'advisor')}` },
      payload: { dataInizio: '2026-10-01' },
    });

    expect(res.statusCode).toBe(409);
    expect(stato.periodi).toHaveLength(1);
  });

  it('una nuova stagione non può cominciare prima che la precedente sia finita', async () => {
    persona('usr-target', { stato: 'disattivato' });
    stato.periodi.push({
      id: 'per-1',
      tenantId: TENANT,
      userId: 'usr-target',
      dal: new Date(2020, 0, 10),
      al: new Date(2026, 5, 30),
    });

    const res = await server().inject({
      method: 'POST',
      url: '/tenant/utenti/usr-target/riattiva',
      headers: { authorization: `Bearer ${token('usr-advisor', 'advisor')}` },
      payload: { dataInizio: '2026-01-01' },
    });

    expect(res.statusCode).toBe(400);
    expect(stato.periodi).toHaveLength(1);
    expect(stato.scrittureUtente).toEqual([]);
  });

  it('chi non era mai entrato torna `invitato`, non `attivo`', async () => {
    // Creato e mai entrato: la password è ancora quella temporanea, che chi l'ha creata conosce.
    // Archiviarlo e riattivarlo non deve promuoverlo ad accesso pieno.
    persona('usr-target', { stato: 'invitato' });
    inForza('usr-target', new Date(2026, 0, 10));

    await server().inject({
      method: 'POST',
      url: '/tenant/utenti/usr-target/disattiva',
      headers: { authorization: `Bearer ${token('usr-advisor', 'advisor')}` },
      payload: { dataFine: '2026-06-30' },
    });
    // Lo stato di prima resta scritto sul periodo chiuso: è ciò che rende possibile il rientro.
    expect(periodo(0).statoPrecedente).toBe('invitato');

    stato.scrittureUtente = [];
    persona('usr-target', { stato: 'disattivato' });
    const res = await server().inject({
      method: 'POST',
      url: '/tenant/utenti/usr-target/riattiva',
      headers: { authorization: `Bearer ${token('usr-advisor', 'advisor')}` },
      payload: { dataInizio: '2026-09-01' },
    });

    expect(res.statusCode).toBe(200);
    expect(res.json().stato).toBe('invitato');
    expect(scritturaUtente(0).data.stato).toBe('invitato');
    expect(res.json().messaggio).toContain('password personale');
  });

  it('chi aveva un accesso attivo torna `attivo`', async () => {
    persona('usr-target');
    inForza('usr-target', new Date(2026, 0, 10));

    await server().inject({
      method: 'POST',
      url: '/tenant/utenti/usr-target/disattiva',
      headers: { authorization: `Bearer ${token('usr-advisor', 'advisor')}` },
      payload: { dataFine: '2026-06-30' },
    });

    stato.scrittureUtente = [];
    persona('usr-target', { stato: 'disattivato' });
    await server().inject({
      method: 'POST',
      url: '/tenant/utenti/usr-target/riattiva',
      headers: { authorization: `Bearer ${token('usr-advisor', 'advisor')}` },
      payload: { dataInizio: '2026-09-01' },
    });

    expect(scritturaUtente(0).data.stato).toBe('attivo');
  });

  it('un advisor non riattiva una persona di un altro studio: 403', async () => {
    persona('usr-altrove', { stato: 'disattivato', tenantId: ALTRO_TENANT });
    stato.periodi.push({
      id: 'per-1',
      tenantId: ALTRO_TENANT,
      userId: 'usr-altrove',
      dal: new Date(2020, 0, 10),
      al: new Date(2022, 0, 1),
    });

    const res = await server().inject({
      method: 'POST',
      url: '/tenant/utenti/usr-altrove/riattiva',
      headers: { authorization: `Bearer ${token('usr-advisor', 'advisor')}` },
      payload: {},
    });

    expect(res.statusCode).toBe(403);
    expect(stato.periodi).toHaveLength(1);
    expect(stato.scrittureUtente).toEqual([]);
  });
});

describe('l\'elenco del team porta con sé i periodi', () => {
  it('GET /tenant/utenti include la storia, così la UI può mostrare «in forza dal …»', async () => {
    persona('usr-target');
    inForza('usr-target', new Date(2024, 2, 12));

    const res = await server().inject({
      method: 'GET',
      url: '/tenant/utenti',
      headers: { authorization: `Bearer ${token('usr-advisor', 'advisor')}` },
    });

    expect(res.statusCode).toBe(200);
    const righe = res.json();
    const target = righe.find((u: any) => u.id === 'usr-target');
    expect(target.periodiCollaborazione).toBeDefined();
    // `senzaHash` è una lista di esclusione: la relazione passa, l'hash no.
    expect(target.passwordHash).toBeUndefined();
  });
});

describe('chi si invita nasce in forza', () => {
  it('POST /tenant/utenti gli apre il periodo: senza, «Archivia» risponderebbe 409 per sempre', async () => {
    const res = await server().inject({
      method: 'POST',
      url: '/tenant/utenti',
      headers: { authorization: `Bearer ${token('usr-advisor', 'advisor')}` },
      payload: { nome: 'Nuovo Collaboratore', email: 'nuovo@studio.example' },
    });

    expect(res.statusCode).toBe(201);
    const creato = res.json();

    // Il periodo aperto c'è, ed è il suo. La migrazione l'ha fatto per chi c'era già; questa
    // rotta lo fa per chi arriva dopo, ed è il caso più comune di tutti.
    expect(stato.periodi).toHaveLength(1);
    expect(periodo(0).userId).toBe(creato.id);
    expect(periodo(0).tenantId).toBe(TENANT);
    expect(periodo(0).al).toBeNull();
    // Chi nasce `invitato` — creato, mai entrato, con la password temporanea ancora da
    // cambiare — deve **tornare** `invitato` se lo si archivia prima del primo accesso: al
    // rientro, `attivo` gli darebbe un accesso pieno retto da una password che conosce un altro.
    expect(periodo(0).statoPrecedente).toBe('invitato');

    // …e la prova che conta: da qui in avanti «Archivia» funziona davvero, invece di
    // rispondere 409 «non risulta in forza» a una persona che è appena stata assunta.
    const archivia = await server().inject({
      method: 'POST',
      url: `/tenant/utenti/${creato.id}/disattiva`,
      headers: { authorization: `Bearer ${token('usr-advisor', 'advisor')}` },
      payload: { dataFine: '2026-10-01' },
    });

    expect(archivia.statusCode).toBe(200);
    expect(periodo(0).al).toEqual(new Date(2026, 9, 1));
  });

  it('non ne apre un secondo su chi è già in forza: «in forza» resta una parola sola', async () => {
    persona('usr-target');
    inForza('usr-target');

    // Stessa email: la rotta passa dal ramo `update`, non da una seconda `create`.
    const res = await server().inject({
      method: 'POST',
      url: '/tenant/utenti',
      headers: { authorization: `Bearer ${token('usr-advisor', 'advisor')}` },
      payload: { nome: 'Target Riconfermato', email: 'usr-target@studio.example' },
    });

    expect(res.statusCode).toBe(201);
    expect(res.json().id).toBe('usr-target');
    // Due periodi aperti sulla stessa persona toglierebbero univocità proprio a quella parola.
    expect(stato.periodi).toHaveLength(1);
  });
});

describe('il reset password non riporta dentro un archiviato', () => {
  it('risponde 409 e non scrive niente: per far rientrare qualcuno c\'è «Riattiva»', async () => {
    persona('usr-target', { stato: 'disattivato' });

    const res = await server().inject({
      method: 'POST',
      url: '/tenant/utenti/usr-target/reset-password',
      headers: { authorization: `Bearer ${token('usr-advisor', 'advisor')}` },
    });

    expect(res.statusCode).toBe(409);
    expect(res.json().errore).toContain('archiviata');
    // La rotta scriverebbe `stato: 'invitato'`, e su un archiviato quella riga lo riporta
    // dentro — fra gli attivi, assegnabile ai progetti e capace di entrare — **senza** che
    // nessun periodo sia stato aperto. L'invariante cadrebbe in silenzio.
    expect(stato.scrittureUtente).toHaveLength(0);
    expect(stato.audit).toHaveLength(0);
  });

  it('su una persona attiva il reset passa come prima', async () => {
    persona('usr-target');

    const res = await server().inject({
      method: 'POST',
      url: '/tenant/utenti/usr-target/reset-password',
      headers: { authorization: `Bearer ${token('usr-advisor', 'advisor')}` },
    });

    expect(res.statusCode).toBe(200);
    expect(scritturaUtente(0).data.stato).toBe('invitato');
  });
});
