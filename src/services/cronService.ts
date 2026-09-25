// §14 — worker tenant-scoped, invocabile sia dalla rotta manuale sia dal runner
// Railway. Il chiamante deve attivare il contesto tenant quando gira fuori da Fastify.
// Le query operative usano sempre il client condiviso e restano soggette a RLS.
import { prisma } from '../util/prismaClient.js';
import { notificaStudioSilenziosa } from './notificheService.js';
import { recordAudit } from '../util/serverHelpers.js';
import { giornoSollecitoRata, kycInAvviso, tonoRata } from '../util/scadenzeDerivate.js';
import { revisioneKycDovuta, motivoRevisioneKyc } from '../domain/monitoraggioKyc.js';
import { moduloKycAttivo } from '../util/guardiaModuli.js';

export interface CronReport {
  timestamp: string;
  scadenzeUboTrovate: number;
  scadenzeMarchiTrovate: number;
  fattureScaduteTrovate: number;
  microvociInRitardoTrovate: number;
  revisioniKycTrovate: number;
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
// una notifica identica già inviata nelle ultime 20 ore non va duplicata. Invece di
// interrogare il DB per ogni cliente/rata (N+1: con la RLS ogni findFirst sono ~4
// round-trip), si carica UNA volta l'insieme dei `corpo` già notificati nella finestra
// e si controlla in memoria. La finestra (20h) è la stessa per tutte le righe del giro.
async function corpiGiaNotificati(tenantId: string): Promise<Set<string>> {
  const soglia = new Date(Date.now() - 20 * 60 * 60 * 1000);
  const recenti = await prisma.notifica.findMany({
    where: { tenantId, tipoEvento: 'scadenza_imminente', inviataAt: { gte: soglia } },
    select: { corpo: true },
  });
  return new Set(recenti.map((n) => n.corpo));
}

/** Worker di scansione automatica scadenze e invio notifiche proattive. */
export async function runDailyNotificationCron(tenantId?: string): Promise<CronReport> {
  const report: CronReport = {
    timestamp: new Date().toISOString(),
    scadenzeUboTrovate: 0,
    scadenzeMarchiTrovate: 0,
    fattureScaduteTrovate: 0,
    microvociInRitardoTrovate: 0,
    revisioniKycTrovate: 0,
    notificheInviate: 0,
    dettagli: [],
  };

  if (!tenantId) return report;

  const adesso = new Date();

  // Insieme dei corpi già notificati nelle ultime 20h, caricato una sola volta per tutto
  // il giro (niente più una query per ogni cliente/rata).
  const giaNotificati = await corpiGiaNotificati(tenantId);

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
      if (!giaNotificati.has(corpo)) {
        giaNotificati.add(corpo);
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
      if (!giaNotificati.has(corpo)) {
        giaNotificati.add(corpo);
        report.notificheInviate += await notificaStudioSilenziosa(tenantId, {
          tipoEvento: 'scadenza_imminente',
          oggetto: tono === 'scaduta' ? 'Rata scaduta' : 'Rata in scadenza',
          corpo,
          link: '/invoices',
        });
      }
    }
  }

  // 3. Fatture emesse ma mai trasmesse a SdI (W2 audit): passavano inosservate finché
  //    nessuno se ne accorgeva. Emessa da più di GIORNI_SDI_NON_TRASMESSA con statoSdi ancora
  //    `n_a` sul canale SdI. La consegna vera la dichiara il webhook (statoSdi consegnata/…).
  const GIORNI_SDI_NON_TRASMESSA = 3;
  const sogliaSdi = new Date(adesso.getTime() - GIORNI_SDI_NON_TRASMESSA * 24 * 60 * 60 * 1000);
  const fattureNonTrasmesse = await prisma.fattura.findMany({
    where: { tenantId, stato: 'emessa', canale: 'sdi', statoSdi: 'n_a', data: { lt: sogliaSdi } },
    include: { cliente: true },
  });
  for (const f of fattureNonTrasmesse) {
    const clNome = f.cliente?.nome || 'Cliente';
    const quando = f.data ? new Date(f.data).toLocaleDateString('it-IT') : 'N/D';
    const corpo = `[SDI] Fattura ${f.numero || f.id.slice(0, 8)} (${clNome}) emessa il ${quando} non risulta ancora trasmessa allo SdI.`;
    report.dettagli.push(corpo);
    if (!giaNotificati.has(corpo)) {
      giaNotificati.add(corpo);
      report.notificheInviate += await notificaStudioSilenziosa(tenantId, {
        tipoEvento: 'scadenza_imminente',
        oggetto: 'Fattura non trasmessa allo SdI',
        corpo,
        link: '/invoices',
      });
    }
  }

  // 4. Revisioni KYC periodiche (K7, spec §5.2) — SOLO se il modulo KYC è attivo per lo studio: se
  //    l'admin l'ha spento, niente promemoria di revisione (coerente col 403 delle rotte /kyc).
  //    Detection + reminder soltanto (la transizione a `in_revisione` la fa l'operatore, regola 14);
  //    nessun ComplianceEvent per il promemoria (l'evento lo scrive la transizione vera). La
  //    condizione di "dovuta" sta nel dominio puro `monitoraggioKyc`, così cron e calendario non divergono.
  if (await moduloKycAttivo(tenantId)) {
    const fascicoliKyc = await prisma.fascicoloKyc.findMany({
      where: { tenantId, stato: { in: ['approvato', 'in_revisione'] } },
      include: {
        cliente: { select: { nome: true } },
        riskAssessments: { orderBy: { versione: 'desc' }, take: 1, select: { prossimaRevisione: true } },
      },
    });
    for (const f of fascicoliKyc) {
      const prossima = f.riskAssessments[0]?.prossimaRevisione ?? null;
      if (revisioneKycDovuta(f.stato, f.dataScadenza, prossima, adesso)) {
        const clNome = f.cliente?.nome || 'Cliente';
        const corpo = `[KYC] Revisione periodica dovuta per ${clNome} — ${motivoRevisioneKyc(f.stato, f.dataScadenza, prossima, adesso)}`;
        report.revisioniKycTrovate += 1;
        report.dettagli.push(corpo);
        if (!giaNotificati.has(corpo)) {
          giaNotificati.add(corpo);
          report.notificheInviate += await notificaStudioSilenziosa(tenantId, {
            tipoEvento: 'scadenza_imminente',
            oggetto: 'Revisione KYC in scadenza',
            corpo,
            link: '/clients',
          });
        }
      }
    }
  }

  // L'audit resta accessorio: recordAudit traccia autonomamente eventuali errori.
  await recordAudit({
    tenantId,
    azione: 'CRON_NOTIFICHE_SCADENZE_ESEGUITO',
    entita: 'Cron Worker Background',
    dettagli: `Completata scansione: ${report.notificheInviate} notifiche create (${report.scadenzeUboTrovate} UBO, ${report.fattureScaduteTrovate} fatture, ${report.revisioniKycTrovate} revisioni KYC)`,
  });

  return report;
}
