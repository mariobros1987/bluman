# CLAUDE.md — BluMan

Gestionale per studi di consulenza (multi-studio). Contesto e storia: ISTRUZIONI_PER_IA.md,
.agents/AGENTS.md (mappa dei file), PIANO.md (cosa fare), LAVORO_RIMANENTE.md (backlog del titolare).
Leggili solo se il prompt lo chiede: le regole operative sono qui.

## Stack
- Backend: Fastify 5 + TypeScript ESM, cartella `src/` (rotte in `src/routes/`, logica in `src/services/`).
- Frontend: React 19 + Vite, cartella `frontend/`.
- DB: PostgreSQL + Prisma 5.22, schema in `prisma/schema.prisma`, migrazioni versionate.
- Gestore pacchetti: **npm** (non pnpm). Node di riferimento: 20 (CI e Docker).

## Comandi
- Typecheck backend: `npx tsc --noEmit`
- Test backend, un file: `npx vitest run src/<file>.test.ts`
- Test backend, suite intera (una volta, prima del commit): `npx vitest run --reporter=dot` (~6 min)
- Frontend (in `frontend/`): `npx tsc -b --force` · `npm run lint` · `npm test -- --reporter=dot`
- Prisma: sempre `npx --no-install prisma …` (mai far scaricare Prisma 8)

## Regole del codice (dalle 16 regole tassative di ISTRUZIONI_PER_IA.md)
1. **Isolamento tra studi.** Nel codice che serve una richiesta HTTP si usa `prisma` da
   `src/util/prismaClient.ts`, mai `new PrismaClient()`. `prismaAmministrativo()` solo in
   script, seed, bootstrap, backup e ricerca utente al login. Ogni `$transaction` interattiva
   va avvolta in `conContestoInTransazione(tx, …)` (esempio: `src/routes/progetti.ts:243`).
2. **Schema** solo con migrazioni (`prisma migrate dev`). Mai `db push`, mai `--accept-data-loss`.
   Ogni migrazione che crea una tabella con `tenant_id` porta la propria policy RLS.
3. **Persistenza vera.** Tutto ciò che l'utente modifica si salva via API nel DB.
   `localStorage` solo come copia; un salvataggio fallito si dichiara, non si chiude il modale.
4. **Niente credenziali** nel codice o nei .md, neanche come valore di ripiego.
   Presidio: `src/credenziali.test.ts`.
5. **Stati e percentuali li calcola il backend**: `src/domain/stateEngine.ts` (puro) e
   `src/services/calcoloService.ts` (unico punto che scrive). Niente formule nel frontend.
6. **Mai inventare dati.** Vietati i ripieghi verosimili (`|| 75`, `|| 3500`, `|| 'Senior Advisor'`,
   righe fabbricate). Il dato mancante si mostra come mancante. Per numeri dove 0 è valido
   si usa `??`, mai `||`.
7. **Importi in centesimi** (`Int`) nel DB; la conversione in euro si fa solo per mostrarli.
8. **Un file = un compito.** Sopra ~500 righe si valuta lo split, sopra ~800 è obbligatorio
   pianificarlo. Non far crescere i file già oltre soglia: estrai.
9. **Permessi.** Ogni rotta nuova o toccata dichiara chi può usarla: o è nella mappa
   `src/util/rbacModuli.ts`, o ha un controllo esplicito di `req.ruolo`. Per gli utenti del team
   si usa `utenteGestibile()` in `src/routes/tenant.ts`.
10. **Audit.** `recordAudit` riceve sempre `userId`, `ruolo` e `ipAddress` della richiesta.
11. **Errori.** Niente `catch {}` o `.catch(() => {})` su scritture: l'errore si logga e si restituisce.
12. **Ogni blocco o calcolo automatico è spiegabile in una frase** all'utente (tooltip o nota).
13. **Stati vuoto / caricamento / errore distinti** in ogni schermata: un errore non è "nessun dato".
14. Il sistema propone, l'operatore umano approva e firma (ambito legale, fiscale, AML).
15. Stili dai token di progetto e classi esistenti (`.btn`), niente colori scritti a mano.
16. **Anti-loop:** se un fix fallisce due volte, fermati e risali alla causa.

## Test
- Ogni correzione di un bug porta un test che fallisce prima e passa dopo.
- Se un test esistente "conferma" il comportamento sbagliato, si corregge il test nello stesso commit
  e lo si dichiara nel riepilogo.
- Durante il lavoro solo il file di test toccato; la suite intera una volta, prima del commit.

## Git e deploy
- Un commit = uno step di PIANO.md. Messaggio in italiano, stile `fix(area): cosa cambia`.
- Claude Code fa il commit in locale, **non fa push** e **non fa deploy**: niente `git push`,
  `railway`, `vercel`, `ssh`, `scripts/distribuisci.sh`.
- Attenzione: un push su `main` fa partire il deploy automatico del backend su Railway e applica le
  migrazioni. Una migrazione committata non è inerte.
- Ramo di lavoro: correzioni-diagnosi. Mai committare su main: main è la produzione e si aggiorna
  solo unendo il ramo (merge = deploy Railway).
- Su Windows i messaggi di commit si passano da file (git commit -F), perché PowerShell spezza le
  virgolette.

## Documentazione
- Durante il lavoro **non si toccano i file .md** (questo vale anche contro la regola 3 e 4 di
  ISTRUZIONI_PER_IA.md: .md e `graphify update .` si aggiornano a fine giornata, in un commit `docs:`).
- Eccezione: una nuova regola di questo file che serve al commit successivo.
- Il "perché" lungo va nel messaggio di commit, non nei commenti (commenti di 2-5 righe).
