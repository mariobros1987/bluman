import { describe, it, expect, beforeEach, vi } from 'vitest';
import { eseguiAuditIntegritaProgetti } from './auditIntegritaProgetti.js';

const TENANT_TEST = 'tenant-audit-1';

const mockDb = {
  tenants: [{ id: TENANT_TEST, ragioneSociale: 'Studio Audit Test', stato: 'attivo' }],
  progetti: [] as any[],
  dipendenze: [] as any[],
  ricalcolaChiamate: [] as string[],
};

vi.mock('../util/prismaClient.js', () => ({
  prismaAmministrativo: () => ({
    tenant: {
      findMany: async () => mockDb.tenants,
    },
  }),
  prisma: {
    progetto: {
      findMany: async () => mockDb.progetti,
    },
    moduloDipendenzaTemplate: {
      findMany: async () => mockDb.dipendenze,
    },
  },
  contestoTenant: {
    run: async (_ctx: any, callback: () => Promise<any>) => await callback(),
  },
}));

vi.mock('../services/calcoloService.js', () => ({
  calcolaAvanzamento: (p: any) => {
    // Se ha moduli con microvoci completate al 100%
    if (p.moduli?.every((m: any) => m.stato === 'done')) {
      return { percentuale: 100, totaleModuli: p.moduli.length, moduliCompletati: p.moduli.length };
    }
    return { percentuale: 50, totaleModuli: p.moduli?.length || 0, moduliCompletati: 0 };
  },
  ricalcolaProgetto: async (id: string) => {
    mockDb.ricalcolaChiamate.push(id);
    return { percentuale: 50 };
  },
}));

describe('FASE 4 — Script Audit Integrità Progetti & Bonifica', () => {
  beforeEach(() => {
    mockDb.progetti = [];
    mockDb.dipendenze = [];
    mockDb.ricalcolaChiamate = [];
  });

  it('segnala moduli senza microvoci su progetti in corso', async () => {
    mockDb.progetti = [
      {
        id: 'proj-1',
        nome: 'Progetto Test Anomalo',
        tenantId: TENANT_TEST,
        stato: 'in_progress',
        avanzamentoPercentuale: 50,
        moduli: [
          {
            id: 'mod-1',
            nome: 'Modulo Vuoto',
            stato: 'todo',
            microvoci: [],
          },
        ],
      },
    ];

    const report = await eseguiAuditIntegritaProgetti({ tenantId: TENANT_TEST });
    expect(report.progettiScansionati).toBe(1);
    expect(report.progettiConAnomalie).toBe(1);
    expect(report.anomalie).toHaveLength(1);
    expect(report.anomalie[0]!.tipo).toBe('modulo_senza_voci');
    expect(report.anomalie[0]!.descrizione).toContain('non ha microvoci');
  });

  it('segnala divergenze di avanzamento percentuale in sola lettura (dry-run)', async () => {
    mockDb.progetti = [
      {
        id: 'proj-2',
        nome: 'Progetto con Divergenza',
        tenantId: TENANT_TEST,
        stato: 'in_progress',
        avanzamentoPercentuale: 20, // Divergenza: DB ha 20%, calcolo effettivo dà 50%
        moduli: [
          {
            id: 'mod-2',
            nome: 'Modulo con Voci',
            stato: 'in_progress',
            microvoci: [{ id: 'mv-1', completata: false }],
          },
        ],
      },
    ];

    const report = await eseguiAuditIntegritaProgetti({ tenantId: TENANT_TEST, fix: false });
    expect(report.anomalie).toHaveLength(1);
    expect(report.anomalie[0]!.tipo).toBe('divergenza_avanzamento');
    expect(report.anomalie[0]!.bonificata).toBe(false);
    expect(mockDb.ricalcolaChiamate).toHaveLength(0);
  });

  it('bonifica automaticamente le divergenze di avanzamento con il flag fix: true', async () => {
    mockDb.progetti = [
      {
        id: 'proj-2',
        nome: 'Progetto con Divergenza',
        tenantId: TENANT_TEST,
        stato: 'in_progress',
        avanzamentoPercentuale: 10,
        moduli: [
          {
            id: 'mod-2',
            nome: 'Modulo con Voci',
            stato: 'in_progress',
            microvoci: [{ id: 'mv-1', completata: false }],
          },
        ],
      },
    ];

    const report = await eseguiAuditIntegritaProgetti({ tenantId: TENANT_TEST, fix: true });
    expect(report.anomalie).toHaveLength(1);
    expect(report.anomalie[0]!.bonificata).toBe(true);
    expect(report.bonificheEseguite).toBe(1);
    expect(mockDb.ricalcolaChiamate).toContain('proj-2');
  });

  it('conferma zero anomalie su progetti perfettamente coerenti', async () => {
    mockDb.progetti = [
      {
        id: 'proj-ok',
        nome: 'Progetto Regolare',
        tenantId: TENANT_TEST,
        stato: 'in_progress',
        avanzamentoPercentuale: 50,
        moduli: [
          {
            id: 'mod-ok',
            nome: 'Modulo Ok',
            stato: 'in_progress',
            microvoci: [{ id: 'mv-ok', completata: false }],
          },
        ],
      },
    ];

    const report = await eseguiAuditIntegritaProgetti({ tenantId: TENANT_TEST });
    expect(report.anomalie).toHaveLength(0);
    expect(report.progettiConAnomalie).toBe(0);
  });
});
