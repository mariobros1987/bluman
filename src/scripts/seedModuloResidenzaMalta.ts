/**
 * Seed MIRATO e idempotente del solo modulo di libreria «Trasferimento di residenza a Malta»
 * (`mod-r01`) + le sue 6 microvoci, per il tenant Bluecode.
 *
 * A differenza di `seedFull.ts` (che crea anche clienti, utenti e una fattura DEMO) qui NON si
 * tocca alcun dato demo: si aggiunge solo la configurazione del modulo. Upsert per id → ripetibile
 * senza duplicati. Client amministrativo (scavalca RLS, legittimo per un seed).
 *
 * Uso: npx tsx src/scripts/seedModuloResidenzaMalta.ts
 */
import { prismaAmministrativo } from '../util/prismaClient.js';

const prisma = prismaAmministrativo();
const TENANT_ID = '00000000-0000-0000-0000-000000000001';

const ARTICOLI = [
  { id: 'art-r01', nome: 'Onboarding e raccolta documenti guest', cat: 'Compliance', h: 2, p: 300 },
  { id: 'art-r02', nome: 'Accordo di ospitalità (posto letto)', cat: 'Legale', h: 2, p: 300 },
  { id: 'art-r03', nome: 'Contratto di servizi al guest', cat: 'Legale', h: 2, p: 300 },
  { id: 'art-r04', nome: 'Registrazione Housing Authority Malta', cat: 'Legale', h: 3, p: 400 },
  { id: 'art-r05', nome: 'Informativa privacy GDPR e consensi', cat: 'Compliance', h: 1, p: 150 },
  { id: 'art-r06', nome: 'Assistenza pratiche amministrative residenza', cat: 'Legale', h: 4, p: 600 },
];

async function main() {
  for (const a of ARTICOLI) {
    await prisma.articolo.upsert({
      where: { id: a.id },
      update: {},
      create: { id: a.id, tenantId: TENANT_ID, nome: a.nome, categoria: a.cat, oreDefault: a.h, prezzoDefault: a.p * 100, versione: 1 },
    });
  }

  // giur-mt potrebbe non esistere su un DB non seminato con seedFull: in tal caso lascio null
  // (il modulo funziona lo stesso, solo non tag Malta) invece di far fallire la FK.
  const giurMalta = await prisma.giurisdizione.findUnique({ where: { id: 'giur-mt' } });
  const giurisdizioneId = giurMalta ? 'giur-mt' : null;

  await prisma.moduloTemplate.upsert({
    where: { id: 'mod-r01' },
    update: { giurisdizioneId },
    create: {
      id: 'mod-r01',
      tenantId: TENANT_ID,
      nome: 'Trasferimento di residenza a Malta',
      categoria: 'Legale',
      versione: 1,
      giurisdizioneId,
      righeDistinta: {
        create: ARTICOLI.map((a, i) => ({ tenantId: TENANT_ID, articoloId: a.id, articoloVersione: 1, ordine: i + 1, quantita: 1 })),
      },
    },
  });

  const modulo = await prisma.moduloTemplate.findUnique({ where: { id: 'mod-r01' }, include: { righeDistinta: true } });
  console.log(`✅ mod-r01 «${modulo?.nome}» — ${modulo?.righeDistinta.length ?? 0} microvoci, giurisdizione: ${giurisdizioneId ?? 'nessuna'}`);
  await prisma.$disconnect();
}

main().catch((e) => { console.error(e); process.exit(1); });
