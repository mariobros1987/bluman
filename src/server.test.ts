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

function nuovoServer() {
  const app = new InMemoryApp();
  app.registraModuloTemplate(templateAnalisi);
  return { app, server: buildServer(app) };
}

describe('server — /health e /moduli', () => {
  it('GET /health risponde ok', async () => {
    const { server } = nuovoServer();
    const res = await server.inject({ method: 'GET', url: '/health' });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ stato: 'ok' });
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
  const MAX_TENTATIVI = 5; // deve restare allineato ad AUTH_MAX_TENTATIVI in server.ts

  it(`risponde 429 dal tentativo ${MAX_TENTATIVI + 1} nella stessa finestra`, async () => {
    const { server } = nuovoServer();
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
    const { server: primo } = nuovoServer();
    for (let i = 0; i <= MAX_TENTATIVI; i++) {
      await primo.inject({ method: 'POST', url: '/auth/login', payload: { email: 'x@y.it', password: 'z' } });
    }

    const { server: secondo } = nuovoServer();
    const res = await secondo.inject({ method: 'POST', url: '/auth/login', payload: { email: 'x@y.it', password: 'z' } });
    expect(res.statusCode).not.toBe(429);
  });

  it('limita anche /auth/magic-login', async () => {
    const { server } = nuovoServer();
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

  it('ignora x-tenant-id se il token è assente o non verificabile', async () => {
    const { server } = nuovoServer();
    const res = await server.inject({
      method: 'GET',
      url: '/tenant/info',
      headers: { authorization: 'Bearer token-inventato', 'x-tenant-id': TENANT_B },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().id).toBe(TENANT_DEFAULT);
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

    it('senza token il contesto è il tenant di default, mai vuoto', async () => {
      // Un contesto assente non farebbe vedere nulla al ruolo applicativo: è la
      // proprietà voluta, ma su una richiesta legittima sarebbe un guasto.
      const { server, visti } = serverCheOsservaIlContesto();
      const res = await server.inject({ method: 'GET', url: '/moduli' });
      expect(res.statusCode).toBe(200);
      expect(visti).toEqual([{ tenantId: TENANT_DEFAULT, ruolo: undefined }]);
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
