# Metodo: differenze di BluMan

> Qui, e solo qui, questo progetto si discosta dal metodo comune (`00-metodo.md`,
> `10-produzione-e-dati.md`) o lo completa. Una riga per differenza, con il perché e la
> data. Le regole del prodotto stanno in `CLAUDE.md`; i valori dell'adozione in
> `docs/adozione-standard.md`; come si pubblica in `DEPLOY.md`.

- Repo: `origin` è il fork `wolftradesystem-tech/bluman` (produzione del fork = `main`); `upstream` è `mariobros1987/bluman` del titolare, con push disattivato (`NO_PUSH`): non si cambia mai, perché il 17/11 un push è finito per sbaglio sul suo `main` (17/11).
- Nessun deploy dal fork su un server: niente runner di server, `backup.yml`, `diagnose.yml`; `deploy.yml` pubblica verso il titolare (`pubblica.sh --automatico`, col secret `PUBBLICA_TOKEN`), lanciato da `automerge.sh` (comune) dopo ogni merge (17/11; Fabio, 28/11).
- Tutti i job, anche etichetta, merge, sentinella e riepilogo, girano sui runner «ci» del PC: senza server la separazione PC/server del metodo non c'è. Limite dichiarato: col PC spento non gira niente, nemmeno il riepilogo (17/11).
- Pubblicazione = PR da `wolftradesystem-tech:main` a `mariobros1987/bluman` `main` (`scripts/pubblica.sh`); si unisce da sola dopo ogni merge nel fork se non porta migrazioni, altrimenti su «pubblica» di Fabio (Fabio, 28/11, d'accordo il titolare). All'unione Railway e Vercel (bluman.vercel.app, copia di riserva) pubblicano da soli (17/11); blusmart.eu si aggiorna dal cron del server entro 10 minuti (`aggiorna-blusmart-auto.sh`, lo installa Fabio una volta), e a mano resta `aggiorna-blusmart.sh` via ssh con la chiave personale di Fabio (revocabile) o `distribuisci.sh --solo-vps` del titolare; la sessione non entra nel server, scrive i comandi esatti (Fabio, 27/11 e 28/11).
- Una pubblicazione che cambia `prisma/migrations` si unisce solo dopo un backup del DB di produzione, perché Railway applica le migrazioni all'avvio senza backup; `pubblica.sh` lo scrive in testa alla PR da solo e con `--merge` rifiuta senza `--backup-fatto` (17/11).
- Schema con `prisma migrate dev` e migrazioni versionate, non `db push` (regola 2 del titolare): la deroga alla regola 4 di `10-produzione-e-dati.md` vale solo per il comando, e al punto 6 solo per `migrate dev`; il flag che accetta la perdita di dati resta vietato (17/11; punto 6, 28/11).
- Workflow con secret (review, fix, task, automerge, sentinella, riepilogo, deploy) con la guardia `if: github.repository == 'wolftradesystem-tech/bluman'`, perché con la pubblicazione arrivano anche nel repo del titolare; `ci.yml` senza guardia, e fuori dal fork gira sulle macchine di GitHub coi minuti del titolare, com'era prima (17/11).
- Il fork è pubblico (un fork non cambia visibilità): revisore e merge solo su PR da rami del fork; la CI di una PR da un fork esterno parte solo con l'approvazione di Fabio (impostazione del repo) (17/11).
- npm, non pnpm; Node 22 in CI (engines `>=20 <23`); niente `packageManager`, che è un avviso pensato per pnpm (17/11).
- Il titolare del prodotto è Mario (`mariobros1987`): le regole di business nuove si chiedono a lui tramite Fabio; `LAVORO_RIMANENTE.md` è il suo backlog e resta suo (17/11).
- Backup fuori dal server: non è del fork; il backup notturno di blusmart.eu è del titolare (`scripts/backup-vps.sh`); `aggiorna-blusmart.sh --applica` ne lancia uno in più prima di toccare il server (17/11, 27/11).
