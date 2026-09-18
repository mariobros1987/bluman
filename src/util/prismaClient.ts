/**
 * Client Prisma con contesto tenant, per rendere effettive le policy RLS (§14, §2bis).
 *
 * Il problema che risolve: le policy filtrano su `current_setting('app.current_tenant_id')`,
 * ma Prisma multiplexa le query su un pool di connessioni — una `SET` eseguita da sola non
 * vale per la query successiva, che può finire su un'altra connessione. Ogni operazione
 * viene quindi eseguita in una transazione che imposta prima la variabile, con
 * `is_local = true` così vale solo per quella transazione.
 *
 * Proprietà voluta: se il contesto manca, la variabile resta vuota, `tenant_id = NULL` non
 * è vero per nessuna riga e la query non vede niente. Un contesto dimenticato produce
 * quindi un guasto immediato e visibile, non una fuga di dati silenziosa.
 */
import { PrismaClient } from '@prisma/client';
import { AsyncLocalStorage } from 'node:async_hooks';

export interface ContestoTenant {
  tenantId: string;
  /** Serve alle policy su `user` e `tenant`: solo il super_admin vede le righe senza tenant. */
  ruolo?: string;
}

export const contestoTenant = new AsyncLocalStorage<ContestoTenant>();

/**
 * Attiva il contesto per il resto della catena asincrona corrente. Serve `enterWith` e non
 * `run` perché gli hook di Fastify ritornano invece di racchiudere il seguito della
 * richiesta: `run` chiuderebbe il contesto appena finito l'hook.
 */
export function attivaContestoTenant(contesto: ContestoTenant): void {
  contestoTenant.enterWith(contesto);
}

/** Vero quando la variabile di sessione è già stata impostata dalla transazione in corso. */
const dentroTransazioneConTenant = new AsyncLocalStorage<true>();

// `transactionOptions` alza il tetto delle transazioni interattive **una volta per tutte** (voce 6
// del piano): Prisma di default chiude una `$transaction(async …)` dopo 5 secondi e la query
// successiva fallisce con `P2028`. Impostarlo qui vale per ogni transazione — quelle di oggi e
// quelle di domani — invece di ricordarsi il secondo argomento a ogni call site, che è esattamente
// il modo in cui il tetto è già scattato due volte in produzione. `maxWait` è l'attesa massima per
// ottenere una connessione dal pool prima di partire; `timeout` la durata massima della transazione.
const clientBase = new PrismaClient({
  transactionOptions: { timeout: 15_000, maxWait: 5_000 },
});

/**
 * Client usato da tutte le rotte. Si connette col ruolo `bluman_app`, che non può
 * scavalcare RLS: senza il contesto impostato qui sotto non leggerebbe nulla.
 */
export const prisma = clientBase.$extends({
  query: {
    $allModels: {
      async $allOperations({ args, query }) {
        const contesto = contestoTenant.getStore();

        // Fuori da una richiesta HTTP (script, cron, bootstrap) non c'è un tenant
        // corrente: la query passa così com'è. Con il ruolo `bluman_app` non vedrebbe
        // niente — è il motivo per cui gli script usano `prismaAmministrativo`.
        if (!contesto) return query(args);

        // Già dentro una transazione che ha impostato la variabile: aprirne un'altra
        // la eseguirebbe su un'altra connessione, fuori dalla transazione esterna.
        if (dentroTransazioneConTenant.getStore()) return query(args);

        const { tenantId, ruolo = '' } = contesto;

        const [, risultato] = await clientBase.$transaction([
          clientBase.$executeRaw`SELECT set_config('app.current_tenant_id', ${tenantId}, true),
                                        set_config('app.current_ruolo', ${ruolo}, true)`,
          query(args),
        ]);
        return risultato;
      },
    },
  },
});

/**
 * Tipo del client esteso. `$extends` non restituisce un `PrismaClient` ma un tipo
 * derivato, quindi gli adapter che lo ricevono dichiarano questo invece di `PrismaClient`
 * — così il compilatore impedisce di passare per sbaglio un client senza contesto.
 */
export type PrismaConContesto = typeof prisma;

/**
 * Imposta il contesto dentro una transazione interattiva già aperta e segnala alle
 * operazioni annidate di non aprirne un'altra. Serve dove l'atomicità copre più query,
 * come l'istanziazione di un progetto (§16).
 */
export async function conContestoInTransazione<T>(
  tx: { $executeRaw: (...args: any[]) => Promise<unknown> },
  fn: () => Promise<T>,
): Promise<T> {
  const contesto = contestoTenant.getStore();
  if (!contesto) return fn();

  const tenantId = contesto.tenantId;
  const ruolo = contesto.ruolo ?? '';
  // Tag template letterale: i valori restano parametri, non concatenazione di stringhe.
  await (tx.$executeRaw as any)`SELECT set_config('app.current_tenant_id', ${tenantId}, true),
                                       set_config('app.current_ruolo', ${ruolo}, true)`;

  return dentroTransazioneConTenant.run(true, fn);
}

/**
 * Ritenta un'operazione quando Postgres abortisce la transazione per un conflitto
 * (Prisma P2034). Con `isolationLevel: Serializable` due richieste contemporanee
 * che assegnano lo stesso progressivo (numerazione fatture) vengono serializzate:
 * una delle due fallisce qui e, al tentativo successivo, rilegge i progressivi
 * già scritti dall'altra. Gli errori diversi da P2034 non si ritentano: non sono
 * conflitti ma guasti veri, che riprovare non ripara.
 *
 * Con `ancheViolazioniUniche` si ritenta anche la P2002 (violazione di vincolo
 * UNIQUE): ha senso SOLO per le operazioni che ricalcolano il valore da zero a
 * ogni tentativo (la numerazione «max+1» delle fatture). L'indice UNIQUE parziale
 * `fattura_emesse_tenant_serie_prog_key` è la rete di sicurezza che trasforma un
 * numero doppio in un errore immediato invece che in una fattura corrotta; questo
 * retry lo trasforma in un secondo tentativo con il progressivo aggiornato.
 */
export async function riprovaSuConflitto<T>(
  operazione: () => Promise<T>,
  tentativi = 3,
  ancheViolazioniUniche = false,
): Promise<T> {
  for (let tentativo = 1; ; tentativo++) {
    try {
      return await operazione();
    } catch (err: any) {
      const conflitto = err?.code === 'P2034' || (ancheViolazioniUniche && err?.code === 'P2002');
      if (!conflitto || tentativo >= tentativi) throw err;
      // Pausa crescente: dà alla transazione concorrente il tempo di committare,
      // così il tentativo successivo parte da una fotografia aggiornata.
      await new Promise((risolvi) => setTimeout(risolvi, 25 * tentativo));
    }
  }
}

let clientAmministrativo: PrismaClient | null = null;

/**
 * Client che scavalca RLS, perché si connette col ruolo proprietario dello schema.
 *
 * Va usato SOLO dove il tenant non è ancora noto o non è pertinente:
 *   - la ricerca dell'utente per email al login (§23): il tenant si scopre da quella
 *     riga, quindi non può essere un vincolo della query che la trova;
 *   - la verifica del magic token in `POST /auth/magic-login` (§23): stesso caso, la
 *     richiesta è anonima per definizione e il tenant si scopre dalla riga `magic_link`
 *     che stiamo cercando. Il token è un segreto da 128 bit: è quello a delimitare cosa
 *     la query può trovare, non il contesto tenant;
 *   - script di manutenzione, seed, bootstrap, backup.
 *
 * Ogni altro uso riapre esattamente il buco che le policy chiudono. Istanziato alla
 * prima chiamata per non aprire un secondo pool di connessioni quando non serve.
 */
export function prismaAmministrativo(): PrismaClient {
  if (!clientAmministrativo) {
    const url = process.env.ADMIN_DATABASE_URL || process.env.DIRECT_URL;
    clientAmministrativo = url
      ? new PrismaClient({ datasources: { db: { url } } })
      : // Senza URL amministrativo si ricade sul client normale: in sviluppo locale
        // DATABASE_URL è spesso già un utente con tutti i privilegi.
        new PrismaClient();
  }
  return clientAmministrativo;
}
