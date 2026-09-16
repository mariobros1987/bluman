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

// Il parametro è dichiarato anche se l'implementazione non lo usa: senza, il tipo della chiamata
// registrata è una tupla vuota e `calls[0][0]` non compila — cioè proprio l'argomento che questi
// test devono ispezionare per dire in quale pratica è finito il messaggio.
const create = vi.fn(async (_args: any) => ({ id: 'com-1' }));
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
// La pratica del link: `findFirst` è ciò che `collegaChatAProgetto` legge prima di scrivere il
// collegamento, e `findMany` resta la lettura dell'euristica di ripiego.
const progettoFindFirst = vi.fn<any>(async () => null);
// Il collegamento chat → pratica: `findUnique` è la lettura che la rotta fa a ogni messaggio,
// `upsert` la scrittura del `/start`.
const collegamentoFindUnique = vi.fn<any>(async () => null);
const collegamentoUpsert = vi.fn<any>(async () => ({}));
// Il bot che risponde al cliente. Mockato perché la risposta a un `/start` è una chiamata HTTP
// verso api.telegram.org: senza il finto, i test qui sotto contatterebbero Telegram per davvero.
const inviaTestoTelegram = vi.fn<any>(async () => ({ ok: true }));

const prismaFinto: any = {
  tenant: { findMany: tenantFindMany, findUnique: tenantFindUnique },
  cliente: { findMany: clienteFindMany },
  progetto: { findMany: progettoFindMany, findFirst: progettoFindFirst },
  collegamentoChatProgetto: { findUnique: collegamentoFindUnique, upsert: collegamentoUpsert },
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
vi.mock('./services/telegramService.js', () => ({ inviaTestoTelegram }));

const { registraRotteWebhooks } = await import('./routes/webhooks.js');
const { creaSegretoTelegram, creaPayloadCollegamento } = await import('./util/webhookSecurity.js');
const { notificaStudio } = await import('./services/notificheService.js');
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
  progettoFindFirst.mockResolvedValue(null);
  collegamentoFindUnique.mockResolvedValue(null);
  collegamentoUpsert.mockResolvedValue({});
  inviaTestoTelegram.mockResolvedValue({ ok: true });
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

/**
 * Il collegamento esplicito chat → pratica (`t.me/<Bot>?start=<payload>`).
 *
 * Il caso che questi test presidiano è quello che l'euristica **non** sa risolvere: un cliente con
 * due pratiche aperte. Prima del link, il suo messaggio non poteva entrare in nessun fascicolo e
 * diventava un avviso — corretto, ma inutile per chi aveva scritto. Qui si verifica che il
 * collegamento scritto dal cliente abbia la precedenza sulla deduzione, che un payload manomesso
 * non colleghi niente, e che una chat collegata a una pratica chiusa lo dica invece di archiviare
 * in silenzio.
 */
describe('collegamento chat → pratica (link Telegram)', () => {
  const ROTTA_TG_LOCALE = '/webhooks/communications/telegram';
  const CHAT = '99';
  /** La pratica del link: un UUID vero, perché il payload lo pretende in forma compatta. */
  const PROGETTO = '00000000-0000-4000-8000-0000000000a1';
  const NOME_PROGETTO = 'Emirati Arabi 123';

  const secret = () => creaSegretoTelegram(TENANT, '12345:token-lungo-valido', 'tg-master');
  const invia = (server: any, updateId: number, testo: string) => server.inject({
    method: 'POST',
    url: ROTTA_TG_LOCALE,
    headers: { 'x-telegram-bot-api-secret-token': secret() },
    payload: { update_id: updateId, message: { chat: { id: CHAT }, text: testo } },
  });

  /** Lo stato in cui la chat ha già un collegamento verso la pratica indicata. */
  const collegaLaChat = (stato: string) => {
    collegamentoFindUnique.mockResolvedValue({
      id: 'coll-1',
      cliente: { id: 'cli-1', nome: 'Mario Emirati' },
      progetto: { id: PROGETTO, nome: NOME_PROGETTO, stato },
    });
  };

  it('un /start con payload valido collega la chat e conferma, senza archiviare il testo', async () => {
    progettoFindFirst.mockResolvedValue({
      id: PROGETTO, nome: NOME_PROGETTO, stato: 'pre_project', cliente: { id: 'cli-1', nome: 'Mario Emirati' },
    });
    const server = await app();
    const res = await invia(server, 500, `/start ${creaPayloadCollegamento(TENANT, PROGETTO, 'tg-master')}`);

    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ ok: true, avvio: 'collegato' });

    // Il collegamento si scrive sulla chiave unica della chat: è quella che rende lo spostamento
    // possibile e impedisce che una chat scriva in due pratiche.
    expect(collegamentoUpsert).toHaveBeenCalledWith(expect.objectContaining({
      where: { tenantId_canale_chatId: { tenantId: TENANT, canale: 'telegram', chatId: CHAT } },
      create: expect.objectContaining({ tenantId: TENANT, canale: 'telegram', chatId: CHAT, progettoId: PROGETTO }),
    }));

    // `/start ...` non è un messaggio del cliente: non deve finire nel fascicolo come se lo fosse.
    expect(create).not.toHaveBeenCalled();

    // Il cliente riceve la conferma, e la conferma nomina la pratica.
    expect(inviaTestoTelegram).toHaveBeenCalledTimes(1);
    expect(String(inviaTestoTelegram.mock.calls[0]![2])).toContain(NOME_PROGETTO);

    // Lo studio sa che il link ha funzionato.
    expect(notificaStudio).toHaveBeenCalledWith(TENANT, expect.objectContaining({
      tipoEvento: 'chat_collegata_progetto',
      link: `/projects/${PROGETTO}`,
    }));
    await server.close();
  });

  it('un /start con payload manomesso non collega niente e non archivia niente', async () => {
    const server = await app();
    // Il primo carattere del MAC si cambia in modo deterministico: sostituire l'ultimo con una
    // lettera fissa lascerebbe il payload intatto una volta su sessantaquattro.
    const valido = creaPayloadCollegamento(TENANT, PROGETTO, 'tg-master');
    // Il payload è sempre `<uuid-compatto>_<mac>`: due parti, garantite da `creaPayloadCollegamento`.
    const [idCompatto, mac] = valido.split('_') as [string, string];
    const manomesso = `${idCompatto}_${mac[0] === 'A' ? 'B' : 'A'}${mac.slice(1)}`;
    const res = await invia(server, 501, `/start ${manomesso}`);

    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ ok: true, avvio: 'payload_non_valido' });
    expect(collegamentoUpsert).not.toHaveBeenCalled();
    expect(create).not.toHaveBeenCalled();
    // Al cliente si risponde spiegando cosa fare: senza, avrebbe toccato un link e non avrebbe
    // visto succedere nulla.
    expect(inviaTestoTelegram).toHaveBeenCalledTimes(1);
    await server.close();
  });

  it('una chat collegata instrada anche quando il cliente ha due pratiche aperte', async () => {
    collegaLaChat('in_progress');
    // Le due condizioni che oggi fanno fallire l'euristica: due pratiche aperte per quel cliente.
    clienteFindMany.mockResolvedValue([{ id: 'cli-1', nome: 'Mario Emirati' }]);
    progettoFindMany.mockResolvedValue([
      { id: PROGETTO, nome: NOME_PROGETTO, stato: 'in_progress' },
      { id: '00000000-0000-4000-8000-0000000000a2', nome: 'Ciaociao', stato: 'in_progress' },
    ]);
    const server = await app();
    const res = await invia(server, 502, 'Buongiorno, novità?');

    expect(res.statusCode).toBe(200);
    expect(create).toHaveBeenCalledTimes(1);
    // La prova del fix: il messaggio è finito nella pratica del **collegamento**, non in quella
    // che l'euristica avrebbe dovuto indovinare (e che, con due aperte, non avrebbe scelto).
    expect(create.mock.calls[0]![0].data.progettoId).toBe(PROGETTO);
    // E l'euristica non è stata nemmeno interrogata: chi ha detto dove scrivere non si indovina.
    expect(clienteFindMany).not.toHaveBeenCalled();
    await server.close();
  });

  it('una chat collegata a una pratica archiviata avvisa lo studio invece di archiviare', async () => {
    collegaLaChat('archived');
    const server = await app();
    const res = await invia(server, 503, 'Ci siete?');

    expect(res.statusCode).toBe(202);
    expect(res.json()).toEqual({ ok: true, ignored: 'progetto_chiuso' });
    expect(create).not.toHaveBeenCalled();
    expect(notificaStudio).toHaveBeenCalledWith(TENANT, expect.objectContaining({
      tipoEvento: 'messaggio_non_instradabile',
    }));
    // Il motivo dice *quale* pratica è chiusa: senza il nome, l'operatore non saprebbe quale
    // riaprire fra le pratiche di quel cliente.
    const corpo = String(vi.mocked(notificaStudio).mock.calls[0]![1].corpo);
    expect(corpo).toContain(NOME_PROGETTO);
    expect(corpo).toContain('archiviata');
    await server.close();
  });

  it('senza payload il bot spiega come collegarsi, e non archivia il /start', async () => {
    const server = await app();
    const res = await invia(server, 504, '/start');

    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ ok: true, avvio: 'senza_payload' });
    expect(create).not.toHaveBeenCalled();
    expect(inviaTestoTelegram).toHaveBeenCalledTimes(1);
    await server.close();
  });

  it('un link di un altro studio non collega nulla, anche con lo stesso master secret', async () => {
    const ALTRO = '00000000-0000-4000-8000-0000000000ff';
    const server = await app();
    // Firmato per un altro studio: il MAC copre il tenant, quindi non è spendibile qui.
    const res = await invia(server, 505, `/start ${creaPayloadCollegamento(ALTRO, PROGETTO, 'tg-master')}`);

    expect(res.json()).toEqual({ ok: true, avvio: 'payload_non_valido' });
    expect(collegamentoUpsert).not.toHaveBeenCalled();
    expect(create).not.toHaveBeenCalled();
    await server.close();
  });

  it('un messaggio da una chat non collegata segue ancora l\'euristica di sempre', async () => {
    const server = await app();
    const res = await invia(server, 506, 'Salve');

    expect(res.statusCode).toBe(200);
    expect(create).toHaveBeenCalledTimes(1);
    expect(create.mock.calls[0]![0].data.canale).toBe('telegram');
    expect(clienteFindMany).toHaveBeenCalled();
    await server.close();
  });
});
