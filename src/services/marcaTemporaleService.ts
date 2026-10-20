/**
 * Marca temporale RFC 3161 — adapter TSA.
 *
 * PERCHÉ ESISTE (P1.2, 17/10/2026): la firma PAdES si riconosce, ma nessun documento porta
 * la prova dell'ora in cui è stato firmato. Questo servizio costruisce una TimeStampReq,
 * la invia alla TSA configurata per lo studio (o a FreeTSA, che è gratuita e non richiede
 * credenziali) e restituisce il token RFC 3161 da conservare accanto al documento.
 *
 * COSA VERIFICA:
 * - lo stato della risposta (granted / grantedWithMods / rejected / …);
 * - che l'impronta dentro il token sia quella del documento inviato;
 * - che il nonce torni uguale, così una risposta vecchia o di un'altra richiesta non passa;
 * - l'ora dichiarata dalla TSA (`genTime`) e la policy.
 *
 * COSA NON VERIFICA (dichiarato, non nascosto):
 * - la firma crittografica del token CMS e la catena del certificato della TSA;
 * - la revoca (CRL/OCSP) e l'appartenenza alla EU Trust List.
 * Per quella verifica serve una libreria/servizio dedicato (DSS eIDAS) o `openssl ts -verify`.
 * Finché non c'è, `avviso` lo dice in ogni risposta riuscita: un token «verificato» solo a metà
 * non deve sembrare una marca qualificata.
 *
 * NIENTE DIPENDENZE: DER costruito e letto a mano con i tag che servono a questo protocollo
 * (SEQUENCE, INTEGER, OID, OCTET STRING, BOOLEAN, GeneralizedTime, [0] EXPLICIT). Aggiungere
 * una libreria ASN.1 per poche centinaia di byte sarebbe una superficie in più da aggiornare.
 */
import { createHash, randomBytes } from 'crypto';
import { prisma } from '../util/prismaClient.js';

/** Endpoint pubblico di FreeTSA: gratuito, RFC 3161, nessuna credenziale. */
export const TSA_PREDEFINITA = 'https://freetsa.org/tsr';
const TIMEOUT_PREDEFINITO_MS = 15_000;
const TIMEOUT_MINIMO_MS = 2_000;
const TIMEOUT_MASSIMO_MS = 60_000;
const RISPOSTA_MASSIMA_BYTE = 2_000_000;

/** OID 2.16.840.1.101.3.4.2.1 (SHA-256), già in DER. */
const OID_SHA256 = Buffer.from('0609608648016503040201', 'hex');
/** OID 1.2.840.113549.1.9.16.1.4 (id-ct-TSTInfo), già in DER. */
const OID_TSTINFO = Buffer.from('060b2a864886f70d0109100104', 'hex');

export type StatoTsa =
  | 'granted'
  | 'grantedWithMods'
  | 'rejected'
  | 'waiting'
  | 'revocationWarning'
  | 'revocationNotification'
  | 'sconosciuto';

export interface CredenzialiTsa {
  endpoint?: string | null;
  username?: string | null;
  segreto?: string | null;
  /** Letto da `extra.timeoutMs`; fuori intervallo viene riportato dentro. */
  timeoutMs?: number | null;
}

export interface EsitoMarcaTemporale {
  ok: boolean;
  stato: StatoTsa;
  endpoint: string;
  /** Ora dichiarata dalla TSA, ISO 8601. */
  genTime: string | null;
  policy: string | null;
  serialNumber: string | null;
  /** Token RFC 3161 completo, in base64: va conservato accanto al documento. */
  tokenBase64: string | null;
  /** Vero quando l'impronta dentro il token coincide con quella richiesta. */
  hashVerificato: boolean;
  /** Limiti della verifica, in chiaro. Presente anche quando `ok` è vero. */
  avviso: string | null;
  errore: string | null;
}

interface Tlv {
  tag: number;
  valore: Buffer;
  fine: number;
}

// ─────────────────────────────────────────────────────────────────
// DER — costruzione
// ─────────────────────────────────────────────────────────────────

function tlv(tag: number, valore: Buffer): Buffer {
  const lunghezza = valore.length;
  if (lunghezza < 0x80) return Buffer.concat([Buffer.from([tag, lunghezza]), valore]);

  const byteLunghezza: number[] = [];
  let resto = lunghezza;
  while (resto > 0) {
    byteLunghezza.unshift(resto & 0xff);
    resto = Math.floor(resto / 256);
  }
  return Buffer.concat([Buffer.from([tag, 0x80 | byteLunghezza.length, ...byteLunghezza]), valore]);
}

function interoDaBigInt(valore: bigint): Buffer {
  if (valore < 0n) throw new Error('ASN.1: INTEGER negativo non ammesso.');
  let hex = valore.toString(16);
  if (hex.length % 2 === 1) hex = `0${hex}`;
  let byte = Buffer.from(hex, 'hex');
  if (byte.length === 0) byte = Buffer.from([0]);
  while (byte.length > 1 && byte[0] === 0) byte = byte.subarray(1);
  // DER: un intero positivo che inizia con il bit alto acceso va preceduto da 0x00.
  if ((byte[0]! & 0x80) !== 0) byte = Buffer.concat([Buffer.from([0]), byte]);
  return tlv(0x02, byte);
}

/**
 * TimeStampReq ::= SEQUENCE {
 *   version INTEGER (1),
 *   messageImprint SEQUENCE { AlgorithmIdentifier, OCTET STRING },
 *   reqPolicy OPTIONAL, nonce INTEGER, certReq BOOLEAN TRUE }
 */
export function creaRichiestaMarcaTemporale(
  hash: Buffer,
  opzioni: { nonce?: bigint } = {},
): { richiesta: Buffer; nonce: bigint } {
  if (!Buffer.isBuffer(hash) || hash.length !== 32) {
    throw new Error('La marca temporale richiede un’impronta SHA-256 di 32 byte.');
  }

  let nonce: bigint;
  if (opzioni.nonce !== undefined) {
    if (opzioni.nonce <= 0n) throw new Error('Il nonce deve essere un intero positivo.');
    nonce = opzioni.nonce;
  } else {
    // Il bit alto a 0 tiene il nonce nel campo positivo di un INTEGER DER a 8 byte.
    const casuale = randomBytes(8);
    casuale[0] = casuale[0]! & 0x7f;
    casuale[7] = casuale[7]! | 1;
    nonce = BigInt(`0x${casuale.toString('hex')}`);
  }

  const algoritmo = tlv(0x30, Buffer.concat([OID_SHA256, tlv(0x05, Buffer.alloc(0))]));
  const messageImprint = tlv(0x30, Buffer.concat([algoritmo, tlv(0x04, hash)]));
  const corpo = Buffer.concat([
    interoDaBigInt(1n),
    messageImprint,
    interoDaBigInt(nonce),
    // certReq TRUE: chiediamo alla TSA di includere il proprio certificato nella risposta.
    tlv(0x01, Buffer.from([0xff])),
  ]);

  return { richiesta: tlv(0x30, corpo), nonce };
}

// ─────────────────────────────────────────────────────────────────
// DER — lettura
// ─────────────────────────────────────────────────────────────────

function leggiTlv(buffer: Buffer, offset: number): Tlv {
  if (offset + 2 > buffer.length) throw new Error('Risposta ASN.1 troncata.');
  const tag = buffer[offset]!;
  if ((tag & 0x1f) === 0x1f) throw new Error('Risposta ASN.1: tag non supportato.');

  let posizione = offset + 2;
  let lunghezza = buffer[offset + 1]!;
  if (lunghezza >= 0x80) {
    const numeroByte = lunghezza & 0x7f;
    if (numeroByte === 0 || numeroByte > 4) throw new Error('Risposta ASN.1: lunghezza non valida.');
    lunghezza = 0;
    for (let i = 0; i < numeroByte; i++) {
      const b = buffer[posizione + i];
      if (b === undefined) throw new Error('Risposta ASN.1 troncata.');
      lunghezza = lunghezza * 256 + b;
    }
    posizione += numeroByte;
  }

  const fine = posizione + lunghezza;
  if (fine > buffer.length) throw new Error('Risposta ASN.1 troncata.');
  return { tag, valore: buffer.subarray(posizione, fine), fine };
}

function figli(elemento: Tlv): Tlv[] {
  const figli: Tlv[] = [];
  let offset = 0;
  while (offset < elemento.valore.length) {
    const figlio = leggiTlv(elemento.valore, offset);
    figli.push(figlio);
    offset = figlio.fine;
  }
  return figli;
}

function interoDaTlv(elemento: Tlv): bigint {
  if (elemento.tag !== 0x02) throw new Error('Risposta ASN.1: atteso un INTEGER.');
  if (elemento.valore.length === 0 || elemento.valore.length > 16) {
    throw new Error('Risposta ASN.1: INTEGER di lunghezza inattesa.');
  }
  return BigInt(`0x${elemento.valore.toString('hex')}`);
}

function oidDaTlv(elemento: Tlv): string {
  if (elemento.tag !== 0x06 || elemento.valore.length === 0) {
    throw new Error('Risposta ASN.1: atteso un OID.');
  }
  const byte = elemento.valore;
  const parti = [Math.floor(byte[0]! / 40), byte[0]! % 40];
  let corrente = 0;
  for (let i = 1; i < byte.length; i++) {
    const b = byte[i]!;
    corrente = corrente * 128 + (b & 0x7f);
    if ((b & 0x80) === 0) {
      parti.push(corrente);
      corrente = 0;
    }
  }
  return parti.join('.');
}

function stringheStato(info: Tlv): string[] {
  const testi: string[] = [];
  for (const figlio of figli(info).slice(1)) {
    if (figlio.tag === 0x30) {
      for (const voce of figli(figlio)) {
        if (voce.tag === 0x0c || voce.tag === 0x13 || voce.tag === 0x16) {
          testi.push(voce.valore.toString('utf8'));
        }
      }
    }
  }
  return testi;
}

function statoDaNumero(numero: number): StatoTsa {
  switch (numero) {
    case 0: return 'granted';
    case 1: return 'grantedWithMods';
    case 2: return 'rejected';
    case 3: return 'waiting';
    case 4: return 'revocationWarning';
    case 5: return 'revocationNotification';
    default: return 'sconosciuto';
  }
}

function dataGeneralizzata(valore: Buffer): string | null {
  const testo = valore.toString('latin1');
  const m = /^(\d{4})(\d{2})(\d{2})(\d{2})(\d{2})(\d{2})(?:\.(\d+))?Z$/.exec(testo);
  if (!m) return null;
  const [, anno, mese, giorno, ora, minuto, secondo, frazione] = m;
  const millisecondi = frazione ? Number(`0.${frazione}`) * 1000 : 0;
  const data = new Date(Date.UTC(
    Number(anno), Number(mese) - 1, Number(giorno),
    Number(ora), Number(minuto), Number(secondo), Math.round(millisecondi),
  ));
  return Number.isNaN(data.getTime()) ? null : data.toISOString();
}

/** Estrae il TSTInfo (il contenuto firmato) dal token CMS restituito dalla TSA. */
function estraiTstInfo(token: Tlv): Tlv {
  // TimeStampToken = ContentInfo ::= SEQUENCE { contentType OID, content [0] EXPLICIT SignedData }
  const partiContentInfo = figli(token);
  const contenuto = partiContentInfo.find((p) => p.tag === 0xa0);
  if (!contenuto) throw new Error('Token TSA: ContentInfo senza SignedData.');

  const signedData = figli(contenuto)[0];
  if (!signedData || signedData.tag !== 0x30) {
    throw new Error('Token TSA: SignedData non leggibile.');
  }

  const partiToken = figli(signedData);
  if (partiToken.length < 3) throw new Error('Token TSA privo della struttura SignedData.');

  const encapContentInfo = partiToken[2];
  if (!encapContentInfo || encapContentInfo.tag !== 0x30) {
    throw new Error('Token TSA: encapContentInfo mancante.');
  }

  const partiEncap = figli(encapContentInfo);
  const tipoContenuto = partiEncap[0];
  if (tipoContenuto && tipoContenuto.tag === 0x06 && !tipoContenuto.valore.equals(OID_TSTINFO.subarray(2))) {
    throw new Error('Token TSA: il contenuto firmato non è un TSTInfo.');
  }

  const esplicito = partiEncap.find((p) => p.tag === 0xa0);
  if (!esplicito) throw new Error('Token TSA: contenuto TSTInfo assente.');

  const octet = figli(esplicito)[0];
  if (!octet || octet.tag !== 0x04) throw new Error('Token TSA: contenuto TSTInfo non leggibile.');

  return leggiTlv(octet.valore, 0);
}

interface DatiTstInfo {
  policy: string;
  serialNumber: string;
  genTime: string | null;
  hashToken: Buffer;
  oidHash: Buffer;
  nonce: bigint | null;
}

function leggiTstInfo(tstInfo: Tlv): DatiTstInfo {
  if (tstInfo.tag !== 0x30) throw new Error('Token TSA: TSTInfo non è una SEQUENCE.');
  const campi = figli(tstInfo);
  if (campi.length < 5) throw new Error('Token TSA: TSTInfo incompleto.');

  const [, policyTlv, messageImprint, serialTlv, genTimeTlv] = campi;
  if (!policyTlv || !messageImprint || !serialTlv || !genTimeTlv) {
    throw new Error('Token TSA: campi TSTInfo mancanti.');
  }

  const partiImpronta = figli(messageImprint);
  const algoritmo = partiImpronta[0];
  const impronta = partiImpronta[1];
  if (!algoritmo || !impronta || impronta.tag !== 0x04) {
    throw new Error('Token TSA: messageImprint illeggibile.');
  }

  const oid = figli(algoritmo)[0];
  if (!oid || oid.tag !== 0x06) throw new Error('Token TSA: algoritmo dell’impronta mancante.');
  if (genTimeTlv.tag !== 0x18) throw new Error('Token TSA: genTime mancante.');

  // Campi facoltativi dopo genTime: accuracy (SEQUENCE), ordering (BOOLEAN), nonce (INTEGER).
  let nonce: bigint | null = null;
  for (const campo of campi.slice(5)) {
    if (campo.tag === 0x02) {
      nonce = interoDaTlv(campo);
      break;
    }
    if (campo.tag !== 0x30 && campo.tag !== 0x01 && campo.tag !== 0xa0) break;
  }

  return {
    policy: oidDaTlv(policyTlv),
    serialNumber: serialTlv.tag === 0x02 ? serialTlv.valore.toString('hex') : '',
    genTime: dataGeneralizzata(genTimeTlv.valore),
    hashToken: Buffer.from(impronta.valore),
    oidHash: Buffer.from(oid.valore),
    nonce,
  };
}

// ─────────────────────────────────────────────────────────────────
// Risposta
// ─────────────────────────────────────────────────────────────────

const AVVISO_VERIFICA_PARZIALE =
  'Il token è stato rilasciato e l’impronta coincide con quella inviata. ' +
  'La firma crittografica del token, la catena del certificato e la revoca NON sono state ' +
  'validate da questa piattaforma: per la verifica completa serve un servizio eIDAS/DSS o ' +
  '`openssl ts -verify` con i certificati della TSA.';

/**
 * Legge una TimeStampResp RFC 3161 e la confronta con la richiesta inviata.
 * Non solleva: ogni anomalia diventa un esito con `ok: false` e un motivo leggibile.
 */
export function leggiRispostaMarcaTemporale(
  risposta: Buffer,
  attesto: { hash: Buffer; nonce: bigint; endpoint: string },
): EsitoMarcaTemporale {
  const base: EsitoMarcaTemporale = {
    ok: false,
    stato: 'sconosciuto',
    endpoint: attesto.endpoint,
    genTime: null,
    policy: null,
    serialNumber: null,
    tokenBase64: null,
    hashVerificato: false,
    avviso: null,
    errore: null,
  };

  try {
    if (!Buffer.isBuffer(risposta) || risposta.length === 0) {
      return { ...base, errore: 'La TSA ha restituito una risposta vuota.' };
    }

    const radice = leggiTlv(risposta, 0);
    if (radice.tag !== 0x30) return { ...base, errore: 'La risposta della TSA non è una TimeStampResp.' };

    const parti = figli(radice);
    const statoInfo = parti[0];
    if (!statoInfo || statoInfo.tag !== 0x30) {
      return { ...base, errore: 'La risposta della TSA non contiene lo stato.' };
    }

    const partiStato = figli(statoInfo);
    const statoNumero = partiStato[0] ? Number(interoDaTlv(partiStato[0])) : NaN;
    const stato = statoDaNumero(statoNumero);

    if (stato !== 'granted' && stato !== 'grantedWithMods') {
      const motivi = stringheStato(statoInfo);
      return {
        ...base,
        stato,
        errore: `La TSA non ha rilasciato la marca temporale (${stato}${motivi.length ? `: ${motivi.join('; ')}` : ''}).`,
      };
    }

    const tokenTlv = parti[1];
    if (!tokenTlv || tokenTlv.tag !== 0x30) {
      return { ...base, stato, errore: 'La TSA ha risposto «granted» senza token.' };
    }

    const dati = leggiTstInfo(estraiTstInfo(tokenTlv));
    const hashCorretto = dati.oidHash.equals(OID_SHA256.subarray(2)) &&
      dati.hashToken.length === attesto.hash.length &&
      dati.hashToken.equals(attesto.hash);
    if (!hashCorretto) {
      return {
        ...base,
        stato,
        genTime: dati.genTime,
        policy: dati.policy,
        serialNumber: dati.serialNumber,
        errore: 'Il token della TSA riguarda un’impronta diversa da quella inviata.',
      };
    }

    if (dati.nonce === null) {
      return {
        ...base,
        stato,
        genTime: dati.genTime,
        policy: dati.policy,
        serialNumber: dati.serialNumber,
        hashVerificato: true,
        errore: 'Il token della TSA non riporta il nonce della richiesta: non è possibile legarlo a questa chiamata.',
      };
    }
    if (dati.nonce !== attesto.nonce) {
      return {
        ...base,
        stato,
        genTime: dati.genTime,
        policy: dati.policy,
        serialNumber: dati.serialNumber,
        hashVerificato: true,
        errore: 'Il token della TSA riporta un nonce diverso: è la risposta a un’altra richiesta.',
      };
    }

    return {
      ok: true,
      stato,
      endpoint: attesto.endpoint,
      genTime: dati.genTime,
      policy: dati.policy,
      serialNumber: dati.serialNumber,
      tokenBase64: bufTlvCompleto(tokenTlv).toString('base64'),
      hashVerificato: true,
      avviso: AVVISO_VERIFICA_PARZIALE,
      errore: null,
    };
  } catch (err) {
    return {
      ...base,
      errore: `Risposta della TSA non leggibile: ${err instanceof Error ? err.message : 'errore ASN.1'}.`,
    };
  }
}

/** Ricompone i byte completi di un TLV (tag + lunghezza + valore) per conservare il token. */
function bufTlvCompleto(elemento: Tlv): Buffer {
  // `figli` perde l'intestazione: ricostruiamola con la stessa regola del builder.
  return tlv(elemento.tag, elemento.valore);
}

// ─────────────────────────────────────────────────────────────────
// Invio
// ─────────────────────────────────────────────────────────────────

function timeoutNormalizzato(valore: number | null | undefined): number {
  if (!valore || !Number.isFinite(valore)) return TIMEOUT_PREDEFINITO_MS;
  return Math.min(TIMEOUT_MASSIMO_MS, Math.max(TIMEOUT_MINIMO_MS, Math.round(valore)));
}

/**
 * Invia una richiesta di marca temporale e restituisce l'esito.
 *
 * `credenziali` vuote → FreeTSA. Se utente o segreto sono impostati, vengono inviati come
 * HTTP Basic: è lo schema che usano i QTSP con API a utenza e password. Un QTSP che richiede
 * un certificato cliente non è coperto da questo adapter.
 */
export async function richiediMarcaTemporale(
  hash: Buffer,
  credenziali: CredenzialiTsa = {},
): Promise<EsitoMarcaTemporale> {
  const endpoint = (credenziali.endpoint || TSA_PREDEFINITA).trim();
  const base: EsitoMarcaTemporale = {
    ok: false,
    stato: 'sconosciuto',
    endpoint,
    genTime: null,
    policy: null,
    serialNumber: null,
    tokenBase64: null,
    hashVerificato: false,
    avviso: null,
    errore: null,
  };

  try {
    const url = new URL(endpoint);
    if (url.protocol !== 'https:' && url.protocol !== 'http:') {
      return { ...base, errore: 'L’indirizzo della TSA deve iniziare con https:// o http://.' };
    }
  } catch {
    return { ...base, errore: 'L’indirizzo della TSA non è una URL valida.' };
  }

  let richiesta: Buffer;
  let nonce: bigint;
  try {
    const costruita = creaRichiestaMarcaTemporale(hash);
    richiesta = costruita.richiesta;
    nonce = costruita.nonce;
  } catch (err) {
    return { ...base, errore: err instanceof Error ? err.message : 'Richiesta TSA non costruibile.' };
  }

  const intestazioni: Record<string, string> = {
    'Content-Type': 'application/timestamp-query',
    Accept: 'application/timestamp-reply',
  };
  if (credenziali.username || credenziali.segreto) {
    const utente = credenziali.username || '';
    const parola = credenziali.segreto || '';
    intestazioni.Authorization = `Basic ${Buffer.from(`${utente}:${parola}`).toString('base64')}`;
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutNormalizzato(credenziali.timeoutMs));
  try {
    const risposta = await fetch(endpoint, {
      method: 'POST',
      headers: intestazioni,
      body: new Uint8Array(richiesta),
      signal: controller.signal,
    });

    const contenuto = Buffer.from(await risposta.arrayBuffer());
    if (!risposta.ok) {
      const dettaglio = contenuto.subarray(0, 300).toString('utf8').replace(/\s+/g, ' ').trim();
      return {
        ...base,
        errore: `La TSA ha risposto HTTP ${risposta.status}${dettaglio ? `: ${dettaglio}` : ''}.`,
      };
    }
    if (contenuto.length > RISPOSTA_MASSIMA_BYTE) {
      return { ...base, errore: 'La risposta della TSA è troppo grande per essere una TimeStampResp.' };
    }

    return leggiRispostaMarcaTemporale(contenuto, { hash, nonce, endpoint });
  } catch (err) {
    const causa = err instanceof Error && err.name === 'AbortError'
      ? `nessuna risposta entro ${timeoutNormalizzato(credenziali.timeoutMs) / 1000} secondi`
      : err instanceof Error
        ? err.message
        : 'errore di rete';
    return { ...base, errore: `Invio alla TSA non riuscito: ${causa}.` };
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Credenziali TSA dello studio. Nessuna riga → FreeTSA (servizio pubblico, nessun segreto).
 * Se la lettura fallisce si solleva: ripiegare in silenzio su FreeTSA quando lo studio ha
 * configurato un QTSP significherebbe marcare i documenti con la TSA sbagliata.
 */
export async function credenzialiTsa(tenantId: string): Promise<CredenzialiTsa> {
  const riga = await prisma.credenzialeServizioEsterno.findUnique({
    where: { tenantId_servizio: { tenantId, servizio: 'tsa' } },
  });

  const extra = (riga?.extra ?? null) as unknown as Record<string, unknown> | null;
  const timeoutGrezzo = extra && typeof extra.timeoutMs === 'number' ? extra.timeoutMs : null;

  return {
    endpoint: riga?.endpoint || TSA_PREDEFINITA,
    username: riga?.username || null,
    segreto: riga?.segreto || null,
    timeoutMs: timeoutGrezzo,
  };
}

/** Marca un'impronta con la TSA configurata per lo studio. */
export async function richiediMarcaTemporalePerTenant(
  tenantId: string,
  hash: Buffer,
): Promise<EsitoMarcaTemporale> {
  const credenziali = await credenzialiTsa(tenantId);
  return richiediMarcaTemporale(hash, credenziali);
}

/**
 * Prova di collegamento usata dalla scheda Impostazioni: marca un'impronta casuale e non
 * conserva nulla. Serve a distinguere «indirizzo salvato» da «la TSA risponde davvero».
 */
export async function verificaCollegamentoTsa(tenantId: string): Promise<EsitoMarcaTemporale> {
  return richiediMarcaTemporalePerTenant(tenantId, randomBytes(32));
}

/**
 * Quanto aspettare la TSA mentre si appone una firma. Il timeout generale dell'adapter è
 * 15 s; qui è più corto perché la firma è già registrata e l'utente sta aspettando la
 * ricevuta: un disservizio della TSA non deve tenere bloccato il portale. Un timeout più
 * basso configurato dallo studio vince; uno più alto viene comunque tagliato a questo.
 */
export const TIMEOUT_MARCA_FIRMA_MS = 5_000;

/** Ciò che una firma deve sapere della propria marca temporale, senza il token base64. */
export interface EsitoMarcaTemporaleFirma {
  ok: boolean;
  /** Impronta SHA-256 effettivamente inviata alla TSA, in hex (qui: il digest del sigillo). */
  impronta: string | null;
  tsa: string | null;
  /** Ora attestata dalla TSA, ISO 8601. */
  genTime: string | null;
  policy: string | null;
  serialNumber: string | null;
  /** SHA-256 del token conservato: accorgersi se il valore in database viene alterato. */
  tokenHash: string | null;
  /** Limiti della verifica ereditati dall'adapter: restano scritti anche quando `ok` è vero. */
  avviso: string | null;
  errore: string | null;
}

function esitoFirmaFallito(
  errore: string,
  extra: Partial<EsitoMarcaTemporaleFirma> = {},
): EsitoMarcaTemporaleFirma {
  return {
    ok: false,
    impronta: null,
    tsa: null,
    genTime: null,
    policy: null,
    serialNumber: null,
    tokenHash: null,
    avviso: null,
    errore,
    ...extra,
  };
}

/**
 * Marca con la TSA dello studio il sigillo di una firma appena registrata e conserva il
 * token nella riga `FirmaElettronica`.
 *
 * PERCHÉ L'IMPRONTA È IL DIGEST DEL SIGILLO: il token deve attestare che *quella* firma
 * esisteva a quell'ora, non solo che il documento esisteva. Il `sigilloDigest` è l'HMAC
 * che lega documento, firmatario, canale e istante (e, per la FEA, sessione e documento
 * di riconoscimento): marcando i suoi 32 byte, il token si riferisce all'evento di firma.
 * L'impronta inviata coincide quindi con `sigilloDigest`, e il token si verifica senza
 * ricostruire nulla:
 *
 *     openssl ts -verify -token_in -digest <sigilloDigest> -in token.tsr \
 *       -CAfile freetsa-cacert.pem
 *
 * `-token_in` è obbligatorio: si conserva il TimeStampToken, non la TimeStampResp che lo
 * conteneva. Senza quel flag openssl prova a leggere il file come risposta e si ferma su
 * `status_info` (`asn1_template_noexp_d2i:nested asn1 error`). Il certificato CA della TSA
 * è l'ancora di fiducia: FreeTSA lo pubblica su <https://freetsa.org/files/cacert.pem>.
 * La riga marcata è solo la richiesta: lo stato vero è `esito.ok`. NON solleva mai — la
 * firma è già validamente apposta e un guasto della TSA (o del database) non la annulla.
 * Il motivo del fallimento resta in `marcaTemporaleErrore`, e il verbale lo cita.
 */
export async function marcaTemporaleFirma(
  tenantId: string,
  firma: { id: string; sigilloDigest?: string | null },
): Promise<EsitoMarcaTemporaleFirma> {
  const richiestaAt = new Date();
  let tsa: string | null = null;

  // Scrittura best-effort: se anche il database non si legge, la funzione restituisce
  // comunque un esito invece di far fallire la firma.
  const salva = async (dati: {
    token?: string | null;
    impronta?: string | null;
    tsa?: string | null;
    genTime?: Date | null;
    policy?: string | null;
    serial?: string | null;
    tokenHash?: string | null;
    errore: string | null;
  }): Promise<void> => {
    try {
      await prisma.firmaElettronica.updateMany({
        where: { id: firma.id, tenantId },
        data: {
          marcaTemporaleToken: dati.token ?? null,
          marcaTemporaleImpronta: dati.impronta ?? null,
          marcaTemporaleTsa: dati.tsa ?? tsa,
          marcaTemporaleGenTime: dati.genTime ?? null,
          marcaTemporalePolicy: dati.policy ?? null,
          marcaTemporaleSerial: dati.serial ?? null,
          marcaTemporaleTokenHash: dati.tokenHash ?? null,
          marcaTemporaleErrore: dati.errore,
          marcaTemporaleRichiestaAt: richiestaAt,
        },
      });
    } catch {
      // Niente da fare: l'esito resta quello della TSA, e il verbale lo cita.
    }
  };

  const digest = (firma.sigilloDigest || '').trim().toLowerCase();
  if (!/^[0-9a-f]{64}$/.test(digest)) {
    const errore =
      'Sigillo della firma assente o non valido: la marca temporale non è stata richiesta.';
    await salva({ errore });
    return esitoFirmaFallito(errore);
  }

  try {
    const credenziali = await credenzialiTsa(tenantId);
    tsa = credenziali.endpoint || TSA_PREDEFINITA;
    const esito = await richiediMarcaTemporale(Buffer.from(digest, 'hex'), {
      ...credenziali,
      timeoutMs: Math.min(credenziali.timeoutMs ?? TIMEOUT_MARCA_FIRMA_MS, TIMEOUT_MARCA_FIRMA_MS),
    });

    if (!esito.ok || !esito.hashVerificato || !esito.tokenBase64) {
      const errore = esito.errore || 'La TSA non ha restituito un token valido.';
      await salva({ tsa: esito.endpoint, errore });
      return esitoFirmaFallito(errore, { tsa: esito.endpoint, avviso: esito.avviso });
    }

    const token = Buffer.from(esito.tokenBase64, 'base64');
    const tokenHash = createHash('sha256').update(token).digest('hex');
    const genTime = esito.genTime ? new Date(esito.genTime) : null;

    await salva({
      token: esito.tokenBase64,
      impronta: digest,
      tsa: esito.endpoint,
      genTime,
      policy: esito.policy,
      serial: esito.serialNumber,
      tokenHash,
      errore: null,
    });

    return {
      ok: true,
      impronta: digest,
      tsa: esito.endpoint,
      genTime: esito.genTime,
      policy: esito.policy,
      serialNumber: esito.serialNumber,
      tokenHash,
      avviso: esito.avviso,
      errore: null,
    };
  } catch (err) {
    // Credenziali illeggibili o altra eccezione imprevista: nessun ripiego in silenzio.
    const errore = `Marca temporale non richiesta: ${
      err instanceof Error ? err.message : 'errore sconosciuto'
    }`;
    await salva({ tsa, errore });
    return esitoFirmaFallito(errore, { tsa });
  }
}
