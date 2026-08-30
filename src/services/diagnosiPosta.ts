/**
 * §35 — da errore di rete a istruzione per il titolare dello studio.
 *
 * Le tre righe che l'operatore ha letto in produzione, verbatim:
 *
 *   ❌ Errore SMTP: getaddrinfo ENOTFOUND mail.bluecode-ltd.com
 *   ❌ Errore IMAP: Hostname/IP does not match certificate's altnames:
 *      Host: imap.register.it. is not in the cert's altnames: DNS:*.securemail.pro, DNS:securemail.pro
 *   ❌ Errore socket IMAP (imap.register.it:993): …
 *
 * Sono tre guasti diversi che chiedono tre interventi diversi — un nome sbagliato nelle
 * impostazioni dello studio, un nome che non coincide con il certificato del provider, una
 * porta chiusa dall'hosting — e nessuna delle tre righe lo dice. Chi le legge conclude «la
 * posta è rotta» e prova a cambiare la password, che è l'unica cosa che non c'entra.
 *
 * Questo file non tenta connessioni: traduce. Sta separato dai due servizi che lo usano
 * (`emailRelay`, `emailService`, `imapInbound`) perché il difetto era proprio la diagnosi
 * duplicata a metà, diversa fra posta in uscita e posta in arrivo.
 *
 * Quello che NON fa, per scelta: non propone di disattivare la verifica dei certificati. Un
 * certificato che non corrisponde al nome è indistinguibile da un intercettatore, e la
 * password della casella viaggia in quella connessione (§3.4).
 */

export type CausaPosta =
  /** Il nome non esiste nel DNS: è il campo «Server» delle impostazioni a essere sbagliato. */
  | 'nome-inesistente'
  /** Il server risponde, ma con un certificato emesso per altri nomi. */
  | 'certificato-altro-nome'
  /** Certificato scaduto o non firmato da una CA pubblica (tipico dei server interni). */
  | 'certificato-non-fidato'
  /** Nessuna risposta sulla porta: l'hosting la blocca in uscita, o il server non la espone. */
  | 'porta-non-raggiungibile'
  /** Il server ha risposto e ha rifiutato utenza o password. */
  | 'credenziali-rifiutate'
  /** Niente di riconoscibile: il messaggio tecnico resta l'unica informazione. */
  | 'ignota';

export interface DiagnosiPosta {
  causa: CausaPosta;
  /** Cosa fare, e dove: impostazioni dello studio, hosting, pannello del provider. */
  rimedio: string;
  /** I nomi che il certificato copre davvero, quando l'errore li elenca. */
  nomiDelCertificato?: string[];
  /** Nome coerente col certificato, con la stessa funzione dell'host configurato. */
  hostSuggerito?: string;
  /**
   * Nome da dichiarare nel campo «Nome nel certificato» tenendo l'host così com'è.
   *
   * È la seconda strada, e per la posta in arrivo di register.it è l'unica: `imap.register.it`
   * risolve ma presenta `*.securemail.pro`, mentre `imap.securemail.pro` è coperto dal
   * certificato e non ha record DNS. Nessun singolo valore nel campo «Server» soddisfa insieme
   * DNS e certificato, quindi i due nomi vanno separati invece di scegliere quale sacrificare.
   */
  nomeCertificatoSuggerito?: string;
}

function normalizzaNome(valore: string): string {
  // Node scrive l'host con il punto finale della radice DNS (`imap.register.it.`): senza
  // toglierlo il confronto con i nomi del certificato non tornerebbe mai.
  return valore.trim().toLowerCase().replace(/\.+$/, '');
}

function primaEtichetta(host: string): string {
  return host.split('.')[0] || host;
}

/** I nomi elencati dal messaggio di Node dopo l'ultimo «altnames:». */
function nomiDalMessaggio(messaggio: string): string[] {
  const coda = messaggio.split(/altnames:\s*/i).pop() ?? '';
  const trovati = coda.match(/DNS:[^\s,;]+/gi) ?? [];
  return [...new Set(trovati.map(v => normalizzaNome(v.slice(4))).filter(Boolean))];
}

/**
 * Il nome da scrivere nelle impostazioni al posto di quello configurato.
 *
 * Il caso reale: `imap.register.it` presenta un certificato per `*.securemail.pro`, e
 * `authsmtp.register.it` uno per `smtp.mail.webnode.com, *.securemail.pro, …`. La proposta
 * conserva la prima etichetta — `imap` resta `imap`, `smtp` resta `smtp` — perché è quella
 * che dice a quale servizio ci si sta collegando, e cambia il dominio con quello del
 * certificato. Resta una proposta: che il nome sia anche pubblicato nel DNS lo sa solo il
 * provider, e il rimedio lo dice esplicitamente.
 */
function hostCoerente(host: string, nomi: string[]): string | undefined {
  const configurato = normalizzaNome(host);
  if (!configurato || nomi.length === 0) return undefined;
  const etichetta = primaEtichetta(configurato);

  const esatto = nomi.find(n => !n.startsWith('*.') && primaEtichetta(n) === etichetta);
  if (esatto && esatto !== configurato) return esatto;

  const jolly = nomi.find(n => n.startsWith('*.'));
  if (jolly) {
    const proposto = `${etichetta}.${jolly.slice(2)}`;
    if (proposto !== configurato) return proposto;
  }

  return undefined;
}

export interface ContestoErrorePosta {
  protocollo: 'SMTP' | 'IMAP';
  host?: string;
  porta?: number;
  /** Messaggio tecnico così com'è arrivato: da nodemailer, dal socket TLS o dal relay. */
  messaggio?: string;
  /** `err.code`, quando chi chiama lo ha. Il riconoscimento funziona anche senza. */
  codice?: string;
}

/**
 * Riconosce la causa dal testo.
 *
 * Il testo e non solo `err.code`, perché metà dei guasti arriva di seconda mano: il relay su
 * Vercel restituisce il `message` di nodemailer dentro un JSON, e `inviaEmail` compone la
 * stringa dei due tentativi. In quei casi il codice non c'è più e la sottostringa sì.
 */
export function diagnosiPosta(contesto: ContestoErrorePosta): DiagnosiPosta {
  const testo = `${contesto.codice || ''} ${contesto.messaggio || ''}`;
  const minuscolo = testo.toLowerCase();
  const host = normalizzaNome(contesto.host || '');
  const dove = host || 'il server configurato';
  // I nomi sono quelli che l'operatore legge in Impostazioni → Canali, verbatim dalle `<label>`
  // di `TabChannels.tsx`. Un rimedio che nomina un campo con parole proprie («Server posta in
  // arrivo (IMAP)») costringe chi legge a indovinare quale sia fra quelli del modulo, e il senso
  // di questo file è che non debba indovinare niente.
  const campo = contesto.protocollo === 'IMAP' ? 'Host Server Posta in Entrata' : 'Host Server SMTP';

  if (/enotfound|eai_again|getaddrinfo|dns lookup/i.test(testo)) {
    return {
      causa: 'nome-inesistente',
      rimedio:
        `il nome «${dove}» non esiste nel DNS: nessun server risponde a quell'indirizzo, quindi ` +
        `non è una questione di password. Correggi il campo «${campo}» nelle impostazioni dello ` +
        `studio con il nome che il provider della casella pubblica nel suo pannello. ` +
        // Il caso non è teorico: è quello che accade seguendo la prima strada suggerita
        // dall'errore di certificato quando il nome coerente non è pubblicato nel DNS.
        `Se «${dove}» è il nome che il certificato attesta ma il provider non lo pubblica, non va ` +
        `qui: rimetti nel campo «${campo}» l'indirizzo che risolve e scrivi «${dove}» nel campo ` +
        `«Nome nel certificato».`,
    };
  }

  if (/err_tls_cert_altname_invalid|altnames|does not match certificate/i.test(testo)) {
    const nomiDelCertificato = nomiDalMessaggio(contesto.messaggio || '');
    const hostSuggerito = hostCoerente(host, nomiDelCertificato);
    const elenco = nomiDelCertificato.length ? nomiDelCertificato.join(', ') : 'altri nomi';
    // Lo stesso nome serve alle due strade: come host, se il provider lo pubblica nel DNS;
    // come nome dichiarato, quando non lo pubblica. Nel secondo caso non serve che risolva —
    // ci si collega all'host configurato e si verifica il certificato contro questo nome.
    const nomeCertificatoSuggerito = hostSuggerito;
    return {
      causa: 'certificato-altro-nome',
      nomiDelCertificato: nomiDelCertificato.length ? nomiDelCertificato : undefined,
      hostSuggerito,
      nomeCertificatoSuggerito,
      rimedio:
        `«${dove}» risponde presentando un certificato valido per ${elenco}: la connessione viene ` +
        `interrotta perché non c'è modo di verificare di stare parlando col server giusto, e la ` +
        `password della casella passerebbe da lì. ` +
        (hostSuggerito
          ? `Due strade, in quest'ordine: (1) scrivi «${hostSuggerito}» nel campo «${campo}», che è ` +
            `il nome coerente col certificato — se il provider lo pubblica nel DNS finisce qui; ` +
            `(2) se rispondesse che quel nome non esiste, lascia «${dove}» nel campo «${campo}» e ` +
            `scrivi «${hostSuggerito}» nel campo «Nome nel certificato»: la connessione va ` +
            `all'indirizzo che risolve e il certificato resta verificato, contro il nome che ` +
            `attesta davvero. Non disattivare la verifica.`
          : `Chiedi al provider due cose: il nome a cui collegarsi e il nome intestato al ` +
            `certificato. Il primo va nel campo «${campo}», il secondo — solo se diverso — nel ` +
            `campo «Nome nel certificato».`),
    };
  }

  if (/depth_zero_self_signed|self_signed_cert_in_chain|unable_to_verify_leaf|cert_has_expired|certificate has expired|self.signed certificate/i.test(testo)) {
    return {
      causa: 'certificato-non-fidato',
      rimedio:
        `«${dove}» presenta un certificato scaduto o non firmato da un'autorità pubblica. Se è il ` +
        `server di posta interno dello studio l'eccezione si dichiara sull'hosting con ` +
        `SMTP_INSECURE_TLS=1, sapendo che da quel momento nessun certificato viene più verificato; ` +
        `se è il server di un provider, è il provider che deve rinnovarlo.`,
    };
  }

  if (/etimedout|esockettimedout|econnrefused|ehostunreach|enetunreach|econnreset|epipe|timeout|timed out/i.test(minuscolo)) {
    const porta = contesto.porta ? `la porta ${contesto.porta}` : 'la porta di posta';
    return {
      causa: 'porta-non-raggiungibile',
      rimedio:
        `${porta} verso «${dove}» non ha risposto. Le porte di posta sono chiuse in uscita sulla rete ` +
        `di Railway — è la ragione per cui la posta passa dalla funzione /api/send-email su Vercel — ` +
        `quindi questo messaggio da solo non significa che la configurazione sia sbagliata. Se compare ` +
        `anche nel tentativo via relay, allora è il server del provider a non esporre quella porta.`,
    };
  }

  if (/eauth|\b535\b|\b534\b|\b538\b|invalid login|authentication fail|auth.*(failed|rifiutat)|a01 no|a01 bad|login failed/i.test(minuscolo)) {
    return {
      causa: 'credenziali-rifiutate',
      rimedio:
        `«${dove}» risponde ma rifiuta utenza e password: il nome del server è giusto, le credenziali ` +
        `no. Vanno inserite quelle della casella di posta — non quelle di accesso al gestionale — e ` +
        `alcuni provider chiedono una password dedicata alle applicazioni.`,
    };
  }

  return {
    causa: 'ignota',
    rimedio:
      `il server «${dove}» ha interrotto la connessione con un messaggio che non corrisponde a nessuna ` +
      `causa nota: riporta la riga qui sopra al provider della casella.`,
  };
}

/**
 * Il messaggio tecnico seguito dall'istruzione. In questo ordine: il primo serve a chi
 * legge i log e al provider, il secondo a chi deve rimettere in funzione la posta.
 */
export function spiegaErrorePosta(contesto: ContestoErrorePosta): string {
  const tecnico = (contesto.messaggio || '').trim() || contesto.codice || 'errore non specificato';
  const { rimedio } = diagnosiPosta(contesto);
  return `${tecnico} — ${rimedio}`;
}
