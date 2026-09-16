/**
 * Ingestione dei messaggi Signal in arrivo.
 *
 * Perché un file e non dentro `signalService.ts`: là c'è il *trasporto* — parlare col demone —
 * qui c'è la *decisione* — a quale cliente e a quale progetto appartiene questo messaggio, e
 * cosa scriverne a database. È la stessa separazione che tiene `whatsappService.ts` distinto dal
 * percorso di ingestione in `src/routes/webhooks.ts`, e serve perché le due parti cambiano per
 * ragioni diverse: il trasporto quando cambia il demone, l'ingestione quando cambia l'anagrafica.
 *
 * La differenza di fondo rispetto a WhatsApp e Telegram, che va detta: quei due *ricevono* una
 * chiamata del provider, e il provider ritenta finché non ottiene un 200 — un guasto momentaneo
 * si recupera da sé. Signal no: `GET /v1/receive` **preleva** i messaggi dalla coda del demone e
 * li toglie. Chi legge ha una sola occasione. Per questo qui si persiste subito, in una
 * transazione sola, e l'idempotenza sulla tabella `webhook_inbox` protegge dalle riletture (che
 * il cron può produrre se due giri si sovrappongono), non dalla perdita.
 */
import type { Prisma } from '@prisma/client';
import { prisma, conContestoInTransazione } from '../util/prismaClient';
import { normalizzaTelefono } from '../util/webhookSecurity';
import { notificaStudio } from './notificheService';
import { isProgettoAttivo } from '../domain/stateEngine';
import { uploadDocumento } from './storageService';
import { credenzialiCanali } from './otpDispatch.js';
import { registraIngressoSenzaFascicolo } from './ingressoSenzaFascicolo.js';
import {
  riceviSignal,
  scaricaAllegatoSignal,
  type CredenzialiSignal,
  type MessaggioSignalRicevuto,
} from './signalService.js';

/** Esito di un giro di ricezione, per il report del cron e per la diagnostica. */
export interface EsitoRicezioneSignal {
  /** Vero quando lo studio non ha Signal configurato: non è un errore, è un canale spento. */
  nonConfigurato?: boolean;
  letti: number;
  registrati: number;
  scartati: number;
  errore?: string;
}

type TransazioneIngestione = {
  webhookInbox: {
    create: (args: { data: { tenantId: string; provider: string; eventId: string } }) => Promise<unknown>;
  };
  comunicazioneProgetto: {
    create: (args: Prisma.ComunicazioneProgettoCreateArgs) => Promise<unknown>;
  };
};

/** Replay: la busta era già stata registrata. Non è un guasto, è il caso previsto. */
function isReplay(err: unknown): boolean {
  if (typeof err !== 'object' || err === null || !('code' in err)) return false;
  return (err as { code?: unknown }).code === 'P2002';
}

async function transazione<T>(operazione: (tx: TransazioneIngestione) => Promise<T>): Promise<T> {
  return prisma.$transaction((tx) => conContestoInTransazione(tx, () => operazione(tx as TransazioneIngestione)));
}

/** Nome del file allegato, ripulito: finisce in un percorso di storage. */
function nomeAllegatoSicuro(nome: string, id: string, mime: string): string {
  const estensione = mime.split('/')[1]?.split(';')[0]?.replace(/[^a-z0-9]/gi, '') || 'bin';
  const base = nome.replace(/\.[^.]+$/, '').replace(/[^\w.\-]/g, '_').slice(0, 80) || `signal_${id.slice(-8)}`;
  return `${base}.${estensione}`;
}

/**
 * Registra gli allegati di un messaggio e restituisce la forma che la chat si aspetta.
 *
 * Un download fallito non ferma l'ingestione: si registra il nome del file, così l'operatore
 * vede che è arrivato qualcosa e può chiederlo al cliente. Lo stesso comportamento del percorso
 * WhatsApp, e per la stessa ragione — perdere il messaggio intero perché un allegato non si è
 * scaricato sarebbe peggio.
 */
async function salvaAllegati(
  tenantId: string,
  cred: CredenzialiSignal,
  allegati: MessaggioSignalRicevuto['allegati'],
): Promise<Array<{ url: string; nome: string; dimensione: string; mime: string }> | null> {
  if (allegati.length === 0) return null;
  const salvati: Array<{ url: string; nome: string; dimensione: string; mime: string }> = [];
  for (const allegato of allegati) {
    const scaricato = await scaricaAllegatoSignal(cred, allegato.id);
    if (!scaricato) continue;
    const nome = nomeAllegatoSicuro(allegato.nome, allegato.id, scaricato.mime);
    const esito = await uploadDocumento(nome, `data:${scaricato.mime};base64,${scaricato.base64}`, tenantId);
    if (!esito.ok) continue;
    salvati.push({
      url: esito.url || '',
      nome,
      dimensione: `${Math.max(1, Math.round((allegato.dimensione || Buffer.from(scaricato.base64, 'base64').byteLength) / 1024))} KB`,
      mime: scaricato.mime,
    });
  }
  return salvati.length ? salvati : null;
}

/**
 * Un giro di ricezione per uno studio.
 *
 * Va chiamata **dentro** un contesto tenant (`contestoTenant.run`): le letture di clienti e
 * progetti devono passare dalle policy RLS, come per ogni altra richiesta.
 */
export async function riceviMessaggiSignal(tenantId: string): Promise<EsitoRicezioneSignal> {
  const cred = await credenzialiCanali(tenantId);
  if (!cred.signalEndpoint || !cred.signalNumber) {
    return { nonConfigurato: true, letti: 0, registrati: 0, scartati: 0 };
  }

  const esito = await riceviSignal(cred);
  if (!esito.ok) {
    return { letti: 0, registrati: 0, scartati: 0, errore: esito.errore };
  }

  const esitoFinale: EsitoRicezioneSignal = { letti: esito.messaggi.length, registrati: 0, scartati: 0 };
  if (esito.messaggi.length === 0) return esitoFinale;

  // Clienti e progetti si leggono una volta per giro: un giro porta i messaggi arretrati di più
  // clienti insieme, e rifare le stesse due query per ognuno è lavoro sprecato.
  const clienti = await prisma.cliente.findMany({
    where: { tenantId },
    select: { id: true, nome: true, cellulare: true, referentiJson: true },
  });

  for (const messaggio of esito.messaggi) {
    try {
      const corrispondenze = clienti.filter(cliente => {
        const recapiti = [cliente.cellulare];
        if (cliente.referentiJson && typeof cliente.referentiJson === 'object') {
          const ref = cliente.referentiJson as Record<string, unknown>;
          // `signal` è il recapito che la scheda cliente mostra per questo canale; `cellulare` e
          // `whatsapp` restano in elenco perché lo stesso numero è spesso lo stesso telefono.
          recapiti.push(ref.signal as string, ref.cellulare as string, ref.whatsapp as string);
        }
        return recapiti.some(recapito => normalizzaTelefono(recapito) === messaggio.mittente);
      });
      // Zero corrispondenze: mittente sconosciuto. Più di una: l'anagrafica è ambigua e
      // attribuire il messaggio al cliente sbagliato è peggio che non attribuirlo.
      if (corrispondenze.length !== 1) {
        esitoFinale.scartati += 1;
        continue;
      }
      const cliente = corrispondenze[0]!;

      // Come gli altri due canali: si legge solo ciò che può essere attivo (il filtro
      // `isProgettoAttivo` qui sotto scarta comunque tutto il resto, quindi il `where` non
      // cambia l'esito) e senza `take`, perché il motivo dell'avviso conta e nomina i
      // progetti: una lettura troncata lo farebbe mentire sul loro numero.
      const progetti = await prisma.progetto.findMany({
        where: { tenantId, clienteId: cliente.id, stato: 'in_progress' },
        select: { id: true, nome: true, stato: true },
      });
      const attivi = progetti.filter(p => isProgettoAttivo(p.stato));
      if (attivi.length !== 1) {
        esitoFinale.scartati += 1;
        // Il testo serve per l'avviso allo studio: lo componiamo prima di uscire.
        const testoMsg = messaggio.testo.trim()
          || (messaggio.allegati.length ? `[Allegato: ${messaggio.allegati[0]?.nome || 'file'}]` : '[Messaggio Signal]');
        await registraIngressoSenzaFascicolo(tenantId, 'signal', messaggio.eventId, {
          mittente: cliente.nome,
          testo: testoMsg,
          motivo: attivi.length === 0
            ? 'Non ha nessun progetto aperto: aprine uno, oppure scrivi al cliente da qui.'
            : `Ha ${attivi.length} progetti aperti (${attivi.map(p => p.nome).join(', ')}): `
              + 'chiudi quelli conclusi così i prossimi messaggi entrano da soli.',
        }).catch((err) => {
          // L'avviso non deve fermare il ciclo: se fallisce, il conteggio scartati è
          // già stato incrementato e il caller vede che il messaggio non è entrato.
          console.warn('[Signal] registraIngressoSenzaFascicolo fallita:', err);
        });
        continue;
      }
      const progetto = attivi[0]!;

      const allegati = await salvaAllegati(tenantId, cred, messaggio.allegati).catch(() => null);
      const testo = messaggio.testo.trim()
        || (messaggio.allegati.length ? `[Allegato: ${messaggio.allegati[0]?.nome || 'file'}]` : '');

      try {
        await transazione(async (tx) => {
          await tx.webhookInbox.create({
            data: { tenantId, provider: 'signal_message', eventId: messaggio.eventId },
          });
          await tx.comunicazioneProgetto.create({
            data: {
              tenantId,
              progettoId: progetto.id,
              canale: 'signal',
              mittente: messaggio.mittente ? `+${messaggio.mittente} (${cliente.nome})` : cliente.nome,
              destinatario: `Signal Studio (${cred.signalNumber})`,
              direzione: 'entrata',
              testo,
              externalId: `signal:${messaggio.eventId}`,
              ...(allegati ? { allegatiJson: JSON.stringify(allegati) } : {}),
            },
          });
        });
      } catch (err) {
        if (isReplay(err)) {
          esitoFinale.scartati += 1;
          continue;
        }
        throw err;
      }

      esitoFinale.registrati += 1;
      await notificaStudio(tenantId, {
        tipoEvento: 'messaggio_cliente',
        oggetto: 'Nuovo messaggio Signal',
        corpo: `${cliente.nome} ha scritto su Signal: ${testo.slice(0, 120)}`,
        link: `/projects/${progetto.id}`,
      }).catch(() => {});
    } catch (err) {
      esitoFinale.scartati += 1;
      console.warn(`[Signal] messaggio ${messaggio.eventId} non registrato:`, err);
    }
  }

  return esitoFinale;
}
