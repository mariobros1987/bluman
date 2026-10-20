/**
 * Coda KYC — `GET /kyc/coda` e `POST /kyc/coda/approva`.
 *
 * La coda esiste perché i pannelli erano per-fascicolo: qui si presidia che la vista aggregata
 * dica la verità (un fascicolo con screening aperto NON risulta approvabile, il rischio alto
 * senza MLRO nemmeno) e che l'approvazione massiva riporti per ogni id com'è andata, senza
 * fermarsi al primo rifiuto né approvare ciò che il gate blocca.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { buildServer } from './server.js';
import { InMemoryApp } from './adapters/inMemoryApp.js';
import { prisma } from './util/prismaClient.js';
import { signJwt } from './util/jwt.js';

const TENANT_TEST = '00000000-0000-0000-0000-000000000001';

const TOKEN_ADVISOR = signJwt({
  userId: 'u-advisor',
  tenantId: TENANT_TEST,
  email: 'advisor@studio.example',
  ruolo: 'advisor',
  sessionVersion: 0,
});

const TOKEN_CLIENTE = signJwt({
  userId: 'client-1',
  tenantId: TENANT_TEST,
  email: 'cliente@example.com',
  ruolo: 'cliente',
  sessionVersion: 0,
});

const stato = vi.hoisted(() => ({
  fascicoli: [] as any[],
  screenings: [] as any[],
  settings: null as any,
  aggiornamenti: [] as any[],
}));

vi.spyOn(prisma.user as any, 'findFirst').mockImplementation(async (args: any) => {
  const ruoli: Record<string, string> = { 'u-advisor': 'advisor', 'u-operatore': 'collaboratore_interno' };
  return { ruolo: ruoli[args?.where?.id] ?? 'cliente', stato: 'attivo', sessionVersion: 0 };
});
vi.spyOn(prisma.cliente as any, 'findFirst').mockResolvedValue({ sessionVersion: 0 });
vi.spyOn(prisma.tenant as any, 'findUnique').mockResolvedValue(null); // nessuna riga → modulo attivo
vi.spyOn(prisma.tenantComplianceSettings as any, 'findUnique').mockImplementation(async () => stato.settings);
vi.spyOn(prisma.fascicoloKyc as any, 'findMany').mockImplementation(async () => stato.fascicoli);
vi.spyOn(prisma.fascicoloKyc as any, 'findFirst').mockImplementation(async (args: any) => {
  const f = stato.fascicoli.find((x) => x.id === args?.where?.id);
  return f ? { ...f, noteCompliance: null } : null;
});
vi.spyOn(prisma.fascicoloKyc as any, 'update').mockImplementation(async (args: any) => {
  stato.aggiornamenti.push(args);
  return { id: args.where.id, stato: args.data.stato };
});
vi.spyOn(prisma.screeningKyc as any, 'findMany').mockImplementation(async (args: any) =>
  stato.screenings.filter((s) => s.fascicoloId === args?.where?.fascicoloId),
);
vi.spyOn(prisma.complianceEvent as any, 'findFirst').mockResolvedValue(null);
vi.spyOn(prisma.complianceEvent as any, 'create').mockImplementation(async (args: any) => args.data);

function serverCon(token: string) {
  const server = buildServer(new InMemoryApp());
  const injectOriginale = server.inject.bind(server);
  (server as any).inject = (opts: any) =>
    injectOriginale({ ...opts, headers: { authorization: `Bearer ${token}`, ...opts?.headers } });
  return server;
}

const fascicolo = (over: Record<string, any> = {}) => ({
  id: 'f-1',
  stato: 'in_attesa_approvazione',
  livelloVerifica: 'ordinaria',
  rischioCalcolato: 'basso',
  punteggioRischio: 10,
  dataScadenza: null,
  createdAt: new Date('2026-10-01T08:00:00Z'),
  updatedAt: new Date('2026-10-02T08:00:00Z'),
  cliente: { id: 'c-1', nome: 'Rossi Srl', tipo: 'company' },
  soggetto: { denominazione: 'Rossi Srl' },
  screenings: [],
  anomalie: [],
  ...over,
});

beforeEach(() => {
  stato.fascicoli = [];
  stato.screenings = [];
  stato.aggiornamenti = [];
  stato.settings = { mlroUserId: 'mlro-1', retentionYears: 5, regulatoryProfile: 'Malta AMLA' };
});

describe('GET /kyc/coda', () => {
  it('elenca le pratiche aperte con il motivo per cui non si approvano ancora', async () => {
    stato.fascicoli = [
      fascicolo({ id: 'f-pronto' }),
      fascicolo({
        id: 'f-screening',
        punteggioRischio: 90,
        rischioCalcolato: 'alto',
        screenings: [{ tipo: 'sanzioni', esito: 'match_confermato', dataScreening: new Date('2026-10-01') }],
        anomalie: [{ id: 'a-1' }],
      }),
      fascicolo({ id: 'f-verifica', stato: 'in_verifica' }),
    ];
    const server = serverCon(TOKEN_ADVISOR);
    const res = await server.inject({ method: 'GET', url: '/kyc/coda' });
    expect(res.statusCode).toBe(200);
    const corpo = res.json();

    const perId = Object.fromEntries(corpo.fascicoli.map((f: any) => [f.id, f]));
    expect(perId['f-pronto'].approvabile).toBe(true);
    expect(perId['f-pronto'].motivi).toEqual([]);
    expect(perId['f-screening'].approvabile).toBe(false);
    expect(perId['f-screening'].screeningBloccante).toBe(true);
    expect(perId['f-screening'].anomalieAperte).toBe(1);
    expect(perId['f-verifica'].approvabile).toBe(false);
    // La coda dice anche il PERCHÉ, in italiano: chi la guarda non deve dedurlo.
    expect(perId['f-verifica'].motivi.join(' ')).toContain('in_verifica');
    // Le approvabili stanno in cima, anche se il punteggio è più basso.
    expect(corpo.fascicoli[0].id).toBe('f-pronto');
  });

  it('senza profilo regolatorio nessuna pratica è approvabile', async () => {
    stato.settings = { mlroUserId: null, retentionYears: 5, regulatoryProfile: null };
    stato.fascicoli = [fascicolo()];
    const server = serverCon(TOKEN_ADVISOR);
    const corpo = (await server.inject({ method: 'GET', url: '/kyc/coda' })).json();
    expect(corpo.profiloConfigurato).toBe(false);
    expect(corpo.fascicoli[0].approvabile).toBe(false);
    expect(corpo.fascicoli[0].motivi.join(' ')).toContain('Profilo regolatorio');
  });

  it('è riservata allo studio: il cliente riceve 403', async () => {
    const server = serverCon(TOKEN_CLIENTE);
    const res = await server.inject({ method: 'GET', url: '/kyc/coda' });
    expect(res.statusCode).toBe(403);
  });
});

describe('POST /kyc/coda/approva', () => {
  // Gli id devono essere uuid: è lo schema zod della rotta, non un dettaglio del test.
  const F_OK = '11111111-1111-4111-8111-111111111111';
  const F_BLOCCATO = '22222222-2222-4222-8222-222222222222';
  const F_ASSENTE = '33333333-3333-4333-8333-333333333333';
  const F_ALTO = '44444444-4444-4444-8444-444444444444';

  it('approva chi può e riporta il motivo per chi non può, senza fermarsi', async () => {
    stato.fascicoli = [
      fascicolo({ id: F_OK }),
      fascicolo({ id: F_BLOCCATO }),
    ];
    stato.screenings = [
      { fascicoloId: F_BLOCCATO, tipo: 'pep', esito: 'match_da_valutare', dataScreening: new Date('2026-10-01') },
    ];
    const server = serverCon(TOKEN_ADVISOR);
    const res = await server.inject({
      method: 'POST',
      url: '/kyc/coda/approva',
      payload: { ids: [F_OK, F_BLOCCATO], motivazione: 'Coda settimanale' },
    });
    expect(res.statusCode).toBe(200);
    const corpo = res.json();
    expect(corpo.approvati).toBe(1);
    expect(corpo.rifiutati).toHaveLength(1);
    expect(corpo.rifiutati[0].id).toBe(F_BLOCCATO);
    expect(corpo.rifiutati[0].motivo).toContain('PEP');
    // Solo il fascicolo passato è stato scritto.
    expect(stato.aggiornamenti).toHaveLength(1);
    expect(stato.aggiornamenti[0].where.id).toBe(F_OK);
  });

  it('il rischio alto senza MLRO resta rifiutato con il motivo giusto', async () => {
    stato.fascicoli = [fascicolo({ id: F_ALTO, rischioCalcolato: 'alto' })];
    const tokenOperatore = signJwt({
      userId: 'u-operatore', tenantId: TENANT_TEST, email: 'op@studio.example', ruolo: 'collaboratore_interno', sessionVersion: 0,
    });
    const res = await serverCon(tokenOperatore).inject({
      method: 'POST', url: '/kyc/coda/approva', payload: { ids: [F_ALTO] },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().rifiutati[0].motivo).toContain('MLRO');
    expect(stato.aggiornamenti).toHaveLength(0);
  });

  it('rifiuta una richiesta vuota o con id non validi (400)', async () => {
    const server = serverCon(TOKEN_ADVISOR);
    const vuoto = await server.inject({ method: 'POST', url: '/kyc/coda/approva', payload: { ids: [] } });
    expect(vuoto.statusCode).toBe(400);
    const nonUuid = await server.inject({ method: 'POST', url: '/kyc/coda/approva', payload: { ids: ['non-un-uuid'] } });
    expect(nonUuid.statusCode).toBe(400);
    const troppi = await server.inject({
      method: 'POST', url: '/kyc/coda/approva',
      payload: { ids: Array.from({ length: 101 }, (_, i) => `00000000-0000-4000-8000-${String(i).padStart(12, '0')}`) },
    });
    expect(troppi.statusCode).toBe(400);
  });

  it('un id inesistente non fa fallire gli altri', async () => {
    stato.fascicoli = [fascicolo({ id: F_OK })];
    const server = serverCon(TOKEN_ADVISOR);
    const res = await server.inject({
      method: 'POST',
      url: '/kyc/coda/approva',
      payload: { ids: [F_ASSENTE, F_OK] },
    });
    expect(res.statusCode).toBe(200);
    const corpo = res.json();
    expect(corpo.approvati).toBe(1);
    expect(corpo.rifiutati).toEqual([{ id: F_ASSENTE, motivo: 'Fascicolo non trovato.' }]);
  });
});
