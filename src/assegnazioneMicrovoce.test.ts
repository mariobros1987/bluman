/**
 * §1ter.6 (C3) — `risorsa_id`: chi lavora a una micro-voce.
 *
 * La colonna esiste dalla prima migrazione e non era **mai** stata scritta: sempre NULL,
 * quindi il carico di lavoro per operatore sommava ore su nessuno e il calendario non
 * aveva modo di sapere chi sta facendo cosa. Questa rotta ora la scrive, e la cosa che
 * conta non è che la scriva — è **quando non la scrive**.
 *
 * Tre esiti diversi, che è facile confondere fra loro e che qui sono separati apposta:
 *
 *  - campo assente  → non si tocca. Un salvataggio che non parla di assegnazione non deve
 *    cancellarla: è il caso di ogni schermata dove l'assegnatario non si vede. Se questa
 *    distinzione cade, aprire un progetto e premere Salva disassegna tutto in silenzio.
 *  - campo `null`   → si azzera. «Non assegnato» è uno stato, non l'assenza di un dato.
 *  - campo stringa  → si verifica lo studio di appartenenza, **poi** si scrive.
 *
 * L'ultima è la più importante e la meno visibile. `risorsa_id` è una chiave esterna verso
 * `user`, che è una tabella globale: la RLS della scrittura guarda il `tenant_id` della
 * micro-voce — che è quello giusto — e non dice nulla su chi finisce dentro la colonna.
 * Senza il controllo, l'uuid di un utente di un altro studio verrebbe accettato: quella
 * persona comparirebbe come assegnataria in questo fascicolo e le sue ore entrerebbero nel
 * carico di lavoro di uno studio che non è il suo. È l'unico dei quattro casi in cui un
 * difetto non si vede guardando la propria schermata.
 */
import Fastify from 'fastify';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const TENANT = '00000000-0000-0000-0000-000000000001';
const ALTRO_TENANT = '00000000-0000-0000-0000-000000000002';

const MV_GIA_ASSEGNATA = 'usr-gia-assegnato';

const stato = {
  microvoci: [] as any[],
  /** id utente → tenant di appartenenza. `null` per il super_admin, che non è di nessuno (§2bis). */
  utenti: {} as Record<string, string | null>,
  aggiornamentiMicrovoce: [] as any[],
  /** Quante volte si è interrogata la tabella utenti: la cache deve tenerla bassa. */
  lettureUtenti: 0,
};

/** Le due micro-voci di partenza: una libera, una già assegnata. */
function microvociIniziali() {
  return [
    { id: 'mv-1', nome: 'Raccolta documenti', ordine: 0, stato: 'pending', causaNota: null, risorsaId: null },
    { id: 'mv-2', nome: 'Verifica antiriciclaggio', ordine: 1, stato: 'pending', causaNota: null, risorsaId: MV_GIA_ASSEGNATA },
  ];
}

vi.mock('./util/prismaClient.js', async importOriginal => {
  const reale = await importOriginal<typeof import('./util/prismaClient.js')>();
  const prisma: any = {
    progetto: {
      findUnique: async () => ({
        id: 'proj-1',
        nome: 'Progetto Cliente',
        stato: 'in_progress',
        moduli: [{ id: 'mod-1', nome: 'Modulo A', microvoci: stato.microvoci }],
      }),
      update: async () => ({}),
    },
    moduloProgetto: { update: async () => ({}) },
    microvoceProgetto: {
      update: async (args: any) => {
        stato.aggiornamentiMicrovoce.push(args);
        return args.data;
      },
    },
    user: {
      findUnique: async (args: any) => {
        stato.lettureUtenti++;
        const id = args?.where?.id;
        if (!(id in stato.utenti)) return null;
        return { tenantId: stato.utenti[id] };
      },
    },
  };
  return { ...reale, prisma };
});

// Il ricalcolo dell'avanzamento (§16) legge molto e non c'entra con questa correzione:
// la rotta lo chiama dentro un try/catch e ne tollera il fallimento.
vi.mock('./services/calcoloService.js', async importOriginal => {
  const reale = await importOriginal<typeof import('./services/calcoloService.js')>();
  return { ...reale, ricalcolaProgetto: async () => null };
});

// L'audit scrive su una tabella che qui non serve.
vi.mock('./util/serverHelpers.js', async importOriginal => {
  const reale = await importOriginal<typeof import('./util/serverHelpers.js')>();
  return { ...reale, recordAudit: async () => undefined };
});

vi.mock('./services/notificheService.js', () => ({
  notificaStudio: async () => undefined,
}));

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

/**
 * Il corpo di un salvataggio che parla di una sola micro-voce.
 *
 * `risorsaId` si passa come valore, e la chiave si omette del tutto quando è `ASSENTE`:
 * è la distinzione che il test deve poter esprimere, quindi non si può usare `undefined`
 * (che in JSON sparisce, e in un test non riprodurrebbe il caso reale).
 */
const ASSENTE = Symbol('campo assente');

/**
 * La forma del corpo che questi test spediscono.
 *
 * Non è un vezzo: `inject` di Fastify ha degli overload, e un `payload: unknown` non ne
 * soddisfa nessuno. Il tipo che ne usciva era `void & Promise<Response> & Chain`, quindi
 * `res.statusCode` e `res.json()` non esistevano — quattro errori di compilazione che
 * `vitest` non vede, perché esbuild cancella i tipi senza controllarli. Li ha visti il
 * pre-commit, che è l'unico dei due che compila davvero.
 */
type CorpoSalvataggio = {
  mods: Array<{ dbId: string; n: string; v: Array<Record<string, unknown>> }>;
};

function corpo(mv: Record<string, unknown>, risorsa: unknown = ASSENTE): CorpoSalvataggio {
  const v: any = { dbId: mv.dbId, n: mv.n, hE: 0, hA: 0, s: 'pending' };
  if (risorsa !== ASSENTE) v.risorsaId = risorsa;
  return { mods: [{ dbId: 'mod-1', n: 'Modulo A', v: [v] }] };
}

async function salva(payload: CorpoSalvataggio) {
  const s = await server();
  const res = await s.inject({ method: 'PUT', url: '/progetti/proj-1/stato-completo', payload });
  return { res, body: res.json() as any };
}

/** I dati dell'ultimo `microvoceProgetto.update` che riguarda la micro-voce indicata. */
function ultimoAggiornamento(microvoceId: string) {
  const trovato = [...stato.aggiornamentiMicrovoce].reverse().find(a => a.where.id === microvoceId);
  return trovato?.data;
}

beforeEach(() => {
  stato.microvoci = microvociIniziali();
  stato.aggiornamentiMicrovoce.length = 0;
  stato.lettureUtenti = 0;
  stato.utenti = {
    'usr-membro': TENANT,
    'usr-altro-studio': ALTRO_TENANT,
    // Il super_admin ha `tenant_id` NULL: non è una risorsa di nessuno studio.
    'usr-super': null,
  };
});

describe('l\'assegnatario viene scritto', () => {
  it('un utente dello studio finisce in `risorsa_id`', async () => {
    const { res } = await salva(corpo({ dbId: 'mv-1', n: 'Raccolta documenti' }, 'usr-membro'));

    expect(res.statusCode).toBe(200);
    expect(ultimoAggiornamento('mv-1')).toMatchObject({ risorsaId: 'usr-membro' });
  });

  it('la riassegnazione di una micro-voce già assegnata sovrascrive il vecchio', async () => {
    // La micro-voce di partenza ha già un assegnatario diverso: senza questo caso, una
    // scrittura che funzionasse solo sulla colonna vuota passerebbe lo stesso.
    await salva(corpo({ dbId: 'mv-2', n: 'Verifica antiriciclaggio' }, 'usr-membro'));

    expect(ultimoAggiornamento('mv-2')).toMatchObject({ risorsaId: 'usr-membro' });
  });
});

describe('l\'assegnatario non viene inventato né cancellato per sbaglio', () => {
  it('un campo assente non tocca la colonna', async () => {
    // È il caso di ogni salvataggio che arriva da una schermata dove l'assegnatario non si
    // vede: se `assente` diventasse `null`, aprire un progetto e premere Salva
    // disassegnerebbe tutti i compiti senza che nessuno lo abbia chiesto.
    const { body } = await salva(corpo({ dbId: 'mv-2', n: 'Verifica antiriciclaggio' }));

    expect(ultimoAggiornamento('mv-2')?.risorsaId).toBeUndefined();

    // La seconda metà della stessa proprietà, e non è ridondante: la colonna può restare
    // intatta **e** il salvataggio può comunque dire che qualcosa non è riuscito. Trattare
    // il campo assente come un valore da esaminare fa scattare il ramo «non è una stringa»,
    // che accusa l'utente di un errore che non ha commesso. Un avviso falso su un
    // salvataggio riuscito è il modo in cui si insegna a ignorare gli avvisi.
    expect(body.nonSalvate).toEqual([]);
  });

  it('`null` azzera, ed è diverso dal campo assente', async () => {
    await salva(corpo({ dbId: 'mv-2', n: 'Verifica antiriciclaggio' }, null));

    expect(ultimoAggiornamento('mv-2')).toMatchObject({ risorsaId: null });
  });

  it('azzerare una micro-voce già libera non riscrive la colonna', async () => {
    await salva(corpo({ dbId: 'mv-1', n: 'Raccolta documenti' }, null));

    // `mv-1` è già senza assegnatario: non c'è niente da cambiare, quindi la chiave non
    // compare fra i dati da scrivere. (Un update sulle ore può comunque avvenire: il corpo
    // di prova le manda, come fa il frontend.)
    expect(ultimoAggiornamento('mv-1')).not.toHaveProperty('risorsaId');
  });
});

describe('un utente di un altro studio non può diventare assegnatario', () => {
  it('rifiuta l\'uuid di un altro studio e lo dice', async () => {
    const { res, body } = await salva(
      corpo({ dbId: 'mv-1', n: 'Raccolta documenti' }, 'usr-altro-studio'),
    );

    // Non è un 500 e non è un 403: è un salvataggio parziale che nomina la riga saltata,
    // come tutti gli altri rifiuti di questa rotta. La chiave non compare fra i dati
    // scritti, quindi la colonna resta com'era.
    expect(res.statusCode).toBe(200);
    expect(ultimoAggiornamento('mv-1')).not.toHaveProperty('risorsaId');
    expect(body.nonSalvate.join(' ')).toContain('Raccolta documenti');
    expect(body.nonSalvate.join(' ')).toContain('non appartiene a questo studio');
  });

  it('rifiuta anche un utente che non esiste', async () => {
    await salva(corpo({ dbId: 'mv-1', n: 'Raccolta documenti' }, 'usr-inventato'));

    expect(ultimoAggiornamento('mv-1')).not.toHaveProperty('risorsaId');
  });

  it('rifiuta il super_admin, che non appartiene a nessuno studio', async () => {
    // `tenant_id` NULL (§2bis): il confronto lo esclude da solo, e questo test fissa il
    // comportamento perché è una conseguenza voluta, non un caso che capita.
    await salva(corpo({ dbId: 'mv-1', n: 'Raccolta documenti' }, 'usr-super'));

    expect(ultimoAggiornamento('mv-1')).not.toHaveProperty('risorsaId');
  });

  it('un identificativo che non è una stringa non viene scritto', async () => {
    await salva(corpo({ dbId: 'mv-1', n: 'Raccolta documenti' }, 42));

    expect(ultimoAggiornamento('mv-1')).not.toHaveProperty('risorsaId');
  });
});

describe('la verifica dello studio costa una query per persona, non per micro-voce', () => {
  it('due micro-voci assegnate alla stessa persona interrogano la tabella una volta sola', async () => {
    const s = await server();
    await s.inject({
      method: 'PUT',
      url: '/progetti/proj-1/stato-completo',
      payload: {
        mods: [{
          dbId: 'mod-1',
          n: 'Modulo A',
          v: [
            { dbId: 'mv-1', n: 'Raccolta documenti', hE: 0, hA: 0, s: 'pending', risorsaId: 'usr-membro' },
            { dbId: 'mv-2', n: 'Verifica antiriciclaggio', hE: 0, hA: 0, s: 'pending', risorsaId: 'usr-membro' },
          ],
        }],
      },
    });

    expect(stato.lettureUtenti).toBe(1);
    expect(ultimoAggiornamento('mv-1')).toMatchObject({ risorsaId: 'usr-membro' });
    expect(ultimoAggiornamento('mv-2')).toMatchObject({ risorsaId: 'usr-membro' });
  });
});
