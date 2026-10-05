/**
 * La ricevuta di consegna WhatsApp: il giro che va dall'invio alla spunta.
 *
 * Perché esiste questo file. Il 17/09/2026 il giro era rotto in tre punti indipendenti, e nessuno
 * dei tre si vedeva da fuori:
 *
 *   1. **Il `wamid` non veniva conservato.** `inviaTestoWhatsapp` restituiva `{ ok: true }` e
 *      buttava via `messages[0].id` della risposta di Meta. Senza quella chiave, la ricevuta che
 *      arriva dopo non ha niente da cercare.
 *   2. **La ricerca non poteva corrispondere.** Il webhook di stato cercava l'uguaglianza esatta
 *      con `whatsapp:<wamid>`, ma quella forma ce l'hanno le righe in *entrata*; le sole che
 *      ricevono uno stato sono quelle in *uscita*, che portano il blob JSON. Prisma confronta per
 *      uguaglianza: non trovava mai nulla.
 *   3. **Lo stato finiva nella colonna sbagliata.** Si scriveva in `allegati_json`, che è la
 *      colonna degli allegati del messaggio: una ricevuta cancellava gli allegati.
 *
 * L'effetto complessivo era che su WhatsApp `consegnato` e `letto` non sono mai stati veri. Il ✓✓
 * blu che il fascicolo disegnava era dedotto, non ricevuto — ed è la stessa bugia che questo giro
 * di correzioni sta togliendo da tutte le altre strade.
 *
 * L'ultimo test presidia la cosa che rende il giro sicuro: le ricevute di Meta non arrivano
 * garantite in ordine, e una che arriva in ritardo non deve disdire una consegna già avvenuta.
 */
import { createHmac } from 'node:crypto';
import Fastify from 'fastify';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const TENANT = '00000000-0000-4000-8000-000000000001';
const SLUG = 'b'.repeat(32);
const ROTTA = `/webhooks/communications/whatsapp/${SLUG}`;
const SEGRETO_STUDIO = 'segreto-dello-studio';

/** La firma che Meta produce davvero: HMAC-SHA256 sui byte grezzi, in esadecimale. */
function firmaDi(raw: string, segreto: string): string {
  return `sha256=${createHmac('sha256', segreto).update(raw).digest('hex')}`;
}

// ── il finto database ───────────────────────────────────────────────────────────

const update = vi.fn(async (_args: any): Promise<any> => ({}));
const findFirst = vi.fn(async (_args: { where?: any; select?: any }): Promise<any> => null);
const inboxCreate = vi.fn(async ({ data }: any) => ({ id: 'inbox-1', ...data }));

/**
 * Le righe che il finto database contiene, e un `findFirst` che applica **davvero** il `where`.
 *
 * Un mock che restituisce la riga a prescindere da come è stata cercata non prova niente: copre il
 * difetto invece di riprodurlo. Se la ricerca torna all'uguaglianza esatta — che è il difetto
 * storico, perché la colonna contiene un blob JSON e non il solo `wamid` — qui non si trova nulla,
 * esattamente come non si trovava nulla in produzione.
 */
let righe: any[] = [];

findFirst.mockImplementation(async ({ where }: any) => {
  const cerca = where?.externalId;
  return righe.find((r) => (
    (where?.tenantId === undefined || r.tenantId === where.tenantId)
    && (where?.canale === undefined || r.canale === where.canale)
    && (where?.direzione === undefined || r.direzione === where.direzione)
    && (cerca === undefined
      || (cerca.contains !== undefined ? String(r.externalId ?? '').includes(cerca.contains)
        : cerca.equals !== undefined ? r.externalId === cerca.equals
          : true))
  )) ?? null;
});

/** Una riga in uscita come l'ha lasciata l'invio: lo stato **e** il `wamid` accanto. */
function rigaInUscita(meta: Record<string, unknown>, extra: Record<string, unknown> = {}) {
  const riga = {
    id: 'com-out-1',
    tenantId: TENANT,
    canale: 'whatsapp',
    direzione: 'uscita',
    externalId: meta === null ? null : JSON.stringify(meta),
    ...extra,
  };
  righe = [riga];
  return riga;
}

const prismaFinto: any = {
  tenant: {
    findMany: vi.fn(async () => [{
      id: TENANT,
      waAppSecret: SEGRETO_STUDIO,
      waVerifyToken: 'verify-dello-studio',
      waPhoneId: 'wa-phone',
    }]),
  },
  comunicazioneProgetto: { findFirst, findMany: vi.fn(async () => []), update },
  // I due modelli dell'abbinamento micro-voce: questo file prova la ricevuta di consegna e non li
  // attraversa, ma `registraRotteWebhooks` monta anche il percorso in ingresso — e un `tx` senza
  // questi modelli farebbe esplodere quel percorso con un TypeError che non dice niente.
  comunicazioneMicrovoce: { upsert: vi.fn(async () => ({})) },
  contestoMicrovoceChat: { findUnique: vi.fn(async () => null), update: vi.fn(async () => ({})) },
  webhookInbox: { create: inboxCreate },
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
vi.mock('./services/collegamentoChat.js', () => ({
  progettoChiuso: vi.fn(async () => false),
  risolviFascicoloDaChat: vi.fn(async () => null),
}));
vi.mock('./services/avvioTelegram.js', () => ({
  gestisciAvvio: vi.fn(async () => null),
  leggiRichiestaAvvio: vi.fn(async () => null),
}));

const { registraRotteWebhooks } = await import('./routes/webhooks.js');

async function app() {
  const server = Fastify();
  await server.register(registraRotteWebhooks);
  return server;
}

/** Una ricevuta di stato come la manda Meta. */
function ricevuta(wamid: string, stato: string, extra: Record<string, unknown> = {}) {
  return { entry: [{ changes: [{ value: {
    metadata: { phone_number_id: 'wa-phone' },
    statuses: [{ id: wamid, status: stato, ...extra }],
  } }] }] };
}

async function consegna(stato: string, wamid = 'wamid.XYZ', extra: Record<string, unknown> = {}) {
  const raw = JSON.stringify(ricevuta(wamid, stato, extra));
  const server = await app();
  const res = await server.inject({
    method: 'POST',
    url: ROTTA,
    headers: { 'content-type': 'application/json', 'x-hub-signature-256': firmaDi(raw, SEGRETO_STUDIO) },
    payload: raw,
  });
  await server.close();
  return res;
}

/** L'`external_id` scritto dall'ultima `update`. */
function statoScritto(): any {
  return JSON.parse(update.mock.calls.at(-1)?.[0]?.data?.externalId);
}

/** Il `data` dell'ultima `update`, o `undefined` se non ce n'è stata nessuna. */
function datiScritti(): any {
  return update.mock.calls.at(-1)?.[0]?.data;
}

beforeEach(() => {
  vi.clearAllMocks();
  update.mockResolvedValue({});
  // La riga in uscita come la lascia l'invio: stato **e** il wamid di Meta accanto.
  rigaInUscita({ stato: 'inviato', inviatoAt: '2026-09-17T09:00:00.000Z', providerId: 'wamid.XYZ' });
});

afterEach(() => {
  vi.unstubAllGlobals();
});

// ── lato invio: il wamid si conserva ────────────────────────────────────────────

describe('il wamid che Meta assegna viene conservato', () => {
  const cred = { waPhoneId: '000000000000000', waAccessToken: 'token-di-prova' };

  /** La risposta di Meta a un invio accettato. */
  const accettato = { messages: [{ id: 'wamid.ABC' }] };

  it('la chiamata a Graph riporta l\'id del messaggio accettato', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, status: 200, json: async () => accettato })));
    const { chiamaGraphWhatsapp } = await import('./services/whatsappService.js');

    const esito = await chiamaGraphWhatsapp(cred, { to: '390000000000' });

    expect(esito.ok).toBe(true);
    expect(esito.providerId).toBe('wamid.ABC');
  });

  it('un invio di testo riporta il wamid al chiamante', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, status: 200, json: async () => accettato })));
    const { inviaTestoWhatsapp } = await import('./services/whatsappService.js');

    expect((await inviaTestoWhatsapp(cred, '+390000000000', 'Buongiorno.')).providerId).toBe('wamid.ABC');
  });

  it('una risposta senza `messages` non inventa un id', async () => {
    // Meta può rispondere 200 con un corpo che non contiene l'id. Meglio nessuna chiave che una
    // chiave fabbricata: una chiave falsa farebbe cercare la ricevuta nel posto sbagliato.
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, status: 200, json: async () => ({}) })));
    const { inviaTestoWhatsapp } = await import('./services/whatsappService.js');

    const esito = await inviaTestoWhatsapp(cred, '+390000000000', 'Buongiorno.');
    expect(esito.ok).toBe(true);
    expect(esito.providerId).toBeUndefined();
  });
});

// ── lato ricevuta: la riga si ritrova e lo stato si scrive dove vive ─────────────

describe('la ricevuta ritrova la riga dal wamid dentro il blob', () => {
  it('cerca il wamid dentro `external_id`, non per uguaglianza', async () => {
    // È il difetto numero 2: con l'uguaglianza esatta la riga in uscita non si trovava mai.
    await consegna('delivered');

    const dove = findFirst.mock.calls[0]?.[0]?.where;
    expect(dove.canale).toBe('whatsapp');
    expect(dove.tenantId).toBe(TENANT);
    expect(dove.externalId).toEqual({ contains: 'wamid.XYZ' });
  });

  it('cerca solo fra le righe in uscita', async () => {
    // Una ricevuta riguarda un messaggio che lo studio ha spedito. Le righe in entrata portano la
    // stessa forma di chiave, e aggiornarne una scriverebbe lo stato di consegna di un messaggio
    // che invece è arrivato.
    await consegna('delivered');
    expect(findFirst.mock.calls[0]?.[0]?.where.direzione).toBe('uscita');
  });

  it('`delivered` porta la riga a `consegnato` con la sua data', async () => {
    await consegna('delivered');

    const scritto = statoScritto();
    expect(scritto.stato).toBe('consegnato');
    expect(typeof scritto.consegnatoAt).toBe('string');
    expect(scritto.providerId).toBe('wamid.XYZ');
  });

  it('`read` porta la riga a `letto` con la sua data', async () => {
    await consegna('read');

    const scritto = statoScritto();
    expect(scritto.stato).toBe('letto');
    expect(typeof scritto.lettoAt).toBe('string');
    // La consegna già registrata non si perde passando alla lettura.
    expect(scritto.consegnatoAt).toBeUndefined();
  });

  it('`failed` porta la riga a `non-inviato` con il motivo di Meta', async () => {
    await consegna('failed', 'wamid.XYZ', { errors: [{ code: 131047, title: 'Message failed to send', message: 'Fuori dalla finestra di 24 ore' }] });

    const scritto = statoScritto();
    expect(scritto.stato).toBe('non-inviato');
    expect(scritto.errore).toBe('Fuori dalla finestra di 24 ore');
  });

  it('lo stato si scrive in `external_id`, non in `allegati_json`', async () => {
    // Il difetto numero 3: `allegati_json` è la colonna degli allegati. Scrivendoci lo stato, una
    // ricevuta di consegna cancellava gli allegati del messaggio.
    await consegna('delivered');

    expect(update).toHaveBeenCalled();
    const dati = datiScritti();
    expect(dati.allegatiJson).toBeUndefined();
    expect(typeof dati.externalId).toBe('string');
  });

  it('non perde gli allegati che la riga già aveva', async () => {
    rigaInUscita(
      { stato: 'inviato', providerId: 'wamid.XYZ' },
      { allegatiJson: JSON.stringify([{ nome: 'documento.pdf', url: '/uploads/documento.pdf' }]) },
    );

    await consegna('delivered');

    // La riga si aggiorna con la sola colonna dello stato: `allegati_json` non è toccata.
    expect(update).toHaveBeenCalled();
    expect(Object.keys(datiScritti())).toEqual(['externalId']);
  });

  it('un wamid che non trova nessuna riga non scrive niente', async () => {
    righe = [];

    const res = await consegna('delivered', 'wamid.SCONOSCIUTO');

    expect(res.statusCode).toBe(200);
    expect(update).not.toHaveBeenCalled();
  });

  it('una riga in entrata con lo stesso wamid non viene toccata', async () => {
    // Le righe in entrata portano `whatsapp:<wamid>`: contengono lo stesso wamid, quindi la sola
    // ricerca per contenuto le pescherebbe. Il filtro sul verso è ciò che le risparmia —
    // aggiornarne una scriverebbe lo stato di consegna di un messaggio che invece è arrivato.
    righe = [{
      id: 'com-in-1',
      tenantId: TENANT,
      canale: 'whatsapp',
      direzione: 'entrata',
      externalId: 'whatsapp:wamid.XYZ',
    }];

    await consegna('delivered');

    expect(update).not.toHaveBeenCalled();
  });
});

describe('una ricevuta in ritardo non disdice una consegna avvenuta', () => {
  it('un `sent` dopo un `delivered` non riporta la riga a `inviato`', async () => {
    // Meta non garantisce l'ordine. Senza questo presidio il fascicolo tornerebbe a dire che il
    // messaggio è solo accettato, dopo aver già detto che è arrivato.
    rigaInUscita({ stato: 'consegnato', consegnatoAt: '2026-09-17T10:00:00.000Z', providerId: 'wamid.XYZ' });

    await consegna('sent');

    expect(update).not.toHaveBeenCalled();
  });

  it('un `delivered` dopo un `letto` non toglie la lettura', async () => {
    rigaInUscita({ stato: 'letto', lettoAt: '2026-09-17T11:00:00.000Z', providerId: 'wamid.XYZ' });

    await consegna('delivered');
    expect(update).not.toHaveBeenCalled();
  });

  it('un `failed` si registra anche su una riga già consegnata', async () => {
    // Un guasto è un'informazione nuova comunque: non è una tappa indietro, è un'altra storia.
    rigaInUscita({ stato: 'consegnato', consegnatoAt: '2026-09-17T10:00:00.000Z', providerId: 'wamid.XYZ' });

    await consegna('failed');

    expect(statoScritto().stato).toBe('non-inviato');
  });

  it('una riga scritta da una versione precedente accetta la prima ricevuta', async () => {
    // Prima che `external_id` diventasse un blob JSON, in colonna c'era il solo `wamid`. Quelle
    // righe esistono ancora, e non hanno uno stato dichiarato: la prima ricevuta che arriva le
    // porta avanti invece di essere scartata per «stato già avanti».
    righe = [{
      id: 'com-out-vecchia',
      tenantId: TENANT,
      canale: 'whatsapp',
      direzione: 'uscita',
      externalId: 'wamid.XYZ',
    }];

    await consegna('delivered');

    const scritto = statoScritto();
    expect(scritto.stato).toBe('consegnato');
    // E il wamid che c'era non si butta: è la chiave con cui arriverà la prossima ricevuta.
    expect(scritto.providerId).toBe('wamid.XYZ');
  });
});
