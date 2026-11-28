/**
 * Accentratore delle mail — la lettura di una casella IMAP (`imapflow`), dietro un'interfaccia.
 *
 * `LettoreCasella` è tutto ciò che la raccolta (`postaRaccolta.ts`) sa di IMAP: così il giro si
 * prova con un lettore finto, senza rete. Qui dentro restano tre regole che contano:
 *
 * - la casella si apre in **sola lettura** e non si scrive mai nessun flag: può essere la casella
 *   vera di un cliente, e per lui i messaggi devono restare «da leggere» finché non li apre lui;
 * - il certificato del server si verifica sempre (§3.4), e l'host passa dalla stessa politica di
 *   rete delle altre connessioni di posta (`risolviEndpointPubblico`: niente indirizzi interni);
 * - una connessione per giro, chiusa alla fine: tenerla aperta fra un giro e l'altro consuma le
 *   connessioni contemporanee che il fornitore concede alla casella.
 */
import { ImapFlow } from 'imapflow';
import { tlsRejectUnauthorized } from './emailRelay.js';
import { risolviEndpointPubblico, validaCartellaImap, validaPorta, vietaControlli } from '../util/networkPolicy.js';
import type { IntestazioniConsegna } from './postaAttribuzione.js';

export interface AccessoCasella {
  host: string;
  servername?: string | null;
  porta: number;
  utente: string;
  password: string;
  cartella: string;
}

export interface AllegatoGrezzo {
  /** Il numero della parte MIME, da passare a `scaricaAllegato`. */
  parte: string;
  nome: string;
  mime: string;
  dimensioneByte: number | null;
}

export interface MessaggioGrezzo {
  uid: number;
  messageId: string | null;
  mittenteEmail: string;
  mittenteNome: string | null;
  destinatari: string | null;
  oggetto: string | null;
  data: Date | null;
  intestazioni: IntestazioniConsegna;
  testo: string | null;
  html: string | null;
  allegati: AllegatoGrezzo[];
}

export interface LettoreCasella {
  apri(): Promise<{ uidValidity: string; uidNext: number }>;
  /** Gli UID più grandi di `ultimoUid`, in ordine crescente. */
  uidDopo(ultimoUid: number): Promise<number[]>;
  /** Gli UID dei messaggi arrivati da `giorno` in poi, in ordine crescente. */
  uidDal(giorno: Date): Promise<number[]>;
  leggi(uid: number): Promise<MessaggioGrezzo | null>;
  /** Il contenuto di un allegato, oppure `null` se supera `maxByte`. */
  scaricaAllegato(uid: number, parte: string, maxByte: number): Promise<Buffer | null>;
  chiudi(): Promise<void>;
}

const MAX_TESTO_BYTE = 512 * 1024;

/** Le intestazioni grezze («Nome: valore», con le righe di continuazione) in una mappa minuscola. */
export function leggiIntestazioni(grezze: Buffer | string | null | undefined): Map<string, string> {
  const mappa = new Map<string, string>();
  if (!grezze) return mappa;
  const righe = grezze.toString('utf8').replace(/\r?\n[ \t]+/g, ' ').split(/\r?\n/);
  for (const riga of righe) {
    const due = riga.indexOf(':');
    if (due <= 0) continue;
    const nome = riga.slice(0, due).trim().toLowerCase();
    const valore = riga.slice(due + 1).trim();
    if (!valore) continue;
    // La stessa intestazione può ripetersi (un `Delivered-To` per ogni passaggio): si tengono tutte.
    mappa.set(nome, mappa.has(nome) ? `${mappa.get(nome)}, ${valore}` : valore);
  }
  return mappa;
}

/** Un testo leggibile da un corpo solo HTML: serve per l'anteprima e la ricerca, non per mostrarlo. */
export function testoDaHtml(html: string): string {
  return html
    .replace(/<(style|script|head)[\s\S]*?<\/\1>/gi, ' ')
    .replace(/<br\s*\/?>|<\/(p|div|tr|li|h[1-6])>/gi, '\n')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/[ \t]+/g, ' ')
    .replace(/ ?\n ?/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

interface PartiMessaggio {
  testo: string | null;
  html: string | null;
  allegati: AllegatoGrezzo[];
}

/**
 * Dalla struttura MIME: la parte di testo, quella HTML e gli allegati.
 *
 * Allegato è ciò che ha un nome di file o è dichiarato `attachment`. Le immagini incorporate nel
 * corpo (`inline` con un Content-ID: loghi, firme) non lo sono: salvarle riempirebbe l'archivio
 * di loghi a ogni messaggio.
 */
export function partiDellaStruttura(struttura: any): PartiMessaggio {
  const parti: PartiMessaggio = { testo: null, html: null, allegati: [] };
  const visita = (nodo: any) => {
    if (!nodo) return;
    const tipo = String(nodo.type || '').toLowerCase();
    if (Array.isArray(nodo.childNodes) && nodo.childNodes.length) {
      for (const figlio of nodo.childNodes) visita(figlio);
      return;
    }
    const parte = String(nodo.part || '1');
    const disposizione = String(nodo.disposition || '').toLowerCase();
    const nome = nodo.dispositionParameters?.filename || nodo.parameters?.name || null;
    const eAllegato = disposizione === 'attachment' || (Boolean(nome) && !(disposizione === 'inline' && nodo.id && tipo.startsWith('image/')));
    if (eAllegato) {
      parti.allegati.push({
        parte,
        nome: String(nome || `allegato-${parte}`),
        mime: tipo || 'application/octet-stream',
        dimensioneByte: typeof nodo.size === 'number' ? nodo.size : null,
      });
      return;
    }
    if (disposizione === 'inline' && nodo.id) return;
    if (tipo === 'text/plain' && !parti.testo) parti.testo = parte;
    else if (tipo === 'text/html' && !parti.html) parti.html = parte;
  };
  visita(struttura);
  return parti;
}

function elencoIndirizzi(lista: Array<{ name?: string; address?: string }> | undefined): string | null {
  const indirizzi = (lista ?? []).map((i) => i.address).filter(Boolean);
  return indirizzi.length ? indirizzi.join(', ') : null;
}

async function inBuffer(flusso: AsyncIterable<Buffer | string>, maxByte: number): Promise<Buffer | null> {
  const pezzi: Buffer[] = [];
  let totale = 0;
  for await (const pezzo of flusso) {
    const buffer = typeof pezzo === 'string' ? Buffer.from(pezzo) : pezzo;
    totale += buffer.length;
    if (totale > maxByte) return null;
    pezzi.push(buffer);
  }
  return Buffer.concat(pezzi);
}

/** Il lettore vero. Non apre nessuna connessione finché non si chiama `apri()`. */
export function lettoreImap(accesso: AccessoCasella): LettoreCasella {
  let client: ImapFlow | null = null;

  const connesso = (): ImapFlow => {
    if (!client) throw new Error('Casella non aperta.');
    return client;
  };

  const scarica = async (uid: number, parte: string, maxByte: number): Promise<Buffer | null> => {
    const scaricato = await connesso().download(String(uid), parte, { uid: true });
    if (!scaricato?.content) return Buffer.alloc(0);
    const buffer = await inBuffer(scaricato.content as AsyncIterable<Buffer>, maxByte);
    if (buffer === null) scaricato.content.destroy();
    return buffer;
  };

  return {
    async apri() {
      const endpoint = await risolviEndpointPubblico(accesso.host, accesso.servername || undefined);
      client = new ImapFlow({
        // ImapFlow non espone un hook DNS: si usa l'IP già verificato e si conserva il nome TLS.
        host: endpoint.address,
        port: validaPorta(accesso.porta, 'Porta IMAP'),
        secure: true,
        ...(endpoint.servername ? { servername: endpoint.servername } : {}),
        auth: {
          user: vietaControlli(accesso.utente, 'Utenza IMAP', 254).trim(),
          pass: vietaControlli(accesso.password, 'Password IMAP', 1024),
        },
        logger: false,
        connectionTimeout: 10_000,
        greetingTimeout: 10_000,
        socketTimeout: 30_000,
        tls: { rejectUnauthorized: tlsRejectUnauthorized() },
      });
      // Un errore di rete a connessione aperta arriva come evento: senza chi lo ascolta farebbe
      // cadere il processo. Il giro lo vede comunque, perché l'operazione in corso fallisce.
      client.on('error', () => {});
      await client.connect();
      const casella = await client.mailboxOpen(validaCartellaImap(accesso.cartella || 'INBOX'), { readOnly: true });
      return { uidValidity: String(casella.uidValidity), uidNext: Number(casella.uidNext) };
    },

    async uidDopo(ultimoUid) {
      const trovati = (await connesso().search({ uid: `${ultimoUid + 1}:*` }, { uid: true })) || [];
      // `n:*` restituisce sempre almeno l'ultimo messaggio, anche se il suo UID è più piccolo di n.
      return trovati.filter((uid) => uid > ultimoUid).sort((a, b) => a - b);
    },

    async uidDal(giorno) {
      const trovati = (await connesso().search({ since: giorno }, { uid: true })) || [];
      return [...trovati].sort((a, b) => a - b);
    },

    async leggi(uid) {
      const messaggio = await connesso().fetchOne(
        String(uid),
        { envelope: true, bodyStructure: true, internalDate: true, headers: ['delivered-to', 'x-forwarded-to', 'x-original-to', 'to', 'cc'] },
        { uid: true },
      );
      if (!messaggio) return null;

      const busta = messaggio.envelope;
      const intestazioni = leggiIntestazioni(messaggio.headers);
      const parti = partiDellaStruttura(messaggio.bodyStructure);

      // Il corpo è la parte che può mancare senza perdere il messaggio: mittente, oggetto e data
      // arrivano dalla busta. Una parte non scaricabile resta `null`, e si vede come assente.
      const corpo = async (parte: string | null): Promise<string | null> => {
        if (!parte) return null;
        try {
          const buffer = await scarica(uid, parte, MAX_TESTO_BYTE);
          return buffer && buffer.length ? buffer.toString('utf8') : null;
        } catch {
          return null;
        }
      };
      const html = await corpo(parti.html);
      const testo = (await corpo(parti.testo)) ?? (html ? testoDaHtml(html) : null);

      const mittente = busta?.from?.[0];
      const data = busta?.date ?? messaggio.internalDate ?? null;
      return {
        uid,
        messageId: busta?.messageId || null,
        mittenteEmail: (mittente?.address || '').toLowerCase(),
        mittenteNome: mittente?.name || null,
        destinatari: elencoIndirizzi(busta?.to),
        oggetto: busta?.subject || null,
        data: data ? new Date(data) : null,
        intestazioni: {
          deliveredTo: intestazioni.get('delivered-to') ?? null,
          xForwardedTo: intestazioni.get('x-forwarded-to') ?? null,
          xOriginalTo: intestazioni.get('x-original-to') ?? null,
          to: intestazioni.get('to') ?? elencoIndirizzi(busta?.to),
          cc: intestazioni.get('cc') ?? elencoIndirizzi(busta?.cc),
        },
        testo,
        html,
        allegati: parti.allegati,
      };
    },

    scaricaAllegato: scarica,

    async chiudi() {
      const aperto = client;
      client = null;
      if (!aperto) return;
      try {
        await aperto.logout();
      } catch {
        // Connessione già caduta: il giro è comunque finito, non c'è niente da riportare.
      }
    },
  };
}
