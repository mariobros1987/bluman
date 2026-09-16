import { lookup as lookupDns } from 'node:dns/promises';
import { isIP } from 'node:net';
import { domainToASCII } from 'node:url';

export class ErrorePolicyRete extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ErrorePolicyRete';
  }
}

export type RisolutoreDns = (
  hostname: string,
  options: { all: true; verbatim: true },
) => Promise<Array<{ address: string; family: number }>>;

export interface EndpointPubblico {
  host: string;
  address: string;
  family: 4 | 6;
  /** Nome da usare per SNI/verifica certificato quando la connessione è fissata sull'IP. */
  servername?: string;
}

const CONTROLLI = /[\x00-\x1f\x7f]/;
const HOST_METADATA = new Set([
  'metadata', 'metadata.internal', 'metadata.google.internal',
  'metadata.azure.internal', 'instance-data', 'instance-data.ec2.internal',
]);
const IPV4_METADATA = new Set(['169.254.169.254', '168.63.129.16', '100.100.100.200']);

export function vietaControlli(value: unknown, campo: string, max = 1024): string {
  if (typeof value !== 'string') throw new ErrorePolicyRete(`${campo} deve essere una stringa.`);
  if (value.length > max) throw new ErrorePolicyRete(`${campo} supera ${max} caratteri.`);
  if (CONTROLLI.test(value)) throw new ErrorePolicyRete(`${campo} contiene caratteri di controllo non ammessi.`);
  return value;
}

export function validaHost(value: unknown, campo = 'Host'): string {
  const raw = vietaControlli(value, campo, 253).trim();
  if (!raw || /\s|[/\\@?#]/.test(raw)) throw new ErrorePolicyRete(`${campo} non valido.`);
  const senzaParentesi = raw.startsWith('[') && raw.endsWith(']') ? raw.slice(1, -1) : raw;
  if (isIP(senzaParentesi)) return senzaParentesi.toLowerCase();
  const ascii = domainToASCII(senzaParentesi.replace(/\.$/, '')).toLowerCase();
  if (!ascii || ascii.length > 253 || !ascii.includes('.')) throw new ErrorePolicyRete(`${campo} non valido.`);
  if (!ascii.split('.').every(label => label.length <= 63 && /^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/.test(label))) {
    throw new ErrorePolicyRete(`${campo} non valido.`);
  }
  if (HOST_METADATA.has(ascii) || ascii.endsWith('.localhost') || ascii.endsWith('.internal')) {
    throw new ErrorePolicyRete(`${campo} non può indicare un endpoint locale o metadata.`);
  }
  return ascii;
}

export function validaServername(value: unknown): string {
  const nome = validaHost(value, 'Servername TLS');
  if (isIP(nome)) throw new ErrorePolicyRete('Servername TLS deve essere un nome DNS, non un indirizzo IP.');
  return nome;
}

export function validaPorta(value: unknown, campo = 'Porta'): number {
  const numero = typeof value === 'number' ? value : typeof value === 'string' && value.trim() ? Number(value) : NaN;
  if (!Number.isInteger(numero) || numero < 1 || numero > 65535) {
    throw new ErrorePolicyRete(`${campo} deve essere un intero tra 1 e 65535.`);
  }
  return numero;
}

export function validaEmail(value: unknown, campo = 'Email'): string {
  const email = vietaControlli(value, campo, 254).trim();
  const parti = email.split('@');
  const locale = parti[0];
  const dominio = parti[1];
  if (parti.length !== 2 || !locale || !dominio || locale.length > 64 || /\s/.test(locale)) {
    throw new ErrorePolicyRete(`${campo} non valida.`);
  }
  validaHost(dominio, `${campo}: dominio`);
  return `${locale}@${dominio.toLowerCase()}`;
}

export function validaCartellaImap(value: unknown): string {
  const cartella = vietaControlli(value, 'Cartella IMAP', 255).trim();
  if (!cartella) throw new ErrorePolicyRete('Cartella IMAP non valida.');
  return cartella;
}

function ipv4Vietato(ip: string): boolean {
  const [a, b] = ip.split('.').map(Number);
  if (a === undefined || b === undefined || IPV4_METADATA.has(ip)) return true;
  return a === 0 || a === 10 || a === 127 || a >= 224 ||
    (a === 100 && b >= 64 && b <= 127) || (a === 169 && b === 254) ||
    (a === 172 && b >= 16 && b <= 31) || (a === 192 && (b === 0 || b === 168)) ||
    (a === 198 && (b === 18 || b === 19 || b === 51)) || (a === 203 && b === 0);
}

function ipv6Bytes(ip: string): number[] | null {
  if (ip.includes('.')) return null;
  const halves = ip.toLowerCase().split('::');
  if (halves.length > 2) return null;
  const left = halves[0] ? halves[0].split(':') : [];
  const right = halves[1] ? halves[1].split(':') : [];
  const missing = 8 - left.length - right.length;
  if (missing < 0 || (halves.length === 1 && missing !== 0)) return null;
  const words = [...left, ...Array(missing).fill('0'), ...right];
  if (words.length !== 8 || words.some(w => !/^[0-9a-f]{1,4}$/.test(w))) return null;
  return words.flatMap(w => { const n = parseInt(w, 16); return [n >> 8, n & 255]; });
}

export function indirizzoVietato(address: string): boolean {
  const family = isIP(address);
  if (family === 4) return ipv4Vietato(address);
  if (family !== 6) return true;
  const lower = address.toLowerCase();
  if (lower.includes('.')) return true; // IPv4-mapped/embedded: mai aggirare la policy IPv4.
  const b = ipv6Bytes(lower);
  if (!b) return true;
  const tuttiZero = b.every(x => x === 0);
  const loopback = b.slice(0, 15).every(x => x === 0) && b[15] === 1;
  const mapped = b.slice(0, 10).every(x => x === 0) && b[10] === 255 && b[11] === 255;
  const primoByte = b[0]!;
  const secondoByte = b[1]!;
  const linkLocal = primoByte === 0xfe && (secondoByte & 0xc0) === 0x80;
  const privata = (primoByte & 0xfe) === 0xfc;
  const multicast = primoByte === 0xff;
  const documentazione = primoByte === 0x20 && secondoByte === 0x01 && b[2] === 0x0d && b[3] === 0xb8;
  return tuttiZero || loopback || mapped || linkLocal || privata || multicast || documentazione;
}

/**
 * Consenso esplicito agli endpoint di rete locale (loopback e range privati),
 * valido solo in sviluppo. Serve a chi sviluppa con un server di posta interno
 * e alla suite E2E, il cui Mailpit gira in un container Docker sulla macchina
 * di chi testa. Stesso spirito di SMTP_INSECURE_TLS: un'eccezione dichiarata,
 * ristretta a NODE_ENV=development — in produzione la variabile non è impostata
 * e la protezione SSRF resta integra (fail-closed).
 */
export function endpointLocaliConsentiti(): boolean {
  return process.env.NODE_ENV === 'development' && process.env.PERMETTI_ENDPOINT_LOCALI === '1';
}

export async function risolviEndpointPubblico(
  hostInput: unknown,
  servernameInput?: unknown,
  resolver: RisolutoreDns = lookupDns as RisolutoreDns,
): Promise<EndpointPubblico> {
  const host = validaHost(hostInput);
  const servername = servernameInput ? validaServername(servernameInput) : (isIP(host) ? undefined : host);
  const risolti = isIP(host) ? [{ address: host, family: isIP(host) }] : await resolver(host, { all: true, verbatim: true });
  if (!risolti.length) throw new ErrorePolicyRete(`Host ${host} senza indirizzi DNS.`);
  const localiAmmessi = endpointLocaliConsentiti();
  for (const r of risolti) {
    if ((r.family !== 4 && r.family !== 6) || (!localiAmmessi && indirizzoVietato(r.address))) {
      throw new ErrorePolicyRete(`Host ${host} risolve a un indirizzo non pubblico o riservato.`);
    }
  }
  const primo = risolti[0]!;
  return { host, address: primo.address, family: primo.family as 4 | 6, servername };
}

export interface EndpointServizio {
  /** URL base normalizzato, senza barra finale: `https://signal.studio.it`. */
  url: string;
  host: string;
  address: string;
  porta: number;
  https: boolean;
}

/**
 * L'indirizzo di un servizio che **lo studio** indica nelle impostazioni (oggi Signal).
 *
 * Perché serve un controllo e non basta `new URL(...)`. Questo indirizzo lo scrive l'operatore
 * di uno studio e il backend lo chiama: senza filtro, `http://169.254.169.254/…` o
 * `http://railway-internal:5432` trasformano una richiesta dello studio in una richiesta
 * dell'infrastruttura — è la classe di guasti che la policy di rete di questo file esiste per
 * impedire. La stessa risoluzione che protegge l'SMTP vale qui: si risolve il nome, si rifiuta
 * ogni indirizzo non pubblico, e vale l'eccezione dichiarata `endpointLocaliConsentiti()`
 * (sviluppo ed E2E, dove il demone sta in un container sulla macchina di chi testa).
 *
 * Cosa questo controllo **non** chiude, detto perché non lo si creda chiuso: la risoluzione
 * serve a decidere, poi è `fetch` a risolvere di nuovo per contattare. Fra i due momenti un DNS
 * che cambia risposta può spostare la connessione (TOCTOU). Chiuderlo richiede di fissare la
 * connessione all'indirizzo già validato, che `fetch` non permette e che qui non si è fatto.
 * Il perimetro che resta scoperto è quello di uno studio che attacca l'infrastruttura da cui
 * è ospitato, ed è tracciato: l'indirizzo è un campo della sua riga, e ogni chiamata è sua.
 *
 * In produzione è richiesto `https`: il token del proxy e i messaggi viaggiano su quella
 * connessione. `http` è ammesso solo dove `endpointLocaliConsentiti()` è vero.
 */
export async function validaUrlServizio(
  valore: unknown,
  campo: string,
  resolver: RisolutoreDns = lookupDns as RisolutoreDns,
): Promise<EndpointServizio> {
  const grezzo = vietaControlli(valore, campo, 2048).trim();
  if (!grezzo) throw new ErrorePolicyRete(`${campo} non configurato.`);

  let url: URL;
  try {
    url = new URL(grezzo);
  } catch {
    throw new ErrorePolicyRete(`${campo} non è un indirizzo valido: serve la forma completa, ` +
      `per esempio https://signal.studiotuo.it`);
  }

  const https = url.protocol === 'https:';
  if (url.protocol !== 'https:' && url.protocol !== 'http:') {
    throw new ErrorePolicyRete(`${campo} deve essere http o https, non «${url.protocol.replace(':', '')}».`);
  }
  if (url.hash) throw new ErrorePolicyRete(`${campo} non può contenere un frammento (#…).`);
  if (url.search) {
    throw new ErrorePolicyRete(`${campo} non può contenere parametri nella query: il token del proxy ` +
      `ha un campo suo e una credenziale nella query finisce nei log di ogni proxy che attraversa.`);
  }
  // `https://utente:password@host` mette la credenziale nell'URL: stessa ragione, e in più
  // finirebbe in chiaro nel report dell'audit log.
  if (url.username || url.password) {
    throw new ErrorePolicyRete(`${campo} non può contenere utente e password nell'indirizzo.`);
  }
  if (/\.\./.test(url.pathname)) throw new ErrorePolicyRete(`${campo} non può contenere «..» nel percorso.`);

  const hostGrezzo = url.hostname.replace(/^\[|\]$/g, '');
  const porta = url.port ? Number(url.port) : (https ? 443 : 80);
  if (!Number.isInteger(porta) || porta < 1 || porta > 65535) {
    throw new ErrorePolicyRete(`${campo}: porta non valida.`);
  }

  if (endpointLocaliConsentiti()) {
    // Sviluppo ed E2E: il demone può stare in un container sulla stessa macchina, raggiungibile
    // per nome di servizio (`http://signal-cli:8080`) — un nome che non ha un punto e che
    // `validaHost` rifiuterebbe. Qui non c'è infrastruttura da proteggere da sé stessa.
    return { url: url.origin + url.pathname.replace(/\/+$/, ''), host: hostGrezzo, address: hostGrezzo, porta, https };
  }

  if (!https) {
    throw new ErrorePolicyRete(`${campo} deve essere in https: il token e i messaggi viaggiano su ` +
      `quella connessione, e in chiaro li legge ogni nodo che attraversa.`);
  }

  const endpoint = await risolviEndpointPubblico(hostGrezzo, undefined, resolver);
  return {
    url: url.origin + url.pathname.replace(/\/+$/, ''),
    host: endpoint.host,
    address: endpoint.address,
    porta,
    https,
  };
}
