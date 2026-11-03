import { fetchTenantInfoApi, inviaComunicazioneApi } from '../api/client';

/**
 * 3.21 — L'avviso WhatsApp al cliente quando un modulo è completato.
 *
 * Il mittente è la ragione sociale dello studio letta dal server (prima c'era scritto a mano
 * «BlueCode Advisor Studio», lo stesso per ogni studio). Senza ragione sociale l'avviso non parte
 * e l'operatore lo sa: il modulo resta completato, manca solo il messaggio.
 */
export const AVVISO_SENZA_RAGIONE_SOCIALE =
  'Avviso al cliente non inviato: completa la ragione sociale dello studio in Impostazioni.';

export interface DatiAvvisoModulo {
  progettoId: string;
  nomeProgetto: string;
  nomeModulo: string;
  destinatario: string;
}

/** Restituisce `true` se l'avviso è partito; ogni mancato invio passa da `segnalaErrore`. */
export async function inviaAvvisoModuloCompletato(
  dati: DatiAvvisoModulo,
  segnalaErrore: (messaggio: string) => void,
): Promise<boolean> {
  const studio = await fetchTenantInfoApi();
  const mittente = typeof studio?.ragioneSociale === 'string' ? studio.ragioneSociale.trim() : '';
  if (!mittente) {
    segnalaErrore(AVVISO_SENZA_RAGIONE_SOCIALE);
    return false;
  }
  try {
    await inviaComunicazioneApi(dati.progettoId, {
      canale: 'whatsapp',
      mittente,
      destinatario: dati.destinatario,
      direzione: 'uscita',
      testo: `🔔 Avanzamento Pratica "${dati.nomeProgetto}": il modulo "${dati.nomeModulo}" è stato completato.`,
    });
    return true;
  } catch (err) {
    console.error('Avviso di modulo completato non inviato', err);
    segnalaErrore(`Avviso al cliente sul modulo "${dati.nomeModulo}" non inviato: ${err instanceof Error ? err.message : 'errore di rete'}.`);
    return false;
  }
}
