import { beforeEach, describe, expect, it, vi } from 'vitest';

const {
  mockTenantFindMany,
  mockCron,
  mockSignal,
  mockPrismaDisconnect,
  mockAdminDisconnect,
  contesti,
} = vi.hoisted(() => ({
  mockTenantFindMany: vi.fn(),
  mockCron: vi.fn(),
  mockSignal: vi.fn(),
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

// La ricezione Signal ha un mock suo perché il suo trasporto (demone HTTP, storage degli
// allegati) non ha niente a che vedere con quello che questo test verifica: qui interessa solo
// che il giro la chiami una volta per studio e che il suo esito non venga confuso con quello
// delle notifiche.
vi.mock('../services/signalInbound.js', () => ({
  riceviMessaggiSignal: mockSignal,
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
    mockSignal.mockResolvedValue({ nonConfigurato: true, letti: 0, registrati: 0, scartati: 0 });
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
    expect(mockSignal.mock.calls).toEqual([['tenant-a'], ['tenant-b']]);
    expect(esito).toMatchObject({
      tenantAttivi: 2,
      tenantCompletati: 2,
      tenantFalliti: 0,
      notificheInviate: 5,
      messaggiSignal: 0,
    });
  });

  it('somma i messaggi Signal registrati e non fa fallire il giro se il demone è spento', async () => {
    mockTenantFindMany.mockResolvedValue([{ id: 'tenant-a' }, { id: 'tenant-b' }]);
    mockCron.mockResolvedValue(report(1));
    mockSignal
      .mockResolvedValueOnce({ letti: 3, registrati: 2, scartati: 1 })
      .mockRejectedValueOnce(new Error('demone Signal non raggiungibile'));

    const esito = await eseguiCronPerTenantAttivi();

    // Il demone spento di uno studio non è un cron fallito: le scadenze sono state notificate
    // comunque, e il guasto va letto accanto al canale, non al posto delle notifiche.
    expect(esito).toMatchObject({
      tenantCompletati: 2,
      tenantFalliti: 0,
      notificheInviate: 2,
      messaggiSignal: 2,
    });
    expect(esito.esiti[0]?.signal).toEqual({ letti: 3, registrati: 2, scartati: 1 });
    expect(esito.esiti[1]?.signal).toMatchObject({ errore: 'demone Signal non raggiungibile' });
    expect(esito.esiti[1]?.ok).toBe(true);
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
