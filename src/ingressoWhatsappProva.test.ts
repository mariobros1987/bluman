/**
 * §35 — la prova del canale WhatsApp: la metà in uscita e quella in ingresso, dette insieme.
 *
 * Il pulsante «Prova» di Impostazioni → Canali interroga Graph sul Phone Number ID e, se Graph
 * risponde, annunciava «WhatsApp attivo». Ma Graph conferma solo la metà **in uscita**: che il
 * token valga e che il numero esista. L'ingresso — i messaggi che i clienti scrivono allo studio
 * — dipende da App Secret, Verify Token e Callback URL, che Graph non conosce. Per mesi quella
 * riga verde ha fatto credere che i messaggi arrivassero: nel fascicolo non ne è mai entrato uno.
 *
 * Questi test presidiano le tre cose che la prova deve dire, e che prima taceva:
 *   1. se l'ingresso è configurato, e **a quale numero** è limitato;
 *   2. che senza Phone Number ID la guardia sul numero è spenta — l'ingresso accetta i messaggi
 *      di qualunque numero dell'app (`webhooks.ts`, il confronto su `tenant.waPhoneId`);
 *   3. che un rifiuto di Graph sull'uscita non faccia credere che sia rotto tutto il canale:
 *      lo stato dell'ingresso si dice anche quando la prova fallisce.
 *
 * Le credenziali nel corpo servono a provarle prima di salvarle, quindi la prova può riguardare
 * un numero diverso da quello in colonna: fino al salvataggio le due metà guardano due numeri
 * diversi, e va detto anche quello.
 */
import Fastify from 'fastify';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const TENANT = '00000000-0000-0000-0000-000000000001';

/** La riga Tenant che il finto database restituisce, riscritta da ogni test. */
const finto = { tenant: null as any };

vi.mock('./util/prismaClient.js', async importOriginal => {
  const reale = await importOriginal<typeof import('./util/prismaClient.js')>();
  const prisma: any = {
    tenant: {
      findUnique: async () => finto.tenant,
      findFirst: async () => finto.tenant,
    },
    auditLog: { create: async () => ({}) },
    user: { findUnique: async () => null, findFirst: async () => null, findMany: async () => [] },
  };
  return { ...reale, prisma, prismaAmministrativo: () => prisma };
});

const { registraRotteTenant } = await import('./routes/tenant.js');

/** Il finto Graph: la risposta la decide il test. */
const graph = { status: 200, body: {} as any, urlChiamato: '' };
const fetchOriginale = globalThis.fetch;

beforeEach(() => {
  finto.tenant = null;
  graph.status = 200;
  graph.body = { display_phone_number: '+39 000 000 0000', verified_name: 'Studio di Prova', quality_rating: 'GREEN' };
  graph.urlChiamato = '';
  globalThis.fetch = (async (url: any) => {
    graph.urlChiamato = String(url);
    return { ok: graph.status < 400, status: graph.status, json: async () => graph.body } as any;
  }) as any;
});

afterEach(() => {
  globalThis.fetch = fetchOriginale;
});

async function server() {
  const s = Fastify();
  s.addHook('onRequest', async req => {
    req.tenantId = TENANT;
    req.ruolo = 'advisor';
    req.userId = 'usr-advisor';
  });
  await registraRotteTenant(s);
  return s;
}

/** Lo studio con l'ingresso completo: App Secret, Verify Token e Callback URL ci sono. */
const INGRESSO_CONFIGURATO = {
  id: TENANT,
  ragioneSociale: 'Studio di Prova',
  waAppId: '100000000000000',
  waAppSecret: 'segreto-di-prova',
  waVerifyToken: 'verifica-di-prova',
  waWebhookSlug: 'slug-di-prova',
  waPhoneId: '200000000000000',
  waAccessToken: 'token-di-prova',
};

async function prova(payload: Record<string, unknown>) {
  const s = await server();
  const res = await s.inject({ method: 'POST', url: '/tenant/test-channel', payload: { channel: 'whatsapp', ...payload } });
  await s.close();
  return res;
}

describe('la prova WhatsApp dice anche com\'è messo l\'ingresso', () => {
  it('con il Phone Number ID salvato, l\'ingresso è limitato a quel numero', async () => {
    finto.tenant = { ...INGRESSO_CONFIGURATO };

    const res = await prova({});
    const body = res.json();

    expect(res.statusCode).toBe(200);
    expect(body.success).toBe(true);
    expect(body.message).toMatch(/Invio attivo/);
    expect(body.message).toMatch(/Ingresso \(messaggi dai clienti\): configurato/);
    expect(body.message).toContain(INGRESSO_CONFIGURATO.waPhoneId);
  });

  it('senza Phone Number ID salvato avverte che la guardia sul numero è spenta', async () => {
    // Non è un blocco — l'ingresso funziona lo stesso — ma senza quel campo in colonna
    // `webhooks.ts` non confronta niente, e i messaggi di qualunque numero dell'app finiscono
    // su questo studio. Il caso è reale: l'operatore sta provando le credenziali appena
    // incollate nel modulo, e in colonna non c'è ancora nessun numero.
    finto.tenant = { ...INGRESSO_CONFIGURATO, waPhoneId: '', waAccessToken: '' };

    const body = (await prova({ waPhoneId: '200000000000000', waAccessToken: 'token-di-prova' })).json();

    expect(body.success).toBe(true);
    expect(body.message).toMatch(/guardia sul numero è spenta/i);
  });

  it('un ingresso non configurato nomina i pezzi che mancano', async () => {
    finto.tenant = { ...INGRESSO_CONFIGURATO, waVerifyToken: '', waWebhookSlug: '' };

    const body = (await prova({})).json();

    expect(body.success).toBe(true);
    expect(body.message).toMatch(/Verify Token/);
    expect(body.message).toMatch(/Callback URL/);
  });

  it('se Graph rifiuta l\'uscita, lo stato dell\'ingresso si dice lo stesso', async () => {
    // Prima qui la risposta era il solo errore di Meta: l'operatore non poteva sapere se a
    // mancare fosse anche l'altra metà del canale, e il pulsante diventava un vicolo cieco.
    graph.status = 401;
    graph.body = { error: { message: 'Invalid OAuth access token' } };
    finto.tenant = { ...INGRESSO_CONFIGURATO };

    const res = await prova({});
    const body = res.json();

    expect(res.statusCode).toBe(400);
    expect(body.success).toBe(false);
    expect(body.message).toMatch(/Invalid OAuth access token/);
    expect(body.message).toMatch(/Ingresso \(messaggi dai clienti\): configurato/);
  });

  it('senza credenziali di uscita, la risposta non tace sull\'ingresso', async () => {
    finto.tenant = { id: TENANT, waAppSecret: 's', waVerifyToken: 'v', waWebhookSlug: 'slug' };

    const body = (await prova({})).json();

    expect(body.success).toBe(false);
    expect(body.message).toMatch(/non impostati/);
    expect(body.message).toMatch(/Ingresso \(messaggi dai clienti\)/);
  });

  it('avverte se la prova ha usato un numero diverso da quello salvato', async () => {
    finto.tenant = { ...INGRESSO_CONFIGURATO };

    const body = (await prova({ waPhoneId: '999999999999999', waAccessToken: 'token-di-prova' })).json();

    expect(body.success).toBe(true);
    expect(body.message).toMatch(/la prova ha usato il Phone Number ID 999999999999999/);
    expect(body.message).toContain(INGRESSO_CONFIGURATO.waPhoneId);
  });

  it('quando i due numeri coincidono non aggiunge nessun avviso', async () => {
    finto.tenant = { ...INGRESSO_CONFIGURATO };

    const body = (await prova({ waPhoneId: INGRESSO_CONFIGURATO.waPhoneId, waAccessToken: 'token-di-prova' })).json();

    expect(body.message).not.toMatch(/Attenzione/);
  });
});
