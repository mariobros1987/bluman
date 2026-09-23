import { prismaAmministrativo } from '../../util/prismaClient.js';

// Seed: connessione amministrativa (§14). Crea il tenant stesso, quindi non può
// dipendere da un tenant già impostato nel contesto.
const prisma = prismaAmministrativo();

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
  //
  // §2bis — il super_admin sovrintende tutti i tenant, quindi non appartiene a nessuno:
  // `tenantId` è NULL. Non è una finezza di modellazione, è l'invariante su cui si appoggia
  // la policy RLS di `public."user"` (`tenant_id IS NULL AND app_ruolo_corrente() =
  // 'super_admin'`). Con un tenant valorizzato il super admin diventa un utente ordinario
  // di quello studio, e l'advisor di quello studio può modificarlo.
  //
  // `update` non è vuoto per queste due righe, a differenza delle altre: se il database
  // contiene già un super_admin con un tenant — come è successo — rieseguire il seed lo
  // riporta all'invariante invece di lasciarlo com'è.
  const userAdmin = await prisma.user.upsert({
    where: { email: 'joe@bluecode.advisory' },
    update: { tenantId: null },
    create: {
      id: '11111111-1111-1111-1111-111111111111',
      tenantId: null,
      nome: 'Joe Disabato',
      email: 'joe@bluecode.advisory',
      ruolo: 'super_admin',
      stato: 'attivo',
    },
  });

  await prisma.user.upsert({
    where: { email: 'admin@bluecode.advisory' },
    update: { tenantId: null },
    create: {
      id: '22222222-2222-2222-2222-222222222222',
      tenantId: null,
      nome: 'Super Admin',
      email: 'admin@bluecode.advisory',
      ruolo: 'super_admin',
      stato: 'attivo',
    },
  });

  await prisma.user.upsert({
    where: { email: 'operator@bluecode.advisory' },
    update: {},
    create: {
      id: '33333333-3333-3333-3333-333333333333',
      tenantId: TENANT_ID,
      nome: 'Elena Rossi',
      email: 'operator@bluecode.advisory',
      ruolo: 'collaboratore_interno',
      stato: 'attivo',
    },
  });

  await prisma.user.upsert({
    where: { email: 'francesca@bluecode.advisory' },
    update: {},
    create: {
      id: '44444444-4444-4444-4444-444444444444',
      tenantId: TENANT_ID,
      nome: 'Francesca Disabato',
      email: 'francesca@bluecode.advisory',
      ruolo: 'collaboratore_interno',
      stato: 'attivo',
    },
  });

  await prisma.user.upsert({
    where: { email: 'lorenzo@bluecode.advisory' },
    update: {},
    create: {
      id: '55555555-5555-5555-5555-555555555555',
      tenantId: TENANT_ID,
      nome: 'Avv. Lorenzo Marino',
      email: 'lorenzo@bluecode.advisory',
      ruolo: 'collaboratore_interno',
      stato: 'attivo',
    },
  });
  console.log('✅ Utenti Team creati su Supabase');

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
    // Servizi trasferimento di residenza a Malta (documenti reali Bluecode)
    { id: 'art-r01', nome: 'Onboarding e raccolta documenti guest', cat: 'Compliance', h: 2, p: 300 },
    { id: 'art-r02', nome: 'Accordo di ospitalità (posto letto)', cat: 'Legale', h: 2, p: 300 },
    { id: 'art-r03', nome: 'Contratto di servizi al guest', cat: 'Legale', h: 2, p: 300 },
    { id: 'art-r04', nome: 'Registrazione Housing Authority Malta', cat: 'Legale', h: 3, p: 400 },
    { id: 'art-r05', nome: 'Informativa privacy GDPR e consensi', cat: 'Compliance', h: 1, p: 150 },
    { id: 'art-r06', nome: 'Assistenza pratiche amministrative residenza', cat: 'Legale', h: 4, p: 600 },
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

  // 3bis. Giurisdizioni
  const giurisdizioniData = [
    { id: 'giur-mt', nome: 'Malta', codice: 'MT', tipo: 'ue' as const, note: 'Repubblica di Malta — Hub finanziario UE' },
    { id: 'giur-gi', nome: 'Gibilterra', codice: 'GI', tipo: 'extra_ue' as const, note: 'Territorio d Oltremare Britannico (Extra-UE)' },
    { id: 'giur-fl', nome: 'Florida (USA)', codice: 'US-FL', tipo: 'stato_usa' as const, note: 'Stato degli Stati Uniti d America (Florida)' },
    { id: 'giur-de', nome: 'Delaware (USA)', codice: 'US-DE', tipo: 'stato_usa' as const, note: 'Stato degli Stati Uniti d America (Delaware)' },
    { id: 'giur-ae', nome: 'Emirati Arabi Uniti', codice: 'AE', tipo: 'extra_ue' as const, note: 'Dubai / Abu Dhabi Free Zones' },
  ];

  for (const g of giurisdizioniData) {
    await prisma.giurisdizione.upsert({
      where: { id: g.id },
      update: { nome: g.nome, codice: g.codice, tipo: g.tipo, note: g.note },
      create: {
        id: g.id,
        tenantId: TENANT_ID,
        nome: g.nome,
        codice: g.codice,
        tipo: g.tipo,
        note: g.note,
      },
    });
  }
  console.log('✅ Giurisdizioni create:', giurisdizioniData.length);

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
      giurisdizioneId: null, // Modulo Generico
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
    update: { giurisdizioneId: 'giur-mt' },
    create: {
      id: 'mod-m02',
      tenantId: TENANT_ID,
      nome: 'Corporate structuring Malta',
      categoria: 'Societario',
      versione: 1,
      giurisdizioneId: 'giur-mt', // Specifico Malta
      prezzoPacchetto: 11500 * 100,
      dipendenze: {
        create: [
          { tenantId: TENANT_ID, dipendeDaModuloTemplateId: 'mod-m01' },
        ],
      },
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

  const m03 = await prisma.moduloTemplate.upsert({
    where: { id: 'mod-m03' },
    update: {},
    create: {
      id: 'mod-m03',
      tenantId: TENANT_ID,
      nome: 'Holding internazionale',
      categoria: 'Societario',
      versione: 1,
      giurisdizioneId: null,
      dipendenze: { create: [{ tenantId: TENANT_ID, dipendeDaModuloTemplateId: 'mod-m01' }] },
      righeDistinta: {
        create: [
          { tenantId: TENANT_ID, articoloId: 'art-06', articoloVersione: 1, ordine: 1, quantita: 1 },
          { tenantId: TENANT_ID, articoloId: 'art-07', articoloVersione: 1, ordine: 2, quantita: 1 },
        ],
      },
    },
  });

  const m04 = await prisma.moduloTemplate.upsert({
    where: { id: 'mod-m04' },
    update: {},
    create: {
      id: 'mod-m04',
      tenantId: TENANT_ID,
      nome: 'Struttura Trust Elvetico',
      categoria: 'Trust',
      versione: 1,
      giurisdizioneId: null,
      dipendenze: { create: [{ tenantId: TENANT_ID, dipendeDaModuloTemplateId: 'mod-m01' }] },
      righeDistinta: {
        create: [
          { tenantId: TENANT_ID, articoloId: 'art-11', articoloVersione: 1, ordine: 1, quantita: 1 },
          { tenantId: TENANT_ID, articoloId: 'art-12', articoloVersione: 1, ordine: 2, quantita: 1 },
        ],
      },
    },
  });

  const m05 = await prisma.moduloTemplate.upsert({
    where: { id: 'mod-m05' },
    update: { giurisdizioneId: 'giur-mt' },
    create: {
      id: 'mod-m05',
      tenantId: TENANT_ID,
      nome: 'Apertura conti correnti Malta',
      categoria: 'Banking',
      versione: 1,
      giurisdizioneId: 'giur-mt',
      dipendenze: { create: [{ tenantId: TENANT_ID, dipendeDaModuloTemplateId: 'mod-m02' }] },
      righeDistinta: {
        create: [
          { tenantId: TENANT_ID, articoloId: 'art-13', articoloVersione: 1, ordine: 1, quantita: 1 },
          { tenantId: TENANT_ID, articoloId: 'art-14', articoloVersione: 1, ordine: 2, quantita: 1 },
          { tenantId: TENANT_ID, articoloId: 'art-15', articoloVersione: 1, ordine: 3, quantita: 1 },
        ],
      },
    },
  });

  const m06 = await prisma.moduloTemplate.upsert({
    where: { id: 'mod-m06' },
    update: {},
    create: {
      id: 'mod-m06',
      tenantId: TENANT_ID,
      nome: 'Tax planning internazionale Malta',
      categoria: 'Fiscale',
      versione: 1,
      giurisdizioneId: 'giur-mt',
      dipendenze: { create: [{ tenantId: TENANT_ID, dipendeDaModuloTemplateId: 'mod-m02' }] },
      righeDistinta: {
        create: [
          { tenantId: TENANT_ID, articoloId: 'art-03', articoloVersione: 1, ordine: 1, quantita: 1 },
          { tenantId: TENANT_ID, articoloId: 'art-08', articoloVersione: 1, ordine: 2, quantita: 1 },
        ],
      },
    },
  });

  console.log('✅ Moduli Template creati con dipendenze a cascata');

  // Modulo servizi di trasferimento di residenza a Malta (documenti reali Bluecode).
  // Standalone (nessuna dipendenza dai moduli corporate): si aggancia a un incarico di relocation.
  await prisma.moduloTemplate.upsert({
    where: { id: 'mod-r01' },
    update: { giurisdizioneId: 'giur-mt' },
    create: {
      id: 'mod-r01',
      tenantId: TENANT_ID,
      nome: 'Trasferimento di residenza a Malta',
      categoria: 'Legale',
      versione: 1,
      giurisdizioneId: 'giur-mt',
      righeDistinta: {
        create: [
          { tenantId: TENANT_ID, articoloId: 'art-r01', articoloVersione: 1, ordine: 1, quantita: 1 },
          { tenantId: TENANT_ID, articoloId: 'art-r02', articoloVersione: 1, ordine: 2, quantita: 1 },
          { tenantId: TENANT_ID, articoloId: 'art-r03', articoloVersione: 1, ordine: 3, quantita: 1 },
          { tenantId: TENANT_ID, articoloId: 'art-r04', articoloVersione: 1, ordine: 4, quantita: 1 },
          { tenantId: TENANT_ID, articoloId: 'art-r05', articoloVersione: 1, ordine: 5, quantita: 1 },
          { tenantId: TENANT_ID, articoloId: 'art-r06', articoloVersione: 1, ordine: 6, quantita: 1 },
        ],
      },
    },
  });
  console.log('✅ Modulo "Trasferimento di residenza a Malta" (mod-r01) creato');

  // Assicurati che le dipendenze siano sempre presenti su Supabase DB
  const depSeeds = [
    { moduloTemplateId: 'mod-m02', dipendeDaModuloTemplateId: 'mod-m01' },
    { moduloTemplateId: 'mod-m03', dipendeDaModuloTemplateId: 'mod-m01' },
    { moduloTemplateId: 'mod-m04', dipendeDaModuloTemplateId: 'mod-m01' },
    { moduloTemplateId: 'mod-m05', dipendeDaModuloTemplateId: 'mod-m02' },
    { moduloTemplateId: 'mod-m06', dipendeDaModuloTemplateId: 'mod-m02' },
  ];

  for (const dep of depSeeds) {
    const existing = await prisma.moduloDipendenzaTemplate.findFirst({
      where: { tenantId: TENANT_ID, moduloTemplateId: dep.moduloTemplateId, dipendeDaModuloTemplateId: dep.dipendeDaModuloTemplateId },
    });
    if (!existing) {
      await prisma.moduloDipendenzaTemplate.create({
        data: {
          tenantId: TENANT_ID,
          moduloTemplateId: dep.moduloTemplateId,
          dipendeDaModuloTemplateId: dep.dipendeDaModuloTemplateId,
        },
      });
    }
  }

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
    where: { id: 'prj-01' },
    update: {},
    create: {
      id: 'prj-01',
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

  // 7. Audit Logs Storico
  const auditEntries = [
    {
      userId: userAdmin.id,
      userEmail: userAdmin.email,
      userNome: userAdmin.nome,
      ruolo: 'super_admin',
      azione: 'AUTENTICAZIONE_LOGIN',
      entita: 'Sessione Studio',
      dettagli: 'Login effettuato con successo tramite credenziali cifrate da IP 83.211.12.94',
      ipAddress: '83.211.12.94',
    },
    {
      userId: userAdmin.id,
      userEmail: userAdmin.email,
      userNome: userAdmin.nome,
      ruolo: 'advisor',
      azione: 'CREAZIONE_CLIENTE',
      entita: 'Marco Ricci',
      dettagli: 'Creata nuova anagrafica ERP cliente privato con codice SDI e fascicolo KYC/AML',
      ipAddress: '83.211.12.94',
    },
    {
      userId: userAdmin.id,
      userEmail: userAdmin.email,
      userNome: userAdmin.nome,
      ruolo: 'advisor',
      azione: 'CREAZIONE_PROGETTO',
      entita: 'Struttura Holding — Famiglia Ricci',
      dettagli: 'Istanziato nuovo progetto per valore totale di €38.000,00 con 5 moduli distinti',
      ipAddress: '83.211.12.94',
    },
    {
      userId: userAdmin.id,
      userEmail: userAdmin.email,
      userNome: userAdmin.nome,
      ruolo: 'advisor',
      azione: 'MAGIC_LINK_GENERATO',
      entita: 'Marco Ricci',
      dettagli: 'Generato Magic Token di accesso passwordless al Portale Cliente per firma 1-click',
      ipAddress: '83.211.12.94',
    },
    {
      userId: userAdmin.id,
      userEmail: userAdmin.email,
      userNome: userAdmin.nome,
      ruolo: 'advisor',
      azione: 'EMISSIONE_FATTURA',
      entita: 'Fattura FT-2026/001',
      dettagli: 'Emessa fattura elettronica acconto per importo di €3.500,00 inviata su canale SDI',
      ipAddress: '83.211.12.94',
    },
    {
      userId: userAdmin.id,
      userEmail: userAdmin.email,
      userNome: userAdmin.nome,
      ruolo: 'advisor',
      azione: 'CONSUNTIVAZIONE_ORE',
      entita: 'Analisi struttura patrimoniale',
      dettagli: 'Registrate 4 ore di consulenza lavorate dall operatore con aggiornamento avanzamento modulo',
      ipAddress: '83.211.12.94',
    },
  ];

  for (const log of auditEntries) {
    await prisma.auditLog.create({
      data: {
        tenantId: TENANT_ID,
        ...log,
      },
    });
  }
  console.log('✅ Audit Log storico inserito su Supabase!');
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
