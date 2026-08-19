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

const clientBase = new PrismaClient();

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

let clientAmministrativo: PrismaClient | null = null;

/**
 * Client che scavalca RLS, perché si connette col ruolo proprietario dello schema.
 *
 * Va usato SOLO dove il tenant non è ancora noto o non è pertinente:
 *   - la ricerca dell'utente per email al login (§23): il tenant si scopre da quella
 *     riga, quindi non può essere un vincolo della query che la trova;
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
