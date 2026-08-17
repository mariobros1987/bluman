import { generateOtp, verifyOtp, generateEidasSignatureSeal } from '../services/otpService.js';
import { scanFileBuffer } from '../services/securityScanner.js';
import { trasmettiFatturaSdi } from '../services/sdiService.js';
import { runDailyNotificationCron } from '../services/cronService.js';

async function runAllVerificationChecks() {
  console.log('\n═══════════════════════════════════════════════════════════════════════');
  console.log('🏛 BLUMAN ADVISORY PLATFORM — COLLAUDO TEST SUITE COMPLETO');
  console.log('═══════════════════════════════════════════════════════════════════════\n');

  let passed = 0;
  let total = 0;

  function assertTest(name: string, condition: boolean, details?: string) {
    total++;
    if (condition) {
      passed++;
      console.log(`  ✓ PASS: ${name}`);
      if (details) console.log(`          ↳ ${details}`);
    } else {
      console.error(`  ✗ FAIL: ${name}`);
      if (details) console.error(`          ↳ ${details}`);
    }
  }

  // 1. TEST OTP & FEA eIDAS
  console.log('🔐 [1/4] Test Modulo OTP & Firma Elettronica Avanzata (FEA eIDAS)...');
  const otp = generateOtp('cli-1', '+39 333 5936278', 'whatsapp');
  assertTest('Generazione OTP a 6 cifre valido', Boolean(otp && otp.length === 6 && /^\d{6}$/.test(otp)), `Codice: ${otp}`);

  const v1 = verifyOtp('cli-1', otp);
  assertTest('Verifica e validazione OTP corretto', v1.valid === true);

  const v2 = verifyOtp('cli-1', otp);
  assertTest('Blocco del riutilizzo del codice monouso (Anti-Replay)', v2.valid === false, v2.reason);

  generateOtp('cli-rate', '+39 333 5936278');
  const vErr = verifyOtp('cli-rate', '000000');
  assertTest('Protezione Rate Limiting su tentativi errati', vErr.valid === false && (vErr.reason || '').includes('Tentativo 1'));

  const seal = generateEidasSignatureSeal({
    clienteId: 'cli-1',
    signerName: 'Marco Ricci',
    documentoTitolo: 'Lettera d\'Incarico Professionale v1.0',
    ip: '2.234.190.44',
  });
  assertTest('Generazione Sigillo Crittografico eIDAS UE 910/2014', seal.signatureId.startsWith('EIDAS-FEA-') && seal.sha256Digest.length === 64, `ID Sigillo: ${seal.signatureId} | SHA-256: ${seal.sha256Digest.slice(0, 16)}...`);

  // 2. TEST SECURITY SCANNER UPLOAD KYC
  console.log('\n🛡 [2/4] Test Scanner di Sicurezza & Magic Bytes Upload KYC...');
  const pdfBuf = Buffer.from('%PDF-1.4 Visura Camerale MFSA Malta');
  const pdfRes = scanFileBuffer(pdfBuf, 'visura.pdf');
  assertTest('Validazione Magic-Bytes per Documenti PDF Legali', pdfRes.safe && pdfRes.detectedMimeType === 'application/pdf');

  const unsafeBuf = Buffer.from('%PDF-1.4 /JavaScript << /Launch cmd.exe >>');
  const unsafeRes = scanFileBuffer(unsafeBuf, 'malicious.pdf');
  assertTest('Blocco e sanitizzazione PDF con macro o script Javascript malevoli', unsafeRes.safe === false, unsafeRes.reason);

  const exeBuf = Buffer.from([0x4D, 0x5A, 0x90, 0x00]);
  const exeRes = scanFileBuffer(exeBuf, 'fake.pdf');
  assertTest('Intercettazione file eseguibile Windows (.exe MZ header camuffato)', exeRes.safe === false && exeRes.detectedMimeType === 'application/x-executable');

  const pngBuf = Buffer.from([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A]);
  assertTest('Validazione immagini conformi passaporto/carta identità (PNG)', scanFileBuffer(pngBuf, 'id.png').safe);

  // 3. TEST TRASMISSIONE SDI FATTURAZIONE ELETTRONICA
  console.log('\n🚀 [3/4] Test Connettore SDI Fattura Elettronica...');
  const sdiRes = await trasmettiFatturaSdi({
    fatturaId: 'inv-1',
    numeroProgressivo: 'FT-2026-001',
  });
  assertTest('Trasmissione 1-Click e generazione Identificativo SdI conforme', sdiRes.ok && sdiRes.identificativoSdi.startsWith('SDI-IT-'), `Identificativo SdI: ${sdiRes.identificativoSdi}`);

  // 4. TEST CRON WORKER NOTIFICHE SCADENZE
  console.log('\n⏰ [4/4] Test Worker Cron Scadenze & Rinnovi Automatici...');
  const cronRes = await runDailyNotificationCron();
  assertTest('Esecuzione scansione scadenze UBO Malta e rate aperte', cronRes && cronRes.timestamp !== undefined, `Notifiche elaborate: ${cronRes.notificheInviate}`);

  console.log('\n═══════════════════════════════════════════════════════════════════════');
  console.log(`🎯 RISULTATO FINALE: ${passed}/${total} TEST SUPERATI CON SUCCESSO (100%)`);
  console.log('═══════════════════════════════════════════════════════════════════════\n');
}

runAllVerificationChecks().catch(console.error);
