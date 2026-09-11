import { beforeEach, describe, expect, it, vi } from 'vitest';

const {
  mockTenantFindMany,
  mockCron,
  mockPrismaDisconnect,
  mockAdminDisconnect,
  contesti,
} = vi.hoisted(() => ({
  mockTenantFindMany: vi.fn(),
  mockCron: vi.fn(),
  mockPrismaDisconnect: vi.fn(),
  mockAdminDisconnect: vi.fn(),
  contesti: [] as Array<{ tenantId: string; ruolo?: string }>,
}));

vi.mock('../util/prismaClient.js', () => {
  const amministrativo = {
    tenant: { findMany: mockTenantFindMany },
    $disconnect: mockAdminDisconnect,
  };
  return {
    prisma: { $disconnect: mockPrismaDisconnect },
    prismaAmministrativo: () => amministrativo,
    contestoTenant: {
      run: async (
        contesto: { tenantId: string; ruolo?: string },
        callback: () => Promise<unknown>,
      ) => {
        contesti.push(contesto);
        return callback();
      },
    },
  };
});

vi.mock('../services/cronService.js', () => ({
  runDailyNotificationCron: mockCron,
}));

import {
  ErroreRunnerCron,
  eseguiCronPerTenantAttivi,
  mainCronNotifiche,
} from './runDailyNotificationCron.js';

function report(notificheInviate: number) {
  return {
    timestamp: '2026-09-11T08:00:00.000Z',
    scadenzeUboTrovate: 0,
    scadenzeMarchiTrovate: 0,
    fattureScaduteTrovate: 0,
    microvociInRitardoTrovate: 0,
    notificheInviate,
    dettagli: [],
  };
}

describe('runner cron notifiche multi-tenant', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    contesti.length = 0;
    mockPrismaDisconnect.mockResolvedValue(undefined);
    mockAdminDisconnect.mockResolvedValue(undefined);
  });

  it('seleziona soltanto tenant attivi ed esegue ogni worker nel relativo contesto RLS', async () => {
    mockTenantFindMany.mockResolvedValue([{ id: 'tenant-a' }, { id: 'tenant-b' }]);
    mockCron.mockResolvedValueOnce(report(2)).mockResolvedValueOnce(report(3));

    const esito = await eseguiCronPerTenantAttivi();

    expect(mockTenantFindMany).toHaveBeenCalledWith({
      where: { stato: 'attivo' },
      select: { id: true },
      orderBy: { createdAt: 'asc' },
    });
    expect(contesti).toEqual([
      { tenantId: 'tenant-a', ruolo: 'super_admin' },
      { tenantId: 'tenant-b', ruolo: 'super_admin' },
    ]);
    expect(mockCron.mock.calls).toEqual([['tenant-a'], ['tenant-b']]);
    expect(esito).toMatchObject({
      tenantAttivi: 2,
      tenantCompletati: 2,
      tenantFalliti: 0,
      notificheInviate: 5,
    });
  });

  it('continua dopo il fallimento di un tenant e conserva gli esiti separati', async () => {
    mockTenantFindMany.mockResolvedValue([{ id: 'tenant-a' }, { id: 'tenant-b' }]);
    mockCron.mockRejectedValueOnce(new Error('DB non raggiungibile')).mockResolvedValueOnce(report(1));

    const esito = await eseguiCronPerTenantAttivi();

    expect(mockCron).toHaveBeenCalledTimes(2);
    expect(esito).toMatchObject({
      tenantAttivi: 2,
      tenantCompletati: 1,
      tenantFalliti: 1,
      notificheInviate: 1,
      esiti: [
        { tenantId: 'tenant-a', ok: false, errore: 'DB non raggiungibile' },
        { tenantId: 'tenant-b', ok: true },
      ],
    });
  });

  it('il comando fallisce e disconnette entrambi i client se un tenant fallisce', async () => {
    mockTenantFindMany.mockResolvedValue([{ id: 'tenant-a' }]);
    mockCron.mockRejectedValueOnce(new Error('errore simulato'));
    vi.spyOn(console, 'log').mockImplementation(() => undefined);

    await expect(mainCronNotifiche()).rejects.toBeInstanceOf(ErroreRunnerCron);
    expect(mockPrismaDisconnect).toHaveBeenCalledOnce();
    expect(mockAdminDisconnect).toHaveBeenCalledOnce();
  });

  it('il comando termina regolarmente e disconnette i client quando tutti completano', async () => {
    mockTenantFindMany.mockResolvedValue([{ id: 'tenant-a' }]);
    mockCron.mockResolvedValueOnce(report(4));
    const log = vi.spyOn(console, 'log').mockImplementation(() => undefined);

    await expect(mainCronNotifiche()).resolves.toBeUndefined();
    expect(JSON.parse(String(log.mock.calls[0]?.[0]))).toMatchObject({
      tenantCompletati: 1,
      tenantFalliti: 0,
      notificheInviate: 4,
    });
    expect(mockPrismaDisconnect).toHaveBeenCalledOnce();
    expect(mockAdminDisconnect).toHaveBeenCalledOnce();
  });
});
