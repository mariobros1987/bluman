// src/scripts/runScheduledBackup.ts
// §5.2 — Backup periodico cifrato AES-256-GCM con retention automatica 14 giorni.
//
// Questo script è pensato per girare come Railway Cron separato dal processo web
// (comand npm: `backup:scheduled`). Non usa `node-cron` né hook di avvio Fastify.
//
// Flusso per ogni tenant attivo:
//   1. Esporta i dati in JSON (riusa la logica di backupDb.ts).
//   2. Cifra il JSON con AES-256-GCM (IV casuale 12 byte, autenticazione 16 byte).
//   3. Salva il file .enc nella cartella `backups/`.
//   4. Cancella i file .enc più vecchi di 14 giorni (retention).
//   5. Exit code ≠ 0 se almeno un tenant fallisce (osservabile su Railway).
//
// Layout del file .enc (binario):
//   [0..11]    IV  (12 byte, AES-GCM nonce)
//   [12..27]   AuthTag (16 byte, tag di autenticazione GCM)
//   [28..]     Ciphertext (JSON cifrato)
//
// Variabile d'ambiente richiesta:
//   BACKUP_ENCRYPTION_KEY  — 64 caratteri hex (32 byte), generabile con:
//     node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
//
// In assenza di BACKUP_ENCRYPTION_KEY: errore fatale in produzione, warning in sviluppo.

import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import { prismaAmministrativo, contestoTenant } from '../util/prismaClient.js';

// ─── Chiave di cifratura ──────────────────────────────────────────────────────

const LUNGHEZZA_CHIAVE_HEX = 64; // 32 byte = 64 caratteri hex

function risolviChiaveCifratura(): Buffer {
  const daEnv = process.env.BACKUP_ENCRYPTION_KEY;

  if (daEnv && daEnv.length === LUNGHEZZA_CHIAVE_HEX) {
    try {
      return Buffer.from(daEnv, 'hex');
    } catch {
      // caduto sotto
    }
  }

  if (process.env.NODE_ENV === 'production') {
    console.error(
      '❌ FATALE: BACKUP_ENCRYPTION_KEY mancante o non valida (deve essere 64 caratteri hex).\n' +
        '   Genera con: node -e "console.log(require(\'crypto\').randomBytes(32).toString(\'hex\'))"',
    );
    process.exit(1);
  }

  // Sviluppo/test: chiave deterministica a zero (NON SICURA, solo per test locali).
  console.warn('⚠️  BACKUP_ENCRYPTION_KEY non impostata: uso chiave di sviluppo. NON usare in produzione.');
  return Buffer.alloc(32, 0);
}

const CHIAVE_BACKUP = risolviChiaveCifratura();

// ─── Cifratura / Decifratura ──────────────────────────────────────────────────

export function cifraBackup(json: string): Buffer {
  const iv = crypto.randomBytes(12); // GCM consiglia IV da 96 bit (12 byte)
  const cipher = crypto.createCipheriv('aes-256-gcm', CHIAVE_BACKUP, iv);

  const ciphertext = Buffer.concat([
    cipher.update(json, 'utf8'),
    cipher.final(),
  ]);
  const authTag = cipher.getAuthTag(); // 16 byte

  // Layout: IV (12) || AuthTag (16) || Ciphertext
  return Buffer.concat([iv, authTag, ciphertext]);
}

export function decifraBackup(blob: Buffer): string {
  if (blob.length < 12 + 16) {
    throw new Error('Blob cifrato troppo corto: dati corrotti o formato non valido.');
  }
  const iv = blob.subarray(0, 12);
  const authTag = blob.subarray(12, 28);
  const ciphertext = blob.subarray(28);

  const decipher = crypto.createDecipheriv('aes-256-gcm', CHIAVE_BACKUP, iv);
  decipher.setAuthTag(authTag);

  try {
    const plaintext = Buffer.concat([decipher.update(ciphertext), decipher.final()]);
    return plaintext.toString('utf8');
  } catch {
    throw new Error('Decifratura fallita: AuthTag non valido. File corrotto o chiave errata.');
  }
}

// ─── Export dati tenant ───────────────────────────────────────────────────────

async function esportaDatiTenant(tenantId: string): Promise<Record<string, unknown>> {
  const prisma = prismaAmministrativo();

  const articoliDelTenant = await prisma.articolo.findMany({
    where: { tenantId },
    select: { id: true },
  });
  const articoliIds = articoliDelTenant.map((a) => a.id);

  return {
    metadata: {
      tenantId,
      exportedAt: new Date().toISOString(),
      platform: 'BluMan ERP Advisory',
      version: '2.6.0',
      cifrato: true,
    },
    tenants: await prisma.tenant.findMany({ where: { id: tenantId } }),
    utenti: await prisma.user.findMany({
      where: { tenantId },
      // Non esportare hash password: il backup serve per i dati operativi,
      // non per riottenere le credenziali. Il restore usa passwordAssign.
      select: { id: true, tenantId: true, nome: true, email: true, ruolo: true, stato: true, createdAt: true },
    }),
    clienti: await prisma.cliente.findMany({ where: { tenantId } }),
    progetti: await prisma.progetto.findMany({ where: { tenantId } }),
    articoli: articoliDelTenant,
    moduliTemplate: await prisma.moduloTemplate.findMany({ where: { tenantId } }),
    giurisdizioni: await prisma.giurisdizione.findMany({ where: { tenantId } }),
    righeDistinta: await prisma.rigaDistinta.findMany({ where: { tenantId } }),
    passaggiTemplate: await prisma.passaggioTemplate.findMany({
      where: { articoloId: { in: articoliIds } },
    }),
    moduli: await prisma.moduloProgetto.findMany({ where: { tenantId } }),
    microvoci: await prisma.microvoceProgetto.findMany({ where: { tenantId } }),
    passaggi: await prisma.passaggioProgetto.findMany({ where: { tenantId } }),
    fatture: await prisma.fattura.findMany({ where: { tenantId } }),
    scadenzeIncassi: await prisma.scadenzaIncasso.findMany({ where: { tenantId } }),
    comunicazioni: await prisma.comunicazioneProgetto.findMany({ where: { tenantId } }),
    contrattiRicorrenti: await prisma.contrattoRicorrente.findMany({ where: { tenantId } }),
    modelliDocumento: await prisma.modelloDocumentoCustom.findMany({ where: { tenantId } }),
    auditLogs: await prisma.auditLog.findMany({
      where: { tenantId },
      orderBy: { createdAt: 'desc' },
      take: 1000, // Ultime 1000 voci: il volume può essere molto grande
    }),
  };
}

// ─── Retention: cancella file .enc più vecchi di N giorni ────────────────────

export function cancellaVecchiBackup(backupDir: string, giorniRetention = 14): string[] {
  if (!fs.existsSync(backupDir)) return [];

  const soglia = Date.now() - giorniRetention * 24 * 60 * 60 * 1000;
  const cancellati: string[] = [];

  for (const file of fs.readdirSync(backupDir)) {
    if (!file.endsWith('.enc')) continue;
    const filePath = path.join(backupDir, file);
    const stat = fs.statSync(filePath);
    if (stat.mtimeMs < soglia) {
      fs.unlinkSync(filePath);
      cancellati.push(file);
    }
  }

  return cancellati;
}

// ─── Runner principale ────────────────────────────────────────────────────────

async function eseguiBackupSchedulato(): Promise<void> {
  console.log('🔐 Avvio backup cifrato BluMan...');
  console.log(`📅 ${new Date().toISOString()}`);

  const backupDir = path.join(process.cwd(), 'backups');
  if (!fs.existsSync(backupDir)) {
    fs.mkdirSync(backupDir, { recursive: true });
  }

  // Retention: cancella backup vecchi prima di crearne di nuovi
  const cancellati = cancellaVecchiBackup(backupDir);
  if (cancellati.length > 0) {
    console.log(`🗑️  Rimossi ${cancellati.length} backup scaduti: ${cancellati.join(', ')}`);
  }

  // Legge i tenant attivi con il client amministrativo (bypass RLS per operazione di sistema)
  const prismaAdmin = prismaAmministrativo();
  let tenants: { id: string; ragioneSociale: string }[];
  try {
    tenants = await prismaAdmin.tenant.findMany({
      where: { stato: 'attivo' },
      select: { id: true, ragioneSociale: true },
    });
  } catch (err) {
    console.error('❌ Impossibile leggere i tenant:', err instanceof Error ? err.message : err);
    process.exit(1);
  }

  console.log(`📦 Tenant da backuppare: ${tenants.length}`);

  let errori = 0;
  const backupDate = new Date().toISOString().replace(/[:.]/g, '-');

  for (const tenant of tenants) {
    try {
      console.log(`  ⏳ [${tenant.ragioneSociale}] Export in corso...`);

      // Esegui l'export nel contesto RLS del tenant
      const dati = await contestoTenant.run(
        { tenantId: tenant.id, ruolo: 'super_admin' },
        () => esportaDatiTenant(tenant.id),
      );

      const json = JSON.stringify(dati, null, 0); // compatto per ridurre dimensione
      const blob = cifraBackup(json);

      const nomefile = `bluman_backup_${tenant.id}_${backupDate}.enc`;
      const filePath = path.join(backupDir, nomefile);
      fs.writeFileSync(filePath, blob);

      const dimensioneMB = (blob.length / 1024 / 1024).toFixed(2);
      console.log(`  ✅ [${tenant.ragioneSociale}] Salvato: ${nomefile} (${dimensioneMB} MB cifrati)`);
    } catch (err) {
      errori++;
      console.error(
        `  ❌ [${tenant.ragioneSociale}] Errore durante il backup:`,
        err instanceof Error ? err.message : err,
      );
    }
  }

  console.log(`\n📊 Riepilogo: ${tenants.length - errori}/${tenants.length} tenant backuppati con successo.`);

  if (errori > 0) {
    console.error(`❌ ${errori} tenant hanno avuto errori. Controlla i log sopra.`);
    process.exit(1);
  }

  console.log('✅ Backup completato con successo.');
  process.exit(0);
}

// Esecuzione diretta (non importato come modulo)
if (import.meta.url === `file://${process.argv[1]}`) {
  eseguiBackupSchedulato().catch((err) => {
    console.error('❌ Errore fatale nel runner backup:', err);
    process.exit(1);
  });
}
