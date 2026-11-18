/**
 * L'oggetto delle email che lo studio scrive al cliente dalla scheda Comunicazioni.
 * Il nome è quello dello studio, mai uno scritto a mano: senza ragione sociale restituisce null
 * e chi chiama non invia.
 */
export const EMAIL_SENZA_RAGIONE_SOCIALE =
  'Email non inviata: completa la ragione sociale dello studio in Impostazioni.';

export function oggettoEmailCliente(ragioneSociale: unknown, nomeCliente?: string): string | null {
  const studio = typeof ragioneSociale === 'string' ? ragioneSociale.trim() : '';
  if (!studio) return null;
  const cliente = (nomeCliente || '').trim();
  return cliente ? `Comunicazione ${studio} — Fascicolo ${cliente}` : `Comunicazione ${studio}`;
}
