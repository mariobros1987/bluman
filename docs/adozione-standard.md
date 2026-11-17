# Adozione dello Standard — BluMan (17/11/2026)

I valori di QUESTA adozione: repo, runner, workflow, cosa c'è e cosa manca. Lo Standard
(`wolftradesystem-tech/standard`) resta generico; qui stanno i nomi veri. Decisioni e perché:
DIARIO.md del 17/11; differenze di metodo: `.claude/rules/90-progetto.md`; come si pubblica: DEPLOY.md.

## Repo
| | |
|---|---|
| `origin` | `https://github.com/wolftradesystem-tech/bluman.git` — il fork, **pubblico** (un fork non cambia visibilità), ramo di produzione `main` = ramo predefinito |
| `upstream` | `https://github.com/mariobros1987/bluman.git` del titolare (Mario), push `NO_PUSH`: **mai cambiarlo** |
| Pubblicazione | PR `wolftradesystem-tech:main` → `mariobros1987/bluman` `main`, `scripts/pubblica.sh`; unita su «pubblica» di Fabio |
| Il 17/11 | alle 10:56 `5a9c293` è finito su `main` di upstream per sbaglio (senza migrazioni; Railway e Vercel hanno pubblicato, blusmart.eu no) |

## Dove gira la produzione (nessuna è del fork)
| Posto | Cosa | Chi aggiorna |
|---|---|---|
| blusmart.eu, server Register.it | produzione usata dallo studio (`docker-compose.prod.yml`) | solo il titolare, `scripts/distribuisci.sh --solo-vps` |
| Railway | backend, auto-deploy da `main` di upstream, `prisma migrate deploy` all'avvio **senza backup** | la pubblicazione |
| Vercel, bluman.vercel.app | frontend, copia di riserva | la pubblicazione (dichiarato da Fabio; il manuale 19 dice che il deploy da webhook resta `BLOCKED`: **da verificare** alla prima pubblicazione) |

## Runner e job
- Un solo tipo di runner: «ci» sul PC di Fabio, nella distribuzione WSL `ci-runner` (`server/ci-runner.ps1 prepara`, poi `aggiungi wolftradesystem-tech/bluman`, 5 runner). Su questo PC al 17/11 la distribuzione non c'era ancora (`wsl -l`: Ubuntu, docker-desktop); i runner degli altri repo stanno in Ubuntu.
- Nessun runner di server: nessun deploy, backup o diagnosi dal fork. Etichetta, merge, sentinella, riepilogo e il `deploy.yml` segnaposto girano anch'essi su «ci». Col PC spento non gira niente.
- Cosa serve sul runner: Node (lo installa `actions/setup-node`), npm, `gh`, `jq` (li mette `prepara-ci-wsl.sh`), rete verso npm e binaries.prisma.sh. Niente Docker, niente Postgres: la suite backend non vuole un database (`vitest.setup.ts`).
- Prove sul livello sensibile: suite backend (159 file, ~6 minuti su un PC con 4 worker, misurato dal titolare il 10/10) e frontend (56 file) in 3 parti (`vitest --shard`), ognuna con `maxWorkers: 4` del `vitest.config.ts`: 3 parti in parallelo = 12 worker + jsdom. Se il PC soffre, si abbassa il tetto nel config (ipotesi, non misurato).

## Workflow (compilati dai modelli dello Standard al commit `fae0a16`)
| File | Nel fork | Fuori dal fork (repo del titolare) |
|---|---|---|
| `ci.yml` | runner «ci»; livelli da `.github/livelli.txt` | **senza guardia**: gira sulle macchine di GitHub coi minuti del titolare (`ubuntu-latest` scelto dall'espressione sul repository) |
| `review.yml`, `fix.yml`, `task.yml`, `automerge.yml`, `sentinella.yml`, `riepilogo.yml`, `deploy.yml` | runner «ci», solo PR da rami del fork | spenti: `if: github.repository == 'wolftradesystem-tech/bluman'` su ogni job |
| `deploy.yml` | **non deploya**: avviso Telegram «main avanzato, N commit da pubblicare, migrazioni sì/no»; esiste perché `automerge.sh` lo lancia dopo ogni merge | spento |
| `backup.yml`, `diagnose.yml` | **non ci sono** (nessun server del fork) | — |

Modifiche ai modelli, dichiarate: il passo «gh e jq» non usa `apt-get` (sul runner «ci» l'utente non ha sudo) ma controlla che ci siano; il passo «cartella di lavoro pulita» di `ci.yml` svuota solo una cartella `_work` (sulle macchine di GitHub non c'è); `ci.yml` non avvia Postgres e Redis.

## Script
- Comuni dello Standard, copiati così come sono (`strumenti/aggiorna-metodo.sh`): `push-ramo`, `review-label`, `automerge`, `livello`, `ci-rossa`, `sentinella`, `ci-notify`, `notify`, `setup-github`; e anche `deploy`, `rollback`, `backup`, `prova-ripristino`, `diagnose`, che qui **non girano** (nessun server) ma restano per tenere il metodo allineato.
- `scripts/progetto.env`: `NOME_PROGETTO=bluman`, `WEB_RE='^frontend/'`; prova dello schema e tabelle vuote di proposito. Niente `scripts/deploy.env.example`: non c'è un server su cui scriverlo.
- Propri del progetto, intatti: `distribuisci.sh`, `backup-vps.sh`, `monitor-vps.sh` (del titolare, blusmart.eu), gli `.mjs` dei dati, `e2e/`. Nuovo: `scripts/pubblica.sh`.

## Secret del fork (li mette Fabio, mai nei file)
`CLAUDE_CODE_OAUTH_TOKEN`, `CI_TELEGRAM_TOKEN` e `CI_TELEGRAM_CHAT` (bot nuovo `bluman_ci_bot`), `RUNNER_PROBE_TOKEN` (fine-grained sul solo fork: Administration read; Contents, Issues, Pull requests, Workflows read and write).

## Impostazioni del repo (fatte da Claude il 17/11 con `gh`)
- `scripts/setup-github.sh wolftradesystem-tech/bluman main`: etichette di esito, ramo predefinito `main`, rami cancellati dopo il merge, squash ammesso.
- Fork pubblico: approvazione richiesta per i workflow di **tutti** i collaboratori esterni (`fork-pr-contributor-approval = all_external_contributors`), così una PR da un fork esterno non esegue codice sul PC senza il sì di Fabio. `pull_request_target` non ha approvazione: per questo revisore e merge girano solo su PR da rami del fork.
- Da fare dopo il merge della PR di adozione: abilitare i workflow a orario (`sentinella.yml`, `riepilogo.yml`): GitHub li lascia spenti nei fork (`gh workflow enable`).

## Regole e documenti
- `.claude/rules/00-metodo.md` e `10-produzione-e-dati.md` identici allo Standard; `90-progetto.md` con le differenze; `CLAUDE.md` con le 16 regole del titolare (invariate) e i comandi npm.
- `.claude/settings.json` versionato (prima tutta `.claude/` era ignorata): deny di prima più quelli dello Standard; via il deny di `git push` (il metodo spinge i rami di lavoro sul fork), restano vietati `--force`, `upstream`, `origin main`, `db push`, `migrate deploy/reset`, il flag che accetta la perdita di dati, `railway`, `vercel`, `ssh`, `scp`, `distribuisci.sh`.
- Hook `.claude/hooks/stato.cjs` (stato all'avvio) e `no-full-suite.cjs` (la suite intera la fa la CI).
- Nuovi: DIARIO.md, ARCHITECTURE.md, DEPLOY.md, `docs/project-instructions.md`, `.github/livelli.txt`, `.github/pull_request_template.md`, `.gitattributes` (DIARIO senza conflitti). PIANO.md: sezione «Standard» in testa.
- Documenti del titolare in radice (ISTRUZIONI_PER_IA, ISTRUZIONI_INSTALLAZIONE, LAVORO_RIMANENTE, GUIDA_*, PIANO_MIGRAZIONE_VPS, specifiche): **lasciati dove stanno**; spostarli in `docs/storico/` tocca i rimandi di README, manuale e `src/credenziali.test.ts` ed è da concordare col titolare (PIANO S.4).

## Non fatto / da verificare
- Prima CI sul runner «ci»: da vedere sulla PR di adozione (vitest `--changed` dal sottoprogetto `frontend/`, Prisma generate nella distribuzione isolata). Se è rossa, la corregge Claude sulla stessa PR.
- Vercel all'unione della pubblicazione: misurare (vedi sopra).
- Isolamento di `ci-runner` su questo PC: lo misura `ci-runner.ps1 prepara` (`controlla-ci-isolato.sh`).
- Riepilogo e sentinella: abilitare gli schedule dopo il merge.
- `packageManager` in `package.json`: avviso di `aggiorna-metodo.sh` pensato per pnpm; con npm non serve e non si mette.
