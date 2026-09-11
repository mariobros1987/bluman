/**
 * Lettura allegati email via `imapflow` sul backend Railway.
 *
 * Il parser grezzo in `imapInbound.ts` usa un socket TLS artigianale ed è sufficiente per
 * testo semplice, ma non può decodificare allegati MIME Base64 frammentati su più eventi
 * `socket.on('data')` senza rischiare corruzione o timeout. `imapflow` gestisce queste
 * complessità internamente ed è la scelta canonica per chi ha bisogno di scaricare parti
 * MIME complete.
 *
 * Questa funzione è chiamata SOLO dal backend Railway (nessun limite di memoria di Vercel)
 * e non modifica in nessun modo `imapInbound.ts` — i due codici coesistono senza
 * interferenze. Chi ha già la casella funzionante per il testo non vede nessuna regressione.
 *
 * Limiti operativi:
 * - Massimo 5 email analizzate per chiamata (evitare download massicci non richiesti).
 * - Massimo 15 MB per allegato: file più grandi vengono ignorati con un log, non bloccano.
 * - Solo tipi MIME documentali e immagini: nessun eseguibile archiviato.
 * - Gli allegati vengono caricati su Supabase Storage / fallback locale tramite
 *   `uploadDocumento` già esistente.
 */

import { ImapFlow } from 'imapflow';
import { uploadDocumento, mimeDaEstensione } from './storageService.js';
import type { CredenzialiImap } from './imapInbound.js';

export interface AllegatoEmail {
  nome: string;
  url: string;
  dimensione: string;
  mime: string;
}

export interface EmailConAllegati {
  id: string;
  from: string;
  subject: string;
  date: string;
  text: string;
  allegati: AllegatoEmail[];
}

export interface EsitoImapAllegati {
  ok: boolean;
  email: EmailConAllegati[];
  errore?: string;
}

/** MIME consentiti per l'archiviazione. Nessun eseguibile. */
const MIME_CONSENTITI = new Set([
  'application/pdf',
  'application/msword',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/vnd.ms-excel',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'application/pkcs7-mime',
  'application/xml',
  'text/plain',
  'text/csv',
  'image/png',
  'image/jpeg',
  'image/gif',
  'image/webp',
  'application/zip',
  'message/rfc822',
  'application/octet-stream', // fallback generico: l'utente sa cosa carica
]);

const MAX_ALLEGATO_BYTES = 15 * 1024 * 1024; // 15 MB
const MAX_EMAIL = 5;

/**
 * Legge le ultime email IMAP con i loro allegati usando `imapflow`.
 *
 * Non duplica la logica di `leggiPostaInArrivo`: si concentra solo sui messaggi che hanno
 * almeno un allegato e li carica su storage restituendo gli URL firmati. Per il testo
 * semplice continua ad essere usato l'endpoint già funzionante.
 */
export async function leggiAllegatiImap(
  imap: CredenzialiImap,
  opzioni: { clientEmail?: string; limite?: number } = {},
): Promise<EsitoImapAllegati> {
  const limite = Math.min(Math.max(opzioni.limite ?? MAX_EMAIL, 1), MAX_EMAIL);

  if (!imap.host || !imap.user || !imap.pass) {
    const mancanti = [
      !imap.host && 'il server IMAP',
      !imap.user && "l'utenza",
      !imap.pass && 'la password',
    ].filter(Boolean);
    return {
      ok: false,
      email: [],
      errore: `Casella in arrivo non configurata: ${mancanti.join(', ')} ${mancanti.length > 1 ? 'sono vuoti' : 'è vuoto'} nelle impostazioni dello studio.`,
    };
  }

  const client = new ImapFlow({
    host: imap.host,
    port: imap.port || 993,
    secure: true,
    // `servername` per TLS SNI quando l'host non coincide col certificato.
    ...(imap.servername ? { servername: imap.servername } : {}),
    auth: {
      user: imap.user,
      pass: imap.pass,
    },
    logger: false, // evita spam in produzione
    connectionTimeout: 15000,
    greetingTimeout: 10000,
    socketTimeout: 20000,
    tls: {
      rejectUnauthorized: process.env.NODE_ENV !== 'test',
    },
  });

  const risultato: EmailConAllegati[] = [];

  try {
    await client.connect();

    const mailbox = await client.mailboxOpen(imap.folder || 'INBOX');
    if (mailbox.exists === 0) {
      await client.logout();
      return { ok: true, email: [] };
    }

    // Cerca l'ultimo `limite` messaggi con almeno un allegato (MIME type ≠ text/plain e ≠ text/html).
    const cerca = opzioni.clientEmail
      ? await client.search({ from: opzioni.clientEmail })
      : await client.search({ all: true });

    const uid_list = (Array.isArray(cerca) ? cerca : []).slice(-limite * 3); // un po' di margine per filtrare poi

    for (const uid of uid_list.reverse()) {
      if (risultato.length >= limite) break;

      const msg = await client.fetchOne(
        `${uid}`,
        { envelope: true, bodyStructure: true },
        { uid: false },
      );
      if (!msg) continue;

      const envelope = msg.envelope;
      const struttura: any = msg.bodyStructure;

      // Controlla se ci sono parti MIME che non siano text/plain o text/html → allegati
      const parti = Array.isArray(struttura?.childNodes) ? struttura.childNodes : [];
      const allegatiStruttura = parti.filter((p: any) => {
        const ct = `${p.type}/${p.subtype}`.toLowerCase();
        return ct !== 'text/plain' && ct !== 'text/html';
      });

      if (allegatiStruttura.length === 0) continue;

      const from = envelope?.from?.[0];
      const mittenteStr = from?.address
        ? `${from.name ? `${from.name} ` : ''}<${from.address}>`
        : 'Mittente sconosciuto';

      const allegatiCaricati: AllegatoEmail[] = [];

      for (let i = 0; i < allegatiStruttura.length; i++) {
        const parte = allegatiStruttura[i];
        const ct = `${parte.type}/${parte.subtype}`.toLowerCase();
        const nomefile = parte.dispositionParameters?.filename
          || parte.parameters?.name
          || `allegato_${Date.now()}_${i}`;

        // Controllo MIME: ignora silenziosamente i tipi non consentiti
        const mimeEffettivo = MIME_CONSENTITI.has(ct)
          ? ct
          : mimeDaEstensione(nomefile);
        if (!MIME_CONSENTITI.has(mimeEffettivo)) {
          console.warn(`[IMAP Allegati] Tipo MIME ${ct} non consentito per ${nomefile}: ignorato.`);
          continue;
        }

        // Scarica il contenuto binario della parte
        const chunks: Buffer[] = [];
        let totalBytes = 0;
        let troppoDifficile = false;

        try {
          const downloadRes = await client.download(`${uid}` as any, `${parte.part}` as any);
          if (downloadRes && downloadRes.content) {
            for await (const chunk of downloadRes.content) {
              chunks.push(chunk as Buffer);
              totalBytes += (chunk as Buffer).length;
              if (totalBytes > MAX_ALLEGATO_BYTES) {
                console.warn(`[IMAP Allegati] ${nomefile} supera 15 MB: ignorato.`);
                troppoDifficile = true;
                break;
              }
            }
          }
        } catch (dlErr) {
          console.warn(`[IMAP Allegati] Errore scaricamento parte ${parte.part} per ${nomefile}:`, dlErr);
          continue;
        }

        if (troppoDifficile) continue;

        const buffer = Buffer.concat(chunks);
        const base64 = `data:${mimeEffettivo};base64,${buffer.toString('base64')}`;

        const esitoUpload = await uploadDocumento(nomefile, base64);
        if (!esitoUpload.ok) {
          console.warn(`[IMAP Allegati] Upload fallito per ${nomefile}: ${esitoUpload.url}`);
          continue;
        }

        allegatiCaricati.push({
          nome: nomefile,
          url: esitoUpload.url,
          dimensione: esitoUpload.size,
          mime: mimeEffettivo,
        });
      }

      if (allegatiCaricati.length === 0) continue;

      risultato.push({
        id: `imap-att-${uid}-${Date.now()}`,
        from: mittenteStr,
        subject: envelope?.subject || '(senza oggetto)',
        date: envelope?.date
          ? new Date(envelope.date).toLocaleString('it-IT')
          : new Date().toLocaleString('it-IT'),
        text: `[${allegatiCaricati.length} allegato/i]`,
        allegati: allegatiCaricati,
      });
    }

    await client.logout();
    return { ok: true, email: risultato };
  } catch (err) {
    // Assicura la chiusura del client anche in caso di errore
    try {
      await client.logout();
    } catch {
      // già disconnesso
    }
    const messaggio = err instanceof Error ? err.message : 'Errore IMAP sconosciuto';
    return {
      ok: false,
      email: [],
      errore: `Connessione IMAP (imapflow) non riuscita: ${messaggio}`,
    };
  }
}
