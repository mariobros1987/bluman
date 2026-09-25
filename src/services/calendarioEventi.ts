/**
 * Le sorgenti del calendario: la tabella `evento_calendario`, e le quattro derivazioni.
 *
 * Perché è un servizio e non codice dentro la rotta. La rotta parla HTTP — parametri, codici di
 * stato, audit — e questo file parla database: chi ha diritto a cosa (§1ter.3), quali righe
 * esistono, e quali scadenze **non** esistono in tabella perché si calcolano. Sono due
 * responsabilità, e mescolarle produce un file che nessuno può leggere fino in fondo.
 *
 * **La decisione che orienta tutto il file: la derivazione è l'unica verità per le quattro
 * categorie derivate.** Un evento `kyc` non è una riga da qualche parte — è `cliente.data_kyc` più
 * la regola di `scadenzeDerivate.ts`, calcolato a ogni lettura. Vale per `fattura` (`scadenza_incasso`),
 * `progetto` (`progetto.data_scadenza`) e `contratto` (`contratto_ricorrente.prossima_fatturazione`).
 *
 * La conseguenza è che il calendario **non può mentire**: se una scadenza cambia nella sua sorgente,
 * il calendario la mostra cambiata alla lettura successiva, senza che nessuno abbia dovuto
 * sincronizzare niente. Il costo è che «genera gli eventi del calendario» non è un lavoro che si fa
 * una volta — non c'è niente da generare. È la scelta opposta a quella di materializzare le righe,
 * ed è quella che rende impossibile la classe di difetto che questa sessione sta togliendo dal resto
 * dell'applicazione: due copie di un dato che divergono.
 *
 * Resta scritto qui perché vada detto: quando la fase C materializzerà delle righe (per esempio per
 * assegnare un compito a una micro-voce), quelle righe **non devono duplicare** una sorgente già
 * derivata. Una riga `generato = true` con `categoria = 'fattura'` comparirebbe accanto alla
 * derivazione della stessa rata, e il calendario mostrerebbe due volte la stessa scadenza. L'unico
 * modo di distinguerle sarebbe una colonna che punta alla rata, che oggi non esiste: finché non
 * esiste, la regola è che si materializzano solo le categorie che non si derivano.
 */
import { prisma } from '../util/prismaClient.js';
import {
  accessiCopronoMicrovoce,
  accessiCopronoProgetto,
  categoriePerRuolo,
  vedeTuttiIProgetti,
  type AccessiUtente,
  type CategoriaEventoCalendario,
} from '../util/calendarioVisibilita.js';
import { kycInAvviso, rinnovoKyc, statoScadenza } from '../util/scadenzeDerivate.js';
import { revisioneKycDovuta, dataRevisioneKyc } from '../domain/monitoraggioKyc.js';
import type { Ruolo } from '../util/authorization.js';

/**
 * Lo stato di un evento come lo vede l'interfaccia.
 *
 * È l'unione di due vocabolari, e non è un'unione di comodo: `da_fare`, `fatto`, `annullato` sono
 * lo stato **persistito** di una riga scritta da qualcuno, e solo chi l'ha scritta può cambiarlo.
 * `scaduta` e `fatta` sono lo stato **calcolato** di una scadenza derivata, che nessuno ha scritto
 * e che quindi nessuno può cambiare da qui: si cambia nella sorgente. Confonderli in un solo campo
 * senza questa nota porterebbe a chiedersi perché il pulsante «segna come fatto» non c'è su una
 * rata — e la risposta è che non c'è perché non servirebbe a niente.
 */
export type StatoEventoVista = 'da_fare' | 'fatto' | 'annullato' | 'scaduta' | 'fatta';

export interface EventoVista {
  /**
   * Prefissato per le righe derivate — `kyc:<uuid>`, `fattura:<uuid>`, `progetto:<uuid>`,
   * `contratto:<uuid>` — e un uuid nudo per le righe di tabella.
   *
   * Il prefisso ha uno scopo preciso: un id derivato **non è modificabile né cancellabile**, e la
   * rotta deve poterlo riconoscere e rifiutare con un messaggio che spiega perché, invece di
   * cercare quella stringa in `evento_calendario` e rispondere «non trovato» — che manderebbe chi
   * legge a cercare un permesso mancante quando il problema è che quella riga non è mai esistita.
   */
  id: string;
  titolo: string;
  dataInizio: string;
  dataFine: string;
  categoria: CategoriaEventoCalendario;
  stato: StatoEventoVista;
  priorita: 'alta' | 'media' | 'normale';
  note: string | null;
  luogoUrl: string | null;
  generato: boolean;
  assegnatoAId: string | null;
  assegnatoANome: string | null;
  progettoId: string | null;
  clienteId: string | null;
  clienteNome: string | null;
  /** Solo per le rate: l'importo, grezzo in centesimi, perché lo formatti l'interfaccia. */
  importoCentesimi: number | null;
  /** L'uuid della riga sorgente, per le derivate: serve ad aprire la pratica da cui vengono. */
  origineId: string | null;
}

/**
 * L'ora del giorno a cui si colloca una scadenza derivata: mezzogiorno UTC.
 *
 * Non è un dettaglio estetico. Una scadenza è una **data civile** — «il 15 marzo» — e il database la
 * conserva come istante. Collocarla a mezzanotte significa che a Roma, che d'estate è UTC+2, quelle
 * mezzanotte si legge come le 02:00 del giorno stesso (bene) ma un client che formatta in UTC la
 * legge come il giorno prima (male). A mezzogiorno UTC l'istante cade nello stesso giorno civile in
 * ogni fuso che va da UTC−11 a UTC+11, quindi anche a Roma, anche a Londra, anche in un browser che
 * non ha ancora applicato l'ora legale. Il margine di ±11 ore è ciò che rende la scelta noiosa, ed è
 * esattamente quello che serve.
 */
const ORA_SCADENZA_UTC = 12;

/** Un istante al giorno UTC che contiene `data`, alle 12:00. Vedi `ORA_SCADENZA_UTC`. */
function aMezzogiornoUtc(data: Date): Date {
  return new Date(
    Date.UTC(data.getUTCFullYear(), data.getUTCMonth(), data.getUTCDate(), ORA_SCADENZA_UTC),
  );
}

/** Il primo istante del giorno UTC che contiene `istante`. */
export function inizioGiornoUtc(istante: Date): Date {
  return new Date(
    Date.UTC(istante.getUTCFullYear(), istante.getUTCMonth(), istante.getUTCDate(), 0, 0, 0, 0),
  );
}

/** L'ultimo istante del giorno UTC che contiene `istante`. */
export function fineGiornoUtc(istante: Date): Date {
  return new Date(
    Date.UTC(istante.getUTCFullYear(), istante.getUTCMonth(), istante.getUTCDate(), 23, 59, 59, 999),
  );
}

/**
 * Le categorie che il ruolo può vedere in questo studio.
 *
 * La matrice permessi entra qui e non nel modulo puro `calendarioVisibilita.ts`, che non può
 * interrogare il database: un evento `fattura` deriva da una rata, cioè dal modulo **scadenzario**,
 * e uno studio che ha tolto quello scadenzario a un utente non deve ritrovarlo nel calendario.
 * Senza questa lettura la regola «un evento eredita la visibilità della sua sorgente» sarebbe vera
 * per il ruolo e falsa per la matrice — cioè vera a metà, che è il modo peggiore di essere vera.
 */
export async function categorieVisibili(
  tenantId: string,
  userId: string,
  ruolo: Ruolo,
): Promise<CategoriaEventoCalendario[]> {
  let contabilitaNegata = false;

  if (ruolo !== 'cliente' && ruolo !== 'super_admin') {
    const permesso = await prisma.permessoModulo.findUnique({
      where: { tenantId_userId_moduloChiave: { tenantId, userId, moduloChiave: 'scadenzario' } },
      select: { livello: true },
    });
    contabilitaNegata = permesso?.livello === 'denied';
  }

  return categoriePerRuolo(ruolo, { contabilitaNegata });
}

/**
 * Le risorse su cui l'utente ha una riga in `accesso_risorsa`, **espanse verso l'alto**.
 *
 * L'espansione è la parte da non sbagliare, e la ragione è nello schema: `microvoce_progetto` non
 * ha un `progetto_id`. Una micro-voce sta in un modulo, il modulo sta in un progetto, e per sapere
 * su quale progetto è un utente a cui è stata assegnata una micro-voce bisogna risalire due volte.
 * Se non si risalisse, un evento a livello di progetto resterebbe invisibile a chi ha accesso a una
 * sua micro-voce — cioè esattamente alla persona che quel progetto lo sta lavorando.
 *
 * Restituisce `null` quando il ruolo vede tutti i progetti: non è «nessun accesso», è «il controllo
 * non serve», e distinguerli evita di scrivere una condizione che nega l'accesso a chi ce l'ha per
 * ruolo. Un `NESSUN_ACCESSO` usato come ripiego produrrebbe un calendario vuoto per un advisor — un
 * guasto silenzioso, che è la cosa peggiore che questa funzione possa fare.
 */
async function accessiDi(tenantId: string, userId: string): Promise<AccessiUtente> {
  const righe = await prisma.accessoRisorsa.findMany({
    where: { tenantId, userId },
    select: {
      progettoId: true,
      moduloProgettoId: true,
      microvoceProgettoId: true,
      moduloProgetto: { select: { progettoId: true } },
      microvoceProgetto: { select: { moduloProgettoId: true, moduloProgetto: { select: { progettoId: true } } } },
    },
  });

  const progetti = new Set<string>();
  const moduli = new Set<string>();
  const microvoci = new Set<string>();

  for (const r of righe) {
    if (r.progettoId) progetti.add(r.progettoId);
    if (r.moduloProgettoId) {
      moduli.add(r.moduloProgettoId);
      if (r.moduloProgetto) progetti.add(r.moduloProgetto.progettoId);
    }
    if (r.microvoceProgettoId) {
      microvoci.add(r.microvoceProgettoId);
      const mv = r.microvoceProgetto;
      if (mv) {
        moduli.add(mv.moduloProgettoId);
        progetti.add(mv.moduloProgetto.progettoId);
      }
    }
  }

  return { progetti, moduli, microvoci };
}

export interface ChiediEventi {
  tenantId: string;
  userId: string;
  ruolo: Ruolo;
  /** Estremi dell'intervallo, già normalizzati a giorno UTC da `inizioGiornoUtc`/`fineGiornoUtc`. */
  da: Date;
  a: Date;
  /** Le categorie chieste, già intersecate con quelle visibili al ruolo. */
  categorie: readonly CategoriaEventoCalendario[];
  /** `true` per «solo i compiti assegnati a me»: filtra sull'assegnatario, non sul proprietario. */
  soloAssegnatiAMe: boolean;
  /**
   * Restringe a un solo progetto: è il filtro dello scadenzario dentro il fascicolo.
   *
   * Vale solo per le righe di `evento_calendario` — le uniche che hanno un `progettoId` scritto.
   * Le rate in attesa e i rinnovi KYC derivano da sorgenti che il progetto non lo nominano, e
   * quando si chiede un progetto si chiede la sua agenda, non quella dello studio: vengono
   * quindi escluse invece di essere incluse «per sicurezza», che riempirebbe la scheda di
   * scadenze che non le appartengono.
   */
  progettoId?: string | null;
  adesso: Date;
}

/** Un evento di tabella, arricchito di ciò che serve a decidere se mostrarlo. */
interface RigaConContesto {
  id: string;
  titolo: string;
  dataInizio: Date;
  dataFine: Date;
  categoria: CategoriaEventoCalendario;
  stato: 'da_fare' | 'fatto' | 'annullato';
  priorita: 'alta' | 'media' | 'normale';
  note: string | null;
  luogoUrl: string | null;
  generato: boolean;
  userId: string;
  assegnatoAId: string | null;
  assegnatoA: { nome: string | null; email: string } | null;
  progettoId: string | null;
  moduloProgettoId: string | null;
  microvoceProgettoId: string | null;
  moduloProgetto: { progettoId: string } | null;
  /**
   * Il compito da cui l'evento nasce, quando ne ha uno.
   *
   * Esiste per una ragione sola, ed è C5 di §1ter.6: **l'assegnatario di un compito è la
   * micro-voce, non l'evento.** L'evento porta una data; chi deve fare il lavoro sta su
   * `microvoce_progetto.risorsa_id`, che è la stessa colonna che il carico di lavoro somma e che
   * `PUT /progetti/:id/stato-completo` scrive (C3). Finché questa relazione non era selezionata, il
   * calendario rispondeva alla domanda «è assegnato a me?» leggendo `evento_calendario.assegnato_a_id`
   * — una colonna **diversa**, scritta da un'altra schermata — e le due risposte potevano
   * contraddirsi senza che nessuna delle due fosse dimostrabilmente sbagliata.
   */
  microvoceProgetto: {
    risorsaId: string | null;
    stato: string;
    risorsa: { nome: string | null; email: string } | null;
  } | null;
  clienteId: string | null;
  cliente: { nome: string } | null;
}

/**
 * Chi deve fare questa riga — **la definizione unica**, usata dalla lettura e dalla scrittura.
 *
 * Per un evento `microvoce` la risposta è l'assegnatario del **compito** (`microvoce_progetto.
 * risorsa_id`): un compito è una micro-voce con una risorsa, e la data è un attributo che qualcuno
 * gli ha messo sopra. Per le altre categorie la risposta è `assegnato_a_id`, che è l'assegnazione
 * dell'evento — un promemoria affidato a qualcuno non ha un compito sotto di sé.
 *
 * **Perché una funzione e non due righe ripetute.** Questa stessa domanda si fa in tre posti: chi
 * può *vedere* la riga (`rigaVisibile`), chi può *cambiarla* (`PATCH /calendario/eventi/:id/stato`)
 * e cosa si *mostra* all'utente (`eventoDaRiga`). Se i tre non rispondessero allo stesso modo, un
 * assegnatario vedrebbe un compito e non potrebbe spuntarlo — la contraddizione che §1ter.3
 * racconta di aver già trovato una volta fra lettura e scrittura, quando la lettura ammetteva il
 * solo proprietario e la scrittura anche l'assegnatario.
 */
export function assegnatarioDiEvento(riga: {
  categoria: CategoriaEventoCalendario;
  assegnatoAId: string | null;
  microvoceProgetto?: { risorsaId: string | null } | null;
}): string | null {
  if (riga.categoria === 'microvoce') return riga.microvoceProgetto?.risorsaId ?? null;
  return riga.assegnatoAId;
}

/** Il nome da mostrare per l'assegnatario, quando c'è. */
function nomeAssegnatario(riga: RigaConContesto): string | null {
  if (riga.categoria === 'microvoce') {
    const r = riga.microvoceProgetto?.risorsa;
    return r ? r.nome ?? r.email : null;
  }
  return riga.assegnatoA?.nome ?? riga.assegnatoA?.email ?? null;
}

/**
 * Se una riga di `evento_calendario` va mostrata a chi sta chiedendo.
 *
 * **Prima i due assi dell'identità, poi la categoria.** La riga appartiene a `userId` — è nel suo
 * calendario — e può essere affidata a un assegnatario — è lui che deve farla. Entrambi devono
 * vederla, e non è una concessione: assegnare un compito a qualcuno che non può vederlo è
 * un'assegnazione che non esiste. Che sia un secondo cancello e non il primo conta, perché la
 * scrittura (`PATCH /:id/stato`) ammette esattamente queste due persone: se la lettura ne
 * ammettesse una sola, l'assegnatario potrebbe cambiare lo stato di una riga che non vede.
 *
 * **L'assegnatario lo dice `assegnatarioDiEvento`, e non è un dettaglio di stile** (C5, §1ter.6):
 * per un compito è la micro-voce a portare la persona, non l'evento. Chiamare qui la stessa funzione
 * che chiama la scrittura è ciò che rende impossibile la contraddizione descritta sopra.
 *
 * Il secondo cancello, per le categorie che appartengono a una sorgente, è l'appartenenza:
 *
 * - `microvoce` e `progetto` → l'accesso al progetto, al modulo o alla micro-voce. Che un utente sia
 *   interno allo studio non lo mette sul team di ogni pratica, e il calendario di una pratica non è
 *   un elenco telefonico.
 * - `kyc`, `fattura` e `contratto` → nessun secondo cancello **oltre al ruolo**, che è già stato
 *   applicato in `categorieVisibili`. La loro sorgente non ha un team: un rinnovo KYC appartiene
 *   allo studio, non a una persona. Ed è per questo che l'assegnazione non li apre a nessuno: le
 *   tre categorie non sono nemmeno nel `chieste` di chi non può vederle, quindi una riga `fattura`
 *   assegnata a un collaboratore esterno non verrebbe mai interrogata.
 * - `promemoria` → nessuno dei due assi: se non è tuo e non ti è stato assegnato, è di un altro.
 */
function rigaVisibile(
  riga: RigaConContesto,
  chiedi: ChiediEventi,
  accessi: AccessiUtente | null,
): boolean {
  const assegnatario = assegnatarioDiEvento(riga);

  if (chiedi.soloAssegnatiAMe && assegnatario !== chiedi.userId) return false;

  if (riga.userId === chiedi.userId) return true;
  if (assegnatario !== null && assegnatario === chiedi.userId) return true;

  switch (riga.categoria) {
    case 'promemoria':
      return false;

    case 'microvoce':
      if (accessi === null) return true;
      return accessiCopronoMicrovoce(accessi, {
        progettoId: riga.progettoId ?? riga.moduloProgetto?.progettoId ?? null,
        moduloProgettoId: riga.moduloProgettoId,
        microvoceProgettoId: riga.microvoceProgettoId,
      });

    case 'progetto':
      if (accessi === null) return true;
      return accessiCopronoProgetto(accessi, riga.progettoId);

    case 'kyc':
    case 'fattura':
    case 'contratto':
      return true;
  }
}

/** L'evento da mostrare, a partire da una riga di tabella già ritenuta visibile. */
function eventoDaRiga(riga: RigaConContesto): EventoVista {
  return {
    id: riga.id,
    titolo: riga.titolo,
    dataInizio: riga.dataInizio.toISOString(),
    dataFine: riga.dataFine.toISOString(),
    categoria: riga.categoria,
    stato: riga.stato,
    priorita: riga.priorita,
    note: riga.note,
    luogoUrl: riga.luogoUrl,
    generato: riga.generato,
    assegnatoAId: assegnatarioDiEvento(riga),
    assegnatoANome: nomeAssegnatario(riga),
    progettoId: riga.progettoId,
    clienteId: riga.clienteId,
    clienteNome: riga.cliente?.nome ?? null,
    importoCentesimi: null,
    origineId: null,
  };
}

/**
 * Tutti gli eventi visibili nell'intervallo, derivazioni comprese.
 *
 * L'ordine delle operazioni non è arbitrario: prima si sa **cosa** si può guardare (`categorie`),
 * poi si guarda. Derivare tutto e filtrare alla fine funzionerebbe oggi e smetterebbe di funzionare
 * il giorno in cui qualcuno aggiunge una sorgente dimenticandosi il filtro: chiedere solo quello che
 * serve rende quell'omissione impossibile invece che improbabile.
 */
export async function eventiDelCalendario(chiedi: ChiediEventi): Promise<EventoVista[]> {
  const { tenantId, userId, ruolo, da, a, categorie, progettoId = null, adesso } = chiedi;
  const chieste = new Set<string>(categorie);
  const eventi: EventoVista[] = [];

  // `null` significa «vede tutto per ruolo» e salta il controllo di appartenenza; vedi `accessiDi`.
  const accessi = vedeTuttiIProgetti(ruolo) ? null : await accessiDi(tenantId, userId);

  /**
   * Un evento appartiene a un progetto per **tre** strade diverse, e il filtro le copre tutte.
   *
   * `progettoId` è quella diretta. Le altre due esistono perché un evento può nascere da un modulo
   * o da una micro-voce senza che chi lo ha creato riempia anche la colonna del progetto — e
   * chiedere il progetto della scheda deve restituire l'agenda di quel progetto, non l'agenda di
   * chi ha compilato tutti i campi. Un filtro sull'unica colonna diretta avrebbe mostrato una
   * scheda vuota per le attività pianificate dal fascicolo, che sono esattamente quelle che la
   * scheda esiste per mostrare.
   */
  const delProgetto = progettoId
    ? {
        OR: [
          { progettoId },
          { moduloProgetto: { progettoId } },
          { microvoceProgetto: { moduloProgetto: { progettoId } } },
        ],
      }
    : {};

  // ── 1. Le righe scritte da qualcuno: promemoria, e ciò che la fase C materializzerà ──────────
  if (chieste.size > 0) {
    const righe = await prisma.eventoCalendario.findMany({
      // Sovrapposizione, non contenimento: un evento di tre giorni che comincia il 30 settembre
      // appartiene anche alla griglia di ottobre, e un filtro `dataInizio fra da e a` lo perderebbe.
      where: { tenantId, dataInizio: { lte: a }, dataFine: { gte: da }, ...delProgetto },
      select: {
        id: true, titolo: true, dataInizio: true, dataFine: true, categoria: true, stato: true,
        priorita: true, note: true, luogoUrl: true, generato: true, userId: true,
        assegnatoAId: true, assegnatoA: { select: { nome: true, email: true } },
        progettoId: true, moduloProgettoId: true, microvoceProgettoId: true,
        moduloProgetto: { select: { progettoId: true } },
        // Il compito, per sapere chi deve farlo: vedi `assegnatarioDiEvento`. La `risorsa` è
        // selezionata per il nome da mostrare, perché l'assegnatario di un compito non ha una
        // colonna `assegnato_a` da cui leggerlo.
        microvoceProgetto: {
          select: {
            risorsaId: true,
            stato: true,
            risorsa: { select: { nome: true, email: true } },
          },
        },
        clienteId: true, cliente: { select: { nome: true } },
      },
    });

    for (const riga of righe) {
      const r = riga as RigaConContesto;
      if (!chieste.has(r.categoria)) continue;
      if (rigaVisibile(r, chiedi, accessi)) eventi.push(eventoDaRiga(r));
    }
  }

  // ── 2. Le rate in attesa (A5): la scadenza è della singola rata, non della fattura ───────────
  // Il difetto che questo sostituisce: la pagina leggeva `fattura.dataEmissione`, che è il giorno in
  // cui la fattura è stata emessa. Una fattura a 30 giorni produceva quindi un evento sbagliato di
  // trenta giorni — e nessuno se ne accorgeva, perché una data c'era.
  //
  // Il filtro di progetto passa dalla fattura, che è l'unica a sapere per quale incarico è stata
  // emessa: una rata di una fattura di questo progetto è una scadenza di questo progetto.
  if (chieste.has('fattura')) {
    const rate = await prisma.scadenzaIncasso.findMany({
      where: {
        tenantId,
        stato: 'in_attesa',
        dataScadenza: { gte: da, lte: a },
        ...(progettoId ? { fattura: { progettoId } } : {}),
      },
      select: {
        id: true, numeroRata: true, importoCentesimi: true, dataScadenza: true,
        fattura: {
          select: {
            id: true, numero: true, clienteId: true,
            cliente: { select: { nome: true } },
            progettoId: true,
          },
        },
      },
    });

    for (const r of rate) {
      const quando = aMezzogiornoUtc(r.dataScadenza);
      const etichetta = r.fattura.numero ? ` di ${r.fattura.numero}` : ' (fattura in bozza)';
      eventi.push({
        id: `fattura:${r.id}`,
        titolo: `Rata ${r.numeroRata}${etichetta}`,
        dataInizio: quando.toISOString(),
        dataFine: quando.toISOString(),
        categoria: 'fattura',
        stato: statoScadenza(r.dataScadenza, false, adesso),
        priorita: 'alta',
        note: null,
        luogoUrl: null,
        generato: true,
        assegnatoAId: null,
        assegnatoANome: null,
        progettoId: r.fattura.progettoId,
        clienteId: r.fattura.clienteId,
        clienteNome: r.fattura.cliente?.nome ?? null,
        importoCentesimi: r.importoCentesimi,
        origineId: r.id,
      });
    }
  }

  // ── 3. Il rinnovo KYC (A4): la stessa regola con cui il cron manda l'avviso ──────────────────
  //
  // Il filtro sull'intervallo si fa in memoria e non in SQL, per una ragione misurata: `data_kyc` è
  // una **stringa**, non una data. E la scadenza si calcola da `dataKyc + 1 anno`, che non è una
  // colonna: non è filtrabile in SQL in nessun caso. Il `findMany` può solo restringere a «ha una
  // data KYC», e il resto è aritmetica in memoria.
  //
  // Misurato in produzione il 17/09/2026: sui clienti che non hanno mai fatto la verifica,
  // `data_kyc` contiene la **stringa vuota**, non `NULL`. Non è un difetto da correggere qui — è
  // come il campo è stato scritto, e quei clienti sono due su due, cioè tutti — ma va saputo,
  // perché `''` supera `IS NOT NULL` e arriva fino a `adData`. La catena regge: `adData('')` è
  // `null` per via della guardia `!valore`, `rinnovoKyc` restituisce `null`, e il `continue` qui
  // sotto è la seconda rete. **Due guardie indipendenti**, non una: è la ragione per cui questo
  // caso non ha prodotto un rinnovo KYC per ogni cliente che non l'ha mai fatto. Il test in
  // `src/calendario.test.ts` fissa il comportamento, così che allentare una delle due si veda.
  //
  // Il filtro di progetto esclude questa sorgente del tutto, ed è una scelta: la verifica KYC è del
  // **cliente**, non dell'incarico. Un cliente con tre progetti aperti non ha tre rinnovi, ne ha
  // uno — e mostrarlo in tutte e tre le schede lo moltiplicherebbe invece di riportarlo.
  if (chieste.has('kyc') && !progettoId) {
    const clienti = await prisma.cliente.findMany({
      where: { tenantId, dataKyc: { not: null } },
      select: { id: true, nome: true, dataKyc: true },
    });

    for (const c of clienti) {
      if (!kycInAvviso(c.dataKyc, adesso)) continue;
      const rinnovo = rinnovoKyc(c.dataKyc);
      if (!rinnovo || rinnovo < da || rinnovo > a) continue;
      const quando = aMezzogiornoUtc(rinnovo);
      eventi.push({
        id: `kyc:${c.id}`,
        titolo: 'Rinnovo KYC',
        dataInizio: quando.toISOString(),
        dataFine: quando.toISOString(),
        categoria: 'kyc',
        stato: statoScadenza(rinnovo, false, adesso),
        priorita: 'alta',
        note: null,
        luogoUrl: null,
        generato: true,
        assegnatoAId: null,
        assegnatoANome: null,
        progettoId: null,
        clienteId: c.id,
        clienteNome: c.nome,
        importoCentesimi: null,
        origineId: c.id,
      });
    }
  }

  // ── 3bis. Revisione periodica del fascicolo KYC (K7, spec §5.2) ──────────────────────────────
  //
  // Stessa regola del cron (`monitoraggioKyc`), così l'avviso proattivo e il calendario non
  // divergono. Come il rinnovo, la revisione è del **cliente** e non dell'incarico, quindi esclusa
  // dal filtro di progetto. È una scadenza derivata passiva; il gate del modulo spento vale sul
  // promemoria proattivo (cron) e sulle rotte /kyc.
  if (chieste.has('kyc') && !progettoId) {
    const fascicoli = await prisma.fascicoloKyc.findMany({
      where: { tenantId, stato: { in: ['approvato', 'in_revisione'] } },
      select: {
        id: true, stato: true, dataScadenza: true, clienteId: true,
        cliente: { select: { nome: true } },
        riskAssessments: { orderBy: { versione: 'desc' }, take: 1, select: { prossimaRevisione: true } },
      },
    });
    for (const f of fascicoli) {
      const prossima = f.riskAssessments[0]?.prossimaRevisione ?? null;
      if (!revisioneKycDovuta(f.stato, f.dataScadenza, prossima, adesso)) continue;
      const rev = dataRevisioneKyc(f.dataScadenza, prossima);
      if (!rev || rev < da || rev > a) continue;
      const quando = aMezzogiornoUtc(rev);
      eventi.push({
        id: `kyc-revisione:${f.id}`,
        titolo: 'Revisione KYC',
        dataInizio: quando.toISOString(),
        dataFine: quando.toISOString(),
        categoria: 'kyc',
        stato: statoScadenza(rev, false, adesso),
        priorita: 'alta',
        note: null,
        luogoUrl: null,
        generato: true,
        assegnatoAId: null,
        assegnatoANome: null,
        progettoId: null,
        clienteId: f.clienteId,
        clienteNome: f.cliente?.nome ?? '',
        importoCentesimi: null,
        origineId: f.id,
      });
    }
  }

  // ── 4. La fine di un progetto (A6) ───────────────────────────────────────────────────────────
  //
  // `pre_project` è dentro di proposito: un progetto che non è ancora cominciato e ha già una
  // scadenza è un progetto che deve cominciare entro quel giorno, ed è una cosa da vedere in
  // calendario. `completed` e `archived` sono fuori: un progetto chiuso non ha una scadenza aperta,
  // e lasciarlo dentro riempirebbe la griglia di scadenze che nessuno deve più rispettare.
  if (chieste.has('progetto')) {
    const progetti = await prisma.progetto.findMany({
      where: {
        tenantId,
        dataScadenza: { gte: da, lte: a },
        stato: { in: ['pre_project', 'in_progress'] },
        ...(progettoId ? { id: progettoId } : {}),
      },
      select: {
        id: true, nome: true, dataScadenza: true, clienteId: true,
        cliente: { select: { nome: true } },
      },
    });

    for (const p of progetti) {
      if (!p.dataScadenza) continue;
      if (accessi !== null && !accessiCopronoProgetto(accessi, p.id)) continue;
      const quando = aMezzogiornoUtc(p.dataScadenza);
      eventi.push({
        id: `progetto:${p.id}`,
        titolo: `Fine progetto: ${p.nome}`,
        dataInizio: quando.toISOString(),
        dataFine: quando.toISOString(),
        categoria: 'progetto',
        stato: statoScadenza(p.dataScadenza, false, adesso),
        priorita: 'media',
        note: null,
        luogoUrl: null,
        generato: true,
        assegnatoAId: null,
        assegnatoANome: null,
        progettoId: p.id,
        clienteId: p.clienteId,
        clienteNome: p.cliente?.nome ?? null,
        importoCentesimi: null,
        origineId: p.id,
      });
    }
  }

  // ── 5. Il prossimo rinnovo di un contratto ricorrente ────────────────────────────────────────
  // Un contratto può non essere legato a un progetto (`progettoId` è facoltativo): quando si chiede
  // un progetto, i contratti senza progetto restano fuori, perché non sono di quell'incarico.
  if (chieste.has('contratto')) {
    const contratti = await prisma.contrattoRicorrente.findMany({
      where: {
        tenantId,
        stato: 'attivo',
        prossimaFatturazione: { gte: da, lte: a },
        ...(progettoId ? { progettoId } : {}),
      },
      select: {
        id: true, titolo: true, prossimaFatturazione: true, clienteId: true, progettoId: true,
        cliente: { select: { nome: true } },
      },
    });

    for (const c of contratti) {
      const quando = aMezzogiornoUtc(c.prossimaFatturazione);
      eventi.push({
        id: `contratto:${c.id}`,
        titolo: `Rinnovo contratto: ${c.titolo}`,
        dataInizio: quando.toISOString(),
        dataFine: quando.toISOString(),
        categoria: 'contratto',
        stato: statoScadenza(c.prossimaFatturazione, false, adesso),
        priorita: 'normale',
        note: null,
        luogoUrl: null,
        generato: true,
        assegnatoAId: null,
        assegnatoANome: null,
        progettoId: c.progettoId,
        clienteId: c.clienteId,
        clienteNome: c.cliente?.nome ?? null,
        importoCentesimi: null,
        origineId: c.id,
      });
    }
  }

  // Per istante, e a parità di istante i derivati prima: una scadenza ha un'ora convenzionale
  // (mezzogiorno UTC) e un appuntamento ha l'ora vera, quindi l'ordinamento mescola date civili e
  // istanti. Va bene così — l'interfaccia raggruppa per giorno, e dentro il giorno l'ordine è
  // stabile, che è la sola proprietà su cui si può contare.
  eventi.sort((x, y) => x.dataInizio.localeCompare(y.dataInizio));

  return eventi;
}
