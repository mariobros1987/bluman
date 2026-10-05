// Seed di overlay per gli E2E Playwright — prepara il database usa-e-getta dei test
// (container Postgres su localhost:5433) con i dati che i quattro flussi critici
// richiedono e che il seed master non crea.
//
// Regola di sicurezza non negoziabile: questo script legge l'URL del database
// SOLO dalla variabile d'ambiente E2E_DATABASE_URL e rifiuta di partire senza.
// Mai da .env, mai da DATABASE_URL: l'unico database reale che esiste è quello
// di produzione su Supabase, e un overlay che lo toccasse sarebbe un disastro.
// Come ulteriore difesa in profondità l'URL deve puntare a localhost.

const E2E_TENANT_ID = '00000000-0000-0000-0000-000000000001';

function urlValidoPerE2E(url: string): boolean {
  try {
    const parsed = new URL(url);
    return ['localhost', '127.0.0.1', '::1'].includes(parsed.hostname);
  } catch {
    return false;
  }
}

async function main(): Promise<void> {
  const urlE2E = process.env.E2E_DATABASE_URL;
  if (!urlE2E) {
    console.error(
      '❌ E2E_DATABASE_URL non impostata. Questo seed scrive su un database di test\n' +
        '   usa-e-getta (container Docker su localhost:5433) e rifiuta di girare senza\n' +
        "   un URL esplicito, così non può mai toccare l'unico database reale (Supabase).",
    );
    process.exit(1);
  }
  if (!urlValidoPerE2E(urlE2E)) {
    console.error(`❌ E2E_DATABASE_URL deve puntare a localhost, non a ${new URL(urlE2E).hostname}.`);
    process.exit(1);
  }

  // Le variabili di connessione vanno sovrascritte PRIMA di importare qualunque
  // modulo che costruisca un PrismaClient (src/util/prismaClient.ts ne crea uno
  // a livello di modulo): così anche le importazioni transitive usano il DB E2E.
  process.env.DATABASE_URL = urlE2E;
  process.env.ADMIN_DATABASE_URL = urlE2E;
  process.env.DIRECT_URL = urlE2E;

  const [{ prisma }, { hashPassword }, { istanziaProgetto }, { PrismaIstanziazionePort }, { FakeNotificationPort }] =
    await Promise.all([
      import('../util/prismaClient.js'),
      import('../util/password.js'),
      import('../services/istanziaProgetto.js'),
      import('../adapters/prisma/prismaIstanziazionePort.js'),
      import('../services/fakeIstanziazionePort.js'),
    ]);

  // La password nota degli utenti E2E arriva dall'ambiente, sempre: il default sta in
  // scripts/e2e/prepara.mjs (fuori da src/), e qui un ripiego cablato sarebbe un segreto
  // nel repository — è il caso che src/credenziali.test.ts vieta per forma, non per valore.
  const passwordNota = process.env.E2E_PASSWORD;
  if (!passwordNota) {
    console.error(
      '❌ E2E_PASSWORD non impostata. Il seed E2E definisce le password degli utenti di test\n' +
        '   e rifiuta di girare senza un valore esplicito (lo passa scripts/e2e/prepara.mjs).',
    );
    process.exit(1);
  }
  const hash = hashPassword(passwordNota);

  // 1. Tenant: SMTP verso Mailpit (127.0.0.1:1025, niente TLS). Il canale email
  //    della firma OTP risulta configurato se host E user sono presenti sulla
  //    riga tenant (vedi canaliDisponibili in otpDispatch.ts). L'IP esplicito e
  //    non «localhost» perché validaHost accetta solo IP o nomi con punto; la
  //    connessione al range locale è consentita dall'eccezione di sviluppo
  //    PERMETTI_ENDPOINT_LOCALI (vedi networkPolicy.ts).
  const tenant = await prisma.tenant.update({
    where: { id: E2E_TENANT_ID },
    data: {
      smtpHost: '127.0.0.1',
      smtpPort: 1025,
      smtpSecure: false,
      smtpUser: 'e2e@bluecode.advisory',
      smtpPass: 'mailpit-accetta-tutto',
    },
  });
  console.log(`✓ Tenant ${tenant.ragioneSociale}: SMTP → localhost:1025 (Mailpit)`);

  // 2. Utenti con password nota, negli stati che i flussi richiedono:
  //    - mario.dibenedetto → invitato: il login apre il modale di cambio password (flusso 1)
  //    - lorenzo.marino → attivo: login diretto (flusso 3, e firma del magic link nel flusso 2)
  const mario = await prisma.user.update({
    where: { email: 'mario.dibenedetto@bluecode.advisory' },
    data: { passwordHash: hash, stato: 'invitato' },
  });
  const lorenzo = await prisma.user.update({
    where: { email: 'lorenzo.marino@bluecode.advisory' },
    data: { passwordHash: hash, stato: 'attivo' },
  });
  console.log(`✓ ${mario.email}: stato invitato (flusso cambio password)`);
  console.log(`✓ ${lorenzo.email}: stato attivo (login advisor)`);

  // 3. Cliente Belfort: email in anagrafica diretta, così il canale email della
  //    firma e il magic link hanno un recapito senza passare dai referenti.
  const belfort = await prisma.cliente.update({
    where: { id: 'cli-03' },
    data: { email: 'jp.belfort@belfort-sa.lu' },
  });
  console.log(`✓ Cliente ${belfort.nome}: email ${belfort.email}`);

  // 4. Progetto per Belfort con moduli istanziati: è il prerequisito del
  //    compositore fatture (FatturazioneTab) e rende il portale realistico.
  //    Si riusa la stessa orchestrazione della produzione (istanziaProgetto)
  //    invece di creare le righe a mano: la catena di FK modulo → microvoce →
  //    passaggio è lunga e duplicarla qui diverrebbe subito falsa.
  const esistente = await prisma.progetto.findFirst({
    where: { tenantId: E2E_TENANT_ID, clienteId: 'cli-03', nome: 'Incarico E2E — Belfort Industries' },
  });
  if (esistente) {
    // Reset dello stato della corsa precedente, così la suite è ri-eseguibile:
    // senza questo passo «Tutte da Fatturare» escluderebbe le microvoci già
    // fatturate e il flusso della fattura resterebbe senza voci da selezionare.
    // Righe e scadenze seguono la fattura in cascata (onDelete: Cascade).
    const fatture = await prisma.fattura.deleteMany({ where: { progettoId: esistente.id } });
    const otp = await prisma.codiceOtp.deleteMany({ where: { clienteId: 'cli-03' } });
    console.log(
      `✓ Progetto E2E già presente (${esistente.id}): resettate ${fatture.count} fatture e ${otp.count} sessioni OTP delle corse precedenti`,
    );
  } else {
    const progetto = await prisma.progetto.create({
      data: {
        tenantId: E2E_TENANT_ID,
        clienteId: 'cli-03',
        nome: 'Incarico E2E — Belfort Industries',
        stato: 'pre_project',
        valoreTotale: 1500000,
      },
    });
    const esito = await istanziaProgetto(
      {
        progettoId: progetto.id,
        clienteId: 'cli-03',
        righe: [
          { moduloTemplateId: 'mod-m01', moduloTemplateVersione: 2 },
          { moduloTemplateId: 'mod-m02', moduloTemplateVersione: 3 },
        ],
      },
      new PrismaIstanziazionePort(prisma, E2E_TENANT_ID),
      new FakeNotificationPort(),
    );
    console.log(`✓ Progetto ${progetto.id} creato e istanziato (${esito.moduliProgettoIds.length} moduli)`);
  }

  console.log('\n🎉 Overlay E2E completato. Password nota per mario/lorenzo: da variabile E2E_PASSWORD.');
}

main()
  .catch((err) => {
    console.error('❌ Overlay E2E fallito:', err);
    process.exit(1);
  })
  .finally(() => import('../util/prismaClient.js').then(({ prisma }) => prisma.$disconnect()));
