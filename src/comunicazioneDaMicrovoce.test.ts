/**
 * Il messaggio che **nasce abbinato** a una micro-voce.
 *
 * Perché merita un file suo, accanto a `comunicazioniMicrovoci.test.ts` che prova il servizio. Qui si
 * prova la **rotta**, perché le due decisioni che possono fare danno non stanno nel servizio:
 *
 *   1. **chi** può scrivere da dentro una voce. Non è una formalità: `POST /progetti/:id/comunicazioni`
 *      è la rotta che usa anche il portale, e il portale ha un token in mano al cliente. Se il campo
 *      `microvoceProgettoId` passasse al ruolo `cliente`, il cliente potrebbe appendersi da sé a una
 *      voce del fascicolo — cioè decidere di cosa parla il proprio messaggio, che è esattamente la
 *      decisione che la Fase 2 gli riconosce solo toccando il link della voce;
 *   2. **di chi** è la voce. `microvoceDiProgetto` filtra su tenant e pratica, e senza quel filtro
 *      l'identificativo di una voce sarebbe un grimaldello: un messaggio di questa pratica potrebbe
 *      finire appeso a una voce di un'altra pratica, o di un altro studio, e la rotta risponderebbe
 *      «fatto».
 *
 * L'ultimo gruppo guarda l'altro verso: la scheda della micro-voce deve mostrare il **recapito**
 * proiettato, perché da quando si può scrivere da lì la domanda «è partito?» è la prima che ci si fa.
 */
import Fastify from 'fastify';
import type { Ruolo } from './util/authorization.js';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const TENANT = '00000000-0000-0000-0000-000000000001';
const PROGETTO = '00000000-0000-4000-8000-0000000000a1';
const MICROVOCE = '00000000-0000-4000-8000-0000000000b1';

/** Le righe che il finto database restituisce, e le scritture che riceve. */
const finto = {
  /** La voce come la trova `microvoceDiProgetto`: `null` = non è di questa pratica (o di questo studio). */
  microvoce: null as any,
  /** Le righe di `comunicazione_microvoce` lette per la scheda della voce. */
  abbinamenti: [] as any[],
  creati: [] as any[],
  legami: [] as any[],
};

/** Le `where` con cui si è cercata una micro-voce: è lì che vive il controllo cross-pratica. */
const ricercheVoce: any[] = [];

vi.mock('./util/prismaClient.js', async importOriginal => {
  const reale = await importOriginal<typeof import('./util/prismaClient.js')>();
  const prisma: any = {
    microvoceProgetto: {
      findFirst: async (args: any) => { ricercheVoce.push(args); return finto.microvoce; },
    },
    comunicazioneProgetto: {
      create: async (args: any) => {
        finto.creati.push(args);
        return { id: 'msg-creato', createdAt: new Date('2026-10-06T09:30:00Z'), ...args.data };
      },
    },
    comunicazioneMicrovoce: {
      create: async (args: any) => { finto.legami.push(args); return { id: 'legame-1', ...args.data }; },
      findMany: async () => finto.abbinamenti,
    },
    // La lettura che etichetta la conversazione del portale: senza, la rotta va in 500 e il rosso
    // parlerebbe di un finto incompleto invece che del codice.
    progetto: { findFirst: async () => ({ clienteId: 'cli-1' }), findUnique: async () => null },
    $transaction: async (fn: any) => fn(prisma),
  };
  return { ...reale, prisma };
});

vi.mock('./services/notificheService.js', () => ({ notificaStudio: async () => undefined }));

const { registraRotteProgetti } = await import('./routes/progetti.js');

beforeEach(() => {
  finto.microvoce = { id: MICROVOCE, nome: 'Costituzione', moduloProgettoId: 'mod-1', moduloProgetto: { progettoId: PROGETTO } };
  finto.abbinamenti = [];
  finto.creati.length = 0;
  finto.legami.length = 0;
  ricercheVoce.length = 0;
});

/**
 * Un server con le rotte dei progetti e l'identità della richiesta già impostata.
 *
 * `progettoClienteId` esiste per il caso del ruolo `cliente`, ed è una differenza che conta: su quella
 * rotta la proprietà della pratica si controlla **prima** del campo voce, e una pratica altrui risponde
 * 404 — cioè il cliente non arriva nemmeno a farsi rifiutare il campo. Per vedere il 403 bisogna
 * quindi passare da una pratica **sua**, che è poi il caso reale: il portale scrive sulla propria.
 */
async function server(
  ruolo: Ruolo = 'advisor',
  opzioni: { clienteId?: string; progettoClienteId?: string } = {},
) {
  const s = Fastify();
  const userId = opzioni.clienteId ? `client-${opzioni.clienteId}` : 'usr-1';
  s.addHook('onRequest', async req => {
    req.tenantId = TENANT;
    req.ruolo = ruolo;
    req.userId = userId;
    // Il payload completo, non solo l'id: `req.user` è un `JwtPayload`, e riempirlo a metà
    // costringerebbe il lettore a chiedersi quali campi la rotta usi davvero. Nessuno di questi
    // tre è inventato — sono il tenant, il ruolo e l'indirizzo della richiesta che il test ha
    // appena costruito.
    req.user = { userId, tenantId: TENANT, email: `${userId}@studio.it`, ruolo };
  });
  await registraRotteProgetti(s, {
    getProgetto: async () =>
      opzioni.progettoClienteId ? { clienteId: opzioni.progettoClienteId } : null,
  } as any);
  return s;
}

const messaggio = (extra: Record<string, unknown> = {}) => ({
  canale: 'portal',
  mittente: 'Studio',
  destinatario: 'Cliente',
  direzione: 'uscita',
  testo: 'Procedo con la costituzione.',
  ...extra,
});

describe('scrivere da dentro una micro-voce', () => {
  it('il messaggio nasce abbinato, e l\'origine è `microvoce` — non `manuale`', async () => {
    // `manuale` sarebbe la bugia da evitare, e non è solo questione di parola: la metrica con cui si
    // deciderà la Fase 3 legge `manuale` come «il residuo che l'operatore ha dovuto sistemare a
    // mano». Contarci un messaggio nato legato la falserebbe in su, e la decisione si prenderebbe su
    // un numero gonfiato.
    const s = await server();
    const res = await s.inject({ method: 'POST', url: `/progetti/${PROGETTO}/comunicazioni`, payload: messaggio({ microvoceProgettoId: MICROVOCE }) });

    expect(res.statusCode).toBe(201);
    expect(finto.legami).toHaveLength(1);
    expect(finto.legami[0].data).toMatchObject({
      tenantId: TENANT,
      comunicazioneId: 'msg-creato',
      microvoceProgettoId: MICROVOCE,
      origine: 'microvoce',
    });
    await s.close();
  });

  it('la voce si cerca dentro questa pratica e questo studio', async () => {
    // La `where` è la difesa: senza il `progettoId` e il `tenantId`, l'id di una voce basta ad
    // appendere un messaggio al fascicolo di un'altra pratica — o di un altro studio.
    const s = await server();
    await s.inject({ method: 'POST', url: `/progetti/${PROGETTO}/comunicazioni`, payload: messaggio({ microvoceProgettoId: MICROVOCE }) });

    expect(ricercheVoce[0].where).toEqual({ id: MICROVOCE, tenantId: TENANT });
    // E il confronto con la pratica è la seconda metà del controllo: `microvoceDiProgetto` risale
    // voce → modulo → progetto e rifiuta la voce che appartiene a un'altra.
    expect(finto.microvoce.moduloProgetto.progettoId).toBe(PROGETTO);
    await s.close();
  });

  it('una voce che non è di questa pratica è rifiutata, e non si scrive niente', async () => {
    finto.microvoce = null; // la risalita voce → modulo → progetto non la trova in questa pratica

    const s = await server();
    const res = await s.inject({ method: 'POST', url: `/progetti/${PROGETTO}/comunicazioni`, payload: messaggio({ microvoceProgettoId: MICROVOCE }) });

    expect(res.statusCode).toBe(400);
    // Nemmeno il messaggio: un rifiuto a metà lascerebbe nel fascicolo una riga non abbinata che
    // l'operatore credeva scritta dentro la voce.
    expect(finto.creati).toHaveLength(0);
    expect(finto.legami).toHaveLength(0);
    await s.close();
  });

  it('il ruolo cliente non può scrivere da dentro una voce', async () => {
    // Il portale usa questa stessa rotta. Qui il cliente *può* scrivere — sulla **propria** pratica,
    // ed è per questo che il progetto si finge suo: su una pratica altrui la rotta risponde 404 e il
    // 403 non verrebbe mai raggiunto, cioè il test proverebbe il controllo sbagliato. Ma non può dire
    // di quale voce parla: quella decisione la prende toccando il link (`origine: 'contesto'`), non
    // scrivendolo nel corpo della richiesta.
    const s = await server('cliente', { clienteId: 'cli-1', progettoClienteId: 'cli-1' });
    const res = await s.inject({ method: 'POST', url: `/progetti/${PROGETTO}/comunicazioni`, payload: messaggio({ microvoceProgettoId: MICROVOCE }) });

    expect(res.statusCode).toBe(403);
    expect(finto.creati).toHaveLength(0);
    expect(finto.legami).toHaveLength(0);
    await s.close();
  });

  it('su una pratica che non è sua il cliente non arriva nemmeno al 403: risponde 404', async () => {
    // L'ordine dei controlli è deliberato, e vale la pena fissarlo: la proprietà della pratica si
    // verifica **prima** del campo voce. Così il codice di risposta non diventa un modo per scoprire
    // quali pratiche esistono — un 403 su una pratica altrui direbbe «esiste, ma non è tua».
    const s = await server('cliente', { clienteId: 'cli-1', progettoClienteId: 'cli-ALTRO' });
    const res = await s.inject({ method: 'POST', url: `/progetti/${PROGETTO}/comunicazioni`, payload: messaggio({ microvoceProgettoId: MICROVOCE }) });

    expect(res.statusCode).toBe(404);
    expect(finto.creati).toHaveLength(0);
    expect(finto.legami).toHaveLength(0);
    await s.close();
  });

  it('senza il campo non cambia niente: il messaggio nasce sciolto, come prima', async () => {
    const s = await server();
    const res = await s.inject({ method: 'POST', url: `/progetti/${PROGETTO}/comunicazioni`, payload: messaggio() });

    expect(res.statusCode).toBe(201);
    expect(finto.creati).toHaveLength(1);
    expect(finto.legami).toHaveLength(0);
    await s.close();
  });

  it('due invii sono due messaggi, e nessuno dei due nasce sciolto', async () => {
    // Il doppio clic su una rete lenta è il caso normale: due righe in `comunicazione_progetto`,
    // non una. Ciò che non deve succedere è che una delle due resti senza legame — il messaggio
    // comparirebbe nella chat e non nella voce da cui è stato scritto.
    const s = await server();
    await s.inject({ method: 'POST', url: `/progetti/${PROGETTO}/comunicazioni`, payload: messaggio({ microvoceProgettoId: MICROVOCE }) });
    await s.inject({ method: 'POST', url: `/progetti/${PROGETTO}/comunicazioni`, payload: messaggio({ microvoceProgettoId: MICROVOCE }) });

    expect(finto.creati).toHaveLength(2);
    expect(finto.legami).toHaveLength(2);
    expect(finto.legami.every(l => l.data.origine === 'microvoce')).toBe(true);
    await s.close();
  });
});

describe('la scheda della micro-voce mostra il recapito, non la materia prima', () => {
  const riga = (externalId: string | null, direzione: string, createdAt = new Date('2026-10-06T09:30:00Z')) => ({
    origine: 'microvoce',
    comunicazione: {
      id: 'msg-1', canale: 'portal', mittente: 'Studio', destinatario: 'Cliente',
      direzione, testo: 'Procedo.', createdAt, allegatiJson: null, externalId,
    },
  });

  it('un messaggio scritto da qui in attesa lo dichiara, con il motivo del rifiuto quando c\'è', async () => {
    finto.abbinamenti = [riga(JSON.stringify({ stato: 'non-inviato', errore: 'Meta: numero non registrato' }), 'uscita')];

    const s = await server();
    const res = await s.inject({ method: 'GET', url: `/microvoci/${MICROVOCE}/comunicazioni` });

    expect(res.statusCode).toBe(200);
    const [msg] = res.json().messaggi;
    expect(msg.stato).toBe('non-inviato');
    expect(msg.errore).toBe('Meta: numero non registrato');
    // `externalId` non esce: porta anche le chiavi di idempotenza del provider, che sono materia
    // prima del server e non un dato da mandare al browser.
    expect(msg.externalId).toBeUndefined();
    await s.close();
  });

  it('una riga muta resta muta, invece di diventare consegnata', async () => {
    // È il ripiego che disegnava le due spunte blu su messaggi che nessun canale aveva accettato.
    finto.abbinamenti = [riga(null, 'uscita')];

    const s = await server();
    const res = await s.inject({ method: 'GET', url: `/microvoci/${MICROVOCE}/comunicazioni` });

    const [msg] = res.json().messaggi;
    expect(msg.stato).toBeNull();
    expect(msg.consegnatoAt).toBeNull();
    await s.close();
  });

  it('in entrata è consegnato, e la data è quella dell\'arrivo', async () => {
    finto.abbinamenti = [riga('telegram:12345', 'entrata')];

    const s = await server();
    const res = await s.inject({ method: 'GET', url: `/microvoci/${MICROVOCE}/comunicazioni` });

    const [msg] = res.json().messaggi;
    expect(msg.stato).toBe('consegnato');
    expect(msg.consegnatoAt).toBe('2026-10-06T09:30:00.000Z');
    await s.close();
  });

  it('una voce che non è di questo studio risponde 404, non una lista vuota', async () => {
    // Una lista vuota direbbe «su questa voce non ha scritto nessuno», che è una cosa diversa da
    // «questa voce non esiste qui» — e la differenza conta su un fascicolo.
    finto.microvoce = null;

    const s = await server();
    const res = await s.inject({ method: 'GET', url: `/microvoci/${MICROVOCE}/comunicazioni` });

    expect(res.statusCode).toBe(404);
    await s.close();
  });
});
