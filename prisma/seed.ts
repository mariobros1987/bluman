import { PrismaClient, RuoloUtente, StatoUtente, TipoGiurisdizione, TipoPassaggio, ChiPassaggio } from '@prisma/client';
import crypto from 'crypto';

const prisma = new PrismaClient();

function hashPassword(password: string): string {
  const salt = 'bluman_salt_2026_fixed';
  return crypto.scryptSync(password, salt, 64).toString('hex');
}

const TENANT_ID = '00000000-0000-0000-0000-000000000001';

async function main() {
  console.log('🚀 Avvio del seeding completo del Database Supabase / PostgreSQL...');

  // 1. TENANT MASTER
  const tenant = await prisma.tenant.upsert({
    where: { id: TENANT_ID },
    update: {
      ragioneSociale: 'Bluecode Advisory Malta Ltd',
      piva: 'MT28491039',
      codiceFiscale: 'MT28491039',
      sedeLegale: 'Level 4, Valuation Centre, Tower Road, Sliema SLM 1600, Malta',
      email: 'support@bluecode-ltd.com',
      telefono: '+356 2133 4455',
    },
    create: {
      id: TENANT_ID,
      ragioneSociale: 'Bluecode Advisory Malta Ltd',
      piva: 'MT28491039',
      codiceFiscale: 'MT28491039',
      sedeLegale: 'Level 4, Valuation Centre, Tower Road, Sliema SLM 1600, Malta',
      email: 'support@bluecode-ltd.com',
      telefono: '+356 2133 4455',
      piano: 'enterprise',
      stato: 'attivo',
    },
  });
  console.log('✓ Tenant configurato:', tenant.ragioneSociale);

  // 2. UTENTI E PROFESSIONISTI STUDIO
  const USERS = [
    {
      nome: 'Joe Disabato',
      email: 'joe@bluecode.advisory',
      ruolo: RuoloUtente.super_admin,
      password: 'password123',
      costoOrarioCentesimi: 12000,
    },
    {
      nome: 'Avv. Mario Dibenedetto',
      email: 'mario.dibenedetto@bluecode.advisory',
      ruolo: RuoloUtente.advisor,
      password: 'password123',
      costoOrarioCentesimi: 9500,
    },
    {
      nome: 'Avv. Lorenzo Marino',
      email: 'lorenzo.marino@bluecode.advisory',
      ruolo: RuoloUtente.advisor,
      password: 'password123',
      costoOrarioCentesimi: 9000,
    },
    {
      nome: 'Dr. Elena Russo',
      email: 'elena.russo@bluecode.advisory',
      ruolo: RuoloUtente.advisor,
      password: 'password123',
      costoOrarioCentesimi: 8500,
    },
    {
      nome: 'Francesca Disabato',
      email: 'francesca.disabato@bluecode.advisory',
      ruolo: RuoloUtente.collaboratore_interno,
      password: 'password123',
      costoOrarioCentesimi: 4500,
    },
    {
      nome: 'Super Admin',
      email: 'admin@bluecode.advisory',
      ruolo: RuoloUtente.super_admin,
      password: 'admin2026!',
      costoOrarioCentesimi: 15000,
    },
    {
      nome: 'Operatore Studio',
      email: 'operator@bluecode.advisory',
      ruolo: RuoloUtente.collaboratore_interno,
      password: 'operator123',
      costoOrarioCentesimi: 4000,
    },
  ];

  for (const u of USERS) {
    await prisma.user.upsert({
      where: { email: u.email },
      update: {
        nome: u.nome,
        ruolo: u.ruolo,
        tenantId: TENANT_ID,
        stato: StatoUtente.attivo,
        passwordHash: hashPassword(u.password),
        costoOrarioCentesimi: u.costoOrarioCentesimi,
      },
      create: {
        tenantId: TENANT_ID,
        nome: u.nome,
        email: u.email,
        ruolo: u.ruolo,
        stato: StatoUtente.attivo,
        passwordHash: hashPassword(u.password),
        costoOrarioCentesimi: u.costoOrarioCentesimi,
      },
    });
  }
  console.log(`✓ ${USERS.length} Utenti e Advisor inseriti nel DB.`);

  // 3. GIURISDIZIONI INTERNAZIONALI
  const GIURISDIZIONI = [
    { id: 'giur-mt', nome: 'Malta', codice: 'MT', tipo: TipoGiurisdizione.ue, note: 'Repubblica di Malta — Hub finanziario UE' },
    { id: 'giur-gi', nome: 'Gibilterra', codice: 'GI', tipo: TipoGiurisdizione.extra_ue, note: 'Territorio d Oltremare Britannico (Extra-UE)' },
    { id: 'giur-fl', nome: 'Florida (USA)', codice: 'US-FL', tipo: TipoGiurisdizione.stato_usa, note: 'Stato degli Stati Uniti d America (Florida)' },
    { id: 'giur-de', nome: 'Delaware (USA)', codice: 'US-DE', tipo: TipoGiurisdizione.stato_usa, note: 'Stato degli Stati Uniti d America (Delaware)' },
    { id: 'giur-ae', nome: 'Emirati Arabi Uniti', codice: 'AE', tipo: TipoGiurisdizione.extra_ue, note: 'Dubai / Abu Dhabi Free Zones' },
  ];

  for (const g of GIURISDIZIONI) {
    await prisma.giurisdizione.upsert({
      where: { id: g.id },
      update: {
        nome: g.nome,
        codice: g.codice,
        tipo: g.tipo,
        note: g.note,
        tenantId: TENANT_ID,
      },
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
  console.log(`✓ ${GIURISDIZIONI.length} Giurisdizioni inserite.`);

  // 4. ARTICOLI DI LISTINO / DISTINTA BASE (26 Articoli)
  const ARTICOLI = [
    { id: 'A_RACCOLTA_DOC', nome: 'Raccolta documentazione cliente', cat: 'Analisi', h: 2, p: 60000, ver: 2, formMasterId: 'f3' },
    { id: 'A_ANALISI_STRUTT', nome: 'Analisi struttura patrimoniale esistente', cat: 'Analisi', h: 4, p: 120000, ver: 2 },
    { id: 'A_REPORT_ANALISI', nome: 'Report analisi iniziale', cat: 'Analisi', h: 3, p: 90000, ver: 1 },
    { id: 'A_PRESENT_CLIENTE', nome: 'Presentazione al cliente', cat: 'Analisi', h: 2, p: 60000, ver: 1 },
    { id: 'A_FIRMA_ENG', nome: 'Validazione e firma engagement letter', cat: 'Analisi', h: 1, p: 20000, ver: 1 },
    { id: 'A_STUDIO_STRUTT', nome: 'Studio struttura societaria ottimale', cat: 'Societario', h: 6, p: 180000, ver: 2 },
    { id: 'A_COST_SOCIETA', nome: 'Costituzione società', cat: 'Societario', h: 10, p: 300000, ver: 3, formMasterId: 'f1' },
    { id: 'A_ATTO_COST', nome: 'Atto costitutivo e statuto', cat: 'Societario', h: 6, p: 180000, ver: 2, formMasterId: 'f1' },
    { id: 'A_CONTRATTO_INTERCOMPANY', nome: 'Contratto di servizio intercompany', cat: 'Societario', h: 6, p: 180000, ver: 1 },
    { id: 'A_REG_MFSA', nome: 'Registrazione MFSA', cat: 'Societario', h: 6, p: 180000, ver: 1 },
    { id: 'A_REG_FISCALE', nome: 'Registrazione fiscale', cat: 'Societario', h: 4, p: 120000, ver: 1 },
    { id: 'A_UBO', nome: 'Documentazione UBO Registry', cat: 'Societario', h: 2, p: 60000, ver: 1, formMasterId: 'f2' },
    { id: 'A_SEL_GIURISDIZIONE', nome: 'Selezione giurisdizione', cat: 'Societario', h: 6, p: 160000, ver: 1 },
    { id: 'A_COST_HOLDING', nome: 'Costituzione holding', cat: 'Societario', h: 10, p: 280000, ver: 1, formMasterId: 'f1' },
    { id: 'A_STRUTT_PARTECIPAZIONI', nome: 'Struttura partecipazioni', cat: 'Societario', h: 8, p: 220000, ver: 1 },
    { id: 'A_CONTRATTO_SERVIZIO', nome: 'Contratto di servizio', cat: 'Legale', h: 6, p: 180000, ver: 2 },
    { id: 'A_COMPLIANCE_ONGOING', nome: 'Compliance ongoing', cat: 'Societario', h: 5, p: 110000, ver: 1 },
    { id: 'A_SEL_TRUST_CO', nome: 'Selezione trust company idonea', cat: 'Trust', h: 4, p: 120000, ver: 1 },
    { id: 'A_DEED_TRUST', nome: 'Redazione deed of trust', cat: 'Trust', h: 10, p: 280000, ver: 2, formMasterId: 'f2' },
    { id: 'A_LETTER_WISHES', nome: 'Definizione letter of wishes', cat: 'Trust', h: 6, p: 170000, ver: 1 },
    { id: 'A_TRASF_ASSET', nome: 'Trasferimento asset al trust', cat: 'Trust', h: 6, p: 170000, ver: 1 },
    { id: 'A_REG_TRUST_MALTA', nome: 'Registrazione trust Malta', cat: 'Trust', h: 4, p: 110000, ver: 1 },
    { id: 'A_SEL_BANCHE', nome: 'Selezione banche idonee', cat: 'Banking', h: 3, p: 65000, ver: 1 },
    { id: 'A_KYC_CLIENTE', nome: 'Raccolta e verifica documentazione KYC', cat: 'Compliance', h: 5, p: 115000, ver: 2, formMasterId: 'f3' },
    { id: 'A_APERTURA_CONTO', nome: 'Apertura conto corrente singolo', cat: 'Banking', h: 4, p: 90000, ver: 1 },
    { id: 'A_INTERNET_BANKING', nome: 'Configurazione internet banking', cat: 'Banking', h: 2, p: 45000, ver: 1 },
    { id: 'A_TEST_TRANSAZIONI', nome: 'Test flussi transazionali', cat: 'Banking', h: 2, p: 45000, ver: 1 },
    { id: 'A_LICENSING_IP', nome: 'Accordo licensing IP', cat: 'Legale', h: 6, p: 150000, ver: 1 },
    { id: 'A_LOAN_INTERCOMPANY', nome: 'Loan intercompany', cat: 'Legale', h: 5, p: 120000, ver: 1 },
    { id: 'A_MGMT_AGREEMENT', nome: 'Management agreement', cat: 'Legale', h: 4, p: 80000, ver: 1 },
    { id: 'A_REVISIONE_LEGALE', nome: 'Revisione e negoziazione legale', cat: 'Legale', h: 4, p: 70000, ver: 1 },
    { id: 'A_CONTR_DISTRIBUZIONE', nome: 'Contratto di distribuzione', cat: 'Legale', h: 8, p: 200000, ver: 1 },
    { id: 'A_NDA', nome: 'NDA e accordo di riservatezza', cat: 'Legale', h: 3, p: 70000, ver: 1 },
    { id: 'A_CONTR_AGENZIA', nome: 'Contratto di agenzia e commissioni', cat: 'Legale', h: 6, p: 150000, ver: 1 },
    { id: 'A_RICERCA_EUIPO', nome: 'Ricerca anteriorità marchio EUIPO', cat: 'IP', h: 3, p: 80000, ver: 1 },
    { id: 'A_DEPOSITO_MARCHIO', nome: 'Deposito marchio EUIPO', cat: 'IP', h: 4, p: 110000, ver: 1 },
    { id: 'A_LICENZA_USO', nome: 'Contratto licenza d\'uso marchio', cat: 'IP', h: 5, p: 140000, ver: 1 },
    { id: 'A_MONITOR_RINNOVO', nome: 'Monitoraggio e rinnovo', cat: 'IP', h: 3, p: 70000, ver: 1 },
    { id: 'A_ANALISI_IPA', nome: 'Analisi regime IPA Malta', cat: 'Fiscale', h: 5, p: 160000, ver: 2 },
    { id: 'A_STRUTT_RIMESSE', nome: 'Struttura rimesse e dividendi', cat: 'Fiscale', h: 5, p: 150000, ver: 1 },
    { id: 'A_OTTIM_REFUND', nome: 'Ottimizzazione 6/7 refund mechanism', cat: 'Fiscale', h: 5, p: 160000, ver: 1 },
    { id: 'A_REPORT_TAX', nome: 'Report tax planning definitivo', cat: 'Fiscale', h: 3, p: 80000, ver: 1 },
    { id: 'A_DUE_DILIGENCE', nome: 'Due diligence cliente', cat: 'Compliance', h: 3, p: 80000, ver: 1 },
    { id: 'A_REPORT_CRS_FATCA', nome: 'Reporting CRS/FATCA', cat: 'Compliance', h: 1, p: 35000, ver: 1 },
    { id: 'A_AGG_ANNUALE', nome: 'Aggiornamento annuale compliance', cat: 'Compliance', h: 1, p: 20000, ver: 1 },
  ];

  for (const art of ARTICOLI) {
    await prisma.articolo.upsert({
      where: { id: art.id },
      update: {
        nome: art.nome,
        categoria: art.cat,
        oreDefault: art.h,
        prezzoDefault: art.p,
        versione: art.ver,
        formMasterId: art.formMasterId || null,
        tenantId: TENANT_ID,
      },
      create: {
        id: art.id,
        tenantId: TENANT_ID,
        nome: art.nome,
        categoria: art.cat,
        oreDefault: art.h,
        prezzoDefault: art.p,
        versione: art.ver,
        formMasterId: art.formMasterId || null,
      },
    });
  }
  console.log(`✓ ${ARTICOLI.length} Articoli inseriti nel DB.`);

  // 5. MODULI TEMPLATE (10 Moduli Master)
  const MODULI = [
    { id: 'mod-m01', nome: 'Analisi patrimoniale iniziale', cat: 'Analisi', ver: 2, giurId: null, pkg: null, righe: ['A_RACCOLTA_DOC', 'A_ANALISI_STRUTT', 'A_REPORT_ANALISI', 'A_PRESENT_CLIENTE', 'A_FIRMA_ENG'], deps: [] },
    { id: 'mod-m02', nome: 'Corporate structuring Malta', cat: 'Societario', ver: 3, giurId: 'giur-mt', pkg: 1150000, righe: ['A_STUDIO_STRUTT', 'A_COST_SOCIETA', 'A_ATTO_COST', 'A_CONTRATTO_INTERCOMPANY', 'A_REG_MFSA', 'A_REG_FISCALE', 'A_UBO'], deps: ['mod-m01'] },
    { id: 'mod-m03', nome: 'Holding internazionale', cat: 'Societario', ver: 1, giurId: null, pkg: null, righe: ['A_SEL_GIURISDIZIONE', 'A_COST_HOLDING', 'A_STRUTT_PARTECIPAZIONI', 'A_CONTRATTO_SERVIZIO', 'A_COMPLIANCE_ONGOING'], deps: ['mod-m01'] },
    { id: 'mod-m04', nome: 'Struttura Trust', cat: 'Trust', ver: 2, giurId: null, pkg: null, righe: ['A_SEL_TRUST_CO', 'A_DEED_TRUST', 'A_LETTER_WISHES', 'A_TRASF_ASSET', 'A_REG_TRUST_MALTA'], deps: ['mod-m01'] },
    { id: 'mod-m05', nome: 'Apertura conti correnti', cat: 'Banking', ver: 1, giurId: 'giur-mt', pkg: null, righe: ['A_SEL_BANCHE', 'A_KYC_CLIENTE', 'A_APERTURA_CONTO', 'A_INTERNET_BANKING', 'A_TEST_TRANSAZIONI'], deps: ['mod-m02'] },
    { id: 'mod-m06', nome: 'Contratti intra-societari', cat: 'Legale', ver: 1, giurId: null, pkg: null, righe: ['A_CONTRATTO_SERVIZIO', 'A_LICENSING_IP', 'A_LOAN_INTERCOMPANY', 'A_MGMT_AGREEMENT', 'A_REVISIONE_LEGALE'], deps: ['mod-m02'] },
    { id: 'mod-m07', nome: 'Contratti con terzi', cat: 'Legale', ver: 1, giurId: null, pkg: null, righe: ['A_CONTR_DISTRIBUZIONE', 'A_NDA', 'A_CONTR_AGENZIA', 'A_REVISIONE_LEGALE'], deps: ['mod-m02'] },
    { id: 'mod-m08', nome: 'Gestione marchi e IP', cat: 'IP', ver: 1, giurId: null, pkg: null, righe: ['A_RICERCA_EUIPO', 'A_DEPOSITO_MARCHIO', 'A_LICENZA_USO', 'A_MONITOR_RINNOVO'], deps: ['mod-m02'] },
    { id: 'mod-m09', nome: 'Tax planning internazionale', cat: 'Fiscale', ver: 2, giurId: 'giur-mt', pkg: null, righe: ['A_ANALISI_IPA', 'A_STRUTT_RIMESSE', 'A_OTTIM_REFUND', 'A_REPORT_TAX'], deps: ['mod-m02'] },
    { id: 'mod-m10', nome: 'Compliance e KYC', cat: 'Compliance', ver: 1, giurId: null, pkg: null, righe: ['A_DUE_DILIGENCE', 'A_KYC_CLIENTE', 'A_REPORT_CRS_FATCA', 'A_AGG_ANNUALE'], deps: ['mod-m02'] },
  ];

  for (const m of MODULI) {
    await prisma.moduloTemplate.upsert({
      where: { id: m.id },
      update: {
        nome: m.nome,
        categoria: m.cat,
        versione: m.ver,
        giurisdizioneId: m.giurId,
        prezzoPacchetto: m.pkg,
        tenantId: TENANT_ID,
      },
      create: {
        id: m.id,
        tenantId: TENANT_ID,
        nome: m.nome,
        categoria: m.cat,
        versione: m.ver,
        giurisdizioneId: m.giurId,
        prezzoPacchetto: m.pkg,
      },
    });

    // Righe distinta
    for (let i = 0; i < m.righe.length; i++) {
      const artId = m.righe[i];
      const rigaId = `rd-${m.id}-${artId}`;
      try {
        await prisma.rigaDistinta.upsert({
          where: { id: rigaId },
          update: {
            ordine: i + 1,
            articoloId: artId,
            moduloTemplateId: m.id,
            articoloVersione: 1,
            quantita: 1,
            tenantId: TENANT_ID,
          },
          create: {
            id: rigaId,
            tenantId: TENANT_ID,
            moduloTemplateId: m.id,
            articoloId: artId,
            articoloVersione: 1,
            ordine: i + 1,
            quantita: 1,
          },
        });
      } catch {}
    }

    // Dipendenze
    for (const depId of m.deps) {
      const depKey = `dep-${m.id}-${depId}`;
      try {
        await prisma.moduloDipendenzaTemplate.upsert({
          where: { id: depKey },
          update: {
            moduloTemplateId: m.id,
            dipendeDaModuloTemplateId: depId,
            tenantId: TENANT_ID,
          },
          create: {
            id: depKey,
            tenantId: TENANT_ID,
            moduloTemplateId: m.id,
            dipendeDaModuloTemplateId: depId,
          },
        });
      } catch {}
    }
  }
  console.log(`✓ ${MODULI.length} Moduli Template con Distinte Base e Dipendenze inseriti.`);

  // 6. CLIENTI ERP MASTER
  const CLIENTI = [
    {
      id: 'cli-01',
      nome: 'Holding Beta S.r.l.',
      tipo: 'company',
      piva: 'IT09876543210',
      codiceFiscale: '09876543210',
      sedeLegale: 'Via Montenapoleone 8, Milano',
      sdiCode: 'SUBM70N',
      iban: 'IT60X0542811101000000123456',
      rischioAml: 'basso',
      ubo: 'Ing. Roberto Rossi',
      fontePatrimonio: 'Utili d\'impresa e dividendi holding industriale',
      dataKyc: '2026-01-15',
      referentiJson: {
        referente: 'Ing. Roberto Rossi (CEO)',
        email: 'client@holdingbeta.advisory',
        cellulare: '+39 333 5936278',
        telefono: '+39 02 889900',
        whatsapp: '+393335936278',
      },
    },
    {
      id: 'cli-02',
      nome: 'Marco Ricci',
      tipo: 'individual',
      piva: 'IT12345678901',
      codiceFiscale: 'RCCMRC75B10F205Y',
      sedeLegale: 'Corso Vittorio Emanuele II 12, Milano',
      sdiCode: '0000000',
      iban: 'IT40Y0542811101000000987654',
      rischioAml: 'medio',
      ubo: 'Marco Ricci',
      fontePatrimonio: 'Patrimonio immobiliare e investimenti finanziari',
      dataKyc: '2026-02-10',
      referentiJson: {
        referente: 'Marco Ricci',
        email: 'referente.ricci@holdingbeta.advisory',
        cellulare: '+39 335 1234567',
        whatsapp: '+393351234567',
      },
    },
    {
      id: 'cli-03',
      nome: 'Belfort Industries S.A.',
      tipo: 'company',
      piva: 'LU99887766',
      codiceFiscale: 'LU99887766',
      sedeLegale: 'Boulevard Royal 25, Lussemburgo',
      sdiCode: 'XXXXXXX',
      iban: 'LU280019345678901234',
      rischioAml: 'basso',
      ubo: 'Jean-Paul Belfort',
      fontePatrimonio: 'Vendita asset software e brevetti industriali',
      dataKyc: '2026-03-01',
      referentiJson: {
        referente: 'Jean-Paul Belfort (Managing Director)',
        email: 'jp.belfort@belfort-sa.lu',
        cellulare: '+352 621 112233',
        whatsapp: '+352621112233',
      },
    },
  ];

  for (const c of CLIENTI) {
    await prisma.cliente.upsert({
      where: { id: c.id },
      update: {
        nome: c.nome,
        tipo: c.tipo,
        piva: c.piva,
        codiceFiscale: c.codiceFiscale,
        sedeLegale: c.sedeLegale,
        sdiCode: c.sdiCode,
        iban: c.iban,
        rischioAml: c.rischioAml,
        ubo: c.ubo,
        fontePatrimonio: c.fontePatrimonio,
        dataKyc: c.dataKyc,
        referentiJson: c.referentiJson,
        tenantId: TENANT_ID,
      },
      create: {
        id: c.id,
        tenantId: TENANT_ID,
        nome: c.nome,
        tipo: c.tipo,
        piva: c.piva,
        codiceFiscale: c.codiceFiscale,
        sedeLegale: c.sedeLegale,
        sdiCode: c.sdiCode,
        iban: c.iban,
        rischioAml: c.rischioAml,
        ubo: c.ubo,
        fontePatrimonio: c.fontePatrimonio,
        dataKyc: c.dataKyc,
        referentiJson: c.referentiJson,
      },
    });
  }
  console.log(`✓ ${CLIENTI.length} Clienti ERP inseriti.`);

  console.log('\n🎉 SEEDING COMPLETATO CON SUCCESSO SUL DATABASE POSTGRESQL / SUPABASE!');
}

main()
  .catch((e) => {
    console.error('❌ Errore durante il seeding:', e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
