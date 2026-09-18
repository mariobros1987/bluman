/**
 * `GET /operatori-suggeriti` — il carico di lavoro, e la definizione di compito che ora usa (C5).
 *
 * **Perché questo file esiste.** La rotta aveva **zero copertura** fino al 18/09/2026, e in quel
 * giorno il suo calcolo è cambiato: la `groupBy` scritta a mano dentro la rotta è diventata una
 * chiamata a `caricoPerRisorse` (§1ter.6, C5). Un refactor senza test è una modifica non verificata
 * — il codice compila, e nessuno sa se il numero che esce è ancora quello giusto. Questo file è la
 * verifica che mancava, ed è arrivata **dopo**: è scritto contro il comportamento che la rotta deve
 * avere, non contro quello che aveva.
 *
 * **Cosa il test può osservare, e cosa no.** La rotta non espone `compitiAperti`: il conteggio dei
 * compiti lo legge solo la vista «i miei compiti», dove serve al criterio di accettazione. Qui
 * l'unica cosa visibile è `oreResidue`, ed è abbastanza: è la metà del carico che viene dai compiti,
 * l'altra metà viene dal timesheet, e le due si sommano in `caricoOre` — che è il numero su cui la
 * rotta ordina. Quindi si verificano tre cose distinte: che le ore residue siano quelle delle
 * micro-voci aperte, che il timesheet si sommi, e che l'ordine dei suggerimenti ne dipenda.
 *
 * **Il finto non salta i gruppi senza risorsa, e non è una svista.** Una `groupBy` vera su
 * `risorsa_id` produce un gruppo con chiave `null` quando esiste una micro-voce che nessuno ha preso
 * in carico. Il finto lo produce anche lui, così la riga che lo esclude è quella in
 * `caricoPerRisorse` — dove sta davvero — e non una comodità del test.
 */
import Fastify from 'fastify';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const TENANT = '00000000-0000-0000-0000-000000000001';

const ANNA = 'u-anna';
const BRUNO = 'u-bruno';
const CARLA = 'u-carla';

const stato = {
  microvoci: [] as any[],
  timesheet: [] as any[],
  /** Quante volte si è chiesto il carico al database: la rotta non deve chiederlo due volte. */
  lettureCarico: 0,
};

/** Gli operatori dello studio. L'ordine è quello di `createdAt asc`, che la rotta si aspetta. */
function utentiIniziali() {
  return [
    { id: ANNA, nome: 'Anna Bianchi', ruolo: 'collaboratore_interno', specializzazione: 'contabilità' },
    { id: BRUNO, nome: 'Bruno Neri', ruolo: 'collaboratore_interno', specializzazione: 'contabilità' },
    { id: CARLA, nome: 'Carla Rossi', ruolo: 'advisor', specializzazione: 'fiscale' },
  ];
}

/**
 * Le micro-voci, e ognuna serve a escludere qualcosa.
 *
 * `mv-anna-finito` porta 100 ore e uno stato `done`: se la definizione di compito perdesse lo stato,
 * il carico di Anna passerebbe da 25 a 125 e il test lo vedrebbe. `mv-libera` porta 50 ore che non
 * sono di nessuno. Senza queste due righe il file resterebbe verde anche con una `where` sbagliata.
 */
function microvociIniziali() {
  return [
    { id: 'mv-anna-aperto', tenantId: TENANT, risorsaId: ANNA, stato: 'pending', orePreventivate: 20, oreConsuntivate: 5 },
    { id: 'mv-anna-finito', tenantId: TENANT, risorsaId: ANNA, stato: 'done', orePreventivate: 100, oreConsuntivate: 0 },
    { id: 'mv-bruno-aperto', tenantId: TENANT, risorsaId: BRUNO, stato: 'active', orePreventivate: 4, oreConsuntivate: 0 },
    { id: 'mv-libera', tenantId: TENANT, risorsaId: null, stato: 'pending', orePreventivate: 50, oreConsuntivate: 0 },
  ];
}

/**
 * Questa settimana: 10 ore per Anna, niente per gli altri.
 *
 * `giorno` è **oggi**, e non una data fissa. La rotta filtra il timesheet sulla settimana corrente
 * (`lunedì ≤ giorno < lunedì + 7`), quindi una data scritta a mano renderebbe il test verde oggi e
 * rosso lunedì prossimo — e un test che dipende dal giorno in cui gira è un test che insegna a
 * ignorarlo. Oggi appartiene alla settimana corrente per definizione.
 */
function timesheetIniziale() {
  return [{ userId: ANNA, tenantId: TENANT, giorno: new Date(), _sum: { minuti: 600 } }];
}

vi.mock('./util/prismaClient.js', async importOriginal => {
  const reale = await importOriginal<typeof import('./util/prismaClient.js')>();

  /** Applica un `where` minimale: uguaglianza, `in`, `not`, `gte`/`lt`. */
  function corrisponde(riga: any, where: any): boolean {
    if (!where) return true;
    for (const [campo, condizione] of Object.entries(where)) {
      const valore = riga[campo];
      if (condizione !== null && typeof condizione === 'object') {
        const c = condizione as any;
        if ('in' in c && !c.in.includes(valore)) return false;
        if ('not' in c && valore === c.not) return false;
        if ('gte' in c && !(valore >= c.gte)) return false;
        if ('lt' in c && !(valore < c.lt)) return false;
        continue;
      }
      if (valore !== condizione) return false;
    }
    return true;
  }

  const prisma: any = {
    user: {
      findMany: async () => utenti(),
    },
    oraTimesheet: {
      groupBy: async (args: any) => stato.timesheet.filter((t) => corrisponde(t, args?.where)),
    },
    microvoceProgetto: {
      groupBy: async (args: any) => {
        stato.lettureCarico++;
        const dentro = stato.microvoci.filter((m) => corrisponde(m, args?.where));
        // Raggruppa per `risorsaId`, **null compreso**: è ciò che farebbe Prisma.
        const perRisorsa = new Map<any, any[]>();
        for (const m of dentro) {
          const chiave = m.risorsaId ?? null;
          perRisorsa.set(chiave, [...(perRisorsa.get(chiave) ?? []), m]);
        }
        return [...perRisorsa].map(([risorsaId, righe]) => ({
          risorsaId,
          _sum: {
            orePreventivate: righe.reduce((s, r) => s + r.orePreventivate, 0),
            oreConsuntivate: righe.reduce((s, r) => s + r.oreConsuntivate, 0),
          },
          _count: { _all: righe.length },
        }));
      },
    },
  };

  return { ...reale, prisma };
});

let utenti: () => any[] = utentiIniziali;

const { registraRotteProgetti } = await import('./routes/progetti.js');

async function server() {
  const s = Fastify();
  s.addHook('onRequest', async req => {
    req.tenantId = TENANT;
    req.ruolo = 'advisor';
    req.userId = 'usr-richiedente';
    req.user = {
      userId: 'usr-richiedente',
      tenantId: TENANT,
      email: 'advisor@example.test',
      ruolo: 'advisor',
    };
  });
  await registraRotteProgetti(s, { getProgetto: async () => null } as any);
  return s;
}

/** I suggeriti, nell'ordine in cui la rotta li restituisce. */
async function suggeriti(categoria?: string) {
  const res = await (await server()).inject({
    method: 'GET',
    url: categoria ? `/operatori-suggeriti?categoria=${encodeURIComponent(categoria)}` : '/operatori-suggeriti',
  });
  expect(res.statusCode).toBe(200);
  return res.json().suggeriti as any[];
}

function di(nome: string, righe: any[]) {
  return righe.find(r => r.nome === nome);
}

beforeEach(() => {
  stato.microvoci = microvociIniziali();
  stato.timesheet = timesheetIniziale();
  stato.lettureCarico = 0;
  utenti = utentiIniziali;
});

describe('le ore residue di un operatore sono quelle dei suoi compiti aperti', () => {
  it('somma il preventivato meno il consuntivato delle sole micro-voci aperte', async () => {
    const righe = await suggeriti();

    // 20 − 5 = 15. La micro-voce `done` da 100 ore non entra: sarebbe 115, e questo test è il solo
    // posto dove quella differenza si vede.
    expect(di('Anna Bianchi', righe)?.oreResidue).toBe(15);
    expect(di('Bruno Neri', righe)?.oreResidue).toBe(4);
  });

  it('le ore di un compito che nessuno ha preso in carico non sono di nessuno', async () => {
    // `mv-libera` ha 50 ore. Senza l'esclusione finirebbero in un gruppo `null` che nessuno legge —
    // o, se la `groupBy` perdesse la colonna, dentro il totale di qualcuno.
    const righe = await suggeriti();
    expect(di('Anna Bianchi', righe)?.oreResidue).toBe(15);
    expect(di('Bruno Neri', righe)?.oreResidue).toBe(4);
    expect(di('Carla Rossi', righe)?.oreResidue).toBe(0);
  });

  it('chi non ha compiti ha zero ore residue, non un valore mancante', async () => {
    // `caricoPerRisorse` non restituisce una voce per chi non ha compiti: la rotta usa `?? 0`.
    // Se quel ripiego sparisse, qui uscirebbe `null` e la somma del carico diventerebbe `NaN`.
    const righe = await suggeriti();
    expect(di('Carla Rossi', righe)?.oreResidue).toBe(0);
    expect(di('Carla Rossi', righe)?.caricoOre).toBe(0);
  });

  it('il carico somma le ore della settimana e le ore residue', async () => {
    // Le due metà vengono da due tabelle diverse e si incontrano solo qui.
    const righe = await suggeriti();
    expect(di('Anna Bianchi', righe)?.oreSettimana).toBe(10);
    expect(di('Anna Bianchi', righe)?.caricoOre).toBe(25); // 10 + 15
  });
});

describe('l\'ordine dei suggerimenti: prima chi corrisponde, poi chi ha meno carico', () => {
  it('senza categoria ordina solo per carico crescente', async () => {
    const righe = await suggeriti();
    expect(righe.map(r => r.nome)).toEqual(['Carla Rossi', 'Bruno Neri', 'Anna Bianchi']);
    expect(righe.every(r => r.corrisponde === false)).toBe(true);
  });

  it('con una categoria, chi corrisponde viene prima anche se ha più carico', async () => {
    const righe = await suggeriti('contabilità');

    // Anna ha 25 ore di carico e Carla zero, ma Anna corrisponde e Carla no: la specializzazione
    // pesa più del carico. È l'unica cosa che distingue questo ordinamento da un `sort` per carico.
    expect(righe.map(r => r.nome)).toEqual(['Bruno Neri', 'Anna Bianchi', 'Carla Rossi']);
    expect(righe[0].corrisponde).toBe(true);
    expect(righe[2].corrisponde).toBe(false);
  });

  it('fra chi corrisponde, decide il carico: Bruno con 4 ore prima di Anna con 25', async () => {
    const righe = await suggeriti('contabilità');
    const corrispondenti = righe.filter(r => r.corrisponde);
    expect(corrispondenti.map(r => r.nome)).toEqual(['Bruno Neri', 'Anna Bianchi']);
    expect(corrispondenti[0].caricoOre).toBeLessThan(corrispondenti[1].caricoOre);
  });

  it('la categoria richiesta torna nella risposta, anche quando è vuota', async () => {
    const res = await (await server()).inject({ method: 'GET', url: '/operatori-suggeriti' });
    expect(res.json().categoria).toBeNull();
  });
});

describe('quando non c\'è nessuno da suggerire', () => {
  it('uno studio senza operatori non interroga il carico e risponde con un elenco vuoto', async () => {
    // L'uscita anticipata non è un'ottimizzazione: senza di essa la `groupBy` girerebbe con un
    // elenco di id vuoto, che è una query che non serve a niente su ogni studio appena creato.
    utenti = () => [];
    const righe = await suggeriti();
    expect(righe).toEqual([]);
    expect(stato.lettureCarico).toBe(0);
  });
});
