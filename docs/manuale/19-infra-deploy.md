# 19 · Infrastruttura & Deploy

## 👤 Cosa fa e come si usa
BluMan gira su **tre** destinazioni, e lo script le aggiorna **tutte e tre** in un colpo solo:
- **VPS Register.it** — lo stack «tutto su un server» (`docker-compose.prod.yml`): è la
  **produzione di destinazione**, quella su cui si prova e su cui punterà il dominio quando il
  cut-over sarà chiuso (TLS e DNS: voce aperta 10);
- **Backend** (Fastify) su **Railway**;
- **Frontend** (React/Vite) su **Vercel**.

Il deploy si fa con **`scripts/distribuisci.sh`** (regola 9): verifica (typecheck backend+frontend,
lint, build, `vitest run`), controlla l'autore Git richiesto da Vercel, poi push → Vercel,
`railway up` → Railway e — **per default** — l'aggiornamento del VPS (codice, frontend, database,
backend, nginx). Dopo il deploy verifica health, **che ogni pagina della SPA torni HTML** (non il
JSON dell'API) e la sonda rotta (401, non 404). Distribuire **senza** il VPS richiede `--no-vps`,
ed è una scelta esplicita: se il VPS non risponde lo script **si ferma**, perché due ambienti con
codice diverso sono esattamente il guasto che questo script esiste per evitare. Railway e Vercel
restano accesi come **rollback** finché il cut-over del dominio non è dichiarato chiuso.

⚠️ **Un `git push` da solo non pubblica il frontend**: il deploy che Vercel crea dal webhook GitHub
resta `BLOCKED` (build a `0ms`, nessun log) e non arriva mai Ready. A pubblicare la SPA è **solo** il
deploy della CLI (`npx vercel --prod --scope fanta-ia`), cioè il passo 3 dello script — che per
questo **si ferma** se quel deploy non riesce, invece di lasciare il frontend vecchio davanti a un
backend e un VPS nuovi.

Sulla **postazione Windows** del titolare il comando `railway` (wrapper npm) ingoia stdout/exit:
si usa il **`.exe` nativo** via `RAILWAY_BIN` (lo script lo supporta).

## 📐 Calcoli & logica / regole
- **Migrazioni versionate**: lo schema si cambia con `prisma migrate dev`/`deploy`; il Dockerfile
  esegue `prisma migrate deploy` all'avvio (mai `db push --accept-data-loss` su dati reali).
- **RLS effettiva**: l'app gira come ruolo `bluman_app` (non superuser); ogni migrazione che crea una
  tabella porta **la propria policy RLS** dentro di sé. Verifica: `checkRls.ts`.
- **Tre connection string** (`.env`): `DATABASE_URL` (`bluman_app`, no bypass RLS), `DIRECT_URL`
  (migrazioni), `ADMIN_DATABASE_URL` (manutenzione/seed/backup, scavalca RLS).
- **Regola**: **mentre `distribuisci.sh` gira NON si modificano file tracciati** — al passo 2 controlla
  l'albero sporco ed esce con errore. Si aspetta la fine del push o si committa prima.
- **Un `git push` su `main` applica anche le migrazioni**, non solo il codice: Railway auto-deploya da
  GitHub (dal 25/09/2026) e il container lancia `prisma migrate deploy` all'avvio. Una migrazione
  committata e lasciata lì **non è inerte** — parte al primo push. Se una migrazione non va ancora
  applicata alla produzione, va tenuta **fuori dal branch** (o il push va rimandato), non semplicemente
  non eseguita a mano: `npx prisma migrate status` dice cosa è in attesa.
- **Backup VPS**: dal 01/10/2026 c'è un backup **notturno automatico** (`scripts/backup-vps.sh`,
  cron `17 3 * * *`; il server è in UTC). Copre **tre** cose, perché per ripartire servono tutte e
  tre — il **database**, i **documenti** (volume `bluman_uploads`) e il **`.env`** (l'unico pezzo
  non ricostruibile da GitHub). Ogni artefatto è cifrato AES-256 e ruota a 14 set, in
  `/var/backups/bluman`: fuori da `/opt/bluman` (un deploy andato storto non lo tocca) e fuori dai
  volumi Docker (`docker compose down -v` non lo tocca). Restore-test eseguito e superato.
  **Resta un buco dichiarato**: i backup stanno sullo **stesso disco** del database (un solo
  filesystem su quella macchina), quindi proteggono dagli errori applicativi ma **non** dalla morte
  del disco o del server. Per quello serve la **copia off-site**, che dal 10/10/2026 è
  **implementata** (voce 8-bis) e **non ancora attiva su questo server**. Il provider è deciso dal
  09/10/2026 (**Dropbox**, spazio già pagato): `scripts/backup-vps.sh` copia i tre artefatti con
  `rclone --config`, e la **credenziale si incolla dal pannello** del super admin (*Backup off-site*)
  invece che a mano sul server. Il segreto vive in `/var/lib/bluman-backup/config/rclone.conf`,
  **non** nel database e **non** nel `.env` — il database *è* ciò che viene spedito su Dropbox e il
  `.env` *è* una delle tre cose che lo script archivia. Restano i passi che richiedono root
  (`rclone`, le due cartelle, `BLUMAN_BACKUP_RCLONE_REMOTE`): `docs/vps-primo-avvio.md` §7.
- **Sorveglianza VPS**: dal 01/10/2026 `scripts/monitor-vps.sh` gira ogni **10 minuti** dal cron di
  `bluman` e avvisa su **Telegram** (bot dedicato `@Avvisibluman_bot`, non quello degli studi;
  configurato e **verificato end-to-end il 02/10/2026**). **Otto** controlli:
  freschezza del backup, disco, memoria, container, `/health`, aggiornamenti di sicurezza `apt`,
  digest dell'immagine `postgres`, e dal 10/10/2026 la **copia off-site** (`copia-remota`: interroga
  Dropbox, e degrada a `unknown` — mai `ok` — se rclone manca o il token è scaduto). **Avvisa solo
  sulle transizioni** (🔴 guasto, 🟢 rientro), più un **riepilogo giornaliero** alle 08:00 UTC che
  arriva anche quando va tutto bene — è ciò che distingue «nessun guasto» da «il monitor è morto».
  Dove un dato può ingannare risponde `unknown` invece di `ok`: un indice `apt` vecchio conta zero
  aggiornamenti di sicurezza perché *non sa* che esistono. Token e chat id in
  `/etc/bluman/monitor.env` (`600`), **non** nel `.env` dell'app, che il compose inietta dentro il
  container dell'API. Vedi `docs/vps-primo-avvio.md` §7.

## 🔗 Collegamenti
- Tutti i moduli: un solo `distribuisci.sh` porta avanti le **tre** destinazioni insieme — VPS (per
  default), backend Railway e frontend Vercel — così nessuna resta indietro con codice diverso.

## ⚠️ Stati limite & errori
- Autore ultimo commit ≠ identità Vercel → lo script si ferma (correzione manuale, niente amend auto).
- Albero sporco → esce con errore (vedi regola sopra).
- Health/sonda rotta non ok dopo il deploy → fallimento non silenzioso (exit 1).
- **Deploy CLI Vercel non riuscito** → lo script **esce** (exit 1): il frontend non è stato pubblicato,
  e il deploy del webhook GitHub non lo sostituisce (resta `BLOCKED`, non viene costruito). Il
  messaggio dice il rimedio: `npx vercel --prod --scope fanta-ia`.

## 🔧 Nota tecnica
- `scripts/distribuisci.sh` (+ `--solo-push` / `--solo-api`); IaC `.railway/railway.ts`; migrazioni
  `prisma/migrations/` (RLS inline) + `supabase/migrations/20260819_rls_effettiva.sql`; diagnostica
  `src/scripts/checkRls.ts`, `verificaAccessi.ts`.
- Deploy: `export RAILWAY_BIN="…/@railway/cli/bin/railway.exe" && bash scripts/distribuisci.sh`.
- **Stack VPS «tutto su un server»** (`docker-compose.prod.yml`): `postgres:17` → `migrate`
  (`prisma migrate deploy`) → `rls` (crea `bluman_app` senza bypassrls + policy) → `api` (gira come
  `bluman_app`, con `env_file: .env` per i secret runtime) → `nginx` (SPA + proxy API) + `certbot`
  (TLS Let's Encrypt, rinnovo automatico). Secret in `.env.prod.example`. Backup: `scripts/backup-vps.sh`.
  Dal 10/10/2026 il servizio `api` monta anche **due cartelle** di `/var/lib/bluman-backup`:
  `config/` in **scrittura** (la credenziale rclone che si incolla dal pannello) e `stato/` in **sola
  lettura** (le prove scritte dagli script: `backup.json`, `verifica.json`). Cartelle e non file
  singoli — è la lezione di nginx del 09/10: un bind mount di un file lega l'inode, e chi riscrive con
  `temp` + `rename` cambia inode. La cartella di stato è **read-only** di proposito: l'app scrive un
  file solo (il segreto) e non può riscrivere l'evidenza.
  Il flusso migrate→rls→api è stato **verificato in dry-run locale** (RLS su 70 tabelle, isolamento ok).
- **Aggiornare il VPS sono cinque passi**, non quattro: codice, frontend, database, backend e
  **ricarica di nginx**. L'ultimo è invisibile e si paga caro: nginx risolve il nome `api` una volta
  sola all'avvio (nessun `resolver` nel config), quindi ricreando il container l'API cambia IP e nginx
  continua a bussare al vecchio → **502 su tutte le rotte API mentre l'API è viva** (successo davvero
  il 01/10/2026). Dal 02/10/2026 lo fa `distribuisci.sh --solo-vps` da sé.
- **Sul VPS le API stanno sotto `/api`**, e nginx toglie il prefisso prima di consegnare la richiesta
  a Fastify (`nginx/bluman_app.inc`: `proxy_pass http://api:3000/`). Non è un gusto: senza prefisso
  una pagina e una rotta possono avere lo stesso percorso (`/invoices` è la pagina Fatture **e** la
  rotta che ne restituisce i dati) e nginx non può servire tutte e due. Fino al **02/10/2026** si
  usava la stessa origine senza prefisso più un **elenco di 45 prefissi**: sette pagine — `/portal`,
  `/reports`, `/invoices`, `/fornitori`, `/timesheet`, `/liquidazione-iva`, `/admin/tenants` —
  rispondevano `404`/`401` in JSON a chi le ricaricava. Non si vedeva perché la navigazione dentro
  l'app è client-side e non ripassa da nginx, e perché si usava `bluman.vercel.app`, dove frontend e
  API sono **origini diverse** e il conflitto non esiste. Restano in radice solo **tre eccezioni**,
  ognuna con un motivo esterno al repo: `/webhooks/` (l'indirizzo è già in mano a Meta e Telegram),
  `/uploads/` (gli URL sono salvati a database e dentro email spedite) e `/health` (lo interroga il
  monitor). Il presidio è `src/infrastrutturaDeploy.test.ts`, che confronta le rotte della SPA con i
  percorsi serviti in radice: **è il confronto che mancava**, e la sua assenza è la ragione per cui il
  guasto è vissuto per giorni.
- **Le scadenze della cache sul frontend del VPS** (dall'08/10/2026): `expires -1` su `location /`
  (`Cache-Control: no-cache`: il browser tiene il file ma lo **rivalida**, e nginx risponde `304`
  finché non cambia) e `expires 1y` su `location /assets/` (il nome porta l'hash del contenuto,
  quindi sotto lo stesso nome il file non cambia mai). Prima di questo **il VPS non mandava nessun
  `Cache-Control`**, quindi il browser applicava la scadenza euristica (≈10% dell'età del file) e per
  ore serviva dalla cache il vecchio `index.html` — che è il file che *nomina* gli asset. Il sintomo
  è il peggiore possibile, perché non sembra un guasto: deploy verde, `git` allineato, il bundle
  nuovo che esce davvero dalla porta 80, e l'utente che continua a vedere la versione precedente.
  Su Vercel non capitava mai, perché la piattaforma manda `max-age=0, must-revalidate`: **lo stesso
  codice arrivava là e non qui** — ed è per questo che il difetto è vissuto a lungo senza farsi
  vedere. ⚠️ Si usa `expires` e **non** `add_header`: un `add_header` dentro un `location` **annulla**
  quelli ereditati dal server, quindi le tre intestazioni di sicurezza (`X-Content-Type-Options`,
  `X-Frame-Options`, `Referrer-Policy`) sarebbero sparite proprio dalle risposte del frontend.
- **I file di nginx si montano come CARTELLA** (dall'08/10/2026): stanno in `nginx/`
  (`default.conf`, `bluman_app.inc`, `bluman_proxy.inc`) e il compose monta
  `./nginx:/etc/nginx/conf.d:ro`. ⚠️ Un bind mount di un **file singolo** lega l'**inode**, non il
  percorso, e `git` non riscrive sul posto ma **rinomina**: dopo un `git pull` il container
  continuava a servire il file vecchio — `bluman_app.inc` del 02/10 contro quello dell'08/10 —
  mentre `nginx -t` e `nginx -s reload` **riuscivano**, perché rileggevano il file vecchio. Deploy
  verde, configurazione di sei giorni prima, nessun errore da nessuna parte. Montata la cartella il
  percorso si risolve a ogni accesso: le sostituzioni di git si vedono subito, il reload resta a
  zero downtime e `nginx -t` valida finalmente il file **nuovo**. È la stessa ragione per cui
  `frontend/dist`, montata come cartella, si è sempre aggiornata. ⚠️ Davanti a un «deploy verde ma
  non si vede», **prima** si confronta l'inode host/container (`stat -c %i` da entrambe le parti) e
  **poi** si dubita del browser. Presidio: `src/infrastrutturaDeploy.test.ts`.
- **`pg_stat_statements`** (dal 02/10/2026): dichiarato nel compose sul servizio `postgres`, rende
  visibili le query lente. Precaricabile solo all'avvio del server, quindi non basta `CREATE EXTENSION`.
- **Le connessioni al database non si controllano con `pg_stat_activity`**: con PgBouncer davanti
  Postgres ne vede una sola e l'allarme non suonerebbe mai. Deciso il 02/10/2026 di **non** aggiungere
  il controllo: la metrica utile sarebbe la coda di PgBouncer, ma `/health` passa dal pool anche lui,
  quindi la saturazione vera il controllo health la vede già — un preavviso su una coda che si svuota
  da sola sarebbero solo falsi allarmi.
- Fonti: `.agents/AGENTS.md`, `ISTRUZIONI_PER_IA.md` (regola 9), `PIANO_MIGRAZIONE_VPS.md`,
  `AUDIT_2026-09-27/07-frontend-infra.md`.
