import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function testTenantAllFields() {
  console.log('═══════════════════════════════════════════════════════════════════════');
  console.log('🏛 TEST PERSISTENZA TOTALE TUTTI I CAMPI TENANT SETTINGS SU SUPABASE');
  console.log('═══════════════════════════════════════════════════════════════════════\n');

  const tenantId = '00000000-0000-0000-0000-000000000001';

  const fullSettingsData = {
    ragioneSociale: 'Studio Advisory & Legal Partners (Sede Centrale)',
    piva: 'MT28491039',
    codiceFiscale: 'MT28491039',
    sedeLegale: 'Level 4, Valuation Centre, Tower Road, Sliema SLM 1600, Malta',
    sedeOperativa: 'Via Montenapoleone 8, 20121 Milano (MI), Italia',
    email: 'info@bluecode.advisory',
    pec: 'bluecode@pec.advisory.it',
    telefono: '+356 2133 4455',
    iban: 'IT99C0306902100100000012345',
    regimeFiscale: 'Ordinario IRES/IRAP - Holding & Advisory',
    capitaleSociale: '€ 100.000,00 i.v.',
    regImprese: 'MI-2849103',
    logoUrl: 'https://supabase.co/storage/v1/object/public/logos/studio-logo.png',
    coloreTemaFattura: '#4338ca',
    notePieFattura: 'Pagamento a 30 gg d.f. coordinate IBAN IT99C0306902100100000012345',
    titoloIntestazione: 'Bluecode Advisory Studio Legale & Tributario',
    mostraSdi: true,
    mostraIva: true,
    waPhoneId: '529732696891513',
    waAccessToken: 'EAALxxxxxxxxxxxxxx',
    waVerifyToken: 'bluman_wa_secure_token_2026',
    tgBotToken: '123456789:ABCdefGHIjklMNOpqrsTUVwxyz',
    tgBotUsername: '@BlueCodeStudioBot',
    smtpHost: 'authsmtp.register.it',
    smtpPort: 465,
    smtpSecure: true,
    smtpUser: 'support@bluecode-ltd.com',
    smtpPass: 'RegisterSecret2026!',
    smtpFromEmail: 'support@bluecode-ltd.com',
    smtpFromName: 'BlueCode Advisory & Consulting',
    smtpReplyTo: 'support@bluecode-ltd.com',
    smtpBcc: 'archivio@bluecode-ltd.com',
    imapProtocol: 'imap',
    imapHost: 'imap.register.it',
    imapPort: 993,
    imapSecure: true,
    imapUser: 'support@bluecode-ltd.com',
    imapPass: 'RegisterSecret2026!',
    imapFolder: 'INBOX',
    imapPollInterval: '5m',
    emailSignatureHtml: '<b>Bluecode Advisory</b><br>Legal & Tax Advisory Firm',
    emailInboundParseUrl: 'https://bluman.vercel.app/api/webhooks/inbound-email',
    signalCliEndpoint: 'http://localhost:8080/v1/receive',
    leadAdvisorNome: 'Joe Disabato',
    leadAdvisorEmail: 'joe@bluecode.advisory',
    leadAdvisorPassword: 'password123',
    giurisdizione: 'Malta (UE)',
    durataMesi: 12,
    piano: 'enterprise',
    stato: 'attivo',
  };

  console.log('1. Salvataggio / Upsert di tutti i campi Tenant su Supabase...');
  const updatedTenant = await prisma.tenant.upsert({
    where: { id: tenantId },
    update: fullSettingsData,
    create: {
      id: tenantId,
      ...fullSettingsData,
    },
  });

  console.log('   ✓ Record aggiornato su Database PostgreSQL ID:', updatedTenant.id);

  console.log('\n2. Rilettura e verifica corrispondenza di tutti i campi...');
  const fetchedTenant = await prisma.tenant.findUnique({ where: { id: tenantId } });
  if (!fetchedTenant) throw new Error('Tenant non trovato dopo il salvataggio!');

  let allMatches = true;
  for (const [key, val] of Object.entries(fullSettingsData)) {
    const fetchedVal = (fetchedTenant as any)[key];
    if (fetchedVal !== val) {
      console.error(`   ❌ Discrepanza per "${key}": atteso "${val}", ottenuto "${fetchedVal}"`);
      allMatches = false;
    } else {
      console.log(`   ✓ Campo "${key}" salvato e verificato:`, fetchedVal);
    }
  }

  if (allMatches) {
    console.log('\n═══════════════════════════════════════════════════════════════════════');
    console.log('🎯 TUTTI I CAMPI DEL TENANT SI SALVANO E PERSISTONO AL 100% SU DB!');
    console.log('═══════════════════════════════════════════════════════════════════════\n');
  } else {
    console.error('\n❌ Alcuni campi non combaciano.');
  }
}

testTenantAllFields().catch(console.error).finally(() => prisma.$disconnect());
