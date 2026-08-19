// §23 — assegna una password iniziale agli utenti dello studio che non ne hanno una.
//
// Serve dopo la rimozione degli utenti hardcoded da server.ts: gli utenti creati da
// seedFull.ts esistono in DB ma con password_hash a NULL, quindi non potrebbero più
// autenticarsi. Complementare a `npm run bootstrap` (§27), che copre solo il PRIMO
// super_admin quando il database è ancora vuoto.
//
// Va lanciato manualmente, mai esposto come endpoint HTTP:
//   npm run passwords:assign            → solo gli utenti senza password
//   npm run passwords:assign -- --force → rigenera per tutti (invalida quelle in uso)
//
// Le password sono stampate UNA SOLA VOLTA: non vengono salvate in chiaro da nessuna
// parte né inviate via email. Consegnale a mano.

import { PrismaClient } from '@prisma/client';
import { hashPassword, generaPasswordTemporanea } from '../util/password.js';

const prisma = new PrismaClient();

async function main() {
  const forza = process.argv.includes('--force');

  const utenti = await prisma.user.findMany({
    where: {
      ruolo: { not: 'cliente' }, // il cliente è passwordless: accede solo via magic link (§23)
      ...(forza ? {} : { passwordHash: null }),
    },
    orderBy: { email: 'asc' },
  });

  if (utenti.length === 0) {
    console.log('Nessun utente da aggiornare: hanno già tutti una password.');
    console.log('Usa `npm run passwords:assign -- --force` per rigenerarle comunque.');
    return;
  }

  const generate: Array<{ email: string; password: string }> = [];

  for (const utente of utenti) {
    const passwordTemporanea = generaPasswordTemporanea();
    await prisma.user.update({
      where: { id: utente.id },
      data: { passwordHash: hashPassword(passwordTemporanea) },
    });
    generate.push({ email: utente.email, password: passwordTemporanea });
  }

  const larghezzaEmail = Math.max(...generate.map((g) => g.email.length));

  console.log('');
  console.log('═══════════════════════════════════════════════════════════');
  console.log('  Password temporanee — mostrate una sola volta:');
  console.log('');
  for (const { email, password } of generate) {
    console.log(`  ${email.padEnd(larghezzaEmail)}  ${password}`);
  }
  console.log('═══════════════════════════════════════════════════════════');
  console.log('');
  console.log(`${generate.length} utenti aggiornati.`);
  // Il cambio password obbligatorio al primo accesso previsto da §27 non è ancora
  // implementato: per ora va imposto a voce insieme alla consegna della password.
  console.log('Consegnale a mano e chiedi di cambiarla al primo accesso.');
}

main()
  .catch((err) => {
    console.error('Assegnazione password fallita:', err);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
