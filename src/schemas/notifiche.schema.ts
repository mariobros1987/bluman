import { z } from 'zod';

/**
 * Guardia di forma per `POST /notifiche`. Non cambia la logica dell'handler (che tiene il suo
 * controllo «almeno un destinatario»): mette solo un tetto alle stringhe libere, che prima
 * finivano in colonna senza limite. `.passthrough()` come gli altri schemi dell'app: le chiavi
 * extra non rompono i client che le mandano, ma i campi noti sono tipati e limitati.
 */
export const CreaNotificaSchema = z.object({
  destinatarioId: z.string().max(100).optional().nullable(),
  destinatarioClienteId: z.string().max(100).optional().nullable(),
  tipoEvento: z.string().max(100).optional().nullable(),
  // Un link di notifica è un percorso interno o un URL: generoso, ma non illimitato.
  link: z.string().max(2000).optional().nullable(),
  // `canale` resta una stringa (non un enum): l'handler ripiega su `in_app` e i canali possibili
  // evolvono — un enum troppo stretto rifiuterebbe con un 400 un canale che il server sa gestire.
  canale: z.string().max(50).optional().nullable(),
  oggetto: z.string().max(255).optional().nullable(),
  title: z.string().max(255).optional().nullable(),
  corpo: z.string().max(10000).optional().nullable(),
  body: z.string().max(10000).optional().nullable(),
}).passthrough();
