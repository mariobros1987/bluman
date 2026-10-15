// Il saldo dei conti: quale dei due numeri si risponde, e cosa succede quando non coincidono.
//
// La colonna `conto_bancario.saldo_attuale` è una **copia**: il saldo vero è
// `saldoIniziale + Σ movimenti` (`domain/saldoConto.ts`). La copia era tenuta a mano da ogni
// percorso che scriveva un movimento, e sei percorsi su dieci se ne dimenticavano o lo facevano sul
// conto sbagliato — il versamento F24, i due pagamenti fornitori, l'import CSV, il rimborso per
// Nota di Credito e l'incasso senza conto. Nessuno di quei percorsi faceva rumore: il conto mostrava
// semplicemente un numero che non tornava con i suoi movimenti.
//
// `GET /conti-bancari` è l'unica lettura di quella colonna, quindi è l'unico posto che può
// accorgersi della divergenza. Questi test tengono ferme tre cose: che a rispondere sia il numero
// **dei movimenti** (i movimenti sono la verità), che la copia venga riportata al valore vero con
// un'annotazione nel registro attività, e che quando i due coincidono non succeda niente — un
// presidio che parla sempre non lo ascolta più nessuno.
import { describe, it, expect, vi, beforeEach } from 'vitest';

// I due finti dichiarano il parametro anche se non lo usano: senza, `mock.calls[0]` è la tupla
// vuota e il test non può leggere *cosa* è stato scritto — cioè proprio la cosa da verificare.
const { aggiornaConto, annota } = vi.hoisted(() => ({
  aggiornaConto: vi.fn(async (_args: any) => ({})),
  annota: vi.fn(async (_voce: any) => undefined),
}));

const db = vi.hoisted(() => ({
  conti: [] as any[],
  movimenti: [] as any[],
}));

vi.mock('./util/prismaClient.js', () => {
  const prisma: any = {
    user: {
      findFirst: async (args: any) =>
        args?.where?.id === 'admin-1' ? { ruolo: 'advisor', stato: 'attivo', sessionVersion: 0 } : null,
      findUnique: async () => ({ nome: 'Ada', email: 'ada@studio.it', ruolo: 'advisor' }),
    },
    cliente: {
      findFirst: async (args: any) => (args?.where?.id === 'cli-1' ? { sessionVersion: 0 } : null),
      findMany: async () => [],
    },
    tenant: {
      findUnique: async () => ({ id: 't-1', moduliDisattivati: [] }),
      findFirst: async () => ({ id: 't-1', moduliDisattivati: [] }),
    },
    permessoModulo: { findUnique: async () => null },
    contoBancario: {
      findMany: async (args: any) =>
        db.conti
          .filter((c) => c.tenantId === args?.where?.tenantId)
          .sort((a, b) => Number(b.isDefault) - Number(a.isDefault)),
      update: aggiornaConto,
    },
    // Un `groupBy` vero sul finto database, che onora `by`, `where` e `_sum`: un finto che
    // restituisse righe fisse passerebbe identico con e senza il filtro sul conto, cioè non
    // proverebbe la cosa che questi test esistono per provare.
    movimentoPrimaNota: {
      groupBy: async (args: any) => {
        const righe = db.movimenti
          .filter((m) => m.tenantId === args?.where?.tenantId)
          .filter((m) => (args?.where?.contoBancarioId?.not === null ? m.contoBancarioId !== null : true));
        const gruppi = new Map<string, any>();
        for (const m of righe) {
          const chiave = `${m.contoBancarioId}|${m.tipo}`;
          const gruppo = gruppi.get(chiave) ?? {
            contoBancarioId: m.contoBancarioId,
            tipo: m.tipo,
            _sum: { importoCentesimi: 0 },
          };
          gruppo._sum.importoCentesimi += m.importoCentesimi;
          gruppi.set(chiave, gruppo);
        }
        return [...gruppi.values()];
      },
    },
    auditLog: { create: async () => ({}) },
  };
  prisma.$transaction = async (fn: any) => fn(prisma);
  return {
    attivaContestoTenant: () => {},
    conContestoInTransazione: async (_tx: any, fn: any) => fn(),
    riprovaSuConflitto: async (fn: any) => fn(),
    prisma,
    prismaAmministrativo: () => prisma,
  };
});

vi.mock('./util/serverHelpers.js', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./util/serverHelpers.js')>()),
  recordAudit: annota,
}));

const conto = (over: any = {}) => ({
  id: 'c-1',
  tenantId: 't-1',
  nomeConto: 'Conto operativo',
  banca: 'Banca Uno',
  saldoIniziale: 100000,
  saldoAttuale: 100000,
  isDefault: true,
  ...over,
});

const movimento = (over: any = {}) => ({
  tenantId: 't-1',
  contoBancarioId: 'c-1',
  tipo: 'entrata',
  importoCentesimi: 50000,
  ...over,
});

async function leggiConti() {
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
    method: 'GET',
    url: '/conti-bancari',
    headers: { authorization: `Bearer ${token}` },
  });
}

describe('GET /conti-bancari — il saldo è quello dei movimenti', () => {
  beforeEach(() => {
    aggiornaConto.mockClear();
    annota.mockClear();
    db.conti = [conto()];
    db.movimenti = [];
  });

  it('risponde il saldo **calcolato**, anche quando la colonna dice un altro numero', async () => {
    // La colonna è rimasta a 1.000 € (nessun movimento l'ha aggiornata), i movimenti dicono
    // +500 € di entrata: si risponde 1.500 €. È il caso di ogni percorso che dimenticava il saldo.
    db.movimenti = [movimento()];
    db.conti = [conto({ saldoAttuale: 100000 })];

    const body = (await leggiConti()).json();

    expect(body[0].saldoAttuale).toBe(150000);
  });

  it('riporta la colonna al valore dei movimenti e lo annota, con tutti e due i numeri', async () => {
    db.movimenti = [movimento({ tipo: 'uscita', importoCentesimi: 30000 })];
    db.conti = [conto({ saldoAttuale: 100000 })];

    await leggiConti();

    expect(aggiornaConto).toHaveBeenCalledWith({
      where: { id: 'c-1' },
      data: { saldoAttuale: 70000 },
    });
    // L'annotazione deve permettere di ricostruire cosa è cambiato: da quanto a quanto.
    expect(annota).toHaveBeenCalledTimes(1);
    const voce = annota.mock.calls[0]![0] as any;
    expect(voce.azione).toBe('SALDO_CONTO_RICONCILIATO');
    expect(voce.entita).toBe('Conto operativo');
    expect(voce.dettagli).toContain('1000.00');
    expect(voce.dettagli).toContain('700.00');
  });

  it('quando i due numeri coincidono non ripara e non annota niente', async () => {
    // Il silenzio deve significare «tutto coerente». Un presidio che scrive sempre non lo legge
    // più nessuno, ed è il modo in cui una divergenza vera passerebbe inosservata.
    db.movimenti = [movimento()];
    db.conti = [conto({ saldoAttuale: 150000 })];

    await leggiConti();

    expect(aggiornaConto).not.toHaveBeenCalled();
    expect(annota).not.toHaveBeenCalled();
  });

  it('i movimenti di un altro conto non entrano in questo saldo', async () => {
    db.conti = [conto(), conto({ id: 'c-2', nomeConto: 'Secondo conto', saldoIniziale: 0, saldoAttuale: 0 })];
    db.movimenti = [movimento({ contoBancarioId: 'c-2', importoCentesimi: 80000 })];

    const body = (await leggiConti()).json();

    expect(body.find((c: any) => c.id === 'c-1').saldoAttuale).toBe(100000);
    expect(body.find((c: any) => c.id === 'c-2').saldoAttuale).toBe(80000);
  });

  it('un movimento senza conto non finisce nel saldo di nessuno', async () => {
    // È la regola per cui l'incasso senza conto non deve più caricare il denaro sul predefinito:
    // il denaro non attribuito resta fuori da ogni conto, visibile in Prima Nota come tale,
    // invece di comparire in una banca che nessuna riga nomina.
    db.movimenti = [movimento({ contoBancarioId: null, importoCentesimi: 999999 })];

    const body = (await leggiConti()).json();

    expect(body[0].saldoAttuale).toBe(100000);
    expect(aggiornaConto).not.toHaveBeenCalled();
  });

  it('se la riparazione fallisce la pagina mostra comunque il saldo vero', async () => {
    // La copia è manutenzione, la lettura è il servizio: far fallire la lettura per non essere
    // riusciti ad aggiornare una copia nasconderebbe l'unica cosa che l'operatore è venuto a
    // vedere. Il prossimo accesso ci riprova.
    db.movimenti = [movimento()];
    db.conti = [conto({ saldoAttuale: 100000 })];
    aggiornaConto.mockRejectedValueOnce(new Error('scrittura rifiutata'));

    const res = await leggiConti();

    expect(res.statusCode).toBe(200);
    expect(res.json()[0].saldoAttuale).toBe(150000);
  });
});
