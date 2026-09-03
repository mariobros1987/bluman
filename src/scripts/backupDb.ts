import fs from 'fs';
import path from 'path';
import { prismaAmministrativo } from '../util/prismaClient.js';

// Backup: connessione amministrativa (§14). Un backup fatto con il ruolo applicativo
// esporterebbe soltanto il tenant corrente — che fuori da una richiesta non esiste,
// quindi zero righe, senza nessun errore visibile. La connessione amministrativa
// scavalca le policy RLS: è proprio per questo che OGNI query qui sotto deve portare
// il filtro `where: { tenantId: targetTenant }` esplicito. Senza, esporterebbe i dati
// di TUTTI gli studi che condividono il database — un incidente di privacy silenzioso:
// il file sembrerebbe normale, solo più grande.
const prisma = prismaAmministrativo();

async function exportTenantBackup(tenantId?: string) {
  console.log('📦 Avvio backup database BluMan...');

  const targetTenant = tenantId || 'tenant_default';
  const backupDate = new Date().toISOString().replace(/[:.]/g, '-');
  const backupDir = path.join(process.cwd(), 'backups');

  if (!fs.existsSync(backupDir)) {
    fs.mkdirSync(backupDir, { recursive: true });
  }

  // PassaggioTemplate non ha tenantId (schema.prisma): appartiene al tenant per
  // via dell'articolo a cui è collegato. Lo si filtra transitivamente, altrimenti
  // un backup dello studio A porterebbe via anche i passaggi dello studio B.
  const articoliDelTenant = await prisma.articolo.findMany({
    where: { tenantId: targetTenant },
    select: { id: true },
  });
  const articoliIds = articoliDelTenant.map((a) => a.id);

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
    // §18 — il backup deve rimettere in piedi lo studio COME LAVORA: senza catalogo
    // (articoli, moduli template, distinte, giurisdizioni, dipendenze) e senza le
    // tabelle figlie dei progetti, un restore produrrebbe progetti senza moduli,
    // preventivi senza righe e fatture senza scadenze: carta senza senso.
    articoli: await prisma.articolo.findMany({ where: { tenantId: targetTenant } }),
    moduliTemplate: await prisma.moduloTemplate.findMany({ where: { tenantId: targetTenant } }),
    giurisdizioni: await prisma.giurisdizione.findMany({ where: { tenantId: targetTenant } }),
    righeDistinta: await prisma.rigaDistinta.findMany({ where: { tenantId: targetTenant } }),
    passaggiTemplate: await prisma.passaggioTemplate.findMany({
      where: { articoloId: { in: articoliIds } },
    }),
    dipendenzeTemplate: await prisma.moduloDipendenzaTemplate.findMany({
      where: { tenantId: targetTenant },
    }),
    moduli: await prisma.moduloProgetto.findMany({ where: { tenantId: targetTenant } }),
    microvoci: await prisma.microvoceProgetto.findMany({ where: { tenantId: targetTenant } }),
    passaggi: await prisma.passaggioProgetto.findMany({ where: { tenantId: targetTenant } }),
    fatture: await prisma.fattura.findMany({ where: { tenantId: targetTenant } }),
    scadenzeIncassi: await prisma.scadenzaIncasso.findMany({ where: { tenantId: targetTenant } }),
    comunicazioni: await prisma.comunicazioneProgetto.findMany({
      where: { tenantId: targetTenant },
    }),
    contrattiRicorrenti: await prisma.contrattoRicorrente.findMany({
      where: { tenantId: targetTenant },
    }),
    modelliDocumento: await prisma.modelloDocumentoCustom.findMany({
      where: { tenantId: targetTenant },
    }),
    auditLogs: await prisma.auditLog.findMany({ where: { tenantId: targetTenant }, take: 500 }),
  };

  const filePath = path.join(backupDir, `bluman_backup_${targetTenant}_${backupDate}.json`);
  fs.writeFileSync(filePath, JSON.stringify(exportData, null, 2), 'utf-8');

  console.log(`✅ Backup completato con successo!`);
  console.log(`📁 File salvato: ${filePath}`);
  console.log(
    `📊 Record esportati: ${Object.entries(exportData)
      .filter(([k]) => k !== 'metadata')
      .map(([k, v]) => `${k}=${(v as any[]).length}`)
      .join(', ')}`,
  );
}

exportTenantBackup()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error('❌ Errore durante il backup:', err);
    process.exit(1);
  });
