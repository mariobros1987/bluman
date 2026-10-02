# VPS — checklist «primo avvio» (dopo aver comprato il server)

Runbook essenziale per accendere lo stack `docker-compose.prod.yml` su un VPS **nuovo**. Presuppone
VPS pronto (**Ubuntu 24.04 LTS**, Docker, firewall 22/80/443, Postgres non esposto) e il dettaglio in
`PIANO_MIGRAZIONE_VPS.md`. La catena migrate→rls→api è stata verificata in dry-run locale (PG17).

## 0. Predisporre il server (una volta sola)

Due trappole già incontrate su Register.it, entrambe **silenziose** — non danno errore, danno un
comportamento diverso da quello atteso:

- **`sudo` senza password non funziona anche se la regola c'è.** Le immagini cloud creano
  `/etc/sudoers.d/90-cloud-init-users` con `utente ALL=(ALL) ALL`. `sudo` applica **l'ultima** regola
  che legge, e i file di `sudoers.d` si leggono in ordine alfabetico: se la regola `NOPASSWD` si
  chiama `90-…`, il file di cloud-init viene letto dopo e vince quello con password. Va nominata
  `99-…`. Verifica con `sudo -n whoami` in una sessione **nuova**: in una sessione dove la password è
  già stata digitata da poco sudo la tiene in memoria per ~15 minuti, e il test passerebbe comunque.
- **`do-release-upgrade` rifiuta di partire** finché restano pacchetti arretrati («Please install all
  available updates for your release before upgrading»). Prima allineare la release installata
  (`apt-get update && apt-get upgrade -y && apt-get dist-upgrade -y`), poi lanciare l'upgrade di
  release **dentro `tmux`**: dura decine di minuti e in quel tempo `sshd` resta irraggiungibile a
  tratti (si aggiornano `systemd` e `dbus`), quindi una disconnessione non deve poterlo interrompere.

## 1. Prima di `up`
- [ ] Copia `.env.prod.example` → `.env` accanto al compose e **riempi tutti i segreti**
      (genera con i comandi indicati; `DATABASE_URL`/`DIRECT_URL` le mette il compose, non tu).
- [ ] **Le due password del database in esadecimale, non base64** (`openssl rand -hex 32`). Il compose
      le *interpola* dentro l'URL di connessione (`postgresql://utente:PASSWORD@postgres:5432/db`) e il
      base64 contiene anche `/`, che in un URL separa il percorso: la password viene tagliata lì e il
      resto finisce letto come host e porta. L'errore che ne esce è
      `P1013: The provided database string is invalid. invalid port number in database URL` — sembra
      una porta sbagliata o una rete che non risponde, e invece è un carattere di troppo nella
      password. Verifica dopo aver scritto il file, deve stampare `2`:
      `grep -cE '^(POSTGRES_PASSWORD|APP_DB_PASSWORD)=[0-9a-f]{64}$' .env`
      Il `.env` si scrive con `>` (sovrascrive); con `>>` una riesecuzione accoda un secondo set di
      variabili e resta sotto, invisibile, metà configurazione vecchia.
- [ ] Frontend: si serve **dal VPS**, sulla stessa origine dell'API (decisione del 30/09/2026). La
      build va fatta **dichiarando** la stessa origine — senza quel flag `frontend/src/api/http.ts`
      rifiuta la base e ricade su Railway **in silenzio**, quindi l'app funzionerebbe parlando però
      col backend vecchio:
      `cd frontend && VITE_API_SAME_ORIGIN=true npm run build` — nginx monta `frontend/dist`.
      Sul VPS non serve Node installato: la build si fa in un container usa-e-getta, **montando il
      repo intero e non solo `frontend/`**. Il frontend importa dalla radice
      (`src/util/paginaA4.ts`, `intestazionePiede.ts`, `htmlSanitizer.ts`, `dominioMittente.ts`):
      montando solo `frontend/` quei percorsi escono dal volume e la build muore con
      `TS2307 Cannot find module '../../../src/util/…'`, che sembra un errore di codice e invece è
      il volume sbagliato.
      ```bash
      docker run --rm -u "$(id -u):$(id -g)" -e HOME=/tmp -e npm_config_cache=/tmp/.npm \
        -e VITE_API_SAME_ORIGIN=true -v /opt/bluman:/app -w /app/frontend \
        node:22 sh -c "npm ci --no-audit --no-fund && npm run build"
      ```
- [ ] DNS del dominio API → IP del VPS.

## 2. Primo avvio (ancora in HTTP, TLS dopo)
```bash
docker compose -f docker-compose.prod.yml --env-file .env up -d
docker compose -f docker-compose.prod.yml ps -a   # atteso: migrate/rls Exited(0), postgres/api Up
```

## 3. Verifica RLS e isolamento — NON saltare
```bash
docker compose -f docker-compose.prod.yml exec api npx tsx src/scripts/checkRls.ts
#   atteso: RLS attivo su tutte le tabelle (0 spente); tenant inesistente → 0 righe.
docker compose -f docker-compose.prod.yml exec api npx tsx src/scripts/verificaAccessi.ts
#   atteso: il ruolo amministrativo riconosciuto, poi i super_admin come «tutti i tenant».
```
Se `checkRls` mostra `bluman_app` con `bypassrls=true` o righe > 0 col tenant finto → **STOP**: gli
studi si vedrebbero a vicenda.

`verificaAccessi` ha bisogno di una connessione che **scavalchi la RLS** (usa `ADMIN_DATABASE_URL`,
in mancanza `DIRECT_URL`). Con il ruolo dell'app le policy filtrano e lei vedrebbe «0 utenti» — un
numero vero e una conclusione falsa, che su uno script di pre-rilascio è il guasto peggiore. Per
questo ora **verifica il ruolo prima di dare il verdetto** e, se non è amministrativo, si ferma
dicendolo invece di rispondere «nessuno entra».

Se lanci questi comandi **da uno script** e non a mano, aggiungi `-T` e `< /dev/null`: `docker
compose exec` eredita lo stdin, e con un heredoc se lo mangia — lo script si interrompe a metà senza
errore visibile.

## 4. Dati
- **Fresh** (consigliato, dati di prova): `docker compose … exec api npm run bootstrap` (primo
  super_admin, stampa la password una volta) + seed master (`npm run seed`), poi ricrea i 2 studi.
- **Restore** da Supabase: segui §5 di `PIANO_MIGRAZIONE_VPS.md` (dump→restore→grant→riverifica RLS).

## 5. Smoke test
Da **fuori** (o dal server su `127.0.0.1`) passando da nginx: l'API non pubblica la 3000 sull'host,
quindi `curl http://127.0.0.1:3000/health` **non risponde** e non significa che l'API sia giù.
L'unica porta pubblicata è nginx (80/443), che proxa i prefissi API di `nginx_bluman_app.inc`.
- [ ] Health: `curl -s http://IP/health` → `{"stato":"ok","db":"ok"}`.
- [ ] Frontend servito: `curl -s -o /dev/null -w '%{http_code}\n' http://IP/` → `200`.
- [ ] Login reale → lista progetti + lista clienti + apri un documento.
- [ ] Isolamento via API con due studi diversi (non solo via SQL).

## 6. TLS (dopo che il DNS punta al VPS)
```bash
docker compose -f docker-compose.prod.yml run --rm --entrypoint \
  "certbot certonly --webroot -w /var/www/certbot -d IL.TUO.DOMINIO --email TUA@EMAIL --agree-tos --no-eff-email" certbot
```
Poi in `nginx.conf` scommenta il blocco `server :443` e il `return 301` su :80, sostituisci il dominio,
e `docker compose … exec nginx nginx -s reload`. Il servizio `certbot` rinnova poi da solo.

## 7. Dopo il cut-over
- [x] **Backup in cron** (01/10/2026) — vedi «Il backup» qui sotto. Restore-test eseguito.
      Restano la **copia off-site** (rclone) e la custodia di `BACKUP_ENCRYPTION_KEY` **fuori dal
      server**.
- [x] **Sorveglianza in cron** (01/10/2026) — vedi «La sorveglianza» qui sotto: sette controlli con
      avvisi su Telegram, e il controllo che il backup non sia morto in silenzio.
- [x] **Rotazione delle password** (`bluman_app` e proprietario) — 02/10/2026, vedi «La rotazione
      delle password» qui sotto.
- [x] **`pg_stat_statements`** — 02/10/2026. Rende visibili le query lente, che prima erano
      invisibili. Dichiarato anche in `docker-compose.prod.yml` per riproducibilità.
- [ ] **Connessioni al database.** ⚠️ **Non** si controlla `pg_stat_activity`: con PgBouncer davanti
      l'app non apre connessioni verso Postgres, le prende dal pool — Postgres ne vede **una**, e un
      allarme su `max_connections` non suonerebbe mai, nemmeno con l'app in ginocchio. La metrica che
      conta è la **coda di PgBouncer** (`cl_waiting` dal suo database di amministrazione), che è un
      controllo da progettare a parte.
- [ ] Tieni Supabase/Railway **accesi** come rollback per qualche giorno.

### La rotazione delle password (02/10/2026)

Ruotate entrambe — `bluman_app` e il proprietario dello schema — perché erano state generate prima
del passaggio al VPS e non si sapeva più chi le avesse viste.

**Il formato non è un dettaglio.** `openssl rand -hex 32`, **mai** base64: le password finiscono
**dentro un URL** (`postgresql://utente:PASSWORD@host/db`) e l'alfabeto base64 contiene `/`, che in un
URL tronca la stringa. L'errore che ne esce è `P1013: … invalid port number in database URL`, che
sembra una porta sbagliata o una rete che non risponde.

**L'ordine conta, e un test l'ha dimostrato.** Ruotare `bluman_app` ha **subito** un effetto visibile
perché a valle c'è il pooler: PgBouncer si autentica su Postgres con quella password, quindi va
riavviato insieme all'API — se si ruota solo il ruolo, il pooler resta con la vecchia e ogni query
muore. Il proprietario invece **non** rompe niente finché non lo si usa: le migrazioni le fa il
servizio `migrate`, che la rilegge dal `.env` a ogni esecuzione.

**Verificare, non dedurre.** Un test che sembrava ovvio era **falso**: provare la vecchia password
connettendosi a `127.0.0.1` **da dentro** il container di Postgres. `pg_hba.conf` dell'immagine
ufficiale ha `host all all 127.0.0.1/32 trust` — da lì **nessuna password viene controllata**, quindi
il test rispondeva «funziona ancora» qualunque cosa si scrivesse. La verifica buona passa dalla
rete (dall'API, o da `pgbouncer`), che è l'unico percorso dove `scram-sha-256` si applica davvero.
Il verdetto finale: nuova → connessa, vecchia → rifiutata, inventata → rifiutata.

⚠️ Restano sul server **tre `.env`** con le password vecchie (`.env.pre-rotazione-20261002_132246`,
`.env.pre-rotazione-owner-20261002_133350` e il `.env` vivo): cancellarli appena la stabilità è
confermata, perché un file di riserva con le credenziali dismesse è solo una copia in più da
proteggere.

### Il backup (dal 01/10/2026)

```bash
# gira da solo ogni notte alle 03:17 UTC; a mano:
ssh-add "$HOME/.ssh/bluman_vps"
ssh bluman@136.144.234.118 'cd /opt/bluman && bash ./scripts/backup-vps.sh'
```

**Dove.** `/var/backups/bluman`, permessi `700` di `bluman`. La posizione è scelta, non casuale:
sta **fuori da `/opt/bluman`** (un deploy andato storto, un `git clean -xfd` o un `rm` nella
cartella dell'app non portano via i backup) e **fuori da `/var/lib/docker/volumes`** (`docker
compose down -v` distrugge i volumi, non questa directory).

**Cosa.** Tre artefatti per esecuzione, tutti cifrati AES-256 con `BACKUP_ENCRYPTION_KEY` e ruotati
agli ultimi 14 set:

| File | Cos'è | Perché serve |
|---|---|---|
| `bluman_<ts>.dump.enc` | `pg_dump --format=custom` | i dati |
| `bluman_<ts>_uploads.tar.gz.enc` | archivio del volume `bluman_uploads` | i **documenti**: il database contiene i loro *percorsi*, non i file |
| `bluman_<ts>_env.tar.gz.enc` | il file `.env` | `JWT_SECRET`, `SIGILLO_HMAC_SECRET`, SMTP e i token dei canali: **non sono in git**, senza questi l'app non riparte |

**Perché anche documenti e `.env`.** Un restore del solo database dà un archivio pieno di link che
non portano a niente — la forma del caso «20 documenti, 8 senza il loro file» del 01/10/2026.

**⚠️ Il buco che resta.** I backup stanno **sullo stesso disco** del database: su questa macchina
c'è un solo filesystem (`/dev/vda1`). Proteggono dagli errori applicativi, **non** dalla morte del
disco o del server. L'unica copia che sopravvive al server è quella off-site, da configurare
(`rclone` + `BLUMAN_BACKUP_RCLONE_REMOTE`).

**⚠️ La chiave.** `BACKUP_ENCRYPTION_KEY` sta **dentro** il `.env` che viene cifrato con sé stessa.
Finché il server è vivo il restore funziona; se il server muore, senza una copia della chiave
**fuori dal server** (gestore di password) i backup cifrati non si aprono più.

**Il restore-test è in fondo a `scripts/backup-vps.sh`**, commentato: si esegue a mano su un
container usa-e-getta e confronta i **conteggi** con la produzione — non basta l'exit code, un dump
che si apre vuoto passa ogni controllo superficiale.

### La sorveglianza (dal 01/10/2026)

```bash
ssh-add "$HOME/.ssh/bluman_vps"
ssh bluman@136.144.234.118 'cd /opt/bluman && bash ./scripts/monitor-vps.sh'
bash ./scripts/monitor-vps.sh --riepilogo     # forza il riepilogo
bash ./scripts/monitor-vps.sh --prova         # un messaggio di prova su Telegram
```

**Sette controlli**, ogni 10 minuti dal cron di `bluman`:

| Controllo | Scatta quando | Cadenza |
|---|---|---|
| `backup` | il set più recente in `/var/backups/bluman` ha più di **26 ore** | ogni giro |
| `disco` | `/` supera l'**85%** | ogni giro |
| `memoria` | memoria **disponibile** sotto il **15%**, o swap oltre il **50%** | ogni giro |
| `container` | uno dei **5** di lunga durata non è `Running` | ogni giro |
| `health` | `/health` non risponde `200` **con `db:ok`** | ogni giro |
| `apt` | ci sono aggiornamenti di **sicurezza** in attesa | 1×/giorno |
| `postgres` | il digest di `postgres:17-alpine` è superato rispetto al registro | 1×/giorno |

**Avvisa solo sui cambiamenti.** Ogni controllo ha uno stato ricordato in
`/var/lib/bluman-monitor`, e parte un messaggio solo sulla **transizione**: 🔴 quando peggiora, 🟢
quando rientra. Niente transizione, niente messaggio. Un controllo che scrive a ogni giro manda 144
messaggi al giorno, viene silenziato entro sera e da lì non avvisa più nemmeno quando serve — che è
peggio di non averlo.

**Il riepilogo giornaliero delle 08:00 UTC** (10:00 italiane) arriva **anche quando va tutto bene**.
È l'unico segnale che distingue «nessun guasto» da «il monitor è morto»: se un giorno non arriva, il
problema è nel monitor.

**`unknown` è uno stato a sé, non un «ok».** Dove un comando può fallire restituendo un numero che
*sembra* valido, si verifica che abbia davvero funzionato prima di credergli. L'esempio è `apt`: se
l'indice è vecchio di oltre una settimana, il conteggio degli aggiornamenti di sicurezza è **zero
perché non sa che esistono** — un numero vero e una conclusione falsa, il modo peggiore di sbagliare
su un controllo di sicurezza. In quel caso risponde `unknown` e lo si vede nel riepilogo.

**Perché lo swap non è un guasto.** L'**assenza** di swap non si segnala: sarebbe un avviso che non
può mai rientrare — lo swap c'è o non c'è, e al giro dopo non c'è niente di diverso da riparare. Un
allarme permanente è il modo più rapido per far silenziare il monitor. Il **consumo** invece sì: si
controlla solo **se lo swap esiste**, oltre il 50%. Su una macchina senza swap il controllo tace, e il
fatto resta scritto nel dettaglio e nel riepilogo.

⚠️ Fino al 02/10/2026 questa macchina **non aveva swap** (`SwapTotal: 0`), e l'OOM killer era l'unica
risposta alla pressione di memoria — con il container di Postgres come vittima più probabile. Ora c'è
un file di swap da **2G** (`/swapfile`), persistito in `/etc/fstab` e **validato con `findmnt --verify`
prima** di farci dipendere un riavvio, con **`vm.swappiness=10`** invece del default 60: su un server
con Postgres, 60 tende a scambiare pagine calde del database e a trasformare la pressione di memoria
in picchi di latenza. A 10 lo swap resta la rete di sicurezza che deve essere, non memoria di lavoro.

**Il bot Telegram.** Gli avvisi vanno a un bot **dedicato**, non a quello degli studi: le
credenziali di quello stanno nella riga `Tenant` (`tg_bot_token`) perché servono alle OTP dei
firmatari, e un guasto del server non deve comparire nella chat di un cliente. Creazione (una volta
sola): **@BotFather** → `/newbot`, poi **scrivere `/start` al bot nuovo** — senza quel passaggio
Telegram vieta al bot di iniziare una conversazione e l'invio fallisce con `400`. Il chat id si
ricava con `curl -s "https://api.telegram.org/bot<TOKEN>/getUpdates"`. Token e chat id stanno in
`/etc/bluman/monitor.env` (`600`, di `bluman`) e **non** nel `.env` dell'app: quello è dichiarato in
`env_file:` dal compose, quindi ogni sua variabile finisce **dentro** il container dell'API.

**Configurato e verificato il 02/10/2026** (bot `@Avvisibluman_bot`, chat privata del titolare). La
verifica va **rifatta dopo qualunque modifica**, perché un `200` da Telegram dice che il messaggio è
stato *accettato*, non *consegnato*: l'unica prova è guardare il telefono.

```bash
# 1. il token è valido? «Messaggio di prova inviato» significa http 200 (401 = token, 400 = manca /start)
bash ./scripts/monitor-vps.sh --prova

# 2. un guasto VERO, con la logica vera, senza toccare la produzione e senza sporcare lo stato reale:
#    le soglie si sovrascrivono via ambiente, lo stato si dirotta in una cartella usa-e-getta.
D=$(mktemp -d)
BLUMAN_MONITOR_STATO=$D BLUMAN_MONITOR_DISCO_PCT=1  bash ./scripts/monitor-vps.sh   # 🔴 avviso
BLUMAN_MONITOR_STATO=$D BLUMAN_MONITOR_DISCO_PCT=1  bash ./scripts/monitor-vps.sh   # silenzio
BLUMAN_MONITOR_STATO=$D BLUMAN_MONITOR_DISCO_PCT=85 bash ./scripts/monitor-vps.sh   # 🟢 rientro
rm -rf $D

# 3. il battito — non tocca il timbro, quindi non salta quello delle 08:00 del giorno dopo
bash ./scripts/monitor-vps.sh --riepilogo
```

Sul telefono devono arrivare **quattro** messaggi (prova, guasto, rientro, riepilogo) e **niente fra
il secondo e il terzo**: quel messaggio che non c'è è la prova che il monitor non tempesta. Il test
del punto 2 **non** va fatto dal cron e **non** senza dirottare `BLUMAN_MONITOR_STATO` — altrimenti
lascerebbe lo stato reale segnato `fail` e al giro successivo il cron manderebbe un rientro falso.

## 8. Aggiornare un VPS già in servizio (dopo ogni push)

`./scripts/distribuisci.sh` fa anche questo: dopo il push aggiorna il VPS. Per aggiornarlo **da
solo** (il commit dev'essere già su GitHub): `./scripts/distribuisci.sh --solo-vps`.

Sono **cinque** cose, e saltarne una lascia l'ambiente incoerente in un modo che non si vede:

| Passo | Comando | Cosa succede se si salta |
|---|---|---|
| Codice | `cd /opt/bluman && git pull --ff-only` | l'immagine si costruisce dal codice vecchio |
| Frontend | build `node:22` usa-e-getta con `VITE_API_SAME_ORIGIN=true` | l'app parla col backend di Railway **in silenzio** |
| Database | `compose build api migrate` → `run --rm -T migrate` → `run --rm -T rls` | schema vecchio; e senza `rls` la tabella nuova resta **scoperta** |
| Backend | `compose up -d` | il container continua a girare con l'immagine precedente |
| nginx | `compose exec -T nginx nginx -s reload` | **502 su tutte le rotte API** con l'API perfettamente viva (vedi sotto) |

```bash
ssh-add "$HOME/.ssh/bluman_vps"        # la chiave dev'essere nell'agente
./scripts/distribuisci.sh --solo-vps   # fa i quattro passi e verifica
```

**`rls` non è ridondante dopo `migrate`.** La migrazione crea la policy della tabella nuova solo
se il ruolo `bluman_app` **e** la funzione `app_tenant_corrente` esistono già; il servizio `rls`
è invece il punto che riapplica le policy a **tutte** le tabelle per introspezione, ed è
idempotente (`DROP POLICY IF EXISTS` prima di ogni `CREATE`). È la rete di sicurezza contro lo
stato peggiore possibile — due studi che si vedono a vicenda — quindi si esegue sempre.

Lo script verifica in coda quattro cose e **si ferma** se una non torna: `/health`, il `200` sulla
radice (nginx serve il frontend nuovo), la sonda rotta (`POST /documenti/genera` senza token deve
dare **401**, mai 404: un 404 significa che il container è rimasto indietro) e `checkRls`
(atteso «spento su 0»).

Il passo VPS **non si salta in silenzio**: se il server non risponde lo script esce dicendolo,
perché due ambienti con codice diverso sono esattamente il guasto che `distribuisci.sh` esiste per
evitare. Per distribuire senza toccare il VPS: `--no-vps`.

⚠️ **`docker compose run/exec` eredita lo stdin.** In un'invocazione `ssh` lo stdin è quello del
terminale e il container se lo mangia: la sessione si interrompe **a metà senza errore**. Nello
script tutte le chiamate passano da `ssh_vps`, che mette `</dev/null` e non manda mai script sullo
stdin. Vale anche a mano: aggiungi `-T` e `< /dev/null`.

⚠️ **Ricreare `api` obbliga a ricaricare nginx.** `nginx_bluman_app.inc` fa `proxy_pass
http://api:3000;` e **non c'è nessuna direttiva `resolver`**: nginx risolve il nome del servizio
**una volta sola, all'avvio**, e poi tiene quell'indirizzo IP finché non glielo si fa rileggere.
Ricreando il container `api` il suo IP cambia, e nginx continua a bussare all'indirizzo vecchio:
risponde **502** su tutte le rotte API mentre l'API è perfettamente viva. Il sintomo (API sana,
sito rotto) manda a cercare il guasto dalla parte sbagliata. Dopo ogni ricreazione:

```bash
docker compose -f docker-compose.prod.yml exec -T nginx nginx -s reload
```

La soluzione strutturale sarebbe un `resolver 127.0.0.11 valid=10s;` con `proxy_pass` su una
variabile; finché non c'è, la ricarica è obbligatoria — e **`distribuisci.sh --solo-vps` la fa da
sé** dal 02/10/2026 (passo *d-bis*).

**Non è ipotetico.** Il log di nginx mostra `/health` → **502** l'**01/10/2026** alle 11:53, 13:35 e
15:05, dall'IP di casa del titolare: sono i deploy di quel giorno. Il 02/10 non si è ripetuto solo
perché Docker ha riassegnato all'API **lo stesso** indirizzo dopo la ricreazione. Succede quando non
lo riusa, quindi il guasto è **intermittente**: si presenta un deploy sì e uno no, che è il modo
peggiore di presentarsi.

⚠️ **Il nome della rete lo decide compose, non il file.** `docker-compose.prod.yml` dichiara
`bluman_internal`, ma Docker la crea come **`bluman_bluman_internal`**: compose antepone il nome del
progetto. Un `docker run --network bluman_internal` muore con «network not found», che sembra un
problema di rete e invece è solo il prefisso. L'elenco vero è in `docker network ls`.
