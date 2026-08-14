import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

const TENANT_ID = '00000000-0000-0000-0000-000000000001';

async function main() {
  console.log('🌱 Avvio Seed Completo su Supabase...');

  // 1. Tenant
  const tenant = await prisma.tenant.upsert({
    where: { id: TENANT_ID },
    update: {},
    create: {
      id: TENANT_ID,
      ragioneSociale: 'Bluecode Ltd (Malta)',
      piano: 'attivo',
      stato: 'attivo',
    },
  });
  console.log('✅ Tenant creato:', tenant.ragioneSociale);

  // 2. Users
  const userAdmin = await prisma.user.upsert({
    where: { email: 'joe@bluecode.advisory' },
    update: {},
    create: {
      id: '11111111-1111-1111-1111-111111111111',
      tenantId: TENANT_ID,
      nome: 'Joe Disabato',
      email: 'joe@bluecode.advisory',
      ruolo: 'super_admin',
      stato: 'attivo',
    },
  });
  console.log('✅ User creato:', userAdmin.nome);

  // 3. Articoli
  const articoliData = [
    { id: 'art-01', nome: 'Raccolta documentazione cliente', cat: 'Analisi', h: 2, p: 600 },
    { id: 'art-02', nome: 'Analisi struttura patrimoniale esistente', cat: 'Analisi', h: 4, p: 1200 },
    { id: 'art-03', nome: 'Report analisi iniziale', cat: 'Analisi', h: 3, p: 900 },
    { id: 'art-04', nome: 'Presentazione al cliente', cat: 'Analisi', h: 2, p: 600 },
    { id: 'art-05', nome: 'Validazione e firma engagement letter', cat: 'Analisi', h: 1, p: 200 },
    { id: 'art-06', nome: 'Studio struttura societaria ottimale', cat: 'Societario', h: 6, p: 1800 },
    { id: 'art-07', nome: 'Costituzione società', cat: 'Societario', h: 10, p: 3000 },
    { id: 'art-08', nome: 'Atto costitutivo e statuto', cat: 'Societario', h: 6, p: 1800 },
    { id: 'art-09', nome: 'Contratto di servizio intercompany', cat: 'Societario', h: 6, p: 1800 },
    { id: 'art-10', nome: 'Registrazione MFSA', cat: 'Societario', h: 6, p: 1800 },
    { id: 'art-11', nome: 'Selezione trust company idonea', cat: 'Trust', h: 4, p: 1200 },
    { id: 'art-12', nome: 'Redazione deed of trust', cat: 'Trust', h: 10, p: 2800 },
    { id: 'art-13', nome: 'Selezione banche idonee', cat: 'Banking', h: 3, p: 650 },
    { id: 'art-14', nome: 'Raccolta e verifica documentazione KYC', cat: 'Compliance', h: 5, p: 1150 },
    { id: 'art-15', nome: 'Apertura conto corrente singolo', cat: 'Banking', h: 4, p: 900 },
  ];

  const articoliMap = new Map<string, string>();

  for (const art of articoliData) {
    const created = await prisma.articolo.upsert({
      where: { id: art.id },
      update: {},
      create: {
        id: art.id,
        tenantId: TENANT_ID,
        nome: art.nome,
        categoria: art.cat,
        oreDefault: art.h,
        prezzoDefault: art.p * 100, // in centesimi
        versione: 1,
      },
    });
    articoliMap.set(art.id, created.id);
  }
  console.log('✅ Articoli creati:', articoliData.length);

  // 4. Moduli Template
  const m01 = await prisma.moduloTemplate.upsert({
    where: { id: 'mod-m01' },
    update: {},
    create: {
      id: 'mod-m01',
      tenantId: TENANT_ID,
      nome: 'Analisi patrimoniale iniziale',
      categoria: 'Analisi',
      versione: 1,
      righeDistinta: {
        create: [
          { tenantId: TENANT_ID, articoloId: 'art-01', articoloVersione: 1, ordine: 1, quantita: 1 },
          { tenantId: TENANT_ID, articoloId: 'art-02', articoloVersione: 1, ordine: 2, quantita: 1 },
          { tenantId: TENANT_ID, articoloId: 'art-03', articoloVersione: 1, ordine: 3, quantita: 1 },
          { tenantId: TENANT_ID, articoloId: 'art-04', articoloVersione: 1, ordine: 4, quantita: 1 },
          { tenantId: TENANT_ID, articoloId: 'art-05', articoloVersione: 1, ordine: 5, quantita: 1 },
        ],
      },
    },
  });

  const m02 = await prisma.moduloTemplate.upsert({
    where: { id: 'mod-m02' },
    update: {},
    create: {
      id: 'mod-m02',
      tenantId: TENANT_ID,
      nome: 'Corporate structuring Malta',
      categoria: 'Societario',
      versione: 1,
      prezzoPacchetto: 11500 * 100,
      righeDistinta: {
        create: [
          { tenantId: TENANT_ID, articoloId: 'art-06', articoloVersione: 1, ordine: 1, quantita: 1 },
          { tenantId: TENANT_ID, articoloId: 'art-07', articoloVersione: 1, ordine: 2, quantita: 1 },
          { tenantId: TENANT_ID, articoloId: 'art-08', articoloVersione: 1, ordine: 3, quantita: 1 },
          { tenantId: TENANT_ID, articoloId: 'art-09', articoloVersione: 1, ordine: 4, quantita: 1 },
          { tenantId: TENANT_ID, articoloId: 'art-10', articoloVersione: 1, ordine: 5, quantita: 1 },
        ],
      },
    },
  });

  console.log('✅ Moduli Template creati');

  // 5. Clienti
  const c1 = await prisma.cliente.upsert({
    where: { id: 'cli-01' },
    update: {},
    create: {
      id: 'cli-01',
      tenantId: TENANT_ID,
      nome: 'Marco Ricci',
      tipo: 'individual',
    },
  });

  const c2 = await prisma.cliente.upsert({
    where: { id: 'cli-02' },
    update: {},
    create: {
      id: 'cli-02',
      tenantId: TENANT_ID,
      nome: 'Belfort Industries S.A.',
      tipo: 'company',
    },
  });

  console.log('✅ Clienti creati:', c1.nome, ',', c2.nome);

  // 6. Progetto 1
  const p1 = await prisma.progetto.upsert({
    where: { id: 'proj-01' },
    update: {},
    create: {
      id: 'proj-01',
      tenantId: TENANT_ID,
      clienteId: c1.id,
      nome: 'Struttura Holding — Famiglia Ricci',
      stato: 'in_progress',
      valoreTotale: 38000 * 100,
    },
  });

  // Moduli progetto per P1
  const mp1 = await prisma.moduloProgetto.upsert({
    where: { id: 'mp-01' },
    update: {},
    create: {
      id: 'mp-01',
      tenantId: TENANT_ID,
      progettoId: p1.id,
      moduloTemplateId: m01.id,
      moduloTemplateVersione: 1,
      nome: 'Analisi patrimoniale iniziale',
      categoria: 'Analisi',
      prezzo: 3500 * 100,
      orePreventivate: 12,
      oreConsuntivate: 11,
      stato: 'done',
    },
  });

  const mp2 = await prisma.moduloProgetto.upsert({
    where: { id: 'mp-02' },
    update: {},
    create: {
      id: 'mp-02',
      tenantId: TENANT_ID,
      progettoId: p1.id,
      moduloTemplateId: m02.id,
      moduloTemplateVersione: 1,
      nome: 'Corporate structuring Malta',
      categoria: 'Societario',
      prezzo: 12000 * 100,
      orePreventivate: 40,
      oreConsuntivate: 28,
      stato: 'in_progress',
    },
  });

  console.log('✅ Progetti e moduli progetto creati su Supabase!');
  console.log('🎉 Seed completato con successo!');
}

main()
  .catch((e) => {
    console.error('❌ Errore nel seed:', e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
