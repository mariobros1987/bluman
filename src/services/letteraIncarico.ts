import crypto from 'crypto';

/**
 * Piano firma §8.4 (decisione del titolare, 03/10/2026) — l'impronta del TESTO della lettera
 * d'incarico.
 *
 * La lettera è l'unico atto firmabile che **non esiste come file**: il testo delle clausole è
 * un template del portale (`frontend/src/utils/documentTemplates.ts`, voce `tmpl-engagement`)
 * che il browser riempie con i dati dell'incarico. Il server non lo possiede, quindi non può
 * rileggerlo — ma può legare il sigillo alla **versione** di quel testo, che è una costante di
 * piattaforma.
 *
 * Questa costante è l'impronta SHA-256 del testo del template, con i fine riga normalizzati a
 * LF (`normalizzaFineRiga`: il file è CRLF su Windows e LF altrove, e un fine riga non è un
 * contenuto). Entra nel digest della firma insieme ai dati dell'incarico
 * (`improntaLetteraIncarico`, `src/routes/firma.ts`): così cambiare una clausola del mandato
 * cambia l'impronta della firma, esattamente come la cambia cambiare l'importo o i moduli.
 *
 * Chi modifica il testo della lettera aggiorna questa costante — e il presidio
 * `src/firmaLetteraIncarico.test.ts` glielo impone: se la costante non corrisponde più al
 * template del frontend, il test è rosso. Da ricordare quando lo si aggiorna: **ogni firma
 * apposta da lì in avanti porta un'impronta diversa**; le firme già registrate restano con la
 * loro, che è la verità di ciò che è stato firmato allora.
 */
export const LETTERA_INCARICO_TESTO_SHA256 =
  'c67d60ba0a4473a75befcfd8adc777042b104e58ca2c378f1e0fb9765db3342b';

/** CRLF e LF sono lo stesso testo: si normalizza prima di improntare. */
export function normalizzaFineRiga(testo: string): string {
  return testo.replace(/\r\n/g, '\n');
}

/**
 * Il testo della lettera d'incarico così com'è nel sorgente del frontend: la stringa
 * `contenutoHtml` della voce `tmpl-engagement` dentro `documentTemplates.ts`.
 *
 * Vive qui e non nel solo test perché è la definizione operativa di «il testo della lettera»:
 * il presidio — e chi aggiorna la costante — usa la stessa estrazione con cui la costante è
 * stata calcolata. Ritorna `null` quando il sorgente non ha più quella forma: meglio un test
 * rosso con un motivo che un'impronta calcolata su una fetta sbagliata di file.
 */
export function estraiTestoLetteraIncarico(sorgente: string): string | null {
  const BACKTICK = '`';
  const idVoce = "id: 'tmpl-engagement'";
  const iId = sorgente.indexOf(idVoce);
  if (iId < 0) return null;
  const apertura = `contenutoHtml: ${BACKTICK}`;
  const iAperta = sorgente.indexOf(apertura, iId);
  if (iAperta < 0) return null;
  const inizio = iAperta + apertura.length;
  const fine = sorgente.indexOf(BACKTICK, inizio);
  if (fine < 0) return null;
  const testo = sorgente.slice(inizio, fine);
  // Un'interpolazione (`${…}`) renderebbe il testo dipendente dai dati: non sarebbe più una
  // costante di piattaforma, e l'impronta non direbbe più cosa è stato firmato. Si dichiara
  // invece di improntare una cosa per un'altra.
  if (testo.includes('${')) return null;
  return testo;
}

/** L'impronta del testo della lettera, calcolata dal sorgente del template del frontend. */
export function improntaTestoLetteraIncarico(sorgente: string): string | null {
  const testo = estraiTestoLetteraIncarico(sorgente);
  if (testo === null) return null;
  return crypto.createHash('sha256').update(normalizzaFineRiga(testo), 'utf8').digest('hex');
}
