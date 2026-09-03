// ⚠️ SUPERATO — non applicare più da qui.
//
// Questo script eseguiva `supabase/migrations/20260815_enable_rls.sql`, sostituito da
// `20260819_rls_effettiva.sql`. Rieseguirlo sarebbe attivamente dannoso: le policy del
// file vecchio sono PERMISSIVE e senza destinatario, quindi si sommerebbero in OR a
// `isolamento_tenant` vanificandola — l'isolamento tornerebbe inerte senza che nulla
// segnali un errore.
//
// La migrazione nuova non è eseguibile via Prisma in nessun caso: usa `\gexec` per creare
// il ruolo applicativo senza stampare la password, e `\gexec` è un meta-comando di psql
// che `$executeRawUnsafe` non conosce.
//
// Il comando corretto è documentato nell'intestazione della migrazione:
//
//   PW=$(node -e "console.log(require('crypto').randomBytes(24).toString('base64').replace(/[^A-Za-z0-9]/g,'').slice(0,28))")
//   psql "$ADMIN_DATABASE_URL" -v ON_ERROR_STOP=1 -v pw="$PW" \
//        -f supabase/migrations/20260819_rls_effettiva.sql
//
// Per verificare lo stato effettivo: `npx tsx src/scripts/checkRls.ts`.

console.error(
  [
    '❌ Script superato: non applica più nulla.',
    '',
    '   La RLS effettiva sta in supabase/migrations/20260819_rls_effettiva.sql e va',
    '   applicata con psql (usa \\gexec, che Prisma non può eseguire):',
    '',
    '     psql "$ADMIN_DATABASE_URL" -v ON_ERROR_STOP=1 -v pw="$PW" \\',
    '          -f supabase/migrations/20260819_rls_effettiva.sql',
    '',
    '   Stato attuale: npx tsx src/scripts/checkRls.ts',
  ].join('\n'),
);
process.exit(1);
