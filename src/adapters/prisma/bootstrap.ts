// Bootstrap del sistema — §27. Crea il primo utente super_admin.
//
// ⚠️ Come l'adapter in questa stessa cartella, non è mai stato eseguito in questo ambiente
// (nessun accesso a Postgres né a `prisma generate`). Verificalo sulla tua macchina.
//
// Va lanciato UNA SOLA VOLTA, manualmente, mai come endpoint HTTP pubblico (§27):
//   npm run bootstrap

import { prismaAmministrativo } from '../../util/prismaClient.js';
import { hashPassword, generaPasswordTemporanea } from '../../util/password.js';

// Connessione amministrativa (§14): il primo super_admin nasce senza tenant, quindi non
// può essere creato attraverso policy che filtrano per tenant corrente.
const prisma = prismaAmministrativo();

async function main() {
  const esistente = await prisma.user.findFirst({ where: { ruolo: 'super_admin' } });
  if (esistente) {
    console.log('Esiste già un super_admin:', esistente.email);
    console.log('Questo script crea solo il PRIMO super_admin — se ne serve un altro, usa la dashboard (§21).');
    process.exit(0);
  }

  const email = process.env.BOOTSTRAP_EMAIL;
  if (!email) {
    console.error('Imposta la variabile BOOTSTRAP_EMAIL prima di lanciare questo script.');
    console.error('Esempio: BOOTSTRAP_EMAIL=tuo@indirizzo.it npm run bootstrap');
    process.exit(1);
  }

  const passwordTemporanea = generaPasswordTemporanea();

  await prisma.user.create({
    data: {
      email,
      nome: 'Super Admin',
      ruolo: 'super_admin',
      stato: 'invitato', // resta 'invitato' finché non cambia la password al primo login (§27)
      tenantId: null,
      passwordHash: hashPassword(passwordTemporanea),
    },
  });

  // Stampata UNA SOLA VOLTA, come previsto da §27: mai salvata in chiaro da nessuna parte,
  // mai inviata via email — solo qui, in console, al momento della creazione.
  console.log('');
  console.log('═══════════════════════════════════════════════════════════');
  console.log('  Super Admin creato:', email);
  console.log('  Password temporanea (salvala ora, non verrà mostrata di nuovo):');
  console.log('   ', passwordTemporanea);
  console.log('═══════════════════════════════════════════════════════════');
  console.log('');
  console.log('Prossimo passo: primo login → cambio password obbligatorio → attivazione 2FA obbligatoria (§23, §27).');
}

main()
  .catch((err) => {
    console.error('Bootstrap fallito:', err);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
