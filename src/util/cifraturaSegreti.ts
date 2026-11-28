/**
 * Cifratura dei segreti che lo studio affida al gestionale e che devono tornare leggibili al
 * server (la password di una casella di posta): AES-256-GCM, chiave derivata da `JWT_SECRET`.
 *
 * Perché non una variabile nuova: una chiave dedicata sarebbe un segreto in più da impostare a
 * mano su ogni ambiente, e finché manca la funzione resta spenta. `JWT_SECRET` c'è già ovunque
 * ed è obbligatorio in produzione (`jwt.ts`); la chiave che se ne ricava è diversa da quella dei
 * token perché passa da un'etichetta propria. È la stessa scelta fatta per il segreto TOTP.
 *
 * Rotazione: quando `JWT_SECRET` cambia, i segreti precedenti restano in `JWT_PREVIOUS_SECRETS`
 * per il periodo di grazia. `decifraSegreto` li prova tutti e dice se il valore va ricifrato con
 * la chiave corrente, così chi lo usa lo riscrive e la rotazione non spegne le caselle.
 */
import crypto from 'node:crypto';

const VERSIONE = 'v1';

/** Chiave di ripiego per sviluppo e test, valida solo per questo processo: niente è persistibile. */
let chiaveDiProcesso: string | null = null;

function materiali(): string[] {
  const corrente = process.env.JWT_SECRET;
  if (!corrente) {
    if (process.env.NODE_ENV === 'production') {
      throw new Error('JWT_SECRET non impostato: i segreti dello studio non si possono cifrare.');
    }
    chiaveDiProcesso ??= crypto.randomBytes(32).toString('hex');
    return [chiaveDiProcesso];
  }
  const precedenti = (process.env.JWT_PREVIOUS_SECRETS ?? '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
  return [corrente, ...precedenti];
}

function chiave(materiale: string, ambito: string): Buffer {
  return crypto.createHash('sha256').update(`bluman-segreti:${ambito}:${materiale}`).digest();
}

/** Cifra `chiaro` per l'ambito dato (es. `casella-posta`). Formato: `v1:` + base64(IV ‖ tag ‖ testo). */
export function cifraSegreto(chiaro: string, ambito: string): string {
  const iv = crypto.randomBytes(12);
  const cifrario = crypto.createCipheriv('aes-256-gcm', chiave(materiali()[0]!, ambito), iv);
  const testo = Buffer.concat([cifrario.update(chiaro, 'utf8'), cifrario.final()]);
  return `${VERSIONE}:${Buffer.concat([iv, cifrario.getAuthTag(), testo]).toString('base64')}`;
}

export interface SegretoDecifrato {
  chiaro: string;
  /** Vero quando ha aperto una chiave precedente: chi legge lo riscrive con `cifraSegreto`. */
  daRicifrare: boolean;
}

/**
 * Riapre un valore prodotto da `cifraSegreto`. Solleva quando nessuna chiave lo apre: chi chiama
 * lo dichiara all'operatore («reinserisci la password»), non lo tratta come un segreto vuoto.
 */
export function decifraSegreto(cifrato: string, ambito: string): SegretoDecifrato {
  const [versione, corpo] = cifrato.split(':');
  if (versione !== VERSIONE || !corpo) throw new Error('Segreto cifrato in un formato non riconosciuto.');
  const blob = Buffer.from(corpo, 'base64');
  if (blob.length < 12 + 16) throw new Error('Segreto cifrato non valido.');
  const iv = blob.subarray(0, 12);
  const tag = blob.subarray(12, 28);
  const testo = blob.subarray(28);

  const candidati = materiali();
  for (let i = 0; i < candidati.length; i++) {
    try {
      const decifrario = crypto.createDecipheriv('aes-256-gcm', chiave(candidati[i]!, ambito), iv);
      decifrario.setAuthTag(tag);
      const chiaro = Buffer.concat([decifrario.update(testo), decifrario.final()]).toString('utf8');
      return { chiaro, daRicifrare: i > 0 };
    } catch {
      // Chiave sbagliata o dato alterato: GCM non distingue. Si prova la successiva.
    }
  }
  throw new Error('Il segreto non si apre con le chiavi di questo ambiente: va reinserito.');
}
