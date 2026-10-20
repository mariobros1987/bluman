import { z } from 'zod';

/**
 * Approvazione massiva dalla coda KYC.
 *
 * Il tetto di 100 non è una regola di dominio: è il punto oltre il quale la risposta non è più
 * «una coda», e ogni transizione scrive storico + ComplianceEvent, quindi una richiesta enorme
 * diventerebbe un'unica chiamata lunga e difficile da ritentare. Chi ha più di 100 pratiche
 * approva in due giri, e sappiamo esattamente quali sono passate.
 */
export const ApprovazioneMassivaSchema = z.object({
  ids: z
    .array(z.string().uuid('Identificativo di fascicolo non valido.'))
    .min(1, 'Seleziona almeno una pratica da approvare.')
    .max(100, 'Si approvano al massimo 100 pratiche per volta.'),
  motivazione: z
    .string('La motivazione deve essere un testo.')
    .max(500, 'La motivazione è troppo lunga (massimo 500 caratteri).')
    .optional(),
});

export type ApprovazioneMassivaInput = z.infer<typeof ApprovazioneMassivaSchema>;
