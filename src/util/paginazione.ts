import { PaginazioneQuerySchema, type PaginazioneQuery } from '../schemas/paginazione.schema.js';

export interface MetaPaginazione {
  page: number;
  limit: number;
  totale: number;
  pagine: number;
}

export interface ParametriPaginazione {
  page: number;
  limit: number;
  search?: string;
  sortBy?: string;
  sortOrder: 'asc' | 'desc';
  stato?: string;
  tipo?: string;
  metodo?: string;
  dataDa?: string;
  dataA?: string;
  skip: number;
}

export type EsitoPaginazione =
  | { paginata: false }
  | { paginata: true; errore: string }
  | { paginata: true; parametri: ParametriPaginazione };

const CHIAVI_PAGINAZIONE = [
  'page', 'limit', 'search', 'sortBy', 'sortOrder', 'stato', 'tipo',
  'metodo', 'dataDa', 'dataA',
] as const;

export function leggiPaginazione(query: unknown): EsitoPaginazione {
  const raw = query && typeof query === 'object' ? query as Record<string, unknown> : {};
  const paginata = CHIAVI_PAGINAZIONE.some((chiave) => raw[chiave] !== undefined);
  if (!paginata) return { paginata: false };

  const parsed = PaginazioneQuerySchema.safeParse(raw);
  if (!parsed.success) {
    return {
      paginata: true,
      errore: parsed.error.issues[0]?.message || 'Parametri di paginazione non validi',
    };
  }

  const data: PaginazioneQuery = parsed.data;
  const page = data.page ?? 1;
  const limit = data.limit ?? 50;
  const search = data.search?.trim() || undefined;
  return {
    paginata: true,
    parametri: {
      page,
      limit,
      search,
      sortBy: data.sortBy,
      sortOrder: data.sortOrder ?? 'desc',
      stato: data.stato,
      tipo: data.tipo,
      metodo: data.metodo,
      dataDa: data.dataDa,
      dataA: data.dataA,
      skip: (page - 1) * limit,
    },
  };
}

export function creaMetaPaginazione(page: number, limit: number, totale: number): MetaPaginazione {
  return {
    page,
    limit,
    totale,
    pagine: totale === 0 ? 0 : Math.ceil(totale / limit),
  };
}

export function campoOrdinamento<T extends string>(
  richiesto: string | undefined,
  consentiti: readonly T[],
  predefinito: T,
): T | null {
  if (!richiesto) return predefinito;
  return consentiti.includes(richiesto as T) ? richiesto as T : null;
}
