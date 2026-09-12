import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  accodaNotificaEmail,
  accodaNotificaWhatsApp,
  getJobStato,
  getJobsPerTenant,
  svuotaCodaPerTest,
  attendiCodaVuota,
} from './services/notificationQueue.js';

const TENANT_1 = 'tenant-test-1';
const TENANT_2 = 'tenant-test-2';

vi.mock('./util/serverHelpers.js', async (importOriginal) => {
  const mod = await importOriginal<typeof import('./util/serverHelpers.js')>();
  return {
    ...mod,
    recordAudit: vi.fn().mockResolvedValue(undefined),
  };
});

describe('Notification Queue — Coda Asincrona con Retry (FASE 2.3)', () => {
  beforeEach(() => {
    svuotaCodaPerTest();
  });

  afterEach(() => {
    svuotaCodaPerTest();
  });

  it('accoda ed invia con successo una email al primo tentativo', async () => {
    const inviaEmailMock = vi.fn().mockResolvedValue({ ok: true });

    const job = accodaNotificaEmail(
      TENANT_1,
      { to: 'cliente@test.com', subject: 'Oggetto Test', html: '<p>Test</p>' },
      undefined,
      {
        backoffMs: [10, 20, 30],
        inviaEmailFn: inviaEmailMock,
      },
    );

    expect(job.id).toBeDefined();
    expect(job.stato).toBe('in_attesa');
    expect(job.tipo).toBe('email');

    await attendiCodaVuota();

    const jobAggiornato = getJobStato(job.id);
    expect(jobAggiornato).not.toBeNull();
    expect(jobAggiornato!.stato).toBe('completato');
    expect(jobAggiornato!.tentativi).toBe(1);
    expect(jobAggiornato!.completatoAt).toBeInstanceOf(Date);
    expect(jobAggiornato!.ultimoErrore).toBeNull();
    expect(inviaEmailMock).toHaveBeenCalledTimes(1);
  });

  it('accoda ed invia con successo un messaggio WhatsApp', async () => {
    const inviaWhatsAppMock = vi.fn().mockResolvedValue({ ok: true });

    const job = accodaNotificaWhatsApp(
      TENANT_1,
      { waPhoneId: '12345', waAccessToken: 'token-abc' },
      '393331234567',
      'Ciao, ecco la tua notifica',
      {
        backoffMs: [10, 20, 30],
        inviaWhatsAppFn: inviaWhatsAppMock,
      },
    );

    expect(job.id).toBeDefined();
    expect(job.tipo).toBe('whatsapp');

    await attendiCodaVuota();

    const jobAggiornato = getJobStato(job.id);
    expect(jobAggiornato!.stato).toBe('completato');
    expect(jobAggiornato!.tentativi).toBe(1);
    expect(inviaWhatsAppMock).toHaveBeenCalledWith(
      { waPhoneId: '12345', waAccessToken: 'token-abc' },
      '393331234567',
      'Ciao, ecco la tua notifica',
    );
  });

  it('esegue il retry su fallimento temporaneo e completa al terzo tentativo', async () => {
    let chiamate = 0;
    const inviaEmailMock = vi.fn().mockImplementation(async () => {
      chiamate += 1;
      if (chiamate < 3) {
        return { ok: false, errore: `Timeout temporaneo tentativo ${chiamate}` };
      }
      return { ok: true };
    });

    const job = accodaNotificaEmail(
      TENANT_1,
      { to: 'cliente@test.com', subject: 'Oggetto Test', html: '<p>Test</p>' },
      undefined,
      {
        maxTentativi: 3,
        backoffMs: [15, 25, 40],
        inviaEmailFn: inviaEmailMock,
      },
    );

    await attendiCodaVuota();

    const jobAggiornato = getJobStato(job.id);
    expect(jobAggiornato!.stato).toBe('completato');
    expect(jobAggiornato!.tentativi).toBe(3);
    expect(inviaEmailMock).toHaveBeenCalledTimes(3);
  });

  it('marca il job come fallito ed esegue audit log dopo aver esaurito tutti i tentativi', async () => {
    const inviaEmailMock = vi.fn().mockResolvedValue({
      ok: false,
      errore: 'SMTP connection refused: auth failed',
    });

    const job = accodaNotificaEmail(
      TENANT_1,
      { to: 'cliente@test.com', subject: 'Oggetto Test', html: '<p>Test</p>' },
      undefined,
      {
        maxTentativi: 3,
        backoffMs: [10, 15, 20],
        inviaEmailFn: inviaEmailMock,
      },
    );

    await attendiCodaVuota();

    const jobAggiornato = getJobStato(job.id);
    expect(jobAggiornato!.stato).toBe('fallito');
    expect(jobAggiornato!.tentativi).toBe(3);
    expect(jobAggiornato!.ultimoErrore).toContain('SMTP connection refused');
    expect(inviaEmailMock).toHaveBeenCalledTimes(3);
  });

  it('isola i job registrati per tenantId', async () => {
    const fnMock = vi.fn().mockResolvedValue({ ok: true });

    accodaNotificaEmail(
      TENANT_1,
      { to: 't1@test.com', subject: 'T1', html: '<p>T1</p>' },
      undefined,
      { backoffMs: [10], inviaEmailFn: fnMock },
    );

    accodaNotificaEmail(
      TENANT_2,
      { to: 't2@test.com', subject: 'T2', html: '<p>T2</p>' },
      undefined,
      { backoffMs: [10], inviaEmailFn: fnMock },
    );

    await attendiCodaVuota();

    const jobsTenant1 = getJobsPerTenant(TENANT_1);
    const jobsTenant2 = getJobsPerTenant(TENANT_2);

    expect(jobsTenant1).toHaveLength(1);
    expect(jobsTenant1[0]!.tenantId).toBe(TENANT_1);
    expect(jobsTenant2).toHaveLength(1);
    expect(jobsTenant2[0]!.tenantId).toBe(TENANT_2);
  });
});
