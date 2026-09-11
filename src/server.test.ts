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

  it('GET /moduli risponde 500 onesto senza DB, non una libreria finta', async () => {
    // La rotta legge moduloTemplate da Prisma. Senza DB il vecchio catch rispondeva
    // 200 con la libreria dell'adapter, mascherando il guasto; ora l'errore reale
    // arriva all'errorHandler (modello del test /health). L'elencazione con dati
    // veri è presidiata da calcoloService.test.ts, che mocka il client Prisma.
    const { server } = nuovoServer();
    const res = await server.inject({ method: 'GET', url: '/moduli' });
    expect(res.statusCode).toBe(500);
    expect(typeof res.json().errore).toBe('string');
  });
});

describe('server — flusso completo cliente → progetto → preventivo → accettazione', () => {
  it('esegue l\'intero ciclo end-to-end tramite HTTP', async () => {
    const { app, server } = nuovoServer();

    const cliente = await server.inject({ method: 'POST', url: '/clienti', payload: { nome: 'Marco Ricci', tipo: 'individual' } });
    expect(cliente.statusCode).toBe(201);
    const clienteId = cliente.json().id;

    // POST /progetti è prisma-diretta e senza DB risponderebbe 500: si crea il
    // progetto dall'AppPort — ciò che la rotta stessa faceva prima della migrazione —
    // così il resto del ciclo (preventivo, accettazione, rilettura) resta end-to-end.
    const progetto = app.creaProgetto({ clienteId, nome: 'Struttura Holding' });
    expect(progetto.stato).toBe('pre_project');
    const progettoId = progetto.id;

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
    const { app, server } = nuovoServer();
    const cliente = await server.inject({ method: 'POST', url: '/clienti', payload: { nome: 'Test', tipo: 'individual' } });
    // POST /progetti è prisma-diretta e senza DB risponde 500: si crea il progetto
    // dall'AppPort, come faceva la rotta prima della migrazione.
    const progetto = app.creaProgetto({ clienteId: cliente.json().id, nome: 'P' });
    const preventivo = await server.inject({
      method: 'POST',
      url: '/preventivi',
      payload: { clienteId: cliente.json().id, progettoId: progetto.id, righe: [{ moduloTemplateId: 'M01', moduloTemplateVersione: 1 }] },
    });
    const preventivoId = preventivo.json().id;

    const prima = await server.inject({ method: 'POST', url: `/preventivi/${preventivoId}/accetta` });
    expect(prima.statusCode).toBe(200);

    const seconda = await server.inject({ method: 'POST', url: `/preventivi/${preventivoId}/accetta` });
    expect(seconda.statusCode).toBe(409);
  });

  it('404 con messaggio chiaro se un modulo del preventivo non esiste in libreria', async () => {
    const { app, server } = nuovoServer();
    const cliente = await server.inject({ method: 'POST', url: '/clienti', payload: { nome: 'Test', tipo: 'individual' } });
    const progetto = app.creaProgetto({ clienteId: cliente.json().id, nome: 'P' });
    const res = await server.inject({
      method: 'POST',
      url: '/preventivi',
      payload: { clienteId: cliente.json().id, progettoId: progetto.id, righe: [{ moduloTemplateId: 'INESISTENTE', moduloTemplateVersione: 1 }] },
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

  it('GET /progetti risponde 500 onesto senza DB, non un elenco finto', async () => {
    // La rotta legge progetto da Prisma: senza DB l'errore reale arriva
    // all'errorHandler invece del vecchio elenco dell'adapter. L'elencazione
    // con dati veri è presidiata da calcoloService.test.ts (client mockato).
    const { server } = nuovoServer();
    const res = await server.inject({ method: 'GET', url: '/progetti' });
    expect(res.statusCode).toBe(500);
    expect(typeof res.json().errore).toBe('string');
  });
});

describe('server — §17 esecuzione, tramite HTTP end-to-end', () => {
  async function progettoAvviato({ app, server }: ReturnType<typeof nuovoServer>) {
    const cliente = await server.inject({ method: 'POST', url: '/clienti', payload: { nome: 'Marco Ricci', tipo: 'individual' } });
    // POST /progetti è prisma-diretta e senza DB risponde 500: si crea il
    // progetto dall'AppPort, come faceva la rotta prima della migrazione.
    const progetto = app.creaProgetto({ clienteId: cliente.json().id, nome: 'P' });
    const preventivo = await server.inject({
      method: 'POST',
      url: '/preventivi',
      payload: { clienteId: cliente.json().id, progettoId: progetto.id, righe: [{ moduloTemplateId: 'M01', moduloTemplateVersione: 1 }] },
    });
    await server.inject({ method: 'POST', url: `/preventivi/${preventivo.json().id}/accetta` });
    const progettoFinale = await server.inject({ method: 'GET', url: `/progetti/${progetto.id}` });
    const mv = progettoFinale.json().moduli[0].microvoci[0];
    return { progettoId: progetto.id, microvoceId: mv.id as string };
  }

  it('consuntiva ore su una micro-voce via HTTP', async () => {
    const { app, server } = nuovoServer();
    const { microvoceId } = await progettoAvviato({ app, server });

    const res = await server.inject({ method: 'POST', url: `/microvoci/${microvoceId}/consuntiva`, payload: { ore: 1 } });
    expect(res.statusCode).toBe(200);
    expect(res.json().oreConsuntivate).toBe(1);
  });

  it('GET /microvoci/:id legge lo stato aggiornato dopo un\'azione (usato dal frontend per il refresh)', async () => {
    const { app, server } = nuovoServer();
    const { microvoceId } = await progettoAvviato({ app, server });
    await server.inject({ method: 'POST', url: `/microvoci/${microvoceId}/consuntiva`, payload: { ore: 1.5 } });
    const res = await server.inject({ method: 'GET', url: `/microvoci/${microvoceId}` });
    expect(res.statusCode).toBe(200);
    expect(res.json().oreConsuntivate).toBe(1.5);
  });

  it('400 se manca il campo ore', async () => {
    const { app, server } = nuovoServer();
    const { microvoceId } = await progettoAvviato({ app, server });
    const res = await server.inject({ method: 'POST', url: `/microvoci/${microvoceId}/consuntiva`, payload: {} });
    expect(res.statusCode).toBe(400);
  });

  it('marca-ritardo con causaNota valida, poi risolvi-ritardo', async () => {
    const { app, server } = nuovoServer();
    const { microvoceId } = await progettoAvviato({ app, server });

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
    const { app, server } = nuovoServer();
    const { microvoceId } = await progettoAvviato({ app, server });
    const res = await server.inject({ method: 'POST', url: `/microvoci/${microvoceId}/ritardo`, payload: { stato: 'blocked' } });
    expect(res.statusCode).toBe(400); // validazione a livello route, prima ancora del motore
  });

  it('409 se si tenta di completare una micro-voce con passaggi ancora aperti (§17.1)', async () => {
    const { app, server } = nuovoServer();
    const { microvoceId } = await progettoAvviato({ app, server });
    const res = await server.inject({ method: 'PATCH', url: `/microvoci/${microvoceId}/completa` });
    expect(res.statusCode).toBe(409);
    expect(res.json().errore).toMatch(/passaggio/);
  });

  it('flusso completo: completare tutti i passaggi sblocca il completamento della micro-voce', async () => {
    const { app, server } = nuovoServer();
    const { microvoceId } = await progettoAvviato({ app, server });

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
      const originale = app.getProgetto.bind(app);
      // /moduli è ormai prisma-diretta e non passa più dall'AppPort: si osserva
      // getProgetto, chiamata da GET /progetti/:id. L'id è fittizio, quindi
      // l'originale lancia ProgettoNonTrovatoError → 404 via errorHandler:
      // qui conta solo il contesto con cui l'AppPort viene invocato.
      app.getProgetto = (id: string) => {
        visti.push(contestoTenant.getStore());
        return originale(id);
      };
      return { server: buildServer(app), visti };
    }

    it('usa il tenant del token per un advisor, ignorando x-tenant-id', async () => {
      const { server, visti } = serverCheOsservaIlContesto();
      const res = await server.inject({
        method: 'GET',
        url: '/progetti/progetto-osservato',
        headers: { authorization: `Bearer ${tokenPer('advisor', TENANT_A)}`, 'x-tenant-id': TENANT_B },
      });
      // 404 perché l'id è fittizio: il progetto non esiste. Il punto del test è
      // il contesto con cui l'AppPort è stato chiamato, qui sotto.
      expect(res.statusCode).toBe(404);
      expect(visti).toEqual([{ tenantId: TENANT_A, ruolo: 'advisor' }]);
    });

    it('usa il tenant scelto dal super_admin', async () => {
      const { server, visti } = serverCheOsservaIlContesto();
      const res = await server.inject({
        method: 'GET',
        url: '/progetti/progetto-osservato',
        headers: { authorization: `Bearer ${tokenPer('super_admin', TENANT_A)}`, 'x-tenant-id': TENANT_B },
      });
      // 404 perché l'id è fittizio: il punto del test è il contesto con cui
      // l'AppPort è stato chiamato, qui sotto.
      expect(res.statusCode).toBe(404);
      expect(visti).toEqual([{ tenantId: TENANT_B, ruolo: 'super_admin' }]);
    });

    it('senza token la richiesta non arriva mai al contesto: 401 prima', async () => {
      // Fino alla chiusura della falla questa proprietà era l'opposto — la richiesta
      // proseguiva col tenant di default, cioè con quello che contiene i dati reali, ed è
      // il motivo per cui `GET /clienti` restituiva le anagrafiche a chiunque.
      const { server, visti } = serverCheOsservaIlContesto();
      const res = await server.inject({ method: 'GET', url: '/progetti/progetto-osservato' });
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

    // 2. PATCH aggiornamento logo e sedi. `/logo.png` è il valore del seed: un percorso
    // relativo, indipendente dall'ambiente, che `rifirmaUrlUpload` lascia invariato.
    const patchRes = await server.inject({
      method: 'PATCH',
      url: '/tenant/info',
      payload: {
        ragioneSociale: 'Bluecode Advisory Malta Ltd',
        logoUrl: '/logo.png',
        sedeLegale: 'Level 4, Valuation Centre, Sliema, Malta',
        waPhoneId: '102938475610293',
      },
    });
    expect(patchRes.statusCode).toBe(200);
    expect(patchRes.json().ragioneSociale).toBe('Bluecode Advisory Malta Ltd');
    expect(patchRes.json().logoUrl).toBe('/logo.png');

    // 3. Verifica persistenza con nuova GET
    const getFinal = await server.inject({ method: 'GET', url: '/tenant/info' });
    expect(getFinal.statusCode).toBe(200);
    expect(getFinal.json().logoUrl).toBe('/logo.png');
    expect(getFinal.json().waPhoneId).toBe('102938475610293');
  });

  it('respinge un logoUrl https che non punta allo storage del project', async () => {
    // È l'URL esatto con cui questo stesso test, girato senza isolamento fra il 15 e il
    // 19 agosto 2026, ha sovrascritto il logo del tenant di produzione: l'host
    // `supabase.co` senza il sottodominio del project non risponde a niente, e da quel
    // giorno la fascia dell'intestazione restava vuota. Il PATCH ora lo respinge con
    // 400 prima di toccare il database.
    const { server } = nuovoServer();
    const patchRes = await server.inject({
      method: 'PATCH',
      url: '/tenant/info',
      payload: { logoUrl: 'https://supabase.co/storage/v1/object/public/logos/studio-logo.png' },
    });
    expect(patchRes.statusCode).toBe(400);
    expect(patchRes.json().errore).toContain('logoUrl non valido');
  });

  it('respinge un logoUrl con metacaratteri HTML, anche se il percorso è relativo', async () => {
    // Il logo finisce non escapato in `<img src="${dati.logo}">` in intestazioneStudio.ts:
    // una virgoletta chiude l'attributo e inietta HTML nella fascia di ogni documento
    // (canvas, PDF, .doc, documento salvato) — raggiungibile da qualunque utente del
    // tenant via PATCH. Nessun valore legittimo contiene virgolette, angolari o spazi
    // — base64 dei data: URL, safeFilename dei percorsi /uploads/, URL https — quindi
    // il PATCH respinge la stringa grezza prima ancora di considerarne la forma.
    const { server } = nuovoServer();
    const patchRes = await server.inject({
      method: 'PATCH',
      url: '/tenant/info',
      payload: { logoUrl: '/logo.png" onerror="alert(1)' },
    });
    expect(patchRes.statusCode).toBe(400);
    expect(patchRes.json().errore).toContain('logoUrl non valido');
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
    // La rotta è prisma-diretta: qui il DB non risponde (vedi vitest.setup.ts)
    // e la risposta onesta è il 500 dell'errorHandler, non una libreria finta.
    // La validazione dei campi obbligatori avviene prima del DB ed è coperta
    // dal test «400 se manca la distinta». Il trasporto di giurisdizioneId
    // nella $transaction è nel codice della rotta; senza DB non è verificabile
    // via HTTP, e questo test non afferma coperture che non ha.
    expect(res.statusCode).toBe(500);
    expect(typeof res.json().errore).toBe('string');
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
    // La rotta arriva a prisma.moduloTemplate.update, quindi senza DB risponde
    // 500 onesto. Il payload non contiene `righe`, quindi nessun 400 pre-DB.
    expect(res.statusCode).toBe(500);
    expect(typeof res.json().errore).toBe('string');
  });

  it('DELETE /moduli-template/:id risponde con la disattivazione, non una cancellazione', async () => {
    const { server } = nuovoServer();
    const res = await server.inject({ method: 'DELETE', url: '/moduli-template/M01' });
    // La rotta disattiva (catalogo.ts: isAttivo: false), ma è prisma-diretta:
    // senza DB la risposta onesta è 500, non l'ok finto dell'adapter.
    expect(res.statusCode).toBe(500);
    expect(typeof res.json().errore).toBe('string');
  });

  it('DELETE /articoli/:id risponde con la disattivazione', async () => {
    const { server } = nuovoServer();
    const res = await server.inject({ method: 'DELETE', url: '/articoli/A_RACCOLTA_DOC' });
    // Come sopra: disattivazione nel codice della rotta, 500 onesto senza DB.
    expect(res.statusCode).toBe(500);
    expect(typeof res.json().errore).toBe('string');
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

describe('server — DELETE /progetti/:id (§1.1 PIANO_DI_MIGLIORAMENTO)', () => {
  it('elimina un progetto esistente; la rilettura risponde 404', async () => {
    const { app, server } = nuovoServer();
    const cliente = await server.inject({ method: 'POST', url: '/clienti', payload: { nome: 'Da eliminare', tipo: 'individual' } });
    // POST /progetti è prisma-diretta e senza DB risponderebbe 500: si crea il
    // progetto dall'AppPort, come faceva la rotta prima della migrazione.
    const progetto = app.creaProgetto({ clienteId: cliente.json().id, nome: 'Progetto transitorio' });
    const progettoId = progetto.id;

    const res = await server.inject({ method: 'DELETE', url: `/progetti/${progettoId}` });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ ok: true, id: progettoId });

    const rilettura = await server.inject({ method: 'GET', url: `/progetti/${progettoId}` });
    expect(rilettura.statusCode).toBe(404);
  });

  it('404 su progetto inesistente, non un 409 o un 500', async () => {
    const { server } = nuovoServer();
    const res = await server.inject({ method: 'DELETE', url: '/progetti/non-esiste' });
    expect(res.statusCode).toBe(404);
    expect(res.json().errore).toMatch(/non trovato/);
  });

  it('409 se il progetto contiene fatture: si archivia, non si elimina', async () => {
    const { app, server } = nuovoServer();
    const cliente = await server.inject({ method: 'POST', url: '/clienti', payload: { nome: 'Con fatture', tipo: 'individual' } });
    const progetto = app.creaProgetto({ clienteId: cliente.json().id, nome: 'Fatturato' });
    const progettoId = progetto.id;
    // InMemoryApp non espone un metodo pubblico per creare fatture: si alimenta la
    // mappa interna, come farebbe il ciclo di fatturazione.
    (app as any).fatture.set('fatt-1', { id: 'fatt-1', progettoId });

    const res = await server.inject({ method: 'DELETE', url: `/progetti/${progettoId}` });
    expect(res.statusCode).toBe(409);
    expect(res.json().errore).toMatch(/Fatture/);

    // Il progetto deve essere ancora lì: il blocco fiscale non è un'eliminazione parziale.
    const rilettura = await server.inject({ method: 'GET', url: `/progetti/${progettoId}` });
    expect(rilettura.statusCode).toBe(200);
  });

  it('403 per i ruoli che non rispondono dello studio', async () => {
    const { server } = nuovoServer();
    // Il guard di ruolo precede l'accesso ai dati: non serve creare nulla,
    // l'id fittizio basta perché la rotta si fermi al 403.
    const tokenCollaboratore = signJwt({
      userId: 'usr-collab',
      tenantId: TENANT_TEST,
      email: 'collab@studio.example',
      ruolo: 'collaboratore_interno',
    });

    const res = await server.inject({
      method: 'DELETE',
      url: '/progetti/qualsiasi-id',
      headers: { authorization: `Bearer ${tokenCollaboratore}` },
    });
    expect(res.statusCode).toBe(403);
  });
});

describe('server — DELETE /progetti/:id/moduli/:moduloId (§1.1bis)', () => {
  it('guard di ruolo: advisor passa il check (il DB non è disponibile nei test)', async () => {
    // Nei test il DB Prisma non è raggiungibile: la rotta arriva al guard di ruolo
    // (advisor → ok) poi fallisce su prisma.moduloProgetto.findFirst (500 DB error).
    // Il test presidia che il 403 NON scatti per un advisor.
    const { server } = nuovoServer();
    const res = await server.inject({ method: 'DELETE', url: '/progetti/qualsiasi/moduli/qualsiasi-id' });
    expect(res.statusCode).not.toBe(403);
  });

  it('403 se il ruolo è collaboratore_interno', async () => {
    const { server } = nuovoServer();
    // Il guard di ruolo precede l'accesso ai dati: l'id fittizio basta.
    const tokenCollaboratore = signJwt({
      userId: 'usr-collab',
      tenantId: TENANT_TEST,
      email: 'collab@test.example',
      ruolo: 'collaboratore_interno',
    });

    const res = await server.inject({
      method: 'DELETE',
      url: '/progetti/qualsiasi-id/moduli/qualsiasi-id',
      headers: { authorization: `Bearer ${tokenCollaboratore}` },
    });
    expect(res.statusCode).toBe(403);
    expect(res.json().errore).toMatch(/advisor/i);
  });

  it('401 senza token di autenticazione — il guard JWT blocca prima del ruolo', async () => {
    const { server } = nuovoServer();
    // La rotta è protetta: senza token il guard onRequest risponde 401 prima
    // che il handler venga invocato, indipendentemente dalla disponibilità del DB.
    const res = await server.inject({
      method: 'DELETE',
      url: '/progetti/qualsiasi/moduli/qualsiasi-id',
      headers: { authorization: '' },
    });
    expect(res.statusCode).toBe(401);
  });
});

describe('server — isolamento progetti per ruolo cliente (Fix 4b)', () => {
  const TENANT_TEST = '00000000-0000-0000-0000-000000000001';

  it('GET /progetti rifiuta con 400 un token cliente privo di identita valida client-<clienteId>', async () => {
    const { server } = nuovoServer();
    const tokenClienteInvalido = signJwt({
      userId: 'senza-prefisso-client',
      tenantId: TENANT_TEST,
      email: 'cliente@test.it',
      ruolo: 'cliente',
    });

    const res = await server.inject({
      method: 'GET',
      url: '/progetti',
      headers: { authorization: `Bearer ${tokenClienteInvalido}` },
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().errore).toMatch(/Cliente non identificato/i);
  });

  it('GET /progetti/:id risponde 404 se un cliente tenta di accedere al progetto di un altro cliente', async () => {
    const { server } = nuovoServer();
    const tokenCliente1 = signJwt({
      userId: 'client-cliente-1',
      tenantId: TENANT_TEST,
      email: 'cliente1@test.it',
      ruolo: 'cliente',
    });

    const res = await server.inject({
      method: 'GET',
      url: '/progetti/proj-del-cliente-2',
      headers: { authorization: `Bearer ${tokenCliente1}` },
    });
    // Sia che il progetto non esista o appartenga a un altro cliente, la risposta è un 404 sicuro
    expect(res.statusCode).toBe(404);
  });

  it('GET /progetti/:id/comunicazioni risponde 404 se il progetto non appartiene al cliente', async () => {
    const { server } = nuovoServer();
    const tokenCliente1 = signJwt({
      userId: 'client-cliente-1',
      tenantId: TENANT_TEST,
      email: 'cliente1@test.it',
      ruolo: 'cliente',
    });

    const res = await server.inject({
      method: 'GET',
      url: '/progetti/proj-del-cliente-2/comunicazioni',
      headers: { authorization: `Bearer ${tokenCliente1}` },
    });
    expect(res.statusCode).toBe(404);
  });
});

