// §14 — worker tenant-scoped, invocabile sia dalla rotta manuale sia dal runner
// Railway. Il chiamante deve attivare il contesto tenant quando gira fuori da Fastify.
// Le query operative usano sempre il client condiviso e restano soggette a RLS.
import { prisma } from '../util/prismaClient.js';
import { notificaStudioSilenziosa } from './notificheService.js';
import { recordAudit } from '../util/serverHelpers.js';
import { giornoSollecitoRata, kycInAvviso, tonoRata } from '../util/scadenzeDerivate.js';

export interface CronReport {
  timestamp: string;
  scadenzeUboTrovate: number;
  scadenzeMarchiTrovate: number;
  fattureScaduteTrovate: number;
  microvociInRitardoTrovate: number;
  notificheInviate: number;
  dettagli: string[];
}

// Il tono che il modulo di derivazione calcola, tradotto nelle parole che finiscono nel messaggio.
// Sono tre parole diverse da quelle del modulo di proposito: là il tono è un caso, qui è un testo
// che l'operatore legge. La corrispondenza è uno-a-uno, e il tipo del modulo la tiene tale: se un
// giorno nascesse un quarto tono, questo oggetto smetterebbe di compilare.
const TONO_RATA_IN_PAROLE: Record<ReturnType<typeof tonoRata>, string> = {
  scaduta: 'scaduta',
  oggi: 'in scadenza oggi',
  vicina: 'in scadenza',
};

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

/** Worker di scansione automatica scadenze e invio notifiche proattive. */
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

  const adesso = new Date();

  // 1. Scansione Scadenze Clienti (UBO Registry & KYC Annual Return)
  //
  // La condizione non è scritta qui: sta in `scadenzeDerivate.ts`, insieme a quelle delle rate,
  // perché è la stessa che il calendario usa per disegnare la scadenza. Se ognuno calcolasse per
  // conto proprio, prima o poi l'operatore riceverebbe un avviso per una scadenza che nel
  // calendario non c'è — o vedrebbe nel calendario una scadenza per cui nessuno lo ha avvisato.
  const clienti = await prisma.cliente.findMany({ where: { tenantId } });

  for (const c of clienti) {
    if (kycInAvviso(c.dataKyc, adesso)) {
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

  // 2. Partite aperte: rate a -7 giorni, in scadenza oggi o scadute da 3 giorni.
  const scadenzeAperte = await prisma.scadenzaIncasso.findMany({
    where: { tenantId, stato: 'in_attesa' },
    include: { fattura: { include: { progetto: { include: { cliente: true } }, cliente: true } } },
  });

  for (const sc of scadenzeAperte) {
    const giorno = giornoSollecitoRata(sc.dataScadenza, adesso);
    if (giorno !== null) {
      const clNome = sc.fattura.cliente?.nome || sc.fattura.progetto?.cliente?.nome || 'Cliente';
      const importo = (sc.importoCentesimi / 100).toLocaleString('it-IT');
      const quando = new Date(sc.dataScadenza).toLocaleDateString('it-IT');
      const tono = TONO_RATA_IN_PAROLE[tonoRata(giorno)];
      const corpo = `[INCASSI] Rata di € ${importo} ${tono} per ${clNome} (rata #${sc.numeroRata}, scadenza ${quando})`;
      report.fattureScaduteTrovate += 1;
      report.dettagli.push(`[INCASSI] Sollecito / Promemoria rata €${(sc.importoCentesimi / 100).toFixed(2)} inviato a ${clNome} (Scadenza: ${quando})`);
      if (!(await giaNotificataOggi(tenantId, corpo))) {
        report.notificheInviate += await notificaStudioSilenziosa(tenantId, {
          tipoEvento: 'scadenza_imminente',
          oggetto: tono === 'scaduta' ? 'Rata scaduta' : 'Rata in scadenza',
          corpo,
          link: '/invoices',
        });
      }
    }
  }

  // L'audit resta accessorio: recordAudit traccia autonomamente eventuali errori.
  await recordAudit({
    tenantId,
    azione: 'CRON_NOTIFICHE_SCADENZE_ESEGUITO',
    entita: 'Cron Worker Background',
    dettagli: `Completata scansione: ${report.notificheInviate} notifiche create (${report.scadenzeUboTrovate} UBO, ${report.fattureScaduteTrovate} fatture)`,
  });

  return report;
}
