// L'import dell'estratto conto bancario, e in particolare le **due** cose che inventava.
//
// `parseFloat(rawImporto) || 100.0` diventava un movimento da 100 € per una riga illeggibile — e
// anche per una riga che diceva `0`, perché `0` è falsy. Due righe più sotto, la stessa
// espressione datava *oggi* ogni riga con una data non ISO, cioè **tutte** quelle degli estratti
// conto italiani: `Date.parse('15/10/2026')` restituisce `NaN`.
//
// Il difetto non era il valore di ripiego: era che ci fosse. Un importo e una data sono
// **misure**, e una misura che non si è potuta leggere non ha un valore plausibile da mettere al
// suo posto. Questi test tengono ferma quella regola, non i due numeri di oggi.
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { leggiImporto, leggiData } from './routes/contabilitaPrimaNota.js';

// `vi.mock` è issato in cima al file, quindi una `const` normale non esiste ancora quando la
// fabbrica gira: `vi.hoisted` la issa insieme al mock. È il modo giusto di condividere una spia
// con la fabbrica, non quello di spostare la `const` più in alto — che non basterebbe.
const { createMovimento } = vi.hoisted(() => ({ createMovimento: vi.fn() }));
createMovimento.mockImplementation(async (args: any) => ({ id: `mv-${args.data.riferimentoTransazione}`, ...args.data }));

vi.mock('./util/prismaClient.js', () => ({
  // L'hook di autenticazione avvolge la query in `attivaContestoTenant` (che imposta il tenant
  // come variabile di sessione per la RLS). Senza, l'hook fallisce e la rotta risponde 401: è il
  // finto accidente che fa sembrare rotta l'autenticazione invece del mock.
  attivaContestoTenant: vi.fn(async (fn: any) => fn()),
  prisma: {
    user: {
      findFirst: vi.fn(async (args: any) =>
        args?.where?.id === 'admin-1' ? { ruolo: 'advisor', stato: 'attivo', sessionVersion: 0 } : null,
      ),
      findUnique: vi.fn(async () => ({ nome: 'Ada', email: 'ada@studio.it', ruolo: 'advisor' })),
    },
    cliente: {
      findFirst: vi.fn(async (args: any) => (args?.where?.id === 'cli-1' ? { sessionVersion: 0 } : null)),
      findMany: vi.fn(async () => [{ id: 'cli-1', nome: 'Alpha Corp' }]),
    },
    tenant: {
      findUnique: vi.fn(async () => ({ id: 't-1', moduliDisattivati: [] })),
      findFirst: vi.fn(async () => ({ id: 't-1', moduliDisattivati: [] })),
    },
    contoBancario: { update: vi.fn(async () => ({})) },
    // La matrice dei permessi per modulo. `null` = nessuna riga, quindi si applica il default per
    // ruolo (che per un advisor su `primanota` è `write`). Il mock deve esistere comunque: senza,
    // la verifica *lancia*, e il fail-closed ripiega sul default — funziona, ma riempie l'uscita
    // di un errore che sembra un guasto del test.
    permessoModulo: { findUnique: vi.fn(async () => null) },
    movimentoPrimaNota: { create: createMovimento, findMany: vi.fn(async () => []), count: vi.fn(async () => 0) },
    auditLog: { create: vi.fn(async () => ({})) },
  },
  prismaAmministrativo: () => ({
    user: { findUnique: vi.fn(async () => null) },
    auditLog: { create: vi.fn(async () => ({})) },
  }),
}));

vi.mock('./util/serverHelpers.js', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./util/serverHelpers.js')>()),
  recordAudit: vi.fn(async () => undefined),
}));

// ─────────────────────────────────────────────────────────────────────
// L'importo
// ─────────────────────────────────────────────────────────────────────

describe('leggiImporto', () => {
  it('non inventa un importo quando il campo non ne porta uno', () => {
    // Il difetto di partenza: `|| 100.0` trasformava ognuno di questi in un movimento da 100 €.
    expect(leggiImporto('')).toBeNull();
    expect(leggiImporto(undefined)).toBeNull();
    expect(leggiImporto('   ')).toBeNull();
    expect(leggiImporto('abc')).toBeNull();
  });

  it('rifiuta un campo solo in parte numerico', () => {
    // `parseFloat('12abc')` restituisce `12`: ricava un numero da un campo che numero non è. È la
    // stessa bugia del `|| 100`, in un punto dove non si sarebbe mai cercata.
    expect(leggiImporto('12abc')).toBeNull();
    expect(leggiImporto('1.234,56 EUR')).toBeNull();
    expect(leggiImporto('--5')).toBeNull();
    expect(leggiImporto('1,2,3')).toBeNull();
  });

  it('legge lo zero come zero, non come il valore di ripiego', () => {
    // Il lato del difetto che nessuno avrebbe mai notato: `0` è falsy, quindi `0 || 100` fa 100.
    expect(leggiImporto('0')).toBe(0);
    expect(leggiImporto('0,00')).toBe(0);
    expect(leggiImporto('0.00')).toBe(0);
  });

  it('legge le due forme che convivono negli estratti conto', () => {
    expect(leggiImporto('5000.00')).toBe(5000);
    expect(leggiImporto('-150.00')).toBe(-150);
    expect(leggiImporto('1.234,56')).toBe(1234.56);
    expect(leggiImporto('-1.234,56')).toBe(-1234.56);
    expect(leggiImporto('1,234.56')).toBe(1234.56);
  });

  it('legge come migliaia i punti quando non c\'è una virgola a fare da decimale', () => {
    // `1.234.567` senza virgola sono migliaia. Il ripiego precedente ne faceva `1.234`: un
    // movimento sbagliato di un fattore un milione, che nessuno avrebbe cercato.
    expect(leggiImporto('1.234.567')).toBe(1234567);
  });

  it('tollera simbolo di valuta e spazi, compreso lo spazio unificatore degli home banking', () => {
    expect(leggiImporto('€ 1.234,56')).toBe(1234.56);
    expect(leggiImporto(' 1.234,56 ')).toBe(1234.56);
    expect(leggiImporto('  100  ')).toBe(100);
  });
});

// ─────────────────────────────────────────────────────────────────────
// La data
// ─────────────────────────────────────────────────────────────────────

describe('leggiData', () => {
  it('legge la forma italiana, che è quella di ogni estratto conto italiano', () => {
    // `Date.parse('15/10/2026')` restituisce `NaN`, quindi ogni riga di un export italiano
    // finiva datata *oggi*, in silenzio: ordine cronologico sbagliato e periodo IVA sbagliato.
    const atteso = new Date(Date.UTC(2026, 9, 15)).toISOString();
    expect(leggiData('15/10/2026')?.toISOString()).toBe(atteso);
    expect(leggiData('15-10-2026')?.toISOString()).toBe(atteso);
    expect(leggiData('15.10.2026')?.toISOString()).toBe(atteso);
    expect(leggiData('1/2/2026')?.toISOString()).toBe(new Date(Date.UTC(2026, 1, 1)).toISOString());
  });

  it('legge la forma ISO, con o senza ora attaccata', () => {
    const atteso = new Date(Date.UTC(2026, 9, 15)).toISOString();
    expect(leggiData('2026-10-15')?.toISOString()).toBe(atteso);
    expect(leggiData('2026-10-15T10:30:00Z')?.toISOString()).toBe(atteso);
    expect(leggiData('2026-10-15 10:30:00')?.toISOString()).toBe(atteso);
  });

  it('rifiuta una data che non esiste invece di farla rotolare', () => {
    // `new Date(Date.UTC(2026, 1, 31))` non fallisce: diventa il 3 marzo. Accettarla
    // inventerebbe un movimento in un giorno plausibile — e con la data di un altro mese.
    expect(leggiData('31/02/2026')).toBeNull();
    expect(leggiData('2026-13-01')).toBeNull();
    expect(leggiData('32/01/2026')).toBeNull();
  });

  it('non ripiega su oggi quando non riconosce la forma', () => {
    expect(leggiData('')).toBeNull();
    expect(leggiData(undefined)).toBeNull();
    expect(leggiData('non una data')).toBeNull();
    expect(leggiData('15/10/26')).toBeNull(); // due cifre di anno: ambigua, quindi rifiutata
  });
});

// ─────────────────────────────────────────────────────────────────────
// La rotta
// ─────────────────────────────────────────────────────────────────────

describe('POST /prima-nota/import-csv', () => {
  beforeEach(() => {
    createMovimento.mockClear();
  });

  async function importa(csvContent: string) {
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
    const res = await server.inject({
      method: 'POST',
      url: '/prima-nota/import-csv',
      headers: { authorization: `Bearer ${token}` },
      payload: { csvContent },
    });
    return res;
  }

  it('non crea nessun movimento per una riga illeggibile, e la nomina', async () => {
    const res = await importa([
      '2026-09-01;Bonifico da Alpha Corp parcella 1;5000.00;TRN1',
      '2026-09-02;Riga con importo illeggibile;N/D;TRN2',
      '31/02/2026;Riga con data che non esiste;42.00;TRN3',
    ].join('\n'));

    expect(res.statusCode).toBe(200);
    const body = res.json();

    // Una sola riga registrata, e nessuna delle due scartate ha prodotto un movimento.
    expect(body.importati).toBe(1);
    expect(createMovimento).toHaveBeenCalledTimes(1);
    expect(createMovimento.mock.calls[0]![0].data.importoCentesimi).toBe(500000);

    expect(body.scartate).toHaveLength(2);
    expect(body.scartate[0].riga).toBe(2);
    expect(body.scartate[0].motivo).toContain('importo');
    expect(body.scartate[0].contenuto).toContain('N/D');
    expect(body.scartate[1].riga).toBe(3);
    expect(body.scartate[1].motivo).toContain('data');
  });

  it('il messaggio non dice «con successo» mentre qualcosa è stato scartato', async () => {
    // È il punto della voce: una riga scartata e una riga mai letta devono restare due cose
    // diverse anche per chi legge solo il messaggio in cima.
    const res = await importa([
      '2026-09-01;Buona;5000.00;TRN1',
      '2026-09-02;Rotta;;TRN2',
    ].join('\n'));

    const body = res.json();
    expect(body.message).toContain('1 movimenti importati');
    expect(body.message).toContain('1 righe scartate');
    expect(body.message).not.toContain('con successo');
  });

  it('registra l\'importo 0 come zero euro e non come cento', async () => {
    const res = await importa('2026-09-01;Giroconto interno;0;TRN1');

    const body = res.json();
    expect(body.importati).toBe(1);
    expect(body.scartate).toEqual([]);
    expect(createMovimento.mock.calls[0]![0].data.importoCentesimi).toBe(0);
  });

  it('registra il movimento con la data letta, non con la data di oggi', async () => {
    const res = await importa('15/10/2026;Bonifico da Alpha Corp;1200,50;TRN1');

    expect(res.json().importati).toBe(1);
    const dati = createMovimento.mock.calls[0]![0].data;
    expect(dati.data.toISOString()).toBe(new Date(Date.UTC(2026, 9, 15)).toISOString());
    expect(dati.importoCentesimi).toBe(120050);
  });

  it('un CSV tutto buono resta un successo senza elenco da guardare', async () => {
    const res = await importa([
      '2026-09-01;Bonifico da Alpha Corp;5000.00;TRN1',
      '2026-09-02;Acquisto cancelleria;-150.00;TRN2',
    ].join('\n'));

    const body = res.json();
    expect(body.importati).toBe(2);
    expect(body.scartate).toEqual([]);
    expect(body.message).toContain('con successo');
  });

  it('l\'intestazione del file finisce fra le righe scartate, con il testo per riconoscerla', async () => {
    // Non è un caso da nascondere: è la riga che l'utente ha davanti, e vederla nominata è il modo
    // più rapido per capire che il file comincia con un'intestazione. Sopprimerla in silenzio
    // sarebbe la stessa soppressione che questa voce esiste per togliere.
    const res = await importa([
      'Data;Causale;Importo;CRO',
      '2026-09-01;Bonifico da Alpha Corp;5000.00;TRN1',
    ].join('\n'));

    const body = res.json();
    expect(body.importati).toBe(1);
    expect(body.scartate).toHaveLength(1);
    expect(body.scartate[0].riga).toBe(1);
    expect(body.scartate[0].contenuto).toContain('Data;Causale');
  });
});
