import dotenv from 'dotenv';
dotenv.config();

import { prismaAmministrativo } from '../util/prismaClient.js';

// Verifica manuale della persistenza: connessione amministrativa (§14), perché lo script
// gira fuori da una richiesta e non ha un tenant corrente da cui farsi filtrare.
const prisma = prismaAmministrativo();

/**
 * Campi che contengono segreti. Vengono scritti con un valore sintetico generato al volo
 * (mai una password reale, regola 6 di .agents/AGENTS.md) e mascherati in output: prima
 * questo script portava in chiaro `smtpPass`/`imapPass` reali nel codice versionato e li
 * stampava a terminale a ogni esecuzione.
 */
const CAMPI_SEGRETI = new Set(['smtpPass', 'imapPass', 'waAccessToken', 'waVerifyToken', 'tgBotToken']);

function maschera(chiave: string, valore: unknown): unknown {
  if (!CAMPI_SEGRETI.has(chiave) || !valore) return valore;
  return `«${String(valore).length} caratteri, non stampati»`;
}

async function testTenantAllFields() {
  console.log('═══════════════════════════════════════════════════════════════════════');
  console.log('🏛 TEST PERSISTENZA TOTALE TUTTI I CAMPI TENANT SETTINGS SU SUPABASE');
  console.log('═══════════════════════════════════════════════════════════════════════\n');

  /**
   * Questo script sovrascrive per intero la riga del tenant indicato: eseguirlo sul tenant
   * di produzione ne cancella le impostazioni vere, comprese le credenziali email dello
   * studio. Va quindi indirizzato esplicitamente a un tenant di prova.
   */
  const tenantId = process.env.TEST_TENANT_ID;
  if (!tenantId) {
    console.error('❌ Imposta TEST_TENANT_ID sul tenant di prova da usare.');
    console.error('   Lo script riscrive TUTTI i campi del tenant indicato: senza questo');
    console.error('   vincolo esplicito cancellerebbe le impostazioni dello studio reale.');
    process.exitCode = 1;
    return;
  }

  // Segnaposto, non credenziali: servono solo a verificare che il campo faccia
  // andata-e-ritorno sul database.
  const segnaposto = `test-${Date.now()}`;

  const fullSettingsData = {
    ragioneSociale: 'Studio di Prova — Verifica Persistenza',
    piva: 'IT00000000000',
    codiceFiscale: 'IT00000000000',
    sedeLegale: 'Via di Prova 1, 00000 Città (XX)',
    sedeOperativa: 'Via di Prova 2, 00000 Città (XX)',
    email: 'prova@example.invalid',
    pec: 'prova@pec.example.invalid',
    telefono: '+39 000 0000000',
    iban: 'IT00X0000000000000000000000',
    regimeFiscale: 'Ordinario',
    capitaleSociale: '€ 10.000,00 i.v.',
    regImprese: 'XX-0000000',
    logoUrl: 'https://example.invalid/logo.png',
    coloreTemaFattura: '#4338ca',
    notePieFattura: 'Pagamento a 30 gg d.f.',
    titoloIntestazione: 'Studio di Prova',
    mostraSdi: true,
    mostraIva: true,
    waPhoneId: '000000000000000',
    waAccessToken: segnaposto,
    waVerifyToken: segnaposto,
    tgBotToken: segnaposto,
    tgBotUsername: '@StudioDiProvaBot',
    smtpHost: 'smtp.example.invalid',
    smtpPort: 465,
    smtpSecure: true,
    smtpUser: 'prova@example.invalid',
    smtpPass: segnaposto,
    smtpFromEmail: 'prova@example.invalid',
    smtpFromName: 'Studio di Prova',
    smtpReplyTo: 'prova@example.invalid',
    smtpBcc: 'archivio@example.invalid',
    imapProtocol: 'imap',
    imapHost: 'imap.example.invalid',
    imapPort: 993,
    imapSecure: true,
    imapUser: 'prova@example.invalid',
    imapPass: segnaposto,
    imapFolder: 'INBOX',
    imapPollInterval: '5m',
    emailSignatureHtml: '<b>Studio di Prova</b>',
    emailInboundParseUrl: 'https://example.invalid/api/webhooks/inbound-email',
    signalCliEndpoint: 'http://localhost:8080/v1/receive',
    leadAdvisorNome: 'Responsabile di Prova',
    leadAdvisorEmail: 'responsabile@example.invalid',
    // Nessun `leadAdvisorPassword`: la colonna è stata eliminata dalla migrazione
    // 20260819120000_rimozione_password_chiaro_tenant. Le password stanno su
    // `user.password_hash` come hash scrypt.
    giurisdizione: 'Italia',
    durataMesi: 12,
    piano: 'enterprise',
    stato: 'attivo',
  };

  console.log(`1. Salvataggio / Upsert di tutti i campi sul tenant di prova ${tenantId}...`);
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
      console.error(`   ❌ Discrepanza per "${key}": atteso "${maschera(key, val)}", ottenuto "${maschera(key, fetchedVal)}"`);
      allMatches = false;
    } else {
      console.log(`   ✓ Campo "${key}" salvato e verificato:`, maschera(key, fetchedVal));
    }
  }

  if (allMatches) {
    console.log('\n═══════════════════════════════════════════════════════════════════════');
    console.log('🎯 TUTTI I CAMPI DEL TENANT SI SALVANO E PERSISTONO AL 100% SU DB!');
    console.log('═══════════════════════════════════════════════════════════════════════\n');
  } else {
    console.error('\n❌ Alcuni campi non combaciano.');
    process.exitCode = 1;
  }
}

testTenantAllFields().catch(console.error).finally(() => prisma.$disconnect());
