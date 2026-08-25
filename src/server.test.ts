import { describe, it, expect, beforeEach } from 'vitest';
import { buildServer } from './server.js';
import { InMemoryApp } from './adapters/inMemoryApp.js';
import { signJwt } from './util/jwt.js';
import { contestoTenant, type ContestoTenant } from './util/prismaClient.js';
import type { ModuloTemplateConDistinta } from './services/istanziazionePort.js';

const templateAnalisi: ModuloTemplateConDistinta = {
  id: 'M01',
  versione: 1,
  nome: 'Analisi patrimoniale iniziale',
  categoria: 'Analisi',
  prezzoPacchetto: null,
  dipendenzeDa: [],
  righe: [
    {
      id: 'RD01',
      articoloId: 'A_RACCOLTA_DOC',
      articoloVersione: 1,
      articoloNome: 'Raccolta documentazione cliente',
      quantita: 1,
      ordine: 1,
      oreEffettive: 2,
      prezzoEffettivo: 600,
      passaggi: [{ titolo: 'Carica documento identità', tipo: 'documento', chi: 'cliente', ordine: 1, descrizione: null, campiFormJson: null }],
    },
  ],
};

/**
 * §23 — da quando `buildServer` respinge con 401 ogni rotta non pubblica, un `inject`
 * privo di header Authorization riceve 401 invece della risposta applicativa. I test di
 * questo file esercitano il comportamento delle rotte, non l'autenticazione: quindi ogni
 * inject parte come sessione advisor autenticata. I test che l'autenticazione la
 * esercitano davvero (§23, §2bis) passano headers propri, che hanno la precedenza.
 */
const TENANT_TEST = '00000000-0000-0000-0000-000000000001';
const TOKEN_TEST_ADVISOR = signJwt({
  userId: 'usr-test',
  tenantId: TENANT_TEST,
  email: 'test@studio.example',
  ruolo: 'advisor',
});

function nuovoServer() {
  const app = new InMemoryApp();
  app.registraModuloTemplate(templateAnalisi);
  const server = buildServer(app);

  const injectOriginale = server.inject.bind(server);
  (server as any).inject = (opts: any) =>
    injectOriginale({
      ...opts,
      headers: { authorization: `Bearer ${TOKEN_TEST_ADVISOR}`, ...(opts?.headers || {}) },
    });

  return { app, server };
}

describe('server — /health e /moduli', () => {
  it('GET /health risponde ok', async () => {
    const { server } = nuovoServer();
    // In ambiente di test DATABASE_URL punta a un DB irraggiungibile (vitest.setup):
    // l'health check onestamente lo segnala con 503 + stato degradato.
    const res = await server.inject({ method: 'GET', url: '/health' });
    expect(res.statusCode).toBe(503);
    expect(res.json()).toEqual({ stato: 'degradato', db: 'irraggiungibile' });
  });

  it('GET /moduli elenca la libreria', async () => {
    const { server } = nuovoServer();
    const res = await server.inject({ method: 'GET', url: '/moduli' });
    expect(res.statusCode).toBe(200);
    expect(res.json().length).toBeGreaterThanOrEqual(1);
    expect(res.json().some((m: any) => m.nome === 'Analisi patrimoniale iniziale')).toBe(true);
  });
});

describe('server — flusso completo cliente → progetto → preventivo → accettazione', () => {
  it('esegue l\'intero ciclo end-to-end tramite HTTP', async () => {
    const { server } = nuovoServer();

    const cliente = await server.inject({ method: 'POST', url: '/clienti', payload: { nome: 'Marco Ricci', tipo: 'individual' } });
    expect(cliente.statusCode).toBe(201);
    const clienteId = cliente.json().id;

    const progetto = await server.inject({ method: 'POST', url: '/progetti', payload: { clienteId, nome: 'Struttura Holding' } });
    expect(progetto.statusCode).toBe(201);
    expect(progetto.json().stato).toBe('pre_project');
    const progettoId = progetto.json().id;

    const preventivo = await server.inject({
      method: 'POST',
      url: '/preventivi',
      payload: { clienteId, progettoId, righe: [{ moduloTemplateId: 'M01', moduloTemplateVersione: 1 }] },
    });
    expect(preventivo.statusCode).toBe(201);
    expect(preventivo.json().valoreTotale).toBe(600);
    expect(preventivo.json().stato).toBe('bozza');
    const preventivoId = preventivo.json().id;

    const accettazione = await server.inject({ method: 'POST', url: `/preventivi/${preventivoId}/accetta` });
    expect(accettazione.statusCode).toBe(200);
    expect(accettazione.json().moduliProgettoIds).toHaveLength(1);

    // Il progetto deve ora risultare in_progress, con il modulo e la sua micro-voce istanziati
    const progettoFinale = await server.inject({ method: 'GET', url: `/progetti/${progettoId}` });
    expect(progettoFinale.json().stato).toBe('in_progress');
    expect(progettoFinale.json().moduli).toHaveLength(1);
    expect(progettoFinale.json().moduli[0].microvoci).toHaveLength(1);
    expect(progettoFinale.json().moduli[0].microvoci[0].stato).toBe('pending');
  });

  it('404 con messaggio chiaro su cliente inesistente, non un 500 generico', async () => {
    const { server } = nuovoServer();
    const res = await server.inject({ method: 'GET', url: '/clienti/non-esiste' });
    expect(res.statusCode).toBe(404);
    expect(res.json().errore).toMatch(/non trovato/);
  });

  it('400 se manca un campo obbligatorio nella creazione cliente', async () => {
    const { server } = nuovoServer();
    const res = await server.inject({ method: 'POST', url: '/clienti', payload: { nome: 'Solo nome' } });
    expect(res.statusCode).toBe(400);
  });

  it('409 se si tenta di accettare due volte lo stesso preventivo', async () => {
    const { server } = nuovoServer();
    const cliente = await server.inject({ method: 'POST', url: '/clienti', payload: { nome: 'Test', tipo: 'individual' } });
    const progetto = await server.inject({ method: 'POST', url: '/progetti', payload: { clienteId: cliente.json().id, nome: 'P' } });
    const preventivo = await server.inject({
      method: 'POST',
      url: '/preventivi',
      payload: { clienteId: cliente.json().id, progettoId: progetto.json().id, righe: [{ moduloTemplateId: 'M01', moduloTemplateVersione: 1 }] },
    });
    const preventivoId = preventivo.json().id;

    const prima = await server.inject({ method: 'POST', url: `/preventivi/${preventivoId}/accetta` });
    expect(prima.statusCode).toBe(200);

    const seconda = await server.inject({ method: 'POST', url: `/preventivi/${preventivoId}/accetta` });
    expect(seconda.statusCode).toBe(409);
  });

  it('404 con messaggio chiaro se un modulo del preventivo non esiste in libreria', async () => {
    const { server } = nuovoServer();
    const cliente = await server.inject({ method: 'POST', url: '/clienti', payload: { nome: 'Test', tipo: 'individual' } });
    const progetto = await server.inject({ method: 'POST', url: '/progetti', payload: { clienteId: cliente.json().id, nome: 'P' } });
    const res = await server.inject({
      method: 'POST',
      url: '/preventivi',
      payload: { clienteId: cliente.json().id, progettoId: progetto.json().id, righe: [{ moduloTemplateId: 'INESISTENTE', moduloTemplateVersione: 1 }] },
    });
    expect(res.statusCode).toBe(404);
  });
});

describe('server — elenchi (per il frontend)', () => {
  it('GET /clienti elenca i clienti creati', async () => {
    const { server } = nuovoServer();
    await server.inject({ method: 'POST', url: '/clienti', payload: { nome: 'Cliente A', tipo: 'individual' } });
    await server.inject({ method: 'POST', url: '/clienti', payload: { nome: 'Cliente B', tipo: 'company' } });
    const res = await server.inject({ method: 'GET', url: '/clienti' });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toHaveLength(2);
  });

  it('GET /progetti elenca i progetti creati', async () => {
    const { server } = nuovoServer();
    const cliente = await server.inject({ method: 'POST', url: '/clienti', payload: { nome: 'Test', tipo: 'individual' } });
    await server.inject({ method: 'POST', url: '/progetti', payload: { clienteId: cliente.json().id, nome: 'Progetto 1' } });
    const res = await server.inject({ method: 'GET', url: '/progetti' });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toHaveLength(1);
    expect(res.json()[0].stato).toBe('pre_project');
  });
});

describe('server — §17 esecuzione, tramite HTTP end-to-end', () => {
  async function progettoAvviato(server: ReturnType<typeof nuovoServer>['server']) {
    const cliente = await server.inject({ method: 'POST', url: '/clienti', payload: { nome: 'Marco Ricci', tipo: 'individual' } });
    const progetto = await server.inject({ method: 'POST', url: '/progetti', payload: { clienteId: cliente.json().id, nome: 'P' } });
    const preventivo = await server.inject({
      method: 'POST',
      url: '/preventivi',
      payload: { clienteId: cliente.json().id, progettoId: progetto.json().id, righe: [{ moduloTemplateId: 'M01', moduloTemplateVersione: 1 }] },
    });
    await server.inject({ method: 'POST', url: `/preventivi/${preventivo.json().id}/accetta` });
    const progettoFinale = await server.inject({ method: 'GET', url: `/progetti/${progetto.json().id}` });
    const mv = progettoFinale.json().moduli[0].microvoci[0];
    return { progettoId: progetto.json().id, microvoceId: mv.id as string };
  }

  it('consuntiva ore su una micro-voce via HTTP', async () => {
    const { server } = nuovoServer();
    const { microvoceId } = await progettoAvviato(server);

    const res = await server.inject({ method: 'POST', url: `/microvoci/${microvoceId}/consuntiva`, payload: { ore: 1 } });
    expect(res.statusCode).toBe(200);
    expect(res.json().oreConsuntivate).toBe(1);
  });

  it('GET /microvoci/:id legge lo stato aggiornato dopo un\'azione (usato dal frontend per il refresh)', async () => {
    const { server } = nuovoServer();
    const { microvoceId } = await progettoAvviato(server);
    await server.inject({ method: 'POST', url: `/microvoci/${microvoceId}/consuntiva`, payload: { ore: 1.5 } });
    const res = await server.inject({ method: 'GET', url: `/microvoci/${microvoceId}` });
    expect(res.statusCode).toBe(200);
    expect(res.json().oreConsuntivate).toBe(1.5);
  });

  it('400 se manca il campo ore', async () => {
    const { server } = nuovoServer();
    const { microvoceId } = await progettoAvviato(server);
    const res = await server.inject({ method: 'POST', url: `/microvoci/${microvoceId}/consuntiva`, payload: {} });
    expect(res.statusCode).toBe(400);
  });

  it('marca-ritardo con causaNota valida, poi risolvi-ritardo', async () => {
    const { server } = nuovoServer();
    const { microvoceId } = await progettoAvviato(server);

    const ritardo = await server.inject({
      method: 'POST',
      url: `/microvoci/${microvoceId}/ritardo`,
      payload: { stato: 'blocked', causaNota: 'KYC respinto dalla banca' },
    });
    expect(ritardo.statusCode).toBe(200);
    expect(ritardo.json().stato).toBe('blocked');

    const risolto = await server.inject({ method: 'POST', url: `/microvoci/${microvoceId}/risolvi-ritardo` });
    expect(risolto.statusCode).toBe(200);
    expect(risolto.json().stato).toBe('active');
  });

  it('409 se manca causaNota nel body del ritardo', async () => {
    const { server } = nuovoServer();
    const { microvoceId } = await progettoAvviato(server);
    const res = await server.inject({ method: 'POST', url: `/microvoci/${microvoceId}/ritardo`, payload: { stato: 'blocked' } });
    expect(res.statusCode).toBe(400); // validazione a livello route, prima ancora del motore
  });

  it('409 se si tenta di completare una micro-voce con passaggi ancora aperti (§17.1)', async () => {
    const { server } = nuovoServer();
    const { microvoceId } = await progettoAvviato(server);
    const res = await server.inject({ method: 'PATCH', url: `/microvoci/${microvoceId}/completa` });
    expect(res.statusCode).toBe(409);
    expect(res.json().errore).toMatch(/passaggio/);
  });

  it('flusso completo: completare tutti i passaggi sblocca il completamento della micro-voce', async () => {
    const { server } = nuovoServer();
    const { microvoceId } = await progettoAvviato(server);

    const passaggi = await server.inject({ method: 'GET', url: `/microvoci/${microvoceId}/passaggi` });
    expect(passaggi.json()).toHaveLength(1); // solo RD01 nel template di test ha un passaggio

    const passaggioId = passaggi.json()[0].id;
    const completa = await server.inject({ method: 'POST', url: `/passaggi/${passaggioId}/completa-documento` });
    expect(completa.statusCode).toBe(200);

    const ok = await server.inject({ method: 'PATCH', url: `/microvoci/${microvoceId}/completa` });
    expect(ok.statusCode).toBe(200);
    expect(ok.json().stato).toBe('done');
  });
});

describe('server — §23 autenticazione: nessuna credenziale hardcoded', () => {
  // Queste credenziali erano cablate in server.ts fino alla Fase 0. Nessuna deve più
  // permettere l'accesso. Il test esiste perché la regressione si è già verificata una
  // volta: `verifyPassword(...) || password === 'password123'` apriva ogni account.
  const CREDENZIALI_RIMOSSE = [
    { email: 'joe@bluecode.advisory', password: 'password123' },
    { email: 'admin@bluecode.advisory', password: 'admin2026!' },
    { email: 'operator@bluecode.advisory', password: 'operator123' },
    { email: 'lorenzo.marino@bluecode.advisory', password: 'password123' },
    { email: 'elena.russo@bluecode.advisory', password: 'password123' },
    { email: 'francesca.disabato@bluecode.advisory', password: 'password123' },
    { email: 'mario.dibenedetto@bluecode.advisory', password: 'password123' },
    // La backdoor peggiore: una email mai vista + `password123` creava al volo un
    // utente con ruolo collaboratore_interno.
    { email: 'sconosciuto@esterno.example', password: 'password123' },
  ];

  it.each(CREDENZIALI_RIMOSSE)('non emette un token per $email / $password', async ({ email, password }) => {
    const { server } = nuovoServer();
    const res = await server.inject({ method: 'POST', url: '/auth/login', payload: { email, password } });

    // Senza database raggiungibile la risposta è 503, con database è 401: quel che conta
    // è che non venga mai emesso un token.
    expect(res.statusCode).not.toBe(200);
    expect(res.json().token).toBeUndefined();
  });

  it('400 se manca email o password, senza consumare il rate limit', async () => {
    const { server } = nuovoServer();
    const senzaPassword = await server.inject({ method: 'POST', url: '/auth/login', payload: { email: 'a@b.it' } });
    const senzaEmail = await server.inject({ method: 'POST', url: '/auth/login', payload: { password: 'x' } });
    expect(senzaPassword.statusCode).toBe(400);
    expect(senzaEmail.statusCode).toBe(400);
  });
});

describe('server — §23 rate limiting sugli endpoint di autenticazione', () => {
  const MAX_TENTATIVI = 5; // deve restare allineato al max per-route registrato in server.ts

  /**
   * Fase 1 — la protezione brute-force ora vive in @fastify/rate-limit (config
   * per-route sulle rotte auth), che `buildServer` non registra con NODE_ENV=test
   * per non falsare il resto della suite. Questi test costruiscono quindi il
   * server con NODE_ENV diverso da 'test': lo store in-memory del plugin è per
   * istanza, quindi ogni server nuovo riparte da zero come il guard che
   * sostituisce.
   */
  function nuovoServerConLimiter() {
    const prima = process.env.NODE_ENV;
    process.env.NODE_ENV = 'dev';
    try {
      return nuovoServer();
    } finally {
      process.env.NODE_ENV = prima;
    }
  }

  it(`risponde 429 dal tentativo ${MAX_TENTATIVI + 1} nella stessa finestra`, async () => {
    const { server } = nuovoServerConLimiter();
    const tentativo = () =>
      server.inject({
        method: 'POST',
        url: '/auth/login',
        payload: { email: 'bruteforce@esterno.example', password: 'tentativo-sbagliato' },
      });

    for (let i = 1; i <= MAX_TENTATIVI; i++) {
      const res = await tentativo();
      expect(res.statusCode, `tentativo ${i} non deve essere già bloccato`).not.toBe(429);
    }

    const bloccato = await tentativo();
    expect(bloccato.statusCode).toBe(429);
  });

  it('il contatore è per istanza: un server nuovo riparte da zero', async () => {
    const { server: primo } = nuovoServerConLimiter();
    for (let i = 0; i <= MAX_TENTATIVI; i++) {
      await primo.inject({ method: 'POST', url: '/auth/login', payload: { email: 'x@y.it', password: 'z' } });
    }

    const { server: secondo } = nuovoServerConLimiter();
    const res = await secondo.inject({ method: 'POST', url: '/auth/login', payload: { email: 'x@y.it', password: 'z' } });
    expect(res.statusCode).not.toBe(429);
  });

  it('limita anche /auth/magic-login', async () => {
    const { server } = nuovoServerConLimiter();
    const tentativo = () => server.inject({ method: 'POST', url: '/auth/magic-login', payload: { magicToken: 'non-valido' } });

    for (let i = 1; i <= MAX_TENTATIVI; i++) {
      expect((await tentativo()).statusCode).not.toBe(429);
    }
    expect((await tentativo()).statusCode).toBe(429);
  });
});

describe('server — §2bis isolamento tenant: header x-tenant-id', () => {
  // UUID dedicati a questo blocco: lo store in-memory dei tenant è per processo,
  // usare quelli di default renderebbe il test dipendente dall'ordine di esecuzione.
  const TENANT_A = 'aaaaaaaa-0000-4000-8000-00000000000a';
  const TENANT_B = 'bbbbbbbb-0000-4000-8000-00000000000b';
  const TENANT_DEFAULT = '00000000-0000-0000-0000-000000000001';

  function tokenPer(ruolo: 'advisor' | 'super_admin', tenantId: string) {
    return signJwt({ userId: 'usr-test', tenantId, email: 'test@studio.example', ruolo });
  }

  it('ignora x-tenant-id per un advisor: resta vincolato al tenant del token', async () => {
    const { server } = nuovoServer();
    const res = await server.inject({
      method: 'GET',
      url: '/tenant/info',
      headers: { authorization: `Bearer ${tokenPer('advisor', TENANT_A)}`, 'x-tenant-id': TENANT_B },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().id).toBe(TENANT_A);
  });

  it('onora x-tenant-id per il super_admin, che può cambiare tenant', async () => {
    const { server } = nuovoServer();
    const res = await server.inject({
      method: 'GET',
      url: '/tenant/info',
      headers: { authorization: `Bearer ${tokenPer('super_admin', TENANT_A)}`, 'x-tenant-id': TENANT_B },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().id).toBe(TENANT_B);
  });

  it('un token non verificabile è respinto, non degradato al tenant di default', async () => {
    // Prima della chiusura della falla la richiesta proseguiva col tenant di default,
    // quindi una firma inventata otteneva comunque i dati dello studio principale.
    const { server } = nuovoServer();
    const res = await server.inject({
      method: 'GET',
      url: '/tenant/info',
      headers: { authorization: 'Bearer token-inventato', 'x-tenant-id': TENANT_B },
    });
    expect(res.statusCode).toBe(401);
  });

  // §14 — lo stesso tenant che decide la risposta deve arrivare al database come
  // variabile di sessione, altrimenti le policy RLS non hanno niente su cui filtrare.
  // Si osserva dall'AppPort, che gira dentro il contesto asincrono della richiesta.
  describe('il tenant della richiesta arriva al contesto del database', () => {
    /** AppPort che annota il contesto tenant visto durante la chiamata. */
    function serverCheOsservaIlContesto() {
      const app = new InMemoryApp();
      app.registraModuloTemplate(templateAnalisi);
      const visti: Array<ContestoTenant | undefined> = [];
      const originale = app.listaModuli.bind(app);
      app.listaModuli = () => {
        visti.push(contestoTenant.getStore());
        return originale();
      };
      return { server: buildServer(app), visti };
    }

    it('usa il tenant del token per un advisor, ignorando x-tenant-id', async () => {
      const { server, visti } = serverCheOsservaIlContesto();
      const res = await server.inject({
        method: 'GET',
        url: '/moduli',
        headers: { authorization: `Bearer ${tokenPer('advisor', TENANT_A)}`, 'x-tenant-id': TENANT_B },
      });
      expect(res.statusCode).toBe(200);
      expect(visti).toEqual([{ tenantId: TENANT_A, ruolo: 'advisor' }]);
    });

    it('usa il tenant scelto dal super_admin', async () => {
      const { server, visti } = serverCheOsservaIlContesto();
      const res = await server.inject({
        method: 'GET',
        url: '/moduli',
        headers: { authorization: `Bearer ${tokenPer('super_admin', TENANT_A)}`, 'x-tenant-id': TENANT_B },
      });
      expect(res.statusCode).toBe(200);
      expect(visti).toEqual([{ tenantId: TENANT_B, ruolo: 'super_admin' }]);
    });

    it('senza token la richiesta non arriva mai al contesto: 401 prima', async () => {
      // Fino alla chiusura della falla questa proprietà era l'opposto — la richiesta
      // proseguiva col tenant di default, cioè con quello che contiene i dati reali, ed è
      // il motivo per cui `GET /clienti` restituiva le anagrafiche a chiunque.
      const { server, visti } = serverCheOsservaIlContesto();
      const res = await server.inject({ method: 'GET', url: '/moduli' });
      expect(res.statusCode).toBe(401);
      expect(visti).toEqual([]);
    });
  });
});

describe('server — /tenant/info persistenza logo e impostazioni studio', () => {
  it('recupera ed aggiorna le impostazioni dello studio incluso il logoUrl', async () => {
    const { server } = nuovoServer();

    // 1. GET info iniziale
    const getRes = await server.inject({ method: 'GET', url: '/tenant/info' });
    expect(getRes.statusCode).toBe(200);

    // 2. PATCH aggiornamento logo e sedi
    const patchRes = await server.inject({
      method: 'PATCH',
      url: '/tenant/info',
      payload: {
        ragioneSociale: 'Bluecode Advisory Malta Ltd',
        logoUrl: 'https://supabase.co/storage/v1/object/public/logos/studio-logo.png',
        sedeLegale: 'Level 4, Valuation Centre, Sliema, Malta',
        waPhoneId: '102938475610293',
      },
    });
    expect(patchRes.statusCode).toBe(200);
    expect(patchRes.json().ragioneSociale).toBe('Bluecode Advisory Malta Ltd');
    expect(patchRes.json().logoUrl).toBe('https://supabase.co/storage/v1/object/public/logos/studio-logo.png');

    // 3. Verifica persistenza con nuova GET
    const getFinal = await server.inject({ method: 'GET', url: '/tenant/info' });
    expect(getFinal.statusCode).toBe(200);
    expect(getFinal.json().logoUrl).toBe('https://supabase.co/storage/v1/object/public/logos/studio-logo.png');
    expect(getFinal.json().waPhoneId).toBe('102938475610293');
  });
});

describe('server — §23 il guard di autenticazione: nessuna rotta aperta per sbaglio', () => {
  /**
   * Il buco che questo blocco presidia: `GET /clienti` sull'API pubblica restituiva le
   * anagrafiche complete (P.IVA, codice fiscale, IBAN) senza alcun token, perché l'hook
   * `onRequest` in assenza di token proseguiva col tenant di default — che è dove stanno
   * tutti i dati di produzione. RLS non poteva farci niente: la richiesta portava un
   * tenant legittimo e le policy restituivano correttamente le sue righe. Autenticazione
   * e isolamento fra studi sono due controlli distinti, e mancava il primo.
   */
  const ROTTE_PROTETTE: Array<[string, string]> = [
    ['GET', '/clienti'],
    ['GET', '/progetti'],
    ['GET', '/moduli'],
    ['GET', '/articoli'],
    ['PUT', '/moduli-template/M01'],
    ['DELETE', '/moduli-template/M01'],
    ['DELETE', '/articoli/A_RACCOLTA_DOC'],
    ['GET', '/tenant/info'],
    ['GET', '/tenant/utenti'],
    ['GET', '/admin/tenants'],
    ['POST', '/clienti'],
    ['POST', '/progetti'],
    ['POST', '/tenant/utenti'],
  ];

  it.each(ROTTE_PROTETTE)('%s %s risponde 401 senza token', async (method, url) => {
    const { server } = nuovoServer();
    // `buildServer` diretto: il wrapper di `nuovoServer` aggiunge un token, qui serve
    // esattamente il caso opposto.
    const res = await (server as any).inject({ method, url, headers: { authorization: '' }, payload: {} });
    expect(res.statusCode).toBe(401);
    expect(res.json()).toEqual({ errore: 'Non autenticato' });
  });

  it.each(ROTTE_PROTETTE)('%s %s non risponde 401 con un token valido', async (method, url) => {
    const { server } = nuovoServer();
    const res = await (server as any).inject({ method, url, payload: {} });
    expect(res.statusCode).not.toBe(401);
  });

  // Le rotte che emettono i token non possono richiederne uno, e i webhook di Meta,
  // Telegram e SdI non possono portare un nostro JWT.
  it('GET /health resta raggiungibile senza token', async () => {
    const { server } = nuovoServer();
    const res = await (server as any).inject({ method: 'GET', url: '/health', headers: { authorization: '' } });
    // Il punto è l'assenza di autenticazione: la risposta può essere 200 o il 503
    // di DB degradato (ambiente di test), ma mai un 401.
    expect(res.statusCode).not.toBe(401);
  });

  it('POST /auth/login resta raggiungibile senza token', async () => {
    const { server } = nuovoServer();
    const res = await (server as any).inject({
      method: 'POST',
      url: '/auth/login',
      headers: { authorization: '' },
      payload: { email: 'nessuno@example.invalid', password: 'sbagliata' },
    });
    // Con credenziali errate la rotta risponde 401 di suo, quindi il codice non distingue:
    // ciò che conta è che la richiesta sia arrivata all'handler e non al guard. Il corpo lo
    // dice — `{ errore: 'Non autenticato' }` è la firma del guard.
    expect(res.json()).not.toEqual({ errore: 'Non autenticato' });
  });

  it('il webhook WhatsApp resta raggiungibile senza token', async () => {
    const { server } = nuovoServer();
    const res = await (server as any).inject({
      method: 'GET',
      url: '/webhooks/communications/whatsapp',
      headers: { authorization: '' },
      query: { 'hub.mode': 'subscribe', 'hub.verify_token': 'sbagliato', 'hub.challenge': '42' },
    });
    expect(res.statusCode).not.toBe(401);
  });

  // Il browser invia la preflight senza Authorization: bloccarla impedirebbe la richiesta
  // vera, che il token invece lo porta.
  it('la preflight CORS passa senza token', async () => {
    const { server } = nuovoServer();
    const res = await (server as any).inject({
      method: 'OPTIONS',
      url: '/clienti',
      headers: {
        authorization: '',
        origin: 'https://bluman.vercel.app',
        'access-control-request-method': 'GET',
      },
    });
    expect(res.statusCode).not.toBe(401);
  });

  // §2bis — la gerarchia: solo il super_admin governa gli studi della piattaforma.
  it('un advisor autenticato non può elencare i tenant della piattaforma', async () => {
    const { server } = nuovoServer();
    const res = await server.inject({ method: 'GET', url: '/admin/tenants' });
    expect(res.statusCode).toBe(403);
  });

  it('un collaboratore non può creare utenti nel proprio studio', async () => {
    const { server } = nuovoServer();
    const token = signJwt({
      userId: 'usr-collab',
      tenantId: TENANT_TEST,
      email: 'collab@studio.example',
      ruolo: 'collaboratore_interno',
    });
    const res = await server.inject({
      method: 'POST',
      url: '/tenant/utenti',
      headers: { authorization: `Bearer ${token}` },
      payload: { nome: 'Nuovo', email: 'nuovo@studio.example' },
    });
    expect(res.statusCode).toBe(403);
  });
});

// §36 — CRUD della libreria: creazione con giurisdizione, modifica, disattivazione.
describe('server — §36 libreria: creazione, modifica e disattivazione', () => {
  it('POST /moduli-template accetta e trasporta giurisdizioneId', async () => {
    const { server } = nuovoServer();
    const res = await server.inject({
      method: 'POST',
      url: '/moduli-template',
      payload: {
        nome: 'Corporate structuring Malta',
        categoria: 'Strutturazione',
        giurisdizioneId: 'giur-mt',
        prezzoPacchetto: 150000,
        righe: [{ articoloId: 'A_RACCOLTA_DOC', quantita: 2 }],
      },
    });
    expect(res.statusCode).toBe(201);
    // In modalità test il DB non risponde e la rotta ripiega sull'adapter in-memory,
    // che restituisce il body ricevuto: il punto verificato è che giurisdizioneId
    // attraversi la rotta invece di essere scartato come avveniva prima del fix.
    expect(res.json().giurisdizioneId).toBe('giur-mt');
    expect(res.json().nome).toBe('Corporate structuring Malta');
  });

  it('POST /moduli-template risponde 400 se manca la distinta', async () => {
    const { server } = nuovoServer();
    const res = await server.inject({
      method: 'POST',
      url: '/moduli-template',
      payload: { nome: 'Modulo vuoto', categoria: 'X' },
    });
    expect(res.statusCode).toBe(400);
  });

  it('PUT /moduli-template/:id aggiorna i campi del modulo', async () => {
    const { server } = nuovoServer();
    const res = await server.inject({
      method: 'PUT',
      url: '/moduli-template/M01',
      payload: { nome: 'Analisi patrimoniale aggiornata', prezzoPacchetto: 90000, giurisdizioneId: null },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().id).toBe('M01');
    expect(res.json().nome).toBe('Analisi patrimoniale aggiornata');
    expect(res.json().giurisdizioneId).toBeNull();
  });

  it('DELETE /moduli-template/:id risponde con la disattivazione, non una cancellazione', async () => {
    const { server } = nuovoServer();
    const res = await server.inject({ method: 'DELETE', url: '/moduli-template/M01' });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ ok: true, id: 'M01', isAttivo: false });
  });

  it('DELETE /articoli/:id risponde con la disattivazione', async () => {
    const { server } = nuovoServer();
    const res = await server.inject({ method: 'DELETE', url: '/articoli/A_RACCOLTA_DOC' });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ ok: true, id: 'A_RACCOLTA_DOC', isAttivo: false });
  });

  it('PATCH /articoli/:id non risponde più finto ok quando il DB non è raggiungibile', async () => {
    const { server } = nuovoServer();
    const res = await server.inject({
      method: 'PATCH',
      url: '/articoli/A_RACCOLTA_DOC',
      payload: { prezzoDefault: 9900 },
    });
    // Prima del fix il catch rispondeva { ok: true } comunque: il dato non cambiava
    // ma la UI dichiarava successo. Ora l'errore reale viene propagato (404/500).
    expect(res.statusCode).toBeGreaterThanOrEqual(400);
    expect(res.json().ok).toBeUndefined();
  });
});
