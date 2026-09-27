import { z } from 'zod';

export const PaginazioneQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1).optional(),
  limit: z.coerce.number().int().min(1).max(200).default(50).optional(),
  search: z.string().max(255).optional(),
  sortBy: z.string().max(50).optional(),
  sortOrder: z.enum(['asc', 'desc']).default('desc').optional(),
  stato: z.string().max(50).optional(),
  tipo: z.string().max(50).optional(),
  metodo: z.string().max(50).optional(),
  // Filtro per intervallo di date (YYYY-MM-DD). La validazione della data vera e propria
  // (respingere 2026-02-30) la fa `leggiIntervalloData` in util/intervalloData.ts.
  dataDa: z.string().max(10).optional(),
  dataA: z.string().max(10).optional(),
});

export type PaginazioneQuery = z.infer<typeof PaginazioneQuerySchema>;
