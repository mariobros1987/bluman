// §14 — invocato sempre dentro una richiesta (`POST /cron/esegui-notifiche-scadenze`),
// quindi il contesto tenant è già attivo e il client condiviso è quello giusto: le query
// qui sotto filtrano per tenantId e le policy RLS confermano lo stesso confine.
//
// Blocco 3 — il cron ora CREA le notifiche, non le simula: ogni scadenza trovata
// produce righe `notifica` per gli utenti dello studio (in-app). Chi è connesso
// al momento non le vede via SSE (il cron gira in una richiesta sua), ma le
// ritrova nella campanella al prossimo accesso — il DB è la fonte di verità.
import { prisma } from '../util/prismaClient.js';
import { notificaStudioSilenziosa } from './notificheService.js';

export interface CronReport {
  timestamp: string;
  scadenzeUboTrovate: number;
  scadenzeMarchiTrovate: number;
  fattureScaduteTrovate: number;
  microvociInRitardoTrovate: number;
  notificheInviate: number;
  dettagli: string[];
}

// Il cron può scattare più volte nello stesso giorno (riavvii, esecuzioni manuali):
// una notifica identica già inviata nelle ultime 20 ore non va duplicata.
async function giaNotificataOggi(tenantId: string, corpo: string): Promise<boolean> {
  const soglia = new Date(Date.now() - 20 * 60 * 60 * 1000);
  const esistente = await prisma.notifica.findFirst({
    where: { tenantId, tipoEvento: 'scadenza_imminente', corpo, inviataAt: { gte: soglia } },
    select: { id: true },
  });
  return esistente !== null;
}

/**
 * Worker di scansione automatica scadenze e invio notifiche proattive
 */
export async function runDailyNotificationCron(tenantId?: string): Promise<CronReport> {
  const report: CronReport = {
    timestamp: new Date().toISOString(),
    scadenzeUboTrovate: 0,
    scadenzeMarchiTrovate: 0,
    fattureScaduteTrovate: 0,
    microvociInRitardoTrovate: 0,
    notificheInviate: 0,
    dettagli: [],
  };

  if (!tenantId) return report;

  try {
    const now = Date.now();
    const thirtyDaysMs = 30 * 24 * 60 * 60 * 1000;

    // 1. Scansione Scadenze Clienti (UBO Registry & KYC Annual Return)
    const clienti = await prisma.cliente.findMany({ where: { tenantId } });

    for (const c of clienti) {
      if (c.dataKyc) {
        const kycAge = now - new Date(c.dataKyc).getTime();
        // Se il KYC ha quasi 1 anno (335 giorni+)
        if (kycAge > (365 * 24 * 60 * 60 * 1000 - thirtyDaysMs)) {
          const corpo = `[UBO-MFSA] Promemoria rinnovo UBO / Aggiornamento KYC per ${c.nome} (Ref: ${c.email || c.cellulare || 'N/D'})`;
          report.scadenzeUboTrovate += 1;
          report.dettagli.push(`[UBO-MFSA] Promemoria rinnovo UBO / Aggiornamento KYC inviato per ${c.nome} (Ref: ${c.email || c.cellulare || 'N/D'})`);
          if (!(await giaNotificataOggi(tenantId, corpo))) {
            report.notificheInviate += await notificaStudioSilenziosa(tenantId, {
              tipoEvento: 'scadenza_imminente',
              oggetto: 'Rinnovo KYC in scadenza',
              corpo,
              link: '/clients',
            });
          }
        }
      }
    }

    // 2. Partite aperte: rate in scadenza tra 7 giorni, in scadenza oggi, o scadute da 3.
    //    Prima qui si usava un modello che non esiste nello schema (scadenzaFattura):
    //    la query falliva sempre e il blocco catch la nascondeva.
    const scadenzeAperte = await prisma.scadenzaIncasso.findMany({
      where: { tenantId, stato: 'in_attesa' },
      include: { fattura: { include: { progetto: { include: { cliente: true } } } } },
    });

    for (const sc of scadenzeAperte) {
      const dataScad = new Date(sc.dataScadenza).getTime();
      const diffDays = Math.round((dataScad - now) / (1000 * 60 * 60 * 24));

      // Notifica a -7 giorni (preavviso) o a 0 giorni (scadenza oggi) o +3 giorni (sollecito cortesia)
      if (diffDays === 7 || diffDays === 0 || diffDays === -3) {
        const clNome = sc.fattura.progetto.cliente.nome || 'Cliente';
        const importo = (sc.importoCentesimi / 100).toLocaleString('it-IT');
        const quando = new Date(sc.dataScadenza).toLocaleDateString('it-IT');
        const tono = diffDays === -3 ? 'scaduta' : diffDays === 0 ? 'in scadenza oggi' : 'in scadenza';
        const corpo = `[INCASSI] Rata di € ${importo} ${tono} per ${clNome} (rata #${sc.numeroRata}, scadenza ${quando})`;
        report.fattureScaduteTrovate += 1;
        report.dettagli.push(`[INCASSI] Sollecito / Promemoria rata €${(sc.importoCentesimi / 100).toFixed(2)} inviato a ${clNome} (Scadenza: ${quando})`);
        if (!(await giaNotificataOggi(tenantId, corpo))) {
          report.notificheInviate += await notificaStudioSilenziosa(tenantId, {
            tipoEvento: 'scadenza_imminente',
            oggetto: diffDays === -3 ? 'Rata scaduta' : 'Rata in scadenza',
            corpo,
            link: '/invoices',
          });
        }
      }
    }

    // 3. Registrazione Audit Log del Cron
    try {
      await (prisma as any).auditLog.create({
        data: {
          tenantId,
          azione: 'CRON_NOTIFICHE_SCADENZE_ESEGUITO',
          entita: 'Cron Worker Background',
          dettagli: `Completata scansione: ${report.notificheInviate} notifiche create (${report.scadenzeUboTrovate} UBO, ${report.fattureScaduteTrovate} fatture)`,
        },
      });
    } catch {}

  } catch (err) {
    console.error('[CRON-ERROR]', err);
  }

  return report;
}
