// Le righe di testo del PDF della fattura che dipendono da dati facoltativi, tenute qui perché si
// possano provare senza disegnare un PDF. Regola unica: il dato che manca non si scrive, e al suo
// posto non compare un valore plausibile.

/**
 * Codice SDI e sede del cliente, solo se ci sono. Prima la riga era sempre
 * «SDI: 0000000 | Sede: Italia»: per un cliente estero o senza codice la fattura dichiarava un
 * codice destinatario e un Paese che nessuno aveva indicato.
 */
export function rigaSdiSedeCliente(dati: { clienteSdiCode?: string | null; clienteSede?: string | null }): string {
  const sdi = dati.clienteSdiCode?.trim();
  const sede = dati.clienteSede?.trim();
  return [sdi ? `SDI: ${sdi}` : null, sede ? `Sede: ${sede}` : null].filter(Boolean).join(' | ');
}

/**
 * Le condizioni di pagamento, solo se la fattura le porta. Prima, mancando, il PDF scriveva
 * «Bonifico 30 gg»: un termine che poteva contraddire le scadenze vere delle rate.
 */
export function rigaPagamento(condizionePagamento?: string | null): string {
  const testo = condizionePagamento?.trim();
  return testo ? `Pagamento: ${testo}` : '';
}
