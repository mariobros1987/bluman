import path from 'path';

export interface ScanResult {
  safe: boolean;
  detectedMimeType: string;
  fileSize: number;
  reason?: string;
}

const MIME_PER_ESTENSIONE: Record<string, string> = {
  '.pdf': 'application/pdf', '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg',
  '.gif': 'image/gif', '.webp': 'image/webp', '.doc': 'application/msword',
  '.xls': 'application/vnd.ms-excel',
  '.docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  '.xlsx': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  '.zip': 'application/zip', '.p7m': 'application/pkcs7-mime', '.eml': 'message/rfc822',
  '.txt': 'text/plain; charset=utf-8', '.csv': 'text/csv; charset=utf-8',
};
const ESTENSIONI_ATTIVE = new Set(['.html', '.htm', '.svg', '.xml', '.xhtml', '.mhtml', '.js']);

function tipoDaFirma(buffer: Buffer): { mime: string; famiglia: string } | null {
  const hex = buffer.subarray(0, 16).toString('hex').toUpperCase();
  if (hex.startsWith('4D5A') || hex.startsWith('7F454C46')) {
    return { mime: 'application/x-executable', famiglia: 'executable' };
  }
  if (hex.startsWith('25504446')) return { mime: 'application/pdf', famiglia: 'pdf' };
  if (hex.startsWith('89504E470D0A1A0A')) return { mime: 'image/png', famiglia: 'png' };
  if (hex.startsWith('FFD8FF')) return { mime: 'image/jpeg', famiglia: 'jpeg' };
  if (hex.startsWith('474946383761') || hex.startsWith('474946383961')) return { mime: 'image/gif', famiglia: 'gif' };
  if (hex.startsWith('52494646') && buffer.subarray(8, 12).toString('ascii') === 'WEBP') return { mime: 'image/webp', famiglia: 'webp' };
  if (hex.startsWith('504B0304') || hex.startsWith('504B0506') || hex.startsWith('504B0708')) return { mime: 'application/zip', famiglia: 'zip' };
  if (hex.startsWith('D0CF11E0A1B11AE1')) return { mime: 'application/x-ole-storage', famiglia: 'ole' };
  if (hex.startsWith('30')) return { mime: 'application/pkcs7-mime', famiglia: 'asn1' };
  return null;
}

function sembraTestoSicuro(buffer: Buffer): boolean {
  if (buffer.includes(0)) return false;
  const testo = buffer.subarray(0, Math.min(buffer.length, 64 * 1024)).toString('utf8').trimStart();
  const compatto = testo.replace(/[\s\x00-\x1f]+/g, '').toLowerCase();
  return !/^(?:<!doctypehtml|<html|<svg|<script|<\?xml)/.test(compatto) &&
    !/<(?:script|svg|iframe|object|embed|meta|link)\b/i.test(testo);
}

/** Verifica dimensione, contenuto attivo, firma binaria ed estensione dichiarata. */
export function scanFileBuffer(buffer: Buffer, originalFilename: string): ScanResult {
  const size = buffer.length;
  const ext = path.extname(originalFilename).toLowerCase();
  const atteso = MIME_PER_ESTENSIONE[ext];
  if (size === 0) return { safe: false, detectedMimeType: 'empty', fileSize: 0, reason: 'Il file è vuoto (0 byte)' };
  if (size > 30 * 1024 * 1024) return { safe: false, detectedMimeType: 'oversized', fileSize: size, reason: 'Il file supera il limite massimo di 30 MB' };
  if (ESTENSIONI_ATTIVE.has(ext)) return { safe: false, detectedMimeType: 'active-content', fileSize: size, reason: 'HTML, SVG, XML e contenuti web attivi non sono ammessi' };
  if (!atteso) return { safe: false, detectedMimeType: 'unknown', fileSize: size, reason: 'Estensione file non ammessa o non riconosciuta' };

  const firma = tipoDaFirma(buffer);
  const famigliaAttesa = ext === '.pdf' ? 'pdf' : ['.jpg', '.jpeg'].includes(ext) ? 'jpeg' : ext.slice(1);
  const coerente = firma && (
    firma.famiglia === famigliaAttesa ||
    (firma.famiglia === 'zip' && ['.docx', '.xlsx', '.zip'].includes(ext)) ||
    (firma.famiglia === 'ole' && ['.doc', '.xls'].includes(ext)) ||
    (firma.famiglia === 'asn1' && ext === '.p7m')
  );
  if (['.txt', '.csv', '.eml'].includes(ext)) {
    if (!sembraTestoSicuro(buffer)) return { safe: false, detectedMimeType: 'active-content', fileSize: size, reason: 'Il file testuale contiene markup attivo o dati binari' };
    return { safe: true, detectedMimeType: atteso, fileSize: size };
  }
  if (!coerente) return { safe: false, detectedMimeType: firma?.mime ?? 'unknown', fileSize: size, reason: 'Il contenuto del file non corrisponde alla sua estensione' };

  if (ext === '.pdf') {
    const raw = buffer.toString('latin1', 0, Math.min(buffer.length, 100000));
    if (/\/(?:JavaScript|JS|Launch|EmbeddedFiles)\b/i.test(raw)) {
      return { safe: false, detectedMimeType: atteso, fileSize: size, reason: 'Il PDF contiene script o azioni eseguibili incorporate non consentite' };
    }
  }
  return { safe: true, detectedMimeType: atteso, fileSize: size };
}
