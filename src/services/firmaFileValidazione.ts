/**
 * Validazione del file caricato come firma qualificata esterna (`qualificata_esterna`).
 *
 * PERCHÉ ESISTE (audit 21/09/2026): prima la piattaforma marcava `valoreLegale='feq'`
 * fidandosi SOLO della modalità dichiarata dall'utente. Un documento che ESIGE FEQ poteva
 * così essere soddisfatto caricando un PDF qualunque, senza alcuna firma dentro.
 *
 * COSA FA / COSA NON FA — onestà del livello di verifica:
 * - Verifica che il file contenga effettivamente una STRUTTURA di firma digitale: una
 *   firma PAdES incorporata in un PDF, oppure un contenitore PKCS#7/CAdES (.p7m/.p7s).
 *   Alza l'asticella da "qualunque file" a "un file che porta davvero una firma".
 * - NON valida ancora la catena del certificato, la revoca (CRL/OCSP), né lo stato
 *   "qualificato" via EU Trust List. Quella verifica crittografica completa richiede una
 *   libreria/servizio dedicato (es. DSS eIDAS): è un passo successivo documentato in
 *   piano-firma-legale-ses-fea-feq.md. Finché non c'è, il verbale continua a dichiarare
 *   che il certificato non è stato validato dalla piattaforma.
 *
 * Il controllo è volutamente conservativo: una firma qualificata reale (PAdES o CAdES)
 * contiene sempre questi marcatori, quindi non rifiuta firme legittime; un PDF non firmato
 * o un file arbitrario non li contiene e viene respinto.
 */

/** OID PKCS#7 signedData (1.2.840.113549.1.7.2) in DER: 06 09 2A 86 48 86 F7 0D 01 07 02. */
const OID_PKCS7_SIGNED_DATA = Buffer.from([
  0x06, 0x09, 0x2a, 0x86, 0x48, 0x86, 0xf7, 0x0d, 0x01, 0x07, 0x02,
]);

export interface EsitoFirmaFile {
  firmato: boolean;
  /** Formato rilevato quando presente: utile per audit/verbale. */
  formato?: 'PAdES (PDF firmato)' | 'PKCS#7/CAdES' | null;
  /** Motivo del rifiuto, pronto per il messaggio all'utente. */
  motivo?: string;
}

/**
 * Vero se il buffer contiene una struttura di firma digitale riconoscibile.
 * Non solleva mai: su input non decodificabile ritorna semplicemente `firmato: false`.
 */
export function fileContieneFirmaDigitale(buffer: Buffer, filename?: string): EsitoFirmaFile {
  if (!buffer || buffer.length === 0) {
    return { firmato: false, formato: null, motivo: 'File vuoto.' };
  }

  // 1) Contenitore PKCS#7 / CAdES (.p7m, .p7s): cerca l'OID signedData nel DER.
  if (buffer.includes(OID_PKCS7_SIGNED_DATA)) {
    return { firmato: true, formato: 'PKCS#7/CAdES' };
  }

  // 2) PDF firmato (PAdES): un PDF firmato porta sempre un /ByteRange e un dizionario di
  //    firma. Cerchiamo i marcatori come testo latin1 (il PDF è per lo più ASCII).
  const testa = buffer.subarray(0, 5).toString('latin1');
  if (testa.startsWith('%PDF-')) {
    const contenuto = buffer.toString('latin1');
    const haByteRange = contenuto.includes('/ByteRange');
    const haDizionarioFirma =
      /\/Type\s*\/Sig/.test(contenuto) ||
      contenuto.includes('adbe.pkcs7') ||
      contenuto.includes('ETSI.CAdES') ||
      contenuto.includes('ETSI.RFC3161');
    if (haByteRange && haDizionarioFirma) {
      return { firmato: true, formato: 'PAdES (PDF firmato)' };
    }
    return {
      firmato: false,
      formato: null,
      motivo:
        'Il PDF caricato non contiene una firma digitale (PAdES). ' +
        'Firma il documento con il tuo dispositivo/provider di firma qualificata e ricarica il file firmato.',
    };
  }

  // 3) Altri formati: non riconosciamo una struttura di firma.
  const ext = (filename?.split('.').pop() || '').toLowerCase();
  return {
    firmato: false,
    formato: null,
    motivo:
      ext === 'p7m' || ext === 'p7s'
        ? 'Il file .p7m/.p7s non contiene una struttura di firma PKCS#7 valida.'
        : 'Il file caricato non contiene una firma digitale qualificata riconoscibile (PAdES o CAdES/.p7m).',
  };
}
