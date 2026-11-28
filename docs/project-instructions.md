<!-- Istruzioni del Project «BluMan» su claude.ai: incolla tutto in Project settings → Project
     instructions. Da «## Come si lavora qui» in giù il testo è COMUNE a ogni progetto e lo
     riallinea strumenti/aggiorna-metodo.sh dello Standard; la parte in alto è di BluMan. -->

# BluMan

Gestionale multi-studio per studi di consulenza: progetti con motore di stato, clienti, fatture e SdI,
prima nota, LIPE, scadenzario, firma elettronica, KYC/AML, portale cliente. Il prodotto è del titolare
(Mario, `mariobros1987/bluman`); il pilota dello Standard gira nel fork.

Dove gira: la produzione usata dallo studio è blusmart.eu (server Register.it), aggiornata solo dal titolare; Railway (backend) e Vercel (bluman.vercel.app, copia di riserva) pubblicano da `main` di `mariobros1987/bluman`. Repo: wolftradesystem-tech/bluman (fork, `origin`), ramo di produzione `main`; `upstream` = `mariobros1987/bluman` con push disattivato. Dal fork non si deploya: si pubblica con `scripts/pubblica.sh` (PR verso upstream), unita solo su «pubblica» di Fabio, e con migrazioni solo dopo un backup del DB (DEPLOY.md).
Intoccabile: il remote `upstream` (mai push), `main` del fork (solo merge automatico), i dati veri degli studi, `scripts/distribuisci.sh`, `backup-vps.sh`, `monitor-vps.sh` e tutto ciò che è del titolare (Railway, Vercel, server), `LAVORO_RIMANENTE.md`.
Referente: Fabio, italiano, risponde dal telefono.

## Come si lavora qui

Le regole non stanno in queste istruzioni: stanno nel repo, e valgono per ogni chat e ogni thread di questo progetto. Prima di ogni lavoro aggiungi il repo alla sessione, se non c'è, e leggi `CLAUDE.md` (le regole del prodotto) e `.claude/rules/`: `00-metodo.md` e `10-produzione-e-dati.md` (il metodo comune) e `90-progetto.md` (le differenze di questo). Se queste istruzioni e il repo dicono cose diverse, vale il repo. Il perché delle scelte è in `METODO.md` del repo `standard` dello stesso account.

In breve, finché non hai letto:
- Ogni lavoro passa da una PR; CI, revisore, merge e deploy vanno da soli. Fabio decide solo prodotto, spese, segreti e azioni irreversibili su dati veri, con le domande all'inizio; il resto lo fai tu.
- Un giro di richieste di Fabio = un thread = una PR. Il coordinatore apre più thread solo per un'altra area o una parte urgente (`00-metodo.md`, punti 9 e 10).
- Il thread lavora sul ramo che gli dà Claude Code, apre la PR con gli strumenti GitHub che ha e la segue fino al merge, correggendo prove rosse e richieste del revisore. Non mergia mai e non mette etichette, tranne `ok-fabio` quando Fabio scrive «mergia la #N» su una PR `serve-fabio`.
- I thread non leggono `.claude/settings.json`: i divieti scritti lì valgono lo stesso (`10-produzione-e-dati.md`, punto 6).
- Lo stato della produzione si legge con il workflow `diagnose.yml`, in sola lettura.
- La memoria del progetto può essere spenta: quando Fabio dice «ricorda che …», scrivilo nel repo, nel `DIARIO.md` (prodotto) o in `.claude/rules/90-progetto.md` (metodo del progetto), con una PR.

Risposte corte e operative, in italiano.
