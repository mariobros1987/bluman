// Blocco 5 — Service di reportistica direzionale (§ reportistica).
//
// Cinque report costruiti SOLO su dati reali a database, nessun valore inventato né
// fallback mock (lezione del Blocco 7). Ogni funzione restituisce una struttura tabellare
// comune (`ReportTabella`) così la generazione PDF/Excel (reportExport.ts) è unica e
// riusata, e il frontend può renderizzare la stessa forma via JSON.
//
// ── Regole di calcolo ─────────────────────────────────────────────────────────────
// • Gli importi a DB sono in CENTESIMI: qui restano centesimi finché non si costruisce
//   la riga esposta, dove diventano euro (numero con 2 decimali) per celle numeriche.
// • Il costo del lavoro usa `User.costoOrarioCentesimi`; per le micro-voci senza
//   operatore assegnato si applica il costo orario interno predefinito (§121 schema,
//   default 3000 cent = €30/h). Non è un dato inventato: è il default dichiarato in schema.
// • I ricavi mensili sottraggono le note di credito (tipoDocumento=nota_credito), così
//   il "ricavo netto" riflette la contabilità reale e non il solo lordo fatturato.
//
// Tutti i metodi leggono tramite il client condiviso con contesto tenant (§14, Rule 1):
// le policy RLS filtrano per `tenant_id`, quindi qui si passa sempre il tenantId della
// richiesta corrente e mai un valore cablato.

import { prisma } from '../util/prismaClient.js';

/** Costo orario interno predefinito (centesimi) quando l'operatore non è assegnato. */
export const COSTO_ORARIO_DEFAULT_CENTESIMI = 3000;

/** Una cella della tabella: testo, numero (valuta/ore/percentuale) o null. */
export type CellaReport = string | number | null;

/**
 * Struttura tabellare comune a tutti i report.
 *
 * `colonneValuta` / `colonneOre` / `colonnePercentuali` sono gli INDICI (0-based) delle
 * colonne da formattare rispettivamente come €, ore o % — sia nel PDF che in Excel.
 * Il builder Excel userà queste per applicare formati numerici reali (celle sommabili),
 * il builder PDF per allineare a destra e aggiungere l'unità di misura.
 */
export interface ReportTabella {
  /** Identificativo stabile del report (es. 'ore-operatori'). */
  chiave: string;
  /** Titolo mostrato in testata. */
  titolo: string;
  /** Riga di contesto sotto il titolo (periodo, filtro, data elaborazione). */
  sottotitolo: string;
  intestazioni: string[];
  righe: CellaReport[][];
  colonneValuta: number[];
  colonneOre: number[];
  colonnePercentuali: number[];
  /** Eventuali righe di totale in calce, allineate alle intestazioni. */
  totali?: CellaReport[][];
  /** Coppie chiave/valore di riepilogo (es. "Totale residuo: € 1.200,00"). */
  riepilogo?: Array<{ etichetta: string; valore: string }>;
}

/** Converte centesimi in euro come numero a 2 decimali (per celle numeriche). */
function euro(centesimi: number): number {
  return Math.round(centesimi) / 100;
}

/** Formatta un importo euro come stringa italiana per il riepilogo/testo. */
export function fmtEuro(valoreEuro: number): string {
  return valoreEuro.toLocaleString('it-IT', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + ' €';
}

// ──────────────────────────────────────────────────────────────────────────────
// 1. ORE PER OPERATORE
// ──────────────────────────────────────────────────────────────────────────────
export async function reportOrePerOperatore(tenantId: string): Promise<ReportTabella> {
  const microvoci = await prisma.microvoceProgetto.findMany({
    where: { tenantId },
    select: {
      stato: true,
      orePreventivate: true,
      oreConsuntivate: true,
      oreExtra: true,
      risorsaId: true,
      risorsa: { select: { nome: true, costoOrarioCentesimi: true } },
    },
  });

  interface Aggregato {
    nome: string;
    costoOrario: number;
    voci: number;
    completate: number;
    orePrev: number;
    oreCons: number;
    oreExtra: number;
  }
  const perOperatore = new Map<string, Aggregato>();

  for (const mv of microvoci) {
    const chiave = mv.risorsaId ?? '__non_assegnato__';
    const agg = perOperatore.get(chiave) ?? {
      nome: mv.risorsa?.nome ?? 'Non assegnato',
      costoOrario: mv.risorsa?.costoOrarioCentesimi ?? COSTO_ORARIO_DEFAULT_CENTESIMI,
      voci: 0,
      completate: 0,
      orePrev: 0,
      oreCons: 0,
      oreExtra: 0,
    };
    agg.voci += 1;
    if (mv.stato === 'done') agg.completate += 1;
    agg.orePrev += mv.orePreventivate;
    agg.oreCons += mv.oreConsuntivate;
    agg.oreExtra += mv.oreExtra;
    perOperatore.set(chiave, agg);
  }

  const righe: CellaReport[][] = [...perOperatore.values()]
    .sort((a, b) => b.oreCons - a.oreCons)
    .map((a) => [
      a.nome,
      a.voci,
      a.completate,
      a.orePrev,
      a.oreCons,
      a.oreExtra,
      euro(a.costoOrario),
      euro(a.oreCons * a.costoOrario),
    ]);

  const totale = [...perOperatore.values()].reduce(
    (t, a) => ({
      voci: t.voci + a.voci,
      completate: t.completate + a.completate,
      orePrev: t.orePrev + a.orePrev,
      oreCons: t.oreCons + a.oreCons,
      oreExtra: t.oreExtra + a.oreExtra,
      costo: t.costo + a.oreCons * a.costoOrario,
    }),
    { voci: 0, completate: 0, orePrev: 0, oreCons: 0, oreExtra: 0, costo: 0 },
  );

  return {
    chiave: 'ore-operatori',
    titolo: 'Ore per Operatore',
    sottotitolo: `Consuntivazione ore di progetto per risorsa · ${perOperatore.size} operatori`,
    intestazioni: ['Operatore', 'Voci assegnate', 'Voci completate', 'Ore preventivate', 'Ore consuntivate', 'Ore extra', 'Costo orario (€)', 'Costo totale (€)'],
    righe,
    colonneValuta: [6, 7],
    colonneOre: [3, 4, 5],
    colonnePercentuali: [],
    totali: [['TOTALE', totale.voci, totale.completate, totale.orePrev, totale.oreCons, totale.oreExtra, null, euro(totale.costo)]],
  };
}

// ──────────────────────────────────────────────────────────────────────────────
// 2. MARGINE PER PROGETTO
// ──────────────────────────────────────────────────────────────────────────────
export async function reportMarginePerProgetto(tenantId: string): Promise<ReportTabella> {
  const progetti = await prisma.progetto.findMany({
    where: { tenantId },
    include: {
      cliente: { select: { nome: true } },
      moduli: {
        include: { microvoci: { include: { risorsa: { select: { costoOrarioCentesimi: true } } } } },
      },
    },
    orderBy: { createdAt: 'desc' },
  });

  const righe: CellaReport[][] = [];
  let totValore = 0;
  let totCosto = 0;
  let totOrePrev = 0;
  let totOreCons = 0;

  for (const p of progetti) {
    let orePrev = 0;
    let oreCons = 0;
    let costo = 0;
    for (const m of p.moduli) {
      for (const mv of m.microvoci) {
        const costoOrario = mv.risorsa?.costoOrarioCentesimi ?? COSTO_ORARIO_DEFAULT_CENTESIMI;
        orePrev += mv.orePreventivate;
        oreCons += mv.oreConsuntivate;
        costo += mv.oreConsuntivate * costoOrario;
      }
    }
    const valore = p.valoreTotale;
    const margine = valore - costo;
    const marginePct = valore > 0 ? (margine / valore) * 100 : 0;

    totValore += valore;
    totCosto += costo;
    totOrePrev += orePrev;
    totOreCons += oreCons;

    righe.push([
      p.nome,
      p.cliente.nome,
      p.stato,
      euro(valore),
      orePrev,
      oreCons,
      euro(costo),
      euro(margine),
      Math.round(marginePct * 10) / 10,
    ]);
  }

  const margineTot = totValore - totCosto;
  return {
    chiave: 'margine-progetti',
    titolo: 'Margine per Progetto',
    sottotitolo: 'Ricavo contrattuale vs costo ore consuntivate · margine netto stimato',
    intestazioni: ['Progetto', 'Cliente', 'Stato', 'Valore (€)', 'Ore prev.', 'Ore cons.', 'Costo ore (€)', 'Margine (€)', 'Margine %'],
    righe,
    colonneValuta: [3, 6, 7],
    colonneOre: [4, 5],
    colonnePercentuali: [8],
    totali: [['TOTALE', null, null, euro(totValore), totOrePrev, totOreCons, euro(totCosto), euro(margineTot), totValore > 0 ? Math.round((margineTot / totValore) * 1000) / 10 : null]],
    riepilogo: [
      { etichetta: 'Valore complessivo', valore: fmtEuro(euro(totValore)) },
      { etichetta: 'Costo ore stimato', valore: fmtEuro(euro(totCosto)) },
      { etichetta: 'Margine netto', valore: fmtEuro(euro(margineTot)) },
    ],
  };
}

// ──────────────────────────────────────────────────────────────────────────────
// 3. RICAVI MENSILI
// ──────────────────────────────────────────────────────────────────────────────
export async function reportRicaviMensili(tenantId: string, anno?: number): Promise<ReportTabella> {
  const documenti = await prisma.fattura.findMany({
    where: { tenantId, stato: { in: ['emessa', 'incassata'] } },
    include: { righe: { select: { importo: true } } },
    orderBy: { data: 'asc' },
  });

  interface MeseAggregato { emesse: number; noteCredito: number; lordo: number; rettifiche: number }
  const perMese = new Map<string, MeseAggregato>();

  for (const f of documenti) {
    // Le fatture emesse/incassate hanno sempre `data`; le bozze senza data non
    // concorrono al report e vengono saltate (nessun mese fittizio).
    if (!f.data) continue;
    const base = f.data;
    const y = base.getUTCFullYear();
    if (anno && y !== anno) continue;
    const chiave = `${y}-${String(base.getUTCMonth() + 1).padStart(2, '0')}`;
    const agg = perMese.get(chiave) ?? { emesse: 0, noteCredito: 0, lordo: 0, rettifiche: 0 };
    const imponibile = f.righe.reduce((s, r) => s + r.importo, 0);
    if (f.tipoDocumento === 'nota_credito') {
      agg.noteCredito += 1;
      agg.rettifiche += imponibile;
    } else {
      agg.emesse += 1;
      agg.lordo += imponibile;
    }
    perMese.set(chiave, agg);
  }

  const NOMI_MESI = ['Gen', 'Feb', 'Mar', 'Apr', 'Mag', 'Giu', 'Lug', 'Ago', 'Set', 'Ott', 'Nov', 'Dic'];
  const righe: CellaReport[][] = [...perMese.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([chiave, agg]) => {
      const [y, m] = chiave.split('-');
      const etichetta = `${NOMI_MESI[Number(m) - 1]} ${y}`;
      return [etichetta, agg.emesse, agg.noteCredito, euro(agg.lordo), euro(agg.rettifiche), euro(agg.lordo - agg.rettifiche)];
    });

  const totLordo = [...perMese.values()].reduce((s, a) => s + a.lordo, 0);
  const totRett = [...perMese.values()].reduce((s, a) => s + a.rettifiche, 0);
  const totEmesse = [...perMese.values()].reduce((s, a) => s + a.emesse, 0);
  const totNc = [...perMese.values()].reduce((s, a) => s + a.noteCredito, 0);

  return {
    chiave: 'ricavi-mensili',
    titolo: 'Ricavi Mensili',
    sottotitolo: (anno ? `Anno ${anno}` : 'Tutti gli anni') + ' · fatture emesse al netto delle note di credito',
    intestazioni: ['Mese', 'Fatture emesse', 'Note di credito', 'Ricavi lordi (€)', 'Rettifiche NC (€)', 'Ricavi netti (€)'],
    righe,
    colonneValuta: [3, 4, 5],
    colonneOre: [],
    colonnePercentuali: [],
    totali: [['TOTALE', totEmesse, totNc, euro(totLordo), euro(totRett), euro(totLordo - totRett)]],
    riepilogo: [
      { etichetta: 'Ricavi netti periodo', valore: fmtEuro(euro(totLordo - totRett)) },
      { etichetta: 'Documenti emessi', valore: `${totEmesse} fatture, ${totNc} note di credito` },
    ],
  };
}

// ──────────────────────────────────────────────────────────────────────────────
// 4. SCADENZARIO INCASSI
// ──────────────────────────────────────────────────────────────────────────────
export async function reportScadenzario(tenantId: string): Promise<ReportTabella> {
  const scadenze = await prisma.scadenzaIncasso.findMany({
    where: { tenantId, stato: { in: ['in_attesa', 'parziale', 'scaduto'] } },
    include: {
      fattura: { include: { progetto: { include: { cliente: { select: { nome: true } } } } } },
      registrazioniRegistrate: { select: { importoIncassatoCentesimi: true } },
    },
    orderBy: { dataScadenza: 'asc' },
  });

  const oggi = new Date();
  oggi.setUTCHours(0, 0, 0, 0);

  const righe: CellaReport[][] = [];
  let totImporto = 0;
  let totIncassato = 0;
  let totResiduo = 0;
  let scadute = 0;

  for (const s of scadenze) {
    const incassato = s.registrazioniRegistrate.reduce((sum, r) => sum + r.importoIncassatoCentesimi, 0);
    const residuo = Math.max(0, s.importoCentesimi - incassato);
    const giorni = Math.round((new Date(s.dataScadenza).getTime() - oggi.getTime()) / 86400000);
    if (giorni < 0) scadute += 1;

    totImporto += s.importoCentesimi;
    totIncassato += incassato;
    totResiduo += residuo;

    righe.push([
      new Date(s.dataScadenza).toLocaleDateString('it-IT'),
      s.fattura.progetto.cliente.nome,
      s.fattura.numero || `${s.fattura.serie}-${s.fattura.numeroProgressivoSerie}`,
      `Rata ${s.numeroRata}`,
      euro(s.importoCentesimi),
      euro(incassato),
      euro(residuo),
      giorni < 0 ? `Scaduta da ${-giorni} gg` : giorni === 0 ? 'Scade oggi' : `Tra ${giorni} gg`,
    ]);
  }

  return {
    chiave: 'scadenzario',
    titolo: 'Scadenzario Incassi',
    sottotitolo: 'Partite aperte (in attesa, parziali, scadute) ordinate per scadenza',
    intestazioni: ['Scadenza', 'Cliente', 'Fattura', 'Rata', 'Importo (€)', 'Incassato (€)', 'Residuo (€)', 'Situazione'],
    righe,
    colonneValuta: [4, 5, 6],
    colonneOre: [],
    colonnePercentuali: [],
    totali: [['TOTALE', null, null, null, euro(totImporto), euro(totIncassato), euro(totResiduo), null]],
    riepilogo: [
      { etichetta: 'Residuo da incassare', valore: fmtEuro(euro(totResiduo)) },
      { etichetta: 'Scadenze aperte', valore: `${righe.length} (${scadute} scadute)` },
    ],
  };
}

// ──────────────────────────────────────────────────────────────────────────────
// 5. REDDITIVITÀ PER CLIENTE
// ──────────────────────────────────────────────────────────────────────────────
export async function reportRedditivitaPerCliente(tenantId: string): Promise<ReportTabella> {
  const clienti = await prisma.cliente.findMany({
    where: { tenantId },
    include: {
      progetti: {
        include: {
          moduli: { include: { microvoci: { include: { risorsa: { select: { costoOrarioCentesimi: true } } } } } },
        },
      },
    },
    orderBy: { nome: 'asc' },
  });

  const righe: CellaReport[][] = [];
  let totValore = 0;
  let totCosto = 0;

  for (const c of clienti) {
    let valore = 0;
    let costo = 0;
    let oreCons = 0;
    for (const p of c.progetti) {
      valore += p.valoreTotale;
      for (const m of p.moduli) {
        for (const mv of m.microvoci) {
          const costoOrario = mv.risorsa?.costoOrarioCentesimi ?? COSTO_ORARIO_DEFAULT_CENTESIMI;
          oreCons += mv.oreConsuntivate;
          costo += mv.oreConsuntivate * costoOrario;
        }
      }
    }
    // Salta clienti senza progetti: non hanno alcun dato di redditività da mostrare.
    if (c.progetti.length === 0) continue;

    const margine = valore - costo;
    const marginePct = valore > 0 ? (margine / valore) * 100 : 0;
    totValore += valore;
    totCosto += costo;

    righe.push([
      c.nome,
      c.progetti.length,
      euro(valore),
      oreCons,
      euro(costo),
      euro(margine),
      Math.round(marginePct * 10) / 10,
    ]);
  }

  righe.sort((a, b) => ((b[5] as number) ?? 0) - ((a[5] as number) ?? 0));
  const margineTot = totValore - totCosto;

  return {
    chiave: 'redditivita-clienti',
    titolo: 'Redditività per Cliente',
    sottotitolo: 'Valore dei progetti vs costo ore · ordinato per margine decrescente',
    intestazioni: ['Cliente', 'Progetti', 'Valore (€)', 'Ore cons.', 'Costo ore (€)', 'Margine (€)', 'Margine %'],
    righe,
    colonneValuta: [2, 4, 5],
    colonneOre: [3],
    colonnePercentuali: [6],
    totali: [['TOTALE', null, euro(totValore), null, euro(totCosto), euro(margineTot), totValore > 0 ? Math.round((margineTot / totValore) * 1000) / 10 : null]],
    riepilogo: [
      { etichetta: 'Valore complessivo', valore: fmtEuro(euro(totValore)) },
      { etichetta: 'Margine netto', valore: fmtEuro(euro(margineTot)) },
    ],
  };
}

/** Registro dei report disponibili: usato dalle rotte per validare il tipo richiesto. */
export const REPORT_DISPONIBILI = [
  'ore-operatori',
  'margine-progetti',
  'ricavi-mensili',
  'scadenzario',
  'redditivita-clienti',
] as const;

export type ChiaveReport = (typeof REPORT_DISPONIBILI)[number];

/**
 * Costruisce il report richiesto. Punto d'ingresso unico per le rotte JSON e di export.
 */
export async function costruisciReport(tenantId: string, chiave: ChiaveReport, anno?: number): Promise<ReportTabella> {
  switch (chiave) {
    case 'ore-operatori':
      return reportOrePerOperatore(tenantId);
    case 'margine-progetti':
      return reportMarginePerProgetto(tenantId);
    case 'ricavi-mensili':
      return reportRicaviMensili(tenantId, anno);
    case 'scadenzario':
      return reportScadenzario(tenantId);
    case 'redditivita-clienti':
      return reportRedditivitaPerCliente(tenantId);
  }
}
