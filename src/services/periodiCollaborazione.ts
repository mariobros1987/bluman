// Archiviazione degli operatori: i periodi di collaborazione (§2bis).
//
// `User.stato` dice se l'utenza funziona **adesso**; `periodo_collaborazione` dice **da quando
// a quando** la persona ha lavorato per lo studio. Le due cose sono la stessa verità scritta
// due volte, quindi non possono divergere:
//
//     stato = 'disattivato'  ⟺  non esiste un periodo con `al` nullo
//
// A presidiare l'equivalenza è questo file, e solo questo: ogni scrittura su `stato` legata a
// un'entrata o a un'uscita passa da qui, dentro una transazione che tocca periodo e utente
// insieme. Se le due scritture stessero in due punti diversi, un errore in mezzo lascerebbe una
// persona disattivata con il periodo ancora aperto — o, peggio, attiva e invisibile.
//
// Perché non due colonne su `user`: le stagioni possono essere più d'una. Una persona se ne va
// e rientra, e `dataAssunzione`/`dataCessazione` sovrascritte al secondo giro cancellerebbero
// la prima. Qui ogni stagione resta.

import type { StatoUtente } from '@prisma/client';
import { prisma, conContestoInTransazione } from '../util/prismaClient.js';

/**
 * Esito di un'operazione sui periodi.
 *
 * Il servizio non conosce Fastify e non risponde: restituisce lo stato HTTP da usare, e la
 * rotta lo traduce in `reply.code(...)`. Così le regole stanno in un posto solo e restano
 * verificabili da un test senza montare un server.
 */
export type EsitoPeriodo =
  // `stato` nel ramo di errore è lo **stato HTTP** da rispondere; `statoUtente` nel ramo di
  // successo è lo `stato` dell'utenza dopo l'operazione. Chiamarli allo stesso modo sarebbe
  // stato un invito a leggerli per sbaglio.
  | { ok: true; periodoId: string; dal: Date; al: Date | null; statoUtente?: StatoUtente }
  | { ok: false; stato: number; errore: string };

export interface DatiDisattivazione {
  tenantId: string;
  userId: string;
  /** Giorno in cui la collaborazione finisce. Precompilato a oggi nella UI, modificabile. */
  dataFine: Date;
  motivo?: string | null;
  /** `user.id` di chi archivia: finisce in `periodo_collaborazione.creato_da`. */
  attoreUserId: string | null;
}

export interface DatiRiattivazione {
  tenantId: string;
  userId: string;
  /** Giorno in cui la nuova collaborazione comincia. Precompilato a oggi nella UI. */
  dataInizio: Date;
  attoreUserId: string | null;
}

/** Chiusura di un periodo: archivia la persona. Vedi `disattivaCollaboratore`. */
export async function disattivaCollaboratore(dati: DatiDisattivazione): Promise<EsitoPeriodo> {
  const { tenantId, userId, dataFine, motivo, attoreUserId } = dati;

  return prisma.$transaction(async (tx) =>
    conContestoInTransazione(tx, async () => {
      const aperto = await tx.periodoCollaborazione.findFirst({
        where: { tenantId, userId, al: null },
        orderBy: { dal: 'desc' },
      });

      // Senza un periodo aperto non c'è niente da chiudere. Succede se si archivia due volte
      // la stessa persona, o se la riga è stata disattivata a mano prima che esistesse questo
      // servizio: in entrambi i casi rispondere «fatto» sarebbe una bugia.
      if (!aperto) {
        return {
          ok: false,
          stato: 409,
          errore: 'Questa persona non risulta in forza: non c\'è nessun periodo aperto da chiudere.',
        } as const;
      }

      // Una fine che precede l'inizio scriverebbe un periodo a durata negativa: la storia
      // resterebbe illeggibile proprio nel punto in cui serve.
      if (dataFine.getTime() < aperto.dal.getTime()) {
        return {
          ok: false,
          stato: 400,
          errore:
            'La data di fine non può precedere l\'inizio della collaborazione ' +
            `(${aperto.dal.toLocaleDateString('it-IT')}).`,
        } as const;
      }

      // Lo studio non può restare senza nessun responsabile attivo: senza un advisor,
      // `POST /tenant/utenti` risponde 403 a chiunque e il team non è più gestibile — né
      // riattivabile da lì. Il conteggio sta **dentro** la transazione, non prima: due
      // responsabili che si archiviano a vicenda nello stesso istante passerebbero entrambi
      // un controllo fatto fuori di qui, e lo studio resterebbe chiuso a chiave.
      const utente = await tx.user.findUnique({
        where: { id: userId },
        select: { ruolo: true, stato: true },
      });
      if (utente?.ruolo === 'advisor') {
        const altriAdvisor = await tx.user.count({
          where: { tenantId, ruolo: 'advisor', stato: 'attivo', id: { not: userId } },
        });
        if (altriAdvisor === 0) {
          return {
            ok: false,
            stato: 400,
            errore:
              'Questo è l\'ultimo responsabile attivo dello studio. Nomina o riattiva un altro ' +
              'responsabile prima di archiviarlo, altrimenti nessuno può più gestire il team.',
          } as const;
        }
      }

      const chiuso = await tx.periodoCollaborazione.update({
        where: { id: aperto.id },
        // `creatoDa` registra chi ha chiuso il periodo, non chi lo aveva aperto: su una riga
        // chiusa la domanda che ci si fa è «chi l'ha archiviato?».
        //
        // `statoPrecedente` è lo stato dell'utenza **prima** di spegnerla. Senza, al rientro non
        // resterebbe traccia di chi non era mai entrato davvero: chi è `invitato` ha una password
        // temporanea che deve ancora cambiare, e riattivarlo come `attivo` gli darebbe un accesso
        // pieno retto da una password che chi l'ha creato conosce.
        data: {
          al: dataFine,
          motivo: motivo?.trim() || null,
          creatoDa: attoreUserId,
          statoPrecedente: (utente?.stato ?? 'attivo') as StatoUtente,
        },
      });

      // `sessionVersion` incrementata come nel reset password: la sessione eventualmente
      // aperta muore subito, invece di restare valida fino alla scadenza del JWT. Il controllo
      // su `disattivato` negli hook di autenticazione la coprirebbe comunque, ma due reti
      // costano una riga.
      await tx.user.update({
        where: { id: userId },
        data: { stato: 'disattivato', sessionVersion: { increment: 1 } },
      });

      return { ok: true, periodoId: chiuso.id, dal: chiuso.dal, al: chiuso.al } as const;
    }),
  );
}

/** Apertura di un nuovo periodo: riporta in forza la persona. Vedi `riattivaCollaboratore`. */
export async function riattivaCollaboratore(dati: DatiRiattivazione): Promise<EsitoPeriodo> {
  const { tenantId, userId, dataInizio, attoreUserId } = dati;

  return prisma.$transaction(async (tx) =>
    conContestoInTransazione(tx, async () => {
      const aperto = await tx.periodoCollaborazione.findFirst({
        where: { tenantId, userId, al: null },
        select: { id: true },
      });

      if (aperto) {
        return {
          ok: false,
          stato: 409,
          errore: 'Questa persona risulta già in forza: c\'è un periodo aperto da chiudere.',
        } as const;
      }

      const ultimo = await tx.periodoCollaborazione.findFirst({
        where: { tenantId, userId, al: { not: null } },
        orderBy: { dal: 'desc' },
      });

      // La nuova stagione non può cominciare prima che la precedente sia finita: sarebbero due
      // periodi sovrapposti, e «in forza» smetterebbe di avere un significato univoco.
      if (ultimo?.al && dataInizio.getTime() < ultimo.al.getTime()) {
        return {
          ok: false,
          stato: 400,
          errore:
            'La data di inizio non può precedere la fine della collaborazione precedente ' +
            `(${ultimo.al.toLocaleDateString('it-IT')}).`,
        } as const;
      }

      const nuovo = await tx.periodoCollaborazione.create({
        data: { tenantId, userId, dal: dataInizio, al: null, creatoDa: attoreUserId },
      });

      // Lo stato di prima dell'archiviazione, non `attivo` a scatola chiusa: chi era `invitato`
      // — creato, mai entrato, con la password temporanea ancora da cambiare — torna `invitato`,
      // e l'obbligo di scegliersi una password resta dov'era. Per tutti gli altri è `attivo`.
      // Se il periodo precedente non lo registra (righe nate prima di questa colonna), `attivo`
      // è il ripiego giusto: chi era in forza aveva un accesso funzionante.
      const statoDiRitorno: StatoUtente = ultimo?.statoPrecedente === 'invitato' ? 'invitato' : 'attivo';

      // `sessionVersion` incrementata anche qui: una sessione aperta prima dell'archiviazione
      // non deve tornare valida riattivando la persona.
      await tx.user.update({
        where: { id: userId },
        data: { stato: statoDiRitorno, sessionVersion: { increment: 1 } },
      });

      return { ok: true, periodoId: nuovo.id, dal: nuovo.dal, al: nuovo.al, statoUtente: statoDiRitorno } as const;
    }),
  );
}
