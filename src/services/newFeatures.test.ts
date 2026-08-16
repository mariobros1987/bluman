import { describe, it, expect } from 'vitest';
import { generateOtp, verifyOtp, generateEidasSignatureSeal } from './otpService.js';
import { scanFileBuffer } from './securityScanner.js';
import { trasmettiFatturaSdi } from './sdiService.js';
import { runDailyNotificationCron } from './cronService.js';

describe('🧪 Nuove Funzionalità Enterprise — Test Suite di Collaudo', () => {

  // ── 1. TEST SERVIZIO OTP & SIGILLO FEA eIDAS ────────────────────────────
  describe('🔐 OTP Service & Sigillo eIDAS FEA', () => {
    it('genera un codice OTP a 6 cifre valido', () => {
      const otp = generateOtp('cli-test-01', '+39 333 5936278', 'whatsapp');
      expect(otp).toBeDefined();
      expect(otp.length).toBe(6);
      expect(/^\d{6}$/.test(otp)).toBe(true);
    });

    it('valida con successo il codice OTP corretto e ne impedisce il riutilizzo', () => {
      const otp = generateOtp('cli-test-02', '+39 333 5936278', 'whatsapp');
      const verification = verifyOtp('cli-test-02', otp);
      expect(verification.valid).toBe(true);

      // Secondo tentativo con lo stesso codice deve fallire (monouso)
      const secondAttempt = verifyOtp('cli-test-02', otp);
      expect(secondAttempt.valid).toBe(false);
    });

    it('blocca tentativi errati e applica rate-limiting', () => {
      generateOtp('cli-test-03', '+39 333 5936278', 'whatsapp');
      const res1 = verifyOtp('cli-test-03', '000000');
      expect(res1.valid).toBe(false);
      expect(res1.reason).toContain('Tentativo 1 di 3');

      const res2 = verifyOtp('cli-test-03', '000000');
      expect(res2.valid).toBe(false);
      expect(res2.reason).toContain('Tentativo 2 di 3');
    });

    it('genera un sigillo di firma crittografica eIDAS con hash SHA-256 valido', () => {
      const seal = generateEidasSignatureSeal({
        clienteId: 'cli-test-04',
        signerName: 'Roberto Rossi (CEO)',
        documentoTitolo: 'Lettera d\'Incarico Professionale',
        documentoHash: 'abcdef1234567890',
        ip: '192.168.1.100',
        userAgent: 'Mozilla/5.0 Mac',
      });

      expect(seal.signatureId).toContain('EIDAS-FEA-');
      expect(seal.signerName).toBe('Roberto Rossi (CEO)');
      expect(seal.sha256Digest.length).toBe(64); // Lunghezza standard SHA-256 hex
      expect(seal.standard).toContain('eIDAS UE 910/2014');
    });
  });

  // ── 2. TEST SCANNER DI SICUREZZA UPLOAD KYC ─────────────────────────────
  describe('🛡 Security Scanner & Magic Bytes', () => {
    it('riconosce e convalida un documento PDF valido', () => {
      const validPdfBuffer = Buffer.from('%PDF-1.4 test content with legal text');
      const result = scanFileBuffer(validPdfBuffer, 'visura_camerale.pdf');
      expect(result.safe).toBe(true);
      expect(result.detectedMimeType).toBe('application/pdf');
    });

    it('intercetta e blocca PDF contenenti script malevoli incorporati', () => {
      const unsafePdfBuffer = Buffer.from('%PDF-1.4 /JavaScript << /Launch cmd.exe >>');
      const result = scanFileBuffer(unsafePdfBuffer, 'trojan.pdf');
      expect(result.safe).toBe(false);
      expect(result.reason).toContain('script o azioni eseguibili incorporate');
    });

    it('riconosce immagini PNG e JPEG valide', () => {
      const pngBuffer = Buffer.from([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A, 0x00, 0x00]);
      const jpegBuffer = Buffer.from([0xFF, 0xD8, 0xFF, 0xE0, 0x00, 0x10, 0x4A, 0x46, 0x49, 0x46]);

      expect(scanFileBuffer(pngBuffer, 'documento.png').safe).toBe(true);
      expect(scanFileBuffer(jpegBuffer, 'passaporto.jpg').safe).toBe(true);
    });

    it('blocca file eseguibili Windows (.exe MZ header) o Linux (.elf)', () => {
      const exeBuffer = Buffer.from([0x4D, 0x5A, 0x90, 0x00, 0x03, 0x00]);
      const result = scanFileBuffer(exeBuffer, 'documento_falso.pdf');
      expect(result.safe).toBe(false);
      expect(result.detectedMimeType).toBe('application/x-executable');
    });
  });

  // ── 3. TEST TRASMISSIONE SDI 1-CLICK ────────────────────────────────────
  describe('🚀 Connettore SDI Trasmissione Diretta', () => {
    it('genera identificativo SdI conforme e data di trasmissione', async () => {
      const result = await trasmettiFatturaSdi({
        fatturaId: 'inv-test-101',
        numeroProgressivo: 'FT-2026-001',
      });

      expect(result.ok).toBe(true);
      expect(result.statoSdi).toBe('inviata');
      expect(result.identificativoSdi).toMatch(/^SDI-IT-\d{4}-[A-Z0-9]+$/);
      expect(result.message).toContain('trasmessa con successo');
    });
  });

  // ── 4. TEST CRON WORKER SCADENZE & RINNOVI ──────────────────────────────
  describe('⏰ Cron Worker Scadenze & Rinnovi Automatici', () => {
    it('esegue la scansione cron senza errori e restituisce il report completo', async () => {
      const report = await runDailyNotificationCron();
      expect(report).toBeDefined();
      expect(report.timestamp).toBeDefined();
      expect(typeof report.notificheInviate).toBe('number');
      expect(Array.isArray(report.dettagli)).toBe(true);
    });
  });

});
