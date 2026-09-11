import 'dotenv/config';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';
import { contestoTenant, prisma, prismaAmministrativo } from '../util/prismaClient.js';
import { runDailyNotificationCron, type CronReport } from '../services/cronService.js';

export interface EsitoCronTenant {
  tenantId: string;
  ok: boolean;
  report?: CronReport;
  errore?: string;
}

export interface ReportRunnerCron {
  timestamp: string;
  tenantAttivi: number;
  tenantCompletati: number;
  tenantFalliti: number;
  notificheInviate: number;
  esiti: EsitoCronTenant[];
}

export class ErroreRunnerCron extends Error {
  constructor(public readonly report: ReportRunnerCron) {
    super(`Cron notifiche fallito per ${report.tenantFalliti} tenant su ${report.tenantAttivi}`);
    this.name = 'ErroreRunnerCron';
  }
}

export async function eseguiCronPerTenantAttivi(): Promise<ReportRunnerCron> {
  const tenant = await prismaAmministrativo().tenant.findMany({
    where: { stato: 'attivo' },
    select: { id: true },
    orderBy: { createdAt: 'asc' },
  });

  const report: ReportRunnerCron = {
    timestamp: new Date().toISOString(),
    tenantAttivi: tenant.length,
    tenantCompletati: 0,
    tenantFalliti: 0,
    notificheInviate: 0,
    esiti: [],
  };

  for (const { id: tenantId } of tenant) {
    try {
      const esito = await contestoTenant.run(
        { tenantId, ruolo: 'super_admin' },
        () => runDailyNotificationCron(tenantId),
      );
      report.tenantCompletati += 1;
      report.notificheInviate += esito.notificheInviate;
      report.esiti.push({ tenantId, ok: true, report: esito });
    } catch (err) {
      const errore = err instanceof Error ? err.message : String(err);
      report.tenantFalliti += 1;
      report.esiti.push({ tenantId, ok: false, errore });
    }
  }

  return report;
}

export async function mainCronNotifiche(): Promise<void> {
  try {
    const report = await eseguiCronPerTenantAttivi();
    console.log(JSON.stringify(report));
    if (report.tenantFalliti > 0) throw new ErroreRunnerCron(report);
  } finally {
    await Promise.allSettled([
      prisma.$disconnect(),
      prismaAmministrativo().$disconnect(),
    ]);
  }
}

const percorsoEseguito = process.argv[1] ? resolve(process.argv[1]) : '';
const esecuzioneDiretta = percorsoEseguito === fileURLToPath(import.meta.url);

if (esecuzioneDiretta) {
  mainCronNotifiche().catch((err) => {
    console.error(err instanceof Error ? err.message : err);
    process.exitCode = 1;
  });
}
