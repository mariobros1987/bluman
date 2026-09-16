import 'dotenv/config';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';
import { contestoTenant, prisma, prismaAmministrativo } from '../util/prismaClient.js';
import { runDailyNotificationCron, type CronReport } from '../services/cronService.js';
import { riceviMessaggiSignal, type EsitoRicezioneSignal } from '../services/signalInbound.js';

export interface EsitoCronTenant {
  tenantId: string;
  ok: boolean;
  report?: CronReport;
  /**
   * Ricezione Signal del giro, quando il cron per lo studio è andato a buon fine. Presente
   * sempre: `nonConfigurato` dice che lo studio non ha Signal, che non è un errore.
   *
   * Sta fuori da `ok` di proposito: un demone Signal spento non è un cron fallito. Le scadenze
   * sono state notificate comunque, e far fallire l'intero giro per un canale di messaggistica
   * fermo significherebbe che chi legge il report cerca il guasto dove non c'è.
   */
  signal?: EsitoRicezioneSignal;
  errore?: string;
}

export interface ReportRunnerCron {
  timestamp: string;
  tenantAttivi: number;
  tenantCompletati: number;
  tenantFalliti: number;
  notificheInviate: number;
  /** Messaggi Signal nuovi registrati in questo giro, sommati su tutti gli studi. */
  messaggiSignal: number;
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
    messaggiSignal: 0,
    esiti: [],
  };

  for (const { id: tenantId } of tenant) {
    try {
      // Un solo contesto RLS per studio: entrambe le letture passano dalle policy come qualunque
      // altra richiesta, e il contesto non va riattivato per la seconda.
      const { esito, signal } = await contestoTenant.run(
        { tenantId, ruolo: 'super_admin' },
        async () => ({
          esito: await runDailyNotificationCron(tenantId),
          // Signal non riceve per webhook come WhatsApp e Telegram: la coda la tiene il demone
          // dello studio e va **prelevata** (`GET /v1/receive/{number}`, lettura distruttiva).
          // Il percorso principale resta la rotta su richiesta, che è quella che l'operatore usa
          // aprendo la chat del fascicolo; questo passaggio è la rete di sicurezza per gli studi
          // dove nessuno l'ha aperta, perché un demone riavviato perde la coda e i messaggi con
          // essa. Un giro al giorno è poco, ed è comunque meglio di non prelevare mai.
          signal: await riceviMessaggiSignal(tenantId).catch((err): EsitoRicezioneSignal => ({
            letti: 0,
            registrati: 0,
            scartati: 0,
            errore: err instanceof Error ? err.message : 'errore non riportato',
          })),
        }),
      );

      report.tenantCompletati += 1;
      report.notificheInviate += esito.notificheInviate;
      report.messaggiSignal += signal.registrati;
      report.esiti.push({ tenantId, ok: true, report: esito, signal });
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
