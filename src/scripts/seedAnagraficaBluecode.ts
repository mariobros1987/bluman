/**
 * Imposta sulla riga Tenant di Bluecode (`…001`) i dati anagrafici REALI (Malta), così i documenti
 * generati risolvono `{{studio.ragione_sociale}}`, `{{studio.codice_fiscale}}`, `{{studio.sede_legale}}`
 * con i valori veri (il generatore legge il DB, non la costante frontend). Idempotente (upsert).
 * Solo configurazione del tenant: nessun dato demo. Client amministrativo (scavalca RLS, legittimo).
 *
 * Uso: npx tsx src/scripts/seedAnagraficaBluecode.ts
 */
import { prismaAmministrativo } from '../util/prismaClient.js';

const prisma = prismaAmministrativo();
const TENANT_ID = '00000000-0000-0000-0000-000000000001';

const DATI = {
  ragioneSociale: 'Bluecode LTD',
  codiceFiscale: 'C71668', // Malta company registration number
  sedeLegale: 'Notabile Residence, Mdina Road, Attard ATD9036, Malta',
  giurisdizione: 'Malta',
  email: 'advisor@bluegib.com',
};

async function main() {
  const t = await prisma.tenant.upsert({
    where: { id: TENANT_ID },
    update: DATI,
    create: { id: TENANT_ID, piano: 'enterprise', stato: 'attivo', ...DATI },
  });
  console.log(`✅ Anagrafica Bluecode: ${t.ragioneSociale} — reg. ${t.codiceFiscale} — ${t.sedeLegale} (${t.giurisdizione})`);
  await prisma.$disconnect();
}

main().catch((e) => { console.error(e); process.exit(1); });
