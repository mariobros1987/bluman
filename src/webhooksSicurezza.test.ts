/**
 * Presidio di sicurezza dei webhook in ingresso, sul modello **per studio**.
 *
 * Le credenziali non sono più di piattaforma: lo studio si deduce dallo slug nel path e da lì si
 * leggono il suo App Secret e il suo Verify Token. Questo file verifica le proprietà che rendono
 * l'inversione sicura invece che pericolosa — che uno slug ignoto non risolva nulla, che la firma
 * si verifichi **prima** di toccare i dati, e soprattutto che il segreto di uno studio non possa
 * autenticare un messaggio destinato a un altro.
 */
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
const tenantFindMany = vi.fn<any>(async () => [{
  id: '00000000-0000-4000-8000-000000000001',
  waAppSecret: 'segreto-dello-studio',
  waVerifyToken: 'verify-dello-studio',
  waPhoneId: 'wa-phone',
}]);
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
/** Slug dello studio: 32 caratteri, la forma che `gen_random_uuid()` produce senza trattini. */
const SLUG = 'a'.repeat(32);
const ROTTA = `/webhooks/communications/whatsapp/${SLUG}`;

const SEGRETO_STUDIO = 'segreto-dello-studio';
const VERIFY_STUDIO = 'verify-dello-studio';

async function app() {
  const server = Fastify();
  await server.register(registraRotteWebhooks);
  return server;
}

/** La firma che Meta produce davvero: HMAC-SHA256 sui byte grezzi, in esadecimale. */
function firmaDi(raw: string, segreto: string): string {
  return `sha256=${createHmac('sha256', segreto).update(raw).digest('hex')}`;
}

const tenantWhatsapp = (extra: Record<string, unknown> = {}) => [{
  id: TENANT,
  waAppSecret: SEGRETO_STUDIO,
  waVerifyToken: VERIFY_STUDIO,
  waPhoneId: 'wa-phone',
  ...extra,
}];

beforeEach(() => {
  vi.clearAllMocks();
  process.env.TELEGRAM_WEBHOOK_SECRET = 'tg-master';
  // Deliberatamente presenti e **diversi** da quelli dello studio: il modello precedente li
  // leggeva come credenziali di piattaforma. Se ricomparissero come ripiego, i test qui sotto
  // che si aspettano 401 e 503 passerebbero a 200 e se ne accorgerebbero.
  process.env.WA_APP_SECRET = 'segreto-di-piattaforma';
  process.env.WA_VERIFY_TOKEN = 'verify-di-piattaforma';
  tenantFindMany.mockResolvedValue(tenantWhatsapp());
  tenantFindUnique.mockResolvedValue({ id: TENANT, tgBotToken: '12345:token-lungo-valido' });
  clienteFindMany.mockResolvedValue([{ id: 'cli-1', nome: 'Cliente Uno', cellulare: '+39 335 123 4567', referentiJson: null }]);
  progettoFindMany.mockResolvedValue([{ id: 'proj-1', stato: 'in_progress' }]);
  findComunicazioni.mockResolvedValue([]);
  eventiInbox.clear();
});

describe('webhook WhatsApp per studio', () => {
  const payload = { entry: [{ changes: [{ value: { metadata: { phone_number_id: 'wa-phone' }, messages: [{ id: 'wamid.1', from: '393351234567', type: 'text', text: { body: 'ciao' } }] } }] }] };

  it('uno slug ignoto non risolve nessuno studio e non elabora nulla', async () => {
    tenantFindMany.mockResolvedValue([]);
    const server = await app();
    const res = await server.inject({
      method: 'POST',
      url: ROTTA,
      headers: { 'content-type': 'application/json', 'x-hub-signature-256': firmaDi(JSON.stringify(payload), SEGRETO_STUDIO) },
      payload: JSON.stringify(payload),
    });
    expect(res.statusCode).toBe(404);
    expect(create).not.toHaveBeenCalled();
    await server.close();
  });

  it('uno slug malformato non interroga nemmeno il database', async () => {
    const server = await app();
    // `../` non è nell'alfabeto ammesso: se passasse, comporrebbe un path diverso da quello inteso.
    const res = await server.inject({ method: 'POST', url: '/webhooks/communications/whatsapp/..%2F..%2Fadmin', payload });
    expect(res.statusCode).toBe(404);
    expect(tenantFindMany).not.toHaveBeenCalled();
    await server.close();
  });

  it('firma assente o errata è respinta prima di toccare i dati', async () => {
    const server = await app();
    const assente = await server.inject({ method: 'POST', url: ROTTA, payload });
    const errata = await server.inject({
      method: 'POST', url: ROTTA,
      headers: { 'x-hub-signature-256': `sha256=${'0'.repeat(64)}` }, payload,
    });
    expect([assente.statusCode, errata.statusCode]).toEqual([401, 401]);
    expect(create).not.toHaveBeenCalled();
    await server.close();
  });

  it('la firma si verifica con l\'App Secret dello studio, non con quello di piattaforma', async () => {
    const raw = JSON.stringify(payload);
    const server = await app();

    // Firmato con il segreto di piattaforma: la piattaforma non è lo studio, quindi 401.
    const conPiattaforma = await server.inject({
      method: 'POST', url: ROTTA,
      headers: { 'content-type': 'application/json', 'x-hub-signature-256': firmaDi(raw, 'segreto-di-piattaforma') },
      payload: raw,
    });
    expect(conPiattaforma.statusCode).toBe(401);
    expect(create).not.toHaveBeenCalled();

    // Firmato con il segreto dello studio: è l'unica firma valida.
    const conStudio = await server.inject({
      method: 'POST', url: ROTTA,
      headers: { 'content-type': 'application/json', 'x-hub-signature-256': firmaDi(raw, SEGRETO_STUDIO) },
      payload: raw,
    });
    expect(conStudio.statusCode).toBe(200);
    expect(create).toHaveBeenCalledTimes(1);
    await server.close();
  });

  it('lo studio senza App Secret non può ricevere messaggi (fail-closed)', async () => {
    tenantFindMany.mockResolvedValue(tenantWhatsapp({ waAppSecret: null }));
    const raw = JSON.stringify(payload);
    const server = await app();
    const res = await server.inject({
      method: 'POST', url: ROTTA,
      headers: { 'content-type': 'application/json', 'x-hub-signature-256': firmaDi(raw, SEGRETO_STUDIO) },
      payload: raw,
    });
    expect(res.statusCode).toBe(503);
    expect(create).not.toHaveBeenCalled();
    await server.close();
  });

  it('un messaggio per un numero diverso da quello dichiarato non entra nel fascicolo', async () => {
    tenantFindMany.mockResolvedValue(tenantWhatsapp({ waPhoneId: 'altro-numero' }));
    const raw = JSON.stringify(payload);
    const server = await app();
    const res = await server.inject({
      method: 'POST', url: ROTTA,
      headers: { 'content-type': 'application/json', 'x-hub-signature-256': firmaDi(raw, SEGRETO_STUDIO) },
      payload: raw,
    });
    expect(res.statusCode).toBe(409);
    expect(create).not.toHaveBeenCalled();
    await server.close();
  });

  it('non persiste sender ambiguo e ignora replay con claim atomico', async () => {
    const raw = JSON.stringify(payload);
    const firma = firmaDi(raw, SEGRETO_STUDIO);
    const server = await app();
    clienteFindMany.mockResolvedValueOnce([
      { id: 'cli-1', nome: 'Uno', cellulare: '+393351234567', referentiJson: null },
      { id: 'cli-2', nome: 'Due', cellulare: '+393351234567', referentiJson: null },
    ]);
    await server.inject({ method: 'POST', url: ROTTA, headers: { 'content-type': 'application/json', 'x-hub-signature-256': firma }, payload: raw });
    expect(create).not.toHaveBeenCalled();

    const [prima, seconda] = await Promise.all([
      server.inject({ method: 'POST', url: ROTTA, headers: { 'content-type': 'application/json', 'x-hub-signature-256': firma }, payload: raw }),
      server.inject({ method: 'POST', url: ROTTA, headers: { 'content-type': 'application/json', 'x-hub-signature-256': firma }, payload: raw }),
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
    const firma = firmaDi(raw, SEGRETO_STUDIO);
    findComunicazioni.mockResolvedValue([{ id: 'com-out-1' }]);
    const server = await app();

    const richiesta = () => server.inject({
      method: 'POST',
      url: ROTTA,
      headers: { 'content-type': 'application/json', 'x-hub-signature-256': firma },
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

describe('handshake WhatsApp per studio', () => {
  const query = (token?: string) => ({
    method: 'GET' as const,
    url: `${ROTTA}?hub.mode=subscribe&hub.challenge=1234${token === undefined ? '' : `&hub.verify_token=${encodeURIComponent(token)}`}`,
  });

  it('risponde con la challenge solo al Verify Token dello studio', async () => {
    const server = await app();
    const giusto = await server.inject(query(VERIFY_STUDIO));
    expect(giusto.statusCode).toBe(200);
    expect(giusto.body).toBe('1234');
    await server.close();
  });

  it('rifiuta il token di piattaforma e un token qualsiasi', async () => {
    const server = await app();
    const piattaforma = await server.inject(query('verify-di-piattaforma'));
    const inventato = await server.inject(query('token-a-caso'));
    expect([piattaforma.statusCode, inventato.statusCode]).toEqual([403, 403]);
    await server.close();
  });

  it('uno studio senza Verify Token non è sottoscrivibile da nessuno', async () => {
    tenantFindMany.mockResolvedValue(tenantWhatsapp({ waVerifyToken: null }));
    const server = await app();
    const res = await server.inject(query('qualsiasi'));
    expect(res.statusCode).toBe(503);
    await server.close();
  });

  it('uno slug ignoto risponde 404 prima di guardare il token', async () => {
    tenantFindMany.mockResolvedValue([]);
    const server = await app();
    const res = await server.inject(query(VERIFY_STUDIO));
    expect(res.statusCode).toBe(404);
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
