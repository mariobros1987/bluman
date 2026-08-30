/**
 * Lettura della posta in arrivo dalla casella dello studio (IMAP), dal backend.
 *
 * Prima la faceva il browser: `fetchInboundImapEmailsApi` leggeva host, utenza e **password
 * IMAP** da `localStorage` e le spediva a `POST /api/send-email` con
 * `action: 'fetch-imap-inbound'`. Tre problemi, tutti reali: la password della casella viveva
 * nello spazio di archiviazione del browser di ogni operatore (regola 6), la funzione
 * serverless è pubblica e accettava quelle credenziali da chiunque, e su un browser dove
 * `localStorage` era vuoto — un altro computer, una sessione nuova — la lettura partiva senza
 * password e tornava una lista vuota senza dire perché.
 *
 * Ora le credenziali si leggono dalla riga Tenant e non lasciano mai il server. La strada di
 * rete è la stessa della posta in uscita e per lo stesso motivo misurato (`emailRelay.ts`): la
 * rete in uscita di Railway non lascia passare le porte di posta, quindi in produzione la
 * lettura viene affidata alla funzione serverless, che gira su un'altra rete; l'IMAP diretto
 * resta il ripiego, ed è la strada normale in sviluppo.
 */
import tls from 'tls';
import { tlsRejectUnauthorized } from './emailRelay.js';
import { spiegaErrorePosta } from './diagnosiPosta.js';

export interface CredenzialiImap {
  host?: string;
  port?: number;
  user?: string;
  pass?: string;
  folder?: string;
}

export interface EmailInArrivo {
  id: string;
  from: string;
  subject: string;
  date: string;
  text: string;
}

export interface EsitoPostaInArrivo {
  ok: boolean;
  email: EmailInArrivo[];
  /** Da dove è arrivata: `relay <url>` o `host:porta`. */
  via?: string;
  errore?: string;
}

/**
 * Indirizzo della funzione che legge al posto nostro. Stessa risoluzione di `emailRelay`, e
 * volutamente non condivisa a metà: qui il ripiego di produzione non c'è, perché una lettura
 * che non parte è un elenco vuoto — non un cliente che resta senza codice di firma.
 */
function urlRelay(): string | null {
  const esplicito = process.env.EMAIL_RELAY_URL?.trim();
  if (esplicito) return esplicito;
  const base = process.env.APP_BASE_URL?.trim().replace(/\/+$/, '');
  if (base) return `${base}/api/send-email`;
  if (process.env.NODE_ENV === 'production') return 'https://bluman.vercel.app/api/send-email';
  return null;
}

/** Filtro sul mittente: serve a mostrare nel fascicolo solo le risposte di quel cliente. */
function soloDi(email: EmailInArrivo[], indirizzo?: string): EmailInArrivo[] {
  const cercato = (indirizzo || '').toLowerCase().trim();
  if (!cercato) return email;
  return email.filter(e => {
    const mittente = (e.from || '').toLowerCase();
    return mittente.includes(cercato) || cercato.includes(mittente);
  });
}

async function leggiViaRelay(imap: CredenzialiImap, clientEmail?: string): Promise<EsitoPostaInArrivo> {
  const url = urlRelay();
  if (!url) return { ok: false, email: [], errore: 'nessun relay configurato (EMAIL_RELAY_URL o APP_BASE_URL assenti)' };

  // La password della casella viaggia nel corpo: accettabile solo su TLS, come per l'invio.
  if (!url.startsWith('https://')) {
    return { ok: false, email: [], errore: `relay rifiutato: ${url} non è HTTPS e trasporterebbe la password in chiaro` };
  }

  const controller = new AbortController();
  const scadenza = setTimeout(() => controller.abort(), 20000);
  try {
    const risposta = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(process.env.EMAIL_RELAY_SECRET ? { 'x-bluman-relay': process.env.EMAIL_RELAY_SECRET } : {}),
      },
      signal: controller.signal,
      body: JSON.stringify({
        action: 'fetch-imap-inbound',
        imapHost: imap.host,
        imapPort: imap.port,
        imapUser: imap.user,
        imapPass: imap.pass,
        imapFolder: imap.folder || 'INBOX',
        clientEmail: clientEmail || '',
      }),
    });

    const dettaglio: any = await risposta.json().catch(() => null);
    if (!risposta.ok || dettaglio?.success === false) {
      return { ok: false, email: [], errore: `relay: ${dettaglio?.errore || dettaglio?.error || `HTTP ${risposta.status}`}` };
    }
    const lista: EmailInArrivo[] = Array.isArray(dettaglio?.emails) ? dettaglio.emails : [];
    return { ok: true, email: lista, via: `relay ${url}` };
  } catch (err: any) {
    const motivo = err?.name === 'AbortError' ? 'nessuna risposta entro 20 secondi' : err?.message || 'errore di rete';
    return { ok: false, email: [], errore: `relay: ${motivo}` };
  } finally {
    clearTimeout(scadenza);
  }
}

/** Ripulisce il corpo grezzo: MIME multipart, quoted-printable e storico delle risposte. */
export function ripulisciCorpoEmail(grezzo: string): string {
  if (!grezzo) return '';
  let testo = grezzo;

  if (/Content-Type:\s*text\/plain/i.test(testo)) {
    const sezione = testo.split(/Content-Type:\s*text\/plain[^\r\n]*/i)[1];
    if (sezione) {
      testo = (sezione.split(/\r?\n--/)[0] || '').replace(/^[\s\S]*?\r?\n\r?\n/, '');
    }
  } else if (/Content-Type:\s*text\/html/i.test(testo)) {
    const sezione = testo.split(/Content-Type:\s*text\/html[^\r\n]*/i)[1];
    if (sezione) {
      const corpo = (sezione.split(/\r?\n--/)[0] || '').replace(/^[\s\S]*?\r?\n\r?\n/, '');
      testo = corpo.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ');
    }
  }

  // Quoted-printable: le lettere accentate italiane arrivano così, e senza questa parte il
  // messaggio del cliente si legge «pi=C3=B9 tempo».
  testo = testo
    .replace(/=\r?\n/g, '')
    .replace(/=([0-9A-F]{2})/gi, (_, hex) => {
      const codice = parseInt(hex, 16);
      return codice >= 0x20 && codice !== 0x3d ? String.fromCharCode(codice) : `=${hex}`;
    });
  try {
    // I caratteri multibyte (à, è, —) arrivano come sequenze UTF-8 byte per byte.
    testo = Buffer.from(testo, 'latin1').toString('utf8');
  } catch {
    // Corpo non decodificabile: resta quello che c'è, senza far fallire la lettura.
  }

  testo = testo
    .replace(/--[a-zA-Z0-9_-]{10,}/g, '')
    .replace(/Content-Transfer-Encoding:[^\r\n]*/gi, '')
    .replace(/Content-Type:[^\r\n]*/gi, '');

  const righe: string[] = [];
  for (const riga of testo.split(/\r?\n/)) {
    const pulita = riga.trim();
    if (pulita.startsWith('>') || pulita.startsWith('&gt;')) continue;
    if (/^Il giorno .+ ha scritto:?$/i.test(pulita)) break;
    if (/^On .+ wrote:?$/i.test(pulita)) break;
    if (/^In data .+ ha scritto:?$/i.test(pulita)) break;
    if (pulita.includes('--- Messaggio Originale ---')) break;
    if (pulita.includes('________________________________')) break;
    righe.push(riga);
  }

  return righe.join('\n').trim();
}

/**
 * IMAP diretto, parlato a mano sul socket TLS.
 *
 * Il protocollo qui usato è il minimo per leggere gli ultimi messaggi: LOGIN, SELECT, SEARCH,
 * FETCH dei soli header utili e del testo. A differenza della versione nella funzione
 * serverless, il certificato del server viene verificato (`tlsRejectUnauthorized`): la
 * password della casella non va consegnata a chiunque sappia intercettare la connessione.
 */
function leggiViaImap(imap: CredenzialiImap, limite: number): Promise<EsitoPostaInArrivo> {
  return new Promise(resolve => {
    // Nessun ripiego su `imap.register.it`: con quel nome cablato uno studio che non ha
    // configurato la casella si collegava — o tentava di collegarsi — al server di un
    // provider che non è il suo, e l'errore che leggeva riguardava quel server.
    const host = imap.host || '';
    const porta = imap.port || 993;
    const cartella = imap.folder || 'INBOX';
    const utente = imap.user || '';
    const password = imap.pass || '';
    const timeoutMs = 12000;

    const email: EmailInArrivo[] = [];
    let passo = 0;
    let buffer = '';
    let concluso = false;

    const socket = tls.connect({ host, port: porta, rejectUnauthorized: tlsRejectUnauthorized() });

    const chiudi = (esito: EsitoPostaInArrivo) => {
      if (concluso) return;
      concluso = true;
      try {
        socket.end();
        socket.destroy();
      } catch {
        // socket già chiuso
      }
      resolve(esito);
    };

    socket.setTimeout(timeoutMs, () =>
      chiudi({
        ok: false,
        email,
        errore: spiegaErrorePosta({
          protocollo: 'IMAP',
          host,
          porta,
          messaggio: `ETIMEDOUT: nessuna risposta da ${host}:${porta} entro ${timeoutMs / 1000} secondi`,
        }),
      }),
    );
    socket.on('error', err =>
      chiudi({
        ok: false,
        email,
        errore: spiegaErrorePosta({
          protocollo: 'IMAP',
          host,
          porta,
          messaggio: `${(err as any)?.code ? `${(err as any).code}: ` : ''}${err.message}`,
        }),
      }),
    );

    socket.on('data', dati => {
      buffer += dati.toString('latin1');

      if (passo === 0 && buffer.includes('* OK')) {
        passo = 1;
        buffer = '';
        // Le virgolette nell'utenza o nella password romperebbero il comando: IMAP le vuole
        // protette con la barra rovesciata.
        const esc = (v: string) => v.replace(/([\\"])/g, '\\$1');
        socket.write(`A1 LOGIN "${esc(utente)}" "${esc(password)}"\r\n`);
        return;
      }

      if (passo === 1) {
        if (buffer.includes('A1 OK')) {
          passo = 2;
          buffer = '';
          socket.write(`A2 SELECT "${cartella}"\r\n`);
          return;
        }
        if (buffer.includes('A1 NO') || buffer.includes('A1 BAD')) {
          return chiudi({ ok: false, email, errore: `${host} ha rifiutato le credenziali della casella (utenza o password IMAP errate)` });
        }
      }

      if (passo === 2 && buffer.includes('A2 OK')) {
        passo = 3;
        buffer = '';
        socket.write('A3 SEARCH ALL\r\n');
        return;
      }

      if (passo === 3 && buffer.includes('A3 OK')) {
        const trovati = buffer.match(/\* SEARCH ([\d\s]+)/);
        buffer = '';
        const identificativi = trovati?.[1]?.trim().split(/\s+/).filter(Boolean).slice(-limite) ?? [];
        if (identificativi.length === 0) {
          socket.write('A9 LOGOUT\r\n');
          return chiudi({ ok: true, email, via: `${host}:${porta}` });
        }
        passo = 4;
        socket.write(`A4 FETCH ${identificativi.join(',')} (BODY[HEADER.FIELDS (FROM SUBJECT DATE)] BODY[TEXT])\r\n`);
        return;
      }

      if (passo === 4 && (buffer.includes('A4 OK') || buffer.includes('A9 OK'))) {
        for (const pezzo of buffer.split(/\* \d+ FETCH/)) {
          if (!pezzo.trim()) continue;
          const mittente = pezzo.match(/From:\s*([^\r\n]+)/i)?.[1]?.trim();
          if (!mittente) continue;
          const oggetto = pezzo.match(/Subject:\s*([^\r\n]+)/i)?.[1]?.trim() || 'Nessun oggetto';
          const dataGrezza = pezzo.match(/Date:\s*([^\r\n]+)/i)?.[1]?.trim();

          let corpo = '';
          const testo = pezzo.match(/BODY\[TEXT\]\s*\{(\d+)\}\r\n([\s\S]*)/i);
          if (testo?.[2]) {
            corpo = (testo[2].split(/\r\n\)\r\n|\r\n\*\s*\d+\s*FETCH|\r\nA4 OK/)[0] || '').trim();
          }

          email.push({
            id: `imap-${Buffer.from(`${mittente}|${dataGrezza || ''}|${oggetto}`).toString('base64url').slice(0, 32)}`,
            from: mittente,
            subject: oggetto,
            date: dataGrezza ? new Date(dataGrezza).toLocaleString('it-IT') : new Date().toLocaleString('it-IT'),
            text: ripulisciCorpoEmail(corpo) || oggetto,
          });
        }
        socket.write('A9 LOGOUT\r\n');
        return chiudi({ ok: true, email, via: `${host}:${porta}` });
      }
    });
  });
}

/**
 * Gli ultimi messaggi arrivati nella casella dello studio, opzionalmente filtrati per mittente.
 *
 * Senza credenziali risponde `ok: false` con il motivo, non un elenco vuoto: «nessuna risposta
 * dal cliente» e «la casella non è configurata» sono due cose diverse, e il fascicolo mostrava
 * la prima anche quando era vera la seconda.
 */
export async function leggiPostaInArrivo(
  imap: CredenzialiImap,
  opzioni: { clientEmail?: string; limite?: number } = {},
): Promise<EsitoPostaInArrivo> {
  const limite = Math.min(Math.max(opzioni.limite ?? 15, 1), 50);

  if (!imap.host || !imap.user || !imap.pass) {
    const mancanti = [!imap.host && 'il server IMAP', !imap.user && "l'utenza", !imap.pass && 'la password'].filter(Boolean);
    return {
      ok: false,
      email: [],
      errore: `Casella in arrivo non configurata: ${mancanti.join(', ')} nelle impostazioni dello studio ${mancanti.length > 1 ? 'sono vuoti' : 'è vuoto'}.`,
    };
  }

  const motivi: string[] = [];

  if (urlRelay()) {
    const viaRelay = await leggiViaRelay(imap, opzioni.clientEmail);
    if (viaRelay.ok) return { ...viaRelay, email: soloDi(viaRelay.email, opzioni.clientEmail) };
    motivi.push(viaRelay.errore || 'relay non disponibile');
  }

  const diretto = await leggiViaImap(imap, limite);
  if (diretto.ok) return { ...diretto, email: soloDi(diretto.email, opzioni.clientEmail) };
  motivi.push(diretto.errore || 'IMAP diretto non disponibile');

  return { ok: false, email: [], errore: motivi.join('; ') };
}
