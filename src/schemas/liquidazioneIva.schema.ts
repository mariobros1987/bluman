import { z } from 'zod';

export const CalcolaLipeQuerySchema = z.object({
  periodo: z.string().min(4, 'Periodo non valido (es. 2026-09 o 2026-Q3)'),
  creditoPrecedenteCent: z.coerce.number().int().min(0).default(0).optional(),
});

export const SalvaLipeSchema = z.object({
  periodo: z.string().min(4, 'Periodo obbligatorio'),
  creditoPrecedenteCent: z.number().int().min(0).default(0).optional(),
});

export const MarcaVersataLipeSchema = z.object({
  dataVersamento: z.string().or(z.date()).default(() => new Date()).transform((val) => new Date(val)),
  contoBancarioId: z.string().uuid().optional().nullable(),
  registraPrimaNota: z.boolean().default(true).optional(),
  riferimentoTransazione: z.string().optional().nullable(),
  note: z.string().optional().nullable(),
});
