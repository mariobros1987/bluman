import type { PaginazioneQuery } from '../schemas/paginazione.schema.js';

export interface MetaPaginazione {
  page: number;
  limit: number;
  totalCount: number;
  totalPages: number;
  hasPrev: boolean;
  hasNext: boolean;
}

export interface RisultatoPaginato<T> {
  data: T[];
  meta: MetaPaginazione;
}

export function calcolaSkipTake(query?: PaginazioneQuery): { skip: number; take: number; page: number; limit: number } {
  const page = Math.max(1, query?.page || 1);
  const limit = Math.min(200, Math.max(1, query?.limit || 50));
  const skip = (page - 1) * limit;

  return { skip, take: limit, page, limit };
}

export function formattaRisultatoPaginato<T>(
  data: T[],
  totalCount: number,
  page: number,
  limit: number,
): RisultatoPaginato<T> {
  const totalPages = Math.ceil(totalCount / limit) || 1;

  return {
    data,
    meta: {
      page,
      limit,
      totalCount,
      totalPages,
      hasPrev: page > 1,
      hasNext: page < totalPages,
    },
  };
}
