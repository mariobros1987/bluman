// Voce 8-bis — come si legge lo stato della copia di sicurezza.
//
// Funzioni pure e niente React: la freschezza è la cosa che si sbaglia più facilmente (un
// confine fra «ore» e «giorni», una soglia, un `null` che diventa «adesso»), e va verificata
// senza montare un componente. Le due schermate che la mostrano — il pannello del super admin e
// il riquadro del titolare — leggono da qui, così non possono dare due pareri diversi sullo
// stesso fatto.

/** Cosa il backup crede di aver fatto (`backup.json`, dallo script del VPS). */
export interface EsitoBackupFile {
  esito: 'ok' | 'fallito' | 'sconosciuto';
  quando: string | null;
  file: string | null;
  byte: number | null;
  copiaOffSite: 'ok' | 'saltata' | 'fallita' | 'sconosciuto';
  dettaglio: string;
}

/** Cosa il monitor ha constatato interrogando il remoto (`verifica.json`). */
export interface EsitoVerificaFile {
  stato: 'ok' | 'fail' | 'unknown';
  quando: string | null;
  /** Età della copia remota **al momento della verifica**, non adesso. */
  ore: number | null;
  file: string | null;
  dettaglio: string;
}

export interface StatoCopia {
  disponibile: boolean;
  copiaConfigurata: boolean;
  backup: EsitoBackupFile;
  verifica: EsitoVerificaFile;
}

const UN_GIORNO_MS = 24 * 60 * 60 * 1000;
const UN_ORA_MS = 60 * 60 * 1000;

/**
 * «adesso», «12 minuti fa», «3 ore fa», «ieri», «5 giorni fa», poi la data.
 *
 * Restituisce `null` quando non c'è una data da leggere: non «adesso». Un istante mancante
 * trasformato in «adesso» è il modo in cui un backup vecchio di due settimane si presenta come
 * fatto ora, ed è esattamente il guasto che questa voce esiste per rendere visibile.
 */
export function formattaFreschezza(quandoIso: string | null | undefined, adessoMs: number = Date.now()): string | null {
  if (!quandoIso) return null;
  const t = Date.parse(quandoIso);
  if (!Number.isFinite(t)) return null;

  const diff = adessoMs - t;
  // Una data nel futuro è un orologio sfasato, non un backup appena fatto: si dice «adesso»
  // invece di scrivere «-2 ore fa».
  if (diff < 60_000) return 'adesso';

  const minuti = Math.floor(diff / 60_000);
  if (minuti < 60) return minuti === 1 ? '1 minuto fa' : `${minuti} minuti fa`;

  const ore = Math.floor(diff / UN_ORA_MS);
  if (ore < 24) return ore === 1 ? '1 ora fa' : `${ore} ore fa`;

  const giorni = Math.floor(diff / UN_GIORNO_MS);
  if (giorni === 1) return 'ieri';
  if (giorni < 30) return `${giorni} giorni fa`;

  return new Date(t).toLocaleDateString('it-IT', { day: '2-digit', month: '2-digit', year: 'numeric' });
}

/** «3 ore fa» da un numero di ore, per il caso in cui l'età è già calcolata (il monitor la
 *  deposita in `verifica.ore`). `null` resta `null`. */
export function formattaOre(ore: number | null | undefined): string | null {
  if (ore === null || ore === undefined || !Number.isFinite(ore)) return null;
  if (ore < 1) return 'meno di un’ora fa';
  const intere = Math.floor(ore);
  if (intere < 24) return intere === 1 ? '1 ora fa' : `${intere} ore fa`;
  const giorni = Math.floor(intere / 24);
  return giorni === 1 ? 'ieri' : `${giorni} giorni fa`;
}

/**
 * Quanto è grave un'età, rispetto a una soglia in ore.
 *
 * Fra metà soglia e la soglia si dice «attenzione» e non «vecchia»: serve a vedere arrivare il
 * problema una notte prima, invece di accorgersene quando è già passato.
 */
export function livelloFreschezza(ore: number | null | undefined, sogliaOre = 30): 'ok' | 'attenzione' | 'vecchia' | 'sconosciuto' {
  if (ore === null || ore === undefined || !Number.isFinite(ore)) return 'sconosciuto';
  if (ore > sogliaOre) return 'vecchia';
  if (ore > sogliaOre / 2) return 'attenzione';
  return 'ok';
}

/**
 * L'età della copia **adesso**, ricavata da una verifica fatta prima.
 *
 * `verifica.ore` è l'età misurata quando il monitor ha guardato il remoto — che può essere
 * mezza giornata fa. Sommare il tempo passato da allora è l'unico conto onesto: prendere `ore`
 * per buono farebbe sembrare fresca una copia che nel frattempo è invecchiata.
 */
export function etaCopiaOre(verifica: EsitoVerificaFile, adessoMs: number = Date.now()): number | null {
  if (verifica.ore === null || !Number.isFinite(verifica.ore)) return null;
  if (!verifica.quando) return null;
  const t = Date.parse(verifica.quando);
  if (!Number.isFinite(t)) return null;
  return verifica.ore + Math.max(0, adessoMs - t) / UN_ORA_MS;
}

export interface SintesiCopia {
  livello: 'ok' | 'attenzione' | 'errore' | 'sconosciuto';
  titolo: string;
  dettaglio: string;
}

/**
 * La frase da mostrare, con la sua gravità. L'ordine dei casi è l'ordine di gravità, e il
 * primo che vale vince: un backup fallito non deve poter essere descritto come «non ancora
 * verificato».
 */
export function sintesiCopia(stato: StatoCopia, adessoMs: number = Date.now()): SintesiCopia {
  if (!stato.disponibile) {
    return {
      livello: 'sconosciuto',
      titolo: 'Copia di sicurezza: non verificabile da qui',
      dettaglio:
        'Questo backend non è quello che esegue i backup, quindi non vede il loro esito. Lo stato si legge dal server di produzione.',
    };
  }

  // 1. Il monitor ha guardato il remoto e la copia non c'è o è vecchia: è il fatto più grave,
  //    perché riguarda la copia che sopravvive al server.
  if (stato.verifica.stato === 'fail') {
    return {
      livello: 'errore',
      titolo: 'La copia fuori dal server non è aggiornata',
      dettaglio: stato.verifica.dettaglio,
    };
  }

  // 2. Il backup locale è fallito: non c'è niente da copiare, qualunque cosa dica il remoto.
  if (stato.backup.esito === 'fallito') {
    return {
      livello: 'errore',
      titolo: 'L’ultimo backup notturno è fallito',
      dettaglio: stato.backup.dettaglio,
    };
  }

  // 3. Il backup c'è ma non è uscito da questa macchina: è il caso che sembra a posto e non lo è.
  if (stato.backup.esito === 'ok' && stato.backup.copiaOffSite === 'fallita') {
    return {
      livello: 'errore',
      titolo: 'Il backup è riuscito ma non è uscito dal server',
      dettaglio: stato.backup.dettaglio,
    };
  }

  // 4. Nessuna copia configurata: non è un guasto, è una cosa che manca. I backup stanno sullo
  //    stesso disco del database e se ne vanno con lui.
  if (!stato.copiaConfigurata) {
    return {
      livello: 'attenzione',
      titolo: 'Copia fuori dal server non configurata',
      dettaglio:
        'I backup si salvano, ma sullo stesso disco del database: se il server si perde, si perdono con lui. La copia off-site si attiva dal pannello del super admin.',
    };
  }

  // 5. Configurata e non ancora verificata: il monitor interroga il remoto una volta al giorno.
  if (stato.verifica.stato === 'unknown') {
    return {
      livello: 'attenzione',
      titolo: 'Copia configurata, verifica non ancora disponibile',
      dettaglio: stato.verifica.dettaglio,
    };
  }

  // 6. Tutto a posto: si dice da quanto, prendendo la misura più recente che esiste.
  const eta = etaCopiaOre(stato.verifica, adessoMs);
  const freschezza = formattaOre(eta) ?? formattaFreschezza(stato.backup.quando, adessoMs);
  return {
    livello: 'ok',
    titolo: freschezza ? `Copia di sicurezza: ultima copia ${freschezza}` : 'Copia di sicurezza: verificata',
    dettaglio: stato.verifica.dettaglio || stato.backup.dettaglio,
  };
}
