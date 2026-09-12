// src/scripts/runScheduledBackup.test.ts
// §5.2 — Test suite per il backup periodico cifrato AES-256-GCM.

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import fs from 'fs';
import path from 'path';
import os from 'os';
import crypto from 'crypto';

// Carica le funzioni pure esportate (cifra/decifra/retention) senza eseguire il runner.
// Il runner principale è protetto da `if (import.meta.url === ...)` quindi non parte.
import { cifraBackup, decifraBackup, cancellaVecchiBackup } from './runScheduledBackup.js';

describe('§5.2 — Backup Periodico Cifrato AES-256-GCM', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'bluman-backup-test-'));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('cifra e decifra correttamente un payload JSON', () => {
    const payload = JSON.stringify({
      metadata: { tenantId: 'test-tenant', exportedAt: new Date().toISOString() },
      dati: [1, 2, 3],
    });

    const blob = cifraBackup(payload);
    const recuperato = decifraBackup(blob);

    expect(recuperato).toBe(payload);
  });

  it('ogni cifratura produce un IV diverso (nonce casuale)', () => {
    const payload = '{"test":true}';
    const blob1 = cifraBackup(payload);
    const blob2 = cifraBackup(payload);

    // I primi 12 byte sono l'IV: devono essere diversi
    const iv1 = blob1.subarray(0, 12).toString('hex');
    const iv2 = blob2.subarray(0, 12).toString('hex');
    expect(iv1).not.toBe(iv2);
  });

  it('decifraBackup lancia errore se il blob è corrotto (AuthTag errato)', () => {
    const payload = '{"corrotto":false}';
    const blob = cifraBackup(payload);

    // Modifica un byte nel ciphertext (dopo IV + AuthTag)
    const corrotto = Buffer.from(blob);
    corrotto[28] = (corrotto[28]! ^ 0xff);

    expect(() => decifraBackup(corrotto)).toThrow('Decifratura fallita');
  });

  it('decifraBackup lancia errore se il blob è troppo corto', () => {
    expect(() => decifraBackup(Buffer.alloc(10))).toThrow('Blob cifrato troppo corto');
  });

  it('cancellaVecchiBackup rimuove solo i file .enc più vecchi di N giorni', () => {
    const RETENTION_GIORNI = 14;
    const soglia = Date.now() - RETENTION_GIORNI * 24 * 60 * 60 * 1000;

    // File vecchio (oltre la soglia)
    const fileVecchio = path.join(tmpDir, 'backup_vecchio.enc');
    fs.writeFileSync(fileVecchio, 'dati');
    fs.utimesSync(fileVecchio, new Date(soglia - 1000), new Date(soglia - 1000));

    // File recente (entro la soglia)
    const fileRecente = path.join(tmpDir, 'backup_recente.enc');
    fs.writeFileSync(fileRecente, 'dati');

    // File non .enc (non deve essere toccato)
    const fileJson = path.join(tmpDir, 'backup.json');
    fs.writeFileSync(fileJson, '{}');

    const cancellati = cancellaVecchiBackup(tmpDir, RETENTION_GIORNI);

    expect(cancellati).toContain('backup_vecchio.enc');
    expect(cancellati).not.toContain('backup_recente.enc');
    expect(fs.existsSync(fileVecchio)).toBe(false);
    expect(fs.existsSync(fileRecente)).toBe(true);
    expect(fs.existsSync(fileJson)).toBe(true); // .json intoccato
  });

  it('cancellaVecchiBackup restituisce array vuoto se la cartella non esiste', () => {
    const dirInesistente = path.join(tmpDir, 'non-esiste');
    expect(cancellaVecchiBackup(dirInesistente)).toEqual([]);
  });
});
