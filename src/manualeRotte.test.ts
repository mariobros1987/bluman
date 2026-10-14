/**
 * L'aiuto in-app — le rotte.
 *
 * Queste rotte sono quasi tutte lettura di file, quindi i test che contano non sono quelli sul
 * contenuto: sono i quattro che presidiano le cose che si perdono toccandole «per fare prima».
 *
 * 1. **Il `content-type` è `application/json`, non `text/html`.** `apiFetch`
 *    (`frontend/src/api/http.ts`) **lancia** quando vede `text/html`, perché nell'architettura
 *    dell'app quel content-type ha un significato solo: la richiesta non ha raggiunto il backend.
 *    Una rotta dell'aiuto che rispondesse HTML sembrerebbe, al browser, un guasto di rete — e la
 *    guardia che oggi spiega quel guasto perderebbe la sua premessa.
 * 2. **Senza token si risponde 401 e non 404.** 404 vorrebbe dire «questa rotta non esiste», che è
 *    la conclusione sbagliata: manda a cercare un deploy, mentre il problema è l'autenticazione.
 * 3. **La §19 è riservata, dal server.** Un indice che la pubblicizza a un collaboratore è una
 *    promessa che la pagina non può mantenere; il `testo` di una scheda riservata non deve
 *    viaggiare affatto, perché la ricerca dell'app cerca lì dentro.
 * 4. **Uno slug ostile risponde 404, non 500.** La regex è l'unico cancello prima del filesystem.
 *
 * Il mock intercetta le sole letture dell'hook di autenticazione (`user.findFirst`), come
 * `src/backupRotte.test.ts`: nessun test tocca il database o la rete.
 */
import { describe, expect, it, vi } from 'vitest';

const stato = vi.hoisted(() => ({ audit: [] as any[] }));

vi.mock('./util/prismaClient.js', async importOriginal => {
  const reale = await importOriginal<typeof import('./util/prismaClient.js')>();

  const utenti: Record<string, { ruolo: string; stato: string; sessionVersion: number }> = {
    'usr-advisor': { ruolo: 'advisor', stato: 'attivo', sessionVersion: 0 },
    'usr-collaboratore': { ruolo: 'collaboratore_interno', stato: 'attivo', sessionVersion: 0 },
    'usr-super': { ruolo: 'super_admin', stato: 'attivo', sessionVersion: 0 },
  };

  return {
    ...reale,
    prisma: new Proxy(reale.prisma as any, {
      get(target, proprieta) {
        if (proprieta === 'user') {
          return new Proxy(target.user, {
            get(u, p) {
              if (p === 'findFirst') {
                return async (args: any) => {
                  const guard = args?.select?.ruolo === true && args?.select?.stato === true && args?.select?.sessionVersion === true;
                  const utente = utenti[args?.where?.id ?? ''];
                  if (guard && utente) {
                    return { ruolo: utente.ruolo, stato: utente.stato, sessionVersion: utente.sessionVersion };
                  }
                  return (u as any).findFirst(args);
                };
              }
              const valore = Reflect.get(u, p, u);
              return typeof valore === 'function' ? valore.bind(u) : valore;
            },
          });
        }
        if (proprieta === 'auditLog') {
          return new Proxy(target.auditLog, {
            get(a, p) {
              if (p === 'create') return async (args: any) => { stato.audit.push(args?.data); return args?.data; };
              const valore = Reflect.get(a, p, a);
              return typeof valore === 'function' ? valore.bind(a) : valore;
            },
          });
        }
        const valore = Reflect.get(target, proprieta, target);
        return typeof valore === 'function' ? valore.bind(target) : valore;
      },
    }),
    prismaAmministrativo: () => reale.prismaAmministrativo(),
  };
});

const { buildServer } = await import('./server.js');
const { InMemoryApp } = await import('./adapters/inMemoryApp.js');
const { signJwt } = await import('./util/jwt.js');

const TENANT = '00000000-0000-0000-0000-000000000001';

const auth = (ruolo: 'advisor' | 'collaboratore_interno' | 'super_admin' = 'super_admin') => {
  const userId = ruolo === 'super_admin' ? 'usr-super' : ruolo === 'advisor' ? 'usr-advisor' : 'usr-collaboratore';
  const token = signJwt({ userId, tenantId: TENANT, email: `${userId}@studio.example`, ruolo, sessionVersion: 0 });
  return { authorization: `Bearer ${token}` };
};

const server = () => buildServer(new InMemoryApp()) as any;

describe('📖 GET /manuale — l’indice', () => {
  it('senza token risponde 401, non 404', async () => {
    // 404 direbbe «questa rotta non esiste» e manderebbe a cercare un guasto di deploy: la
    // conclusione sbagliata, davanti a un problema di autenticazione.
    const res = await server().inject({ method: 'GET', url: '/manuale' });
    expect(res.statusCode).toBe(401);
  });

  it('la risposta è JSON, mai `text/html`', async () => {
    // È la trappola (a) del progetto: `apiFetch` lancia su `text/html`, e il sintomo che ne
    // verrebbe — «la richiesta non è arrivata al backend» — non ha niente a che vedere con la causa.
    const res = await server().inject({ method: 'GET', url: '/manuale', headers: auth() });
    expect(res.statusCode).toBe(200);
    expect(res.headers['content-type']).toMatch(/application\/json/);
    expect(res.headers['content-type']).not.toMatch(/text\/html/);
  });

  it('al super admin elenca 19 schede, al collaboratore 18', async () => {
    const superAdmin = await server().inject({ method: 'GET', url: '/manuale', headers: auth('super_admin') });
    const collaboratore = await server().inject({ method: 'GET', url: '/manuale', headers: auth('collaboratore_interno') });

    expect(superAdmin.json().letto).toBe(true);
    expect(superAdmin.json().schede).toHaveLength(19);
    expect(collaboratore.json().schede).toHaveLength(18);
  });

  it('la §19 non compare nell’indice di chi non è super admin', async () => {
    const res = await server().inject({ method: 'GET', url: '/manuale', headers: auth('advisor') });
    const slugs = res.json().schede.map((s: any) => s.slug);
    expect(slugs).not.toContain('19-infra-deploy');
    // E non compare nemmeno il suo titolo: un elenco che la nomina senza darla è la promessa che
    // la pagina non mantiene.
    expect(res.body).not.toContain('Infrastruttura');
  });

  it('il testo indicizzato del collaboratore non contiene la parte tecnica', async () => {
    // Se il `testo` uscisse dal file grezzo, la ricerca troverebbe parole che poi non si vedono:
    // un risultato che porta a un vicolo cieco senza dirlo.
    const res = await server().inject({ method: 'GET', url: '/manuale', headers: auth('advisor') });
    const scheda = res.json().schede.find((s: any) => s.slug === '05-fatture-sdi');
    expect(scheda.testo).not.toContain('contabilitaRegistro.ts');
    expect(scheda.testo).not.toContain('🔧');
    // Ma la parte utente c'è tutta: un filtro che taglia troppo toglie l'aiuto.
    expect(scheda.testo).toContain('Gate KYC');
  });
});

describe('📄 GET /manuale/:slug — la scheda', () => {
  it('restituisce l’HTML sanitizzato della scheda', async () => {
    const res = await server().inject({ method: 'GET', url: '/manuale/05-fatture-sdi', headers: auth('advisor') });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.letto).toBe(true);
    expect(body.slug).toBe('05-fatture-sdi');
    expect(body.numero).toBe('05');
    expect(body.titolo).toBe('05 · Fatture / Note di Credito & SDI');
    expect(body.riservata).toBe(false);
    expect(body.html).toContain('<h1>');
    expect(res.headers['content-type']).toMatch(/application\/json/);
  });

  it('al collaboratore la parte tecnica non arriva proprio', async () => {
    const res = await server().inject({ method: 'GET', url: '/manuale/05-fatture-sdi', headers: auth('advisor') });
    expect(res.json().html).not.toContain('contabilitaRegistro.ts');
    expect(res.json().html).not.toContain('Nota tecnica');
  });

  it('al super admin la stessa scheda arriva intera', async () => {
    const res = await server().inject({ method: 'GET', url: '/manuale/05-fatture-sdi', headers: auth('super_admin') });
    expect(res.json().html).toContain('contabilitaRegistro.ts');
  });

  it('la §19 è 403 per un collaboratore e 200 per il super admin', async () => {
    const negato = await server().inject({ method: 'GET', url: '/manuale/19-infra-deploy', headers: auth('collaboratore_interno') });
    expect(negato.statusCode).toBe(403);
    // Il 403 **nomina la scheda**: un «non autorizzato» e basta manda a cercare un permesso
    // mancante, mentre qui la risposta è che quella scheda non è dello studio.
    expect(negato.json().errore).toContain('19-infra-deploy');
    expect(negato.body).not.toContain('docker-compose');

    const concesso = await server().inject({ method: 'GET', url: '/manuale/19-infra-deploy', headers: auth('super_admin') });
    expect(concesso.statusCode).toBe(200);
    expect(concesso.json().riservata).toBe(true);
  });

  it('una scheda che non esiste è 404, e lo dice per nome', async () => {
    const res = await server().inject({ method: 'GET', url: '/manuale/99-inventata', headers: auth() });
    expect(res.statusCode).toBe(404);
    expect(res.json().errore).toContain('99-inventata');
  });

  it('uno slug ostile è 404, non 500: la regex ferma prima del filesystem', async () => {
    // `%2F` decodificato darebbe `../../.env`, che esiste davvero: è l'unico caso di questi in cui
    // «404» e «il file non c'è» non coincidono, ed è quello che conta.
    for (const url of [
      '/manuale/..%2F..%2F.env',
      '/manuale/05-fatture-sdi.md',
      '/manuale/05-Fatture',
      '/manuale/..',
    ]) {
      const res = await server().inject({ method: 'GET', url, headers: auth() });
      expect(res.statusCode, url).toBe(404);
      expect(res.body, url).not.toContain('DATABASE_URL');
    }
  });

  it('senza token è 401 anche per una scheda che esiste', async () => {
    const res = await server().inject({ method: 'GET', url: '/manuale/05-fatture-sdi' });
    expect(res.statusCode).toBe(401);
  });
});
