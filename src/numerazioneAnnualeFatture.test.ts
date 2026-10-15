// La numerazione delle fatture deve ripartire da `001` a ogni gennaio.
//
// Il difetto, trovato il 15/10/2026: **non ripartiva affatto**. Tutti i punti che assegnano un
// progressivo filtravano `{ tenantId, serie }` e contavano le emesse di sempre, quindi il
// 1° gennaio 2027 la prima fattura dell'anno sarebbe stata `FT-2027/043` invece di `FT-2027/001`.
// Il numero stampato l'anno lo conteneva già: `FT-2027/043` è un numero che si contraddice da solo,
// ed è la numerazione «in ordine progressivo per anno solare» che l'art. 21 DPR 633/72 chiede.
//
// Il difetto toccava **quattro** punti — bozza, emissione, nota di credito, canone da contratto —
// e i tre che contano fiscalmente sono qui.
//
// Il finto database di questo file **rispetta il `where` che riceve**. È il punto: un finto che
// restituisce sempre l'«ultima riga» passerebbe identico con e senza il filtro sull'anno, cioè non
// proverebbe nulla di ciò che si vuole provare. Un presidio che non può fallire non è un presidio.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { intervalloAnnoSolare } from './services/fatturaEngine.js';

const db = vi.hoisted(() => ({
  /** Le righe emesse della "tabella": il finto filtro pesca qui. */
  emesse: [] as any[],
  /** La riga letta per id (bozza da emettere, o fattura origine di una NC). */
  perId: null as any,
  createRicevuti: [] as any[],
  contratti: new Map<string, any>(),
}));

vi.mock('./util/prismaClient.js', () => {
  // `data` è un `Date` e il filtro è un intervallo: qui si applica per davvero.
  const dentro = (data: Date | null | undefined, range: any): boolean => {
    if (!range) return true;
    if (!data) return false;
    if (range.gte && data.getTime() < range.gte.getTime()) return false;
    if (range.lt && data.getTime() >= range.lt.getTime()) return false;
    return true;
  };

  const ultimaEmessa = (where: any) => {
    const trovate = db.emesse
      .filter((r) => r.tenantId === where?.tenantId)
      .filter((r) => !where?.serie || r.serie === where.serie)
      .filter((r) => !where?.tipoDocumento || r.tipoDocumento === where.tipoDocumento)
      .filter((r) => (where?.stato?.not ? r.stato !== where.stato.not : true))
      .filter((r) => dentro(r.data, where?.data))
      .sort((a, b) => b.numeroProgressivoSerie - a.numeroProgressivoSerie);
    return trovate[0] ?? null;
  };

  const prisma: any = {
    user: {
      findFirst: async (args: any) =>
        args?.where?.id === 'admin-1'
          ? { ruolo: 'advisor', stato: 'attivo', sessionVersion: 0 }
          : null,
      findUnique: async () => ({ nome: 'Ada', email: 'ada@studio.it', ruolo: 'advisor' }),
    },
    cliente: {
      findFirst: async (args: any) =>
        args?.where?.id === 'cli-1' ? { sessionVersion: 0 } : null,
      findMany: async () => [{ id: 'cli-1', nome: 'Alpha Corp', tipo: 'company' }],
    },
    tenant: {
      findUnique: async () => ({ id: 't-1', moduliDisattivati: [] }),
      findFirst: async () => ({ id: 't-1', moduliDisattivati: [] }),
    },
    // Senza, la verifica *lancia* e il fail-closed ripiega sul default di ruolo: funziona, ma
    // riempie l'uscita di un errore che sembra un guasto del test invece di un permesso assente.
    permessoModulo: { findUnique: async () => null },
    fattura: {
      // Le due letture si distinguono dal `where`: quella per id è la fattura singola, l'altra è
      // il contatore della serie. Confonderle renderebbe il test cieco proprio al filtro.
      findFirst: async (args: any) => (args?.where?.id ? db.perId : ultimaEmessa(args?.where)),
      create: async (args: any) => {
        db.createRicevuti.push(args);
        return { id: `f-creata-${db.createRicevuti.length}`, ...args.data };
      },
      update: async (args: any) => ({ ...db.perId, ...args.data }),
      count: async () => 0,
      findMany: async () => [],
    },
    contrattoRicorrente: {
      findUnique: async (args: any) => db.contratti.get(args?.where?.id) ?? null,
      update: async () => ({}),
    },
    // Le tocca la nota di credito: le rate aperte diventano `stornata` e la fattura origine
    // `annullata`. Con una fattura senza rate incassate non nasce nessun movimento di Prima Nota.
    scadenzaIncasso: {
      updateMany: async () => ({ count: 0 }),
      update: async () => ({}),
      create: async () => ({}),
    },
    movimentoPrimaNota: { create: async () => ({}) },
    auditLog: { create: async () => ({}) },
    contoBancario: { update: async () => ({}) },
  };
  prisma.$transaction = async (fn: any) => fn(prisma);

  return {
    // `attivaContestoTenant` riceve un **contesto**, non una callback, e l'hook la chiama senza
    // `await`: una firma sbagliata qui non fa fallire la richiesta, lascia solo una promessa
    // rifiutata che nessuno guarda. Il finto giusto è un no-op, non una funzione da eseguire.
    attivaContestoTenant: () => {},
    conContestoInTransazione: async (_tx: any, fn: any) => fn(),
    riprovaSuConflitto: async (fn: any) => fn(),
    prisma,
    prismaAmministrativo: () => prisma,
  };
});

vi.mock('./util/serverHelpers.js', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./util/serverHelpers.js')>()),
  recordAudit: vi.fn(async () => undefined),
}));

// ─────────────────────────────────────────────────────────────────────
// L'intervallo dell'anno
// ─────────────────────────────────────────────────────────────────────

describe('intervalloAnnoSolare', () => {
  it('copre dal 1° gennaio al 1° gennaio successivo', () => {
    const { gte, lt } = intervalloAnnoSolare(new Date(2026, 5, 15));
    expect(gte.getFullYear()).toBe(2026);
    expect(gte.getMonth()).toBe(0);
    expect(gte.getDate()).toBe(1);
    expect(lt.getFullYear()).toBe(2027);
    expect(lt.getMonth()).toBe(0);
    expect(lt.getDate()).toBe(1);
  });

  it('usa lo stesso criterio di anno del numero stampato', () => {
    // Se i due divergessero — per esempio intervallo in UTC e numero in ora locale — un documento
    // emesso a cavallo della mezzanotte di capodanno sarebbe *numerato* 2027 e *contato* nel 2026.
    // Il difetto non si vedrebbe fino al primo gennaio, e a quel punto sarebbe su una fattura.
    for (const mese of [0, 6, 11]) {
      const data = new Date(2026, mese, 15, 12, 0, 0);
      expect(intervalloAnnoSolare(data).gte.getFullYear()).toBe(data.getFullYear());
    }
  });

  it('mette il 31 dicembre nell anno che sta per chiudersi, non in quello nuovo', () => {
    const { gte, lt } = intervalloAnnoSolare(new Date(2026, 0, 1));
    const sanSilvestro = new Date(2026, 11, 31, 23, 59, 59);
    const capodanno = new Date(2027, 0, 1, 0, 0, 0);
    expect(sanSilvestro.getTime()).toBeGreaterThanOrEqual(gte.getTime());
    expect(sanSilvestro.getTime()).toBeLessThan(lt.getTime());
    expect(capodanno.getTime()).toBeGreaterThanOrEqual(lt.getTime());
  });
});

// ─────────────────────────────────────────────────────────────────────
// Le tre rotte che assegnano un numero legale
// ─────────────────────────────────────────────────────────────────────

/** Una riga emessa in un dato anno, con un progressivo che appartiene a quell'anno. */
const emessa = (serie: string, progressivo: number, data: Date) => ({
  id: `f-${serie}-${progressivo}`,
  tenantId: 't-1',
  serie,
  tipoDocumento: serie === 'NC' ? 'nota_credito' : 'fattura',
  stato: 'emessa',
  numeroProgressivoSerie: progressivo,
  numero: `${serie}-${data.getFullYear()}/${String(progressivo).padStart(3, '0')}`,
  data,
});

const bozza = (serie = 'FT') => ({
  id: 'f-bozza',
  tenantId: 't-1',
  clienteId: 'cli-1',
  serie,
  tipoDocumento: serie === 'NC' ? 'nota_credito' : 'fattura',
  stato: 'bozza',
  numeroProgressivoSerie: 99,
  numero: `BOZZA-${serie}-99`,
  data: new Date(2026, 5, 20),
  nettoAPagareCentesimi: 100000,
  condizionePagamento: 'bonifico_30gg',
  cliente: { id: 'cli-1', nome: 'Alpha Corp', tipo: 'company', piva: '01234567890', codiceFiscale: '01234567890' },
  righe: [],
  scadenzeIncasso: [],
});

async function chiama(url: string, payload: any = {}) {
  const { buildServer } = await import('./server.js');
  const { signJwt } = await import('./util/jwt.js');
  const server = buildServer({} as any);
  await server.ready();
  const token = signJwt({
    userId: 'admin-1',
    tenantId: 't-1',
    ruolo: 'advisor',
    email: 'ada@studio.it',
    sessionVersion: 0,
  });
  return server.inject({
    method: 'POST',
    url,
    headers: { authorization: `Bearer ${token}` },
    payload,
  });
}

describe('la numerazione riparte a ogni gennaio', () => {
  beforeEach(() => {
    db.emesse = [];
    db.perId = bozza();
    db.createRicevuti = [];
    db.contratti.clear();
    // Solo `Date` è finto: fingere anche i timer farebbe scadere le attese interne del server.
    vi.useFakeTimers({ toFake: ['Date'] });
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('all emissione: la prima del 2027 e la 001, non la 043 che proseguirebbe il 2026', async () => {
    // Il caso del difetto, alla lettera: 42 fatture emesse nel 2026, poi si emette a gennaio 2027.
    vi.setSystemTime(new Date(2027, 5, 15, 10, 0, 0));
    db.emesse = [emessa('FT', 42, new Date(2026, 5, 15))];

    const res = await chiama('/invoices/f-bozza/emetti');

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.fattura.numero).toBe('FT-2027/001');
    expect(body.fattura.numeroProgressivoSerie).toBe(1);
    // La prova che il 2026 non è stato contato: 43 era il numero che il difetto produceva.
    expect(body.fattura.numero).not.toBe('FT-2027/043');
  });

  it('all emissione: dentro lo stesso anno il progressivo continua a crescere', async () => {
    // L'altro verso, che nessuno guarda: se il filtro sull'anno fosse «azzera sempre», ogni
    // fattura sarebbe la 001 e il vincolo del database rifiuterebbe la seconda. Il caso normale
    // deve restare normale.
    vi.setSystemTime(new Date(2027, 5, 15, 10, 0, 0));
    db.emesse = [
      emessa('FT', 42, new Date(2026, 5, 15)),
      emessa('FT', 1, new Date(2027, 1, 3)),
      emessa('FT', 2, new Date(2027, 3, 11)),
    ];

    const res = await chiama('/invoices/f-bozza/emetti');

    expect(res.json().fattura.numero).toBe('FT-2027/003');
    expect(res.json().fattura.numeroProgressivoSerie).toBe(3);
  });

  it('all emissione: le due serie contano separatamente, e anche per anno', async () => {
    vi.setSystemTime(new Date(2027, 5, 15, 10, 0, 0));
    db.emesse = [
      emessa('FT', 42, new Date(2026, 5, 15)),
      emessa('NC', 7, new Date(2026, 5, 20)),
    ];

    const res = await chiama('/invoices/f-bozza/emetti');

    expect(res.json().fattura.numero).toBe('FT-2027/001');
  });

  it('alla nota di credito: anche la serie NC riparte da 001 nel nuovo anno', async () => {
    vi.setSystemTime(new Date(2027, 5, 15, 10, 0, 0));
    // La NC si emette su una fattura viva, non su una bozza.
    db.perId = bozza('FT');
    db.perId.stato = 'emessa';
    db.perId.righe = [];
    db.emesse = [emessa('NC', 9, new Date(2026, 5, 20))];

    const res = await chiama('/invoices/f-bozza/nota-credito', { motivo: 'errore_esposizione' });

    expect(res.statusCode).toBe(200);
    expect(res.json().notaCredito.numero).toBe('NC-2027/001');
    expect(res.json().notaCredito.numeroProgressivoSerie).toBe(1);
  });

  it('al canone da contratto: la fattura generata riparte da 001 nel nuovo anno', async () => {
    // Quarta via alla numerazione, e la più facile da dimenticare: non passa da una bozza.
    vi.setSystemTime(new Date(2027, 5, 15, 10, 0, 0));
    db.emesse = [emessa('FT', 42, new Date(2026, 5, 15))];
    db.contratti.set('c-1', {
      id: 'c-1',
      tenantId: 't-1',
      clienteId: 'cli-1',
      progettoId: null,
      titolo: 'Retainer Advisory',
      frequenza: 'mensile',
      importoCentesimi: 100000,
      prossimaFatturazione: new Date(2027, 5, 1),
      cliente: { id: 'cli-1', nome: 'Alpha Corp', tipo: 'company', piva: '01234567890', codiceFiscale: '01234567890' },
      progetto: null,
    });

    const res = await chiama('/contratti-ricorrenti/c-1/genera-fattura');

    expect(res.statusCode).toBe(200);
    expect(res.json().fattura.numero).toBe('FT-2027/001');
  });
});
