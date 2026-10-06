import type { Cliente } from '../types';

/**
 * I recapiti di un cliente, letti dall'anagrafica: gli stessi che legge il backend.
 *
 * Perché è un file e non tre righe dentro la chat. L'estrazione li leggeva una volta sola, quando il
 * compositore era uno; ora i compositori sono due — la chat del fascicolo e la scheda di una
 * micro-voce — e due copie di questa lettura darebbero due pareri diversi sullo stesso cliente: il
 * canale risulterebbe disponibile in una vista e non nell'altra, che è esattamente il guasto che la
 * regola «nessun recapito inventato» esiste per evitare. Qui c'è una lettura sola.
 *
 * `''` significa **il recapito non c'è**, e non è un valore da riempire: un ripiego qui manda il
 * messaggio a una persona estranea al fascicolo. C'erano un'email, un cellulare e un handle
 * Telegram scritti nel codice, e l'interfaccia diceva «recapitato con successo».
 */
export interface RecapitiCliente {
  email: string;
  whatsapp: string;
  telegram: string;
  signal: string;
  referente: string;
}

export function recapitiDaAnagrafica(
  clientData: Cliente | null | undefined,
  nomeCliente?: string,
  emailCliente?: string,
): RecapitiCliente {
  const refJson: any = clientData?.referentiJson && typeof clientData.referentiJson === 'object'
    ? clientData.referentiJson
    : {};

  const email = clientData?.email || refJson.email || emailCliente || '';
  // Gli stessi recapiti che legge il backend, o il canale risulta disponibile qui e non là.
  // `telefono` non è un numero WhatsApp — può essere un fisso, e il backend lo rifiuta per questo:
  // lasciarlo passare qui significava offrire un canale che Meta avrebbe respinto.
  const whatsapp = clientData?.cellulare || refJson.cellulare || refJson.whatsapp || '';
  // La chat id, non `@username`: è quello che `sendMessage` vuole, ed è il campo che l'anagrafica ha
  // davvero (`telegramChatId`).
  const telegram = clientData?.telegramChatId || refJson.telegramChatId || '';
  // Signal non ha una colonna sua: il recapito vive in `referentiJson.signal`, come legge
  // `recapitiCliente` lato server. Non ricade su cellulare e telefono: il numero deve avere un
  // account Signal, e presumere che ce l'abbia manda il messaggio nel vuoto — o a chi quel numero
  // lo ha come normale SIM.
  const signal = refJson.signal || '';
  const referente = clientData?.referenteNome || refJson.referenteNome || refJson.referente || clientData?.ubo || nomeCliente || 'Referente Incarico';

  return { email, whatsapp, telegram, signal, referente };
}
