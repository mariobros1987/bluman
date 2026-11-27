import { z } from 'zod';
import { LUNGHEZZA_MASSIMA_NOTA, LUNGHEZZA_MINIMA_NOTA, STATI_NOTA_BETA, TIPI_NOTA_BETA } from '../domain/notaBeta.js';

export const CreaNotaBetaSchema = z.object({
  /** L'indirizzo della pagina in cui si trova chi scrive, così com'è nel browser. */
  percorso: z.string().min(1).max(300).startsWith('/', 'Indirizzo della pagina non valido'),
  tipo: z.enum(TIPI_NOTA_BETA).default('errore'),
  testo: z
    .string()
    .transform((v) => v.trim())
    .pipe(
      z
        .string()
        .min(LUNGHEZZA_MINIMA_NOTA, 'Scrivi almeno qualche parola: cosa non va o cosa si può migliorare.')
        .max(LUNGHEZZA_MASSIMA_NOTA, `La nota è troppo lunga (massimo ${LUNGHEZZA_MASSIMA_NOTA} caratteri).`),
    ),
});

export const AggiornaNotaBetaSchema = z.object({
  stato: z.enum(STATI_NOTA_BETA),
});
