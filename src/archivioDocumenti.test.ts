/**
 * §37 — Archivio documentale dello studio: `GET /documenti/archivio`.
 *
 * L'endpoint costruisce l'albero Cliente → Progetto contando le righe della tabella
 * `documento`. Qui si verifica quello che i conteggi possono sbagliare: i documenti
 * agganciati alla sola micro-voce (che vanno risaliti al progetto), il criterio di
 * «firmato» (sigillo a database oppure copia firmata di §36), la separazione fra
 * archiviati e attivi, i documenti orfani di progetto e — soprattutto — che un token
 * cliente non possa leggere l'elenco dei clienti dello studio.
 *
 * Il client Prisma è mockato (come in archiviazioneDocumentiFirmati.test.ts): senza
 * database non c'è altro modo di osservare l'aggregazione.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';

const stato = {
  clienti: [] as any[],
  documenti: [] as any[],
  microvoci: [] as any[],
  firme: [] as any[],
  /** Argomenti con cui il server ha interrogato le micro-voci: serve a provare che non le chiede a vuoto. */
  chiamateMicrovoci: [] as any[],
};

vi.mock('./util/prismaClient.js', async importOriginal => {
  const reale = await importOriginal<typeof import('./util/prismaClient.js')>();

  const finto: any = {
    user: {
      findFirst: async (args: any) =>
        args?.select?.sessionVersion &&
        args?.select?.ruolo &&
        args?.select?.stato &&
        args?.where?.id === 'usr-advisor' &&
        args?.where?.tenantId === '00000000-0000-0000-0000-000000000001'
          ? { id: 'usr-advisor', tenantId: args.where.tenantId, ruolo: 'advisor', stato: 'attivo', sessionVersion: 0 }
          : null,
    },
    cliente: {
      findFirst: async (args: any) =>
        args?.select?.sessionVersion &&
        args?.where?.id === 'cli-1' &&
        args?.where?.tenantId === '00000000-0000-0000-0000-000000000001'
          ? { sessionVersion: 0 }
          : null,
      findMany: async () => stato.clienti,
    },
    documento: { findMany: async () => stato.documenti },
    microvoceProgetto: {
      findMany: async (args: any) => {
        stato.chiamateMicrovoci.push(args);
        const richiesti: string[] = args?.where?.id?.in ?? [];
        return stato.microvoci.filter((m) => richiesti.includes(m.id));
      },
    },
    firmaElettronica: { findMany: async () => stato.firme },
    auditLog: { create: async () => ({}) },
    $transaction: async (fn: any) => (typeof fn === 'function' ? fn(finto) : fn),
  };

  return { ...reale, prisma: finto, prismaAmministrativo: () => finto };
});

const { buildServer } = await import('./server.js');
const { InMemoryApp } = await import('./adapters/inMemoryApp.js');
const { signJwt } = await import('./util/jwt.js');

const TENANT_STUDIO = '00000000-0000-0000-0000-000000000001';

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

function tokenAdvisor() {
  return signJwt({ userId: 'usr-advisor', tenantId: TENANT_STUDIO, email: 'advisor@studio.example', ruolo: 'advisor', sessionVersion: 0 });
}

function tokenCliente() {
  return signJwt({ userId: 'client-cli-1', tenantId: TENANT_STUDIO, email: 'cliente@esempio.it', ruolo: 'cliente', sessionVersion: 0 });
}

function documento(overrides: Record<string, unknown> = {}) {
  return {
    id: 'doc-1',
    progettoId: 'prj-1',
    microvoceProgettoId: null,
    tipo: 'allegato',
    statoDoc: 'bozza',
    isArchiviato: false,
    createdAt: new Date('2026-08-01T10:00:00Z'),
    ...overrides,
  };
}

beforeEach(() => {
  stato.clienti = [
    {
      id: 'cli-1',
      nome: 'Alfa Holding Srl',
      tipo: 'company',
      progetti: [
        { id: 'prj-1', nome: 'Riorganizzazione 2026', stato: 'in_corso', numeroContratto: 'EL-2026-001', createdAt: new Date('2026-01-10T09:00:00Z') },
        { id: 'prj-2', nome: 'Due diligence', stato: 'pre_project', numeroContratto: null, createdAt: new Date('2026-02-10T09:00:00Z') },
      ],
    },
    { id: 'cli-2', nome: 'Rossi Mario', tipo: 'individual', progetti: [] },
  ];
  stato.documenti = [];
  stato.microvoci = [];
  stato.firme = [];
  stato.chiamateMicrovoci = [];
});

describe('§37 — GET /documenti/archivio', () => {
  it('senza token rifiuta: 401', async () => {
    const res = await serverConToken(null).inject({ method: 'GET', url: '/documenti/archivio' });
    expect(res.statusCode).toBe(401);
  });

  it("il token di un cliente non entra: l'archivio elenca tutti i clienti dello studio", async () => {
    const res = await serverConToken(tokenCliente()).inject({ method: 'GET', url: '/documenti/archivio' });
    expect(res.statusCode).toBe(403);
    expect(res.json().errore).toBe('Non autorizzato per il portale cliente.');
  });

  it('restituisce l\'albero cliente → progetto anche quando non c\'è nessun documento', async () => {
    const res = await serverConToken(tokenAdvisor()).inject({ method: 'GET', url: '/documenti/archivio' });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.clienti.map((c: any) => c.nome)).toEqual(['Alfa Holding Srl', 'Rossi Mario']);
    expect(body.clienti[0].progetti.map((p: any) => p.id)).toEqual(['prj-1', 'prj-2']);
    expect(body.totali).toMatchObject({ clienti: 2, progetti: 2, documenti: 0, firmati: 0, daFirmare: 0, archiviati: 0, nonCollocati: 0 });
    // Nessun documento sulla sola micro-voce: la query delle micro-voci non parte affatto.
    expect(stato.chiamateMicrovoci).toHaveLength(0);
  });

  it('conta per progetto e somma sul cliente, con la data dell\'ultimo caricamento', async () => {
    stato.documenti = [
      documento({ id: 'd1', progettoId: 'prj-1', createdAt: new Date('2026-08-01T10:00:00Z') }),
      documento({ id: 'd2', progettoId: 'prj-1', createdAt: new Date('2026-08-20T10:00:00Z') }),
      documento({ id: 'd3', progettoId: 'prj-2', createdAt: new Date('2026-03-05T10:00:00Z') }),
    ];
    const body = (await serverConToken(tokenAdvisor()).inject({ method: 'GET', url: '/documenti/archivio' })).json();
    const [alfa] = body.clienti;
    expect(alfa.progetti[0]).toMatchObject({ id: 'prj-1', documenti: 2, ultimoCaricamento: '2026-08-20T10:00:00.000Z' });
    expect(alfa.progetti[1]).toMatchObject({ id: 'prj-2', documenti: 1 });
    // Il cliente porta la somma dei progetti e la più recente delle due date.
    expect(alfa).toMatchObject({ documenti: 3, ultimoCaricamento: '2026-08-20T10:00:00.000Z' });
    expect(body.totali.documenti).toBe(3);
  });

  it('un documento agganciato alla sola micro-voce viene risalito al suo progetto', async () => {
    stato.documenti = [documento({ id: 'd1', progettoId: null, microvoceProgettoId: 'mv-9' })];
    stato.microvoci = [{ id: 'mv-9', moduloProgetto: { progettoId: 'prj-2' } }];
    const body = (await serverConToken(tokenAdvisor()).inject({ method: 'GET', url: '/documenti/archivio' })).json();
    expect(body.clienti[0].progetti[1]).toMatchObject({ id: 'prj-2', documenti: 1 });
    expect(body.totali).toMatchObject({ documenti: 1, nonCollocati: 0 });
    expect(stato.chiamateMicrovoci[0].where.id.in).toEqual(['mv-9']);
  });

  it('firmato = sigillo a database oppure copia firmata di §36; il pubblicato senza firma è «da firmare»', async () => {
    stato.documenti = [
      documento({ id: 'd-sigillo', statoDoc: 'pubblicato' }),
      documento({ id: 'd-copia', tipo: 'firmato', statoDoc: 'firmato' }),
      documento({ id: 'd-attesa', statoDoc: 'pubblicato' }),
      documento({ id: 'd-bozza', statoDoc: 'bozza' }),
    ];
    stato.firme = [{ riferimentoId: 'd-sigillo' }];
    const body = (await serverConToken(tokenAdvisor()).inject({ method: 'GET', url: '/documenti/archivio' })).json();
    expect(body.totali).toMatchObject({ documenti: 4, firmati: 2, daFirmare: 1 });
    // La bozza non è né firmata né da firmare: il cliente non l'ha nemmeno vista.
    expect(body.clienti[0].progetti[0]).toMatchObject({ documenti: 4, firmati: 2, daFirmare: 1 });
  });

  it('gli archiviati stanno in un contatore a parte e non alzano la data di ultimo caricamento', async () => {
    stato.documenti = [
      documento({ id: 'd-attivo', createdAt: new Date('2026-05-01T10:00:00Z') }),
      documento({ id: 'd-archiviato', isArchiviato: true, statoDoc: 'firmato', tipo: 'firmato', createdAt: new Date('2026-08-25T10:00:00Z') }),
    ];
    const body = (await serverConToken(tokenAdvisor()).inject({ method: 'GET', url: '/documenti/archivio' })).json();
    expect(body.clienti[0].progetti[0]).toMatchObject({
      documenti: 1,
      firmati: 0,
      archiviati: 1,
      ultimoCaricamento: '2026-05-01T10:00:00.000Z',
    });
    expect(body.totali).toMatchObject({ documenti: 1, archiviati: 1 });
  });

  it('un documento senza progetto e senza micro-voce risolvibile viene dichiarato, non nascosto', async () => {
    stato.documenti = [
      documento({ id: 'd-orfano', progettoId: null, microvoceProgettoId: null }),
      documento({ id: 'd-mv-persa', progettoId: null, microvoceProgettoId: 'mv-cancellata' }),
      documento({ id: 'd-ok' }),
    ];
    const body = (await serverConToken(tokenAdvisor()).inject({ method: 'GET', url: '/documenti/archivio' })).json();
    expect(body.totali).toMatchObject({ documenti: 1, nonCollocati: 2 });
  });

  it('un progetto di un altro cliente non finisce nella cartella sbagliata', async () => {
    stato.clienti.push({
      id: 'cli-3',
      nome: 'Beta Spa',
      tipo: 'company',
      progetti: [{ id: 'prj-9', nome: 'Trust Beta', stato: 'in_corso', numeroContratto: null, createdAt: new Date('2026-04-01T09:00:00Z') }],
    });
    stato.documenti = [documento({ id: 'd1', progettoId: 'prj-9' })];
    const body = (await serverConToken(tokenAdvisor()).inject({ method: 'GET', url: '/documenti/archivio' })).json();
    const perNome = Object.fromEntries(body.clienti.map((c: any) => [c.nome, c.documenti]));
    expect(perNome).toMatchObject({ 'Alfa Holding Srl': 0, 'Rossi Mario': 0, 'Beta Spa': 1 });
  });
});
