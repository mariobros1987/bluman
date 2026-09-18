/**
 * §1ter.6 (C5) — i compiti assegnati: una definizione, e il numero che deve coincidere.
 *
 * Il criterio di accettazione di C5 è una frase sola — «la vista «i miei compiti» e il carico di
 * lavoro concordano sullo stesso numero» — e questo file è il posto dove quella frase diventa un
 * test. Il numero che la vista restituisce è `compitiDiUtente(...).length`; quello che il carico di
 * lavoro usa per ordinare i suggerimenti è `caricoPerRisorse(...).compitiAperti`. Sono la stessa
 * clausola `where`, una elencata e una contata: **se qualcuno le fa divergere, il test cade.**
 *
 * **Cosa sarebbe questo test senza la misura.** Se le due funzioni avessero due clausole scritte a
 * mano, un test che le confronta passerebbe finché le clausole restano uguali — cioè
 * passerebbe *sempre*, anche il giorno prima che divergano, che è l'unico giorno in cui serve. Il
 * valore del test sta nel fatto che il confronto avviene **su dati che le due clausole trattano
 * diversamente**: compiti finiti, micro-voci senza assegnatario, compiti di un altro studio, e
 * compiti senza data. Ognuno di questi è una riga che una delle due potrebbe includere per sbaglio.
 *
 * **La definizione è una, e le sue due metà non cadono per la stessa ragione.** `risorsaId` esclude
 * ciò che nessuno ha preso in carico; `stato: { not: 'done' }` esclude ciò che è finito. Il secondo è
 * quello che si vede: toglierlo fa cadere il file. Il primo **non fa cadere niente**, e la misura
 * dice perché — vedi la nota in `compitiAssegnati.ts`: `caricoPerRisorse` salta comunque i gruppi
 * senza `risorsaId`, quindi le ore di una micro-voce libera non finiscono nel carico di nessuno in
 * nessuno dei due casi. La differenza che `risorsaId` fa è restringere la scansione, non cambiare il
 * numero. I test qui sotto tengono la riga libera fra i dati lo stesso, perché è quella che
 * documenta la metà che il tipo non sa esprimere — ma non si aspettano di ucciderla.
 *
 * **Perché i test del modulo e non solo quelli della rotta.** La rotta `/calendario/compiti` è sei
 * righe: legge il token e chiama questa funzione. Un test che monta il server prova che quelle sei
 * righe sono giuste; non prova niente sulla query, che è dove stanno le decisioni. I due livelli
 * stanno entrambi qui, e il primo è quello che conta.
 */
import Fastify from 'fastify';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Ruolo } from './util/authorization.js';

const TENANT = '00000000-0000-0000-0000-000000000001';
const ALTRO_TENANT = '00000000-0000-0000-0000-000000000002';

const ELSA = 'usr-esterno';
const IVAN = 'usr-interno';

/**
 * Le micro-voci di partenza, e ognuna esiste per un motivo.
 *
 * Sono costruite perché **ogni esclusione abbia una riga che la mette alla prova**: senza
 * `mv-finito` la metà `stato != 'done'` non sarebbe osservata da nessun test — ed è quella che,
 * tolta, fa cadere il file. `mv-libero` invece non uccide niente (vedi la nota in testa): resta
 * perché è il caso che un giorno potrebbe cambiare, non perché oggi discrimini.
 */
function microvociIniziali() {
  return [
    // I due compiti veri di Elsa: uno con una data pianificata, uno mai pianificato.
    { id: 'mv-pianificato', tenantId: TENANT, nome: 'Raccolta documenti', stato: 'pending', risorsaId: ELSA, orePreventivate: 10, oreConsuntivate: 4 },
    { id: 'mv-senza-data', tenantId: TENANT, nome: 'Verifica antiriciclaggio', stato: 'active', risorsaId: ELSA, orePreventivate: 6, oreConsuntivate: 6 },
    // Escluso: finito. Le sue ore residue non devono entrare in nessuno dei due numeri.
    { id: 'mv-finito', tenantId: TENANT, nome: 'Deposito bilancio', stato: 'done', risorsaId: ELSA, orePreventivate: 40, oreConsuntivate: 0 },
    // Escluso: non è di nessuno. Tenerlo qui è ciò che rende il file onesto sul fatto che questa
    // metà della clausola **non** è osservabile per mutazione (vedi la nota in testa).
    { id: 'mv-libero', tenantId: TENANT, nome: 'Compito di nessuno', stato: 'pending', risorsaId: null, orePreventivate: 25, oreConsuntivate: 0 },
    // Escluso: di un altro studio, anche se assegnato a Elsa. Il `tenantId` deve fermarlo.
    { id: 'mv-altro-studio', tenantId: ALTRO_TENANT, nome: 'Compito di un altro studio', stato: 'pending', risorsaId: ELSA, orePreventivate: 100, oreConsuntivate: 0 },
    // Un compito di Ivan, per provare che il filtro per persona non è «tutti quelli aperti».
    { id: 'mv-ivan', tenantId: TENANT, nome: 'Nota integrativa', stato: 'pending', risorsaId: IVAN, orePreventivate: 8, oreConsuntivate: 1 },
  ];
}

/** Gli eventi di calendario che portano la data dei compiti. */
function eventiIniziali() {
  return [
    { id: 'ev-1', microvoceProgettoId: 'mv-pianificato', categoria: 'microvoce', stato: 'da_fare', dataInizio: new Date('2026-09-24T00:00:00.000Z') },
    // Un secondo evento **più lontano** sullo stesso compito: se la scelta fosse per `dataFine` o
    // per l'ultimo invece che per il primo, questo test lo vedrebbe.
    { id: 'ev-2', microvoceProgettoId: 'mv-pianificato', categoria: 'microvoce', stato: 'da_fare', dataInizio: new Date('2026-10-30T00:00:00.000Z') },
    // Annullato: non è la data di niente.
    { id: 'ev-annullato', microvoceProgettoId: 'mv-senza-data', categoria: 'microvoce', stato: 'annullato', dataInizio: new Date('2026-09-01T00:00:00.000Z') },
  ];
}

/** Il progetto e il modulo a cui i compiti appartengono, per la risalita delle relazioni. */
const PROGETTO = { id: 'prg-1', nome: 'Bilancio 2026', clienteId: 'cli-1', cliente: { nome: 'Holding Beta S.r.l.' } };
const MODULO = { id: 'mod-1', nome: 'Modulo A', progettoId: 'prg-1', progetto: PROGETTO };

vi.mock('./util/prismaClient.js', async importOriginal => {
  const reale = await importOriginal<typeof import('./util/prismaClient.js')>();

  /**
   * Le micro-voci con le relazioni risolte, come le restituirebbe Prisma.
   *
   * Gli eventi si filtrano con **il `where` che il codice gli ha passato**, e non con una copia
   * scritta qui. Questo è il punto: un finto che applicasse per conto suo `stato != 'annullato'`
   * farebbe passare il test sull'evento annullato **qualunque cosa faccia la query**, cioè
   * esattamente il test che serve a dimostrare che quel filtro c'è. Provato per mutazione: con la
   * copia locale, togliere il filtro dal codice non faceva cadere niente.
   */
  function conRelazioni(mv: any, select: any) {
    const q = select?.eventiCalendario;
    const dentro = eventi
      .filter((e) => e.microvoceProgettoId === mv.id && corrisponde(e, q?.where))
      .sort((a, b) => (q?.orderBy?.dataInizio === 'desc' ? -1 : 1) * (a.dataInizio.getTime() - b.dataInizio.getTime()));
    return { ...mv, moduloProgetto: MODULO, eventiCalendario: q ? dentro : undefined };
  }

  const prisma: any = {
    microvoceProgetto: {
      findMany: async (args: any) => microvoci.filter((m) => corrisponde(m, args?.where)).map((m) => conRelazioni(m, args?.select)),
      groupBy: async (args: any) => {
        // Il finto rispetta il `where` **e** raggruppa per `risorsaId`: se ignorasse il `where`, il
        // confronto con la vista coinciderebbe per il motivo sbagliato (entrambi vedrebbero tutto).
        const dentro = microvoci.filter((m) => corrisponde(m, args?.where));
        const perRisorsa = new Map<string, any[]>();
        for (const m of dentro) {
          const chiave = m.risorsaId ?? null;
          if (chiave === null) continue;
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

/**
 * Applica un `where` minimale ma fedele: uguaglianza, `in` e `not`.
 *
 * `not` è l'unico operatore di cui questo file ha bisogno, ed è quello che decide tutto: entrambe
 * le metà della definizione di compito sono un `not`. Un finto che lo ignorasse renderebbe il file
 * verde qualunque cosa faccia `doveCompiti`.
 */
function corrisponde(riga: any, where: any): boolean {
  if (!where) return true;
  for (const [campo, condizione] of Object.entries(where)) {
    if (campo === 'tenantId') {
      if (riga.tenantId !== condizione) return false;
      continue;
    }
    const valore = riga[campo];
    if (condizione !== null && typeof condizione === 'object') {
      const c = condizione as any;
      if ('in' in c && !c.in.includes(valore)) return false;
      if ('not' in c && valore === c.not) return false;
      continue;
    }
    if (valore !== condizione) return false;
  }
  return true;
}

let microvoci: any[] = [];
let eventi: any[] = [];

const { compitiDiUtente, caricoPerRisorse, doveCompiti, oreResidue } = await import('./services/compitiAssegnati.js');
const { registraRotteCalendario } = await import('./routes/calendario.js');

beforeEach(() => {
  microvoci = microvociIniziali();
  eventi = eventiIniziali();
});

describe('cos\'è un compito, e cosa non lo è', () => {
  it('un compito finito non è un compito da fare', async () => {
    const compiti = await compitiDiUtente(TENANT, ELSA);
    expect(compiti.map(c => c.id)).not.toContain('mv-finito');
  });

  it('una micro-voce che nessuno ha preso in carico non è un compito di nessuno', async () => {
    // Le 25 ore di `mv-libero` non devono comparire in nessuno dei due numeri. **Questo test non è
    // quello che uccide la mutazione** — togliere `risorsaId` dalla clausola lo lascia verde, perché
    // `caricoPerRisorse` salta i gruppi senza risorsa comunque: è la nota in testa al file, misurata.
    // Serve a fissare il comportamento, non a dimostrare quale riga lo produce.
    const compiti = await compitiDiUtente(TENANT, ELSA);
    expect(compiti.map(c => c.id)).not.toContain('mv-libero');

    const carico = await caricoPerRisorse(TENANT, [ELSA]);
    expect(carico.get(ELSA)?.oreResidue).toBe(6); // 10-4 + 6-6, non 31
  });

  it('un compito di un altro studio non entra in nessuno dei due numeri', async () => {
    const compiti = await compitiDiUtente(TENANT, ELSA);
    expect(compiti.map(c => c.id)).not.toContain('mv-altro-studio');
  });

  it('i compiti di un altro non sono miei', async () => {
    const compiti = await compitiDiUtente(TENANT, ELSA);
    expect(compiti.map(c => c.id)).not.toContain('mv-ivan');
  });

  it('le ore residue non scendono sotto zero', () => {
    // Il consuntivo può superare il preventivo: è un fatto, non un errore di segno.
    expect(oreResidue(6, 6)).toBe(0);
    expect(oreResidue(4, 9)).toBe(0);
    expect(oreResidue(10, 4)).toBe(6);
  });

  it('la clausola esclude l\'assegnatario assente e lo stato finito, entrambi', () => {
    expect(doveCompiti(TENANT, ELSA)).toEqual({
      tenantId: TENANT,
      risorsaId: ELSA,
      stato: { not: 'done' },
    });
    expect(doveCompiti(TENANT, [ELSA, IVAN])).toEqual({
      tenantId: TENANT,
      risorsaId: { in: [ELSA, IVAN] },
      stato: { not: 'done' },
    });
  });
});

describe('la data di un compito viene dall\'evento, e non è inventata', () => {
  it('il compito pianificato porta la data del primo evento non annullato', async () => {
    const compiti = await compitiDiUtente(TENANT, ELSA);
    const pianificato = compiti.find(c => c.id === 'mv-pianificato');

    // Il **primo** dei due, non l'ultimo e non il più lontano.
    expect(pianificato?.scadenza).toBe('2026-09-24');
    expect(pianificato?.eventoId).toBe('ev-1');
  });

  it('un compito mai pianificato ha `scadenza: null`, e non una data di ripiego', async () => {
    // È la differenza fra «non ancora deciso» e «deciso male»: l'unica risposta onesta è che non
    // c'è una data. Un compito senza data non è un compito senza importanza, è un compito senza
    // scadenza — e inventargliene una è il difetto da cui tutta la fase A è nata.
    const compiti = await compitiDiUtente(TENANT, ELSA);
    const senzaData = compiti.find(c => c.id === 'mv-senza-data');

    expect(senzaData?.scadenza).toBeNull();
    expect(senzaData?.eventoId).toBeNull();
  });

  it('un evento annullato non è la data di un compito', async () => {
    // `mv-senza-data` ha un solo evento, e è annullato: senza il filtro sullo stato la sua
    // scadenza sarebbe il 1° settembre, cioè una riunione che non si fa.
    const compiti = await compitiDiUtente(TENANT, ELSA);
    expect(compiti.find(c => c.id === 'mv-senza-data')?.scadenza).toBeNull();
  });

  it('i compiti con una data vengono prima di quelli senza', async () => {
    const compiti = await compitiDiUtente(TENANT, ELSA);
    expect(compiti.map(c => c.id)).toEqual(['mv-pianificato', 'mv-senza-data']);
  });
});

describe('il criterio di accettazione di C5: la vista e il carico dicono lo stesso numero', () => {
  it('per Elsa: la lunghezza dell\'elenco e il conteggio del carico coincidono', async () => {
    const compiti = await compitiDiUtente(TENANT, ELSA);
    const carico = await caricoPerRisorse(TENANT, [ELSA]);

    expect(carico.get(ELSA)?.compitiAperti).toBe(compiti.length);
  });

  it('e coincidono anche per Ivan, che ne ha uno solo', async () => {
    // Un secondo caso non è ridondante: con un solo operatore, un conteggio che restituisse sempre
    // «tutti i compiti dello studio» darebbe lo stesso risultato. Due persone lo escludono.
    const compiti = await compitiDiUtente(TENANT, IVAN);
    const carico = await caricoPerRisorse(TENANT, [IVAN]);

    expect(compiti.map(c => c.id)).toEqual(['mv-ivan']);
    expect(carico.get(IVAN)?.compitiAperti).toBe(compiti.length);
  });

  it('e coincidono per tutti insieme: la `groupBy` non conta più della vista', async () => {
    // La forma che usa davvero il carico di lavoro: una query sola per tutti gli operatori.
    const carico = await caricoPerRisorse(TENANT, [ELSA, IVAN]);
    const perElsa = await compitiDiUtente(TENANT, ELSA);
    const perIvan = await compitiDiUtente(TENANT, IVAN);

    expect(carico.get(ELSA)?.compitiAperti).toBe(perElsa.length);
    expect(carico.get(IVAN)?.compitiAperti).toBe(perIvan.length);
  });

  it('chi non ha compiti non compare nel carico, invece di comparire con zero', async () => {
    // La differenza conta per `GET /operatori-suggeriti`: `get()` che restituisce `undefined` fa
    // usare il ripiego esplicito, mentre uno zero darebbe l'idea di un dato misurato.
    const carico = await caricoPerRisorse(TENANT, [ELSA, 'usr-senza-niente']);
    expect(carico.get('usr-senza-niente')).toBeUndefined();
  });

  it('un elenco vuoto di risorse non interroga il database', async () => {
    const carico = await caricoPerRisorse(TENANT, []);
    expect(carico.size).toBe(0);
  });
});

describe('la rotta «i miei compiti»', () => {
  async function server(ruolo: Ruolo = 'advisor', userId = ELSA) {
    const s = Fastify();
    s.addHook('onRequest', async req => {
      req.tenantId = TENANT;
      req.ruolo = ruolo;
      req.userId = userId;
      req.user = { userId, tenantId: TENANT, email: 'x@example.test', ruolo };
    });
    await registraRotteCalendario(s);
    return s;
  }

  it('elenca i compiti di chi chiede, presi dal token e non dalla query', async () => {
    const res = await (await server()).inject({ method: 'GET', url: '/calendario/compiti' });
    const body = res.json();

    expect(res.statusCode).toBe(200);
    expect(body.compiti.map((c: any) => c.id)).toEqual(['mv-pianificato', 'mv-senza-data']);
    expect(body.totale).toBe(2);
  });

  it('`totale` è la lunghezza dell\'elenco: è il numero che si confronta col carico', async () => {
    const res = await (await server('collaboratore_esterno')).inject({ method: 'GET', url: '/calendario/compiti' });
    const body = res.json();
    expect(body.totale).toBe(body.compiti.length);
  });

  it('un altro utente vede i propri, non i miei', async () => {
    const res = await (await server('collaboratore_interno', IVAN)).inject({ method: 'GET', url: '/calendario/compiti' });
    expect(res.json().compiti.map((c: any) => c.id)).toEqual(['mv-ivan']);
  });

  it('il ruolo `cliente` non ha compiti da questa rotta', async () => {
    const res = await (await server('cliente', 'client-cli-42')).inject({ method: 'GET', url: '/calendario/compiti' });
    expect(res.statusCode).toBe(403);
  });
});
