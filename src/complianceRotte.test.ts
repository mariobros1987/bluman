/**
 * Compliance di studio — i quattro corpi che ora passano da uno schema zod.
 *
 * Non si prova l'impaginazione né il PDF: si prova che la guardia di forma **non cambi le regole**
 * che l'handler già applicava (pacchetto sconosciuto → `MT`, profilo sconosciuto → `null`, numeri
 * fuori scala chiusi nell'intervallo, `"2025"` e `2025` lo stesso anno) e che un corpo proprio
 * sbagliato venga rifiutato al bordo invece di arrivare a Prisma.
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

const stato = vi.hoisted(() => ({
  impostazioni: null as any,
  upsertImpostazioni: [] as any[],
  braCreate: [] as any[],
  formazioneCreate: [] as any[],
  fiauUpsert: [] as any[],
}));

vi.spyOn(prisma.user as any, 'findFirst').mockImplementation(async (args: any) => {
  // L'hook auth chiede ruolo/stato/sessionVersion; la rotta compliance chiede solo `id` per sapere
  // se il MLRO indicato è davvero un utente dello studio.
  if (args?.select?.id) return args.where.id === 'mlro-ok' ? { id: 'mlro-ok' } : null;
  return { ruolo: 'advisor', stato: 'attivo', sessionVersion: 0 };
});
vi.spyOn(prisma.cliente as any, 'findFirst').mockResolvedValue(null);
vi.spyOn(prisma.tenant as any, 'findUnique').mockResolvedValue(null); // nessuna riga → modulo attivo
vi.spyOn(prisma.tenantComplianceSettings as any, 'findUnique').mockImplementation(async () => stato.impostazioni);
vi.spyOn(prisma.tenantComplianceSettings as any, 'upsert').mockImplementation(async (args: any) => {
  stato.upsertImpostazioni.push(args);
  return { tenantId: TENANT_TEST, ...args.create, ...args.update };
});
vi.spyOn(prisma.complianceEvent as any, 'findFirst').mockResolvedValue(null);
vi.spyOn(prisma.complianceEvent as any, 'create').mockImplementation(async (args: any) => args.data);
vi.spyOn(prisma.businessRiskAssessment as any, 'findFirst').mockResolvedValue({ versione: 1 });
vi.spyOn(prisma.businessRiskAssessment as any, 'create').mockImplementation(async (args: any) => {
  stato.braCreate.push(args.data);
  return { id: 'bra-2', ...args.data };
});
vi.spyOn(prisma.trainingRecord as any, 'create').mockImplementation(async (args: any) => {
  stato.formazioneCreate.push(args.data);
  return { id: 'tr-1', ...args.data };
});
vi.spyOn(prisma.questionarioFiau as any, 'upsert').mockImplementation(async (args: any) => {
  stato.fiauUpsert.push(args);
  return { id: 'qf-1', ...args.create };
});

function server() {
  const s = buildServer(new InMemoryApp());
  const injectOriginale = s.inject.bind(s);
  (s as any).inject = (opts: any) =>
    injectOriginale({ ...opts, headers: { authorization: `Bearer ${TOKEN_ADVISOR}`, ...opts?.headers } });
  return s;
}

beforeEach(() => {
  stato.impostazioni = { mlroUserId: 'mlro-ok', retentionYears: 5, regulatoryProfile: 'CSP_MFSA' };
  stato.upsertImpostazioni = [];
  stato.braCreate = [];
  stato.formazioneCreate = [];
  stato.fiauUpsert = [];
});

describe('PUT /tenant/compliance-settings', () => {
  it('normalizza i valori come faceva l’handler, senza `Record<string, any>`', async () => {
    const res = await server().inject({
      method: 'PUT',
      url: '/tenant/compliance-settings',
      payload: {
        jurisdictionPack: 'XX',          // sconosciuto → MT
        regulatoryProfile: 'INVENTATO',  // sconosciuto → null
        retentionYears: '999',            // fuori scala → 30
        sogliaTitolareEffettivo: 250,     // fuori scala → 100
        otherSubjectCategory: '  Trust  ',
        reportingChannel: 'goAML',
      },
    });
    expect(res.statusCode).toBe(200);
    const dati = stato.upsertImpostazioni[0].create;
    expect(dati.jurisdictionPack).toBe('MT');
    expect(dati.regulatoryProfile).toBeNull();
    expect(dati.retentionYears).toBe(30);
    expect(dati.sogliaTitolareEffettivo).toBe(100);
    expect(dati.otherSubjectCategory).toBe('  Trust  ');
  });

  it('un MLRO che non è un utente dello studio resta un 400', async () => {
    const res = await server().inject({
      method: 'PUT',
      url: '/tenant/compliance-settings',
      payload: { mlroUserId: 'estraneo' },
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().errore).toMatch(/MLRO/i);
    expect(stato.upsertImpostazioni).toHaveLength(0);
  });

  it('un campo del tipo sbagliato viene rifiutato al bordo', async () => {
    const res = await server().inject({
      method: 'PUT',
      url: '/tenant/compliance-settings',
      payload: { jurisdictionPack: { a: 1 } },
    });
    expect(res.statusCode).toBe(400);
    expect(stato.upsertImpostazioni).toHaveLength(0);
  });
});

describe('POST /tenant/business-risk', () => {
  it('senza le quattro motivazioni resta 400 (§6)', async () => {
    const res = await server().inject({
      method: 'POST',
      url: '/tenant/business-risk',
      payload: { clientelaLivello: 'alto', clientelaMotivazione: 'Clientela complessa' },
    });
    expect(res.statusCode).toBe(400);
    expect(stato.braCreate).toHaveLength(0);
  });

  it('livello sconosciuto → «basso», e la versione sale', async () => {
    const res = await server().inject({
      method: 'POST',
      url: '/tenant/business-risk',
      payload: {
        clientelaLivello: 'altissimo',
        clientelaMotivazione: 'ok',
        serviziLivello: 'medio', serviziMotivazione: 'ok',
        geografiaLivello: 'basso', geografiaMotivazione: 'ok',
        canaliLivello: 'basso', canaliMotivazione: 'ok',
      },
    });
    expect(res.statusCode).toBe(200);
    expect(stato.braCreate[0].clientelaLivello).toBe('basso');
    expect(stato.braCreate[0].versione).toBe(2);
  });
});

describe('POST /tenant/formazione', () => {
  it('titolo assente → 400 parlante', async () => {
    const res = await server().inject({ method: 'POST', url: '/tenant/formazione', payload: { data: '2026-10-01' } });
    expect(res.statusCode).toBe(400);
    expect(res.json().errore).toMatch(/Titolo/i);
  });

  it('tipo sconosciuto → «personale», ore come stringa → numero', async () => {
    const res = await server().inject({
      method: 'POST',
      url: '/tenant/formazione',
      payload: { titolo: '  AML annuale  ', data: '2026-10-01', tipo: 'inventato', oreFormazione: '3.5' },
    });
    expect(res.statusCode).toBe(200);
    const r = stato.formazioneCreate[0];
    expect(r.titolo).toBe('AML annuale');
    expect(r.tipo).toBe('personale');
    expect(r.oreFormazione).toBe(3.5);
  });

  it('data non valida → 400, non una riga con data inventata', async () => {
    const res = await server().inject({
      method: 'POST',
      url: '/tenant/formazione',
      payload: { titolo: 'Corso', data: 'non-una-data' },
    });
    expect(res.statusCode).toBe(400);
    expect(stato.formazioneCreate).toHaveLength(0);
  });
});

describe('POST /tenant/questionario-fiau', () => {
  it('«2025» e 2025 sono lo stesso anno (coercizione), e lo stato sconosciuto è bozza', async () => {
    const res = await server().inject({
      method: 'POST',
      url: '/tenant/questionario-fiau',
      payload: { anno: '2025', stato: 'inventato', contenuto: { domande: 1 } },
    });
    expect(res.statusCode).toBe(200);
    const args = stato.fiauUpsert[0];
    expect(args.where.tenantId_anno).toEqual({ tenantId: TENANT_TEST, anno: 2025 });
    expect(args.create.stato).toBe('bozza');
  });

  it('«trasmesso» senza riferimento resta un 400 (regola 7)', async () => {
    const res = await server().inject({
      method: 'POST',
      url: '/tenant/questionario-fiau',
      payload: { anno: 2025, stato: 'trasmesso' },
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().errore).toMatch(/riferimento/i);
    expect(stato.fiauUpsert).toHaveLength(0);
  });

  it('anno mancante o fuori intervallo → 400', async () => {
    const s = server();
    expect((await s.inject({ method: 'POST', url: '/tenant/questionario-fiau', payload: {} })).statusCode).toBe(400);
    expect((await s.inject({ method: 'POST', url: '/tenant/questionario-fiau', payload: { anno: 1999 } })).statusCode).toBe(400);
  });
});
