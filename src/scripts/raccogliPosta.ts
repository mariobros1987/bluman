/**
 * Accentratore delle mail — il giro automatico: la raccolta per tutti gli studi che hanno una
 * casella attiva.
 *
 * Gira in due modi con lo stesso codice: dentro il processo dell'API, a intervalli
 * (`avviaRaccoltaAutomatica`, chiamata da `index.ts`), oppure a mano con `npm run cron:posta`.
 * Come il cron delle notifiche, l'elenco degli studi si legge con `prismaAmministrativo()` —
 * fuori da una richiesta non c'è un tenant corrente — e poi ogni studio lavora dentro il proprio
 * contesto RLS: la raccolta in sé passa dalle policy come qualunque richiesta.
 */
import 'dotenv/config';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';
import { contestoTenant, prisma, prismaAmministrativo } from '../util/prismaClient.js';
import { raccogliPostaDelTenant, type EsitoRaccolta } from '../services/postaRaccolta.js';

export interface ReportRaccoltaPosta {
  timestamp: string;
  studi: number;
  messaggiNuovi: number;
  caselleInErrore: number;
  esiti: Array<{ tenantId: string; ok: boolean; raccolta?: EsitoRaccolta; errore?: string }>;
}

export async function raccogliPostaDiTuttiGliStudi(): Promise<ReportRaccoltaPosta> {
  const conCaselle = await prismaAmministrativo().casellaPosta.findMany({
    where: { attiva: true, tenant: { stato: 'attivo' } },
    distinct: ['tenantId'],
    select: { tenantId: true },
  });

  const report: ReportRaccoltaPosta = {
    timestamp: new Date().toISOString(),
    studi: conCaselle.length,
    messaggiNuovi: 0,
    caselleInErrore: 0,
    esiti: [],
  };

  for (const { tenantId } of conCaselle) {
    try {
      const raccolta = await contestoTenant.run({ tenantId, ruolo: 'super_admin' }, () => raccogliPostaDelTenant(tenantId));
      report.messaggiNuovi += raccolta.nuovi;
      report.caselleInErrore += raccolta.caselle.filter((c) => !c.ok).length;
      report.esiti.push({ tenantId, ok: true, raccolta });
    } catch (err) {
      // Uno studio che fallisce non ferma gli altri: l'errore resta nel report e nel log.
      report.esiti.push({ tenantId, ok: false, errore: err instanceof Error ? err.message : String(err) });
    }
  }
  return report;
}

/**
 * Ogni quanti minuti gira la raccolta automatica. `POSTA_RACCOLTA_MINUTI=0` la spegne (resta
 * «Raccogli ora» dalla pagina Posta); un valore non numerico vale come assente.
 */
export function minutiRaccoltaAutomatica(valore: string | undefined): number {
  if (valore === undefined || valore.trim() === '') return 5;
  const minuti = Number(valore);
  return Number.isFinite(minuti) && minuti >= 0 ? Math.min(Math.floor(minuti), 24 * 60) : 5;
}

/**
 * Avvia la raccolta a intervalli dentro il processo dell'API. Non apre nessuna connessione
 * all'avvio: il primo giro parte dopo un intervallo. Un giro lento non si accavalla al
 * successivo, e un errore non esce mai da qui: la raccolta non deve poter fermare l'API.
 */
export function avviaRaccoltaAutomatica(minuti = minutiRaccoltaAutomatica(process.env.POSTA_RACCOLTA_MINUTI)): NodeJS.Timeout | null {
  if (minuti <= 0) {
    console.log('[posta] raccolta automatica spenta (POSTA_RACCOLTA_MINUTI=0)');
    return null;
  }
  let inCorso = false;
  const timer = setInterval(() => {
    if (inCorso) return;
    inCorso = true;
    raccogliPostaDiTuttiGliStudi()
      .then((report) => {
        if (report.messaggiNuovi > 0 || report.caselleInErrore > 0) {
          console.log(`[posta] giro: ${report.messaggiNuovi} messaggi nuovi, ${report.caselleInErrore} caselle in errore, ${report.studi} studi`);
        }
      })
      .catch((err) => console.error('[posta] giro di raccolta fallito:', err instanceof Error ? err.message : err))
      .finally(() => {
        inCorso = false;
      });
  }, minuti * 60 * 1000);
  // Il timer non deve tenere in vita il processo allo spegnimento.
  timer.unref();
  console.log(`[posta] raccolta automatica ogni ${minuti} minuti`);
  return timer;
}

const percorsoEseguito = process.argv[1] ? resolve(process.argv[1]) : '';
const esecuzioneDiretta = percorsoEseguito === fileURLToPath(import.meta.url);

if (esecuzioneDiretta) {
  raccogliPostaDiTuttiGliStudi()
    .then((report) => console.log(JSON.stringify(report)))
    .catch((err) => {
      console.error(err instanceof Error ? err.message : err);
      process.exitCode = 1;
    })
    .finally(() => Promise.allSettled([prisma.$disconnect(), prismaAmministrativo().$disconnect()]));
}
