/**
 * Backfill KYC (Fase 5.5.1, decisione titolare #3): per i clienti ESISTENTI con una `data_kyc`
 * valorizzata e interpretabile come data, crea un FascicoloKyc già `approvato` con quella scadenza;
 * i clienti senza data (o con data non interpretabile) NON ricevono nulla — resteranno «nessun
 * fascicolo» (= non iniziato), senza inventare una scadenza (regola 7).
 *
 * Uso (script di manutenzione, mai un endpoint HTTP):
 *   npx tsx src/scripts/backfillKyc.ts            → dry-run: elenca soltanto, non scrive
 *   npx tsx src/scripts/backfillKyc.ts --conferma → crea davvero i fascicoli
 *
 * Usa il client amministrativo (scavalca RLS: legittimo solo per script/manutenzione) e imposta
 * il tenantId esplicito su ogni riga creata. Idempotente: salta i clienti che hanno già un fascicolo.
 */
import { prismaAmministrativo } from '../util/prismaClient.js';

const prisma = prismaAmministrativo();

/** Interpreta la stringa legacy `data_kyc`. Ritorna null se non è una data affidabile. */
function parseDataKyc(raw: string): Date | null {
  const s = (raw || '').trim();
  if (!s) return null;
  // dd/mm/yyyy o dd-mm-yyyy
  const m = s.match(/^(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{4})$/);
  if (m) {
    const d = new Date(Number(m[3]), Number(m[2]) - 1, Number(m[1]));
    return isNaN(d.getTime()) ? null : d;
  }
  // ISO completa (yyyy-mm-dd...) — una sola yyyy-mm non basta (giorno inventato)
  if (/^\d{4}-\d{2}-\d{2}/.test(s)) {
    const d = new Date(s);
    return isNaN(d.getTime()) ? null : d;
  }
  return null;
}

async function main() {
  const conferma = process.argv.includes('--conferma');
  const rischioValidi = new Set(['basso', 'medio', 'alto']);
  const clienti = await prisma.cliente.findMany({
    where: { NOT: [{ dataKyc: null }, { dataKyc: '' }] },
    select: { id: true, tenantId: true, nome: true, dataKyc: true, rischioAml: true },
  });

  let creati = 0;
  let saltatiEsistente = 0;
  let saltatiData = 0;

  for (const c of clienti) {
    const esistente = await prisma.fascicoloKyc.findFirst({ where: { clienteId: c.id }, select: { id: true } });
    if (esistente) { saltatiEsistente += 1; continue; }
    const dataVerifica = parseDataKyc(c.dataKyc || '');
    if (!dataVerifica) { saltatiData += 1; console.log(`  ~ SALTATO (data non interpretabile "${c.dataKyc}"): ${c.nome}`); continue; }

    const dataScadenza = new Date(dataVerifica);
    dataScadenza.setMonth(dataScadenza.getMonth() + 12);
    const rischio = rischioValidi.has(c.rischioAml || '') ? (c.rischioAml as 'basso' | 'medio' | 'alto') : 'basso';
    const scaduto = dataScadenza.getTime() < Date.now();

    console.log(`  ${conferma ? '+' : '·'} ${c.nome}: verifica ${dataVerifica.toISOString().slice(0, 10)}, scad ${dataScadenza.toISOString().slice(0, 10)}${scaduto ? ' (già scaduto)' : ''}, rischio ${rischio}`);
    if (conferma) {
      await prisma.fascicoloKyc.create({
        data: {
          tenantId: c.tenantId,
          clienteId: c.id,
          stato: scaduto ? 'scaduto' : 'approvato',
          livelloVerifica: 'ordinaria',
          rischioCalcolato: rischio,
          punteggioRischio: 0,
          dataVerifica,
          dataScadenza,
          approvatoDa: 'backfill',
          approvatoIl: new Date(),
          noteCompliance: `Backfill dal campo legacy data_kyc ("${c.dataKyc}").`,
          storico: {
            create: {
              tenantId: c.tenantId,
              statoNuovo: scaduto ? 'scaduto' : 'approvato',
              attoreUserId: 'backfill',
              motivazione: 'Fascicolo creato da backfill dei dati KYC legacy',
            },
          },
        },
      });
      creati += 1;
    }
  }

  console.log(`\nClienti con data_kyc: ${clienti.length} | creati: ${conferma ? creati : 0} | saltati (già con fascicolo): ${saltatiEsistente} | saltati (data non interpretabile): ${saltatiData}`);
  if (!conferma) console.log('DRY-RUN: nessun fascicolo creato. Rilancia con --conferma per scrivere.');
  await prisma.$disconnect();
}

main().catch((e) => { console.error(e); process.exit(1); });
