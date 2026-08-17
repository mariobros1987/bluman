import fs from 'fs';
import path from 'path';
import { prismaApp } from '../adapters/prisma/prismaApp';

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
    tenants: await prismaApp.tenant.findMany({ where: { id: targetTenant } }),
    utenti: await prismaApp.user.findMany({ where: { tenantId: targetTenant } }),
    clienti: await prismaApp.cliente.findMany({ where: { tenantId: targetTenant } }),
    progetti: await prismaApp.progetto.findMany({ where: { tenantId: targetTenant } }),
    moduli: await prismaApp.moduloProgetto.findMany(),
    microvoci: await prismaApp.microvoceProgetto.findMany(),
    passaggi: await prismaApp.passaggioProgetto.findMany(),
    fatture: await prismaApp.fattura.findMany({ where: { tenantId: targetTenant } }),
    scadenzeFatture: await prismaApp.scadenzaFattura.findMany(),
    comunicazioni: await prismaApp.comunicazioneProgetto.findMany(),
    contrattiRicorrenti: await prismaApp.contrattoRicorrente.findMany({ where: { tenantId: targetTenant } }),
    modelliDocumento: await prismaApp.modelloDocumentoCustom.findMany({ where: { tenantId: targetTenant } }),
    auditLogs: await prismaApp.auditLog.findMany({ where: { tenantId: targetTenant }, take: 500 }),
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
