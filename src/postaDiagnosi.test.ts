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
import { soloCodice } from './util/soloCodice.js';

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
    expect(d.rimedio).toMatch(/Host Server Posta in Entrata/);
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
    expect(d.nomeCertificatoSuggerito).toBeUndefined();
    expect(d.rimedio).toMatch(/chiedi al provider/i);
    // Anche senza proposta la seconda strada va nominata: è quella che risolve il caso in cui il
    // nome del certificato non è raggiungibile.
    expect(d.rimedio).toMatch(/Nome nel certificato/);
  });

  it('certificato per un altro nome: propone le due strade, host oppure nome dichiarato', () => {
    // È il caso misurato: `imap.register.it` risolve ma presenta `*.securemail.pro`, e
    // `imap.securemail.pro` è coperto dal certificato ma non ha record DNS. La prima strada
    // (cambiare l'host) lì non basta, e il rimedio deve dirlo prima che l'operatore ci sbatta.
    const d = diagnosiPosta({ protocollo: 'IMAP', host: 'imap.register.it', porta: 993, messaggio: ERRORE_CERT_IMAP });

    expect(d.hostSuggerito).toBe('imap.securemail.pro');
    // Lo stesso nome serve alle due strade: come host se il provider lo pubblica, come nome
    // dichiarato se non lo pubblica — in quel caso non serve che risolva.
    expect(d.nomeCertificatoSuggerito).toBe('imap.securemail.pro');
    expect(d.rimedio).toMatch(/Nome nel certificato/);
    expect(d.rimedio).toMatch(/Host Server Posta in Entrata/);
    // La seconda strada non è «disattiva la verifica»: il certificato resta verificato (§3.4).
    expect(d.rimedio).toMatch(/certificato resta verificato/i);
    expect(d.rimedio).not.toMatch(/SMTP_INSECURE_TLS/);
  });

  it('nome del certificato che non risolve: rimanda al campo dedicato, non a un altro host', () => {
    // Quello che accade seguendo la prima strada quando il provider non pubblica quel nome:
    // senza questa indicazione l'operatore torna al punto di partenza e alterna i due errori.
    const d = diagnosiPosta({
      protocollo: 'IMAP',
      host: 'imap.securemail.pro',
      porta: 993,
      codice: 'ENOTFOUND',
      messaggio: 'getaddrinfo ENOTFOUND imap.securemail.pro',
    });

    expect(d.causa).toBe('nome-inesistente');
    expect(d.rimedio).toMatch(/Nome nel certificato/);
    expect(d.rimedio).toContain('imap.securemail.pro');
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
 *
 * `frontend/src` è entrato nell'elenco dopo il secondo giro: il modulo Canali proponeva
 * `es. smtp.register.it` e `imap.register.it` come segnaposto e intestava la tabella dei record
 * DNS «per Register.it», con SPF e MX di quel provider e la casella di un solo studio. È il modo
 * in cui quei nomi tornano dentro senza che nessuno li scriva nel backend: l'operatore li copia
 * dal segnaposto. La scansione è insensibile alle maiuscole perché nel testo JSX il nome era
 * scritto «Register.it».
 */
const CARTELLE_DA_ISPEZIONARE = ['src', 'api', 'frontend/src'];

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
 * Toglie commenti di riga e di blocco, lasciando intatte le stringhe: vive in
 * `src/util/soloCodice.ts` perché lo usa anche il presidio dei record DNS.
 */
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
  it('src/, api/ e frontend/src non contengono nomi di provider fuori dai commenti', () => {
    const colpevoli: string[] = [];

    for (const cartella of CARTELLE_DA_ISPEZIONARE) {
      for (const file of fileDaIspezionare(join(RADICE, cartella))) {
        const codice = soloCodice(readFileSync(file, 'utf8')).toLowerCase();
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

/**
 * I campi nominati dal rimedio devono esistere nel modulo con quel nome.
 *
 * Il guasto è stato misurato: il rimedio diceva «correggi il campo "Server posta in arrivo (IMAP)"»
 * mentre la `<label>` del modulo diceva «Host Server Posta in Entrata». Chi leggeva doveva
 * indovinare quale dei campi fosse — e il senso di `diagnosiPosta` è che non si debba indovinare
 * niente. Il controllo lega le due parti: rinominare un campo nell'interfaccia senza aggiornare il
 * rimedio (o viceversa) diventa rosso qui, non un'istruzione che rimanda a un campo inesistente.
 */
describe('§35 — il rimedio nomina i campi come sono scritti nel modulo', () => {
  const MODULO = 'frontend/src/components/settings/TabChannels.tsx';

  /** Le etichette come le legge l'operatore, ricavate dal modulo e non riscritte a mano. */
  const etichette = (() => {
    const sorgente = readFileSync(join(RADICE, MODULO), 'utf8');
    return [...sorgente.matchAll(/<label[^>]*>([^<]+)<\/label>/g)].map(m => (m[1] ?? '').trim());
  })();

  /** Vero se una `<label>` del modulo comincia con il nome che il rimedio ha usato. */
  function esisteCampo(nome: string): boolean {
    return etichette.some(e => e.startsWith(nome));
  }

  it('il modulo espone le etichette che i rimedi citano', () => {
    // Se questa cade, è il modulo che è cambiato: l'elenco qui sotto va riallineato insieme a
    // `campo` in `diagnosiPosta.ts`, non aggirato.
    expect(esisteCampo('Host Server SMTP')).toBe(true);
    expect(esisteCampo('Host Server Posta in Entrata')).toBe(true);
    expect(esisteCampo('Nome nel certificato')).toBe(true);
  });

  it('SMTP: il campo citato dal rimedio è uno dei campi del modulo', () => {
    const d = diagnosiPosta({
      protocollo: 'SMTP',
      host: 'mail.non-esiste.example',
      codice: 'ENOTFOUND',
      messaggio: 'getaddrinfo ENOTFOUND mail.non-esiste.example',
    });

    for (const citato of [...d.rimedio.matchAll(/«([^»]+)»/g)].map(m => m[1] ?? '')) {
      // Le virgolette portano sia nomi di host sia nomi di campo: si controllano solo i secondi,
      // riconosciuti dal fatto che il modulo li espone come etichetta.
      if (/^(Host|Nome|Porta|Password|Username)/.test(citato)) expect(esisteCampo(citato)).toBe(true);
    }
    expect(d.rimedio).toContain('Host Server SMTP');
  });

  it('IMAP: il rimedio del certificato manda su due campi che esistono entrambi', () => {
    const d = diagnosiPosta({ protocollo: 'IMAP', host: 'imap.register.it', porta: 993, messaggio: ERRORE_CERT_IMAP });

    expect(d.rimedio).toContain('Host Server Posta in Entrata');
    expect(d.rimedio).toContain('Nome nel certificato');
    for (const citato of [...d.rimedio.matchAll(/«([^»]+)»/g)].map(m => m[1] ?? '')) {
      if (/^(Host|Nome|Porta|Password|Username)/.test(citato)) expect(esisteCampo(citato)).toBe(true);
    }
  });
});
