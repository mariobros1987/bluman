/**
 * I compiti assegnati: **una definizione, e chi la legge.**
 *
 * C5 di §1ter.6 lo dice in una riga, ed è il motivo per cui questo file esiste: «Un compito è una
 * micro-voce con `risorsaId` valorizzato e `stato != 'done'`. Non serve una tabella dei compiti:
 * serve una query.»
 *
 * **Perché un modulo a parte e non una query in più nella rotta.** Prima di questo file la stessa
 * idea era scritta in due posti che non si parlavano: il carico di lavoro in `progetti.ts` contava
 * le micro-voci per `risorsaId` (ed era la definizione giusta), mentre il calendario decideva
 * l'assegnatario da `evento_calendario.assegnatoAId` — una colonna **diversa**, scritta da un'altra
 * schermata. Due definizioni della stessa parola non restano uguali: la prima volta che divergono,
 * «i miei compiti» e il carico di lavoro dicono due numeri diversi e nessuno dei due è
 * dimostrabilmente sbagliato. Il criterio di accettazione di C5 è esattamente che quei due numeri
 * coincidano, e l'unico modo di farlo coincidere è che vengano dalla stessa funzione.
 *
 * **Il campo è sempre stato `NULL`, e questo file lo accende.** Misurato in produzione il
 * 18/09/2026: `microvoce_progetto.risorsa_id` non è valorizzato su nessuna riga di nessuno dei 5
 * studi, e `evento_calendario` ha **0 righe**. Quindi questa non è una correzione di dati sbagliati
 * — non ce ne sono — è la definizione di cosa succederà quando ce ne saranno. La stessa misura dice
 * che cambiare il significato di `assegnatoAId` non rompe niente di esistente, ed è la ragione per
 * cui C5 ha potuto essere implementato senza una migrazione dei dati.
 *
 * **Cosa questo file non fa.** Non decide *chi può vedere* un compito: quella è
 * `src/util/calendarioVisibilita.ts`, ed è una domanda diversa («questo ruolo vede questa
 * categoria?» contro «quali righe sono di questa persona?»). Non scrive: l'assegnazione la scrive
 * `PUT /progetti/:id/stato-completo` (C3). Qui si legge soltanto.
 */
import { prisma } from '../util/prismaClient.js';

/**
 * Lo stato che rende un compito finito.
 *
 * È `done` e non `fatto`: il vocabolario è quello di `StatoMicrovoce`, che usa l'inglese come tutto
 * il resto dello schema (`pending`, `active`, `delayed`, `blocked`). Il calendario ha un enum suo
 * (`da_fare`/`fatto`/`annullato`) e i due convivono di proposito — vedi la nota sulle due grafie in
 * §1ter.8, deviazione 2. Qui si legge una micro-voce, quindi si usa la grafia della micro-voce.
 */
export const STATO_COMPITO_FINITO = 'done';

/** Le colonne di `StatoMicrovoce` che una micro-voce può avere. */
export type StatoMicrovoce =
  | 'pending'
  | 'attesa_dipendenza'
  | 'active'
  | 'delayed'
  | 'blocked'
  | 'done';

/**
 * La clausola `where` che definisce un compito — **la definizione, in un posto solo.**
 *
 * Due condizioni, e nessuna delle due è decorativa.
 *
 * La prima è `risorsaId`, e **l'esclusione di ciò che nessuno ha preso in carico non è una
 * condizione in più**: si filtra *per un id*, e una riga con `risorsa_id` nullo non è uguale a
 * nessun id. Scriverla come `{ not: null }` sarebbe la stessa cosa guardata dall'altro lato, e
 * infatti non c'è.
 *
 * **Provato per mutazione il 18/09/2026, e il risultato vale la pena scriverlo.** Togliendo
 * `risorsaId` da questa clausola — lasciando solo il `tenantId` e lo stato — nessun test cade, e
 * non è una lacuna dei test: `caricoPerRisorse` salta i gruppi con `risorsaId` nullo, quindi le ore
 * di una micro-voce che nessuno ha preso in carico non finiscono nel carico di nessuno in nessuno
 * dei due casi. La differenza che `risorsaId` fa davvero è un'altra, e non è quella che si crede:
 * **restringe la scansione** alle risorse chieste invece di leggere tutte le micro-voci aperte dello
 * studio per poi buttarne la maggior parte. È una differenza di lavoro svolto, non di risultato, ed
 * è per questo che nessun test la osserva — un test che la osservasse starebbe misurando il piano
 * di esecuzione, non il comportamento.
 *
 * La seconda condizione è lo stato: `done` non è un compito da fare. Questa invece si vede, e
 * toglierla fa cadere il file dei test.
 *
 * Accetta un id o un elenco perché i due consumatori chiedono forme diverse della stessa cosa: la
 * vista «i miei compiti» chiede una persona, il carico di lavoro chiede tutti gli operatori in una
 * query sola (`groupBy`). Scrivere due clausole sarebbe tornare al difetto che questo file chiude.
 */
export function doveCompiti(tenantId: string, risorsaId: string | readonly string[]) {
  return {
    tenantId,
    risorsaId: typeof risorsaId === 'string' ? risorsaId : { in: [...risorsaId] },
    stato: { not: STATO_COMPITO_FINITO },
  } as const;
}

/** Ore residue di un compito: preventivate meno consuntivate, mai negative. */
export function oreResidue(orePreventivate: number, oreConsuntivate: number): number {
  return Math.max(0, orePreventivate - oreConsuntivate);
}

/**
 * Un compito come lo mostra la vista «i miei compiti».
 *
 * `scadenza` è `null` quando il compito **non è stato pianificato**, ed è una distinzione che va
 * tenuta: la data di un compito non sta in `microvoce_progetto` — quella tabella non ha una colonna
 * di scadenza — sta nell'evento di calendario che qualcuno ha scritto per lui (§1ter.5, B6). Un
 * compito senza evento non ha una data, e inventargliene una sarebbe il difetto da cui tutta la
 * fase A è nata: il calendario che disegnava una scadenza per ogni progetto da un contatore.
 */
export interface CompitoAssegnato {
  id: string;
  nome: string;
  stato: StatoMicrovoce;
  orePreventivate: number;
  oreConsuntivate: number;
  oreResidue: number;
  progettoId: string;
  progettoNome: string;
  moduloProgettoId: string;
  moduloNome: string;
  clienteId: string;
  clienteNome: string;
  /** La data pianificata per questo compito, `YYYY-MM-DD`, o `null` se nessuno l'ha pianificato. */
  scadenza: string | null;
  /** L'id dell'evento che porta quella data, per poterlo aprire o spuntare. `null` con `scadenza`. */
  eventoId: string | null;
}

/**
 * I compiti assegnati a una persona, dal più urgente.
 *
 * **L'ordinamento è una decisione, non un default.** Prima i compiti che hanno una data, e fra
 * quelli la data più vicina; poi quelli senza data, che non sono meno importanti ma non si possono
 * ordinare per urgenza — e metterli in testa o in coda a caso sarebbe un ordine che finge di essere
 * un'informazione. A parità di data, il nome del progetto: serve a rendere l'elenco **stabile** fra
 * due letture, perché un elenco che cambia ordine da solo sembra che sia cambiato qualcosa.
 *
 * La scadenza si legge dall'evento di calendario collegato alla micro-voce. Se un compito ha più
 * eventi (riprogrammato due volte) si prende il **primo non annullato**, che è la data che l'utente
 * vede nel calendario.
 */
export async function compitiDiUtente(
  tenantId: string,
  risorsaId: string,
  opzioni: { adesso?: Date } = {},
): Promise<CompitoAssegnato[]> {
  const adesso = opzioni.adesso ?? new Date();

  const righe = await prisma.microvoceProgetto.findMany({
    where: doveCompiti(tenantId, risorsaId),
    select: {
      id: true,
      nome: true,
      stato: true,
      orePreventivate: true,
      oreConsuntivate: true,
      moduloProgettoId: true,
      moduloProgetto: {
        select: {
          nome: true,
          progettoId: true,
          progetto: {
            select: {
              nome: true,
              clienteId: true,
              cliente: { select: { nome: true } },
            },
          },
        },
      },
      eventiCalendario: {
        where: { categoria: 'microvoce', stato: { not: 'annullato' } },
        select: { id: true, dataInizio: true },
        orderBy: { dataInizio: 'asc' },
      },
    },
  });

  const compiti: CompitoAssegnato[] = righe.map((r) => {
    // Il primo evento non annullato è la data che il calendario mostra. `orderBy` lo fa scegliere
    // al database invece che a un `sort` qui: la regola è la stessa, ma una sola delle due versioni
    // è quella che il calendario usa davvero.
    const evento = r.eventiCalendario[0] ?? null;
    return {
      id: r.id,
      nome: r.nome,
      stato: r.stato as StatoMicrovoce,
      orePreventivate: r.orePreventivate,
      oreConsuntivate: r.oreConsuntivate,
      oreResidue: oreResidue(r.orePreventivate, r.oreConsuntivate),
      progettoId: r.moduloProgetto.progettoId,
      progettoNome: r.moduloProgetto.progetto.nome,
      moduloProgettoId: r.moduloProgettoId,
      moduloNome: r.moduloProgetto.nome,
      clienteId: r.moduloProgetto.progetto.clienteId,
      clienteNome: r.moduloProgetto.progetto.cliente.nome,
      scadenza: evento ? evento.dataInizio.toISOString().slice(0, 10) : null,
      eventoId: evento?.id ?? null,
    };
  });

  compiti.sort(
    (a, b) =>
      Number(b.scadenza !== null) - Number(a.scadenza !== null) ||
      (a.scadenza ?? '').localeCompare(b.scadenza ?? '') ||
      a.progettoNome.localeCompare(b.progettoNome) ||
      a.nome.localeCompare(b.nome),
  );

  // `adesso` non entra nell'ordinamento: un compito scaduto resta il più urgente che c'è, e
  // ricalcolarlo su `adesso` lo farebbe scivolare in fondo proprio quando ha smesso di aspettare.
  void adesso;

  return compiti;
}

/** Quante ore residue ha addosso ciascuna risorsa, per il carico di lavoro. */
export interface CaricoRisorsa {
  risorsaId: string;
  oreResidue: number;
  compitiAperti: number;
}

/**
 * Il carico per risorsa: **la stessa definizione di compito**, in forma aggregata.
 *
 * È il consumatore che esisteva già — `GET /operatori-suggeriti` in `progetti.ts`, che somma le ore
 * residue per `risorsaId` — e che fino a ora lavorava su una colonna sempre `NULL`, quindi sommava
 * zero su zero. Non cambia il risultato di una riga: cambia che la clausola con cui lo calcola ora
 * è la stessa con cui la vista «i miei compiti» elenca. Se un giorno la definizione di compito
 * cambia, cambia per entrambi nello stesso commit — che è tutto il punto di C5.
 *
 * `compitiAperti` è il numero che il criterio di accettazione confronta con la lunghezza di
 * `compitiDiUtente`: sono la stessa `where`, una contata e una elencata.
 */
export async function caricoPerRisorse(
  tenantId: string,
  risorsaIds: readonly string[],
): Promise<Map<string, CaricoRisorsa>> {
  if (risorsaIds.length === 0) return new Map();

  const gruppi = await prisma.microvoceProgetto.groupBy({
    by: ['risorsaId'],
    where: doveCompiti(tenantId, risorsaIds),
    _sum: { orePreventivate: true, oreConsuntivate: true },
    _count: { _all: true },
  });

  const carico = new Map<string, CaricoRisorsa>();
  for (const g of gruppi) {
    // `risorsaId` è `not null` per costruzione della clausola, ma il tipo resta nullable: si salta
    // invece di affermare con un `!`, perché un `!` qui sarebbe una promessa che il compilatore non
    // può controllare e che una modifica futura a `doveCompiti` renderebbe falsa in silenzio.
    if (!g.risorsaId) continue;
    carico.set(g.risorsaId, {
      risorsaId: g.risorsaId,
      oreResidue: oreResidue(g._sum.orePreventivate ?? 0, g._sum.oreConsuntivate ?? 0),
      compitiAperti: g._count._all,
    });
  }
  return carico;
}
