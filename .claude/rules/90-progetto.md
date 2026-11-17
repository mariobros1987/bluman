# Metodo: differenze di BluMan

> Qui, e solo qui, questo progetto si discosta dal metodo comune (`00-metodo.md`,
> `10-produzione-e-dati.md`) o lo completa. Una riga per differenza, con il perché e la
> data. Le regole del prodotto stanno in `CLAUDE.md`; i valori dell'adozione in
> `docs/adozione-standard.md`; come si pubblica in `DEPLOY.md`.

- Repo: `origin` è il fork `wolftradesystem-tech/bluman` (produzione del fork = `main`); `upstream` è `mariobros1987/bluman` del titolare, con push disattivato (`NO_PUSH`): non si cambia mai, perché il 17/11 un push è finito per sbaglio sul suo `main` (17/11).
- Nessun deploy dal fork: niente runner di server, `backup.yml`, `diagnose.yml`; `deploy.yml` non deploya, segna il merge su Telegram, ed esiste solo perché `automerge.sh` (comune) lo lancia dopo ogni merge (17/11).
- Tutti i job, anche etichetta, merge, sentinella e riepilogo, girano sui runner «ci» del PC: senza server la separazione PC/server del metodo non c'è. Limite dichiarato: col PC spento non gira niente, nemmeno il riepilogo (17/11).
- Pubblicazione = PR da `wolftradesystem-tech:main` a `mariobros1987/bluman` `main` (`scripts/pubblica.sh`); si unisce con `gh pr merge` solo quando Fabio scrive «pubblica». All'unione Railway e Vercel (bluman.vercel.app, copia di riserva) pubblicano da soli; blusmart.eu lo aggiorna solo il titolare con `scripts/distribuisci.sh --solo-vps` (17/11).
- Una pubblicazione che cambia `prisma/migrations` si unisce solo dopo un backup del DB di produzione, perché Railway applica le migrazioni all'avvio senza backup; `pubblica.sh` lo scrive in testa alla PR da solo e con `--merge` rifiuta senza `--backup-fatto` (17/11).
- Schema con `prisma migrate dev` e migrazioni versionate, non `db push` (regola 2 del titolare): la deroga alla regola 4 di `10-produzione-e-dati.md` vale solo per il comando; il flag che accetta la perdita di dati resta vietato (17/11).
- Workflow con secret (review, fix, task, automerge, sentinella, riepilogo, deploy) con la guardia `if: github.repository == 'wolftradesystem-tech/bluman'`, perché con la pubblicazione arrivano anche nel repo del titolare; `ci.yml` senza guardia, e fuori dal fork gira sulle macchine di GitHub coi minuti del titolare, com'era prima (17/11).
- Il fork è pubblico (un fork non cambia visibilità): revisore e merge solo su PR da rami del fork; la CI di una PR da un fork esterno parte solo con l'approvazione di Fabio (impostazione del repo) (17/11).
- npm, non pnpm; Node 22 in CI (engines `>=20 <23`); niente `packageManager`, che è un avviso pensato per pnpm (17/11).
- Il titolare del prodotto è Mario (`mariobros1987`): le regole di business nuove si chiedono a lui tramite Fabio; `LAVORO_RIMANENTE.md` è il suo backlog e resta suo (17/11).
- Backup fuori dal server: non è del fork; il backup di blusmart.eu è del titolare (`scripts/backup-vps.sh`) (17/11).
