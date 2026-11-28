// Cifratura a riposo del canale protetto studio ↔ cliente: i messaggi del portale e i loro
// allegati stanno nel database e nell'archivio come testo cifrato, non in chiaro.
//
// Cosa protegge: una copia del database, un backup o l'archivio dei file finiti in mani sbagliate
// non rivelano la corrispondenza. Cosa NON è: cifratura «da capo a capo». Il server decifra per chi
// ha titolo a leggere (il cliente della pratica, gli operatori dello studio con il permesso
// Comunicazioni): lo studio deve poter leggere, cercare e conservare la corrispondenza della
// pratica, e il cliente entra con un link, senza una chiave sua da custodire.
//
// La chiave non sta nel codice né nel database: viene dall'ambiente. Se c'è la variabile dedicata
// `CANALE_PROTETTO_CHIAVE` si usa quella; altrimenti si usa `JWT_SECRET`, che in produzione è
// obbligatorio: così il canale è cifrato dal primo giorno, senza un segreto in più da impostare a
// mano (la stessa scelta di `util/cifraturaSegreti.ts`). Dal segreto si deriva una chiave per studio
// (HKDF-SHA256 col tenant come sale e un'etichetta propria: non è la chiave che firma i token): il
// testo cifrato di uno studio non si apre con la chiave di un altro. AES-256-GCM, con studio e
// ambito legati al testo cifrato (dati autenticati): un messaggio spostato a mano su un'altra
// pratica non si apre.
//
// La corrispondenza vive anni, i token un giorno: quando `JWT_SECRET` cambia, quello vecchio va
// tenuto in `CANALE_PROTETTO_CHIAVI_PRECEDENTI` (non solo in `JWT_PREVIOUS_SECRETS`, che dopo un
// giorno si svuota), altrimenti i messaggi scritti prima risultano «non leggibili su questo server»
// finché non ci torna. Ogni dato cifrato porta l'impronta della chiave che lo apre.
//
// Senza nessuna delle due (sviluppo) il canale funziona in chiaro e `statoCifratura()` lo dice:
// l'interfaccia non mostra un lucchetto che non c'è. Con una `CANALE_PROTETTO_CHIAVE` presente ma
// non valida la scrittura si rifiuta: chi l'ha impostata voleva quella chiave, e ripiegare in
// silenzio su un'altra o sul testo in chiaro sarebbe il contrario di ciò che ha chiesto.
import { createCipheriv, createDecipheriv, createHash, hkdfSync, randomBytes } from 'node:crypto';

const VARIABILE_CHIAVE = 'CANALE_PROTETTO_CHIAVE';
const VARIABILE_PRECEDENTI = 'CANALE_PROTETTO_CHIAVI_PRECEDENTI';
const VARIABILE_JWT = 'JWT_SECRET';
const VARIABILE_JWT_PRECEDENTI = 'JWT_PREVIOUS_SECRETS';
const LUNGHEZZA_MINIMA_CHIAVE = 32;
const INFO_DERIVAZIONE = 'bluman/canale-protetto/v1';

/** Testo cifrato: `bmc1.<id chiave>.<base64url di IV, sigillo e testo>`. */
const FORMA_TESTO_CIFRATO = /^bmc1\.([0-9a-f]{8})\.([A-Za-z0-9_-]{38,})$/;
/** File cifrato: `BMC1`, id della chiave (4 byte), IV (12), sigillo (16), contenuto. */
const MAGIA_FILE = Buffer.from('BMC1', 'ascii');
const TESTATA_FILE = MAGIA_FILE.length + 4 + 12 + 16;

/** Il contenuto non si può cifrare o decifrare: chiave assente, sbagliata, o dato alterato. */
export class ErroreCifratura extends Error {
  constructor(messaggio: string) {
    super(messaggio);
    this.name = 'ErroreCifratura';
  }
}

interface ChiaveMaestra {
  /** Impronta della chiave (non segreta): dice con quale chiave è stato cifrato un dato. */
  id: string;
  materiale: Buffer;
}

interface Portachiavi {
  corrente: ChiaveMaestra | null;
  tutte: ChiaveMaestra[];
  errore: string | null;
}

function chiaveDa(valore: string): ChiaveMaestra {
  const materiale = Buffer.from(valore, 'utf8');
  // L'impronta passa da un'etichetta: non è un pezzo dell'hash del segreto così com'è.
  return { id: createHash('sha256').update('bluman/canale-protetto/impronta:').update(materiale).digest('hex').slice(0, 8), materiale };
}

// Le variabili si leggono a ogni uso (costa un confronto di stringhe): così una prova può
// cambiarle, e la derivazione per studio — la parte cara — resta in memoria.
let memoria: { firma: string; portachiavi: Portachiavi } | null = null;
const chiaviDerivate = new Map<string, Buffer>();

function elencoChiavi(grezze: string): ChiaveMaestra[] {
  return grezze
    .split(',')
    .map((v) => v.trim())
    .filter((v) => v.length >= LUNGHEZZA_MINIMA_CHIAVE)
    .map(chiaveDa);
}

function senzaDoppioni(chiavi: ChiaveMaestra[]): ChiaveMaestra[] {
  return chiavi.filter((chiave, indice) => chiavi.findIndex((altra) => altra.id === chiave.id) === indice);
}

function portachiavi(): Portachiavi {
  const grezza = (process.env[VARIABILE_CHIAVE] ?? '').trim();
  const precedentiGrezze = (process.env[VARIABILE_PRECEDENTI] ?? '').trim();
  const jwt = (process.env[VARIABILE_JWT] ?? '').trim();
  const jwtPrecedenti = (process.env[VARIABILE_JWT_PRECEDENTI] ?? '').trim();
  const firma = [grezza, precedentiGrezze, jwt, jwtPrecedenti].join('\n');
  if (memoria?.firma === firma) return memoria.portachiavi;

  // Per rileggere valgono tutte: le precedenti dichiarate, e i segreti dei token di adesso e di
  // prima, perché finché non c'è una chiave dedicata è con quelli che si è scritto.
  const perRileggere = [...elencoChiavi(precedentiGrezze), ...elencoChiavi(jwt), ...elencoChiavi(jwtPrecedenti)];

  let nuovo: Portachiavi;
  if (!grezza) {
    // Un `JWT_SECRET` corto (ammesso solo fuori produzione) non fa da chiave: si resta in chiaro.
    const corrente = elencoChiavi(jwt)[0] ?? null;
    nuovo = { corrente, tutte: senzaDoppioni(corrente ? [corrente, ...perRileggere] : perRileggere), errore: null };
  } else if (grezza.length < LUNGHEZZA_MINIMA_CHIAVE) {
    nuovo = {
      corrente: null,
      tutte: senzaDoppioni(perRileggere),
      errore: `${VARIABILE_CHIAVE} è più corta di ${LUNGHEZZA_MINIMA_CHIAVE} caratteri: il canale protetto non accetta messaggi finché non è corretta.`,
    };
  } else {
    const corrente = chiaveDa(grezza);
    nuovo = { corrente, tutte: senzaDoppioni([corrente, ...perRileggere]), errore: null };
  }
  memoria = { firma, portachiavi: nuovo };
  chiaviDerivate.clear();
  return nuovo;
}

function chiaveDelloStudio(maestra: ChiaveMaestra, tenantId: string): Buffer {
  const voce = `${maestra.id}:${tenantId}`;
  let chiave = chiaviDerivate.get(voce);
  if (!chiave) {
    chiave = Buffer.from(hkdfSync('sha256', maestra.materiale, Buffer.from(tenantId, 'utf8'), INFO_DERIVAZIONE, 32));
    chiaviDerivate.set(voce, chiave);
  }
  return chiave;
}

function datiAutenticati(tenantId: string, ambito: string): Buffer {
  return Buffer.from(`${tenantId}|${ambito}`, 'utf8');
}

/**
 * Se i messaggi nuovi vengono cifrati. `errore` è valorizzato quando la chiave c'è ma non è
 * utilizzabile: in quel caso scrivere nel canale protetto è rifiutato.
 */
export function statoCifratura(): { attiva: boolean; errore: string | null } {
  const p = portachiavi();
  return { attiva: p.corrente !== null, errore: p.errore };
}

/** Vero se il valore è un testo cifrato da questo modulo. */
export function eTestoCifrato(valore: unknown): valore is string {
  return typeof valore === 'string' && FORMA_TESTO_CIFRATO.test(valore);
}

function sigilla(chiave: Buffer, aad: Buffer, chiaro: Buffer): { iv: Buffer; sigillo: Buffer; cifrato: Buffer } {
  const iv = randomBytes(12);
  const cifrario = createCipheriv('aes-256-gcm', chiave, iv);
  cifrario.setAAD(aad);
  const cifrato = Buffer.concat([cifrario.update(chiaro), cifrario.final()]);
  return { iv, sigillo: cifrario.getAuthTag(), cifrato };
}

function apri(chiave: Buffer, aad: Buffer, iv: Buffer, sigillo: Buffer, cifrato: Buffer): Buffer {
  const decifrario = createDecipheriv('aes-256-gcm', chiave, iv);
  decifrario.setAAD(aad);
  decifrario.setAuthTag(sigillo);
  try {
    return Buffer.concat([decifrario.update(cifrato), decifrario.final()]);
  } catch {
    throw new ErroreCifratura('Il contenuto protetto non si apre: è stato alterato o appartiene a un’altra pratica.');
  }
}

function chiavePerScrivere(): ChiaveMaestra | null {
  const p = portachiavi();
  if (p.errore) throw new ErroreCifratura(p.errore);
  return p.corrente;
}

function chiavePerLeggere(id: string): ChiaveMaestra {
  const trovata = portachiavi().tutte.find((c) => c.id === id);
  if (!trovata) {
    throw new ErroreCifratura('La chiave con cui questo contenuto è stato protetto non è configurata su questo server.');
  }
  return trovata;
}

/**
 * Cifra un testo per lo studio e l'ambito indicati (per i messaggi: la pratica). Senza nessuna
 * chiave nell'ambiente restituisce il testo com'è.
 */
export function cifraTesto(tenantId: string, ambito: string, chiaro: string): string {
  const maestra = chiavePerScrivere();
  if (!maestra) return chiaro;
  const { iv, sigillo, cifrato } = sigilla(
    chiaveDelloStudio(maestra, tenantId),
    datiAutenticati(tenantId, ambito),
    Buffer.from(chiaro, 'utf8'),
  );
  return `bmc1.${maestra.id}.${Buffer.concat([iv, sigillo, cifrato]).toString('base64url')}`;
}

/**
 * Riapre un testo cifrato. Un valore che non è testo cifrato torna com'è: sono i messaggi scritti
 * prima che la cifratura fosse accesa, che restano leggibili.
 */
export function decifraTesto(tenantId: string, ambito: string, valore: string): string {
  const forma = FORMA_TESTO_CIFRATO.exec(valore);
  if (!forma) return valore;
  const maestra = chiavePerLeggere(forma[1]!);
  const blocco = Buffer.from(forma[2]!, 'base64url');
  return apri(
    chiaveDelloStudio(maestra, tenantId),
    datiAutenticati(tenantId, ambito),
    blocco.subarray(0, 12),
    blocco.subarray(12, 28),
    blocco.subarray(28),
  ).toString('utf8');
}

/** Cifra il contenuto di un file. `cifrato: false` quando non c'è una chiave configurata. */
export function cifraFile(tenantId: string, ambito: string, chiaro: Buffer): { contenuto: Buffer; cifrato: boolean } {
  const maestra = chiavePerScrivere();
  if (!maestra) return { contenuto: chiaro, cifrato: false };
  const { iv, sigillo, cifrato } = sigilla(chiaveDelloStudio(maestra, tenantId), datiAutenticati(tenantId, ambito), chiaro);
  return { contenuto: Buffer.concat([MAGIA_FILE, Buffer.from(maestra.id, 'hex'), iv, sigillo, cifrato]), cifrato: true };
}

/** Riapre un file cifrato con `cifraFile`. Chi chiama sa dai metadati se il file era cifrato. */
export function decifraFile(tenantId: string, ambito: string, contenuto: Buffer): Buffer {
  if (contenuto.length < TESTATA_FILE || !contenuto.subarray(0, MAGIA_FILE.length).equals(MAGIA_FILE)) {
    throw new ErroreCifratura('Il file protetto ha una forma che questo server non riconosce.');
  }
  const maestra = chiavePerLeggere(contenuto.subarray(4, 8).toString('hex'));
  return apri(
    chiaveDelloStudio(maestra, tenantId),
    datiAutenticati(tenantId, ambito),
    contenuto.subarray(8, 20),
    contenuto.subarray(20, 36),
    contenuto.subarray(36),
  );
}
