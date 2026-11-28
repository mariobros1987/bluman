# CLAUDE.md — BluMan

Le regole del PRODOTTO: cosa non si può sbagliare in questo progetto (dominio, dati, soldi),
stack, comandi. Il metodo di lavoro comune sta in `.claude/rules/00-metodo.md` e
`10-produzione-e-dati.md` (uguali in ogni progetto); le differenze di metodo di questo
progetto in `.claude/rules/90-progetto.md`. Contesto: ARCHITECTURE.md, DIARIO.md, DEPLOY.md,
`docs/manuale/` (una scheda per modulo), `.agents/AGENTS.md` (mappa dei file). Piano: PIANO.md.
Backlog del titolare: LAVORO_RIMANENTE.md (è suo). Storia e regole estese: ISTRUZIONI_PER_IA.md.

Gestionale multi-studio per studi di consulenza: progetti e moduli con motore di stato,
clienti, fatture e SdI, prima nota, LIPE, scadenzario, firma elettronica, KYC/AML, portale
cliente. Il prodotto è del titolare (Mario, `mariobros1987/bluman`); qui, nel fork
`wolftradesystem-tech/bluman`, gira il pilota automatico dello Standard.

Stack: Fastify 5 + TypeScript ESM (`src/`: rotte in `src/routes/`, logica in `src/services/`,
motore in `src/domain/`) · React 19 + Vite (`frontend/`) · PostgreSQL + Prisma 5.22
(`prisma/schema.prisma`, migrazioni versionate, RLS) · npm, non pnpm · Node 20-22.

## Vincoli assoluti (le 16 regole del titolare, per esteso in ISTRUZIONI_PER_IA.md)
1. **Isolamento tra studi.** Nel codice che serve una richiesta HTTP si usa `prisma` da
   `src/util/prismaClient.ts`, mai `new PrismaClient()`. `prismaAmministrativo()` solo in
   script, seed, bootstrap, backup e ricerca utente al login. Ogni `$transaction` interattiva
   va avvolta in `conContestoInTransazione(tx, …)` (esempio: `src/routes/progetti.ts:243`).
2. **Schema** solo con migrazioni (`prisma migrate dev`). Mai `db push`, mai il flag che accetta
   la perdita di dati; da una sessione mai `migrate deploy` né `migrate reset`, anche dove l'hook
   di `.claude/settings.json` non c'è (10-produzione, punto 6). Ogni migrazione che crea una tabella con `tenant_id` porta la sua policy RLS.
3. **Persistenza vera.** Tutto ciò che l'utente modifica si salva via API nel DB.
   `localStorage` solo come copia; un salvataggio fallito si dichiara, non si chiude il modale.
4. **Niente credenziali** nel codice o nei .md, neanche come ripiego. Presidio: `src/credenziali.test.ts`.
5. **Stati e percentuali li calcola il backend**: `src/domain/stateEngine.ts` (puro) e
   `src/services/calcoloService.ts` (unico punto che scrive). Niente formule nel frontend.
6. **Mai inventare dati.** Vietati i ripieghi verosimili (`|| 75`, `|| 3500`, `|| 'Senior Advisor'`,
   righe fabbricate). Il dato mancante si mostra come mancante. Dove 0 è valido si usa `??`, mai `||`.
7. **Importi in centesimi** (`Int`) nel DB; la conversione in euro si fa solo per mostrarli.
8. **Un file = un compito.** Sopra ~500 righe si valuta lo split, sopra ~800 si pianifica.
   Non far crescere i file già oltre soglia: estrai.
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

## Dove chiedere a Fabio (oltre alle regole comuni)
- Una regola di business nuova (fiscale, firma, KYC/AML): la decide il titolare, tramite Fabio.
- Qualunque cosa tocchi i dati veri degli studi in produzione (blusmart.eu, Railway).

## Aree a effort alto
- Sono le righe «sensibile» di `.github/livelli.txt`: `prisma/`, `src/util/prismaClient.ts`,
  accessi e permessi (`src/util/authorization.ts`, `rbacModuli.ts`, `jwt.ts`, `src/routes/auth.ts`,
  `tenant.ts`, `portale.ts`), motore e soldi (`src/domain/`, `calcoloService.ts`, fatture/SdI,
  LIPE, prima nota), firma, KYC/AML, e la produzione del titolare (`Dockerfile`,
  `docker-compose.prod.yml`, `nginx/`).

## Comandi
- Sviluppo: `npm run dev` (backend su :3000) · `cd frontend && npm run dev`
- Typecheck: `npx tsc --noEmit` · Build: `npm run build` · Client Prisma: `npx --no-install prisma generate`
- Test di un file: `npx vitest run src/<file>.test.ts` · Suite intera: solo in CI (livello sensibile)
- Frontend (in `frontend/`): `npx tsc -b --force` · `npm run lint` · `npx vitest run src/<file>.test.tsx` · `npm run build`
- Schema DB: `npx --no-install prisma migrate dev --name <nome>` (sempre `--no-install`: mai far scaricare Prisma 8)
- Test: ogni bug porta un test che fallisce prima e passa dopo; un test che «conferma» il
  comportamento sbagliato si corregge nello stesso commit e lo si dichiara.

## Convenzioni del repo
- Ramo di produzione del fork: `main`, che avanza solo col merge automatico delle PR.
  Rami di lavoro: `fix/…`, `feat/…`, `chore/…`, `docs/…`.
- Commit: `tipo(area): cosa — perché`, in italiano; su Windows il messaggio da file (`git commit -F`).
- Il «perché» lungo va nel messaggio di commit e nel DIARIO, non nei commenti (2-5 righe).

## Repo, pubblicazione e produzione (il resto in DEPLOY.md)
- `origin` = il fork; `upstream` = `mariobros1987/bluman` con push disattivato (`NO_PUSH`):
  non si cambia mai. Mai `git push` su `main`, mai verso upstream.
- Dal fork non si deploya su un server: si pubblica. Dopo ogni merge `deploy.yml` lancia
  `scripts/pubblica.sh --automatico` (PR da `wolftradesystem-tech:main` a `mariobros1987/bluman`
  `main`, unita da sola se non porta migrazioni); `--merge` a mano solo quando Fabio scrive
  «pubblica». All'unione Railway e Vercel (bluman.vercel.app, copia di riserva) pubblicano da
  soli; blusmart.eu si aggiorna dal cron del server (`scripts/aggiorna-blusmart-auto.sh`, che
  lancia `aggiorna-blusmart.sh --applica` con la copia del database prima) (Fabio, 28/11).
- Una pubblicazione che cambia `prisma/migrations` si unisce solo dopo un backup del DB di
  produzione (Railway applica le migrazioni senza backup): `pubblica.sh` lo scrive in testa
  alla PR, con `--automatico` non la unisce e con `--merge` rifiuta senza `--backup-fatto`.
- `railway`, `vercel`, `scripts/distribuisci.sh`: del titolare. `ssh` sul server: Fabio, con la sua chiave
  (dal 27/11); una sessione mai, scrive i comandi esatti. `backup-vps.sh`, `monitor-vps.sh`, `aggiorna-blusmart-auto.sh` girano da soli sul server.
