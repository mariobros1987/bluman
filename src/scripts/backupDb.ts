import fs from 'fs';
import path from 'path';
import { prismaAmministrativo } from '../util/prismaClient.js';

// Backup: connessione amministrativa (§14). Un backup fatto con il ruolo applicativo
// esporterebbe soltanto il tenant corrente — che fuori da una richiesta non esiste,
// quindi zero righe, senza nessun errore visibile.
const prisma = prismaAmministrativo();

async function exportTenantBackup(tenantId?: string) {
  console.log('📦 Avvio backup database BluMan...');
  
  const targetTenant = tenantId || 'tenant_default';
  const backupDate = new Date().toISOString().replace(/[:.]/g, '-');
  const backupDir = path.join(process.cwd(), 'backups');

  if (!fs.existsSync(backupDir)) {
    fs.mkdirSync(backupDir, { recursive: true });
  }

  const exportData: Record<string, any> = {
    metadata: {
      tenantId: targetTenant,
      exportedAt: new Date().toISOString(),
      platform: 'BluMan ERP Advisory',
      version: '2.5.0',
    },
    tenants: await prisma.tenant.findMany({ where: { id: targetTenant } }),
    utenti: await prisma.user.findMany({ where: { tenantId: targetTenant } }),
    clienti: await prisma.cliente.findMany({ where: { tenantId: targetTenant } }),
    progetti: await prisma.progetto.findMany({ where: { tenantId: targetTenant } }),
    moduli: await prisma.moduloProgetto.findMany(),
    microvoci: await prisma.microvoceProgetto.findMany(),
    passaggi: await prisma.passaggioProgetto.findMany(),
    fatture: await prisma.fattura.findMany({ where: { tenantId: targetTenant } }),
    scadenzeIncassi: await prisma.scadenzaIncasso.findMany(),
    comunicazioni: await prisma.comunicazioneProgetto.findMany(),
    contrattiRicorrenti: await prisma.contrattoRicorrente.findMany({ where: { tenantId: targetTenant } }),
    modelliDocumento: await prisma.modelloDocumentoCustom.findMany({ where: { tenantId: targetTenant } }),
    auditLogs: await prisma.auditLog.findMany({ where: { tenantId: targetTenant }, take: 500 }),
  };

  const filePath = path.join(backupDir, `bluman_backup_${targetTenant}_${backupDate}.json`);
  fs.writeFileSync(filePath, JSON.stringify(exportData, null, 2), 'utf-8');

  console.log(`✅ Backup completato con successo!`);
  console.log(`📁 File salvato: ${filePath}`);
  console.log(`📊 Record esportati: ${Object.keys(exportData).length - 1} tabelle.`);
}

exportTenantBackup()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error('❌ Errore durante il backup:', err);
    process.exit(1);
  });
