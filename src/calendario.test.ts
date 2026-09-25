/**
 * Il calendario: chi vede cosa, e da dove vengono le date.
 *
 * Due criteri di accettazione di §1ter.8 vivono in questo file, e sono i due che valgono davvero:
 *
 * 1. `?categorie=fattura` con ruolo `collaboratore_esterno` restituisce `[]` — e il test **accanto**
 *    asserisce che le stesse rate con un advisor dentro, altrimenti non si sta provando la
 *    visibilità ma l'assenza di dati. Un filtro che nasconde tutto passa il primo test e fallisce
 *    il secondo, ed è la ragione per cui i due stanno insieme.
 * 2. Nessun evento porta una data che il database non contiene: la rata mostra
 *    `scadenza_incasso.data_scadenza` e il progetto mostra `progetto.data_scadenza`. Il test della
 *    rata è costruito apposta perché la fattura abbia una `dataEmissione` **diversa e lontana**:
 *    è l'errore che la pagina commetteva (leggeva l'emissione invece della scadenza), e con le due
 *    date uguali il test non lo distinguerebbe.
 *
 * Il Prisma è finto e **stateful**: gli array in cima sono il database, e i test li riempiono. Un
 * finto che risponde sempre lo stesso oggetto non saprebbe distinguere «filtrato per ruolo» da
 * «filtrato per accesso», che è esattamente la differenza in prova.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const TENANT = '00000000-0000-0000-0000-000000000001';
const ALTRO_TENANT = '00000000-0000-0000-0000-000000000002';

/** L'istante fisso in cui i test credono di vivere. Settembre 2026, come la sessione. */
const ADESSO = new Date('2026-09-17T10:00:00.000Z');

interface StatoFinto {
  eventi: any[];
  accessi: any[];
  rate: any[];
  clienti: any[];
  progetti: any[];
  contratti: any[];
  permessi: any[];
  /** Le micro-voci esistenti, per la validazione di `microvoceProgettoId` in creazione. */
  microvoci: any[];
  // Registri: cosa il server ha scritto davvero.
  creati: any[];
  aggiornati: any[];
  cancellati: any[];
  intervalliChiesti: any[];
  /** Le scritture su `microvoce_progetto`: l'assegnazione di un compito pianificato (C5). */
  aggiornamentiMicrovoce: any[];
}

const stato: StatoFinto = {
  eventi: [], accessi: [], rate: [], clienti: [], progetti: [], contratti: [], permessi: [], microvoci: [],
  creati: [], aggiornati: [], cancellati: [], intervalliChiesti: [], aggiornamentiMicrovoce: [],
};

/**
 * Applica un `where` minimale ma fedele: uguaglianza, `in`, `not`, i confronti sulle date, gli
 * alberi `OR`/`AND`/`NOT` e i `where` annidati sulle relazioni.
 *
 * Gli ultimi due servono dal §1ter.5 (B5): il filtro per progetto cerca un evento per tre strade —
 * `progettoId`, `moduloProgetto.progettoId`, `microvoceProgetto.moduloProgetto.progettoId` — e sono
 * un `OR` di tre condizioni, due delle quali annidate. Un finto che le ignorasse risponderebbe
 * «nessuna riga» a tutte e tre, e il test del filtro passerebbe per il motivo sbagliato: non
 * perché il filtro è giusto, ma perché il finto non sa leggere un `where` che non conosce.
 */
function corrisponde(riga: any, where: any): boolean {
  if (!where) return true;

  // Gli operatori che una condizione può portare. Serve a distinguere `{ progettoId: 'x' }` — un
  // `where` annidato sulla relazione — da `{ gte: data }`, che è un confronto sul campo stesso.
  const OPERATORI = ['in', 'not', 'gte', 'lte', 'lt', 'gt', 'equals', 'contains', 'startsWith', 'mode'];

  return Object.entries(where).every(([campo, condizione]) => {
    if (campo === 'OR') return (condizione as any[]).some((c) => corrisponde(riga, c));
    if (campo === 'AND') return (condizione as any[]).every((c) => corrisponde(riga, c));
    if (campo === 'NOT') return !corrisponde(riga, condizione);

    const valore = riga[campo];
    if (condizione === null) return valore === null;
    if (typeof condizione !== 'object' || condizione instanceof Date) return valore === condizione;
    const c = condizione as any;
    if ('in' in c) return c.in.includes(valore);
    if ('not' in c) return valore !== c.not;
    if ('gte' in c && !(valore >= c.gte)) return false;
    if ('lte' in c && !(valore <= c.lte)) return false;
    if ('lt' in c && !(valore < c.lt)) return false;
    if ('gt' in c && !(valore > c.gt)) return false;
    if (Object.keys(c).some((k) => OPERATORI.includes(k))) return true;

    // Nessun operatore: è un `where` su una relazione. Una relazione assente non soddisfa nessuna
    // condizione — è il caso di un evento senza modulo, che non appartiene a nessun progetto.
    if (valore === null || valore === undefined) return false;
    return corrisponde(valore, c);
  });
}

/** Proietta una riga secondo il `select`, e risolve le relazioni annidate. */
function proietta(riga: any, select: any): any {
  if (!riga) return null;
  if (!select) return riga;
  const fuori: any = {};
  for (const [campo, scelta] of Object.entries(select)) {
    if (scelta === true) {
      fuori[campo] = riga[campo];
    } else if (scelta && typeof scelta === 'object') {
      const annidato = riga[campo];
      const sotto = (scelta as any).select;
      fuori[campo] = Array.isArray(annidato)
        ? annidato.map((r) => proietta(r, sotto))
        : proietta(annidato ?? null, sotto);
    }
  }
  return fuori;
}

/**
 * Il compito da cui un evento nasce, con la sua `risorsa` risolta come farebbe Prisma.
 *
 * Serve dal 18/09/2026 (C5 di §1ter.6): l'assegnatario di un evento `microvoce` non si legge più
 * dalla colonna dell'evento ma da `microvoce_progetto.risorsa_id`, quindi il finto deve saper
 * annidare la relazione — se restasse `null`, `assegnatarioDiEvento` risponderebbe `null` per ogni
 * compito e i test della nuova regola passerebbero per il motivo sbagliato.
 */
function compitoDi(id: string | null, select: any): any {
  if (!id) return null;
  const mv = stato.microvoci.find((m) => m.id === id);
  if (!mv) return null;
  const fuori = proietta(mv, select) ?? {};
  if (select?.risorsa) {
    fuori.risorsa = proietta(IDENTITA[mv.risorsaId] ?? null, select.risorsa.select);
  }
  return fuori;
}

/**
 * Una riga di `evento_calendario` con le relazioni che il `select` ha chiesto, come farebbe Prisma.
 *
 * Una funzione sola per `findMany` e `findFirst`: erano due, e la seconda risolveva solo le colonne.
 * Finché la differenza non si vedeva andava bene; da C5 `PATCH /:id/stato` legge una relazione con
 * un `findFirst`, e due implementazioni della stessa cosa sono esattamente il difetto che C5 chiude.
 */
function conRelazioni(r: any, select: any): any {
  return {
    ...proietta(r, select),
    ...(select?.assegnatoA ? { assegnatoA: proietta(IDENTITA[r.assegnatoAId] ?? null, select.assegnatoA.select) } : {}),
    ...(select?.cliente ? { cliente: proietta(stato.clienti.find((c) => c.id === r.clienteId) ?? null, select.cliente.select) } : {}),
    ...(select?.moduloProgetto ? { moduloProgetto: r.moduloProgetto ?? null } : {}),
    // Il compito, per l'assegnatario: vedi `compitoDi` e `assegnatarioDiEvento`.
    ...(select?.microvoceProgetto
      ? { microvoceProgetto: compitoDi(r.microvoceProgettoId, select.microvoceProgetto.select) }
      : {}),
  };
}

/** Le identità che il finto riconosce: la stessa forma usata dagli altri test di rotta. */
const IDENTITA: Record<string, any> = {
  'usr-advisor': { id: 'usr-advisor', tenantId: TENANT, ruolo: 'advisor', stato: 'attivo', sessionVersion: 0, nome: 'Anna Advisor', email: 'anna@studio.example' },
  'usr-interno': { id: 'usr-interno', tenantId: TENANT, ruolo: 'collaboratore_interno', stato: 'attivo', sessionVersion: 0, nome: 'Ivan Interno', email: 'ivan@studio.example' },
  'usr-esterno': { id: 'usr-esterno', tenantId: TENANT, ruolo: 'collaboratore_esterno', stato: 'attivo', sessionVersion: 0, nome: 'Elsa Esterna', email: 'elsa@esterno.example' },
  'usr-super': { id: 'usr-super', tenantId: null, ruolo: 'super_admin', stato: 'attivo', sessionVersion: 0, nome: 'Sara Super', email: 'sara@bluman.example' },
};

vi.mock('./util/prismaClient.js', async (importOriginal) => {
  const reale = await importOriginal<typeof import('./util/prismaClient.js')>();

  const finto: any = {
    user: {
      findFirst: async (args: any) => {
        // Due usi distinti dello stesso modello, e la forma del `select` li separa: l'hook di
        // autenticazione chiede ruolo/stato/sessionVersion, la validazione dell'assegnatario
        // chiede solo l'id. Distinguerli sul `select` è più onesto che contare le chiamate.
        if (args?.select?.ruolo) {
          const u = IDENTITA[args?.where?.id];
          if (!u) return null;
          if (args.where.tenantId !== undefined && args.where.tenantId !== u.tenantId) return null;
          return proietta(u, args.select);
        }
        const u = IDENTITA[args?.where?.id];
        if (!u) return null;
        // L'assegnatario deve essere dello **stesso studio**: un super_admin (tenantId null) non
        // appartiene a nessuno studio e non è assegnabile dall'interno di uno.
        if (args?.where?.tenantId && u.tenantId !== args.where.tenantId) return null;
        return proietta(u, args.select);
      },
    },
    cliente: {
      // Un solo `findFirst` per due usi: l'hook di autenticazione chiede `sessionVersion` per il
      // JWT del portale, e la rotta chiede l'id per validare un `clienteId` in ingresso. La forma
      // del `where` è la stessa, quindi il finto non ha bisogno di distinguerli.
      findFirst: async (args: any) =>
        proietta(stato.clienti.find((c) => corrisponde(c, args?.where)) ?? null, args.select),
      findMany: async (args: any) =>
        stato.clienti.filter((c) => corrisponde(c, args?.where)).map((c) => proietta(c, args.select)),
    },
    // Le micro-voci: servono solo a validare il compito da cui nasce un evento (§1ter.5 B6).
    // `microvoce_progetto` porta il `tenant_id` in colonna, quindi il `where` è un confronto
    // diretto e `corrisponde` lo applica già.
    microvoceProgetto: {
      findFirst: async (args: any) =>
        proietta(stato.microvoci.find((m) => corrisponde(m, args?.where)) ?? null, args.select),
      // C5 (§1ter.6): pianificare un compito dal calendario ne scrive l'assegnatario sulla
      // micro-voce. Il finto registra la scrittura, così il test può leggerla.
      updateMany: async (args: any) => {
        stato.aggiornamentiMicrovoce.push(args);
        const toccate = stato.microvoci.filter((m) => corrisponde(m, args?.where));
        for (const m of toccate) Object.assign(m, args.data);
        return { count: toccate.length };
      },
    },
    eventoCalendario: {
      findMany: async (args: any) =>
        stato.eventi.filter((e) => corrisponde(e, args?.where)).map((r) => conRelazioni(r, args?.select)),
      // `findFirst` risolve le stesse relazioni di `findMany`, e da C5 è obbligatorio che lo
      // faccia: l'autorizzazione di `PATCH /:id/stato` chiede `microvoceProgetto.risorsaId` con un
      // `findFirst`, quindi un finto che annidasse la relazione solo in `findMany` farebbe
      // rispondere 404 a un assegnatario legittimo — cioè il test fallirebbe per il motivo per cui
      // esiste, ma indicando la funzione sbagliata.
      findFirst: async (args: any) => {
        const riga = stato.eventi.find((e) => corrisponde(e, args?.where));
        return riga ? conRelazioni(riga, args?.select) : null;
      },
      create: async (args: any) => {
        const riga = { id: `ev-nuovo-${stato.eventi.length + 1}`, ...args.data };
        stato.creati.push(args);
        stato.eventi.push(riga);
        return proietta(riga, args.select);
      },
      updateMany: async (args: any) => {
        const toccate = stato.eventi.filter((e) => corrisponde(e, args?.where));
        for (const e of toccate) Object.assign(e, args.data);
        stato.aggiornati.push(args);
        return { count: toccate.length };
      },
      deleteMany: async (args: any) => {
        const prima = stato.eventi.length;
        const rimaste = stato.eventi.filter((e) => !corrisponde(e, args?.where));
        stato.eventi.length = 0;
        stato.eventi.push(...rimaste);
        stato.cancellati.push(args);
        return { count: prima - rimaste.length };
      },
    },
    accessoRisorsa: {
      findMany: async (args: any) =>
        stato.accessi
          .filter((a) => a.userId === args?.where?.userId && a.tenantId === args?.where?.tenantId)
          .map((a) => proietta(a, args?.select)),
    },
    scadenzaIncasso: {
      findMany: async (args: any) => {
        const righe = stato.rate.filter((r) => corrisponde(r, args?.where));
        stato.intervalliChiesti.push({ modello: 'scadenzaIncasso', where: args?.where });
        return righe.map((r) => ({ ...proietta(r, args?.select), fattura: r.fattura }));
      },
    },
    progetto: {
      findMany: async (args: any) => {
        const righe = stato.progetti.filter((p) => corrisponde(p, args?.where));
        return righe.map((p) => ({ ...proietta(p, args?.select), cliente: stato.clienti.find((c) => c.id === p.clienteId) ?? null }));
      },
      findFirst: async (args: any) =>
        proietta(stato.progetti.find((p) => p.id === args?.where?.id && p.tenantId === args?.where?.tenantId) ?? null, args.select),
    },
    contrattoRicorrente: {
      findMany: async (args: any) => {
        const righe = stato.contratti.filter((c) => corrisponde(c, args?.where));
        return righe.map((c) => ({ ...proietta(c, args?.select), cliente: stato.clienti.find((cl) => cl.id === c.clienteId) ?? null }));
      },
    },
    // K7: le revisioni KYC derivate leggono i fascicoli approvati/in revisione. Vuoto di default:
    // i test del calendario non allestiscono fascicoli, quindi nessun evento `kyc-revisione`.
    fascicoloKyc: {
      findMany: async () => [],
    },
    permessoModulo: {
      findUnique: async (args: any) => {
        const chiave = args?.where?.tenantId_userId_moduloChiave;
        const trovato = stato.permessi.find(
          (p) => p.tenantId === chiave?.tenantId && p.userId === chiave?.userId && p.moduloChiave === chiave?.moduloChiave,
        );
        return proietta(trovato ?? null, args.select);
      },
    },
  };

  const amministrativo: any = {
    user: { findUnique: async () => null },
    auditLog: { create: async (args: any) => ({ id: 'audit-1', ...args.data }) },
    $disconnect: async () => undefined,
  };

  return { ...reale, prisma: finto, prismaAmministrativo: () => amministrativo };
});

const { buildServer } = await import('./server.js');
const { InMemoryApp } = await import('./adapters/inMemoryApp.js');
const { signJwt } = await import('./util/jwt.js');
const { ROTTE_CLIENTE_CONSENTITE } = await import('./util/authorization.js');

function tokenPer(userId: string) {
  const u = IDENTITA[userId]!;
  return signJwt({
    userId,
    tenantId: u.tenantId ?? TENANT,
    email: u.email,
    ruolo: u.ruolo,
    sessionVersion: 0,
  });
}

function tokenCliente() {
  return signJwt({ userId: 'client-cli-42', tenantId: TENANT, email: 'cliente@example.test', ruolo: 'cliente', sessionVersion: 0 });
}

async function serverCon(token?: string) {
  const server = buildServer(new InMemoryApp());
  const injectOriginale = server.inject.bind(server);
  (server as any).inject = (opts: any) =>
    injectOriginale({
      ...opts,
      headers: { ...(token ? { authorization: `Bearer ${token}` } : {}), ...(opts?.headers || {}) },
    });
  return server;
}

/** Un evento di tabella, con i soli campi che contano. */
function evento(overrides: Record<string, unknown> = {}) {
  return {
    id: 'ev-1',
    tenantId: TENANT,
    userId: 'usr-advisor',
    assegnatoAId: null,
    progettoId: null,
    clienteId: null,
    moduloProgettoId: null,
    microvoceProgettoId: null,
    moduloProgetto: null,
    microvoceProgetto: null,
    titolo: 'Chiamata con il cliente',
    dataInizio: new Date('2026-09-15T09:00:00.000Z'),
    dataFine: new Date('2026-09-15T10:00:00.000Z'),
    categoria: 'promemoria',
    stato: 'da_fare',
    priorita: 'normale',
    note: null,
    luogoUrl: null,
    generato: false,
    ...overrides,
  };
}

/** Una rata in attesa. La fattura ha una `dataEmissione` **lontana** dalla scadenza, apposta. */
function rata(overrides: Record<string, unknown> = {}) {
  return {
    id: 'rat-1',
    tenantId: TENANT,
    numeroRata: 2,
    importoCentesimi: 122_000,
    dataScadenza: new Date('2026-09-25T00:00:00.000Z'),
    stato: 'in_attesa',
    fattura: {
      id: 'fat-1',
      numero: 'FT-2026/014',
      // Emessa il 1° settembre, dovuta il 25: quindici giorni di distanza, che è la differenza
      // fra `dataEmissione` e `dataScadenza` che il test deve poter vedere.
      dataEmissione: new Date('2026-09-10T00:00:00.000Z'),
      data: new Date('2026-09-10T00:00:00.000Z'),
      clienteId: 'cli-1',
      progettoId: 'prg-1',
      cliente: { nome: 'Holding Beta S.r.l.' },
    },
    ...overrides,
  };
}

beforeEach(() => {
  stato.eventi = [];
  stato.accessi = [];
  stato.rate = [];
  stato.clienti = [];
  stato.progetti = [];
  stato.contratti = [];
  stato.permessi = [];
  stato.microvoci = [{ id: 'mv-1', tenantId: TENANT }, { id: 'mv-altro', tenantId: ALTRO_TENANT }];
  stato.creati = [];
  stato.aggiornati = [];
  stato.cancellati = [];
  stato.intervalliChiesti = [];
  stato.aggiornamentiMicrovoce = [];
  // Solo `Date`, non tutti i timer. `vi.useFakeTimers()` da solo sostituisce anche `setTimeout` e
  // `setInterval`, e Fastify ne usa: il server si costruisce dentro il test, e con i timer finti la
  // prima `inject` non torna più. Qui serve una cosa sola — che `new Date()` dentro la rotta dia
  // l'istante che i test si aspettano — e `toFake: ['Date']` è esattamente quella cosa.
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(ADESSO);
});

afterEach(() => {
  vi.useRealTimers();
});

describe('l\'accesso alle rotte del calendario', () => {
  it('senza token risponde 401', async () => {
    const server = await serverCon();
    const res = await server.inject({ method: 'GET', url: '/calendario/eventi' });
    expect(res.statusCode).toBe(401);
  });

  it('il portale cliente non entra nel calendario dello studio', async () => {
    // Il JWT del portale porta `userId: 'client-<idCliente>'`, e l'hook scarta il token se il
    // cliente non esiste ancora o ha una `sessionVersion` diversa: senza questa riga la risposta
    // sarebbe 401 — «non autenticato» — e il test proverebbe la cosa sbagliata.
    stato.clienti = [{ id: 'cli-42', tenantId: TENANT, sessionVersion: 0 }];
    const server = await serverCon(tokenCliente());
    const res = await server.inject({ method: 'GET', url: '/calendario/eventi' });
    expect(res.statusCode).toBe(403);
    expect(res.json().errore).toBe('Non autorizzato per il portale cliente.');
  });

  it('/calendario non è fra le rotte consentite al cliente, e non deve diventarlo', async () => {
    // Questo test è la ragione per cui il 403 qui sopra è una seconda rete e non l'unica: se un
    // domani qualcuno aggiungesse la rotta all'elenco, il calendario si aprirebbe al portale di
    // tutti i clienti dello studio — nomi, importi e scadenze di ognuno. La matrice ruolo ×
    // categoria in `calendarioVisibilita.test.ts` resterebbe comunque a zeri per il ruolo
    // `cliente`, quindi il guasto sarebbe contenuto; ma è molto meglio non farlo.
    expect(ROTTE_CLIENTE_CONSENTITE.has('GET /calendario/eventi')).toBe(false);
    expect([...ROTTE_CLIENTE_CONSENTITE].filter((r) => r.includes('calendario'))).toEqual([]);
  });
});

describe('le rate: chi le vede, e da quale data', () => {
  it('un collaboratore esterno che chiede le fatture riceve un insieme vuoto', async () => {
    stato.rate = [rata()];
    const server = await serverCon(tokenPer('usr-esterno'));
    const res = await server.inject({ method: 'GET', url: '/calendario/eventi?categorie=fattura' });

    expect(res.statusCode).toBe(200);
    expect(res.json().eventi).toEqual([]);
    // E la risposta dice anche perché: `categorie` elenca ciò che quel ruolo può chiedere, quindi
    // l'interfaccia può non offrire un filtro che non restituirebbe mai niente.
    expect(res.json().categorie).not.toContain('fattura');
  });

  it('le stesse rate, chieste da un advisor, ci sono — è la visibilità, non l\'assenza di dati', async () => {
    stato.rate = [rata()];
    const server = await serverCon(tokenPer('usr-advisor'));
    const res = await server.inject({ method: 'GET', url: '/calendario/eventi?categorie=fattura' });

    const eventi = res.json().eventi;
    expect(eventi).toHaveLength(1);
    expect(eventi[0].id).toBe('fattura:rat-1');
    expect(eventi[0].categoria).toBe('fattura');
    expect(eventi[0].importoCentesimi).toBe(122_000);
  });

  it('la data dell\'evento è la scadenza della rata, non la data di emissione della fattura', async () => {
    // L'errore che questo test presidia: `CalendarPage.tsx` leggeva `inv.dataEmissione`. La
    // fattura qui è emessa il 10 e scade il 25 — se qualcuno tornasse a leggere l'emissione,
    // l'evento comparirebbe il 10 e questo `expect` fallirebbe.
    stato.rate = [rata()];
    const server = await serverCon(tokenPer('usr-advisor'));
    const res = await server.inject({ method: 'GET', url: '/calendario/eventi?categorie=fattura' });

    const quando = new Date(res.json().eventi[0].dataInizio);
    expect(quando.toISOString().slice(0, 10)).toBe('2026-09-25');
    expect(quando.toISOString().slice(0, 10)).not.toBe('2026-09-10');
  });

  it('una rata già incassata non è più una scadenza', async () => {
    // Il finto rispetta il `where`, quindi questo test prova che il filtro `stato: 'in_attesa'`
    // esiste: senza, la rata incassata comparirebbe come cosa da fare.
    stato.rate = [rata({ stato: 'incassato' })];
    const server = await serverCon(tokenPer('usr-advisor'));
    const res = await server.inject({ method: 'GET', url: '/calendario/eventi?categorie=fattura' });
    expect(res.json().eventi).toEqual([]);
  });

  it('un collaboratore interno con lo scadenzario negato non vede le rate', async () => {
    // È l'unico caso in cui la matrice permessi decide il calendario: `/calendario` non è in
    // `ROTTE_MODULO`, quindi il guard globale non lo tocca, e la lettura di `permesso_modulo`
    // dentro il servizio è l'unica cosa che tiene la regola «un evento eredita la visibilità
    // della sua sorgente» vera anche per la matrice e non solo per il ruolo.
    stato.rate = [rata()];
    stato.permessi = [{ tenantId: TENANT, userId: 'usr-interno', moduloChiave: 'scadenzario', livello: 'denied' }];
    const server = await serverCon(tokenPer('usr-interno'));
    const res = await server.inject({ method: 'GET', url: '/calendario/eventi?categorie=fattura' });

    expect(res.json().eventi).toEqual([]);
    expect(res.json().categorie).not.toContain('fattura');
  });
});

describe('il filtro per progetto: lo scadenzario dentro il fascicolo', () => {
  it('un evento del progetto si vede, uno di un altro progetto no', async () => {
    stato.eventi = [
      evento({ id: 'ev-mio', titolo: 'Deposito statuto', progettoId: 'prg-1' }),
      evento({ id: 'ev-altrui', titolo: 'Pratica di un altro incarico', progettoId: 'prg-2' }),
    ];
    const server = await serverCon(tokenPer('usr-advisor'));
    const res = await server.inject({ method: 'GET', url: '/calendario/eventi?progettoId=prg-1' });

    expect(res.json().eventi.map((e: any) => e.id)).toEqual(['ev-mio']);
  });

  it('un evento agganciato a un modulo del progetto appartiene al progetto', async () => {
    // La strada indiretta. Un evento creato dal modulo può non avere `progettoId` in colonna: se il
    // filtro guardasse solo quella, la scheda del fascicolo mostrerebbe un elenco vuoto proprio per
    // le attività pianificate dal fascicolo — che sono quelle che la scheda esiste per mostrare.
    //
    // L'esca è l'evento del modulo di un **altro** progetto: senza di essa il test passerebbe anche
    // con il filtro rimosso, perché l'evento cercato sarebbe restituito comunque.
    stato.eventi = [
      evento({ id: 'ev-modulo', progettoId: null, moduloProgettoId: 'mod-1', moduloProgetto: { progettoId: 'prg-1' } }),
      evento({ id: 'ev-modulo-altrui', progettoId: null, moduloProgettoId: 'mod-9', moduloProgetto: { progettoId: 'prg-9' } }),
    ];
    const server = await serverCon(tokenPer('usr-advisor'));
    const res = await server.inject({ method: 'GET', url: '/calendario/eventi?progettoId=prg-1' });

    expect(res.json().eventi.map((e: any) => e.id)).toEqual(['ev-modulo']);
  });

  it('un evento agganciato a una micro-voce del progetto appartiene al progetto', async () => {
    // La terza strada, ed è quella che percorre il pulsante «programma scadenza» del fascicolo:
    // manda `microvoceProgettoId` e nient'altro, quindi né `progettoId` né `moduloProgettoId`
    // sono valorizzati.
    stato.eventi = [
      evento({
        id: 'ev-microvoce',
        progettoId: null,
        moduloProgettoId: null,
        microvoceProgettoId: 'mv-1',
        microvoceProgetto: { moduloProgetto: { progettoId: 'prg-1' } },
      }),
      evento({
        id: 'ev-microvoce-altrui',
        progettoId: null,
        moduloProgettoId: null,
        microvoceProgettoId: 'mv-9',
        microvoceProgetto: { moduloProgetto: { progettoId: 'prg-9' } },
      }),
    ];
    const server = await serverCon(tokenPer('usr-advisor'));
    const res = await server.inject({ method: 'GET', url: '/calendario/eventi?progettoId=prg-1' });

    expect(res.json().eventi.map((e: any) => e.id)).toEqual(['ev-microvoce']);
  });

  it('un evento senza progetto non entra nello scadenzario di un progetto', async () => {
    // Il caso che rende il filtro una restrizione e non un permesso: un promemoria di studio senza
    // riferimenti non appartiene a nessun incarico, e mostrarlo in ognuno lo moltiplicherebbe.
    stato.eventi = [evento({ id: 'ev-sciolto', progettoId: null, titolo: 'Riunione di studio' })];
    const server = await serverCon(tokenPer('usr-advisor'));
    const res = await server.inject({ method: 'GET', url: '/calendario/eventi?progettoId=prg-1' });

    expect(res.json().eventi).toEqual([]);
  });

  it('senza il parametro si vede tutto: il filtro restringe, non è un permesso', async () => {
    stato.eventi = [
      evento({ id: 'ev-1', progettoId: 'prg-1' }),
      evento({ id: 'ev-2', progettoId: 'prg-2' }),
      evento({ id: 'ev-3', progettoId: null }),
    ];
    const server = await serverCon(tokenPer('usr-advisor'));
    const res = await server.inject({ method: 'GET', url: '/calendario/eventi' });

    expect(res.json().eventi.map((e: any) => e.id).sort()).toEqual(['ev-1', 'ev-2', 'ev-3']);
  });

  it('la rata di una fattura del progetto è una scadenza del progetto, quella di un\'altra no', async () => {
    stato.rate = [
      rata({ id: 'rat-mia', fattura: { ...rata().fattura, progettoId: 'prg-1' } }),
      rata({ id: 'rat-altrui', fattura: { ...rata().fattura, id: 'fat-2', progettoId: 'prg-2' } }),
    ];
    const server = await serverCon(tokenPer('usr-advisor'));
    const res = await server.inject({ method: 'GET', url: '/calendario/eventi?categorie=fattura&progettoId=prg-1' });

    expect(res.json().eventi.map((e: any) => e.origineId)).toEqual(['rat-mia']);
  });

  it('il rinnovo KYC resta fuori dallo scadenzario di un incarico', async () => {
    // Il KYC è del **cliente**, non del progetto: un cliente con tre incarichi aperti ha un solo
    // rinnovo, e mostrarlo in tutte e tre le schede lo moltiplicherebbe invece di riportarlo.
    stato.clienti = [{ id: 'cli-1', tenantId: TENANT, nome: 'Holding Beta S.r.l.', dataKyc: '2025-09-20' }];
    // Un evento del progetto c'è, così il test non si accontenta di un elenco vuoto che potrebbe
    // venire da un filtro rotto che scarta tutto. E c'è la riga di accesso, perché un
    // collaboratore interno non vede i progetti per ruolo: senza, l'evento sarebbe invisibile per
    // la visibilità e il test proverebbe quella invece del filtro.
    // `userId` è quello di chi chiede: un promemoria è di chi l'ha scritto, e un collaboratore
    // interno non vede quello di un collega. Senza, l'evento sarebbe invisibile per la proprietà e
    // il test proverebbe quella invece del filtro di progetto.
    stato.eventi = [evento({ id: 'ev-mio', userId: 'usr-interno', progettoId: 'prg-1', titolo: 'Deposito statuto' })];
    stato.accessi = [{ id: 'acc-1', tenantId: TENANT, userId: 'usr-interno', progettoId: 'prg-1', moduloProgettoId: null, microvoceProgettoId: null, moduloProgetto: null, microvoceProgetto: null }];
    const server = await serverCon(tokenPer('usr-interno'));

    const senzaFiltro = await server.inject({ method: 'GET', url: '/calendario/eventi?categorie=kyc,promemoria' });
    expect(senzaFiltro.json().eventi.map((e: any) => e.categoria).sort()).toEqual(['kyc', 'promemoria']);

    const conFiltro = await server.inject({ method: 'GET', url: '/calendario/eventi?categorie=kyc,promemoria&progettoId=prg-1' });
    expect(conFiltro.json().eventi.map((e: any) => e.id)).toEqual(['ev-mio']);
  });

  it('il progetto di un altro studio non fa vedere niente', async () => {
    // L'appartenenza allo studio la filtra già il `tenantId`, che il servizio applica sempre: qui si
    // verifica che il filtro di progetto non sia una porta che scavalca quella condizione.
    stato.eventi = [evento({ id: 'ev-altro-studio', tenantId: ALTRO_TENANT, progettoId: 'prg-1' })];
    const server = await serverCon(tokenPer('usr-advisor'));
    const res = await server.inject({ method: 'GET', url: '/calendario/eventi?progettoId=prg-1' });

    expect(res.json().eventi).toEqual([]);
  });

  it('delle scadenze di fine progetto resta solo quella dell\'incarico chiesto', async () => {
    // Le sorgenti derivate hanno il loro filtro, e va provato separatamente: sono quattro query
    // diverse, e il `progettoId` non passa per la stessa riga di codice in tutte.
    stato.clienti = [{ id: 'cli-1', tenantId: TENANT, nome: 'Holding Beta S.r.l.' }];
    stato.progetti = [
      { id: 'prg-1', tenantId: TENANT, nome: 'Ristrutturazione Beta', clienteId: 'cli-1', stato: 'in_progress', dataScadenza: new Date('2026-09-30T00:00:00.000Z') },
      { id: 'prg-2', tenantId: TENANT, nome: 'Un altro incarico', clienteId: 'cli-1', stato: 'in_progress', dataScadenza: new Date('2026-09-28T00:00:00.000Z') },
    ];
    const server = await serverCon(tokenPer('usr-advisor'));
    const res = await server.inject({ method: 'GET', url: '/calendario/eventi?categorie=progetto&progettoId=prg-1' });

    expect(res.json().eventi.map((e: any) => e.origineId)).toEqual(['prg-1']);
  });

  it('dei rinnovi contrattuali resta solo quello legato all\'incarico chiesto', async () => {
    // `contratto_ricorrente.progetto_id` è facoltativo: un contratto senza progetto non è di nessun
    // incarico, e con il filtro attivo non deve comparire in ognuno.
    stato.clienti = [{ id: 'cli-1', tenantId: TENANT, nome: 'Holding Beta S.r.l.' }];
    const comune = { tenantId: TENANT, stato: 'attivo', clienteId: 'cli-1', prossimaFatturazione: new Date('2026-09-26T00:00:00.000Z') };
    stato.contratti = [
      { id: 'ctr-1', titolo: 'Contabilità annuale', progettoId: 'prg-1', ...comune },
      { id: 'ctr-2', titolo: 'Di un altro incarico', progettoId: 'prg-2', ...comune },
      { id: 'ctr-3', titolo: 'Senza progetto', progettoId: null, ...comune },
    ];
    const server = await serverCon(tokenPer('usr-advisor'));
    const res = await server.inject({ method: 'GET', url: '/calendario/eventi?categorie=contratto&progettoId=prg-1' });

    expect(res.json().eventi.map((e: any) => e.origineId)).toEqual(['ctr-1']);
  });
});

describe('i rinnovi KYC', () => {
  it('compaiono per i ruoli interni e non per il collaboratore esterno', async () => {
    // Fatto il 20/09/2025, quindi il rinnovo cade il 20/09/2026: tre giorni dopo «oggi», dentro
    // la finestra di preavviso di trenta giorni.
    stato.clienti = [{ id: 'cli-1', tenantId: TENANT, nome: 'Holding Beta S.r.l.', dataKyc: '2025-09-20' }];

    const interno = await (await serverCon(tokenPer('usr-interno'))).inject({ method: 'GET', url: '/calendario/eventi?categorie=kyc' });
    expect(interno.json().eventi).toHaveLength(1);
    expect(interno.json().eventi[0].titolo).toBe('Rinnovo KYC');
    expect(interno.json().eventi[0].dataInizio.slice(0, 10)).toBe('2026-09-20');

    const esterno = await (await serverCon(tokenPer('usr-esterno'))).inject({ method: 'GET', url: '/calendario/eventi?categorie=kyc' });
    expect(esterno.json().eventi).toEqual([]);
  });

  it('un KYC mai fatto non è un KYC scaduto', async () => {
    // **Misurato in produzione il 17/09/2026**: `cliente.data_kyc` contiene la stringa vuota, non
    // `NULL`, sui clienti che non hanno mai fatto la verifica — due su due. `''` supera
    // `IS NOT NULL`, quindi il filtro SQL non basta a escluderli e la decisione cade su `adData`.
    //
    // Questo test fissa il comportamento, non dimostra una trappola: la catena è difesa due volte
    // (`adData` riduce `''` a `null`, e il chiamante salta i rinnovi nulli), quindi allentarne una
    // sola non basta a romperla. Serve a che allentarne **due** si veda, invece di produrre in
    // silenzio un rinnovo KYC per ogni cliente che non l'ha mai fatto.
    stato.clienti = [
      { id: 'cli-vuoto', tenantId: TENANT, nome: 'Mai Verificato S.r.l.', dataKyc: '' },
      { id: 'cli-null', tenantId: TENANT, nome: 'Senza Data S.r.l.', dataKyc: null },
    ];
    const server = await serverCon(tokenPer('usr-interno'));
    const res = await server.inject({ method: 'GET', url: '/calendario/eventi?categorie=kyc' });
    expect(res.json().eventi).toEqual([]);
  });

  it('un rinnovo lontano non entra nella finestra di preavviso', async () => {
    // Fatto il 1° gennaio 2026: il rinnovo è il 1° gennaio 2027, fuori dalla finestra di trenta
    // giorni e fuori dal mese chiesto. Il cron non manderebbe l'avviso, e il calendario non deve
    // mostrare una cosa che nessuno sta per dover fare.
    stato.clienti = [{ id: 'cli-1', tenantId: TENANT, nome: 'Holding Beta S.r.l.', dataKyc: '2026-01-01' }];
    const server = await serverCon(tokenPer('usr-interno'));
    const res = await server.inject({ method: 'GET', url: '/calendario/eventi?categorie=kyc' });
    expect(res.json().eventi).toEqual([]);
  });
});

describe('la fine di un progetto', () => {
  it('la data viene da progetto.dataScadenza, e un progetto chiuso non ha scadenze aperte', async () => {
    stato.clienti = [{ id: 'cli-1', tenantId: TENANT, nome: 'Holding Beta S.r.l.' }];
    stato.progetti = [
      { id: 'prg-1', tenantId: TENANT, nome: 'Ristrutturazione Beta', clienteId: 'cli-1', stato: 'in_progress', dataScadenza: new Date('2026-09-30T00:00:00.000Z') },
      { id: 'prg-2', tenantId: TENANT, nome: 'Pratica chiusa', clienteId: 'cli-1', stato: 'completed', dataScadenza: new Date('2026-09-20T00:00:00.000Z') },
      { id: 'prg-3', tenantId: TENANT, nome: 'Senza scadenza', clienteId: 'cli-1', stato: 'in_progress', dataScadenza: null },
    ];

    const server = await serverCon(tokenPer('usr-advisor'));
    const res = await server.inject({ method: 'GET', url: '/calendario/eventi?categorie=progetto' });
    const eventi = res.json().eventi;

    expect(eventi).toHaveLength(1);
    expect(eventi[0].id).toBe('progetto:prg-1');
    expect(eventi[0].dataInizio.slice(0, 10)).toBe('2026-09-30');
    expect(eventi[0].clienteNome).toBe('Holding Beta S.r.l.');
  });

  it('un collaboratore esterno vede solo i progetti su cui ha accesso', async () => {
    stato.progetti = [
      { id: 'prg-1', tenantId: TENANT, nome: 'Suo', clienteId: null, stato: 'in_progress', dataScadenza: new Date('2026-09-30T00:00:00.000Z') },
      { id: 'prg-2', tenantId: TENANT, nome: 'Non suo', clienteId: null, stato: 'in_progress', dataScadenza: new Date('2026-09-28T00:00:00.000Z') },
    ];
    stato.accessi = [{ id: 'acc-1', tenantId: TENANT, userId: 'usr-esterno', progettoId: 'prg-1', moduloProgettoId: null, microvoceProgettoId: null, moduloProgetto: null, microvoceProgetto: null }];

    const server = await serverCon(tokenPer('usr-esterno'));
    const res = await server.inject({ method: 'GET', url: '/calendario/eventi?categorie=progetto' });
    const ids = res.json().eventi.map((e: any) => e.id);
    expect(ids).toEqual(['progetto:prg-1']);
  });

  it('un accesso a una micro-voce copre anche il progetto che la contiene', async () => {
    // `microvoce_progetto` non ha un `progetto_id`: la risalita passa dal modulo. Se non si
    // risalisse, questa persona — che sta lavorando a una parte di quel progetto — non vedrebbe
    // la scadenza del progetto stesso.
    stato.progetti = [
      { id: 'prg-1', tenantId: TENANT, nome: 'Con micro-voce', clienteId: null, stato: 'in_progress', dataScadenza: new Date('2026-09-30T00:00:00.000Z') },
    ];
    stato.accessi = [
      {
        id: 'acc-1', tenantId: TENANT, userId: 'usr-esterno', progettoId: null, moduloProgettoId: null, microvoceProgettoId: 'mv-1',
        moduloProgetto: null,
        microvoceProgetto: { moduloProgettoId: 'mod-1', moduloProgetto: { progettoId: 'prg-1' } },
      },
    ];

    const server = await serverCon(tokenPer('usr-esterno'));
    const res = await server.inject({ method: 'GET', url: '/calendario/eventi?categorie=progetto' });
    expect(res.json().eventi.map((e: any) => e.id)).toEqual(['progetto:prg-1']);
  });
});

describe('i promemoria: solo i propri', () => {
  it('un collaboratore vede il proprio e non quello di un collega', async () => {
    stato.eventi = [
      evento({ id: 'ev-mio', userId: 'usr-esterno', titolo: 'Il mio' }),
      evento({ id: 'ev-altrui', userId: 'usr-advisor', titolo: 'Di un altro' }),
    ];

    const server = await serverCon(tokenPer('usr-esterno'));
    const res = await server.inject({ method: 'GET', url: '/calendario/eventi?categorie=promemoria' });
    const titoli = res.json().eventi.map((e: any) => e.titolo);
    expect(titoli).toEqual(['Il mio']);
  });

  it('la riga di un altro non si può leggere, modificare né cancellare: sempre 404', async () => {
    stato.eventi = [evento({ id: 'ev-altrui', userId: 'usr-advisor' })];
    const server = await serverCon(tokenPer('usr-esterno'));

    const put = await server.inject({ method: 'PUT', url: '/calendario/eventi/ev-altrui', payload: { titolo: 'Rubato' } });
    expect(put.statusCode).toBe(404);

    const patch = await server.inject({ method: 'PATCH', url: '/calendario/eventi/ev-altrui/stato', payload: { stato: 'fatto' } });
    expect(patch.statusCode).toBe(404);

    const del = await server.inject({ method: 'DELETE', url: '/calendario/eventi/ev-altrui' });
    expect(del.statusCode).toBe(404);

    // E nessuna delle tre ha toccato la riga.
    expect(stato.eventi[0].titolo).toBe('Chiamata con il cliente');
    expect(stato.aggiornati).toHaveLength(0);
    expect(stato.cancellati).toHaveLength(0);
  });

  it('«non tuo» e «non esiste» danno la stessa risposta, parola per parola', async () => {
    // Distinguerli direbbe a un collaboratore esterno che quell'id esiste nel suo studio. Le due
    // risposte devono essere indistinguibili, quindi si confrontano.
    stato.eventi = [evento({ id: 'ev-altrui', userId: 'usr-advisor' })];
    const server = await serverCon(tokenPer('usr-esterno'));

    const altrui = await server.inject({ method: 'PUT', url: '/calendario/eventi/ev-altrui', payload: { titolo: 'X' } });
    const inesistente = await server.inject({ method: 'PUT', url: '/calendario/eventi/ev-mai-esistito', payload: { titolo: 'X' } });

    expect(altrui.statusCode).toBe(inesistente.statusCode);
    expect(altrui.json()).toEqual(inesistente.json());
  });
});

describe('la creazione di un evento', () => {
  it('il proprietario è quello del token, non quello che il client manda nel corpo', async () => {
    // La regola 1 di §1ter.3: nessuna rotta accetta dal corpo un `userId` con cui decidere di chi
    // sono gli eventi. Qui il corpo ne manda uno, e deve essere ignorato.
    const server = await serverCon(tokenPer('usr-esterno'));
    const res = await server.inject({
      method: 'POST',
      url: '/calendario/eventi',
      payload: { titolo: 'Preparare il fascicolo', dataInizio: '2026-09-20', userId: 'usr-advisor', tenantId: ALTRO_TENANT },
    });

    expect(res.statusCode).toBe(201);
    expect(stato.creati).toHaveLength(1);
    expect(stato.creati[0].data.userId).toBe('usr-esterno');
    expect(stato.creati[0].data.tenantId).toBe(TENANT);
    expect(stato.creati[0].data.generato).toBe(false);
  });

  it('un evento derivato non si crea a mano', async () => {
    const server = await serverCon(tokenPer('usr-advisor'));
    // Tre categorie, non quattro: `microvoce` è uscita da questo elenco in §1ter.5 (B6) perché
    // **nessun generatore la produce** — le sorgenti derivate sono rate, KYC, progetti e
    // contratti — e un compito non ha una data da dedurre: la fissa una persona. Vedi
    // `CATEGORIE_SCRIVIBILI` e il test successivo, che ne fissa la condizione.
    for (const categoria of ['fattura', 'kyc', 'progetto']) {
      const res = await server.inject({
        method: 'POST',
        url: '/calendario/eventi',
        payload: { titolo: 'Inventato', dataInizio: '2026-09-20', categoria },
      });
      expect(res.statusCode, `categoria ${categoria}`).toBe(400);
    }
    expect(stato.creati).toHaveLength(0);
  });

  it('un evento «microvoce» si crea solo insieme al compito a cui appartiene', async () => {
    // Il caso che prima non esisteva: la scheda «⚡ Microvoci Progetto» del calendario non poteva
    // ricevere niente da nessuno. Ora può — ma non un compito di niente.
    const server = await serverCon(tokenPer('usr-advisor'));

    const senzaCompito = await server.inject({
      method: 'POST',
      url: '/calendario/eventi',
      payload: { titolo: 'Compito orfano', dataInizio: '2026-09-20', categoria: 'microvoce' },
    });
    expect(senzaCompito.statusCode).toBe(400);
    expect(senzaCompito.json().errore).toContain('microvoceProgettoId');
    expect(stato.creati).toHaveLength(0);

    const conCompito = await server.inject({
      method: 'POST',
      url: '/calendario/eventi',
      payload: {
        titolo: 'Presentare il documento',
        dataInizio: '2026-09-20T10:30:00.000Z',
        categoria: 'microvoce',
        microvoceProgettoId: 'mv-1',
      },
    });
    expect(conCompito.statusCode).toBe(201);
    expect(stato.creati[0].data.categoria).toBe('microvoce');
    expect(stato.creati[0].data.microvoceProgettoId).toBe('mv-1');
    expect(stato.creati[0].data.generato).toBe(false);
  });

  it('un evento «contratto» invece si crea: non ogni scadenza contrattuale è un contratto ricorrente', async () => {
    const server = await serverCon(tokenPer('usr-advisor'));
    const res = await server.inject({
      method: 'POST',
      url: '/calendario/eventi',
      payload: { titolo: 'Rinnovo lettera d\'incarico', dataInizio: '2026-09-20', categoria: 'contratto' },
    });
    expect(res.statusCode).toBe(201);
  });

  it('senza titolo, o con una data rovesciata, risponde 400', async () => {
    const server = await serverCon(tokenPer('usr-advisor'));

    const senzaTitolo = await server.inject({ method: 'POST', url: '/calendario/eventi', payload: { dataInizio: '2026-09-20' } });
    expect(senzaTitolo.statusCode).toBe(400);

    const rovesciata = await server.inject({
      method: 'POST',
      url: '/calendario/eventi',
      payload: { titolo: 'X', dataInizio: '2026-09-20', dataFine: '2026-09-19' },
    });
    expect(rovesciata.statusCode).toBe(400);
    expect(stato.creati).toHaveLength(0);
  });

  it('un assegnatario di un altro studio viene rifiutato', async () => {
    const server = await serverCon(tokenPer('usr-advisor'));
    const res = await server.inject({
      method: 'POST',
      url: '/calendario/eventi',
      payload: { titolo: 'X', dataInizio: '2026-09-20', assegnatoAId: 'usr-super' },
    });
    // `usr-super` è un super_admin: `tenantId` null, quindi non appartiene a questo studio.
    expect(res.statusCode).toBe(404);
    expect(stato.creati).toHaveLength(0);
  });

  /**
   * §1ter.5 (B6) — il compito da cui l'evento nasce.
   *
   * Il modale di pianificazione del fascicolo scrive un promemoria a partire da una micro-voce.
   * Senza la colonna, il legame resta solo dentro il titolo («📄 … — Raccolta documenti») e si
   * perde alla prima rinomina, lasciando in giro una scadenza orfana che nessuno sa giustificare.
   */
  it('il compito di origine viene scritto nella riga', async () => {
    const server = await serverCon(tokenPer('usr-advisor'));
    const res = await server.inject({
      method: 'POST',
      url: '/calendario/eventi',
      payload: { titolo: 'Preparare il fascicolo', dataInizio: '2026-09-20', microvoceProgettoId: 'mv-1' },
    });

    expect(res.statusCode).toBe(201);
    expect(stato.creati[0].data.microvoceProgettoId).toBe('mv-1');
  });

  it('un compito di un altro studio viene rifiutato, e non scritto', async () => {
    // La stessa ragione degli altri due riferimenti: senza il controllo l'uuid verrebbe scritto,
    // la RLS renderebbe la riga invisibile, e nessuno capirebbe perché è sparita.
    const server = await serverCon(tokenPer('usr-advisor'));
    const res = await server.inject({
      method: 'POST',
      url: '/calendario/eventi',
      payload: { titolo: 'X', dataInizio: '2026-09-20', microvoceProgettoId: 'mv-altro' },
    });

    expect(res.statusCode).toBe(404);
    expect(stato.creati).toHaveLength(0);
  });

  it('un compito inesistente viene rifiutato', async () => {
    const server = await serverCon(tokenPer('usr-advisor'));
    const res = await server.inject({
      method: 'POST',
      url: '/calendario/eventi',
      payload: { titolo: 'X', dataInizio: '2026-09-20', microvoceProgettoId: 'mv-inventato' },
    });
    expect(res.statusCode).toBe(404);
  });
});

describe('le scadenze derivate non si modificano da qui', () => {
  it('PUT, PATCH e DELETE su un id derivato spiegano da dove viene la scadenza', async () => {
    const server = await serverCon(tokenPer('usr-advisor'));

    for (const id of ['fattura:rat-1', 'kyc:cli-1', 'progetto:prg-1', 'contratto:con-1']) {
      const res = await server.inject({ method: 'DELETE', url: `/calendario/eventi/${encodeURIComponent(id)}` });
      expect(res.statusCode, id).toBe(409);
      expect(res.json().errore).toContain('scadenza derivata');
    }
  });

  it('un evento marcato come generato non si cancella', async () => {
    stato.eventi = [evento({ id: 'ev-gen', userId: 'usr-advisor', generato: true, categoria: 'microvoce' })];
    const server = await serverCon(tokenPer('usr-advisor'));

    const res = await server.inject({ method: 'DELETE', url: '/calendario/eventi/ev-gen' });
    expect(res.statusCode).toBe(409);
    expect(stato.cancellati).toHaveLength(0);
    expect(stato.eventi).toHaveLength(1);
  });

  it('un evento scritto a mano si cancella', async () => {
    stato.eventi = [evento({ id: 'ev-mio', userId: 'usr-advisor' })];
    const server = await serverCon(tokenPer('usr-advisor'));

    const res = await server.inject({ method: 'DELETE', url: '/calendario/eventi/ev-mio' });
    expect(res.statusCode).toBe(200);
    expect(stato.eventi).toHaveLength(0);
  });
});

describe('lo stato di un compito', () => {
  it('l\'assegnatario può segnarlo fatto, e la scrittura arriva al database', async () => {
    // Il difetto che questa rotta chiude: `handleToggleComplete` cambiava lo stato in memoria e
    // non lo scriveva, quindi il compito tornava da fare a ogni ricarica.
    stato.eventi = [evento({ id: 'ev-1', userId: 'usr-advisor', assegnatoAId: 'usr-esterno' })];
    const server = await serverCon(tokenPer('usr-esterno'));

    const res = await server.inject({ method: 'PATCH', url: '/calendario/eventi/ev-1/stato', payload: { stato: 'fatto' } });
    expect(res.statusCode).toBe(200);
    expect(stato.eventi[0].stato).toBe('fatto');
  });

  it('uno stato che non esiste viene rifiutato, e «done» non è uno stato', async () => {
    // Il frontend usava `pending`/`done`. Il vocabolario è quello del database, e va detto quale
    // è invece di accettare due parole per la stessa cosa.
    stato.eventi = [evento({ id: 'ev-1', userId: 'usr-advisor' })];
    const server = await serverCon(tokenPer('usr-advisor'));

    for (const stato_ of ['done', 'pending', 'da-fare', 'FATTO', '']) {
      const res = await server.inject({ method: 'PATCH', url: '/calendario/eventi/ev-1/stato', payload: { stato: stato_ } });
      expect(res.statusCode, stato_).toBe(400);
    }
    expect(stato.eventi[0].stato).toBe('da_fare');
  });

  it('chi non è né proprietario né assegnatario riceve 404', async () => {
    stato.eventi = [evento({ id: 'ev-1', userId: 'usr-advisor', assegnatoAId: 'usr-interno' })];
    const server = await serverCon(tokenPer('usr-esterno'));
    const res = await server.inject({ method: 'PATCH', url: '/calendario/eventi/ev-1/stato', payload: { stato: 'fatto' } });
    expect(res.statusCode).toBe(404);
    expect(stato.eventi[0].stato).toBe('da_fare');
  });
});

describe('l\'intervallo', () => {
  it('senza parametri è il mese corrente, con la fine a fine giornata', async () => {
    const server = await serverCon(tokenPer('usr-advisor'));
    const res = await server.inject({ method: 'GET', url: '/calendario/eventi' });

    expect(res.json().intervallo.da).toBe('2026-09-01T00:00:00.000Z');
    expect(res.json().intervallo.a).toBe('2026-09-30T23:59:59.999Z');
  });

  it('`a=2026-09-30` comprende tutto il 30 settembre, non solo la sua mezzanotte', async () => {
    const server = await serverCon(tokenPer('usr-advisor'));
    const res = await server.inject({ method: 'GET', url: '/calendario/eventi?da=2026-09-01&a=2026-09-30' });
    expect(res.json().intervallo.a).toBe('2026-09-30T23:59:59.999Z');
  });

  it('un evento che comincia prima dell\'intervallo ma ci sta dentro non si perde', async () => {
    // Sovrapposizione, non contenimento: un evento di tre giorni a cavallo del mese appartiene a
    // entrambe le griglie.
    stato.eventi = [
      evento({
        id: 'ev-lungo',
        userId: 'usr-advisor',
        dataInizio: new Date('2026-08-30T09:00:00.000Z'),
        dataFine: new Date('2026-09-02T18:00:00.000Z'),
      }),
    ];
    const server = await serverCon(tokenPer('usr-advisor'));
    const res = await server.inject({ method: 'GET', url: '/calendario/eventi' });
    expect(res.json().eventi.map((e: any) => e.id)).toContain('ev-lungo');
  });

  it('un intervallo rovesciato, una data non valida o un anno intero vengono rifiutati', async () => {
    const server = await serverCon(tokenPer('usr-advisor'));

    const rovesciato = await server.inject({ method: 'GET', url: '/calendario/eventi?da=2026-09-30&a=2026-09-01' });
    expect(rovesciato.statusCode).toBe(400);

    const nonData = await server.inject({ method: 'GET', url: '/calendario/eventi?da=2026&a=2026-09-30' });
    expect(nonData.statusCode).toBe(400);

    const troppoLungo = await server.inject({ method: 'GET', url: '/calendario/eventi?da=2024-01-01&a=2026-09-30' });
    expect(troppoLungo.statusCode).toBe(400);
    expect(troppoLungo.json().errore).toContain('366');
  });

  it('una categoria inesistente è un errore, una non consentita è un restringimento', async () => {
    // Due rifiuti diversi per due errori diversi: un nome sbagliato è un difetto del chiamante e
    // va detto, altrimenti il calendario torna vuoto e nessuno sa perché. Una categoria che il
    // ruolo non può vedere non è un errore: si restringe, in silenzio, come vuole §1ter.3.
    const server = await serverCon(tokenPer('usr-esterno'));

    const inesistente = await server.inject({ method: 'GET', url: '/calendario/eventi?categorie=fatture' });
    expect(inesistente.statusCode).toBe(400);
    expect(inesistente.json().errore).toContain('fatture');

    stato.rate = [rata()];
    const nonConsentita = await server.inject({ method: 'GET', url: '/calendario/eventi?categorie=fattura' });
    expect(nonConsentita.statusCode).toBe(200);
    expect(nonConsentita.json().eventi).toEqual([]);
  });
});

describe('l\'assegnatario', () => {
  /**
   * Tre righe nel calendario dell'advisor, con tre sorti diverse per l'esterno: una è sua, una è
   * di un altro, una non è assegnata a nessuno. La prima è il caso che conta — è l'unica che
   * distingue «vedo ciò che è mio» da «vedo ciò che devo fare».
   */
  function treRighe() {
    stato.eventi = [
      evento({ id: 'ev-mio', userId: 'usr-advisor', assegnatoAId: 'usr-esterno', titolo: 'Mio compito' }),
      evento({ id: 'ev-altrui', userId: 'usr-advisor', assegnatoAId: 'usr-interno', titolo: 'Di un altro' }),
      evento({ id: 'ev-nessuno', userId: 'usr-advisor', assegnatoAId: null, titolo: 'Non assegnato' }),
    ];
  }

  it('un compito assegnato si vede anche se la riga è nel calendario di un altro', async () => {
    treRighe();
    const server = await serverCon(tokenPer('usr-esterno'));
    const res = await server.inject({ method: 'GET', url: '/calendario/eventi' });

    // `ev-mio` sì: non è suo, ma è suo da fare. `ev-altrui` e `ev-nessuno` no: la riga sta nel
    // calendario dell'advisor, e per un `promemoria` non c'è nessun altro titolo per vederla.
    expect(res.json().eventi.map((e: any) => e.id)).toEqual(['ev-mio']);
    expect(res.json().eventi[0].assegnatoANome).toBe('Elsa Esterna');
  });

  it('`?assegnatiA=me` restringe a ciò che devo fare io', async () => {
    treRighe();
    const esterno = await serverCon(tokenPer('usr-esterno'));
    const res = await esterno.inject({ method: 'GET', url: '/calendario/eventi?assegnatiA=me' });
    expect(res.json().eventi.map((e: any) => e.id)).toEqual(['ev-mio']);

    // L'advisor è proprietario di tutte e tre e assegnatario di nessuna: il filtro è
    // sull'assegnatario, non sul proprietario, e questa è la differenza fra i due assi.
    const advisor = await serverCon(tokenPer('usr-advisor'));
    const comeAdvisor = await advisor.inject({ method: 'GET', url: '/calendario/eventi?assegnatiA=me' });
    expect(comeAdvisor.json().eventi).toEqual([]);

    // E senza filtro l'advisor le vede tutte e tre: il proprietario non perde niente.
    const senzaFiltro = await advisor.inject({ method: 'GET', url: '/calendario/eventi' });
    expect(senzaFiltro.json().eventi.map((e: any) => e.id).sort()).toEqual(['ev-altrui', 'ev-mio', 'ev-nessuno']);
  });

  it('accetta solo «me»: un id di utente è la cosa che queste rotte non accettano mai', async () => {
    const server = await serverCon(tokenPer('usr-esterno'));
    const res = await server.inject({ method: 'GET', url: '/calendario/eventi?assegnatiA=usr-advisor' });
    expect(res.statusCode).toBe(400);
    expect(res.json().errore).toContain('me');
  });
});

/**
 * C5 di §1ter.6 — l'assegnatario di un compito lo porta **la micro-voce**, non l'evento.
 *
 * Prima di questa correzione il calendario rispondeva a «è assegnato a me?» leggendo
 * `evento_calendario.assegnato_a_id`, mentre il fascicolo scriveva e il carico di lavoro contava
 * `microvoce_progetto.risorsa_id`. Due colonne per un solo concetto, scritte da due schermate
 * diverse: la prima volta che divergono, lo stesso compito risulta assegnato a due persone a
 * seconda di dove lo si guarda.
 *
 * **Il modo in cui questi test lo dimostrano è il contro-caso**, non il caso d'uso: l'evento di
 * prova porta un `assegnatoAId` **diverso** dall'assegnatario del compito. Se una delle tre
 * risposte (chi vede, chi può spuntare, che nome si mostra) tornasse a leggere la colonna
 * dell'evento, il test mostrerebbe il compito alla persona sbagliata invece di fallire in modo
 * ambiguo — ed è esattamente il difetto che C5 chiude.
 */
describe('un compito assegnato: la persona sta sulla micro-voce (C5)', () => {
  /** Un evento `microvoce` il cui compito è assegnato a `risorsaId`. */
  function conCompito(risorsaId: string | null, assegnatoAIdEvento: string | null = 'usr-interno') {
    stato.microvoci = [{ id: 'mv-1', tenantId: TENANT, risorsaId, stato: 'pending' }];
    stato.eventi = [
      evento({
        id: 'ev-compito',
        userId: 'usr-advisor',
        categoria: 'microvoce',
        microvoceProgettoId: 'mv-1',
        assegnatoAId: assegnatoAIdEvento,
      }),
    ];
  }

  it('compare in «assegnati a me» per chi ha il compito, non per l\'assegnatario dell\'evento', async () => {
    conCompito('usr-esterno');

    const perChiLoFa = await (await serverCon(tokenPer('usr-esterno')))
      .inject({ method: 'GET', url: '/calendario/eventi?categorie=microvoce&assegnatiA=me' });
    const perLaColonnaVecchia = await (await serverCon(tokenPer('usr-interno')))
      .inject({ method: 'GET', url: '/calendario/eventi?categorie=microvoce&assegnatiA=me' });

    expect(perChiLoFa.json().eventi.map((e: any) => e.id)).toEqual(['ev-compito']);
    expect(perLaColonnaVecchia.json().eventi).toEqual([]);
  });

  it('l\'assegnatario del compito lo vede e può spuntarlo; l\'altro no', async () => {
    // La lettura e la scrittura devono rispondere la stessa cosa: se la lettura ammettesse
    // l'assegnatario del compito e `PATCH` l'assegnatario dell'evento, uno vedrebbe un compito
    // che non può chiudere — la contraddizione che §1ter.3 racconta di aver già trovato una volta.
    conCompito('usr-esterno');
    const patchSuo = await (await serverCon(tokenPer('usr-esterno')))
      .inject({ method: 'PATCH', url: '/calendario/eventi/ev-compito/stato', payload: { stato: 'fatto' } });
    expect(patchSuo.statusCode).toBe(200);

    conCompito('usr-esterno');
    const patchAltrui = await (await serverCon(tokenPer('usr-interno')))
      .inject({ method: 'PATCH', url: '/calendario/eventi/ev-compito/stato', payload: { stato: 'fatto' } });
    expect(patchAltrui.statusCode).toBe(404);
  });

  it('il nome mostrato è quello dell\'assegnatario del compito', async () => {
    conCompito('usr-esterno');
    const res = await (await serverCon(tokenPer('usr-advisor')))
      .inject({ method: 'GET', url: '/calendario/eventi?categorie=microvoce' });

    const ev = res.json().eventi[0];
    expect(ev.assegnatoAId).toBe('usr-esterno');
    expect(ev.assegnatoANome).toBe('Elsa Esterna');
  });

  it('un compito senza assegnatario non è assegnato all\'assegnatario dell\'evento', async () => {
    // Il caso che rende la regola una regola e non una preferenza: la colonna dell'evento c'è,
    // ma il compito non è di nessuno. Rispondere con la colonna vecchia direbbe che è di qualcuno.
    conCompito(null);
    const res = await (await serverCon(tokenPer('usr-interno')))
      .inject({ method: 'GET', url: '/calendario/eventi?categorie=microvoce&assegnatiA=me' });
    expect(res.json().eventi).toEqual([]);
  });

  it('pianificare un compito con un assegnatario scrive la micro-voce, e non l\'evento', async () => {
    // La seconda metà della regola, quella che impedisce alla divergenza di ricominciare: la
    // rotta di creazione smette di scrivere la colonna dell'evento per un compito e scrive il
    // compito. Senza questo, il modale di pianificazione e il fascicolo riaprirebbero le due verità.
    stato.microvoci = [{ id: 'mv-1', tenantId: TENANT, risorsaId: null, stato: 'pending' }];
    const server = await serverCon(tokenPer('usr-advisor'));
    const res = await server.inject({
      method: 'POST',
      url: '/calendario/eventi',
      payload: {
        titolo: 'Presentazione documento',
        dataInizio: '2026-09-20',
        categoria: 'microvoce',
        microvoceProgettoId: 'mv-1',
        assegnatoAId: 'usr-esterno',
      },
    });

    expect(res.statusCode).toBe(201);
    expect(stato.aggiornamentiMicrovoce).toHaveLength(1);
    expect(stato.aggiornamentiMicrovoce[0].data).toMatchObject({ risorsaId: 'usr-esterno' });
    expect(stato.creati[0].data.assegnatoAId).toBeNull();
  });

  it('un promemoria assegnato resta sulla colonna dell\'evento', async () => {
    // Il contro-caso, senza il quale la correzione potrebbe essere «la micro-voce vince sempre»
    // e un promemoria affidato a qualcuno non sarebbe più di nessuno.
    const server = await serverCon(tokenPer('usr-advisor'));
    const res = await server.inject({
      method: 'POST',
      url: '/calendario/eventi',
      payload: { titolo: 'Richiamare il cliente', dataInizio: '2026-09-20', assegnatoAId: 'usr-esterno' },
    });

    expect(res.statusCode).toBe(201);
    expect(stato.aggiornamentiMicrovoce).toHaveLength(0);
    expect(stato.creati[0].data.assegnatoAId).toBe('usr-esterno');
  });
});
