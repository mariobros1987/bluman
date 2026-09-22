import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const {
  mockClienteFindMany,
  mockScadenzaFindMany,
  mockNotificaFindMany,
  mockFatturaFindMany,
  mockNotificaStudio,
  mockRecordAudit,
} = vi.hoisted(() => ({
  mockClienteFindMany: vi.fn(),
  mockScadenzaFindMany: vi.fn(),
  mockNotificaFindMany: vi.fn(),
  mockFatturaFindMany: vi.fn(),
  mockNotificaStudio: vi.fn(),
  mockRecordAudit: vi.fn(),
}));

vi.mock('../util/prismaClient.js', () => ({
  prisma: {
    cliente: { findMany: mockClienteFindMany },
    scadenzaIncasso: { findMany: mockScadenzaFindMany },
    // Il cron carica UNA volta i corpi già notificati (niente più findFirst per riga).
    notifica: { findMany: mockNotificaFindMany },
    // W2: le fatture emesse ma mai trasmesse allo SdI (statoSdi n_a da >3 giorni).
    fattura: { findMany: mockFatturaFindMany },
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
    mockNotificaFindMany.mockResolvedValue([]);
    mockFatturaFindMany.mockResolvedValue([]);
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
    // La finestra 20h contiene già il corpo esatto che il cron genererebbe per questo cliente:
    // caricato una sola volta da findMany, il dedup in memoria lo riconosce e non re-invia.
    mockNotificaFindMany.mockResolvedValueOnce([{
      corpo: '[UBO-MFSA] Promemoria rinnovo UBO / Aggiornamento KYC per Alfa S.r.l. (Ref: amministrazione@example.test)',
    }]);

    const report = await runDailyNotificationCron('tenant-3');

    expect(report.scadenzeUboTrovate).toBe(1);
    expect(report.notificheInviate).toBe(0);
    expect(mockNotificaFindMany).toHaveBeenCalledWith(expect.objectContaining({
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

  it('W2 — segnala una fattura emessa da oltre 3 giorni e mai trasmessa allo SdI', async () => {
    mockFatturaFindMany.mockResolvedValueOnce([
      { id: 'ft-non-trasmessa-0001', numero: 'FT-2026/010', data: new Date('2026-01-01'), cliente: { nome: 'Studio Rossi' } },
    ]);
    mockNotificaStudio.mockResolvedValue(1);
    const report = await runDailyNotificationCron('tenant-1');
    expect(mockNotificaStudio).toHaveBeenCalledWith(
      'tenant-1',
      expect.objectContaining({ oggetto: 'Fattura non trasmessa allo SdI' }),
    );
    expect(report.dettagli.some((d) => d.includes('non risulta ancora trasmessa'))).toBe(true);
  });
});

/**
 * Il cron e il calendario devono parlare della **stessa** scadenza.
 *
 * Le date qui sotto non sono calcolate con le funzioni del modulo: sono scritte a mano, giorno per
 * giorno, intorno ai confini. È il punto del test. Se il cron tornasse a calcolare per conto proprio
 * — o se qualcuno cambiasse la regola in `scadenzeDerivate.ts` senza cambiarla qui — questi numeri
 * smetterebbero di tornare, ed è esattamente ciò che si vuole sapere.
 */
describe('il cron e la derivazione delle scadenze usano la stessa regola', () => {
  const GIORNO_MS = 24 * 60 * 60 * 1000;
  const ADESSO = new Date('2026-09-17T10:00:00.000Z');

  /** Un cliente la cui verifica KYC è stata fatta `giorniFa` giorni fa. */
  function clienteConKyc(giorniFa: number) {
    return {
      nome: `Cliente ${giorniFa}`,
      dataKyc: new Date(ADESSO.getTime() - giorniFa * GIORNO_MS),
      email: `cliente${giorniFa}@example.test`,
      cellulare: null,
    };
  }

  /** Una rata aperta che scade fra `giorni` giorni. */
  function rataFra(giorni: number) {
    return {
      id: `sc-${giorni}`,
      dataScadenza: new Date(ADESSO.getTime() + giorni * GIORNO_MS),
      importoCentesimi: 100_000,
      numeroRata: 1,
      fattura: { cliente: { nome: `Cliente rata ${giorni}` }, progetto: null },
    };
  }

  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(ADESSO);
    // Nessuna notifica identica di ieri: qui si misura quali scadenze il cron **vede**, non la
    // deduplicazione, che ha già i suoi test.
    mockNotificaFindMany.mockResolvedValue([]);
    mockNotificaStudio.mockResolvedValue(1);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('avvisa il rinnovo KYC da 29 giorni prima, non da 30', async () => {
    // Il confine, per età del KYC: 335 giorni non basta ancora, 336 sì. È lo stesso off-by-one
    // documentato in `scadenzeDerivate.ts` — qui si vede dal comportamento del cron, non da quello
    // della funzione, che è il modo di sapere che il cron la usa davvero.
    mockClienteFindMany.mockResolvedValueOnce([334, 335, 336, 337].map(clienteConKyc));

    const report = await runDailyNotificationCron('tenant-1');

    expect(report.scadenzeUboTrovate).toBe(2);
    const dettagli = report.dettagli.join('\n');
    expect(dettagli).toContain('Cliente 336');
    expect(dettagli).toContain('Cliente 337');
    expect(dettagli).not.toContain('Cliente 335');
  });

  it('sollecita le rate a +7, 0 e −3 giorni, e in nessun altro giorno', async () => {
    // Il verso conta: +7 è una settimana **prima** della scadenza, −3 è tre giorni dopo. Invertito,
    // il sollecito arriverebbe tre giorni prima della scadenza e mai dopo.
    mockScadenzaFindMany.mockResolvedValueOnce([8, 7, 6, 1, 0, -1, -3, -4].map(rataFra));

    const report = await runDailyNotificationCron('tenant-1');

    expect(report.fattureScaduteTrovate).toBe(3);
    const dettagli = report.dettagli.join('\n');
    expect(dettagli).toContain('Cliente rata 7');
    expect(dettagli).toContain('Cliente rata 0');
    expect(dettagli).toContain('Cliente rata -3');
    expect(dettagli).not.toContain('Cliente rata -1');
  });

  it('il tono del messaggio segue la distanza dalla scadenza', async () => {
    mockScadenzaFindMany.mockResolvedValueOnce([7, 0, -3].map(rataFra));

    await runDailyNotificationCron('tenant-1');

    const corpi = mockNotificaStudio.mock.calls.map((c: any[]) => c[1].corpo as string);
    expect(corpi.some((c) => c.includes('in scadenza per'))).toBe(true);
    expect(corpi.some((c) => c.includes('in scadenza oggi per'))).toBe(true);
    expect(corpi.some((c) => c.includes('scaduta per'))).toBe(true);
  });
});
