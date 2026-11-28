// Gli avvisi del canale protetto: dicono CHE c'è un messaggio o una richiesta, non COSA dice.
//
// Prima la campanella dello studio riportava i primi 120 caratteri del messaggio del cliente:
// il testo usciva dal fascicolo e finiva, in chiaro, in una tabella che non è la corrispondenza
// (e che nessuno pensa di proteggere come tale). Qui dentro il testo non entra mai.
import { prisma } from '../util/prismaClient.js';
import { baseUrlApplicazione } from '../util/serverHelpers.js';
import { CANALE_PROTETTO } from './canaleProtetto.js';
import { avvisaClienteViaCanali, notificaCliente, notificaStudio } from './notificheService.js';

/** Il cliente ha scritto nel canale protetto: lo studio lo vede in campanella. */
export async function avvisaStudioMessaggioProtetto(
  tenantId: string,
  progetto: { id: string; nome: string },
  nomeCliente: string,
  conAllegati: boolean,
): Promise<void> {
  await notificaStudio(tenantId, {
    tipoEvento: 'messaggio_cliente',
    oggetto: 'Nuovo messaggio dal cliente',
    corpo: `${nomeCliente} ha scritto nel canale protetto di «${progetto.nome}»${conAllegati ? ', con allegati' : ''}. Aprilo dalla scheda Comunicazioni.`,
    link: `/projects/${progetto.id}`,
  });
}

/**
 * Avvisa il cliente che nel portale c'è qualcosa di nuovo per lui: sempre in campanella, e per
 * email solo se non ha già un avviso dello stesso tipo ancora da leggere — tre messaggi di fila
 * dello studio non devono diventare tre email. WhatsApp resta fuori: lì ogni invio costa.
 */
async function avvisaCliente(
  tenantId: string,
  clienteId: string,
  avviso: { tipoEvento: 'messaggio_studio' | 'richiesta_cliente'; oggetto: string; corpo: string; link: string },
): Promise<void> {
  const giaInAttesa = await prisma.notifica.count({
    where: { tenantId, destinatarioClienteId: clienteId, tipoEvento: avviso.tipoEvento, statoLettura: 'non_letta' },
  });
  await notificaCliente(tenantId, clienteId, avviso);
  if (giaInAttesa > 0) return;
  await avvisaClienteViaCanali(
    tenantId,
    clienteId,
    { oggetto: avviso.oggetto, corpo: avviso.corpo, link: `${baseUrlApplicazione()}/portal` },
    { soloEmail: true, etichetta: avviso.tipoEvento },
  );
}

/** Lo studio ha scritto nel canale protetto. */
export async function avvisaClienteMessaggioProtetto(tenantId: string, clienteId: string, nomeProgetto: string): Promise<void> {
  await avvisaCliente(tenantId, clienteId, {
    tipoEvento: 'messaggio_studio',
    oggetto: 'Nuovo messaggio dallo studio',
    corpo: `Lo studio ti ha scritto sull'incarico «${nomeProgetto}». Per riservatezza il testo si legge solo nella tua area riservata, alla scheda Messaggi.`,
    link: '/portal/messaggi',
  });
}

/** Lo studio ha preparato per il cliente qualcosa da compilare o da inviare. */
export async function avvisaClienteRichiesta(tenantId: string, clienteId: string, nomeProgetto: string, quante: number): Promise<void> {
  await avvisaCliente(tenantId, clienteId, {
    tipoEvento: 'richiesta_cliente',
    oggetto: quante === 1 ? 'Lo studio ti chiede un’informazione' : 'Lo studio ti chiede alcune informazioni',
    corpo: `Per l'incarico «${nomeProgetto}» ${quante === 1 ? 'c’è una richiesta' : `ci sono ${quante} richieste`} da completare nella tua area riservata, alla scheda Da fare.`,
    link: '/portal/richieste',
  });
}

/**
 * L'avviso che segue la scrittura di un messaggio nel fascicolo.
 *
 * - arriva dal cliente nel canale protetto → campanella dello studio, senza testo;
 * - arriva su un altro canale (email, WhatsApp… registrati a mano) → campanella con l'inizio del
 *   testo, com'era: quei canali passano già da fornitori esterni e non promettono riservatezza;
 * - lo studio scrive nel canale protetto → il cliente viene avvisato (campanella ed email).
 */
export async function avvisaDopoMessaggio(
  tenantId: string,
  dati: { progettoId: string; canale: string; inEntrata: boolean; conAllegati: boolean; testoInChiaro: string },
): Promise<void> {
  const protetto = dati.canale === CANALE_PROTETTO;
  if (!dati.inEntrata && !protetto) return;
  const progetto = await prisma.progetto.findFirst({
    where: { id: dati.progettoId, tenantId },
    select: { id: true, nome: true, clienteId: true, cliente: { select: { nome: true } } },
  });
  if (!progetto) return;
  if (!dati.inEntrata) {
    await avvisaClienteMessaggioProtetto(tenantId, progetto.clienteId, progetto.nome);
  } else if (protetto) {
    await avvisaStudioMessaggioProtetto(tenantId, progetto, progetto.cliente.nome, dati.conAllegati);
  } else {
    await notificaStudio(tenantId, {
      tipoEvento: 'messaggio_cliente',
      oggetto: 'Nuovo messaggio dal cliente',
      corpo: `${progetto.cliente.nome} ha scritto su «${progetto.nome}»: ${dati.testoInChiaro.slice(0, 120)}`,
      link: `/projects/${progetto.id}`,
    });
  }
}
