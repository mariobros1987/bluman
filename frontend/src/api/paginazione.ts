export interface ParametriListaPaginata {
  page?: number;
  limit?: number;
  search?: string;
  sortBy?: string;
  sortOrder?: 'asc' | 'desc';
  stato?: string;
  tipo?: string;
  metodo?: string;
}

export interface MetaPaginazione {
  page: number;
  limit: number;
  totale: number;
  pagine: number;
}

export interface RispostaPaginata<T, Riepilogo = never> {
  data: T[];
  meta: MetaPaginazione;
  riepilogo?: Riepilogo;
}

export function queryPaginazione(parametri?: ParametriListaPaginata): string {
  if (!parametri) return '';
  const query = new URLSearchParams();
  if (parametri.page !== undefined) query.set('page', String(parametri.page));
  if (parametri.limit !== undefined) query.set('limit', String(parametri.limit));
  if (parametri.search?.trim()) query.set('search', parametri.search.trim());
  if (parametri.sortBy) query.set('sortBy', parametri.sortBy);
  if (parametri.sortOrder) query.set('sortOrder', parametri.sortOrder);
  if (parametri.stato) query.set('stato', parametri.stato);
  if (parametri.tipo) query.set('tipo', parametri.tipo);
  if (parametri.metodo) query.set('metodo', parametri.metodo);
  const serializzata = query.toString();
  return serializzata ? `?${serializzata}` : '';
}

export function isRispostaPaginata<T>(valore: unknown): valore is RispostaPaginata<T, unknown> {
  if (!valore || typeof valore !== 'object') return false;
  const risposta = valore as Partial<RispostaPaginata<T, unknown>>;
  return Array.isArray(risposta.data) && Boolean(risposta.meta);
}
