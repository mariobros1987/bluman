/**
 * Il calendario: le cinque rotte.
 *
 * Perché un file nuovo e non un'aggiunta a `progetti.ts`. Il calendario non appartiene a nessuna
 * delle entità che aggrega — legge rate, rinnovi KYC, scadenze di progetti e contratti, e le mette
 * nella stessa griglia. Appenderlo a `progetti.ts` avrebbe voluto dire che il permesso del
 * calendario è il permesso dei progetti, che è falso: un evento `fattura` dipende dallo scadenzario
 * e uno `kyc` dall'anagrafica clienti.
 *
 * **La regola che queste rotte non violano mai, e il modo in cui è scritta.** Nessuna rotta accetta
 * dal corpo o dalla query un `userId` con cui decidere di chi sono gli eventi: il proprietario è
 * sempre `req.user.userId`, cioè il token. L'unico parametro che tocca quell'asse è `?assegnatiA=me`,
 * che è la stringa letterale `me` e non un identificatore — non esiste una forma di quella richiesta
 * che chieda il calendario di un altro. E non è una restrizione per prudenza: chiedere il calendario
 * di un altro, per chi non può vederlo, non deve rispondere 403 con un messaggio che rivela che
 * quell'altro esiste. Deve rispondere un insieme vuoto, che è indistinguibile da «non ha eventi».
 *
 * Le regole di visibilità stanno in `src/util/calendarioVisibilita.ts` (pure, verificabili una per
 * una) e la lettura delle sorgenti in `src/services/calendarioEventi.ts`. Qui resta l'HTTP:
 * parametri, validazione, codici di stato, audit.
 */
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { prisma } from '../util/prismaClient.js';
import { recordAudit } from '../util/serverHelpers.js';
import {
  assegnatarioDiEvento,
  categorieVisibili,
  eventiDelCalendario,
  fineGiornoUtc,
  inizioGiornoUtc,
} from '../services/calendarioEventi.js';
import { compitiDiUtente } from '../services/compitiAssegnati.js';
import {
  CATEGORIE_EVENTO,
  categoriaValida,
  type CategoriaEventoCalendario,
} from '../util/calendarioVisibilita.js';
import type { Ruolo } from '../util/authorization.js';

/**
 * Le categorie che si possono **scrivere a mano**, e perché sono queste tre.
 *
 * `kyc`, `fattura` e `progetto` derivano da una riga che esiste altrove — `cliente.data_kyc`, una
 * rata, `progetto.data_scadenza`. Scriverne una a mano significherebbe creare un evento che
 * sopravvive alla modifica della sua presunta sorgente, cioè una seconda verità: il calendario
 * direbbe il 15 marzo e il progetto direbbe il 20, e nessuno saprebbe quale delle due è il piano.
 * Chi vuole spostare la scadenza di un progetto la sposta **nel progetto**, che è dove va spostata.
 *
 * `contratto` è la prima eccezione, ed è deliberata. La sua sorgente è `contratto_ricorrente`, ma non
 * ogni scadenza contrattuale è un contratto ricorrente: una lettera d'incarico da rinnovare, un
 * rinnovo verso un fornitore, un termine che si conosce prima che qualcuno abbia inserito il
 * contratto in anagrafica. Vietando `contratto` quelle scadenze finirebbero scritte come
 * `promemoria` — dove sono visibili **solo a chi le ha scritte**, che per una scadenza contrattuale è
 * il posto sbagliato per un motivo preciso: è la stessa ragione per cui la categoria `progetto` è
 * stata aggiunta invece di riusare `promemoria`.
 *
 * **`microvoce` è la seconda eccezione, ed è stata aggiunta in §1ter.5 (B6) — perché mancava.**
 * La prima stesura di questo elenco conteneva due categorie e il commento ne elencava tre come
 * derivate (`kyc`, `fattura`, `progetto`): `microvoce` non compariva in nessuna delle due liste. Non
 * è una svista di scrittura, è un buco, e si vede dalla parte dell'utente: **nessun generatore
 * produce un evento `microvoce`** — le sorgenti derivate sono rate, KYC, progetti e contratti — e la
 * rotta lo rifiutava in scrittura, quindi la scheda «⚡ Microvoci Progetto» del calendario non poteva
 * ricevere niente da nessuno. Un filtro che si può selezionare e non restituisce mai niente è la
 * promessa non mantenuta che il resto di questo file evita con cura.
 *
 * La differenza fra `microvoce` e le tre categorie derivate è che un compito **non ha una sorgente
 * da cui dedurre una data**: la scadenza di una micro-voce non esiste in `microvoce_progetto`, che
 * non ha una colonna di scadenza. La fissa una persona, ed è per questo che è scrivibile. Ma è
 * scrivibile **solo insieme al compito a cui appartiene** — vedi il controllo più sotto: un evento
 * `microvoce` senza `microvoceProgettoId` sarebbe un compito di niente, e il legame resterebbe
 * affidato al titolo, che si perde alla prima rinomina.
 */
const CATEGORIE_SCRIVIBILI = ['promemoria', 'contratto', 'microvoce'] as const;
type CategoriaScrivibile = (typeof CATEGORIE_SCRIVIBILI)[number];

/**
 * Il predicato di tipo, e non un `.includes` seguito da un cast.
 *
 * `.includes` restituisce `boolean`, quindi dopo il controllo la variabile è ancora `string` e
 * bisogna affermare con un `as` che è una delle due — cioè spegnere il compilatore proprio dove
 * serve che resti acceso. Il predicato sposta l'affermazione dentro una funzione che il compilatore
 * verifica, e da lì in poi il tipo è ristretto davvero.
 */
function categoriaScrivibile(valore: unknown): valore is CategoriaScrivibile {
  return typeof valore === 'string' && (CATEGORIE_SCRIVIBILI as readonly string[]).includes(valore);
}

/** I valori che `stato` può assumere in `PATCH /:id/stato`. Sono quelli dell'enum, non altri. */
const STATI_EVENTO = ['da_fare', 'fatto', 'annullato'] as const;
type StatoEvento = (typeof STATI_EVENTO)[number];

const PRIORITA_EVENTO = ['alta', 'media', 'normale'] as const;
type PrioritaEvento = (typeof PRIORITA_EVENTO)[number];

/**
 * Un intervallo oltre l'anno non si serve, e la ragione è che non serve a nessuno.
 *
 * La griglia mostra un mese; il massimo uso sensato è «l'anno», per una vista annuale. Oltre, la
 * richiesta smette di essere una lettura e diventa un export — e un export di tutti gli eventi di
 * tutti i clienti è una cosa che va progettata come tale, con i suoi permessi, non ottenuta
 * allungando un parametro. Il limite è qui perché un limite implicito è un limite che si scopre
 * in produzione sotto forma di timeout.
 */
const GIORNI_MASSIMI_INTERVALLO = 366;

/** Errore con codice di stato, per non ripetere `reply.code(...).send(...)` a ogni controllo. */
function rifiuta(risposta: FastifyReply, stato: number, errore: string) {
  return risposta.code(stato).send({ errore });
}

/**
 * Un istante da un parametro di query, o `null` se non è una data.
 *
 * Accetta sia `2026-09-17` sia un ISO completo. Non usa `Date.parse` direttamente perché
 * `Date.parse('2026')` è valido — è il primo gennaio — e un parametro scritto male che diventa una
 * data plausibile è peggio di un parametro rifiutato.
 */
function istanteDaParametro(valore: unknown): Date | null {
  if (typeof valore !== 'string' || valore.trim() === '') return null;
  const testo = valore.trim();
  if (!/^\d{4}-\d{2}-\d{2}([T ].*)?$/.test(testo)) return null;
  const d = new Date(testo);
  return Number.isNaN(d.getTime()) ? null : d;
}

/**
 * L'intervallo chiesto, o quello del mese corrente.
 *
 * `da` e `a` sono **giorni civili**: chi chiede `a=2026-09-30` vuole tutto il 30 settembre, non
 * fino alle 00:00 del 30. Per questo il limite superiore viene spinto a fine giornata invece di
 * essere usato com'è — un errore di un giorno che, in un calendario, è l'errore che si nota per
 * primo e si diagnostica per ultimo.
 */
function intervalloChiesto(
  query: Record<string, unknown>,
  adesso: Date,
): { ok: true; da: Date; a: Date } | { ok: false; errore: string } {
  const daGrezzo = query['da'];
  const aGrezzo = query['a'];

  if (daGrezzo === undefined && aGrezzo === undefined) {
    const anno = adesso.getUTCFullYear();
    const mese = adesso.getUTCMonth();
    return {
      ok: true,
      da: new Date(Date.UTC(anno, mese, 1)),
      // Il giorno 0 del mese successivo è l'ultimo giorno di questo: nessun anno bisestile da
      // conoscere, nessuna tabella di trenta giorni da sbagliare.
      a: fineGiornoUtc(new Date(Date.UTC(anno, mese + 1, 0))),
    };
  }

  const da = istanteDaParametro(daGrezzo);
  const a = istanteDaParametro(aGrezzo);
  const inizio = da ? inizioGiornoUtc(da) : null;
  const fine = a ? fineGiornoUtc(a) : null;

  if (daGrezzo !== undefined && !inizio) return { ok: false, errore: 'Parametro «da» non valido: serve una data (AAAA-MM-GG).' };
  if (aGrezzo !== undefined && !fine) return { ok: false, errore: 'Parametro «a» non valido: serve una data (AAAA-MM-GG).' };
  if (!inizio || !fine) return { ok: false, errore: 'Servono entrambi gli estremi: «da» e «a».' };
  if (fine < inizio) return { ok: false, errore: 'L\'intervallo è rovesciato: «a» precede «da».' };

  const giorni = (fine.getTime() - inizio.getTime()) / 86_400_000;
  if (giorni > GIORNI_MASSIMI_INTERVALLO) {
    return {
      ok: false,
      errore: `Intervallo troppo ampio: il massimo è ${GIORNI_MASSIMI_INTERVALLO} giorni.`,
    };
  }

  return { ok: true, da: inizio, a: fine };
}

/**
 * Le categorie chieste, o tutte quelle che il ruolo può vedere.
 *
 * Due rifiuti diversi per due errori diversi, e la distinzione conta:
 *
 * - un nome **inesistente** è un difetto del chiamante, e va detto (400) — ignorarlo in silenzio
 *   produrrebbe un calendario vuoto senza che nessuno sappia perché;
 * - una categoria **esistente ma non consentita** non è un errore: si restringe, e la risposta
 *   contiene solo le altre. È la regola 2 di §1ter.3 — il filtro per categoria restringe, non
 *   allarga — e vale anche al contrario: chiedere ciò che non si può vedere restituisce vuoto, non
 *   i dati e nemmeno un messaggio che confermi che esistono.
 */
function categorieChieste(
  query: Record<string, unknown>,
  permesse: readonly CategoriaEventoCalendario[],
): { ok: true; categorie: CategoriaEventoCalendario[] } | { ok: false; errore: string } {
  const grezzo = query['categorie'];
  if (grezzo === undefined || grezzo === '') return { ok: true, categorie: [...permesse] };

  if (typeof grezzo !== 'string') return { ok: false, errore: 'Parametro «categorie» non valido.' };

  const chieste = grezzo
    .split(',')
    .map((c) => c.trim())
    .filter((c) => c !== '');

  const ignote = chieste.filter((c) => !categoriaValida(c));
  if (ignote.length > 0) {
    return {
      ok: false,
      errore: `Categorie non riconosciute: ${ignote.join(', ')}. Quelle valide sono: ${CATEGORIE_EVENTO.join(', ')}.`,
    };
  }

  const valide = chieste as CategoriaEventoCalendario[];
  return { ok: true, categorie: valide.filter((c) => permesse.includes(c)) };
}

/**
 * Se l'id identifica una riga **derivata**, e di che categoria.
 *
 * Gli id derivati sono prefissati (`fattura:<uuid>`) proprio per poter essere riconosciuti qui: una
 * modifica o una cancellazione su un id derivato deve rispondere «questa scadenza non è un evento
 * che si scrive, viene da una rata», e non «non trovato». Sono due rimedi diversi — il secondo
 * manderebbe chi legge a cercare un permesso o un id sbagliato, quando il problema è che quella
 * riga non è mai esistita in nessuna tabella.
 */
function categoriaDerivata(id: string): string | null {
  const separatore = id.indexOf(':');
  if (separatore <= 0) return null;
  const prefisso = id.slice(0, separatore);
  return CATEGORIE_EVENTO.includes(prefisso as CategoriaEventoCalendario) ? prefisso : null;
}

/** Il messaggio con cui si spiega perché una scadenza derivata non si tocca da qui. */
function messaggioDerivato(categoria: string): string {
  const sorgente: Record<string, string> = {
    kyc: 'la data KYC del cliente',
    fattura: 'la scadenza della rata',
    progetto: 'la data di scadenza del progetto',
    contratto: 'la prossima fatturazione del contratto',
  };
  return `Questa è una scadenza derivata: non è un evento scritto a mano, quindi non si modifica e non si cancella da qui. Si cambia ${sorgente[categoria] ?? 'la sua sorgente'}, e il calendario la mostra aggiornata alla prossima lettura.`;
}

export async function registraRotteCalendario(server: FastifyInstance): Promise<void> {
  /**
   * Gli eventi dell'intervallo, con le scadenze derivate dentro.
   *
   * La risposta porta anche `categorie`, cioè ciò che **questo** utente può chiedere. Non è un
   * dettaglio di comodo: l'interfaccia può così costruire i filtri da ciò che è permesso invece di
   * elencare le sei categorie e lasciarne selezionare cinque che torneranno vuote. Un filtro che si
   * può selezionare e non restituisce mai niente è una promessa non mantenuta, e l'utente la
   * interpreta come «non c'è niente in calendario», non come «non ti è consentito».
   */
  server.get('/calendario/eventi', async (req: FastifyRequest, reply: FastifyReply) => {
    const ruolo = req.ruolo as Ruolo | undefined;
    const userId = req.user?.userId;
    if (!ruolo || !userId) return rifiuta(reply, 401, 'Non autenticato.');

    const adesso = new Date();
    const intervallo = intervalloChiesto(req.query as Record<string, unknown>, adesso);
    if (!intervallo.ok) return rifiuta(reply, 400, intervallo.errore);

    const grezzoAssegnati = (req.query as Record<string, unknown>)['assegnatiA'];
    if (grezzoAssegnati !== undefined && grezzoAssegnati !== 'me') {
      // Solo `me`. Accettare un id significherebbe accettare dal client l'asse dell'identità, che è
      // la cosa che queste rotte non fanno mai: vedi l'intestazione del file.
      return rifiuta(reply, 400, 'Parametro «assegnatiA» accetta il solo valore «me».');
    }

    const permesse = await categorieVisibili(req.tenantId, userId, ruolo);
    const categorie = categorieChieste(req.query as Record<string, unknown>, permesse);
    if (!categorie.ok) return rifiuta(reply, 400, categorie.errore);

    /**
     * Filtro per progetto, per lo scadenzario dentro il fascicolo.
     *
     * Senza, la scheda di un progetto dovrebbe chiedere la griglia di **tutto lo studio** su una
     * finestra scelta a naso e poi scartarne la maggior parte nel browser: una finestra arbitraria
     * che, se il progetto dura più a lungo, perde le scadenze in silenzio. Qui è una condizione in
     * più nella query, e la scheda chiede esattamente quello che mostra.
     *
     * L'appartenenza allo studio è già garantita dal `tenantId` che `eventiDelCalendario` filtra
     * sempre: un id di un altro studio non allarga la lettura, la restringe a zero righe.
     */
    const grezzoProgetto = (req.query as Record<string, unknown>)['progettoId'];
    const progettoId = typeof grezzoProgetto === 'string' && grezzoProgetto.trim() !== ''
      ? grezzoProgetto.trim()
      : null;

    const eventi = await eventiDelCalendario({
      tenantId: req.tenantId,
      userId,
      ruolo,
      da: intervallo.da,
      a: intervallo.a,
      categorie: categorie.categorie,
      soloAssegnatiAMe: grezzoAssegnati === 'me',
      progettoId,
      adesso,
    });

    return reply.send({
      ok: true,
      eventi,
      intervallo: { da: intervallo.da.toISOString(), a: intervallo.a.toISOString() },
      categorie: permesse,
    });
  });

  /**
   * §1ter.6 (C5) — «i miei compiti», cioè le micro-voci che ho addosso.
   *
   * **Perché una rotta e non un filtro di `/calendario/eventi`.** Un compito e un evento non sono la
   * stessa cosa, e la differenza si vede proprio qui: un compito esiste anche **senza una data**,
   * perché la data di una micro-voce non sta in `microvoce_progetto` — quella tabella non ha una
   * colonna di scadenza — sta nell'evento che qualcuno ha scritto per lui. Un compito mai
   * pianificato non comparirebbe in nessuna griglia, e sarebbe invisibile proprio a chi deve farlo.
   * Questa rotta lo elenca lo stesso, con `scadenza: null`, che è la verità: non è ancora stato
   * deciso quando.
   *
   * **L'assegnazione è ciò che lo rende mio**, e non serve un secondo controllo di accesso: chi ha
   * un compito lo vede, perché assegnarlo a qualcuno che non può vederlo è un'assegnazione che non
   * esiste (§1ter.3). Il titolare della riga non c'entra — `userId` qui è **l'assegnatario**, e non
   * si accetta dalla query: è il token, come in tutte le rotte di questo file.
   *
   * **Nessun filtro per ruolo**: un `collaboratore_esterno` ha i suoi compiti come un `advisor`. Il
   * ruolo decide *quali categorie* vede nel calendario (§1ter.3), non se il proprio lavoro esiste.
   *
   * Il numero che questa rotta restituisce — `totale`, cioè la lunghezza dell'elenco — è **lo stesso
   * numero** che `caricoPerRisorse` conta per la stessa persona: sono la stessa clausola `where` di
   * `src/services/compitiAssegnati.ts`, una elencata e una contata. È il criterio di accettazione di
   * C5, ed è verificato in `src/compitiAssegnati.test.ts`.
   */
  server.get('/calendario/compiti', async (req: FastifyRequest, reply: FastifyReply) => {
    const ruolo = req.ruolo as Ruolo | undefined;
    const userId = req.user?.userId;
    if (!ruolo || !userId) return rifiuta(reply, 401, 'Non autenticato.');
    if (ruolo === 'cliente') return rifiuta(reply, 403, 'Non disponibile per questo ruolo.');

    const compiti = await compitiDiUtente(req.tenantId, userId);

    return reply.send({ ok: true, compiti, totale: compiti.length });
  });

  /**
   * Crea un promemoria (o una scadenza contrattuale, vedi `CATEGORIE_SCRIVIBILI`).
   *
   * `generato` è `false` e non è un parametro: una riga scritta da una persona non è derivata, e
   * lasciar decidere al client se lo è significherebbe permettergli di marcare come derivato un
   * proprio promemoria — cioè di renderlo non cancellabile. Il flag descrive la provenienza della
   * riga, e la provenienza la conosce solo chi la crea, che è questo codice.
   */
  server.post('/calendario/eventi', async (req: FastifyRequest, reply: FastifyReply) => {
    const ruolo = req.ruolo as Ruolo | undefined;
    const userId = req.user?.userId;
    if (!ruolo || !userId) return rifiuta(reply, 401, 'Non autenticato.');

    const corpo = (req.body ?? {}) as Record<string, unknown>;

    const titolo = typeof corpo['titolo'] === 'string' ? corpo['titolo'].trim() : '';
    if (!titolo) return rifiuta(reply, 400, 'Il titolo è obbligatorio.');
    if (titolo.length > 200) return rifiuta(reply, 400, 'Il titolo supera i 200 caratteri.');

    const inizio = istanteDaParametro(corpo['dataInizio']);
    if (!inizio) return rifiuta(reply, 400, '«dataInizio» mancante o non valida.');
    // Un evento senza fine è un evento di un istante: la fine coincide con l'inizio. Chiederla
    // obbligatoria sposterebbe sul client una convenzione che è del server.
    const fine = corpo['dataFine'] === undefined || corpo['dataFine'] === null
      ? inizio
      : istanteDaParametro(corpo['dataFine']);
    if (!fine) return rifiuta(reply, 400, '«dataFine» non valida.');
    if (fine < inizio) return rifiuta(reply, 400, '«dataFine» precede «dataInizio».');

    /**
     * Il compito da cui l'evento nasce, letto **prima** della categoria.
     *
     * L'ordine conta: `microvoce` è scrivibile solo insieme a questo riferimento, quindi la
     * decisione sulla categoria non si può prendere senza averlo già in mano.
     */
    const microvoceProgettoId =
      typeof corpo['microvoceProgettoId'] === 'string' && corpo['microvoceProgettoId'].trim() !== ''
        ? corpo['microvoceProgettoId']
        : null;

    const grezzaCategoria = corpo['categoria'];
    const categoria = grezzaCategoria === undefined ? 'promemoria' : grezzaCategoria;
    if (!categoriaScrivibile(categoria)) {
      // Le categorie sono diventate tre con B6: `join(' e ')` produceva «promemoria e contratto e
      // microvoce», che si legge male. L'elenco semplice è anche quello che un messaggio d'errore
      // deve essere.
      return rifiuta(
        reply,
        400,
        `Categoria non scrivibile a mano: si possono creare ${CATEGORIE_SCRIVIBILI.join(', ')}. Le altre derivano da una sorgente — si cambia quella, e il calendario si aggiorna.`,
      );
    }

    /**
     * Un compito senza il compito a cui appartiene non è un compito.
     *
     * `microvoce` è l'unica categoria scrivibile che non ha una sorgente da cui dedurre la data —
     * la scadenza la fissa una persona — e il riferimento è ciò che la tiene ancorata al
     * fascicolo. Senza, resterebbe il solo titolo a dire di che cosa si tratta, e il titolo cambia.
     */
    if (categoria === 'microvoce' && !microvoceProgettoId) {
      return rifiuta(
        reply,
        400,
        'Un evento «microvoce» deve indicare il compito a cui appartiene («microvoceProgettoId»): senza quel riferimento il legame col fascicolo resterebbe affidato al solo titolo.',
      );
    }

    const grezzaPriorita = corpo['priorita'];
    const priorita: PrioritaEvento =
      grezzaPriorita === undefined ? 'normale' : (grezzaPriorita as PrioritaEvento);
    if (!PRIORITA_EVENTO.includes(priorita)) {
      return rifiuta(reply, 400, `Priorità non valida: ${PRIORITA_EVENTO.join(', ')}.`);
    }

    // I due riferimenti sono facoltativi ma, se ci sono, devono essere di questo studio. Senza il
    // controllo, un id di un altro tenant verrebbe scritto e poi reso invisibile dalla RLS: la riga
    // esisterebbe, non si vedrebbe, e nessuno capirebbe perché è sparita.
    const clienteId = typeof corpo['clienteId'] === 'string' ? corpo['clienteId'] : null;
    if (clienteId) {
      const esiste = await prisma.cliente.findFirst({
        where: { id: clienteId, tenantId: req.tenantId },
        select: { id: true },
      });
      if (!esiste) return rifiuta(reply, 404, 'Cliente non trovato in questo studio.');
    }

    const progettoId = typeof corpo['progettoId'] === 'string' ? corpo['progettoId'] : null;
    if (progettoId) {
      const esiste = await prisma.progetto.findFirst({
        where: { id: progettoId, tenantId: req.tenantId },
        select: { id: true },
      });
      if (!esiste) return rifiuta(reply, 404, 'Progetto non trovato in questo studio.');
    }

    /**
     * §1ter.5 (B6) — il compito da cui l'evento nasce.
     *
     * Il modale di pianificazione del fascicolo scrive un promemoria **a partire da una
     * micro-voce**: è quella che l'operatore ha davanti quando decide la data. Senza questa
     * colonna il legame esiste solo nella testata dell'evento — «📄 Scadenza Presentazione
     * Documento / Atto» e il nome del compito dentro il titolo — e si perde alla prima modifica
     * del nome: la scadenza resta, orfana, e nessuno sa più a cosa si riferiva.
     *
     * La verifica di studio è la stessa degli altri riferimenti, e per la stessa ragione: senza,
     * l'uuid di un compito di un altro studio verrebbe scritto e poi reso invisibile dalla RLS —
     * la riga esisterebbe, non si vedrebbe, e nessuno capirebbe perché è sparita.
     */
    if (microvoceProgettoId) {
      const microvoce = await prisma.microvoceProgetto.findFirst({
        where: { id: microvoceProgettoId, tenantId: req.tenantId },
        select: { id: true },
      });
      if (!microvoce) return rifiuta(reply, 404, 'Compito non trovato in questo studio.');
    }

    const assegnatoAId = typeof corpo['assegnatoAId'] === 'string' ? corpo['assegnatoAId'] : null;
    if (assegnatoAId) {
      // `tenantId` nullable nel datamodel perché un super_admin non appartiene a uno studio: la
      // condizione è «stesso studio», e per un super_admin non c'è uno studio a cui appartenere.
      const assegnatario = await prisma.user.findFirst({
        where: { id: assegnatoAId, tenantId: req.tenantId },
        select: { id: true },
      });
      if (!assegnatario) return rifiuta(reply, 404, 'Collaboratore non trovato in questo studio.');
    }

    /**
     * §1ter.6 (C5) — l'assegnatario di un compito lo porta il **compito**, non l'evento.
     *
     * Fino a qui questa rotta scriveva `evento_calendario.assegnato_a_id`, mentre l'assegnazione del
     * fascicolo (`PUT /progetti/:id/stato-completo`, C3) scrive `microvoce_progetto.risorsa_id`, e il
     * carico di lavoro conta quella. Due schermate, due colonne, un solo concetto di «chi lo fa»: il
     * giorno in cui le due scelte divergono, il compito risulta assegnato a due persone diverse a
     * seconda di dove lo si guarda — e nessuna delle due schermate ha torto in modo dimostrabile.
     *
     * Quindi la persona si scrive **sulla micro-voce**, e la colonna dell'evento resta `null`. Non è
     * una rinuncia a un dato: è che quel dato non è dell'evento. La data è dell'evento, la persona è
     * del compito, e `assegnatarioDiEvento` ricompone le due cose in lettura — la stessa funzione che
     * usa la lettura del calendario e l'autorizzazione di `PATCH /:id/stato`.
     *
     * **Cosa questo non fa**: non *toglie* un'assegnazione. Un corpo senza `assegnatoAId` (o con
     * `null`) non azzera `risorsa_id`, perché `null` non distingue «non assegnare» da «non parlarne»
     * e indovinare cancellerebbe un'assegnazione fatta dal fascicolo. Si toglie da dove si mette:
     * `PUT /progetti/:id/stato-completo`.
     */
    let assegnatoAIdEvento = assegnatoAId;
    if (categoria === 'microvoce' && microvoceProgettoId && assegnatoAId) {
      await prisma.microvoceProgetto.updateMany({
        where: { id: microvoceProgettoId, tenantId: req.tenantId },
        data: { risorsaId: assegnatoAId },
      });
      assegnatoAIdEvento = null;
    }

    const note = typeof corpo['note'] === 'string' && corpo['note'].trim() !== '' ? corpo['note'] : null;
    const luogoUrl = typeof corpo['luogoUrl'] === 'string' && corpo['luogoUrl'].trim() !== '' ? corpo['luogoUrl'] : null;

    const creato = await prisma.eventoCalendario.create({
      data: {
        tenantId: req.tenantId,
        userId,
        assegnatoAId: assegnatoAIdEvento,
        progettoId,
        clienteId,
        microvoceProgettoId,
        titolo,
        dataInizio: inizio,
        dataFine: fine,
        categoria,
        priorita,
        note,
        luogoUrl,
        generato: false,
      },
      select: { id: true },
    });

    await recordAudit({
      tenantId: req.tenantId,
      userId,
      userEmail: req.user?.email,
      ruolo: req.ruolo as string | undefined,
      azione: 'EVENTO_CALENDARIO_CREATO',
      entita: 'EventoCalendario',
      dettagli: `Evento ${creato.id} «${titolo}» (${categoria}) il ${inizio.toISOString()}` +
        // L'assegnazione di un compito è una scrittura su un'altra tabella: senza questa riga,
        // l'audit direbbe che è stato creato un evento e non che è stato assegnato un compito.
        (categoria === 'microvoce' && assegnatoAId && microvoceProgettoId
          ? ` — compito ${microvoceProgettoId} assegnato a ${assegnatoAId}`
          : ''),
      ipAddress: req.ip,
    });

    return reply.code(201).send({ ok: true, id: creato.id });
  });

  /**
   * Modifica un evento scritto a mano.
   *
   * Solo il proprietario della riga, e la scelta è deliberata. L'assegnatario può **segnare fatto**
   * un compito (`PATCH /:id/stato`, più sotto) perché è quello il senso di assegnarglielo; ma
   * riscrivere il titolo, le date e le note di un evento altrui no. Chi ha assegnato il compito ha
   * scritto una richiesta, e il richiedente è l'unico che può cambiarla.
   *
   * «Non tuo» e «non esiste» danno la stessa risposta, 404. Distinguerli direbbe a un collaboratore
   * esterno che quell'id esiste nel suo studio, che è un'informazione che non gli serve e che non
   * deve avere.
   */
  server.put('/calendario/eventi/:id', async (req: FastifyRequest, reply: FastifyReply) => {
    const ruolo = req.ruolo as Ruolo | undefined;
    const userId = req.user?.userId;
    if (!ruolo || !userId) return rifiuta(reply, 401, 'Non autenticato.');

    const { id } = req.params as { id: string };
    const derivata = categoriaDerivata(id);
    if (derivata) return rifiuta(reply, 409, messaggioDerivato(derivata));

    const corpo = (req.body ?? {}) as Record<string, unknown>;

    const esistente = await prisma.eventoCalendario.findFirst({
      where: { id, tenantId: req.tenantId },
      select: { id: true, userId: true, dataInizio: true, dataFine: true, note: true, luogoUrl: true },
    });
    if (!esistente || esistente.userId !== userId) return rifiuta(reply, 404, 'Evento non trovato.');

    const dati: Record<string, unknown> = {};

    if (corpo['titolo'] !== undefined) {
      const titolo = typeof corpo['titolo'] === 'string' ? corpo['titolo'].trim() : '';
      if (!titolo) return rifiuta(reply, 400, 'Il titolo non può essere vuoto.');
      if (titolo.length > 200) return rifiuta(reply, 400, 'Il titolo supera i 200 caratteri.');
      dati['titolo'] = titolo;
    }

    if (corpo['dataInizio'] !== undefined) {
      const inizio = istanteDaParametro(corpo['dataInizio']);
      if (!inizio) return rifiuta(reply, 400, '«dataInizio» non valida.');
      dati['dataInizio'] = inizio;
    }

    if (corpo['dataFine'] !== undefined) {
      const fine = istanteDaParametro(corpo['dataFine']);
      if (!fine) return rifiuta(reply, 400, '«dataFine» non valida.');
      dati['dataFine'] = fine;
    }

    // Il confronto si fa sui valori **risultanti**, non su quelli inviati: spostare solo l'inizio
    // oltre la fine esistente è un intervallo rovesciato quanto inviarli entrambi rovesciati.
    const inizioFinale = (dati['dataInizio'] as Date | undefined) ?? esistente.dataInizio;
    const fineFinale = (dati['dataFine'] as Date | undefined) ?? esistente.dataFine;
    if (fineFinale < inizioFinale) return rifiuta(reply, 400, '«dataFine» precede «dataInizio».');

    if (corpo['priorita'] !== undefined) {
      const priorita = corpo['priorita'] as PrioritaEvento;
      if (!PRIORITA_EVENTO.includes(priorita)) {
        return rifiuta(reply, 400, `Priorità non valida: ${PRIORITA_EVENTO.join(', ')}.`);
      }
      dati['priorita'] = priorita;
    }

    // `note` e `luogoUrl` si possono **svuotare**: `null` è un valore, `undefined` è «non toccare».
    // Una PUT che non distinguesse i due renderebbe impossibile cancellare una nota.
    if ('note' in corpo) {
      dati['note'] = typeof corpo['note'] === 'string' && corpo['note'].trim() !== '' ? corpo['note'] : null;
    }
    if ('luogoUrl' in corpo) {
      dati['luogoUrl'] = typeof corpo['luogoUrl'] === 'string' && corpo['luogoUrl'].trim() !== '' ? corpo['luogoUrl'] : null;
    }

    if ('assegnatoAId' in corpo) {
      const assegnatoAId = typeof corpo['assegnatoAId'] === 'string' && corpo['assegnatoAId'] !== '' ? corpo['assegnatoAId'] : null;
      if (assegnatoAId) {
        const assegnatario = await prisma.user.findFirst({
          where: { id: assegnatoAId, tenantId: req.tenantId },
          select: { id: true },
        });
        if (!assegnatario) return rifiuta(reply, 404, 'Collaboratore non trovato in questo studio.');
      }
      dati['assegnatoAId'] = assegnatoAId;
    }

    if (Object.keys(dati).length === 0) {
      return rifiuta(reply, 400, 'Nessun campo da modificare.');
    }

    await prisma.eventoCalendario.updateMany({ where: { id, tenantId: req.tenantId }, data: dati });

    await recordAudit({
      tenantId: req.tenantId,
      userId,
      userEmail: req.user?.email,
      ruolo: req.ruolo as string | undefined,
      azione: 'EVENTO_CALENDARIO_MODIFICATO',
      entita: 'EventoCalendario',
      dettagli: `Evento ${id}: modificati ${Object.keys(dati).join(', ')}`,
      ipAddress: req.ip,
    });

    return reply.send({ ok: true, id });
  });

  /**
   * Cambia lo stato: `da_fare` ⇄ `fatto` ⇄ `annullato`.
   *
   * Questa rotta sostituisce `handleToggleComplete` di `CalendarPage.tsx`, che cambiava lo stato in
   * memoria e non lo scriveva da nessuna parte: la casella si spuntava, si ricaricava la pagina, e
   * il compito tornava da fare. È il difetto che questa rotta esiste per chiudere.
   *
   * Qui l'assegnatario **può**, il proprietario può, e nessun altro: è il solo punto in cui i due
   * assi — di chi è la riga, chi deve farla — si toccano, ed è giusto che sia questo.
   */
  server.patch('/calendario/eventi/:id/stato', async (req: FastifyRequest, reply: FastifyReply) => {
    const ruolo = req.ruolo as Ruolo | undefined;
    const userId = req.user?.userId;
    if (!ruolo || !userId) return rifiuta(reply, 401, 'Non autenticato.');

    const { id } = req.params as { id: string };
    const derivata = categoriaDerivata(id);
    if (derivata) return rifiuta(reply, 409, messaggioDerivato(derivata));

    const corpo = (req.body ?? {}) as Record<string, unknown>;
    const stato = corpo['stato'];
    if (typeof stato !== 'string' || !(STATI_EVENTO as readonly string[]).includes(stato)) {
      return rifiuta(reply, 400, `Stato non valido: ${STATI_EVENTO.join(', ')}.`);
    }

    const esistente = await prisma.eventoCalendario.findFirst({
      where: { id, tenantId: req.tenantId },
      select: {
        id: true, userId: true, assegnatoAId: true, stato: true, categoria: true,
        // C5 (§1ter.6): per un compito l'assegnatario sta sulla micro-voce. La scrittura deve
        // leggere la stessa colonna della lettura, altrimenti l'assegnatario vede un compito che
        // non può spuntare — la contraddizione che §1ter.3 racconta di aver già trovato una volta.
        microvoceProgetto: { select: { risorsaId: true } },
      },
    });
    if (!esistente) return rifiuta(reply, 404, 'Evento non trovato.');

    const assegnatario = assegnatarioDiEvento(esistente);
    if (esistente.userId !== userId && assegnatario !== userId) {
      return rifiuta(reply, 404, 'Evento non trovato.');
    }

    if (esistente.stato === stato) return reply.send({ ok: true, id, stato, invariato: true });

    await prisma.eventoCalendario.updateMany({
      where: { id, tenantId: req.tenantId },
      data: { stato: stato as StatoEvento },
    });

    await recordAudit({
      tenantId: req.tenantId,
      userId,
      userEmail: req.user?.email,
      ruolo: req.ruolo as string | undefined,
      azione: 'EVENTO_CALENDARIO_STATO',
      entita: 'EventoCalendario',
      dettagli: `Evento ${id}: ${esistente.stato} → ${stato}`,
      ipAddress: req.ip,
    });

    return reply.send({ ok: true, id, stato });
  });

  /**
   * Cancella un evento scritto a mano.
   *
   * Solo le righe con `generato = false`. Un evento derivato non si cancella perché non esiste come
   * riga: cancellarlo vorrebbe dire nascondere una rata che resta dovuta, un KYC che resta da
   * rinnovare, un progetto che resta da consegnare. La scadenza sparirebbe dal calendario e
   * continuerebbe a esistere nel database — che è il modo più affidabile di non rispettarla.
   *
   * La risposta dice quale dei due casi è, ma **dopo** aver verificato che la riga sia di chi
   * chiede: prima si stabilisce il diritto, poi si spiega. Al contrario si userebbe il messaggio
   * come oracolo per sapere se una riga altrui esiste ed è derivata.
   */
  server.delete('/calendario/eventi/:id', async (req: FastifyRequest, reply: FastifyReply) => {
    const ruolo = req.ruolo as Ruolo | undefined;
    const userId = req.user?.userId;
    if (!ruolo || !userId) return rifiuta(reply, 401, 'Non autenticato.');

    const { id } = req.params as { id: string };
    const derivata = categoriaDerivata(id);
    if (derivata) return rifiuta(reply, 409, messaggioDerivato(derivata));

    const esistente = await prisma.eventoCalendario.findFirst({
      where: { id, tenantId: req.tenantId },
      select: { id: true, userId: true, generato: true, titolo: true, categoria: true },
    });
    if (!esistente || esistente.userId !== userId) return rifiuta(reply, 404, 'Evento non trovato.');

    if (esistente.generato) {
      return rifiuta(reply, 409, messaggioDerivato(esistente.categoria));
    }

    // `deleteMany` e non `delete`: `delete` vuole l'id unico e non accetta il `tenantId` come
    // condizione, quindi l'isolamento riposerebbe sulla sola RLS. Con `deleteMany` la condizione di
    // tenant è nella query, dove si può leggere — e la RLS resta la seconda rete, non l'unica.
    await prisma.eventoCalendario.deleteMany({ where: { id, tenantId: req.tenantId } });

    await recordAudit({
      tenantId: req.tenantId,
      userId,
      userEmail: req.user?.email,
      ruolo: req.ruolo as string | undefined,
      azione: 'EVENTO_CALENDARIO_CANCELLATO',
      entita: 'EventoCalendario',
      dettagli: `Evento ${id} «${esistente.titolo}» (${esistente.categoria}) cancellato`,
      ipAddress: req.ip,
    });

    return reply.send({ ok: true });
  });
}
