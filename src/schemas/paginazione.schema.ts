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
  // Filtro «accesso al portale» — lo legge solo GET /clienti.
  // Dichiarato QUI e non validato dentro la rotta perché `leggiPaginazione` valida con questo
  // schema, e zod SCARTA le chiavi non dichiarate: un `portale` non dichiarato verrebbe buttato
  // via in silenzio, e il filtro sembrerebbe attivo senza filtrare niente. Come enum, un valore
  // inventato diventa un 400 con messaggio invece di un filtro ignorato.
  portale: z.enum(['con', 'senza']).optional(),
  // Filtro per intervallo di date (YYYY-MM-DD). La validazione della data vera e propria
  // (respingere 2026-02-30) la fa `leggiIntervalloData` in util/intervalloData.ts.
  dataDa: z.string().max(10).optional(),
  dataA: z.string().max(10).optional(),
});

export type PaginazioneQuery = z.infer<typeof PaginazioneQuerySchema>;
