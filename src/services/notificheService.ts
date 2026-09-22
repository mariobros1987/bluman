// Blocco 3 — Notifiche in tempo reale (SSE) e persistenza eventi.
//
// ── Architettura ──────────────────────────────────────────────────────────────
// Un unico hub in-memory tiene le connessioni Server-Sent Events aperte. Il
// backend gira su una sola istanza Railway, quindi un Set di listener per
// processo è sufficiente: quando un evento avviene (modulo completato, firma
// apposta, …) la stessa richiesta che lo produce scrive le righe `notifica`
// sul DB E spinge il frame SSE verso chi è connesso in quel momento. Chi non
// è connesso ritrova tutto al prossimo caricamento tramite GET /notifiche —
// il DB resta la fonte di verità, lo stream è solo la scorciatoia.
//
// ── Identità ──────────────────────────────────────────────────────────────────
// Ogni connessione porta con sé il tenant e UN destinatario: per lo studio lo
// userId dell'utente, per il portale l'id cliente (il JWT cliente usa
// `client-<clienteId>` e chi apre lo stream lo decodifica prima di arrivare
// qui). Il push è mirato: nessuno stream riceve notifiche altrui.
//
// ── Regola 1 ──────────────────────────────────────────────────────────────────
// Si usa il client condiviso con contesto RLS: le funzioni qui sotto vengono
// chiamate sempre dentro una richiesta HTTP con contesto tenant già attivo.

import type { FastifyReply } from 'fastify';
import { prisma } from '../util/prismaClient.js';
import { credenzialiCanali } from './otpDispatch.js';
import { inviaEmail } from './emailRelay.js';
import { inviaTestoWhatsapp } from './whatsappService.js';

// I sei eventi concordati (Blocco 3, risposta utente): niente inventario
// aperto, la campanella racconta solo questo.
export const EVENTI_NOTIFICA = [
  'modulo_completato',
  'documento_da_firmare',
  'messaggio_cliente',
  'scadenza_imminente',
  'fattura_incassata',
  'firma_apposta',
  // §WF-DOC — lo studio ha riaperto un documento che il cliente aveva già firmato: il cliente
  // deve saperlo, perché il suo atto non è più l'ultima parola sul fascicolo.
  'documento_sbloccato',
  // Punto 2 piano gap — il verbale di firma è stato generato: l'atto certificativo che
  // documenta la firma è disponibile nel fascicolo. Previsto dalla matrice del punto 4.
  'verbale_disponibile',
  // Punto 4 piano gap, riga 7 matrice — lo studio ha gestito la richiesta di addendum del
  // cliente (pronta o rifiutata): l'esito deve arrivare al portale, prima restava solo
  // nell'audit log e il cliente doveva riaprire la pagina per scoprirlo.
  'risposta_addendum',
  // Punto 4 piano gap, riga 8 matrice — lo studio ha confermato o rifiutato la proposta di
  // modifica dei dati inviata dal cliente: l'esito cambia (o no) l'anagrafica e va comunicato.
  'risposta_proposta_dati',
  // Un cliente ha scritto a un canale dello studio (Telegram, WhatsApp, Signal) e il messaggio
  // non si è potuto archiviare in un fascicolo — di solito perché il cliente ha più di un
  // progetto aperto e non c'è modo di sapere a quale si riferisse. Prima finiva nel nulla: la
  // rotta rispondeva «ok» al provider e il messaggio spariva senza che nessuno lo sapesse.
  'messaggio_non_instradabile',
  // Un cliente ha toccato il link di una pratica e ha collegato la sua chat Telegram a quel
  // fascicolo. È la conferma che il link mandato ha funzionato: da quel momento i messaggi di
  // quella chat entrano da soli, senza passare per l'euristica che li scartava quando il cliente
  // aveva due progetti aperti. Senza questa notifica l'operatore non saprebbe che il problema che
  // lo aveva spinto a mandare il link è rientrato.
  'chat_collegata_progetto',
] as const;

export type TipoEventoNotifica = (typeof EVENTI_NOTIFICA)[number];

export interface DatiEvento {
  tipoEvento: TipoEventoNotifica;
  oggetto: string;
  corpo: string;
  /** Deep-link frontend, es. '/projects/<id>' o '/invoices'. */
  link?: string | null;
}

/** Riga serializzata per il frame SSE. */
export interface NotificaPush {
  id: string;
  tipoEvento: string | null;
  oggetto: string;
  corpo: string;
  link: string | null;
  createdAt: string;
}

interface ConnessioneSse {
  tenantId: string;
  /** User id per lo studio, null per il portale. */
  destinatarioId: string | null;
  /** Cliente id per il portale, null per lo studio. */
  destinatarioClienteId: string | null;
  reply: FastifyReply;
}

const connessioni = new Set<ConnessioneSse>();

/** Numero di stream aperti (per health check / diagnostica). */
export function conteggioConnessioniSse(): number {
  return connessioni.size;
}

function serializzaNotifica(riga: {
  id: string;
  tipoEvento: string | null;
  oggetto: string;
  corpo: string;
  link: string | null;
  createdAt: Date;
}): NotificaPush {
  return {
    id: riga.id,
    tipoEvento: riga.tipoEvento,
    oggetto: riga.oggetto,
    corpo: riga.corpo,
    link: riga.link,
    createdAt: riga.createdAt.toISOString(),
  };
}

function inviaFrame(conn: ConnessioneSse, payload: NotificaPush): void {
  try {
    conn.reply.raw.write(`event: notifica\ndata: ${JSON.stringify(payload)}\n\n`);
  } catch {
    // Connessione già morta ma non ancora ripulita: il listener 'close' la
    // rimuoverà; qui ci limitiamo a non far esplodere il chiamante.
  }
}

function destinataA(conn: ConnessioneSse, riga: {
  tenantId: string;
  destinatarioId: string | null;
  destinatarioClienteId: string | null;
}): boolean {
  if (conn.tenantId !== riga.tenantId) return false;
  if (riga.destinatarioClienteId) return conn.destinatarioClienteId === riga.destinatarioClienteId;
  return riga.destinatarioId !== null && conn.destinatarioId === riga.destinatarioId;
}

/**
 * Registra una nuova connessione SSE. Il chiamante (endpoint GET /stream)
 * deve aver già scritto gli header e inviato il commento di benvenuto; qui
 * teniamo solo il riferimento e restituiamo la funzione di chiusura da
 * invocare quando il client si scollega.
 */
export function apriStreamSse(
  reply: FastifyReply,
  identita: { tenantId: string; destinatarioId: string | null; destinatarioClienteId: string | null },
): () => void {
  const conn: ConnessioneSse = {
    tenantId: identita.tenantId,
    destinatarioId: identita.destinatarioId,
    destinatarioClienteId: identita.destinatarioClienteId,
    reply,
  };
  connessioni.add(conn);
  return () => {
    connessioni.delete(conn);
  };
}

/**
 * Notifica a tutti gli utenti attivi dello studio (tenant). Crea una riga
 * `notifica` per utente e spinge il frame SSE a chi è connesso.
 */
export async function notificaStudio(tenantId: string, dati: DatiEvento): Promise<void> {
  const utenti = await prisma.user.findMany({
    where: { tenantId, stato: 'attivo' },
    select: { id: true },
  });
  if (utenti.length === 0) return;

  const righe = await prisma.$transaction(
    utenti.map((u) =>
      prisma.notifica.create({
        data: {
          tenantId,
          destinatarioId: u.id,
          destinatarioTipo: 'user',
          tipoEvento: dati.tipoEvento,
          oggetto: dati.oggetto,
          corpo: dati.corpo,
          link: dati.link ?? null,
          canale: 'in_app',
          inviataAt: new Date(),
        },
      }),
    ),
  );

  for (const riga of righe) {
    const payload = serializzaNotifica(riga);
    for (const conn of connessioni) {
      if (destinataA(conn, riga)) inviaFrame(conn, payload);
    }
  }
}

/**
 * Notifica a un singolo cliente del portale. Crea la riga con
 * `destinatarioClienteId` e spinge il frame se il cliente ha lo stream aperto.
 */
export async function notificaCliente(
  tenantId: string,
  clienteId: string,
  dati: DatiEvento,
): Promise<void> {
  const riga = await prisma.notifica.create({
    data: {
      tenantId,
      destinatarioClienteId: clienteId,
      destinatarioTipo: 'cliente',
      tipoEvento: dati.tipoEvento,
      oggetto: dati.oggetto,
      corpo: dati.corpo,
      link: dati.link ?? null,
      canale: 'in_app',
      inviataAt: new Date(),
    },
  });

  const payload = serializzaNotifica(riga);
  for (const conn of connessioni) {
    if (destinataA(conn, riga)) inviaFrame(conn, payload);
  }
}

/**
 * Avviso al cliente sui canali ESTERNI (email + WhatsApp), oltre alla notifica in-app.
 *
 * Nato per «documento da firmare» (W3 audit 21/09): un cliente che non apre il portale non
 * sapeva di dover firmare e l'incarico restava fermo a tempo indefinito. È best-effort e non
 * blocca mai il chiamante (la notifica in-app, fonte di verità, è già scritta prima di questa);
 * ogni canale ha il suo esito e non dichiara «inviato» ciò che non è partito (regola 7). Nessun
 * canale configurato → `saltato`, non un falso successo.
 */
export async function avvisaClienteViaCanali(
  tenantId: string,
  clienteId: string,
  msg: { oggetto: string; corpo: string; link?: string },
): Promise<{ email: 'inviata' | 'saltata' | 'errore'; whatsapp: 'inviato' | 'saltato' | 'errore' }> {
  const esiti: { email: 'inviata' | 'saltata' | 'errore'; whatsapp: 'inviato' | 'saltato' | 'errore' } = {
    email: 'saltata',
    whatsapp: 'saltato',
  };
  try {
    const cliente = await prisma.cliente.findFirst({
      where: { id: clienteId, tenantId },
      select: { email: true, cellulare: true },
    });
    if (!cliente) return esiti;
    const cred = await credenzialiCanali(tenantId);

    if (cliente.email && cred.smtp?.host && cred.smtp?.user) {
      try {
        const html = `<p>${msg.corpo}</p>${msg.link ? `<p><a href="${msg.link}">Accedi al portale</a></p>` : ''}`;
        const r = await inviaEmail({
          to: cliente.email,
          subject: msg.oggetto,
          html,
          smtp: cred.smtp,
          fromEmail: cred.smtpFromEmail ?? undefined,
          fromName: cred.smtpFromName ?? undefined,
          etichetta: 'documento_da_firmare',
        });
        esiti.email = r.ok ? 'inviata' : 'errore';
      } catch {
        esiti.email = 'errore';
      }
    }

    if (cliente.cellulare) {
      try {
        const testo = msg.link ? `${msg.corpo}\n\n${msg.link}` : msg.corpo;
        const r = await inviaTestoWhatsapp(cred, cliente.cellulare, testo);
        esiti.whatsapp = r.ok ? 'inviato' : 'errore';
      } catch {
        esiti.whatsapp = 'errore';
      }
    }
  } catch {
    // best-effort: un guasto sui canali esterni non deve mai propagarsi al chiamante.
  }
  return esiti;
}

/**
 * Variante "silenziosa": solo persistenza, niente SSE. Usata dal cron, dove
 * l'evento è una scansione programmata e nessuno sta guardando lo stream in
 * quel momento (il destinatario la vedrà al prossimo accesso).
 */
export async function notificaStudioSilenziosa(tenantId: string, dati: DatiEvento): Promise<number> {
  const utenti = await prisma.user.findMany({
    where: { tenantId, stato: 'attivo' },
    select: { id: true },
  });
  if (utenti.length === 0) return 0;
  const res = await prisma.notifica.createMany({
    data: utenti.map((u) => ({
      tenantId,
      destinatarioId: u.id,
      destinatarioTipo: 'user',
      tipoEvento: dati.tipoEvento,
      oggetto: dati.oggetto,
      corpo: dati.corpo,
      link: dati.link ?? null,
      canale: 'in_app',
      inviataAt: new Date(),
    })),
  });
  return res.count;
}
