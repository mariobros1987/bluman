import { createHmac } from 'node:crypto';
import Fastify from 'fastify';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const create = vi.fn(async () => ({ id: 'com-1' }));
const update = vi.fn(async () => ({}));
const findComunicazioni = vi.fn<any>(async () => []);
const eventiInbox = new Set<string>();
const webhookInboxCreate = vi.fn(async ({ data }: any) => {
  const chiave = `${data.tenantId}:${data.provider}:${data.eventId}`;
  if (eventiInbox.has(chiave)) throw Object.assign(new Error('Replay webhook'), {
    code: 'P2002',
    meta: { target: ['tenant_id', 'provider', 'event_id'] },
  });
  eventiInbox.add(chiave);
  return { id: `inbox-${eventiInbox.size}`, ...data };
});
const tenantFindMany = vi.fn<any>(async () => [{ id: '00000000-0000-4000-8000-000000000001' }]);
const tenantFindUnique = vi.fn<any>(async () => ({
  id: '00000000-0000-4000-8000-000000000001',
  tgBotToken: '12345:token-lungo-valido',
}));
const clienteFindMany = vi.fn<any>(async () => [{
  id: 'cli-1', nome: 'Cliente Uno', cellulare: '+39 335 123 4567', referentiJson: null,
}]);
const progettoFindMany = vi.fn<any>(async () => [{ id: 'proj-1', stato: 'in_progress' }]);

const prismaFinto: any = {
  tenant: { findMany: tenantFindMany, findUnique: tenantFindUnique },
  cliente: { findMany: clienteFindMany },
  progetto: { findMany: progettoFindMany },
  comunicazioneProgetto: { findMany: findComunicazioni, create, update },
  webhookInbox: { create: webhookInboxCreate },
  $executeRaw: vi.fn(async () => 1),
};
prismaFinto.$transaction = vi.fn(async (fn: any) => fn(prismaFinto));

vi.mock('./util/prismaClient.js', () => ({
  prisma: prismaFinto,
  prismaAmministrativo: () => prismaFinto,
  attivaContestoTenant: vi.fn(),
  conContestoInTransazione: vi.fn(async (_tx: any, fn: () => Promise<unknown>) => fn()),
}));
vi.mock('./services/notificheService.js', () => ({ notificaStudio: vi.fn(async () => undefined) }));
vi.mock('./services/otpDispatch.js', () => ({ credenzialiCanali: vi.fn(async () => ({})) }));
vi.mock('./services/storageService.js', () => ({ uploadDocumento: vi.fn() }));
vi.mock('./util/networkPolicy.js', () => ({ vietaControlli: (x: string) => x }));

const { registraRotteWebhooks } = await import('./routes/webhooks.js');
const { creaSegretoTelegram } = await import('./util/webhookSecurity.js');
const TENANT = '00000000-0000-4000-8000-000000000001';

async function app() {
  const server = Fastify();
  await server.register(registraRotteWebhooks);
  return server;
}

beforeEach(() => {
  vi.clearAllMocks();
  process.env.WA_APP_SECRET = 'wa-secret';
  process.env.TELEGRAM_WEBHOOK_SECRET = 'tg-master';
  tenantFindMany.mockResolvedValue([{ id: TENANT }]);
  tenantFindUnique.mockResolvedValue({ id: TENANT, tgBotToken: '12345:token-lungo-valido' });
  clienteFindMany.mockResolvedValue([{ id: 'cli-1', nome: 'Cliente Uno', cellulare: '+39 335 123 4567', referentiJson: null }]);
  progettoFindMany.mockResolvedValue([{ id: 'proj-1', stato: 'in_progress' }]);
  findComunicazioni.mockResolvedValue([]);
  eventiInbox.clear();
});

describe('webhook WhatsApp fail-closed', () => {
  const payload = { entry: [{ changes: [{ value: { metadata: { phone_number_id: 'wa-phone' }, messages: [{ id: 'wamid.1', from: '393351234567', type: 'text', text: { body: 'ciao' } }] } }] }] };

  it('rifiuta firma assente o errata prima di interrogare il tenant', async () => {
    const server = await app();
    const assente = await server.inject({ method: 'POST', url: '/webhooks/communications/whatsapp', payload });
    const errata = await server.inject({ method: 'POST', url: '/webhooks/communications/whatsapp', headers: { 'x-hub-signature-256': `sha256=${'0'.repeat(64)}` }, payload });
    expect([assente.statusCode, errata.statusCode]).toEqual([401, 401]);
    expect(tenantFindMany).not.toHaveBeenCalled();
    await server.close();
  });

  it('firma i byte raw e rifiuta tenant sconosciuto', async () => {
    tenantFindMany.mockResolvedValue([]);
    const server = await app();
    const raw = JSON.stringify(payload);
    const signature = `sha256=${createHmac('sha256', 'wa-secret').update(raw).digest('hex')}`;
    const res = await server.inject({ method: 'POST', url: '/webhooks/communications/whatsapp', headers: { 'content-type': 'application/json', 'x-hub-signature-256': signature }, payload: raw });
    expect(res.statusCode).toBe(404);
    expect(create).not.toHaveBeenCalled();
    await server.close();
  });

  it('non persiste sender ambiguo e ignora replay con claim atomico', async () => {
    const raw = JSON.stringify(payload);
    const signature = `sha256=${createHmac('sha256', 'wa-secret').update(raw).digest('hex')}`;
    const server = await app();
    clienteFindMany.mockResolvedValueOnce([
      { id: 'cli-1', nome: 'Uno', cellulare: '+393351234567', referentiJson: null },
      { id: 'cli-2', nome: 'Due', cellulare: '+393351234567', referentiJson: null },
    ]);
    await server.inject({ method: 'POST', url: '/webhooks/communications/whatsapp', headers: { 'content-type': 'application/json', 'x-hub-signature-256': signature }, payload: raw });
    expect(create).not.toHaveBeenCalled();

    const [prima, seconda] = await Promise.all([
      server.inject({ method: 'POST', url: '/webhooks/communications/whatsapp', headers: { 'content-type': 'application/json', 'x-hub-signature-256': signature }, payload: raw }),
      server.inject({ method: 'POST', url: '/webhooks/communications/whatsapp', headers: { 'content-type': 'application/json', 'x-hub-signature-256': signature }, payload: raw }),
    ]);
    expect([prima.statusCode, seconda.statusCode]).toEqual([200, 200]);
    expect(create).toHaveBeenCalledTimes(1);
    expect(webhookInboxCreate).toHaveBeenCalledWith({
      data: { tenantId: TENANT, provider: 'whatsapp_message', eventId: 'wamid.1' },
    });
    await server.close();
  });

  it('applica una sola volta la stessa ricevuta WhatsApp', async () => {
    const ricevuta = { entry: [{ changes: [{ value: {
      metadata: { phone_number_id: 'wa-phone' },
      statuses: [{ id: 'wamid.out.1', status: 'delivered' }],
    } }] }] };
    const raw = JSON.stringify(ricevuta);
    const signature = `sha256=${createHmac('sha256', 'wa-secret').update(raw).digest('hex')}`;
    findComunicazioni.mockResolvedValue([{ id: 'com-out-1' }]);
    const server = await app();

    const richiesta = () => server.inject({
      method: 'POST',
      url: '/webhooks/communications/whatsapp',
      headers: { 'content-type': 'application/json', 'x-hub-signature-256': signature },
      payload: raw,
    });
    const [prima, seconda] = await Promise.all([richiesta(), richiesta()]);

    expect([prima.statusCode, seconda.statusCode]).toEqual([200, 200]);
    expect(update).toHaveBeenCalledTimes(1);
    expect(webhookInboxCreate).toHaveBeenCalledWith({
      data: { tenantId: TENANT, provider: 'whatsapp_status', eventId: 'wamid.out.1:delivered' },
    });
    await server.close();
  });
});

describe('webhook Telegram fail-closed', () => {
  const payload = { update_id: 42, message: { chat: { id: '99' }, text: 'ciao' } };

  it('rifiuta secret assente/errato e tenant sconosciuto', async () => {
    const server = await app();
    const assente = await server.inject({ method: 'POST', url: '/webhooks/communications/telegram', payload });
    const errato = await server.inject({ method: 'POST', url: '/webhooks/communications/telegram', headers: { 'x-telegram-bot-api-secret-token': `${TENANT.replaceAll('-', '')}_${'x'.repeat(43)}` }, payload });
    tenantFindUnique.mockResolvedValueOnce(null);
    const sconosciutoSecret = creaSegretoTelegram(TENANT, '12345:token-lungo-valido', 'tg-master');
    const sconosciuto = await server.inject({ method: 'POST', url: '/webhooks/communications/telegram', headers: { 'x-telegram-bot-api-secret-token': sconosciutoSecret }, payload });
    expect([assente.statusCode, errato.statusCode, sconosciuto.statusCode]).toEqual([401, 401, 404]);
    expect(create).not.toHaveBeenCalled();
    await server.close();
  });

  it('non persiste sender sconosciuto o ambiguo e confina le query al tenant', async () => {
    const server = await app();
    const secret = creaSegretoTelegram(TENANT, '12345:token-lungo-valido', 'tg-master');
    clienteFindMany.mockResolvedValueOnce([]).mockResolvedValueOnce([{ id: '1', nome: 'Uno' }, { id: '2', nome: 'Due' }]);
    for (let i = 0; i < 2; i++) {
      await server.inject({ method: 'POST', url: '/webhooks/communications/telegram', headers: { 'x-telegram-bot-api-secret-token': secret }, payload: { ...payload, update_id: 42 + i } });
    }
    expect(create).not.toHaveBeenCalled();
    expect(clienteFindMany).toHaveBeenCalledWith(expect.objectContaining({ where: { tenantId: TENANT, telegramChatId: '99' } }));
    await server.close();
  });

  it('deduplica atomicamente update Telegram concorrenti', async () => {
    const server = await app();
    const secret = creaSegretoTelegram(TENANT, '12345:token-lungo-valido', 'tg-master');
    const richiesta = () => server.inject({
      method: 'POST',
      url: '/webhooks/communications/telegram',
      headers: { 'x-telegram-bot-api-secret-token': secret },
      payload,
    });

    const [prima, seconda] = await Promise.all([richiesta(), richiesta()]);
    expect([prima.statusCode, seconda.statusCode]).toEqual([200, 200]);
    expect(create).toHaveBeenCalledTimes(1);
    expect([prima.json(), seconda.json()]).toContainEqual({ ok: true, duplicate: true });
    expect(webhookInboxCreate).toHaveBeenCalledWith({
      data: { tenantId: TENANT, provider: 'telegram_update', eventId: '42' },
    });
    await server.close();
  });

  it('non maschera P2002 di vincoli diversi dalla inbox webhook', async () => {
    const server = await app();
    const secret = creaSegretoTelegram(TENANT, '12345:token-lungo-valido', 'tg-master');
    webhookInboxCreate.mockRejectedValueOnce(Object.assign(new Error('Altro vincolo univoco'), {
      code: 'P2002',
      meta: { target: ['external_id'] },
    }));

    const res = await server.inject({
      method: 'POST',
      url: '/webhooks/communications/telegram',
      headers: { 'x-telegram-bot-api-secret-token': secret },
      payload,
    });
    expect(res.statusCode).toBe(500);
    expect(res.json()).toEqual({ errore: 'Elaborazione webhook fallita' });
    await server.close();
  });
});
