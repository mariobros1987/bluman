/**
 * Le due colonne JSON del passaggio: `campi_form_json` e `risposte_form_json`.
 *
 * Esistono dalla prima migrazione, ma solo la prima aveva uno scrittore (l'istanziazione dal
 * modello). La seconda non ne aveva **nessuno**: la scheda che doveva compilarla era stata
 * cancellata per sbaglio insieme al modale «Aggiungi Azione», e il pulsante era rimasto lì a
 * non fare niente. Ripristinata la scheda, questa rotta diventa il suo unico scrittore — e
 * quindi l'unico posto dove il contratto va difeso.
 *
 * Il contratto ha due metà, e la seconda conta più della prima:
 *
 *  1. **quello che si scrive si deve poter disegnare.** `TabPassaggi` chiama `.map` sui campi e
 *     legge le risposte per chiave: una colonna `Json` accetta qualunque cosa, quindi un client
 *     che manda una stringa dove serve un array, o un array dove serve un oggetto, la
 *     scriverebbe senza che nessuno se ne accorga — e il guasto comparirebbe alla riapertura,
 *     lontano dalla causa. Le forme storte si scartano al confine;
 *  2. **un passaggio che non parla di form non azzera il form.** È lo stesso principio
 *     dell'assegnatario (`assegnazioneMicrovoce.test.ts`): `undefined` in un `update` significa
 *     «non toccare la colonna», e deve restare così, o ogni salvataggio dalla checklist
 *     cancellerebbe i dati raccolti senza che nessuno li abbia toccati.
 *
 * `vitest` non controlla i tipi: questi test provano il comportamento, non la compilazione.
 */
import Fastify from 'fastify';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const TENANT = '00000000-0000-0000-0000-000000000001';

/** Una micro-voce già letta dal database, con i suoi passaggi. */
const stato = {
  microvoci: [
    { id: 'mv-1', nome: 'Raccolta dati societari', ordine: 0, stato: 'pending', causaNota: null, risorsaId: null },
  ],
  /** Ogni scrittura su `passaggio_progetto`, nell'ordine in cui è avvenuta. */
  scritture: [] as Array<{ tipo: 'create' | 'update'; data: any }>,
};

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
    microvoceProgetto: { update: async (args: any) => args.data },
    user: { findUnique: async () => null },
    passaggioProgetto: {
      upsert: async (args: any) => {
        // Il ramo in prova è sempre quello di aggiornamento: i test che usano `upsert` portano
        // l'id di database, quindi la riga esiste.
        stato.scritture.push({ tipo: 'update', data: args.update });
        return args.update;
      },
      create: async (args: any) => {
        // Un titolo solo fallisce, e fallisce sempre: serve a provare che l'errore di un
        // passaggio non porta via gli altri, senza dover manomettere il mock dentro un test —
        // una manomissione lascerebbe il file dipendente dall'ordine di esecuzione.
        if (args.data.titolo === 'Fallisce') throw new Error('violazione di vincolo');
        stato.scritture.push({ tipo: 'create', data: args.data });
        return args.data;
      },
    },
  };
  return { ...reale, prisma };
});

// Il ricalcolo dell'avanzamento (§16) legge molto e non c'entra: la rotta ne tollera il fallimento.
vi.mock('./services/calcoloService.js', async importOriginal => {
  const reale = await importOriginal<typeof import('./services/calcoloService.js')>();
  return { ...reale, ricalcolaProgetto: async () => null };
});

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
    req.user = { userId: 'usr-richiedente', tenantId: TENANT, email: 'advisor@example.test', ruolo: 'advisor' };
  });
  await registraRotteProgetti(s, { getProgetto: async () => null } as any);
  return s;
}

/**
 * Il corpo di un salvataggio con i passaggi di una sola micro-voce.
 *
 * Le chiavi si passano **assenti** quando non si vuole nominarle: `undefined` in JSON sparisce,
 * e i due casi («campo assente» e «campo presente ma indefinito») non sarebbero più distinti —
 * che è esattamente la distinzione sotto test.
 */
function corpo(passaggi: Array<Record<string, unknown>>) {
  return {
    mods: [
      {
        dbId: 'mod-1',
        n: 'Modulo A',
        v: [
          {
            dbId: 'mv-1',
            n: 'Raccolta dati societari',
            hE: 0,
            hA: 0,
            s: 'pending',
            proc: passaggi,
          },
        ],
      },
    ],
  };
}

async function salva(passaggio: Record<string, unknown>) {
  return salva2([passaggio]);
}

/** Più passaggi nella stessa micro-voce: serve al caso «uno fallisce e gli altri no». */
async function salva2(passaggi: Array<Record<string, unknown>>) {
  const s = await server();
  const res = await s.inject({
    method: 'PUT',
    url: '/progetti/proj-1/stato-completo',
    payload: corpo(passaggi),
  });
  return { res, body: res.json() as any };
}

/** L'unica scrittura avvenuta, o un errore esplicito se ce ne sono zero o più d'una. */
function scrittura() {
  expect(stato.scritture).toHaveLength(1);
  return stato.scritture[0]!;
}

/** Un passaggio di database: l'id è un uuid, quindi non inizia per `p-`. */
const ID_DB = '8f14e45f-ea0d-4b1a-9c2f-0d5c9a7b3e21';

beforeEach(() => {
  stato.microvoci = [
    { id: 'mv-1', nome: 'Raccolta dati societari', ordine: 0, stato: 'pending', causaNota: null, risorsaId: null },
  ];
  stato.scritture.length = 0;
});

describe('le risposte raccolte finiscono a database', () => {
  it('un passaggio nuovo (id locale) nasce con i campi e le risposte, senza id imposto', async () => {
    const { res } = await salva({
      id: 'p-1759700000000',
      title: 'Dati societari',
      type: 'form',
      who: 'cliente',
      fields: ['Ragione Sociale', 'P.IVA / VAT'],
      risposte: { 'Ragione Sociale': 'Bluecode Ltd' },
    });

    expect(res.statusCode).toBe(200);
    const w = scrittura();
    // `p-…` è un id nato nel browser: il database deve assegnarne uno suo, o due browser
    // aprirebbero la stessa riga.
    expect(w.tipo).toBe('create');
    expect(w.data).not.toHaveProperty('id');
    expect(w.data.campiFormJson).toEqual(['Ragione Sociale', 'P.IVA / VAT']);
    expect(w.data.risposteFormJson).toEqual({ 'Ragione Sociale': 'Bluecode Ltd' });
  });

  it('un passaggio che esiste già viene aggiornato con le risposte', async () => {
    await salva({
      id: ID_DB,
      title: 'Dati societari',
      type: 'form',
      who: 'cliente',
      risposte: { 'P.IVA / VAT': 'MT12345678' },
    });

    const w = scrittura();
    expect(w.tipo).toBe('update');
    expect(w.data.risposteFormJson).toEqual({ 'P.IVA / VAT': 'MT12345678' });
  });

  it('un passaggio del modello porta le risposte **senza** rimandare i campi', async () => {
    // È il caso normale: i campi li ha scritti l'istanziazione dal modello, l'operatore aggiunge
    // solo le risposte. Se la scrittura dei campi fosse obbligatoria, questo salvataggio non
    // potrebbe esistere; se le risposte non passassero, la scheda riaprirebbe vuota.
    await salva({
      id: ID_DB,
      title: 'Dati societari',
      type: 'form',
      who: 'cliente',
      risposte: { 'Legale Rappresentante': 'Mario Rossi' },
    });

    const w = scrittura();
    expect(w.data.risposteFormJson).toEqual({ 'Legale Rappresentante': 'Mario Rossi' });
    expect(w.data).not.toHaveProperty('campiFormJson');
  });

  it('un form svuotato scrive un oggetto vuoto, e non lascia le risposte di prima', async () => {
    // «Nessuna risposta» è un dato, non l'assenza di un dato: se `{}` venisse scartato come
    // valore vuoto, cancellare un campo sbagliato sarebbe impossibile.
    await salva({ id: ID_DB, title: 'Dati societari', type: 'form', who: 'cliente', risposte: {} });

    expect(scrittura().data.risposteFormJson).toEqual({});
  });
});

describe('un passaggio che non parla di form non tocca il form', () => {
  it('senza `fields` né `risposte` le due colonne non vengono nominate', async () => {
    // Il caso di ogni salvataggio dalla checklist: si spunta un ✓, e i dati raccolti restano.
    await salva({ id: ID_DB, title: 'Verifica visura', type: 'check', who: 'operatore', stato: 'done' });

    const w = scrittura();
    expect(w.data).not.toHaveProperty('campiFormJson');
    expect(w.data).not.toHaveProperty('risposteFormJson');
    // Il resto del passaggio si salva comunque: il silenzio riguarda solo le due colonne.
    expect(w.data).toMatchObject({ titolo: 'Verifica visura', stato: 'done' });
  });

  it('`null` non azzera: azzerare è scrivere `{}`, non mandare `null`', async () => {
    await salva({ id: ID_DB, title: 'Dati societari', type: 'form', who: 'cliente', fields: null, risposte: null });

    const w = scrittura();
    expect(w.data).not.toHaveProperty('campiFormJson');
    expect(w.data).not.toHaveProperty('risposteFormJson');
  });
});

describe('le forme che il rendering non saprebbe disegnare si scartano al confine', () => {
  // Ognuno di questi valori è ciò che un client sbagliato — o una versione futura del frontend —
  // potrebbe spedire. A database entrerebbero senza errore: la colonna è `Json`, accetta tutto.
  const formeStorte: Array<[string, unknown]> = [
    ['una stringa al posto dell\'elenco dei campi', 'Ragione Sociale'],
    ['un numero al posto dell\'elenco', 42],
    ['un elenco di numeri', [1, 2]],
    ['un elenco con un buco dentro', ['Ragione Sociale', null]],
    ['un elenco di oggetti', [{ nome: 'Ragione Sociale' }]],
    ['un oggetto al posto dell\'elenco', { 0: 'Ragione Sociale' }],
  ];

  for (const [nome, valore] of formeStorte) {
    it(`campi: ${nome}`, async () => {
      await salva({ id: ID_DB, title: 'Dati societari', type: 'form', who: 'cliente', fields: valore });

      expect(scrittura().data).not.toHaveProperty('campiFormJson');
    });
  }

  const risposteStorte: Array<[string, unknown]> = [
    ['una stringa al posto dell\'oggetto', 'Bluecode Ltd'],
    ['un elenco al posto dell\'oggetto', ['Bluecode Ltd']],
    ['un numero al posto dell\'oggetto', 7],
    ['un booleano', true],
  ];

  for (const [nome, valore] of risposteStorte) {
    it(`risposte: ${nome}`, async () => {
      await salva({ id: ID_DB, title: 'Dati societari', type: 'form', who: 'cliente', risposte: valore });

      expect(scrittura().data).not.toHaveProperty('risposteFormJson');
    });
  }

  it('un elenco di campi vuoto è una forma valida, e si scrive', async () => {
    // Non è una forma storta: è «questo form non chiede niente», e `TabPassaggi` lo distingue
    // dall'assenza (che fa scattare il suo elenco di ripiego).
    await salva({ id: ID_DB, title: 'Dati societari', type: 'form', who: 'cliente', fields: [] });

    expect(scrittura().data.campiFormJson).toEqual([]);
  });
});

describe('un passaggio che non si salva si dichiara', () => {
  it('se la scrittura fallisce la riga finisce in `nonSalvate`, e le altre si salvano lo stesso', async () => {
    // Il vecchio `catch` avvolgeva l'intero ciclo: il primo errore trascinava nel silenzio tutti
    // i passaggi successivi, e la risposta diceva comunque `ok: true`. Qui si fissa il contrario:
    // chi fallisce si nomina, e chi viene dopo si salva.
    const { res, body } = await salva2([
      { id: 'p-1', title: 'Fallisce', type: 'form', who: 'cliente', risposte: { a: 'b' } },
      { id: 'p-2', title: 'Secondo', type: 'form', who: 'cliente', risposte: { c: 'd' } },
    ]);

    expect(res.statusCode).toBe(200);
    expect(body.nonSalvate.join(' ')).toContain('Fallisce');
    // Il secondo è arrivato a database: la sua scrittura è l'unica registrata.
    expect(stato.scritture).toHaveLength(1);
    expect(stato.scritture[0]!.data).toMatchObject({ titolo: 'Secondo' });
  });
});
