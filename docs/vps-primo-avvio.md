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
- [ ] Monitoraggio disco/connessioni/slow query; aggiornamenti OS+PostgreSQL; rotazione password.
- [ ] Tieni Supabase/Railway **accesi** come rollback per qualche giorno.

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

## 8. Aggiornare un VPS già in servizio (dopo ogni push)

`./scripts/distribuisci.sh` fa anche questo: dopo il push aggiorna il VPS. Per aggiornarlo **da
solo** (il commit dev'essere già su GitHub): `./scripts/distribuisci.sh --solo-vps`.

Sono **quattro** cose, e saltarne una lascia l'ambiente incoerente in un modo che non si vede:

| Passo | Comando | Cosa succede se si salta |
|---|---|---|
| Codice | `cd /opt/bluman && git pull --ff-only` | l'immagine si costruisce dal codice vecchio |
| Frontend | build `node:22` usa-e-getta con `VITE_API_SAME_ORIGIN=true` | l'app parla col backend di Railway **in silenzio** |
| Database | `compose build api migrate` → `run --rm -T migrate` → `run --rm -T rls` | schema vecchio; e senza `rls` la tabella nuova resta **scoperta** |
| Backend | `compose up -d` | il container continua a girare con l'immagine precedente |

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
