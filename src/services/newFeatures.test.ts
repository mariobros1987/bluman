import { describe, it, expect } from 'vitest';
import {
  creaSigilloFea,
  mascheraRecapito,
  descriviCanaleVerificato,
  canaleValido,
  CANALI_OTP,
} from './otpService.js';
import { hashCodiceOtp, verificaCodiceOtp } from '../util/jwt.js';
import { scanFileBuffer } from './securityScanner.js';
import { preparaFatturaPerInvioManuale } from './sdiService.js';
import { runDailyNotificationCron } from './cronService.js';

describe('🧪 Nuove Funzionalità Enterprise — Test Suite di Collaudo', () => {

  // ── 1. TEST SERVIZIO OTP & SIGILLO FEA eIDAS ────────────────────────────
  //
  // `creaOtp` e `verificaOtp` non sono qui: scrivono su `codice_otp`, e provarli senza
  // database vorrebbe dire reintrodurre lo store in memoria che era il guasto da riparare.
  // Restano coperte le parti pure, che sono quelle dove un errore diventa un verbale falso.
  describe('🔐 OTP Service & Sigillo eIDAS FEA', () => {
    it('non offre canali che il server non sa spedire', () => {
      // Il canale SMS era nell'interfaccia e nel tipo senza nessun provider dietro:
      // sceglierlo produceva un codice mai consegnato e una firma impossibile da chiudere.
      //
      // `signal` è in elenco per la ragione opposta, e va tenuto tale: è stato aggiunto solo
      // dopo che `inviaCodiceOtp` ha avuto un ramo vero che parla col demone dello studio
      // (`signalService.ts`) e dopo che `canaliDisponibili` ha saputo dire quando è spento.
      // Se un giorno quel ramo sparisse lasciando la voce in elenco, questo test non se ne
      // accorgerebbe — lo presidia `signalService.test.ts`, che verifica il rifiuto motivato.
      expect(CANALI_OTP).toEqual(['whatsapp', 'email', 'telegram', 'signal']);
      expect(canaleValido('sms')).toBe(false);
      expect(canaleValido('whatsapp')).toBe(true);
      expect(canaleValido('signal')).toBe(true);
      expect(canaleValido('')).toBe(false);
      expect(canaleValido(undefined)).toBe(false);
    });

    it('lega il digest del codice al cliente e non lo rende ricostruibile senza segreto', () => {
      const perUno = hashCodiceOtp('123456', 'cli-test-01');
      const perAltro = hashCodiceOtp('123456', 'cli-test-02');

      // Stesso codice, clienti diversi: digest diversi. Un valore intercettato su una riga
      // non è riutilizzabile su un'altra.
      expect(perUno).not.toBe(perAltro);
      expect(perUno).toHaveLength(64);
      // Non è lo SHA-256 nudo del codice: sei cifre sotto un hash veloce sono un milione
      // di voci precalcolabili da chiunque legga il database.
      expect(perUno).not.toBe('8d969eef6ecad3c29a3a629280e686cf0c3f5d5a86aff3ca12020c923adc6c92');
    });

    it('accetta solo il codice corretto, a tempo costante', () => {
      const atteso = hashCodiceOtp('654321', 'cli-test-03');
      expect(verificaCodiceOtp('654321', 'cli-test-03', atteso)).toBe(true);
      expect(verificaCodiceOtp('654322', 'cli-test-03', atteso)).toBe(false);
      // Codice giusto, cliente sbagliato: non passa.
      expect(verificaCodiceOtp('654321', 'cli-test-04', atteso)).toBe(false);
      // Digest di lunghezza diversa: rifiutato senza far esplodere il confronto.
      expect(verificaCodiceOtp('654321', 'cli-test-03', 'abc')).toBe(false);
    });

    it('maschera i recapiti nelle risposte al browser', () => {
      const mascherata = mascheraRecapito('mario.rossi@example.com');
      expect(mascherata).not.toContain('rio.rossi');
      expect(mascherata).toContain('@example.com');
      expect(mascheraRecapito('+39 000 0000000')).not.toContain('0000000');
    });

    it('genera un sigillo eIDAS con impronta SHA-256 valida', () => {
      const seal = creaSigilloFea({
        clienteId: 'cli-test-04',
        signerName: 'Roberto Rossi (CEO)',
        documentoTitolo: "Lettera d'Incarico Professionale",
        documentoHash: 'a'.repeat(64),
        ip: '192.168.1.100',
        userAgent: 'Mozilla/5.0 Mac',
        canaleVerificato: 'Codice OTP monouso consegnato via email a ma***i@example.com',
      });

      // Senza `valoreLegale` esplicito il sigillo è SES: il prefisso e lo standard
      // dichiarano il valore probatorio reale (art. 20 CAD), mai "avanzato".
      expect(seal.signatureId).toContain('SIGILLO-SES-');
      expect(seal.signerName).toBe('Roberto Rossi (CEO)');
      expect(seal.sha256Digest).toHaveLength(64);
      expect(seal.standard).toContain('eIDAS UE 910/2014');
      expect(seal.standard).not.toMatch(/avanzata|advanced/i);
      // Il canale dichiarato è quello usato davvero: prima il sigillo scriveva
      // "OTP SMS/WhatsApp + Token Crittografico" qualunque fosse il canale.
      expect(seal.canaleVerificato).toContain('email');
    });

    it('registra l\'assenza dell\'IP come assenza, non come 127.0.0.1', () => {
      const senzaIp = creaSigilloFea({
        clienteId: 'cli-test-05',
        signerName: 'Anna Bianchi',
        documentoTitolo: 'Addendum',
        documentoHash: 'b'.repeat(64),
        canaleVerificato: 'Codice OTP monouso consegnato via WhatsApp a +39***123',
      });

      // Nessun firmatario si collega dal loopback del server: quel valore in un verbale
      // probatorio era un dato falso, e sembrava una prova.
      expect(senzaIp.ipAddress).toBeNull();
      expect(senzaIp.userAgent).toBeNull();
      // L'impronta resta calcolabile: l'assenza è essa stessa parte di ciò che è firmato.
      expect(senzaIp.sha256Digest).toHaveLength(64);
    });

    it('mette a verbale il recapito dichiarato quando è diverso da quello in anagrafica', () => {
      const daAnagrafica = descriviCanaleVerificato({
        canale: 'whatsapp',
        target: '+39 111 1111111',
        targetDichiarato: false,
        targetAnagrafica: '+39 111 1111111',
      });
      expect(daAnagrafica).toContain('anagrafica');
      expect(daAnagrafica).not.toContain('dichiarato');

      const dichiarato = descriviCanaleVerificato({
        canale: 'whatsapp',
        target: '+39 222 2222222',
        targetDichiarato: true,
        targetAnagrafica: '+39 111 1111111',
      });
      // Chi possiede il magic link può dirottare il codice su un recapito proprio: la cosa
      // indebolisce il legame fra codice e persona, e va scritta nel sigillo, non taciuta.
      expect(dichiarato).toContain('dichiarato dal firmatario');
      expect(dichiarato).toContain('diverso da quello in anagrafica');
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

  // ── 3. TEST PREPARAZIONE INVIO MANUALE SDI (§3.5) ────────────────────────
  describe('📦 Preparazione invio manuale SdI (nessun provider collegato)', () => {
    it('restituisce un riferimento LOCALE di preparazione e non dichiara trasmissioni false', async () => {
      const result = await preparaFatturaPerInvioManuale({
        fatturaId: 'inv-test-101',
        numeroProgressivo: 'FT-2026-001',
      });

      expect(result.ok).toBe(true);
      expect(result.riferimentoPreparazione).toMatch(/^PREP-\d{4}-[A-Z0-9]+$/);
      expect(result.message).toContain('pronta per l\'invio manuale');
      // La vecchia versione dichiarava «trasmessa con successo» senza alcun provider:
      // il messaggio non deve più contenere affermazioni di invio allo SdI.
      expect(result.message).toContain('NON ha inviato nulla');
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
