# DEPLOY — BluMan

La verità sono i workflow in `.github/workflows/` e `scripts/pubblica.sh`. Questa pagina dice
chi fa cosa, da dove parte la produzione e cosa fare quando non va. **Dal fork non si deploya su un server: si pubblica**, e dal 28/11 da solo (tranne le migrazioni).

## Tre posti, tre ruoli
| Dove | Cos'è | Chi lo aggiorna |
|---|---|---|
| `wolftradesystem-tech/bluman` (fork, `origin`) | dove gira il pilota dello Standard; `main` = produzione del fork | il merge automatico delle PR |
| `mariobros1987/bluman` (`upstream`, push disattivato) | il repo del titolare; da `main` Railway (backend) e Vercel (bluman.vercel.app, copia di riserva) pubblicano da soli | la PR di pubblicazione, unita da sola dopo ogni merge nel fork; con migrazioni su «pubblica» di Fabio |
| blusmart.eu (server Register.it) | la produzione usata dallo studio (`docker-compose.prod.yml`, nginx, backup notturno) | da solo, dal cron del server entro 10 minuti dalla pubblicazione (`scripts/aggiorna-blusmart-auto.sh`); a mano Fabio, `scripts/aggiorna-blusmart.sh` via ssh, o il titolare, `scripts/distribuisci.sh --solo-vps` |

## Chi fa il merge nel fork (pilota automatico)
- Su ogni PR verso `main`: `ci.yml` (check, test) e `review.yml` (revisore Claude) in parallelo.
- `review.yml` gira su `pull_request_target`: file, script e regole sono sempre quelli di `main`, anche su una PR che cambia `review.yml`; il codice della PR si scarica in `pr/` e si legge soltanto. Il job `etichetta` mette `review-ok` / `review-da-correggere` / `serve-fabio` con `scripts/review-label.sh` e prova il merge.
- `automerge.yml` (`workflow_run` alla fine di `ci`, `pull_request_target` su un'etichetta) riprova il merge con il solo `main` scaricato; `scripts/automerge.sh` mergia quando CI e revisione sono verdi. Un commit nuovo toglie tutte le etichette di esito.
- `review-da-correggere` e prove rosse lanciano `fix.yml` (2 giri, poi `serve-fabio`); `sentinella.yml` ogni mezz'ora rilancia ciò che il sistema sa sistemare; `riepilogo.yml` ogni sera su Telegram.
- Una issue o un commento che comincia con `@claude` (solo il proprietario) lancia `task.yml`.
- Tutti i job girano sui runner «ci» del PC (`server/ci-runner.ps1` dello Standard): col PC spento restano in coda.
- Solo PR da rami del fork: il fork è pubblico, e una PR da un fork esterno non ha revisore né merge (la sua CI parte solo con l'approvazione di Fabio).
- Fabio serve solo con `serve-fabio`: legge il commento e dice in chat «mergia la #N»; l'etichetta `ok-fabio` la mette una sessione di Claude.
- Dopo ogni merge `automerge.sh` lancia `deploy.yml`, che qui **pubblica**: `scripts/pubblica.sh --automatico` (sotto), e su Telegram l'esito.

## Pubblicare (dal fork al titolare)
Da solo (Fabio, 28/11, d'accordo il titolare): dopo ogni merge nel fork `deploy.yml` lancia
`bash scripts/pubblica.sh --automatico` sul runner «ci» del PC, con `GH_TOKEN` = secret `PUBBLICA_TOKEN`.
Apre o aggiorna la PR e la unisce se **non** porta migrazioni; se le porta la lascia aperta, esce con 3
e su Telegram arriva «⚠️ porta migrazioni». Finché quella PR non si unisce, anche i merge dopo restano
in quella PR. A mano, sul PC:
```
bash scripts/pubblica.sh                      # apre o aggiorna la PR su mariobros1987/bluman
bash scripts/pubblica.sh --merge              # quando Fabio scrive «pubblica»
bash scripts/pubblica.sh --merge --backup-fatto   # se la PR porta migrazioni, dopo il backup del DB di Railway
```
- La PR va da `wolftradesystem-tech:main` a `main` di upstream, con l'elenco dei commit, dove arrivano e, **in testa**, l'avviso se cambiano `prisma/migrations`: Railway applica le migrazioni all'avvio del container (`Dockerfile`: `prisma migrate deploy`) senza fare un backup, quindi si unisce solo dopo un backup del DB di produzione. Senza `--backup-fatto` lo script rifiuta.
- Unione con merge commit (non squash), poi `gh repo sync` riallinea `main` del fork a upstream: altrimenti alla pubblicazione dopo i due rami divergono. Se un'altra PR entra nel fork in quei pochi secondi il sync non riesce, e la pubblicazione dopo si ferma come al punto qui sotto.
- Se il titolare ha pubblicato altro su upstream, `pubblica.sh` si ferma: prima si porta `upstream/main` nel fork con una PR normale.
- Vercel: il manuale (`docs/manuale/19-infra-deploy.md`) dice che il deploy da webhook GitHub resta `BLOCKED` e pubblica solo la CLI (`npx vercel --prod`, del titolare). Da misurare alla prima pubblicazione; finché non è misurato, la copia di riserva potrebbe restare indietro.

## Produzione dello studio (blusmart.eu)
Il server prende il codice da GitHub (`origin` sul server = `mariobros1987/bluman`), quindi prima si **pubblica**, poi si aggiorna.

### Da solo (dal 28/11)
`scripts/aggiorna-blusmart-auto.sh` gira dal cron di `bluman` ogni 10 minuti: legge `main` del titolare (pubblico, senza chiavi), e se in servizio (`.git/bluman-ultimo-aggiornamento`) c'è un'altra versione porta i file avanti (`git merge --ff-only`) e lancia `aggiorna-blusmart.sh --applica`. Inizio ed esito arrivano sul bot degli avvisi del server (`/etc/bluman/monitor.env`, lo stesso di `monitor-vps.sh`); il log in `/var/log/bluman/aggiorna-auto-<data>.log`, i giri in `/var/log/bluman/aggiorna-auto.log`. Si installa una volta, dal PC:
```
ssh blusmart "cd /opt/bluman && git pull --ff-only && bash scripts/installa-aggiornamento-automatico.sh"
```
- Non aggiorna da solo, e lo dice una volta sul bot: con `.git/bluman-auto-pausa` (pausa: `ssh blusmart "touch /opt/bluman/.git/bluman-auto-pausa"`, ripresa con `rm`), con il repo fuori da `main` (durante un ritorno a una versione di prima), con file del repo modificati a mano, con una storia di GitHub che non discende da quella del server, o senza versione in servizio registrata.
- Una versione fallita non si riprova ogni 10 minuti: riparte con la pubblicazione dopo, o con `--applica` lanciato a mano.
- Togliere: `ssh blusmart "cd /opt/bluman && bash scripts/installa-aggiornamento-automatico.sh --togli"`.
- `monitor-vps.sh` durante l'aggiornamento può avvisare del sito giù per qualche minuto: il messaggio «🔄 aggiornamento partito» arriva prima, nella stessa chat.

### A mano
Fabio entra con la sua chiave (`ssh blusmart`, configurata sul suo PC dal 27/11; il titolare la toglie con `sed -i '/fabio-bluman/d' ~/.ssh/authorized_keys`). Dal PC, in PowerShell:
```
ssh blusmart "cd /opt/bluman && git pull --ff-only && bash scripts/aggiorna-blusmart.sh"   # controlla e basta
ssh blusmart "cd /opt/bluman && bash scripts/aggiorna-blusmart.sh --applica"              # aggiorna
```
- Senza argomenti lo script dice cosa cambierebbe: versione su disco e in servizio, migrazioni da applicare, ultima copia, spazio. Si ferma se sul server ci sono file del repo modificati a mano.
- `--applica` si stacca dalla connessione (`setsid`, log in `/var/log/bluman/aggiorna-<data>.log`) e il terminale segue il log: se ssh cade l'aggiornamento continua, e il comando per rileggere il log è stampato all'inizio.
- I passi di `--applica`: copia di sicurezza subito (`backup-vps.sh`, se fallisce non tocca niente), frontend con `VITE_API_BASE=/api`, `migrate` + `rls`, container, nginx allineato e ricaricato, sonde (health, pagine HTML, cache, rotte, manuale). Sono i passi di `distribuisci.sh --solo-vps` del titolare, eseguiti sul server.
- Copiare una copia del database sul PC: `scp "blusmart:/var/backups/bluman/<file>.dump.enc" .` (cifrata con `BACKUP_ENCRYPTION_KEY` del `.env` del server).
- Durante l'aggiornamento `monitor-vps.sh` (ogni 10 minuti) può avvisare il titolare su Telegram: va avvisato prima.
- `scripts/backup-vps.sh` (notturno alle 3:17, cifrato, 14 set in `/var/backups/bluman`) e `scripts/monitor-vps.sh` girano da cron sul server. Dettagli e stati limite: `docs/manuale/19-infra-deploy.md`. Una sessione non entra mai nel server e non usa `railway`, `vercel`, `distribuisci.sh`.

## Rollback
- Fork: non c'è niente da riportare indietro (nessun deploy). Una PR sbagliata si corregge con una PR nuova.
- Railway e Vercel: dalla loro dashboard (titolare), o una pubblicazione nuova che riporta il codice.
- blusmart.eu: `aggiorna-blusmart.sh --applica` stampa alla fine il comando per tornare alla versione di prima (copia dello script in `/tmp`, `git checkout <commit>`, `BLUMAN_DIR=… --applica`, poi `git checkout main`). Finché il repo resta fuori da `main` l'aggiornamento automatico si ferma da solo; prima di tornare su `main` va corretta la causa con una pubblicazione nuova, o messa la pausa. Lo schema non torna indietro da solo: le migrazioni si fanno compatibili all'indietro; per i dati c'è la copia fatta all'inizio.

## Segreti
- Fork (secret di GitHub): `CLAUDE_CODE_OAUTH_TOKEN`, `CI_TELEGRAM_TOKEN`, `CI_TELEGRAM_CHAT` (bot `bluman_ci_bot`), `RUNNER_PROBE_TOKEN` (push del correttore e delle task), `PUBBLICA_TOKEN` (solo `deploy.yml`: PR e merge sul repo del titolare, sync del fork; token classic di Fabio con gli scope `public_repo` e `workflow`: un fine-grained non può puntare il repo di un altro account, e senza `workflow` GitHub rifiuta di unire una pubblicazione che cambia `.github/workflows/`, misurato il 28/11).
- Server: nessun segreto nuovo; il cron legge un repo pubblico e usa il bot degli avvisi che c'era già.
- Produzione: `.env` su Railway e sul server (`.env.prod.example` dice le variabili), mai nel repo.
- Canale protetto: messaggi e allegati del portale si cifrano con una chiave ricavata da `JWT_SECRET`, quindi in produzione da subito e senza variabili nuove. **Quando si cambia `JWT_SECRET`, il vecchio va anche in `CANALE_PROTETTO_CHIAVI_PRECEDENTI` e ci resta** (`docs/rotazione_segreti.md`): `JWT_PREVIOUS_SECRETS` dopo un giorno si svuota, e senza il vecchio segreto i messaggi scritti prima risultano «non leggibili su questo server» finché non ci torna. Chi vuole una chiave separata dai token mette `CANALE_PROTETTO_CHIAVE` (almeno 32 caratteri; più corta, il canale rifiuta di scrivere). Una copia del database senza la chiave non restituisce i messaggi: la chiave si tiene anche fuori dal server e dai suoi backup.
