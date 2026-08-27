// Helper condivisi del server HTTP.
//
// Estratti da `src/server.ts` (split dei monoliti, 27/08/2026) SENZA cambio di
// comportamento: stesse identiche implementazioni, solo spostate qui perché i
// moduli di rotte in `src/routes/` possano importarle senza dipendere dal
// monolite. `server.ts` le re-importa da questo modulo.

import { prismaAmministrativo } from './prismaClient.js';

export const inMemoryTenantStore = new Map<string, any>();

/**
 * Tenant usato quando la richiesta non ne indica uno: le richieste non autenticate
 * (login, health) e i record di sistema. Coincide con l'id creato dal seed.
 */
export const TENANT_DEFAULT = '00000000-0000-0000-0000-000000000001';

/** Recapito ripulito, oppure `null` se dopo il taglio degli spazi non rimane niente. */
export function pulisciRecapito(v: unknown): string | null {
  const s = typeof v === 'string' ? v.trim() : '';
  return s.length > 0 ? s : null;
}

/** I tre canali su cui può viaggiare il codice di firma; qualunque altra cosa non è una scelta. */
export function canaleOtpValido(v: unknown): v is 'whatsapp' | 'email' | 'telegram' {
  return v === 'whatsapp' || v === 'email' || v === 'telegram';
}

/**
 * Gli stati ammessi, per validare quello che arriva dal client prima di scriverlo.
 *
 * Sono le stesse voci degli `enum` in `prisma/schema.prisma`: qui servono come elenco a runtime,
 * perché un valore fuori elenco farebbe fallire l'`update` di Prisma con un errore che non dice
 * niente a chi lo legge dal frontend, invece di essere respinto con il motivo.
 */
export const STATI_MICROVOCE = ['pending', 'attesa_dipendenza', 'active', 'delayed', 'blocked', 'done'];
export const STATI_PROGETTO = ['pre_project', 'in_progress', 'completed', 'archived'];

/**
 * Durata della sessione di un operatore dello studio, in minuti.
 *
 * Era un'ora, senza rinnovo. Una giornata di lavoro su un progetto dura più di un'ora, quindi il
 * token scadeva **durante** il lavoro: da quel momento ogni salvataggio tornava 401, e siccome
 * quasi nessuna chiamata del frontend distingueva il 401 dal successo, le modifiche continuavano
 * a comparire sullo schermo — arrivavano da `localStorage` — senza mai raggiungere il database.
 * È la causa a monte del guasto segnalato, «il cliente non vede i moduli inseriti
 * dall'operatore»: il portale legge il database.
 *
 * Dodici ore coprono una giornata; il rinnovo scorrevole qui sotto copre chi lavora oltre.
 */
export const DURATA_SESSIONE_OPERATORE_MINUTI = 12 * 60;

/**
 * Durata della sessione di un cliente nel portale, in minuti.
 *
 * Più corta di quella dell'operatore: il portale si apre da un link ricevuto via email, che può
 * finire su un dispositivo condiviso o restare in una cronologia. Quattro ore bastano a leggere
 * i documenti, ricevere il codice e firmare; scaduta, il Magic Link (valido sette giorni) ne
 * produce una nuova senza passare dallo studio.
 */
export const DURATA_SESSIONE_CLIENTE_MINUTI = 4 * 60;

/**
 * Quando rinnovare un token ancora valido: a metà della sua vita.
 *
 * Il rinnovo viaggia nell'header `X-Bluman-Token` della risposta e il frontend lo sostituisce a
 * quello che ha in memoria. Così chi sta lavorando non viene mai buttato fuori a metà di una
 * modifica, e chi ha chiuso il portatile venerdì sera rientra lunedì con le credenziali, che è la
 * differenza fra una sessione lunga e una sessione eterna. Non serve nessuna tabella di refresh
 * token: il token nuovo è firmato con lo stesso segreto e porta lo stesso contenuto.
 */
export const SOGLIA_RINNOVO = 0.5;

/**
 * Validità di un Magic Link. Sette giorni perché il destinatario è un cliente che legge la
 * posta quando può, non un operatore davanti alla console. La revoca non aspetta la
 * scadenza: è la cancellazione della riga in `magic_link`.
 */
export const GIORNI_VALIDITA_MAGIC_LINK = 7;

/**
 * Base pubblica del frontend, per i link che finiscono nelle email.
 *
 * Era cablata a `http://localhost:5173`, quindi ogni Magic Link inviato dalla produzione
 * portava alla macchina di chi apriva l'email. In produzione l'assenza della variabile è un
 * errore: un link rotto verso localhost è peggio di un errore visibile.
 */
export function baseUrlApplicazione(): string {
  const daEnv = process.env.APP_BASE_URL?.replace(/\/+$/, '');
  if (daEnv) return daEnv;

  if (process.env.NODE_ENV === 'production') {
    return 'https://bluman.vercel.app';
  }

  return 'http://localhost:5173';
}

/**
 * IP reale del chiamante, `null` quando non è determinabile.
 *
 * Dietro il proxy di Railway `req.ip` è l'indirizzo del proxy: quello del client sta nel
 * primo salto di `x-forwarded-for`. Il valore serve a due cose che non tollerano un
 * segnaposto — il registro di audit e il verbale di firma — e prima entrambi ricadevano
 * su `127.0.0.1`, che è l'unico indirizzo da cui un firmatario sicuramente non arriva.
 * Meglio l'assenza registrata come assenza.
 */
export function ipReale(req: { ip?: string; headers: Record<string, unknown> }): string | null {
  const forwarded = req.headers['x-forwarded-for'];
  const grezzo = Array.isArray(forwarded) ? forwarded[0] : forwarded;
  if (typeof grezzo === 'string' && grezzo.trim()) {
    const primo = grezzo.split(',')[0]?.trim();
    if (primo) return primo;
  }

  const diretto = req.ip?.trim();
  if (!diretto) return null;
  // Loopback: è il server che parla con se stesso, non un firmatario.
  if (diretto === '127.0.0.1' || diretto === '::1' || diretto === '::ffff:127.0.0.1') return null;
  return diretto;
}

/**
 * La firma grafometrica, ripulita prima di salvarla.
 *
 * Arriva dal browser come data URL prodotta da `canvas.toDataURL()`, quindi è un dato che
 * il client controlla: si accetta solo un PNG in base64 e sotto il mezzo megabyte. Senza
 * questi due controlli il campo diventerebbe un posto dove scrivere qualunque cosa, di
 * qualunque dimensione, dentro il verbale di firma.
 */
export function normalizzaGrafometrica(valore?: string | null): string | null {
  if (!valore) return null;
  const pulito = valore.trim();
  if (!/^data:image\/png;base64,[A-Za-z0-9+/=]+$/.test(pulito)) return null;
  if (pulito.length > 512 * 1024) return null;
  return pulito;
}

// Audit log — §0.6: il tenant è OBBLIGATORIO (ogni chiamata lo riceve dal payload
// JWT o dal contesto della richiesta: nessun ripiego silenzioso su TENANT_DEFAULT)
// e la scrittura passa dal client amministrativo, perché l'audit è un'operazione di
// sistema non soggetta a RLS. Niente setImmediate: il fire-and-forget perdeva gli
// audit se il processo moriva e rendeva impossibile il debug (il catch vuoto
// ingoiava ogni errore). Gli errori di scrittura vengono loggati, non ingoiati.
export async function recordAudit(params: {
  tenantId: string; // OBBLIGATORIO: l'audit va sempre attribuito al tenant giusto
  userId?: string | null;
  userEmail?: string | null;
  userNome?: string | null;
  ruolo?: string | null;
  azione: string;
  entita: string;
  dettagli: string;
  ipAddress?: string | null;
}) {
  try {
    await prismaAmministrativo().auditLog.create({
      data: {
        tenantId: params.tenantId,
        // I ripieghi qui sotto identificano operazioni di sistema senza utente
        // (avvio, seed, processi automatici), non utenti reali.
        userId: params.userId ?? 'usr-system',
        userEmail: params.userEmail ?? 'system@bluecode.advisory',
        userNome: params.userNome ?? 'Sistema / Operatore',
        ruolo: params.ruolo ?? 'operator',
        azione: params.azione,
        entita: params.entita,
        dettagli: params.dettagli,
        // `ip_address` è nullable: un indirizzo inventato in un registro immutabile è
        // peggio di un campo vuoto, perché sembra una prova.
        ipAddress: params.ipAddress || null,
      },
    });
  } catch (err) {
    // La richiesta non deve fallire per un errore di audit, ma l'errore va
    // tracciato: prima veniva ingoiato in silenzio (vedi §0.6 del piano).
    console.error('[AUDIT] Impossibile registrare audit log:', err);
  }
}
