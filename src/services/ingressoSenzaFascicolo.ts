/**
 * Un cliente ha scritto, e il messaggio non è entrato in nessun fascicolo.
 *
 * Le rotte di ingresso (WhatsApp, Telegram, Signal) archiviano un messaggio solo quando sanno
 * con certezza dove metterlo: il mittente dev'essere un cliente univoco dell'anagrafica **e**
 * avere un solo progetto aperto. Quando la seconda condizione non vale — due pratiche aperte,
 * nessuna, o un'anagrafica incompleta — la scelta del fascicolo sarebbe un'invenzione, e il
 * codice giustamente non la fa.
 *
 * Il difetto non era quella prudenza: era cosa succedeva dopo. La rotta rispondeva `ok` al
 * provider e usciva. Telegram e Meta, soddisfatti, non riprovavano; il fascicolo restava vuoto;
 * e nessuno — né l'operatore né il cliente — aveva modo di sapere che un messaggio era
 * esistito. Un messaggio perso in silenzio, con il provider convinto del contrario, è il tipo
 * di guasto che si scopre per caso mesi dopo.
 *
 * Qui il messaggio non si butta: non potendo stare in `comunicazione_progetto` (il progetto è
 * obbligatorio e non c'è), vive nella notifica allo studio, che è l'unico posto che può
 * ospitarlo senza inventare un progetto. La riga in `webhook_inbox` si scrive comunque, così
 * un rinvio dello stesso update da parte del provider non produce un secondo avviso.
 *
 * ── La destinazione del clic (voce 6, 09/10/2026) ─────────────────────────────
 * Fino al 09/10/2026 l'avviso aveva `link: null`: la campanella diceva che un messaggio esisteva
 * ma non portava da nessuna parte, e l'operatore doveva ricostruire da sé di chi si parlasse. Il
 * difetto è della stessa famiglia di quello descritto sopra — un guasto che si vede ma non si
 * può raggiungere — e si chiude dando all'avviso la destinazione che i dati permettono.
 *
 * La destinazione la compone questa funzione, non i sette punti che la chiamano: i chiamanti
 * sanno *cosa conoscono* (`clienteId`, `progettoId`), non come si scrive un URL del frontend.
 * Sparpagliare la forma del link nei webhook significherebbe che il giorno in cui cambia una
 * rotta se ne dimentica qualcuna.
 *
 * Due destinazioni, in ordine di priorità:
 *
 * - **`progettoId`** — la chat era collegata a una pratica che nel frattempo è stata chiusa o
 *   archiviata. La pratica *esiste*, e il `motivo` dice «ripristinala»: mandare all'anagrafica
 *   del cliente sarebbe un giro a vuoto, perché la cosa da fare sta sulla scheda della pratica.
 * - **`clienteId`** — il mittente è identificato senza ambiguità ma non si può scegliere il
 *   fascicolo (nessuna pratica aperta, o più di una). Si apre l'anagrafica: è lì che si aggiunge
 *   il recapito mancante o si sistema l'ambiguità, che sono i due motivi per cui l'avviso esiste.
 *
 * Quando **nessuno** dei due è noto — mittente fuori anagrafica, o numero/chat id che ne
 * identifica più d'uno — il link resta `null`, e non è una dimenticanza: non c'è nessuna scheda
 * da aprire, perché il cliente non è stato identificato. Il `motivo` in quel caso dice cosa
 * cercare, ed è l'unica indicazione onesta che si possa dare.
 */
import { prisma } from '../util/prismaClient.js';
import { notificaStudio } from './notificheService.js';

export interface IngressoSenzaFascicolo {
  /** Chi ha scritto, come si legge nell'anagrafica. */
  mittente: string;
  /** Il testo ricevuto, o la descrizione dell'allegato. */
  testo: string;
  /** Cosa deve fare l'operatore perché il prossimo messaggio entri da solo. */
  motivo: string;
  /** Il cliente identificato senza ambiguità, quando lo si conosce. Vedi la nota sulla destinazione. */
  clienteId?: string;
  /** La pratica nominata, quando esiste ma non raccoglie più messaggi. Vince su `clienteId`. */
  progettoId?: string;
}

/**
 * Dove porta il clic sull'avviso, o `null` se non c'è niente da aprire.
 *
 * `progettoId` prima di `clienteId` perché è la destinazione più specifica: quando la pratica è
 * nota, il gesto richiesto (ripristinarla) si fa lì.
 */
function destinazione(dati: IngressoSenzaFascicolo): string | null {
  if (dati.progettoId) return `/projects/${encodeURIComponent(dati.progettoId)}`;
  if (dati.clienteId) {
    // `azione=anagrafica`: `?client=` da solo apre il modale del Magic Link, che è un'altra cosa
    // (serve a mandare il link del portale, e ci arrivano Dashboard e ProjectDetail). Senza
    // questo parametro l'operatore che clicca l'avviso si troverebbe davanti la finestra
    // sbagliata, con l'aria di essere quella giusta.
    return `/clients?client=${encodeURIComponent(dati.clienteId)}&azione=anagrafica`;
  }
  return null;
}

export async function registraIngressoSenzaFascicolo(
  tenantId: string,
  canale: string,
  eventId: string,
  dati: IngressoSenzaFascicolo,
): Promise<void> {
  try {
    await prisma.webhookInbox.create({
      data: { tenantId, provider: `${canale}_update`, eventId },
    });
  } catch (err) {
    // Chiave composta violata: questo update è già stato visto. Avvisare di nuovo
    // significherebbe riempire la campanella a ogni rinvio del provider.
    if ((err as { code?: string })?.code === 'P2002') return;
    throw err;
  }

  const nome = canale.charAt(0).toUpperCase() + canale.slice(1);
  try {
    await notificaStudio(tenantId, {
      tipoEvento: 'messaggio_non_instradabile',
      oggetto: `Messaggio ${nome} non archiviato — ${dati.mittente}`,
      corpo: `${dati.mittente} ha scritto su ${nome} e il messaggio non è entrato in nessun `
        + `fascicolo. ${dati.motivo} Testo ricevuto: «${dati.testo.slice(0, 500)}»`,
      link: destinazione(dati),
    });
  } catch (err) {
    // La riga di idempotenza è già in tabella, ma l'avviso non è partito. Lasciarla lì
    // sarebbe peggio del guasto originale: al rinvio del provider la `create` troverebbe
    // P2002, la funzione uscirebbe in silenzio e il messaggio sparirebbe senza che nessuno
    // lo abbia mai visto — lo stesso esito di prima, per una porta più stretta.
    // Si toglie la riga e si rilancia: la rotta risponde 500, il provider riprova, e
    // l'avviso con lui. `deleteMany` non lancia se la riga non c'è più.
    await prisma.webhookInbox.deleteMany({
      where: { tenantId, provider: `${canale}_update`, eventId },
    }).catch(() => {});
    throw err;
  }
}
