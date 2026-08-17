/**
 * Pure lightweight client-side ZIP archive builder (Zero-dependency)
 * Creates standard PK-ZIP compliant archives in the browser for multi-file downloads.
 */

interface ZipEntry {
  path: string;
  data: Uint8Array;
  isText: boolean;
}

export class SimpleZipBuilder {
  private entries: ZipEntry[] = [];

  /**
   * Aggiunge un file di testo (HTML, TXT, CSV, JSON, ecc.) all'archivio
   */
  addTextFile(path: string, content: string): void {
    const encoder = new TextEncoder();
    this.entries.push({
      path: path.replace(/\\/g, '/'),
      data: encoder.encode(content),
      isText: true,
    });
  }

  /**
   * Aggiunge un file binario (PDF, PNG, JPG, DOCX, ecc.) all'archivio
   */
  addBinaryFile(path: string, data: Uint8Array): void {
    this.entries.push({
      path: path.replace(/\\/g, '/'),
      data,
      isText: false,
    });
  }

  /**
   * Calcola il CRC32 di un buffer di byte
   */
  private computeCrc32(data: Uint8Array): number {
    const table = new Uint32Array(256);
    for (let i = 0; i < 256; i++) {
      let c = i;
      for (let k = 0; k < 8; k++) {
        c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1);
      }
      table[i] = c;
    }

    let crc = 0 ^ (-1);
    for (let i = 0; i < data.length; i++) {
      crc = (crc >>> 8) ^ table[(crc ^ data[i]) & 0xFF];
    }
    return (crc ^ (-1)) >>> 0;
  }

  /**
   * Genera il Blob ZIP finale pronto per il download
   */
  generateZipBlob(): Blob {
    const encoder = new TextEncoder();
    const localHeaders: Uint8Array[] = [];
    const centralDirectoryHeaders: Uint8Array[] = [];
    let offset = 0;

    const now = new Date();
    const dosTime = ((now.getHours() << 11) | (now.getMinutes() << 5) | (now.getSeconds() >> 1)) & 0xFFFF;
    const dosDate = (((now.getFullYear() - 1980) << 9) | ((now.getMonth() + 1) << 5) | now.getDate()) & 0xFFFF;

    for (const entry of this.entries) {
      const pathBytes = encoder.encode(entry.path);
      const dataBytes = entry.data;
      const crc = this.computeCrc32(dataBytes);
      const uncompressedSize = dataBytes.length;
      const compressedSize = uncompressedSize; // Stored (no compression)

      // 1. Local File Header (30 bytes + path + data)
      const localHeader = new Uint8Array(30 + pathBytes.length + dataBytes.length);
      const lv = new DataView(localHeader.buffer);

      lv.setUint32(0, 0x04034b50, true); // Local header signature
      lv.setUint16(4, 20, true);         // Version needed
      lv.setUint16(6, 0x0800, true);     // General purpose bit flag (UTF-8)
      lv.setUint16(8, 0, true);          // Compression method: 0 (Stored)
      lv.setUint16(10, dosTime, true);
      lv.setUint16(12, dosDate, true);
      lv.setUint32(14, crc, true);
      lv.setUint32(18, compressedSize, true);
      lv.setUint32(22, uncompressedSize, true);
      lv.setUint16(26, pathBytes.length, true);
      lv.setUint16(28, 0, true); // Extra field length

      localHeader.set(pathBytes, 30);
      localHeader.set(dataBytes, 30 + pathBytes.length);
      localHeaders.push(localHeader);

      // 2. Central Directory Header (46 bytes + path)
      const cdHeader = new Uint8Array(46 + pathBytes.length);
      const cdv = new DataView(cdHeader.buffer);

      cdv.setUint32(0, 0x02014b50, true); // Central header signature
      cdv.setUint16(4, 20, true);         // Version made by
      cdv.setUint16(6, 20, true);         // Version needed
      cdv.setUint16(8, 0x0800, true);     // Flags (UTF-8)
      cdv.setUint16(10, 0, true);         // Compression: Stored
      cdv.setUint16(12, dosTime, true);
      cdv.setUint16(14, dosDate, true);
      cdv.setUint32(16, crc, true);
      cdv.setUint32(20, compressedSize, true);
      cdv.setUint32(24, uncompressedSize, true);
      cdv.setUint16(28, pathBytes.length, true);
      cdv.setUint16(30, 0, true); // Extra field length
      cdv.setUint16(32, 0, true); // File comment length
      cdv.setUint16(34, 0, true); // Disk number
      cdv.setUint16(36, 0, true); // Internal attributes
      cdv.setUint32(38, 0, true); // External attributes
      cdv.setUint32(42, offset, true); // Relative offset of local header

      cdHeader.set(pathBytes, 46);
      centralDirectoryHeaders.push(cdHeader);

      offset += localHeader.length;
    }

    const cdStartOffset = offset;
    let cdSize = 0;
    for (const h of centralDirectoryHeaders) {
      cdSize += h.length;
    }

    // 3. End of Central Directory Record (22 bytes)
    const eocd = new Uint8Array(22);
    const ev = new DataView(eocd.buffer);
    ev.setUint32(0, 0x06054b50, true); // EOCD signature
    ev.setUint16(4, 0, true);          // Disk number
    ev.setUint16(6, 0, true);          // CD disk number
    ev.setUint16(8, this.entries.length, true);  // Number of CD records on disk
    ev.setUint16(10, this.entries.length, true); // Total number of CD records
    ev.setUint32(12, cdSize, true);              // Size of central directory
    ev.setUint32(16, cdStartOffset, true);       // Offset of CD
    ev.setUint16(20, 0, true);                   // Comment length

    const allParts: Uint8Array[] = [...localHeaders, ...centralDirectoryHeaders, eocd];
    return new Blob(allParts as any, { type: 'application/zip' });
  }

  /**
   * Fa partire il download del file ZIP nel browser
   */
  download(filename: string): void {
    const blob = this.generateZipBlob();
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename.endsWith('.zip') ? filename : `${filename}.zip`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }
}
