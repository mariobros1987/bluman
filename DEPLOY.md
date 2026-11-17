# DEPLOY — BluMan

La verità sono i workflow in `.github/workflows/` e `scripts/pubblica.sh`. Questa pagina dice
chi fa cosa, da dove parte la produzione e cosa fare quando non va. **Dal fork non si deploya.**

## Tre posti, tre ruoli
| Dove | Cos'è | Chi lo aggiorna |
|---|---|---|
| `wolftradesystem-tech/bluman` (fork, `origin`) | dove gira il pilota dello Standard; `main` = produzione del fork | il merge automatico delle PR |
| `mariobros1987/bluman` (`upstream`, push disattivato) | il repo del titolare; da `main` Railway (backend) e Vercel (bluman.vercel.app, copia di riserva) pubblicano da soli | la PR di pubblicazione, unita su «pubblica» di Fabio |
| blusmart.eu (server Register.it) | la produzione usata dallo studio (`docker-compose.prod.yml`, nginx, backup notturno) | **solo il titolare**, `scripts/distribuisci.sh --solo-vps` |

## Chi fa il merge nel fork (pilota automatico)
- Su ogni PR verso `main`: `ci.yml` (check, test) e `review.yml` (revisore Claude) in parallelo.
- `review.yml` gira su `pull_request_target`: file, script e regole sono sempre quelli di `main`, anche su una PR che cambia `review.yml`; il codice della PR si scarica in `pr/` e si legge soltanto. Il job `etichetta` mette `review-ok` / `review-da-correggere` / `serve-fabio` con `scripts/review-label.sh` e prova il merge.
- `automerge.yml` (`workflow_run` alla fine di `ci`, `pull_request_target` su un'etichetta) riprova il merge con il solo `main` scaricato; `scripts/automerge.sh` mergia quando CI e revisione sono verdi. Un commit nuovo toglie tutte le etichette di esito.
- `review-da-correggere` e prove rosse lanciano `fix.yml` (2 giri, poi `serve-fabio`); `sentinella.yml` ogni mezz'ora rilancia ciò che il sistema sa sistemare; `riepilogo.yml` ogni sera su Telegram.
- Una issue o un commento che comincia con `@claude` (solo il proprietario) lancia `task.yml`.
- Tutti i job girano sui runner «ci» del PC (`server/ci-runner.ps1` dello Standard): col PC spento restano in coda.
- Solo PR da rami del fork: il fork è pubblico, e una PR da un fork esterno non ha revisore né merge (la sua CI parte solo con l'approvazione di Fabio).
- Fabio serve solo con `serve-fabio`: legge il commento e dice in chat «mergia la #N»; l'etichetta `ok-fabio` la mette una sessione di Claude.
- Dopo ogni merge `automerge.sh` lancia `deploy.yml`, che qui **non deploya**: scrive su Telegram quanti commit aspettano la pubblicazione e se portano migrazioni.

## Pubblicare (dal fork al titolare)
```
bash scripts/pubblica.sh                      # apre o aggiorna la PR su mariobros1987/bluman
bash scripts/pubblica.sh --merge              # SOLO quando Fabio scrive «pubblica»
bash scripts/pubblica.sh --merge --backup-fatto   # se la PR porta migrazioni, dopo il backup del DB
```
- La PR va da `wolftradesystem-tech:main` a `main` di upstream, con l'elenco dei commit, dove arrivano e, **in testa**, l'avviso se cambiano `prisma/migrations`: Railway applica le migrazioni all'avvio del container (`Dockerfile`: `prisma migrate deploy`) senza fare un backup, quindi si unisce solo dopo un backup del DB di produzione. Senza `--backup-fatto` lo script rifiuta.
- Unione con merge commit (non squash), poi `gh repo sync` riallinea `main` del fork a upstream: altrimenti alla pubblicazione dopo i due rami divergono.
- Se il titolare ha pubblicato altro su upstream, `pubblica.sh` si ferma: prima si porta `upstream/main` nel fork con una PR normale.
- Vercel: il manuale (`docs/manuale/19-infra-deploy.md`) dice che il deploy da webhook GitHub resta `BLOCKED` e pubblica solo la CLI (`npx vercel --prod`, del titolare). Da misurare alla prima pubblicazione; finché non è misurato, la copia di riserva potrebbe restare indietro.

## Produzione dello studio (blusmart.eu): del titolare
`scripts/distribuisci.sh --solo-vps` (codice, frontend, `migrate` + `rls`, backend, reload di nginx), `scripts/backup-vps.sh` (notturno, cifrato, 14 set), `scripts/monitor-vps.sh` (ogni 10 minuti, Telegram del titolare). Dettagli e stati limite: `docs/manuale/19-infra-deploy.md`. Da una sessione: mai `ssh`, mai `railway`, mai `vercel`, mai `distribuisci.sh`.

## Rollback
- Fork: non c'è niente da riportare indietro (nessun deploy). Una PR sbagliata si corregge con una PR nuova.
- Railway e Vercel: dalla loro dashboard (titolare), o una pubblicazione nuova che riporta il codice.
- blusmart.eu: del titolare (`distribuisci.sh --solo-vps` su un commit precedente). Lo schema non torna indietro da solo: le migrazioni si fanno compatibili all'indietro.

## Segreti
- Fork (secret di GitHub): `CLAUDE_CODE_OAUTH_TOKEN`, `CI_TELEGRAM_TOKEN`, `CI_TELEGRAM_CHAT` (bot `bluman_ci_bot`), `RUNNER_PROBE_TOKEN` (push del correttore e delle task).
- Produzione: `.env` su Railway e sul server (`.env.prod.example` dice le variabili), mai nel repo.
