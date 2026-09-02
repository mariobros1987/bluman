import { z } from 'zod';

export const PaginazioneQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1).optional(),
  limit: z.coerce.number().int().min(1).max(200).default(50).optional(),
  search: z.string().max(255).optional(),
  sortBy: z.string().max(50).optional(),
  sortOrder: z.enum(['asc', 'desc']).default('desc').optional(),
});

export type PaginazioneQuery = z.infer<typeof PaginazioneQuerySchema>;
