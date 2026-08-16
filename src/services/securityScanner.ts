export interface ScanResult {
  safe: boolean;
  detectedMimeType: string;
  fileSize: number;
  reason?: string;
}

/**
 * Verifica la firma binaria dei file (Magic Bytes) per prevenire l'upload di file malevoli o estensioni camuffate
 */
export function scanFileBuffer(buffer: Buffer, originalFilename: string): ScanResult {
  const size = buffer.length;

  if (size === 0) {
    return { safe: false, detectedMimeType: 'empty', fileSize: 0, reason: 'Il file è vuoto (0 byte)' };
  }

  // Limite dimensione massima per singolo documento (30 MB)
  if (size > 30 * 1024 * 1024) {
    return { safe: false, detectedMimeType: 'oversized', fileSize: size, reason: 'Il file supera il limite massimo di 30 MB' };
  }

  // Verifica Magic Bytes
  const hexHeader = buffer.slice(0, 8).toString('hex').toUpperCase();

  // 1. PDF: %PDF (25 50 44 46)
  if (hexHeader.startsWith('25504446')) {
    const rawString = buffer.toString('utf-8', 0, Math.min(buffer.length, 100000));
    // Controllo sicurezza PDF: blocco script eseguibili o azioni JS pericolose
    if (rawString.includes('/JavaScript') || rawString.includes('/Launch') || rawString.includes('/EmbeddedFiles')) {
      return {
        safe: false,
        detectedMimeType: 'application/pdf',
        fileSize: size,
        reason: 'Il documento PDF contiene script o azioni eseguibili incorporate non consentite dalle policy bancarie',
      };
    }

    return { safe: true, detectedMimeType: 'application/pdf', fileSize: size };
  }

  // 2. PNG: 89 50 4E 47 0D 0A 1A 0A
  if (hexHeader.startsWith('89504E47')) {
    return { safe: true, detectedMimeType: 'image/png', fileSize: size };
  }

  // 3. JPEG: FF D8 FF
  if (hexHeader.startsWith('FFD8FF')) {
    return { safe: true, detectedMimeType: 'image/jpeg', fileSize: size };
  }

  // Blocco eseguibili Windows/Linux (.exe, .sh, .bat, .dll)
  if (hexHeader.startsWith('4D5A') || hexHeader.startsWith('7F454C46')) {
    return {
      safe: false,
      detectedMimeType: 'application/x-executable',
      fileSize: size,
      reason: 'I file eseguibili o binari non sono ammessi nel Vault Documentale di Sicurezza',
    };
  }

  return { safe: true, detectedMimeType: 'application/octet-stream', fileSize: size };
}
