# Produzione, segreti e dati — COMUNE A TUTTI I PROGETTI

> File comune: identico in ogni repo, viene dallo Standard (repo `standard` dello stesso account).
> Non si modifica qui: si cambia nello standard e si riporta con
> `strumenti/aggiorna-metodo.sh`. Le differenze di questo progetto stanno in
> `90-progetto.md`.

1. **Mai segreti** in file versionati, log, messaggi, PR. Se se ne vede uno in
   chiaro, si segnala e non si copia. Il `.env` vero non si tocca da una sessione;
   le variabili nuove vanno in `.env.example` con un commento.
2. **Sui server si passa dai workflow** (deploy, diagnose, backup): una sessione
   non usa SSH. Un passo una tantum si scrive in `scripts/` e lo lancia la CI, o
   Fabio con il comando esatto.
3. **Su un server condiviso** non si toccano processi o container di altri
   progetti. Docker e pm2 solo per nome esatto, mai per sottostringa.
4. **Database:** mai il flag che accetta la perdita di dati in uno script o in
   un workflow (se il push lo chiede, ci si ferma e lo si dice); schema
   compatibile all'indietro (prima si aggiunge, si toglie in una PR successiva),
   perché il rollback riporta il codice e non lo schema.
5. **Script sui dati:** prima a vuoto, poi `--apply`; sempre ripetibili senza danni.
