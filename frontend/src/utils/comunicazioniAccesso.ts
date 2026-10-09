import { getUserPermission } from './rbac';

/**
 * L'utente che ha fatto l'accesso, letto da `bluman_user` come fa il resto dell'app
 * (`useInvioComunicazione`, `PassaggioModal`, le pagine). `null` quando non c'è o è
 * illeggibile — e `getUserPermission(null, …)` risponde `denied`, che è il verso giusto:
 * lato server la richiesta sarebbe 401 comunque.
 */
function utenteCorrente(): unknown {
  const grezzo = typeof window !== 'undefined' ? localStorage.getItem('bluman_user') : null;
  if (!grezzo) return null;
  try {
    return JSON.parse(grezzo);
  } catch {
    return null;
  }
}

/**
 * Se chi guarda può vedere il fascicolo comunicazioni di un cliente.
 *
 * Dal 09/10/2026 la matrice Permessi governa anche la **lettura** della casella, non solo l'invio
 * (voce 4 del piano di miglioramento). Prima di allora le rotte di sola lettura —
 * `POST /comunicazioni/email-in-arrivo`, `POST /comunicazioni/poll-imap-allegati`,
 * `GET /progetti/:id/comunicazioni`, `GET /microvoci/:id/comunicazioni` — non erano nella mappa
 * di `rbacModuli.ts`: un collaboratore con `communications: denied` non poteva scrivere ai
 * clienti ma leggeva tutta la loro corrispondenza con una chiamata qualsiasi.
 *
 * Il guard che conta resta quello lato server (`src/server.ts`, hook `onRequest`): questo serve
 * solo a non mostrare schede e linguette che risponderebbero 403 a ogni richiesta. Tenerlo
 * allineato a `permessoDefaultPerRuolo` è un requisito, non una preferenza: se i due divergono,
 * l'interfaccia promette un accesso che l'API nega.
 */
export function haAccessoComunicazioni(): boolean {
  return getUserPermission(utenteCorrente(), 'communications') !== 'denied';
}
