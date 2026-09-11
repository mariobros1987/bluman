import { beforeEach, describe, expect, it, vi } from 'vitest';

const {
  mockClienteFindMany,
  mockScadenzaFindMany,
  mockNotificaFindFirst,
  mockNotificaStudio,
  mockRecordAudit,
} = vi.hoisted(() => ({
  mockClienteFindMany: vi.fn(),
  mockScadenzaFindMany: vi.fn(),
  mockNotificaFindFirst: vi.fn(),
  mockNotificaStudio: vi.fn(),
  mockRecordAudit: vi.fn(),
}));

vi.mock('../util/prismaClient.js', () => ({
  prisma: {
    cliente: { findMany: mockClienteFindMany },
    scadenzaIncasso: { findMany: mockScadenzaFindMany },
    notifica: { findFirst: mockNotificaFindFirst },
  },
}));

vi.mock('./notificheService.js', () => ({
  notificaStudioSilenziosa: mockNotificaStudio,
}));

vi.mock('../util/serverHelpers.js', () => ({
  recordAudit: mockRecordAudit,
}));

import { runDailyNotificationCron } from './cronService.js';

describe('runDailyNotificationCron', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockClienteFindMany.mockResolvedValue([]);
    mockScadenzaFindMany.mockResolvedValue([]);
    mockRecordAudit.mockResolvedValue(undefined);
  });

  it('mantiene il report vuoto per il controllo legacy senza tenant', async () => {
    const report = await runDailyNotificationCron();

    expect(report.notificheInviate).toBe(0);
    expect(mockClienteFindMany).not.toHaveBeenCalled();
  });

  it('propaga i guasti operativi invece di restituire un falso successo', async () => {
    mockClienteFindMany.mockRejectedValueOnce(new Error('database non raggiungibile'));

    await expect(runDailyNotificationCron('tenant-1')).rejects.toThrow('database non raggiungibile');
    expect(mockRecordAudit).not.toHaveBeenCalled();
  });

  it('non duplica una notifica identica già creata nelle ultime 20 ore', async () => {
    mockClienteFindMany.mockResolvedValueOnce([{
      nome: 'Alfa S.r.l.',
      dataKyc: new Date('2020-01-01T00:00:00.000Z'),
      email: 'amministrazione@example.test',
      cellulare: null,
    }]);
    mockNotificaFindFirst.mockResolvedValueOnce({ id: 'notifica-esistente' });

    const report = await runDailyNotificationCron('tenant-3');

    expect(report.scadenzeUboTrovate).toBe(1);
    expect(report.notificheInviate).toBe(0);
    expect(mockNotificaFindFirst).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({ tenantId: 'tenant-3', tipoEvento: 'scadenza_imminente' }),
    }));
    expect(mockNotificaStudio).not.toHaveBeenCalled();
  });

  it('esegue tutte le query operative nel perimetro del tenant ricevuto', async () => {
    await runDailyNotificationCron('tenant-2');

    expect(mockClienteFindMany).toHaveBeenCalledWith({ where: { tenantId: 'tenant-2' } });
    expect(mockScadenzaFindMany).toHaveBeenCalledWith(expect.objectContaining({
      where: { tenantId: 'tenant-2', stato: 'in_attesa' },
    }));
    expect(mockRecordAudit).toHaveBeenCalledWith(expect.objectContaining({ tenantId: 'tenant-2' }));
  });
});
