/**
 * §35 — la posta che non parte e non arriva: ogni guasto dice cosa fare, e nessuna prova
 * usa la casella di un altro.
 *
 * Le tre righe che lo studio ha letto in produzione, e cosa avevano in comune: nessuna
 * indicava l'intervento.
 *
 *   ❌ Errore SMTP: getaddrinfo ENOTFOUND mail.bluecode-ltd.com
 *   ❌ Errore IMAP: Hostname/IP does not match certificate's altnames:
 *      Host: imap.register.it. is not in the cert's altnames: DNS:*.securemail.pro, DNS:securemail.pro
 *   dalle impostazioni neanche il test passa
 *
 * Il primo è un nome che non esiste nel DNS (campo sbagliato nelle impostazioni: la password
 * non c'entra), il secondo un certificato emesso per un altro nome, il terzo era una prova
 * che percorreva l'SMTP diretto — cioè la strada che la rete di Railway blocca — mentre gli
 * invii veri passavano dal relay e riuscivano. Tre interventi diversi, tre messaggi
 * indistinguibili.
 *
 * Questi test presidiano: la traduzione da errore tecnico a istruzione, il rifiuto esplicito
 * quando la configurazione manca (invece del ripiego su host e utenza cablati, regola 6) e
 * l'assenza di qualunque nome di provider scritto nel codice fuori dai commenti.
 */
import { describe, it, expect, beforeEach, afterAll, vi } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, extname, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { diagnosiPosta, spiegaErrorePosta } from './services/diagnosiPosta.js';

const RADICE = resolve(dirname(fileURLToPath(import.meta.url)), '..');

/** Il messaggio di Node, verbatim da quello che ha letto l'operatore. */
const ERRORE_CERT_IMAP =
  "Hostname/IP does not match certificate's altnames: Host: imap.register.it. is not in " +
  "the cert's altnames: DNS:*.securemail.pro, DNS:securemail.pro";

/** Lo stesso guasto sull'SMTP, con il certificato che il provider presenta sulla 465. */
const ERRORE_CERT_SMTP =
  "Hostname/IP does not match certificate's altnames: Host: authsmtp.register.it. is not in " +
  "the cert's altnames: DNS:smtp.mail.webnode.com, DNS:*.securemail.pro, DNS:smtp.webnode.com";

describe('§35 — diagnosiPosta traduce l\'errore di rete in un intervento', () => {
  it('nome che non esiste nel DNS: lo dice, e dice che non è la password', () => {
    const d = diagnosiPosta({
      protocollo: 'SMTP',
      host: 'mail.bluecode-ltd.com',
      porta: 465,
      codice: 'ENOTFOUND',
      messaggio: 'getaddrinfo ENOTFOUND mail.bluecode-ltd.com',
    });

    expect(d.causa).toBe('nome-inesistente');
    expect(d.rimedio).toMatch(/non esiste nel DNS/i);
    expect(d.rimedio).toMatch(/password/i); // per escluderla, non per sospettarla
    expect(d.rimedio).toMatch(/Server SMTP/);
  });

  it('certificato per un altro nome: elenca i nomi veri e propone quello coerente', () => {
    const d = diagnosiPosta({
      protocollo: 'IMAP',
      host: 'imap.register.it',
      porta: 993,
      codice: 'ERR_TLS_CERT_ALTNAME_INVALID',
      messaggio: ERRORE_CERT_IMAP,
    });

    expect(d.causa).toBe('certificato-altro-nome');
    expect(d.nomiDelCertificato).toEqual(['*.securemail.pro', 'securemail.pro']);
    // La prima etichetta resta `imap`: è quella che dice a quale servizio si sta parlando.
    expect(d.hostSuggerito).toBe('imap.securemail.pro');
    expect(d.rimedio).toContain('imap.securemail.pro');
    expect(d.rimedio).toMatch(/Server posta in arrivo/);
    // §3.4 — la via d'uscita non è spegnere la verifica: la password della casella passa da lì.
    expect(d.rimedio).toMatch(/non disattivare la verifica/i);
  });

  it('il punto finale del nome DNS non manda in confusione il confronto', () => {
    // Node scrive `Host: imap.register.it.`: senza normalizzare, il nome proposto sarebbe
    // `imap.securemail.pro` confrontato con `imap.register.it.` e la proposta uscirebbe
    // comunque, ma su un host con il punto finale configurato a mano no.
    const d = diagnosiPosta({ protocollo: 'IMAP', host: 'imap.register.it.', messaggio: ERRORE_CERT_IMAP });
    expect(d.hostSuggerito).toBe('imap.securemail.pro');
  });

  it('sull\'SMTP la proposta conserva l\'etichetta `authsmtp`', () => {
    const d = diagnosiPosta({
      protocollo: 'SMTP',
      host: 'authsmtp.register.it',
      porta: 465,
      messaggio: ERRORE_CERT_SMTP,
    });

    expect(d.causa).toBe('certificato-altro-nome');
    expect(d.hostSuggerito).toBe('authsmtp.securemail.pro');
    expect(d.nomiDelCertificato).toContain('smtp.mail.webnode.com');
  });

  it('senza un nome utilizzabile nel certificato non ne inventa uno', () => {
    const d = diagnosiPosta({
      protocollo: 'SMTP',
      host: 'posta.studio.example',
      messaggio:
        "Hostname/IP does not match certificate's altnames: Host: posta.studio.example. is not " +
        "in the cert's altnames: DNS:altro.esempio.test",
    });

    expect(d.causa).toBe('certificato-altro-nome');
    expect(d.hostSuggerito).toBeUndefined();
    expect(d.rimedio).toMatch(/chiedi al provider/i);
  });

  it('porta che non risponde: nomina il blocco dell\'hosting e il relay', () => {
    const d = diagnosiPosta({
      protocollo: 'SMTP',
      host: 'smtp.studio.example',
      porta: 465,
      codice: 'ETIMEDOUT',
      messaggio: 'Connection timeout',
    });

    expect(d.causa).toBe('porta-non-raggiungibile');
    expect(d.rimedio).toMatch(/porta 465/);
    expect(d.rimedio).toMatch(/send-email/);
  });

  it('credenziali rifiutate: il nome del server è giusto, la password no', () => {
    const d = diagnosiPosta({
      protocollo: 'SMTP',
      host: 'smtp.studio.example',
      codice: 'EAUTH',
      messaggio: '535 Authentication failed',
    });

    expect(d.causa).toBe('credenziali-rifiutate');
    expect(d.rimedio).toMatch(/rifiuta utenza e password/i);
  });

  it('rifiuto del LOGIN IMAP: riconosciuto come credenziali, non come rete', () => {
    const d = diagnosiPosta({
      protocollo: 'IMAP',
      host: 'imap.studio.example',
      messaggio: 'A01 NO: imap.studio.example ha rifiutato utenza o password (A01 NO Login failed)',
    });
    expect(d.causa).toBe('credenziali-rifiutate');
  });

  it('certificato scaduto o autofirmato: eccezione dichiarata, non silenziosa', () => {
    const d = diagnosiPosta({
      protocollo: 'IMAP',
      host: 'posta.interna.studio',
      codice: 'DEPTH_ZERO_SELF_SIGNED_CERT',
      messaggio: 'self-signed certificate',
    });

    expect(d.causa).toBe('certificato-non-fidato');
    expect(d.rimedio).toMatch(/SMTP_INSECURE_TLS=1/);
  });

  it('messaggio non riconoscibile: nessuna causa inventata', () => {
    const d = diagnosiPosta({ protocollo: 'SMTP', host: 'smtp.studio.example', messaggio: 'qualcosa è andato storto' });
    expect(d.causa).toBe('ignota');
  });

  it('la stringa composta da inviaEmail: vince la causa su cui si può intervenire', () => {
    // Quello che `inviaEmail` mette insieme quando falliscono relay e SMTP diretto: il nome
    // inesistente è la causa comune ai due tentativi, e il timeout ne è la conseguenza.
    const composta =
      'relay: getaddrinfo ENOTFOUND mail.bluecode-ltd.com; nessuna porta utilizzabile verso ' +
      'mail.bluecode-ltd.com (465: ETIMEDOUT — Connection timeout; 587: ETIMEDOUT — Connection timeout)';

    expect(diagnosiPosta({ protocollo: 'SMTP', host: 'mail.bluecode-ltd.com', messaggio: composta }).causa).toBe(
      'nome-inesistente',
    );
  });

  it('un certificato sbagliato non viene scambiato per una porta chiusa', () => {
    // Il relay riporta il certificato, l'SMTP diretto da Railway riporta il timeout delle
    // porte bloccate: l'intervento sta sul primo.
    const composta = `relay: ${ERRORE_CERT_SMTP}; nessuna porta utilizzabile verso authsmtp.register.it (465: ETIMEDOUT — Connection timeout)`;
    const d = diagnosiPosta({ protocollo: 'SMTP', host: 'authsmtp.register.it', messaggio: composta });
    expect(d.causa).toBe('certificato-altro-nome');
    expect(d.hostSuggerito).toBe('authsmtp.securemail.pro');
  });

  it('spiegaErrorePosta mette prima il motivo tecnico e poi l\'istruzione', () => {
    const testo = spiegaErrorePosta({
      protocollo: 'IMAP',
      host: 'imap.register.it',
      porta: 993,
      messaggio: ERRORE_CERT_IMAP,
    });

    // Il tecnico serve al provider e ai log, l'istruzione a chi deve rimettere in funzione la
    // posta: perdere il primo significa non poter più chiedere assistenza.
    expect(testo.startsWith(ERRORE_CERT_IMAP)).toBe(true);
    expect(testo).toContain('imap.securemail.pro');
  });
});

/**
 * Nessun nome di provider nel codice.
 *
 * `verifyAndSendTestSmtp` provava quattordici coppie host/porta, cinque delle quali erano
 * server di terzi (`authsmtp.register.it`, `smtps.register.it`, `mail.register.it`,
 * `mail.bluecode-ltd.com`): le credenziali di uno studio su Gmail o Microsoft 365 venivano
 * offerte a Register.it. Gli stessi nomi comparivano come ripiego in `sendMagicLinkEmail`,
 * `sendClientCredentialsEmail`, nelle due rotte di prova e in due lettori IMAP.
 *
 * Il controllo guarda le posizioni di codice: i commenti che raccontano la correzione devono
 * poter nominare quei server, il codice no.
 */
const CARTELLE_DA_ISPEZIONARE = ['src', 'api'];

/** Server di posta di altri: non devono comparire in nessuna posizione di codice. */
const SERVER_DI_TERZI = ['register.it', 'bluecode-ltd.com', 'securemail.pro'];

/**
 * `bluecode.advisory` è il dominio di chi ha commissionato la piattaforma, e nei dati di
 * esempio (`seedFull.ts`) o come attore di sistema nell'audit è al suo posto. Nei moduli della
 * posta no: lì era il mittente cablato («BlueCode Advisory») che i clienti di ogni altro studio
 * vedevano nelle email ricevute.
 */
const MODULI_DELLA_POSTA = [
  'src/services/emailService.ts',
  'src/services/emailRelay.ts',
  'src/services/imapInbound.ts',
  'src/services/diagnosiPosta.ts',
  'api/send-email.ts',
];

/**
 * Toglie commenti di riga e di blocco, lasciando intatte le stringhe.
 *
 * Riconosce anche i letterali regex: `replace(/([\\"])/g, …)` in `emailService.ts` contiene una
 * virgoletta, e senza questo passaggio la scansione la prendeva per l'inizio di una stringa —
 * da lì in poi i commenti risultavano codice e il controllo segnalava le proprie spiegazioni.
 */
function soloCodice(sorgente: string): string {
  let fuori = '';
  let i = 0;
  let apice: string | null = null;
  /** Ultimo carattere significativo di codice: dice se una `/` apre una regex o divide. */
  let precedente = '';

  while (i < sorgente.length) {
    const c = sorgente[i];
    const d = sorgente[i + 1];

    if (apice) {
      if (c === '\\') {
        fuori += c + (d ?? '');
        i += 2;
        continue;
      }
      if (c === apice) apice = null;
      fuori += c;
      i += 1;
      continue;
    }

    if (c === "'" || c === '"' || c === '`') {
      apice = c;
      precedente = c;
      fuori += c;
      i += 1;
      continue;
    }

    if (c === '/' && d === '/') {
      while (i < sorgente.length && sorgente[i] !== '\n') i += 1;
      continue;
    }

    if (c === '/' && d === '*') {
      i += 2;
      while (i < sorgente.length && !(sorgente[i] === '*' && sorgente[i + 1] === '/')) i += 1;
      i += 2;
      continue;
    }

    if (c === '/' && (precedente === '' || '(,=:[!&|?{};+-*%^<>~'.includes(precedente))) {
      i += 1;
      let dentroClasse = false;
      while (i < sorgente.length) {
        const r = sorgente[i];
        if (r === '\\') {
          i += 2;
          continue;
        }
        if (r === '\n') break;
        if (r === '[') dentroClasse = true;
        else if (r === ']') dentroClasse = false;
        else if (r === '/' && !dentroClasse) {
          i += 1;
          break;
        }
        i += 1;
      }
      precedente = '/';
      continue;
    }

    fuori += c;
    if (c && !/\s/.test(c)) precedente = c;
    i += 1;
  }

  return fuori;
}

function fileDaIspezionare(cartella: string, raccolti: string[] = []): string[] {
  for (const voce of readdirSync(cartella)) {
    if (voce === 'node_modules' || voce === 'dist' || voce === '.git') continue;
    const percorso = join(cartella, voce);
    if (statSync(percorso).isDirectory()) {
      fileDaIspezionare(percorso, raccolti);
      continue;
    }
    if (!['.ts', '.tsx', '.js', '.mjs'].includes(extname(voce))) continue;
    if (voce.endsWith('.test.ts') || voce.endsWith('.test.tsx')) continue;
    raccolti.push(percorso);
  }
  return raccolti;
}

describe('§35 — nessun server di posta di terzi scritto nel codice', () => {
  it('src/ e api/ non contengono nomi di provider fuori dai commenti', () => {
    const colpevoli: string[] = [];

    for (const cartella of CARTELLE_DA_ISPEZIONARE) {
      for (const file of fileDaIspezionare(join(RADICE, cartella))) {
        const codice = soloCodice(readFileSync(file, 'utf8'));
        for (const nome of SERVER_DI_TERZI) {
          if (codice.includes(nome)) {
            colpevoli.push(`${file.replace(RADICE + '/', '')} contiene «${nome}»`);
          }
        }
      }
    }

    expect(colpevoli).toEqual([]);
  });

  it('i moduli della posta non cablano il mittente di uno studio in particolare', () => {
    const colpevoli: string[] = [];

    for (const relativo of MODULI_DELLA_POSTA) {
      const codice = soloCodice(readFileSync(join(RADICE, relativo), 'utf8'));
      if (codice.includes('bluecode.advisory') || /BlueCode|BLUECODE/.test(codice)) {
        colpevoli.push(relativo);
      }
    }

    expect(colpevoli).toEqual([]);
  });
});
