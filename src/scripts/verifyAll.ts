import {
  creaSigilloFea,
  mascheraRecapito,
  descriviCanaleVerificato,
  canaleValido,
  CANALI_OTP,
} from '../services/otpService.js';
import { hashCodiceOtp, verificaCodiceOtp } from '../util/jwt.js';
import { scanFileBuffer } from '../services/securityScanner.js';
import { preparaFatturaPerInvioManuale } from '../services/sdiService.js';
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

  // 1. TEST OTP & FIRMA ELETTRONICA SEMPLICE
  //
  // L'emissione e la verifica del codice ora scrivono su `codice_otp`, quindi non stanno
  // qui: questo script gira senza database e senza contesto RLS. Restano le parti pure,
  // che sono quelle in cui un difetto finisce dentro un verbale di firma.
  console.log('🔐 [1/4] Test Modulo OTP & Firma Elettronica Semplice (SES · art. 20 CAD)...');

  assertTest(
    'Canali OTP offerti = canali che il server sa spedire (nessun SMS fantasma)',
    CANALI_OTP.length === 3 && !canaleValido('sms') && canaleValido('whatsapp'),
    `Canali: ${CANALI_OTP.join(', ')}`,
  );

  const hashUno = hashCodiceOtp('123456', 'cli-1');
  const hashAltro = hashCodiceOtp('123456', 'cli-2');
  assertTest(
    'Digest del codice legato al cliente e non ricostruibile senza segreto (HMAC)',
    hashUno !== hashAltro && hashUno.length === 64,
    `Stesso codice su due clienti → due digest diversi`,
  );

  assertTest(
    'Verifica del codice a tempo costante, solo per il cliente giusto',
    verificaCodiceOtp('123456', 'cli-1', hashUno) === true &&
      verificaCodiceOtp('123457', 'cli-1', hashUno) === false &&
      verificaCodiceOtp('123456', 'cli-2', hashUno) === false &&
      verificaCodiceOtp('123456', 'cli-1', 'troppo-corto') === false,
  );

  assertTest(
    'Mascheratura dei recapiti nelle risposte al browser',
    !mascheraRecapito('mario.rossi@example.com').includes('rio.rossi'),
    `mario.rossi@example.com → ${mascheraRecapito('mario.rossi@example.com')}`,
  );

  const seal = creaSigilloFea({
    clienteId: 'cli-1',
    signerName: 'Marco Ricci',
    documentoTitolo: "Lettera d'Incarico Professionale v1.0",
    documentoHash: 'a'.repeat(64),
    ip: '2.234.190.44',
    canaleVerificato: descriviCanaleVerificato({
      canale: 'whatsapp',
      target: '+39 000 0000000',
      targetDichiarato: false,
      targetAnagrafica: '+39 000 0000000',
    }),
  });
  assertTest(
    'Generazione Sigillo Crittografico SES (prefisso SIGILLO-SES, mai "avanzato" per default)',
    seal.signatureId.startsWith('SIGILLO-SES-') && seal.sha256Digest.length === 64 &&
      !seal.standard.includes('Avanzata'),
    `ID Sigillo: ${seal.signatureId} | SHA-256: ${seal.sha256Digest.slice(0, 16)}...`,
  );
  assertTest(
    'Il sigillo cita il canale realmente usato, non una formula fissa',
    seal.canaleVerificato.includes('WhatsApp') && seal.canaleVerificato.includes('anagrafica'),
    seal.canaleVerificato,
  );

  const sealSenzaIp = creaSigilloFea({
    clienteId: 'cli-2',
    signerName: 'Anna Bianchi',
    documentoTitolo: 'Addendum',
    documentoHash: 'b'.repeat(64),
    canaleVerificato: 'Codice OTP monouso consegnato via email a an***i@example.com',
  });
  assertTest(
    'IP assente registrato come assente, non come 127.0.0.1',
    sealSenzaIp.ipAddress === null && sealSenzaIp.sha256Digest.length === 64,
    'Nessun firmatario si collega dal loopback del server: quel ripiego era un dato falso',
  );

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

  // 3. TEST PREPARAZIONE INVIO MANUALE SDI (§3.5, nessun provider collegato)
  console.log('\n📦 [3/4] Test preparazione invio manuale SdI...');
  const sdiRes = await preparaFatturaPerInvioManuale({
    fatturaId: 'inv-1',
    numeroProgressivo: 'FT-2026-001',
  });
  assertTest('Preparazione invio manuale con riferimento locale (nessuna finta trasmissione)', sdiRes.ok && sdiRes.riferimentoPreparazione.startsWith('PREP-'), `Riferimento locale: ${sdiRes.riferimentoPreparazione}`);

  // 4. TEST CRON WORKER NOTIFICHE SCADENZE
  console.log('\n⏰ [4/4] Test Worker Cron Scadenze & Rinnovi Automatici...');
  const cronRes = await runDailyNotificationCron();
  assertTest('Esecuzione scansione scadenze UBO Malta e rate aperte', cronRes && cronRes.timestamp !== undefined, `Notifiche elaborate: ${cronRes.notificheInviate}`);

  console.log('\n═══════════════════════════════════════════════════════════════════════');
  // La percentuale era scritta a mano come "(100%)" e restava 100% anche con metà dei test
  // falliti: un collaudo che si dichiara superato da solo non è un collaudo. Ora la calcola,
  // e con un test rosso lo script esce con codice 1 così la CI se ne accorge.
  const percentuale = total > 0 ? Math.round((passed / total) * 100) : 0;
  const esito = passed === total ? '🎯 RISULTATO FINALE' : '❌ RISULTATO FINALE';
  console.log(`${esito}: ${passed}/${total} TEST SUPERATI (${percentuale}%)`);
  console.log('═══════════════════════════════════════════════════════════════════════\n');

  if (passed !== total) process.exitCode = 1;
}

runAllVerificationChecks().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
