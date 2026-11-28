// L'errore di un'emissione rifiutata. Sta in un file suo perché lo leggono sia le chiamate
// (`fatturazione.ts`) sia il modale che lo mostra (`components/contabilita/DatiClienteMancanti.tsx`).

/** Il server ha rifiutato l'emissione perché al cliente mancano dati fiscali: la pagina porta alla sua scheda. */
export class ErroreDatiClienteMancanti extends Error {
  readonly datiMancanti: string[];
  readonly clienteNome: string;
  readonly clienteId: string;
  constructor(messaggio: string, datiMancanti: string[], clienteNome: string, clienteId: string) {
    super(messaggio);
    this.name = 'ErroreDatiClienteMancanti';
    this.datiMancanti = datiMancanti;
    this.clienteNome = clienteNome;
    this.clienteId = clienteId;
  }
}

/** Riconosce «mancano i dati del cliente» (409 con `codice`); il resto è il messaggio del server. */
export async function erroreEmissione(res: Response, fallback: string): Promise<Error> {
  const body = await res.json().catch(() => null);
  if (body?.codice === 'DATI_CLIENTE_MANCANTI' && Array.isArray(body.datiMancanti)) {
    return new ErroreDatiClienteMancanti(body.errore || fallback, body.datiMancanti, body.clienteNome || 'cliente', body.clienteId || '');
  }
  return new Error(body?.errore || body?.error || body?.message || `${fallback} (HTTP ${res.status})`);
}
