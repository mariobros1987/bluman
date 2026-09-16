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
  await notificaStudio(tenantId, {
    tipoEvento: 'messaggio_non_instradabile',
    oggetto: `Messaggio ${nome} non archiviato — ${dati.mittente}`,
    corpo: `${dati.mittente} ha scritto su ${nome} e il messaggio non è entrato in nessun `
      + `fascicolo. ${dati.motivo} Testo ricevuto: «${dati.testo.slice(0, 500)}»`,
    link: null,
  });
}
