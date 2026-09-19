import React from 'react';

/**
 * Il segno di recapito di un messaggio, con il suo significato vero.
 *
 * Questo pezzo di interfaccia era duplicato in due posti — la chat dell'operatore
 * (`ComunicazioniTab`) e quella del portale (`TabContatti`) — con lo stesso difetto in entrambi:
 * un ternario a due rami e un `else` finale che disegnava ✓✓ «consegnato» per **qualunque** stato
 * non riconosciuto, `undefined` compreso. Una riga senza stato diventava così una consegna
 * dichiarata da nessuno. Il 17/09/2026 se ne sono contate sei in un giorno solo, tutte su invii
 * WhatsApp che Meta aveva rifiutato, e per mesi quel segno ha fatto credere che i messaggi
 * arrivassero ai clienti (regola 7).
 *
 * Qui ogni stato ha il suo segno e la sua spiegazione, e chi non dichiara uno stato non ne
 * riceve uno: gli si dice che non è registrato, che è diverso da «consegnato».
 *
 * I due contesti non dicono le stesse parole, perché non descrivono la stessa cosa:
 *   `operatore`  la chat dello studio, su un messaggio in uscita → le spunte riguardano il cliente;
 *   `portale`    il portale del cliente, su un messaggio che ha scritto lui → riguardano lo studio.
 */

export type StatoRecapito = 'da-inviare' | 'inviato' | 'consegnato' | 'letto' | 'non-inviato' | null | undefined;

export interface SpunteStatoProps {
  stato: StatoRecapito;
  inviatoAt?: string | null;
  consegnatoAt?: string | null;
  lettoAt?: string | null;
  /** Il motivo del rifiuto, quando lo stato è `non-inviato`. */
  errore?: string | null;
  contesto: 'operatore' | 'portale';
}

const BASE: React.CSSProperties = { fontWeight: 700, fontSize: 13, lineHeight: 1 };

function quando(iso?: string | null): string {
  return iso ? ` il ${new Date(iso).toLocaleString('it-IT')}` : '';
}

export function SpunteStato({ stato, inviatoAt, consegnatoAt, lettoAt, errore, contesto }: SpunteStatoProps) {
  const aDestinatario = contesto === 'operatore';

  switch (stato) {
    case 'letto':
      return (
        <span
          title={
            aDestinatario
              ? `Letto dal destinatario${quando(lettoAt)}`
              : `Letto dallo Studio${quando(lettoAt)}`
          }
          style={{ ...BASE, color: 'var(--cat-societario)', fontWeight: 800, letterSpacing: -1 }}
        >
          ✓✓
        </span>
      );

    case 'consegnato':
      return (
        <span
          title={
            aDestinatario
              ? `Consegnato al destinatario${quando(consegnatoAt)}`
              : `Arrivato allo Studio${quando(consegnatoAt)}`
          }
          style={{ ...BASE, color: 'var(--muted)', letterSpacing: -1 }}
        >
          ✓✓
        </span>
      );

    case 'inviato':
      // Una spunta sola, non due: il canale ha preso in carico il messaggio, la consegna al
      // destinatario non è ancora confermata. È la differenza che il segno deve comunicare.
      return (
        <span
          title={`Accettato dal canale${quando(inviatoAt)}: la consegna non è ancora confermata`}
          style={{ ...BASE, color: 'var(--muted)' }}
        >
          ✓
        </span>
      );

    case 'da-inviare':
      return (
        <span title="Non ancora inviato: il canale non è stato contattato" style={{ ...BASE, fontSize: 12, color: 'var(--muted)' }}>
          ◷
        </span>
      );

    case 'non-inviato':
      return (
        <span title={`Non inviato — ${errore || 'motivo non riportato'}`} style={{ ...BASE, fontSize: 12, color: 'var(--pill-red-fg)' }}>
          ✗
        </span>
      );

    default:
      // Nessuno stato in colonna. Si dice così, invece di disegnare una consegna che nessuno ha
      // dichiarato: riguarda le righe scritte prima che il fascicolo registrasse gli stati.
      return (
        <span title="Stato di recapito non registrato per questa riga" style={{ ...BASE, color: 'var(--muted)' }}>
          —
        </span>
      );
  }
}
