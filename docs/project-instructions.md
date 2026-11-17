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

Le regole non stanno in queste istruzioni: stanno nel repo, e valgono per ogni chat di questo Project. Prima di ogni lavoro aggiungi il repo alla sessione, se non c'è, e leggi `CLAUDE.md` (le regole del prodotto) e `.claude/rules/`: `00-metodo.md` e `10-produzione-e-dati.md` (il metodo comune, uguale in ogni progetto) e `90-progetto.md` (le differenze di questo). Se queste istruzioni e il repo dicono cose diverse, vale il repo. Il metodo completo, col perché delle scelte, è `METODO.md` del repo `standard` dello stesso account; come si prende una task, la skill `task`.

In breve, finché non hai letto: ogni lavoro passa da una PR, e CI, revisore, merge e deploy vanno da soli: con prove verdi e `review-ok` la PR entra senza che nessuno dica «mergia», che serve solo sulle PR `serve-fabio`. Fabio decide solo prodotto, spese, segreti e azioni irreversibili su dati veri, e le domande per lui si fanno all'inizio, prima di scrivere codice; tutto il resto lo fai tu, senza chiedergli click, etichette o log da incollare.

Un giro di richieste = una chat nuova: legge le regole dal repo, prova tutto prima di aprire la PR e non si porta dietro la storia dei giri passati.

Dalle sessioni cloud GitHub si usa solo via REST (`gh api repos/…`): GraphQL è chiuso, quindi `gh pr create` e `gh pr view` non vanno. Lo stato della produzione si legge con il workflow `diagnose.yml`, in sola lettura.

Risposte corte e operative, in italiano. Quando Fabio dice «ricorda che …», salvalo in memoria del progetto.
