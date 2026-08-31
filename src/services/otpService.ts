/**
 * Codici OTP della firma elettronica semplice (SES · art. 20 CAD, §23bis).
 *
 * Prima questo file teneva i codici in una `Map` di processo. Sembrava un dettaglio di
 * implementazione, ma su Railway ogni deploy e ogni restart cancellavano i codici già
 * spediti: il cliente riceveva il messaggio e leggeva "codice scaduto" digitandolo. Con
 * più di un'istanza il codice generato da una non era nemmeno visibile all'altra. Ora la
 * riga sta in `codice_otp`, dentro RLS come tutto il resto.
 *
 * Il codice in chiaro esiste solo per il tempo di spedirlo: in tabella va l'HMAC
 * (`hashCodiceOtp`), quindi nemmeno chi legge il database può firmare al posto del cliente.
 */
import crypto from 'crypto';
import { prisma } from '../util/prismaClient';
import { hashCodiceOtp, verificaCodiceOtp } from '../util/jwt';

/**
 * Niente `sms`. Il canale c'era nell'interfaccia e nel tipo, ma nel server non esiste
 * nessun provider SMS: scegliendolo il cliente otteneva un codice generato e mai spedito,
 * cioè una firma che non si può completare. Un canale che non spedisce va tolto, non
 * mostrato.
 */
export type CanaleOtp = 'whatsapp' | 'email' | 'telegram';

/** Cosa autorizza il codice. Un OTP per un addendum non vale per un documento del Vault. */
export type AmbitoOtp = 'engagement_letter' | 'documento_vault' | 'modulo_completato' | 'addendum';

export const TTL_OTP_SECONDI = 300;
export const MAX_TENTATIVI = 3;
export const MAX_REINVII = 3;
export const ATTESA_REINVIO_SECONDI = 60;

export const CANALI_OTP: CanaleOtp[] = ['whatsapp', 'email', 'telegram'];

export function canaleValido(valore: unknown): valore is CanaleOtp {
  return typeof valore === 'string' && (CANALI_OTP as string[]).includes(valore);
}

export interface RichiestaOtp {
  tenantId: string;
  clienteId: string;
  canale: CanaleOtp;
  /** Recapito a cui il codice verrà spedito. */
  target: string;
  /** Recapito sulla scheda anagrafica, quando il firmatario ne ha dichiarato un altro. */
  targetAnagrafica?: string | null;
  ambito: AmbitoOtp;
  riferimentoId?: string | null;
  /** IP reale del richiedente, `null` quando il proxy non lo espone. */
  ipRichiesta?: string | null;
}

export interface EsitoCreazioneOtp {
  ok: boolean;
  /** In chiaro, solo per la spedizione: non va loggato né restituito al browser. */
  codice?: string;
  otpId?: string;
  scadenza?: Date;
  reinviiRimanenti?: number;
  /** Secondi da attendere prima del prossimo reinvio, quando il limite temporale morde. */
  attendiSecondi?: number;
  errore?: string;
}

function generaCodice(): string {
  // `randomInt` con estremo superiore esclusivo: 100000–999999, sei cifre sempre piene.
  return crypto.randomInt(100000, 1000000).toString();
}

/** La riga di firma ancora viva per quell'ambito, se c'è. */
async function sessioneAperta(clienteId: string, ambito: AmbitoOtp, riferimentoId?: string | null) {
  return prisma.codiceOtp.findFirst({
    where: {
      clienteId,
      ambito,
      riferimentoId: riferimentoId ?? null,
      usatoAt: null,
    },
    orderBy: { createdAt: 'desc' },
  });
}

/**
 * Emette un codice, o lo rinnova se per quell'ambito c'è già una sessione di firma aperta.
 *
 * Il conteggio dei reinvii vive sulla riga della sessione: massimo 3, non prima di 60
 * secondi dall'ultimo (§1.5). Quando il codice precedente è scaduto il conteggio riparte —
 * cinque minuti di attesa sono già una limitazione, e bloccare per sempre chi ha lasciato
 * scadere il messaggio significa chiudere fuori il firmatario.
 */
export async function creaOtp(richiesta: RichiestaOtp): Promise<EsitoCreazioneOtp> {
  const adesso = new Date();
  const codice = generaCodice();
  const codiceHash = hashCodiceOtp(codice, richiesta.clienteId);
  const scadenza = new Date(adesso.getTime() + TTL_OTP_SECONDI * 1000);
  const targetDichiarato = Boolean(
    richiesta.targetAnagrafica && richiesta.targetAnagrafica.trim() !== richiesta.target.trim(),
  );

  const aperta = await sessioneAperta(richiesta.clienteId, richiesta.ambito, richiesta.riferimentoId);
  const codicePrecedenteVivo = aperta && aperta.scadenza > adesso;

  if (codicePrecedenteVivo) {
    if (aperta.reinvii >= MAX_REINVII) {
      return {
        ok: false,
        errore: `Hai già richiesto ${MAX_REINVII} nuovi codici. Attendi la scadenza di quello in corso prima di riprovare.`,
      };
    }

    const trascorsi = Math.floor((adesso.getTime() - new Date(aperta.ultimoInvioAt).getTime()) / 1000);
    if (trascorsi < ATTESA_REINVIO_SECONDI) {
      return {
        ok: false,
        attendiSecondi: ATTESA_REINVIO_SECONDI - trascorsi,
        errore: `Attendi ${ATTESA_REINVIO_SECONDI - trascorsi} secondi prima di richiedere un nuovo codice.`,
      };
    }
  }

  if (aperta) {
    // Tentativi azzerati: il codice è nuovo, gli errori sul precedente non lo riguardano.
    const aggiornata = await prisma.codiceOtp.update({
      where: { id: aperta.id },
      data: {
        codiceHash,
        canale: richiesta.canale,
        target: richiesta.target,
        targetDichiarato,
        targetAnagrafica: richiesta.targetAnagrafica ?? null,
        scadenza,
        tentativi: 0,
        reinvii: codicePrecedenteVivo ? aperta.reinvii + 1 : 0,
        ultimoInvioAt: adesso,
        ipRichiesta: richiesta.ipRichiesta ?? null,
      },
    });

    return {
      ok: true,
      codice,
      otpId: aggiornata.id,
      scadenza,
      reinviiRimanenti: MAX_REINVII - aggiornata.reinvii,
    };
  }

  const creata = await prisma.codiceOtp.create({
    data: {
      tenantId: richiesta.tenantId,
      clienteId: richiesta.clienteId,
      codiceHash,
      canale: richiesta.canale,
      target: richiesta.target,
      targetDichiarato,
      targetAnagrafica: richiesta.targetAnagrafica ?? null,
      ambito: richiesta.ambito,
      riferimentoId: richiesta.riferimentoId ?? null,
      scadenza,
      ultimoInvioAt: adesso,
      ipRichiesta: richiesta.ipRichiesta ?? null,
    },
  });

  return { ok: true, codice, otpId: creata.id, scadenza, reinviiRimanenti: MAX_REINVII };
}

/**
 * Invalida un codice appena emesso di cui la consegna è fallita.
 *
 * Serve perché altrimenti un invio non riuscito lascerebbe in piedi una sessione viva: il
 * cliente si vedrebbe rifiutare per 60 secondi il tentativo su un altro canale, e il
 * reinvio andato a vuoto gli avrebbe già consumato uno dei tre. Portando la scadenza nel
 * passato la richiesta successiva riparte come sessione nuova.
 */
export async function annullaOtp(otpId: string): Promise<void> {
  try {
    await prisma.codiceOtp.update({
      where: { id: otpId },
      data: { scadenza: new Date(Date.now() - 1000) },
    });
  } catch {
    // L'annullamento è un ripulire: se fallisce, resta un codice che scadrà da sé.
  }
}

export interface EsitoVerificaOtp {
  valido: boolean;
  motivo?: string;
  /** La riga consumata: serve al sigillo per citare canale e recapito reali. */
  record?: {
    id: string;
    canale: string;
    target: string;
    targetDichiarato: boolean;
    targetAnagrafica: string | null;
    ipRichiesta: string | null;
  };
}

/**
 * Verifica il codice digitato e lo consuma.
 *
 * `ambito` è parte della ricerca di proposito: un codice ottenuto per prendere visione di
 * un documento non deve poter firmare una lettera d'incarico.
 */
export async function verificaOtp(
  clienteId: string,
  codiceInserito: string,
  ambito: AmbitoOtp,
  riferimentoId?: string | null,
): Promise<EsitoVerificaOtp> {
  const record = await sessioneAperta(clienteId, ambito, riferimentoId);

  if (!record) {
    return { valido: false, motivo: 'Nessun codice in attesa di verifica. Richiedine uno nuovo.' };
  }

  if (new Date() > record.scadenza) {
    return {
      valido: false,
      motivo: `Il codice è scaduto (validità ${Math.round(TTL_OTP_SECONDI / 60)} minuti). Richiedine uno nuovo.`,
    };
  }

  if (record.tentativi >= MAX_TENTATIVI) {
    return {
      valido: false,
      motivo: 'Troppi tentativi errati: il codice non è più utilizzabile. Richiedine uno nuovo.',
    };
  }

  if (!verificaCodiceOtp(codiceInserito.trim(), clienteId, record.codiceHash)) {
    const dopo = await prisma.codiceOtp.update({
      where: { id: record.id },
      data: { tentativi: { increment: 1 } },
    });
    const rimasti = MAX_TENTATIVI - dopo.tentativi;
    return {
      valido: false,
      motivo:
        rimasti > 0
          ? `Codice non corretto. Tentativi rimasti: ${rimasti}.`
          : 'Codice non corretto. Tentativi esauriti: richiedi un nuovo codice.',
    };
  }

  // Consumato: `usatoAt` chiude la sessione, quindi lo stesso codice non firma due volte.
  await prisma.codiceOtp.update({
    where: { id: record.id },
    data: { usatoAt: new Date() },
  });

  return {
    valido: true,
    record: {
      id: record.id,
      canale: record.canale,
      target: record.target,
      targetDichiarato: record.targetDichiarato,
      targetAnagrafica: record.targetAnagrafica,
      ipRichiesta: record.ipRichiesta,
    },
  };
}

/**
 * Nasconde il recapito nelle risposte API: al browser va "a chi è stato spedito" quanto
 * basta perché il firmatario si riconosca, non il dato per intero. In tabella resta
 * completo, perché l'audit di una firma deve poter dire dove è finito il fattore.
 */
export function mascheraRecapito(target: string): string {
  if (target.includes('@')) {
    const [utente = '', dominio = ''] = target.split('@');
    if (utente.length <= 2) return `***@${dominio}`;
    return `${utente.slice(0, 2)}***${utente.slice(-1)}@${dominio}`;
  }
  const pulito = target.replace(/\s+/g, '');
  if (pulito.length <= 4) return '***';
  return `${pulito.slice(0, 3)}*** ${pulito.slice(-3)}`;
}

/** Frase da incidere nel sigillo: dice come è stato verificato il firmatario, davvero. */
export function descriviCanaleVerificato(record: {
  canale: string;
  target: string;
  targetDichiarato: boolean;
  targetAnagrafica: string | null;
}): string {
  const nomi: Record<string, string> = {
    whatsapp: 'WhatsApp',
    email: 'email',
    telegram: 'Telegram',
  };
  const canale = nomi[record.canale] || record.canale;
  const base = `Codice OTP monouso consegnato via ${canale} a ${mascheraRecapito(record.target)}`;

  if (!record.targetDichiarato) return `${base}, recapito da scheda anagrafica`;

  // Va scritto, non taciuto: chi possiede il magic link può indicare un recapito diverso
  // da quello registrato, e questo indebolisce il legame fra il codice e la persona.
  const inScheda = record.targetAnagrafica ? mascheraRecapito(record.targetAnagrafica) : 'assente';
  return `${base}, recapito dichiarato dal firmatario in fase di firma e diverso da quello in anagrafica (${inScheda})`;
}

export interface SigilloFea {
  signatureId: string;
  signerName: string;
  documentoTitolo: string;
  timestampIso: string;
  documentoHash: string;
  sha256Digest: string;
  ipAddress: string | null;
  userAgent: string | null;
  canaleVerificato: string;
  standard: string;
  // Fase 3 FEA (misura 3) — certificato di sessione: null quando la firma non proviene
  // dal flusso FEA o la sessione non li porta (token emessi prima della Fase 3).
  sessionId: string | null;
  loginAt: Date | null;
  // Fase 3 FEA (misura 1) — documento di riconoscimento caricato una tantum dal
  // firmatario. Raccomandato, non obbligatorio: quando presente l'hash entra nel digest.
  docRiconoscimentoHash: string | null;
  docRiconoscimentoTipo: string | null;
}

/**
 * Standard di riferimento per la firma semplice: chi costruisce un sigillo senza
 * dichiarare uno standard ottiene l'etichetta più prudente, mai la più forte.
 * Un OTP verificato su recapito in anagrafica è una Firma Elettronica Semplice
 * (art. 20 CAD), non una firma avanzata.
 */
export const STANDARD_SES =
  'Firma Elettronica Semplice (SES) · art. 20 CAD — eIDAS UE 910/2014 art. 3 n. 10';

/**
 * Fase 3 FEA — standard della firma avanzata misurata: OTP su recapito verificato +
 * grafometrica obbligatoria + sessione portale certificata nel digest + firmatario
 * identificato fra i nomi ammessi dall'anagrafica (art. 25 CAD / eIDAS art. 3 n. 2).
 * Scrivibile SOLO dal flusso OTP misurato di verify-otp-and-sign, mai dal canale file.
 */
export const STANDARD_FEA =
  'Firma Elettronica Avanzata (FEA) · art. 25 CAD — eIDAS UE 910/2014 art. 3 n. 2';

/** Prefisso del signatureId per valore legale: l'id dichiara cosa il sigillo attesta. */
const PREFISSI_SIGNATURE_ID: Record<'ses' | 'fea' | 'feq', string> = {
  ses: 'SIGILLO-SES',
  fea: 'SIGILLO-FEA',
  feq: 'SIGILLO-FEQ',
};

/**
 * Costruisce il sigillo eIDAS.
 *
 * Due cose sono cambiate rispetto a prima. `ipAddress` può essere `null` — l'interfaccia
 * lo mostrerà come "non registrato" — invece di ricadere su `127.0.0.1`, che in un verbale
 * probatorio è un dato falso: nessun firmatario si collega dal loopback del server.
 * E `documentoHash` non ha più il ripiego `'DOC_ORIGINAL_HASH'`: un sigillo che non
 * identifica il testo firmato certifica una volontà su un documento qualunque.
 *
 * `valoreLegale` (default `ses`) governa il prefisso del signatureId: il valore legale
 * EFFETTIVO della firma apposta, distinto dal meccanismo. I sigilli storici restano
 * `EIDAS-FEA-…`: sono atti già registrati e non si riscrivono.
 */
export function creaSigilloFea(params: {
  clienteId: string;
  signerName: string;
  documentoTitolo: string;
  documentoHash: string;
  ip?: string | null;
  userAgent?: string | null;
  canaleVerificato: string;
  standard?: string;
  valoreLegale?: 'ses' | 'fea' | 'feq';
  // Fase 3 FEA — misura 3 (sessione) e misura 1 (doc di riconoscimento). Tutti opzionali:
  // le chiamate SES esistenti non li passano e i loro sigilli restano identici a prima.
  sessionId?: string | null;
  loginAt?: Date | null;
  docRiconoscimentoHash?: string | null;
  docRiconoscimentoTipo?: string | null;
}): SigilloFea {
  const timestampIso = new Date().toISOString();
  const ipAddress = params.ip && params.ip.trim() ? params.ip.trim() : null;
  const valoreLegale = params.valoreLegale ?? 'ses';
  const standard = params.standard || STANDARD_SES;
  const sessionId = params.sessionId && params.sessionId.trim() ? params.sessionId.trim() : null;
  const loginAt = params.loginAt instanceof Date ? params.loginAt : null;
  const docRiconoscimentoHash =
    params.docRiconoscimentoHash && params.docRiconoscimentoHash.trim()
      ? params.docRiconoscimentoHash.trim()
      : null;

  // L'impronta del sigillo lega insieme tutti gli elementi del verbale: cambiarne uno a
  // posteriori la invalida. Ogni elemento assente entra come 'non-registrato', così il
  // digest resta calcolabile e la sua assenza è essa stessa parte di ciò che è firmato
  // (stesso principio già usato per `ipAddress`). Fase 3: la sessione portale e l'hash
  // del documento di riconoscimento del firmatario entrano nel payload.
  const payload = [
    params.clienteId,
    params.signerName,
    params.documentoTitolo,
    params.documentoHash,
    timestampIso,
    ipAddress ?? 'non-registrato',
    params.canaleVerificato,
    sessionId ?? 'non-registrato',
    loginAt ? loginAt.toISOString() : 'non-registrato',
    docRiconoscimentoHash ?? 'non-registrato',
  ].join('|');

  return {
    signatureId: `${PREFISSI_SIGNATURE_ID[valoreLegale]}-${Date.now().toString(36).toUpperCase()}-${crypto.randomBytes(3).toString('hex').toUpperCase()}`,
    signerName: params.signerName,
    documentoTitolo: params.documentoTitolo,
    timestampIso,
    documentoHash: params.documentoHash,
    sha256Digest: crypto.createHash('sha256').update(payload).digest('hex'),
    ipAddress,
    userAgent: params.userAgent && params.userAgent.trim() ? params.userAgent.trim() : null,
    canaleVerificato: params.canaleVerificato,
    standard,
    sessionId,
    loginAt,
    docRiconoscimentoHash,
    docRiconoscimentoTipo: docRiconoscimentoHash ? params.docRiconoscimentoTipo || null : null,
  };
}
