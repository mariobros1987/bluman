/**
 * Signal, con le credenziali dello studio.
 *
 * Prima di questo file il canale Signal era un campo di testo in Impostazioni → Canali
 * («Signal REST Daemon API Endpoint») che nessuna riga di codice leggeva, e il pulsante di prova
 * rispondeva «Daemon Signal REST API v1 in ascolto sul container Docker» — un demone che in
 * questo progetto non esiste. L'operatore lo compilava, leggeva che era in ascolto, e nessun
 * messaggio sarebbe mai partito (regola 7).
 *
 * Signal non è un servizio centralizzato come WhatsApp o Telegram: non esiste un'API di Signal
 * che uno studio possa chiamare con un token. Serve un `signal-cli-rest-api` **dello studio**,
 * con un numero registrato sopra, esposto in https. Questo file parla con quel demone e con
 * nient'altro:
 *
 * - invio:      `POST {endpoint}/v2/send`   — corpo `{message, number, recipients[]}`
 * - sonda:      `GET  {endpoint}/v1/about`  — versione e modalità del demone
 * - ricezione:  `GET  {endpoint}/v1/receive/{number}` — la coda dei messaggi in arrivo
 *
 * Le forme sono quelle del contratto OpenAPI del progetto `bbernhard/signal-cli-rest-api`
 * (`src/docs/swagger.json`), non ricordate: `SendMessageV2` ha `message`, `number` e `recipients`
 * obbligatori, `client.About` risponde `{build, capabilities, mode, version, versions[]}`.
 *
 * Regola di questo file, come per gli altri canali: se il demone non è configurato o l'invio
 * fallisce, si risponde `ok: false` con il motivo che ha dato il demone. Mai un successo
 * inventato.
 */
import { ErrorePolicyRete, validaUrlServizio, type EndpointServizio } from '../util/networkPolicy.js';

export interface CredenzialiSignal {
  signalEndpoint: string | null;
  signalToken: string | null;
  signalNumber: string | null;
}

export interface EsitoSignal {
  ok: boolean;
  errore?: string;
}

/** Quanto si aspetta il demone prima di dichiararlo irraggiungibile. */
const TIMEOUT_MS = 10_000;

/**
 * Il numero Signal in forma E.164, con il `+`.
 *
 * Signal vuole il `+` e le cifre: `+393351234567`. Il prefisso internazionale deve esserci ed
 * essere **esplicito** (`+39…` o `0039…`): senza, `3351234567` diventerebbe `+3351234567`, cioè
 * un numero francese, e il codice di firma partirebbe verso un estraneo in un altro paese. È il
 * tipo di errore che nessuno scopre finché il cliente non dice che non gli è arrivato niente.
 *
 * `numeroPerGraph` di WhatsApp fa l'opposto — toglie tutto tranne le cifre — perché Graph quella
 * forma la pretende. Confondere le due è il modo in cui un invio parte verso il numero sbagliato:
 * per questo le due funzioni non si assomigliano.
 */
export function numeroSignal(numero: string | null | undefined): string | null {
  const grezzo = String(numero ?? '').trim();
  if (!grezzo) return null;

  // Il prefisso internazionale può arrivare come `00`: si normalizza come altrove nel progetto.
  const senzaPrefisso = grezzo.startsWith('+') ? grezzo.slice(1) : grezzo.startsWith('00') ? grezzo.slice(2) : null;
  if (senzaPrefisso === null) return null;

  const cifre = senzaPrefisso.replace(/[^\d]/g, '');
  // E.164 ammette al massimo 15 cifre: oltre è un numero inventato, e un tentativo consuma
  // comunque una chiamata al demone.
  return /^[1-9]\d{7,14}$/.test(cifre) ? `+${cifre}` : null;
}

/** Vero quando lo studio ha indicato un demone e un numero utilizzabile: senza numero non c'è mittente. */
export function signalConfigurato(cred: CredenzialiSignal): boolean {
  return Boolean(cred.signalEndpoint && numeroSignal(cred.signalNumber));
}

/**
 * Prepara la chiamata: valida l'indirizzo con la policy di rete e ne ricava l'URL base.
 *
 * Restituisce un esito invece di lanciare perché l'indirizzo lo scrive l'operatore, e un
 * indirizzo scritto male deve produrre un motivo leggibile in interfaccia, non un 500.
 */
async function prepara(
  cred: CredenzialiSignal,
): Promise<{ ok: true; base: EndpointServizio } | { ok: false; errore: string }> {
  if (!cred.signalEndpoint) {
    return { ok: false, errore: 'Signal non è configurato: manca l\'indirizzo del demone Signal dello studio (Impostazioni → Canali).' };
  }
  try {
    const base = await validaUrlServizio(cred.signalEndpoint, 'Indirizzo del demone Signal');
    return { ok: true, base };
  } catch (err) {
    const motivo = err instanceof ErrorePolicyRete ? err.message : 'indirizzo non valido';
    return { ok: false, errore: `Signal non è utilizzabile: ${motivo}.` };
  }
}

/** Le intestazioni comuni: il token c'è solo se lo studio ne ha indicato uno. */
function intestazioni(cred: CredenzialiSignal): Record<string, string> {
  const h: Record<string, string> = { 'Content-Type': 'application/json' };
  if (cred.signalToken) h.Authorization = `Bearer ${cred.signalToken}`;
  return h;
}

async function conTimeout(url: string, init: RequestInit): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    return await fetch(url, { ...init, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Il messaggio di errore del demone, quando ne manda uno.
 *
 * `signal-cli-rest-api` risponde con `{"error": "..."}` sulle rotte v2 e con testo semplice
 * altrove. Si prova il JSON e si ripiega sul testo, senza inventare: se non si capisce niente si
 * riporta lo stato HTTP, che è già un'informazione vera.
 */
async function motivoDellaRisposta(risposta: Response): Promise<string> {
  const testo = await risposta.text().catch(() => '');
  if (!testo) return `HTTP ${risposta.status}`;
  try {
    const dati = JSON.parse(testo);
    const messaggio = dati?.error || dati?.message;
    return typeof messaggio === 'string' && messaggio.trim() ? messaggio.trim() : `HTTP ${risposta.status}`;
  } catch {
    return `${testo.trim().slice(0, 200) || `HTTP ${risposta.status}`}`;
  }
}

/**
 * Stato del demone: versione e modalità, con una prova che il numero dello studio ci sia sopra.
 *
 * `GET /v1/about` non dice quali numeri sono registrati — quello sta in `GET /v1/accounts` — ed è
 * la differenza che conta: un demone raggiungibile senza il numero dello studio registrato
 * risponde a questa sonda e poi rifiuta ogni invio. Quindi si chiedono entrambe le cose, e se il
 * numero non c'è lo si dice invece di lasciarlo scoprire al primo messaggio a un cliente.
 */
export async function statoSignal(
  cred: CredenzialiSignal,
): Promise<{ ok: boolean; messaggio: string }> {
  const preparato = await prepara(cred);
  if (!preparato.ok) return { ok: false, messaggio: preparato.errore };
  const { base } = preparato;

  let about: any;
  try {
    const risposta = await conTimeout(`${base.url}/v1/about`, { headers: intestazioni(cred) });
    if (!risposta.ok) {
      return { ok: false, messaggio: `Il demone Signal ha risposto ${risposta.status} a ${base.host}: ${await motivoDellaRisposta(risposta)}.` };
    }
    about = await risposta.json().catch(() => null);
  } catch (err) {
    const causa = err instanceof Error && err.name === 'AbortError' ? `nessuna risposta entro ${TIMEOUT_MS / 1000} secondi` : (err instanceof Error ? err.message : 'errore di rete');
    return { ok: false, messaggio: `Demone Signal non raggiungibile su ${base.host}: ${causa}.` };
  }

  const versione = typeof about?.version === 'string' ? about.version : null;
  const modalita = typeof about?.mode === 'string' ? about.mode : null;
  const descrizione = [versione ? `versione ${versione}` : null, modalita ? `modalità ${modalita}` : null]
    .filter(Boolean)
    .join(', ');

  if (!cred.signalNumber) {
    return {
      ok: false,
      messaggio: `Demone Signal raggiungibile su ${base.host}${descrizione ? ` (${descrizione})` : ''}, ` +
        `ma manca il numero Signal dello studio: senza mittente non si può spedire.`,
    };
  }

  const numero = numeroSignal(cred.signalNumber);
  if (!numero) {
    return { ok: false, messaggio: `Il numero Signal indicato non è in forma internazionale: serve il prefisso, per esempio +393351234567.` };
  }

  try {
    const risposta = await conTimeout(`${base.url}/v1/accounts`, { headers: intestazioni(cred) });
    if (!risposta.ok) {
      return { ok: true, messaggio: `Demone raggiungibile su ${base.host}${descrizione ? ` (${descrizione})` : ''}. ` +
        `Non è stato possibile leggere i numeri registrati (HTTP ${risposta.status}), quindi la registrazione di ${numero} non è verificata: la prima prova d'invio lo dirà.` };
    }
    const accounts = await risposta.json().catch(() => null);
    const registrati = Array.isArray(accounts) ? accounts.map((a: any) => numeroSignal(a?.number)).filter(Boolean) : [];
    if (registrati.length > 0 && !registrati.includes(numero)) {
      return { ok: false, messaggio: `Il demone risponde su ${base.host}${descrizione ? ` (${descrizione})` : ''}, ma il numero ${numero} non è fra quelli registrati ` +
        `(${registrati.join(', ')}): gli invii verrebbero rifiutati.` };
    }
    return {
      ok: true,
      messaggio: `Demone Signal raggiungibile su ${base.host}${descrizione ? ` (${descrizione})` : ''}, numero ${numero} registrato. ` +
        `La ricezione dei messaggi dai clienti dipende dal polling del demone, non da un webhook: non c'è nessun indirizzo da registrare presso Signal.`,
    };
  } catch {
    return { ok: true, messaggio: `Demone raggiungibile su ${base.host}${descrizione ? ` (${descrizione})` : ''}. ` +
      `La registrazione di ${numero} non è stata verificata.` };
  }
}

/**
 * Le due cose che devono esserci perché si possa spedire, controllate una per una.
 *
 * Una guardia sola con un messaggio unico («Signal non è configurato») era comoda e inutile:
 * l'operatore legge «non configurato» anche quando ha compilato tutto, e il campo da correggere
 * — l'indirizzo o il numero — resta da indovinare. `signalConfigurato` resta per la domanda
 * secca «il canale è acceso?» che serve a `canaliDisponibili`; qui serve il *motivo*.
 */
function motiviDiIndisponibilita(cred: CredenzialiSignal): string | null {
  if (!cred.signalEndpoint) {
    return 'Signal non è configurato: manca l\'indirizzo del demone Signal dello studio (Impostazioni → Canali).';
  }
  if (!String(cred.signalNumber ?? '').trim()) {
    return 'Manca il numero Signal dello studio: è il mittente, e senza non si può spedire (Impostazioni → Canali).';
  }
  return null;
}

/**
 * Invia un messaggio di testo.
 *
 * Non esiste la finestra di 24 ore di WhatsApp né l'obbligo di template di Telegram: Signal
 * recapita il testo così com'è. È il canale più semplice dei tre, e l'unico la cui affidabilità
 * dipende interamente da un servizio che lo studio ospita.
 */
export async function inviaSignal(
  cred: CredenzialiSignal,
  destinatario: string,
  testo: string,
): Promise<EsitoSignal> {
  const manca = motiviDiIndisponibilita(cred);
  if (manca) return { ok: false, errore: manca };

  const numero = numeroSignal(cred.signalNumber);
  if (!numero) {
    return { ok: false, errore: 'Il numero Signal dello studio non è in forma internazionale: serve il prefisso, per esempio +393351234567.' };
  }
  const a = numeroSignal(destinatario);
  if (!a) {
    return { ok: false, errore: 'Il recapito Signal del destinatario non è utilizzabile: serve il numero in forma internazionale, con il prefisso.' };
  }
  if (!testo.trim()) return { ok: false, errore: 'Nessun testo da spedire.' };

  const preparato = await prepara(cred);
  if (!preparato.ok) return { ok: false, errore: preparato.errore };
  const { base } = preparato;

  try {
    const risposta = await conTimeout(`${base.url}/v2/send`, {
      method: 'POST',
      headers: intestazioni(cred),
      body: JSON.stringify({ message: testo, number: numero, recipients: [a] }),
    });
    if (risposta.ok) return { ok: true };
    return { ok: false, errore: `Il demone Signal ha rifiutato l'invio — ${await motivoDellaRisposta(risposta)}.` };
  } catch (err) {
    const causa = err instanceof Error && err.name === 'AbortError'
      ? `nessuna risposta entro ${TIMEOUT_MS / 1000} secondi`
      : (err instanceof Error ? err.message : 'errore di rete');
    return { ok: false, errore: `Demone Signal non raggiungibile su ${base.host}: ${causa}.` };
  }
}

/** Un allegato per Signal, nella forma che accetta il demone. */
export interface AllegatoSignal {
  /** Nome del file, con estensione: il demone lo usa per il tipo MIME. */
  nome: string;
  /** Contenuto in base64, senza prefisso `data:`. */
  base64: string;
}

/**
 * Invia un messaggio con allegati.
 *
 * `base64_attachments` accetta tre forme: base64 nudo, `data:<mime>;base64,<dati>` e
 * `data:<mime>;filename=<nome>;base64,<dati>`. Si usa la terza, perché senza `filename` il
 * cliente riceve un file senza nome — e un documento contrattuale senza nome non si archivia.
 */
export async function inviaSignalConAllegati(
  cred: CredenzialiSignal,
  destinatario: string,
  testo: string,
  allegati: AllegatoSignal[],
): Promise<EsitoSignal> {
  if (allegati.length === 0) return inviaSignal(cred, destinatario, testo);
  const manca = motiviDiIndisponibilita(cred);
  if (manca) return { ok: false, errore: manca };

  const numero = numeroSignal(cred.signalNumber);
  const a = numeroSignal(destinatario);
  if (!numero) {
    return { ok: false, errore: 'Il numero Signal dello studio non è in forma internazionale: serve il prefisso, per esempio +393351234567.' };
  }
  if (!a) {
    return { ok: false, errore: 'Il recapito Signal del destinatario non è utilizzabile: serve il numero in forma internazionale, con il prefisso.' };
  }

  const preparato = await prepara(cred);
  if (!preparato.ok) return { ok: false, errore: preparato.errore };
  const { base } = preparato;

  const corpi = allegati.map(allegato => {
    const nome = allegato.nome.replace(/[^\w.\-]/g, '_');
    const mime = /\.pdf$/i.test(nome) ? 'application/pdf'
      : /\.(png)$/i.test(nome) ? 'image/png'
      : /\.(jpe?g)$/i.test(nome) ? 'image/jpeg'
      : 'application/octet-stream';
    return `data:${mime};filename=${nome};base64,${allegato.base64}`;
  });

  try {
    const risposta = await conTimeout(`${base.url}/v2/send`, {
      method: 'POST',
      headers: intestazioni(cred),
      body: JSON.stringify({
        message: testo,
        number: numero,
        recipients: [a],
        base64_attachments: corpi,
      }),
    });
    if (risposta.ok) return { ok: true };
    return { ok: false, errore: `Il demone Signal ha rifiutato l'invio con allegati — ${await motivoDellaRisposta(risposta)}.` };
  } catch (err) {
    const causa = err instanceof Error && err.name === 'AbortError'
      ? `nessuna risposta entro ${TIMEOUT_MS / 1000} secondi`
      : (err instanceof Error ? err.message : 'errore di rete');
    return { ok: false, errore: `Demone Signal non raggiungibile su ${base.host}: ${causa}.` };
  }
}

/** Un messaggio in arrivo dal demone, già normalizzato. */
export interface MessaggioSignalRicevuto {
  /** Identificativo stabile per l'idempotenza: mittente + istante del messaggio. */
  eventId: string;
  /** Numero del mittente in cifre, senza `+`: la stessa forma di `normalizzaTelefono`. */
  mittente: string | null;
  nomeMittente: string | null;
  testo: string;
  timestamp: number;
  allegati: Array<{ id: string; nome: string; mime: string; dimensione: number }>;
}

/**
 * Legge la coda dei messaggi in arrivo dal demone.
 *
 * `GET /v1/receive/{number}` è una **lettura distruttiva**: i messaggi che restituisce escono
 * dalla coda del demone. Chi chiama deve quindi persisterli subito dopo, e l'idempotenza (che
 * vive in `signalInbound.ts`, sulla tabella `webhook_inbox`) protegge dalle riletture, non dalla
 * perdita: fra il prelievo e la scrittura a database un guasto perde quel messaggio, e il demone
 * non lo rimanda. È il motivo per cui questa non è la strada preferita del progetto — gli altri
 * canali ricevono per webhook, dove il provider ritenta finché non riceve un 200 — ed è scritto
 * qui perché nessuno lo scopra leggendo questo codice come se fosse affidabile quanto gli altri.
 *
 * Si scartano le proprie copie: un `dataMessage` il cui mittente è il numero dello studio è un
 * messaggio *in uscita* sincronizzato dall'altro dispositivo collegato, non un messaggio di un
 * cliente, e registrarlo come entrata metterebbe le parole dello studio in bocca al cliente.
 */
export async function riceviSignal(
  cred: CredenzialiSignal,
): Promise<{ ok: true; messaggi: MessaggioSignalRicevuto[] } | { ok: false; errore: string }> {
  const manca = motiviDiIndisponibilita(cred);
  if (manca) return { ok: false, errore: `${manca} Senza queste due cose non c'è nessuna coda da leggere.` };

  const numero = numeroSignal(cred.signalNumber);
  if (!numero) {
    return { ok: false, errore: 'Il numero Signal dello studio non è in forma internazionale: serve il prefisso, per esempio +393351234567.' };
  }

  const preparato = await prepara(cred);
  if (!preparato.ok) return { ok: false, errore: preparato.errore };
  const { base } = preparato;

  let grezzo: unknown;
  try {
    const risposta = await conTimeout(`${base.url}/v1/receive/${encodeURIComponent(numero)}`, {
      headers: intestazioni(cred),
    });
    if (!risposta.ok) {
      return { ok: false, errore: `Il demone Signal ha risposto ${risposta.status} alla lettura dei messaggi: ${await motivoDellaRisposta(risposta)}.` };
    }
    grezzo = await risposta.json().catch(() => null);
  } catch (err) {
    const causa = err instanceof Error && err.name === 'AbortError'
      ? `nessuna risposta entro ${TIMEOUT_MS / 1000} secondi`
      : (err instanceof Error ? err.message : 'errore di rete');
    return { ok: false, errore: `Demone Signal non raggiungibile su ${base.host}: ${causa}.` };
  }

  // Il demone risponde con un array di buste. Qualunque altra forma è un demone che non
  // riconosciamo: si riporta com'è invece di indovinare la struttura.
  if (!Array.isArray(grezzo)) {
    return { ok: false, errore: `Il demone Signal ha risposto in una forma non riconosciuta su ${base.host}: attesa una lista di messaggi.` };
  }

  const mio = numero.slice(1);
  const messaggi: MessaggioSignalRicevuto[] = [];

  for (const voce of grezzo as any[]) {
    const busta = voce?.envelope;
    const dati = busta?.dataMessage;
    const testo = typeof dati?.message === 'string' ? dati.message : '';
    if (!testo.trim()) continue; // ricevute, tue spunte di lettura, chiamate: non sono messaggi

    const cifreMittente = String(busta?.sourceNumber || busta?.source || '').replace(/\D/g, '');
    if (!cifreMittente || cifreMittente === mio) continue;

    const istante = Number(dati?.timestamp ?? busta?.timestamp) || 0;
    const allegati = Array.isArray(dati?.attachments)
      ? dati.attachments
          .map((a: any) => ({
            id: typeof a?.id === 'string' ? a.id : '',
            nome: typeof a?.filename === 'string' && a.filename.trim() ? a.filename.trim() : `allegato_${String(a?.id || '').slice(-8)}`,
            mime: typeof a?.contentType === 'string' ? a.contentType : 'application/octet-stream',
            dimensione: Number(a?.size) || 0,
          }))
          .filter((a: any) => a.id)
      : [];

    messaggi.push({
      // Il mittente da solo non basta: due messaggi dello stesso cliente hanno lo stesso
      // mittente e timestamp diversi, ed è il timestamp a distinguerli.
      eventId: `${cifreMittente}:${istante}`,
      mittente: cifreMittente,
      nomeMittente: typeof busta?.sourceName === 'string' && busta.sourceName.trim() ? busta.sourceName.trim() : null,
      testo,
      timestamp: istante,
      allegati,
    });
  }

  return { ok: true, messaggi };
}

/**
 * Scarica un allegato dal demone.
 *
 * `GET /v1/attachments/{id}` restituisce il binario. Restituisce `null` se il download fallisce:
 * il chiamante registra il messaggio con il nome del file, senza che il guasto blocchi
 * l'ingestione — come fa il percorso WhatsApp per i suoi media.
 */
export async function scaricaAllegatoSignal(
  cred: CredenzialiSignal,
  id: string,
): Promise<{ base64: string; mime: string } | null> {
  const preparato = await prepara(cred);
  if (!preparato.ok) return null;
  try {
    const risposta = await conTimeout(`${preparato.base.url}/v1/attachments/${encodeURIComponent(id)}`, {
      headers: intestazioni(cred),
    });
    if (!risposta.ok) return null;
    // Lo stesso tetto del percorso WhatsApp: oltre, il documento non entra nel Vault.
    const MAX_BYTES = 15 * 1024 * 1024;
    const dichiarata = Number(risposta.headers.get('content-length') || 0);
    if (dichiarata > MAX_BYTES) return null;
    const buffer = Buffer.from(await risposta.arrayBuffer());
    if (buffer.byteLength > MAX_BYTES) return null;
    return {
      base64: buffer.toString('base64'),
      mime: risposta.headers.get('content-type')?.split(';')[0] || 'application/octet-stream',
    };
  } catch {
    return null;
  }
}
