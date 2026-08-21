// Presidio del service layer del motore di stato (§16, Fase 1).
//
// `stateEngine.test.ts` copre già l'aritmetica pura. Qui si verifica ciò che il service
// aggiunge sopra: quali valori vengono mostrati, quali vengono scritti a database e — più
// importante — quali **non** vengono scritti.

import { describe, it, expect, vi, beforeEach } from 'vitest';

const stato = {
  progetto: null as any,
  elenco: [] as any[],
  microvociAggiornate: [] as any[],
  moduliAggiornati: [] as any[],
  progettiAggiornati: [] as any[],
};

vi.mock('./util/prismaClient.js', async importOriginal => {
  const reale = await importOriginal<typeof import('./util/prismaClient.js')>();

  const finto: any = {
    progetto: {
      findUnique: async () => stato.progetto,
      findMany: async () => stato.elenco,
      update: async (args: any) => {
        stato.progettiAggiornati.push(args);
        return {};
      },
    },
    moduloProgetto: {
      update: async (args: any) => {
        stato.moduliAggiornati.push(args);
        return {};
      },
    },
    microvoceProgetto: {
      update: async (args: any) => {
        stato.microvociAggiornate.push(args);
        return {};
      },
    },
    auditLog: { create: async () => ({}) },
    tenant: { findUnique: async () => null, create: async (a: any) => a.data, upsert: async (a: any) => a.update },
  };

  return { ...reale, prisma: finto, prismaAmministrativo: () => finto };
});

// Importati dopo `vi.mock`: i moduli risolvono `prismaClient.js` al proprio import.
const { calcolaAvanzamento, arricchisciProgetti, ricalcolaProgetto } = await import(
  './services/calcoloService.js'
);
const { ProgettoNonTrovatoError } = await import('./adapters/appErrors.js');
const { buildServer } = await import('./server.js');
const { InMemoryApp } = await import('./adapters/inMemoryApp.js');
const { signJwt } = await import('./util/jwt.js');

const TENANT_STUDIO = '00000000-0000-0000-0000-000000000001';

function tokenAdvisor() {
  return signJwt({
    userId: 'usr-advisor',
    tenantId: TENANT_STUDIO,
    email: 'advisor@studio.example',
    ruolo: 'advisor',
  });
}

/** Micro-voce con i soli campi che il calcolo guarda. */
function mv(stato: string, preventivate: number, consuntivate: number, id = 'mv') {
  return { id, stato, orePreventivate: preventivate, oreConsuntivate: consuntivate, segnaleRischio: false, oreExtra: 0 };
}

beforeEach(() => {
  stato.progetto = null;
  stato.elenco = [];
  stato.microvociAggiornate = [];
  stato.moduliAggiornati = [];
  stato.progettiAggiornati = [];
});

describe('calcolaAvanzamento — percentuali mostrate', () => {
  it('un progetto con tutti i moduli chiusi è al 100% e completed', () => {
    const av = calcolaAvanzamento({
      stato: 'in_progress',
      moduli: [
        { id: 'm1', stato: 'in_progress', orePreventivate: 10, microvoci: [mv('done', 10, 10)] },
        { id: 'm2', stato: 'in_progress', orePreventivate: 10, microvoci: [mv('done', 10, 12)] },
      ],
    });

    expect(av.stato).toBe('completed');
    expect(av.percentuale).toBe(100);
    expect(av.moduli.every((m) => m.percentuale === 100)).toBe(true);
  });

  it('non mostra 100% se lo stato non è completed, anche quando l’aritmetica arrotonderebbe a 100', () => {
    // Modulo con 200 ore: una micro-voce da 199 ore chiusa, una da 1 ora ancora aperta e
    // consuntivata per intero. La media pesata vale 99.5 e arrotonderebbe a 100.
    const av = calcolaAvanzamento({
      stato: 'in_progress',
      moduli: [
        {
          id: 'm1',
          stato: 'in_progress',
          orePreventivate: 200,
          microvoci: [mv('done', 199, 199, 'a'), mv('active', 1, 1, 'b')],
        },
      ],
    });

    expect(av.stato).toBe('in_progress');
    expect(av.percentuale).toBe(99);
    expect(av.moduli[0]!.percentuale).toBe(99);
  });

  it('un progetto senza moduli è a 0% e non inventa avanzamento', () => {
    const av = calcolaAvanzamento({ stato: 'in_progress', moduli: [] });
    expect(av.percentuale).toBe(0);
    expect(av.moduli).toEqual([]);
  });

  it('lascia pre_project intatto invece di dedurre in_progress da zero moduli', () => {
    const av = calcolaAvanzamento({ stato: 'pre_project', moduli: [] });
    expect(av.stato).toBe('pre_project');
  });

  it('la media del progetto pesa le ore, non conta i moduli', () => {
    // 100 ore a 0% e 10 ore a 100%: contando i moduli farebbe 50%, pesando le ore fa 9%.
    const av = calcolaAvanzamento({
      stato: 'in_progress',
      moduli: [
        { id: 'grande', stato: 'pending', orePreventivate: 100, microvoci: [mv('pending', 100, 0)] },
        { id: 'piccolo', stato: 'done', orePreventivate: 10, microvoci: [mv('done', 10, 10)] },
      ],
    });

    expect(av.percentuale).toBe(9);
  });
});

describe('calcolaAvanzamento — segnali di rischio (§16.5)', () => {
  it('alza il segnale sul progetto se una sola micro-voce sfora le ore', () => {
    const av = calcolaAvanzamento({
      stato: 'in_progress',
      moduli: [
        { id: 'm1', stato: 'in_progress', orePreventivate: 10, microvoci: [mv('active', 10, 4, 'a')] },
        { id: 'm2', stato: 'in_progress', orePreventivate: 10, microvoci: [mv('active', 10, 13, 'b')] },
      ],
    });

    expect(av.segnaleRischio).toBe(true);
    expect(av.oreExtra).toBe(3);
    expect(av.moduli.find((m) => m.id === 'm1')!.segnaleRischio).toBe(false);
    expect(av.moduli.find((m) => m.id === 'm2')!.segnaleRischio).toBe(true);
  });

  it('su una micro-voce chiusa spegne l’allarme ma continua a contare le ore sforate', () => {
    // Distinzione voluta di `valutaSegnaleRischio`: `segnaleRischio` è un allarme e serve a
    // intervenire su lavoro in corso — su una voce `done` non c'è più niente da fare, e
    // tenerlo acceso renderebbe permanente ogni allarme mai scattato. `oreExtra` invece è un
    // costo già sostenuto: resta vero dopo la chiusura, ed è il dato che serve a preventivare
    // meglio la prossima volta.
    const av = calcolaAvanzamento({
      stato: 'in_progress',
      moduli: [{ id: 'm1', stato: 'done', orePreventivate: 10, microvoci: [mv('done', 10, 30)] }],
    });

    expect(av.segnaleRischio).toBe(false);
    expect(av.oreExtra).toBe(20);
  });
});

describe('arricchisciProgetti', () => {
  it('attacca l’avanzamento a ogni progetto conservando i campi originali', () => {
    const arricchiti = arricchisciProgetti([
      {
        id: 'p1',
        nome: 'Alfa',
        stato: 'in_progress',
        moduli: [{ id: 'm1', stato: 'pending', orePreventivate: 10, microvoci: [mv('done', 10, 10)] }],
      } as any,
    ]);

    expect(arricchiti[0].nome).toBe('Alfa');
    expect(arricchiti[0].avanzamento.percentuale).toBe(100);
  });
});

describe('ricalcolaProgetto — cosa scrive a database', () => {
  it('scrive lo stato del modulo e del progetto quando la cascata li ha cambiati', async () => {
    stato.progetto = {
      id: 'p1',
      stato: 'in_progress',
      moduli: [
        {
          id: 'm1',
          stato: 'pending',
          orePreventivate: 10,
          microvoci: [{ ...mv('done', 10, 10, 'mv1') }],
        },
      ],
    };

    const av = await ricalcolaProgetto('p1');

    expect(stato.moduliAggiornati).toHaveLength(1);
    expect(stato.moduliAggiornati[0].data).toEqual({ stato: 'done' });
    expect(stato.progettiAggiornati).toHaveLength(1);
    expect(stato.progettiAggiornati[0].data).toEqual({ stato: 'completed' });
    expect(av.stato).toBe('completed');
  });

  it('non scrive nulla se lo stato calcolato coincide con quello già in riga', async () => {
    stato.progetto = {
      id: 'p1',
      stato: 'in_progress',
      moduli: [
        {
          id: 'm1',
          stato: 'in_progress',
          orePreventivate: 10,
          microvoci: [{ ...mv('active', 10, 5, 'mv1') }],
        },
      ],
    };

    await ricalcolaProgetto('p1');

    expect(stato.microvociAggiornate).toHaveLength(0);
    expect(stato.moduliAggiornati).toHaveLength(0);
    expect(stato.progettiAggiornati).toHaveLength(0);
  });

  it('persiste segnaleRischio e oreExtra sulla micro-voce che ha sforato', async () => {
    stato.progetto = {
      id: 'p1',
      stato: 'in_progress',
      moduli: [
        {
          id: 'm1',
          stato: 'in_progress',
          orePreventivate: 10,
          microvoci: [{ ...mv('active', 10, 14, 'mv1') }],
        },
      ],
    };

    await ricalcolaProgetto('p1');

    expect(stato.microvociAggiornate).toHaveLength(1);
    expect(stato.microvociAggiornate[0].where).toEqual({ id: 'mv1' });
    expect(stato.microvociAggiornate[0].data).toEqual({ segnaleRischio: true, oreExtra: 4 });
  });

  it('non tocca lo stato di una micro-voce: la cascata sale, non scende (§16.6)', async () => {
    stato.progetto = {
      id: 'p1',
      stato: 'in_progress',
      moduli: [
        {
          id: 'm1',
          stato: 'in_progress',
          orePreventivate: 10,
          microvoci: [{ ...mv('active', 10, 20, 'mv1') }],
        },
      ],
    };

    await ricalcolaProgetto('p1');

    for (const scrittura of stato.microvociAggiornate) {
      expect(scrittura.data).not.toHaveProperty('stato');
    }
  });

  it('non promuove un progetto ancora in pre_project (§16.3)', async () => {
    // Nessun modulo istanziato: `calcolaStatoProgetto` restituirebbe `in_progress`, ma il
    // passaggio da `pre_project` è una firma, non un calcolo.
    stato.progetto = { id: 'p1', stato: 'pre_project', moduli: [] };

    const av = await ricalcolaProgetto('p1');

    expect(stato.progettiAggiornati).toHaveLength(0);
    expect(av.stato).toBe('pre_project');
  });

  it('lancia ProgettoNonTrovatoError su un id inesistente', async () => {
    stato.progetto = null;
    await expect(ricalcolaProgetto('inesistente')).rejects.toThrow(ProgettoNonTrovatoError);
  });
});

describe('HTTP — l’avanzamento esce dalle rotte, non dal client', () => {
  function server() {
    return buildServer(new InMemoryApp()) as any;
  }

  it('GET /progetti allega l’avanzamento calcolato a ogni progetto', async () => {
    stato.elenco = [
      {
        id: 'p1',
        tenantId: TENANT_STUDIO,
        nome: 'Alfa',
        stato: 'in_progress',
        valoreTotale: 0,
        cliente: { nome: 'Cliente Uno' },
        moduli: [
          {
            id: 'm1',
            stato: 'pending',
            orePreventivate: 10,
            microvoci: [mv('active', 10, 5, 'mv1')],
          },
        ],
      },
    ];

    const app = server();
    const res = await app.inject({
      method: 'GET',
      url: '/progetti',
      headers: { authorization: `Bearer ${tokenAdvisor()}` },
    });
    await app.close();

    expect(res.statusCode).toBe(200);
    const corpo = JSON.parse(res.body);
    expect(corpo[0].avanzamento).toBeDefined();
    expect(corpo[0].avanzamento.percentuale).toBe(50);
    expect(corpo[0].avanzamento.stato).toBe('in_progress');
    expect(corpo[0].avanzamento.moduli[0].stato).toBe('in_progress');
  });

  it('allega segnaleRischio e oreExtra a ogni modulo, non solo al progetto', async () => {
    // Il banner della Dashboard nomina il modulo in allarme, non solo il progetto: senza
    // questi due campi per modulo la riga non si può scrivere, e prima di §16 il contatore
    // "Ritardi attivi" segnalava progetti per cui il banner non produceva nessuna riga.
    stato.elenco = [
      {
        id: 'p1',
        tenantId: TENANT_STUDIO,
        nome: 'Alfa',
        stato: 'in_progress',
        valoreTotale: 0,
        cliente: { nome: 'Cliente Uno' },
        moduli: [
          { id: 'm1', stato: 'in_progress', orePreventivate: 10, microvoci: [mv('active', 10, 4, 'mv1')] },
          { id: 'm2', stato: 'in_progress', orePreventivate: 10, microvoci: [mv('active', 10, 17, 'mv2')] },
        ],
      },
    ];

    const app = server();
    const res = await app.inject({
      method: 'GET',
      url: '/progetti',
      headers: { authorization: `Bearer ${tokenAdvisor()}` },
    });
    await app.close();

    const moduli = JSON.parse(res.body)[0].avanzamento.moduli;
    const sano = moduli.find((m: any) => m.id === 'm1');
    const sforato = moduli.find((m: any) => m.id === 'm2');

    expect(sano.segnaleRischio).toBe(false);
    expect(sano.oreExtra).toBe(0);
    expect(sforato.segnaleRischio).toBe(true);
    expect(sforato.oreExtra).toBe(7);
  });

  it('POST /progetti/:id/ricalcola restituisce l’avanzamento aggiornato', async () => {
    stato.progetto = {
      id: 'p1',
      stato: 'in_progress',
      moduli: [
        { id: 'm1', stato: 'pending', orePreventivate: 10, microvoci: [{ ...mv('done', 10, 10, 'mv1') }] },
      ],
    };

    const app = server();
    const res = await app.inject({
      method: 'POST',
      url: '/progetti/p1/ricalcola',
      headers: { authorization: `Bearer ${tokenAdvisor()}` },
    });
    await app.close();

    expect(res.statusCode).toBe(200);
    const corpo = JSON.parse(res.body);
    expect(corpo.stato).toBe('completed');
    expect(corpo.percentuale).toBe(100);
    expect(stato.moduliAggiornati[0].data).toEqual({ stato: 'done' });
  });

  it('POST /progetti/:id/ricalcola risponde 404 su un progetto inesistente', async () => {
    stato.progetto = null;

    const app = server();
    const res = await app.inject({
      method: 'POST',
      url: '/progetti/inesistente/ricalcola',
      headers: { authorization: `Bearer ${tokenAdvisor()}` },
    });
    await app.close();

    expect(res.statusCode).toBe(404);
  });

  it('POST /progetti/:id/ricalcola richiede autenticazione', async () => {
    // La rotta scrive stato di dominio: senza token non deve nemmeno arrivare al service.
    stato.progetto = { id: 'p1', stato: 'in_progress', moduli: [] };

    const app = server();
    const res = await app.inject({ method: 'POST', url: '/progetti/p1/ricalcola' });
    await app.close();

    expect(res.statusCode).toBe(401);
    expect(stato.progettiAggiornati).toHaveLength(0);
    expect(stato.moduliAggiornati).toHaveLength(0);
  });
});

describe('moduli senza micro-voci — lo stato in riga è l’unica fonte', () => {
  // Caso reale trovato sui dati di produzione: due moduli marcati `done`/`in_progress` a mano,
  // con zero micro-voci a database. `calcolaStatoModulo([])` risponde 'pending', e un ricalcolo
  // cieco li avrebbe declassati a "da iniziare" cancellando l'unica informazione esistente.

  it('mostra lo stato della riga invece di dedurre pending dal vuoto', () => {
    const av = calcolaAvanzamento({
      stato: 'in_progress',
      moduli: [
        { id: 'm1', stato: 'done', orePreventivate: 10, microvoci: [] },
        { id: 'm2', stato: 'in_progress', orePreventivate: 10, microvoci: [] },
      ],
    });

    expect(av.moduli.find((m) => m.id === 'm1')!.stato).toBe('done');
    expect(av.moduli.find((m) => m.id === 'm2')!.stato).toBe('in_progress');
  });

  it('la percentuale di un modulo vuoto segue il suo stato, non le ore che non ha', () => {
    const av = calcolaAvanzamento({
      stato: 'in_progress',
      moduli: [
        { id: 'm1', stato: 'done', orePreventivate: 10, microvoci: [] },
        { id: 'm2', stato: 'in_progress', orePreventivate: 10, microvoci: [] },
      ],
    });

    expect(av.moduli.find((m) => m.id === 'm1')!.percentuale).toBe(100);
    expect(av.moduli.find((m) => m.id === 'm2')!.percentuale).toBe(0);
    // Media pesata coerente: metà delle ore chiusa, metà aperta.
    expect(av.percentuale).toBe(50);
  });

  it('un ricalcolo NON declassa un modulo done rimasto senza micro-voci', async () => {
    stato.progetto = {
      id: 'p1',
      stato: 'in_progress',
      moduli: [{ id: 'm1', stato: 'done', orePreventivate: 10, microvoci: [] }],
    };

    const av = await ricalcolaProgetto('p1');

    expect(stato.moduliAggiornati).toHaveLength(0);
    expect(av.moduli[0]!.stato).toBe('done');
    // Tutti i moduli (l'unico) restano `done`: il progetto risulta completato, come in riga.
    expect(av.stato).toBe('completed');
  });

  it('un modulo vuoto e pending resta pending, senza scritture inutili', async () => {
    stato.progetto = {
      id: 'p1',
      stato: 'in_progress',
      moduli: [{ id: 'm1', stato: 'pending', orePreventivate: 10, microvoci: [] }],
    };

    await ricalcolaProgetto('p1');

    expect(stato.moduliAggiornati).toHaveLength(0);
    expect(stato.progettiAggiornati).toHaveLength(0);
  });
});
