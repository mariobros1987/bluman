/**
 * Diagnostica read-only di chi può effettivamente autenticarsi (§23).
 *
 * Serve prima di un rilascio che chiude l'autenticazione: se nessuna riga `user` ha un
 * `password_hash`, il deploy non lascia entrare nessuno e la piattaforma si blocca fuori
 * da sé stessa. La domanda «esiste un super_admin con una password?» va posta prima, non
 * scoperta dopo.
 *
 * Volutamente non stampa hash, né password, né altro che non sia una presenza/assenza.
 */
import dotenv from 'dotenv';
import { PrismaClient } from '@prisma/client';

// `tsx` non legge `.env` da sé.
dotenv.config();

// `ADMIN_DATABASE_URL`, in mancanza `DIRECT_URL` (il proprietario dello schema: la stessa
// risoluzione di `prismaAmministrativo`), e solo per ultimo `DATABASE_URL` — che in sviluppo
// locale è spesso già un ruolo con tutti i privilegi. La domanda riguarda TUTTI i tenant,
// quindi serve un ruolo che scavalchi la RLS: con `bluman_app` le policy filtrano e la
// risposta diventa «0 utenti» — senza errore, e per questo credibile.
// È uno degli usi ammessi dalla regola 1 (script di manutenzione), non una scorciatoia
// dentro una rotta HTTP.
const prisma = new PrismaClient({
  datasources: {
    db: {
      url: process.env.ADMIN_DATABASE_URL || process.env.DIRECT_URL || process.env.DATABASE_URL,
    },
  },
});

async function main() {
  // Prima di dare un verdetto, accerta di poterlo dare. Con un ruolo che non scavalca la RLS
  // le policy filtrano le righe, e il conteggio qui sotto non è «zero utenti»: è «zero utenti
  // VISIBILI A QUESTO RUOLO». Il verdetto che ne uscirebbe — «nessun super_admin, dopo il
  // rilascio nessuno entra» — è falso, e questo script serve proprio a decidere se rilasciare.
  const [ruolo] = await prisma.$queryRaw<
    Array<{ utente: string; superuser: boolean; bypassrls: boolean }>
  >`SELECT current_user AS utente, rolsuper AS superuser, rolbypassrls AS bypassrls
      FROM pg_roles
     WHERE rolname = current_user`;

  if (!ruolo || (!ruolo.superuser && !ruolo.bypassrls)) {
    console.error(`\n❌ Ruolo connesso: «${ruolo?.utente ?? 'sconosciuto'}».`);
    console.error(
      '   Non scavalca la RLS (rolsuper=false, rolbypassrls=false), quindi le policy filtrano',
    );
    console.error('   le righe: qualunque conteggio sarebbe «0», e sarebbe falso.');
    console.error('   Nessun verdetto. Imposta ADMIN_DATABASE_URL (o DIRECT_URL) e riprova.');
    await prisma.$disconnect();
    process.exitCode = 1;
    return;
  }

  const utenti = await prisma.user.findMany({
    select: { email: true, ruolo: true, tenantId: true, passwordHash: true, stato: true },
    orderBy: [{ ruolo: 'asc' }, { email: 'asc' }],
  });

  console.log(`\n=== ${utenti.length} righe in "user" ===\n`);

  const perRuolo = new Map<string, { conPassword: number; senzaPassword: number }>();
  for (const u of utenti) {
    const r = perRuolo.get(u.ruolo) || { conPassword: 0, senzaPassword: 0 };
    if (u.passwordHash) r.conPassword++;
    else r.senzaPassword++;
    perRuolo.set(u.ruolo, r);

    const stato = u.passwordHash ? '🔑 può accedere' : '⚠️  senza password';
    // `invitato` è lo stato di default: chi ha già una password ma è rimasto `invitato`
    // accede comunque, quindi solo `disattivato` è un impedimento.
    const sospeso = u.stato === 'disattivato' ? ' [DISATTIVATO]' : '';
    const tenant = u.tenantId ? u.tenantId.slice(0, 8) : 'tutti i tenant';
    console.log(`  ${stato}${sospeso}  ${u.ruolo.padEnd(22)} ${u.email.padEnd(34)} ${tenant}`);
  }

  console.log('\n=== Riepilogo per ruolo ===');
  for (const [ruolo, r] of perRuolo) {
    console.log(`  ${ruolo.padEnd(22)} ${r.conPassword} con password, ${r.senzaPassword} senza`);
  }

  const superAdminUtilizzabili = utenti.filter(
    (u) => u.ruolo === 'super_admin' && u.passwordHash && u.stato !== 'disattivato',
  );

  console.log('\n=== Verdetto ===');
  if (superAdminUtilizzabili.length === 0) {
    console.log('  ❌ Nessun super_admin attivo con password: dopo il rilascio nessuno entra.');
    console.log('     Rimedio: `npm run bootstrap` (§27) oppure `npm run passwords:assign`.');
    process.exitCode = 1;
  } else {
    console.log(`  ✅ ${superAdminUtilizzabili.length} super_admin attivo/i con password.`);
  }

  const senzaPassword = utenti.filter((u) => !u.passwordHash && u.ruolo !== 'cliente');
  if (senzaPassword.length > 0) {
    console.log(
      `  ⚠️  ${senzaPassword.length} utenti di staff senza password: non potranno accedere.` +
        ' Rimedio: `npm run passwords:assign`.',
    );
  }

  await prisma.$disconnect();
}

main().catch(async (err) => {
  console.error(err);
  await prisma.$disconnect();
  process.exit(1);
});
