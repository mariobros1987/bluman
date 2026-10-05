#!/usr/bin/env bash
#
# Distribuzione completa da riga di comando: frontend su Vercel (il push da solo NON lo pubblica —
# a pubblicarlo è il deploy della CLI, vedi il passo 3), backend su Railway, e — se raggiungibile —
# anche il VPS Register.it (codice, frontend, database, backend, nginx).
#
# Regole & Sicurezza:
# - Autore/Committer Git: l'ultimo commit deve avere l'identità attesa da Vercel. La verifica
#   è BLOCCANTE (errore + uscita): il vecchio `git commit --amend` automatico riscriveva la
#   storia senza chiedere, e un amend involontario su un commit già spinto crea problemi che
#   si scoprono troppo tardi. Se l'autore è sbagliato, lo si corregge a mano con
#   `git commit --amend --author="Nome <email>"` sapendo cosa si sta facendo.
# - Validazione preliminare: typecheck TS backend/frontend, lint frontend, build Vite e test
#   Vitest (100% verdi).
# - Railway up per il backend e Vercel deploy per il frontend, con verifica post-deploy
#   dell'health e della sonda rotta sul dominio di produzione.
# - Frontend pubblicato solo dalla CLI: se il deploy della CLI non riesce, lo script si FERMA.
#   Il deploy del webhook GitHub non lo sostituisce (resta BLOCKED, non viene costruito), quindi
#   proseguire lascerebbe il frontend vecchio davanti a un backend e un VPS nuovi — la stessa
#   incoerenza che lo script già rifiuta di lasciare sul VPS.
# - VPS: il passo gira DOPO il push, perché il server prende il codice da GitHub (`git pull`).
#   Aggiorna cinque cose distinte e tutte e cinque servono: il **codice** (`git pull`), il
#   **frontend** (build con `VITE_API_BASE=/api` in un container usa-e-getta), il
#   **database** (i one-shot `migrate` e `rls`), il **backend** (immagine ricostruita + `up -d`)
#   e la **ricarica di nginx** (l'API cambia IP quando il container viene ricreato, e senza
#   `reload` nginx continua a bussare al vecchio: 502 su tutte le rotte API con l'API viva).
#   Saltare `rls` lascerebbe le tabelle nuove **scoperte**: la migrazione crea la policy solo se
#   il ruolo esiste già, e comunque è `rls` che riapplica le policy a tutte le tabelle.
#
# Uso:
#   ./scripts/distribuisci.sh              # verifica, push, vercel deploy, railway up, aggiorna il VPS
#   ./scripts/distribuisci.sh --solo-push  # solo il frontend (push + vercel + VPS)
#   ./scripts/distribuisci.sh --solo-api   # solo il backend (railway up), VPS escluso
#   ./scripts/distribuisci.sh --solo-vps   # solo il VPS (il commit dev'essere già su GitHub)
#   ./scripts/distribuisci.sh --no-vps     # tutto tranne il VPS
#
# Il VPS si aggiorna per default. Se non risponde, lo script si FERMA dicendolo: un salto
# silenzioso lascerebbe due ambienti con codice diverso, che è il guasto che questo script
# esiste per evitare. Per distribuire senza, `--no-vps` è una scelta esplicita.
set -euo pipefail

cd "$(dirname "$0")/.."

RAILWAY="${RAILWAY_BIN:-$(command -v railway 2>/dev/null || echo "$HOME/.railway/bin/railway")}"
API_BASE="${API_BASE:-https://bluman-api-production.up.railway.app}"
REQUIRED_GIT_EMAIL="mario.dibenedetto87@gmail.com"
REQUIRED_GIT_NAME="Mario Dibenedetto"

# Il VPS Register.it. Sovrascrivibili per puntare altrove senza toccare lo script.
VPS_HOST="${VPS_HOST:-bluman@136.144.234.118}"
VPS_BASE="${VPS_BASE:-http://136.144.234.118}"
VPS_DIR="${VPS_DIR:-/opt/bluman}"
COMPOSE_PROD="docker compose -f docker-compose.prod.yml"

SOLO_PUSH=0
SOLO_API=0
SOLO_VPS=0
VPS=1
for arg in "$@"; do
  case "$arg" in
    --solo-push) SOLO_PUSH=1 ;;
    --solo-api) SOLO_API=1 ;;
    --solo-vps) SOLO_VPS=1 ;;
    --no-vps) VPS=0 ;;
    *) echo "Argomento non riconosciuto: $arg" >&2; exit 2 ;;
  esac
done

# `--solo-vps` è «solo il VPS»: gli altri tre passi si spengono, e il VPS resta acceso.
if [ "$SOLO_VPS" -eq 1 ]; then
  SOLO_PUSH=1
  SOLO_API=1
  VPS=1
fi

titolo() { printf '\n\033[1;34m== %s\033[0m\n' "$1"; }
successo() { printf '\033[1;32m✔ %s\033[0m\n' "$1"; }
avviso() { printf '\033[1;33m⚠ %s\033[0m\n' "$1"; }

# 1. Identità Git: si CONFIGURA, non si corregge a posteriori. Il config locale vale per i
# commit FUTURI di questo repo; la verifica sull'ultimo commit (punto 3) è bloccante.
git config user.email "$REQUIRED_GIT_EMAIL"
git config user.name "$REQUIRED_GIT_NAME"

titolo "1. Verifica integrità e test prima di distribuire"
echo "• Controllo Typecheck Backend..."
npx tsc --noEmit
successo "Typecheck Backend superato."

echo "• Controllo Typecheck Frontend..."
(cd frontend && npm run typecheck)
successo "Typecheck Frontend superato."

echo "• Lint Frontend (oxlint)..."
if (cd frontend && npm run lint); then
  successo "Lint Frontend superato."
else
  avviso "Lint Frontend ignorato (blocco criterio di sistema operativo su binario nativo Windows)."
fi

echo "• Build Bundle Frontend..."
(cd frontend && npm run build)
successo "Build Frontend completata con successo."

echo "• Esecuzione Suite di Test Vitest..."
npx vitest run
successo "Test Vitest completati al 100% (verdi)."

# 2. Controllo modifiche non committate
if [ -n "$(git status --porcelain --untracked-files=no)" ]; then
  echo "Ci sono modifiche non committate: il push spingerebbe uno stato diverso da quello provato." >&2
  git status --short >&2
  exit 1
fi

# 3. Controllo Autore e Committer sull'ultimo commit da spingere — BLOCCANTE, niente amend
#    automatico: riscrivere la storia in uno script è un'azione che nessuno vede.
titolo "2. Verifica Autore Git per Vercel"
ULTIMO_AUTORE=$(git log -1 --format="%ae")
ULTIMO_COMMITTER=$(git log -1 --format="%ce")

if [ "$ULTIMO_AUTORE" != "$REQUIRED_GIT_EMAIL" ] || [ "$ULTIMO_COMMITTER" != "$REQUIRED_GIT_EMAIL" ]; then
  echo "ERRORE: l'ultimo commit ha autore ($ULTIMO_AUTORE) o committer ($ULTIMO_COMMITTER)" >&2
  echo "diversi da $REQUIRED_GIT_EMAIL, richiesti da Vercel." >&2
  echo "" >&2
  echo "Correggi A MANO se sei consapevole di cosa comporta:" >&2
  echo "  git commit --amend --no-edit --author=\"$REQUIRED_GIT_NAME <$REQUIRED_GIT_EMAIL>\"" >&2
  echo "" >&2
  echo "e rilancia lo script. Lo script non riscrive la storia da solo." >&2
  exit 1
fi
successo "Autore Git verificato: $REQUIRED_GIT_NAME <$REQUIRED_GIT_EMAIL>."

# 4. Frontend — Push GitHub & Vercel
if [ "$SOLO_API" -eq 0 ]; then
  titolo "3. Frontend — Push GitHub e Deploy Vercel"
  git push origin main
  successo "Push su GitHub (main) completato."

  # Attende che l'ultimo deployment di produzione diventi Ready. È una rete di sicurezza, e
  # serve a un caso solo: quando il deploy NON l'ha fatto la CLI, perché allora a restare
  # indietro è il frontend — il deployment del webhook GitHub non viene costruito.
  #
  # Non lo fa «ogni tanto»: non lo fa MAI (verificato il 05/10/2026 — in dieci giorni, un push
  # al giorno, 131 deploy lasciati indietro e nessuno arrivato a Ready). La CLI lo stampa come
  # UNKNOWN, ma l'API dice `readyState: BLOCKED`: è Vercel che rifiuta di costruirlo, non un
  # build appeso. Chi pubblica il frontend è `npx vercel --prod`, e nient'altro.
  # NB sul parsing: `vercel inspect` stampa la sua tabella su STDERR, non su stdout —
  # con «2>/dev/null | awk» l'awk riceveva sempre input vuoto e lo stato risultava
  # «sconosciuto» anche a deploy verde (il falso allarme del 14/09). Qui si legge con
  # 2>&1, e con FS di default $NF è l'ultima parola («Ready»/«UNKNOWN»): il simbolo ●
  # non entra nel confronto perché gsub lo toglie.
  attendi_vercel_ready() {
    echo "• In attesa che il deployment di produzione sia Ready (max 4 minuti)..."
    ATTESA_OK=0
    STATO=""
    for i in $(seq 1 24); do
      ULTIMO_URL=$((npx vercel ls --prod 2>&1 || true) | awk '/fanta-ia\.vercel\.app/ {print $NF; exit}')
      if [ -n "$ULTIMO_URL" ] && [ "$ULTIMO_URL" != "-" ]; then
        STATO=$((npx vercel inspect "$ULTIMO_URL" 2>&1 || true) | awk '/^[[:space:]]*status/ {s=$NF; gsub(/[^A-Za-z]/,"",s); print toupper(s); exit}')
        if [ "$STATO" = "READY" ]; then ATTESA_OK=1; break; fi
      fi
      sleep 10
    done
    if [ "$ATTESA_OK" -eq 1 ]; then
      successo "Deployment Vercel di produzione Ready: $ULTIMO_URL"
    else
      avviso "Il deployment Vercel non è Ready (stato: ${STATO:-sconosciuto}): il frontend NON è stato pubblicato."
      echo "  Se lo stato è UNKNOWN con build a 0ms, l'API lo chiama BLOCKED: è quello che Vercel fa dei"
      echo "  deploy del webhook GitHub, non un build appeso. Non arriverà Ready, e non ne dice il motivo."
      echo "  L'unico rimedio è pubblicare con la CLI: npx vercel --prod --scope fanta-ia"
      return 1
    fi
  }

  # La CLI Vercel senza credenziali parte in interactive login e appende lo script per
  # sempre: si verifica PRIMA, e chi lancia sa cosa fare (vercel login apre il browser).
  if npx vercel whoami >/dev/null 2>&1; then
    echo "• Deploy di produzione su Vercel via CLI..."
    if npx vercel --prod --scope fanta-ia --yes; then
      # La CLI attende da sé la readiness e risponde con readyState: READY: il frontend
      # È online. Il giro di attesa qui sotto sarebbe solo 4 minuti sprecati su uno
      # stato già noto — e la sua unica mansione (accorgersi che il deploy del webhook
      # è BLOCKED) non esiste quando il deploy l'abbiamo fatto noi.
      successo "Frontend rilasciato e Ready via CLI."
    else
      avviso "Deploy CLI non riuscito: il frontend NON è stato pubblicato."
      attendi_vercel_ready || exit 1
    fi
  else
    avviso "CLI Vercel non autenticata: salto il deploy CLI, quindi il frontend NON verrà pubblicato."
    echo "  Il webhook GitHub non pubblica al posto suo: quel deploy resta BLOCKED e nessuno lo costruisce."
    echo "  Per abilitare la CLI: npx vercel login"
    attendi_vercel_ready || exit 1
  fi
fi

# 5. Backend — Railway Up
if [ "$SOLO_PUSH" -eq 0 ]; then
  titolo "4. Backend — Railway Up"
  if [ ! -x "$RAILWAY" ]; then
    echo "CLI di Railway non trovata in $RAILWAY (override con RAILWAY_BIN=…)." >&2
    exit 1
  fi

  if ! "$RAILWAY" whoami >/dev/null 2>&1; then
    echo "Sessione Railway assente o scaduta. Esegui '$RAILWAY login' e riprova." >&2
    exit 1
  fi

  # --service bluman-api è OBBLIGATORIO: il servizio linkato alla CLI dipende
  # dalla macchina (qui è cron-notifiche, residuo della configurazione cron) e
  # senza il flag il backend finisce sul servizio sbagliato — successo del 16/09/2026.
  "$RAILWAY" up --service bluman-api --detach
  successo "Backend inviato a Railway (build avviata in background)."
  echo "• Puoi monitorare i log con: $RAILWAY logs --service bluman-api"

  # 6. Verifica post-deploy: l'health DEVE rispondere sul dominio di produzione. La build
  #    Railway gira in background (--detach): si attende che il nuovo container risponda,
  #    con un tetto di ~5 minuti. Il fallimento NON è silenzioso.
  titolo "5. Verifica post-deploy su $API_BASE"
  echo "• In attesa del nuovo deploy (health check, max 5 minuti)..."
  HEALTH_OK=0
  for i in $(seq 1 30); do
    if curl -fsS --max-time 10 "$API_BASE/health" >/dev/null 2>&1; then
      HEALTH_OK=1
      break
    fi
    sleep 10
  done
  if [ "$HEALTH_OK" -eq 1 ]; then
    successo "Health check di produzione raggiungibile."
  else
    avviso "Health check NON raggiungibile dopo 5 minuti: controlla '$RAILWAY logs' — il deploy potrebbe essere fallito."
    exit 1
  fi

  # Sonda rotta (pattern presidiato da src/rotteNonTrovate.test.ts): una rotta vera senza
  # token deve dare 401 con corpo {errore}, mai 404. Un 404 qui significa che l'immagine
  # distribuita non contiene la rotta — il caso tipico del deploy dimenticato.
  echo "• Sonda rotta: POST /documenti/genera senza token deve dare 401, non 404..."
  CODICE=$(curl -s -o /dev/null -w '%{http_code}' --max-time 10 -X POST "$API_BASE/documenti/genera" \
    -H 'Content-Type: application/json' -d '{}' || echo "000")
  if [ "$CODICE" = "401" ]; then
    successo "Sonda rotta: 401 come atteso."
  else
    avviso "Sonda rotta ha risposto $CODICE (atteso 401): se 404, l'immagine in produzione è vecchia."
    exit 1
  fi
fi

# 6. VPS Register.it — codice, frontend, database, backend
#
# Va DOPO il push: il VPS è un checkout di git e prende il codice da GitHub, non da questa
# macchina. Aggiorna quattro cose distinte, e saltarne una lascia l'ambiente incoerente:
# il codice senza l'immagine ricostruita (backend vecchio), l'immagine senza `migrate` (schema
# vecchio), la migrazione senza `rls` (tabella nuova scoperta), il frontend senza il flag
# (app che parla col backend di Railway in silenzio).
if [ "$VPS" -eq 1 ]; then
  titolo "6. VPS — codice, frontend, database, backend"

  # `</dev/null` SEMPRE. `docker compose run/exec` eredita lo stdin, e in un'invocazione ssh lo
  # stdin è quello del terminale: il container se lo mangia e la sessione si interrompe a metà
  # **senza errore**. È la trappola già pagata due volte (`.secrets/VPS_ACCESSO.md`, diario
  # 30/09/2026), e la ragione per cui questa funzione non manda mai script sullo stdin.
  ssh_vps() {
    ssh -o BatchMode=yes -o ConnectTimeout=20 -o ServerAliveInterval=30 "$VPS_HOST" "$@" </dev/null
  }

  if ! ssh_vps 'echo ok' >/dev/null 2>&1; then
    echo "ERRORE: il VPS $VPS_HOST non risponde in modalità non interattiva." >&2
    echo "  La chiave dev'essere caricata nell'agente:   ssh-add \"\$HOME/.ssh/bluman_vps\"" >&2
    echo "  Il VPS non si aggiorna, quindi ci si ferma: un salto silenzioso lascerebbe due" >&2
    echo "  ambienti con codice diverso. Per distribuire senza:    $0 --no-vps" >&2
    exit 1
  fi
  successo "VPS raggiungibile: $VPS_HOST"

  # a) Codice — e la verifica che sia PROPRIO il commit appena distribuito. Il pull può non
  #    arrivare all'HEAD atteso (commit non spinto, main divergente, pull respinto) e in quel
  #    caso aggiornare l'immagine metterebbe in servizio un commit diverso da quello provato.
  ATTESO=$(git rev-parse HEAD)
  echo "• Codice: git pull --ff-only in $VPS_DIR..."
  ssh_vps "cd $VPS_DIR && git pull --ff-only" >/dev/null
  SU_VPS=$(ssh_vps "cd $VPS_DIR && git rev-parse HEAD")
  if [ "$SU_VPS" != "$ATTESO" ]; then
    echo "ERRORE: il VPS è su $SU_VPS, atteso $ATTESO." >&2
    echo "  Il VPS prende il codice da GitHub: se il commit non è stato spinto, il pull non può" >&2
    echo "  arrivarci. Spingi prima, oppure lancia lo script senza --solo-vps." >&2
    exit 1
  fi
  successo "VPS allineato al commit ${ATTESO:0:8}."

  # b) Frontend — build dichiarando il prefisso delle API. `VITE_API_BASE=/api` non è un
  #    dettaglio: è ciò che distingue una chiamata all'API da una pagina. Senza, `getApiBase()`
  #    ricade sull'indirizzo di Railway **in silenzio** e l'app del VPS parla col backend
  #    sbagliato — l'altro database, gli altri clienti. Si costruisce in un container
  #    usa-e-getta montando il repo INTERO e non solo `frontend/`: il frontend importa da
  #    `src/util/`, e con il volume sbagliato la build muore con `TS2307 Cannot find module
  #    '../../../src/util/…'`, che sembra un errore di codice.
  echo "• Frontend: build con VITE_API_BASE=/api (nginx monta frontend/dist)..."
  ssh_vps "cd $VPS_DIR && docker run --rm -u \"\$(id -u):\$(id -g)\" -e HOME=/tmp -e npm_config_cache=/tmp/.npm -e VITE_API_BASE=/api -v $VPS_DIR:/app -w /app/frontend node:22 sh -c 'npm ci --no-audit --no-fund && npm run build'" >/dev/null
  successo "Frontend costruito."

  # c) Database — due one-shot, in quest'ordine. `migrate` applica le migrazioni versionate;
  #    `rls` riapplica le policy a TUTTE le tabelle per introspezione, ed è idempotente
  #    (`DROP POLICY IF EXISTS` prima di ogni `CREATE`). Il secondo non è ridondante: la
  #    migrazione crea la policy solo se il ruolo `bluman_app` **e** la funzione
  #    `app_tenant_corrente` esistono già, e comunque è `rls` il punto che garantisce che
  #    nessuna tabella resti scoperta. Senza, due studi si vedrebbero a vicenda.
  echo "• Database: immagini, migrate, rls..."
  ssh_vps "cd $VPS_DIR && $COMPOSE_PROD build api migrate" >/dev/null
  ssh_vps "cd $VPS_DIR && $COMPOSE_PROD run --rm -T migrate"
  ssh_vps "cd $VPS_DIR && $COMPOSE_PROD run --rm -T rls" >/dev/null
  successo "Migrazioni applicate e RLS riapplicata."

  # d) Backend — ricrea `bluman_api` con l'immagine nuova. L'ordine migrate → rls → api non si
  #    ricostruisce qui: è nel compose (`depends_on … service_completed_successfully`), così non
  #    esiste una finestra in cui l'API risponde su uno schema incompleto.
  echo "• Backend: ricreazione dei container..."
  ssh_vps "cd $VPS_DIR && $COMPOSE_PROD up -d" >/dev/null
  successo "Container aggiornati."

  # d-bis) nginx va RICARICATO a mano, e saltarlo rompe l'API in modo silenzioso.
  #    `nginx_bluman_app.inc` fa `proxy_pass http://api:3000;` e non ha nessuna direttiva
  #    `resolver`: nginx risolve il nome `api` **una volta sola, all'avvio**, e tiene quell'IP.
  #    Ricreando il container l'IP cambia — e nginx continua a bussare a quello vecchio, quindi
  #    risponde **502 su tutte le rotte API mentre l'API è viva e risponde**. Il sintomo manda a
  #    cercare il guasto dalla parte sbagliata.
  #    Non è ipotetico: il log di nginx mostra `/health` → 502 l'01/10/2026 alle 11:53, 13:35 e
  #    15:05, cioè durante i deploy di quel giorno. Il 02/10 non si è ripetuto solo perché Docker
  #    ha riassegnato all'API **lo stesso** IP dopo la ricreazione. Succede quando non lo riusa.
  echo "• Reverse proxy: ricarica di nginx (l'IP di api è cambiato)..."
  #    `-t` per primo: se il file di configurazione non è valido, il reload non fa niente e resta
  #    in piedi la configurazione VECCHIA — cioè l'IP vecchio, cioè il 502 che si voleva evitare.
  #    Fallirebbe in silenzio, quindi si controlla prima di provarci. L'output di `-t` è tenuto da
  #    parte e mostrato solo se c'è un errore: altrimenti sporcherebbe le righe «• / ✅» del deploy.
  if RICARICA="$(ssh_vps "cd $VPS_DIR && $COMPOSE_PROD exec -T nginx nginx -t" 2>&1)" \
     && ssh_vps "cd $VPS_DIR && $COMPOSE_PROD exec -T nginx nginx -s reload" >/dev/null 2>&1; then
    successo "nginx ricaricato."
  else
    echo "ERRORE: nginx non è stato ricaricato. Il proxy resta sull'IP vecchio di api e le rotte API risponderanno 502 a API viva." >&2
    printf '%s\n' "$RICARICA" >&2
    exit 1
  fi

  # e) Verifica. Quattro controlli, ognuno coglie un guasto diverso: l'health dice se l'API è
  #    viva, il 200 sulla radice se nginx serve il frontend, la sonda rotta se l'immagine in
  #    esecuzione è quella appena costruita (un 404 significa che il container è rimasto
  #    indietro), e la sonda sulle PAGINE se il proxy si sta mangiando il frontend.
  titolo "7. Verifica post-deploy su $VPS_BASE"
  echo "• In attesa dell'health (max 2 minuti)..."
  VPS_OK=0
  for i in $(seq 1 12); do
    if curl -fsS --max-time 10 "$VPS_BASE/health" >/dev/null 2>&1; then VPS_OK=1; break; fi
    sleep 10
  done
  if [ "$VPS_OK" -eq 1 ]; then
    successo "Health del VPS raggiungibile."
  else
    echo "ERRORE: $VPS_BASE/health non risponde dopo 2 minuti." >&2
    echo "  Log: ssh $VPS_HOST 'cd $VPS_DIR && $COMPOSE_PROD logs --tail 50 api'" >&2
    exit 1
  fi

  echo "• Frontend servito..."
  CODICE_FE=$(curl -s -o /dev/null -w '%{http_code}' --max-time 10 "$VPS_BASE/" || echo "000")
  if [ "$CODICE_FE" = "200" ]; then
    successo "Frontend: 200."
  else
    echo "ERRORE: $VPS_BASE/ ha risposto $CODICE_FE (atteso 200)." >&2
    exit 1
  fi

  #    Questa sonda è quella che mancava, ed è la lezione del 02/10/2026. Sette percorsi della
  #    SPA — /portal, /invoices, /fornitori, /timesheet, /liquidazione-iva, /reports e
  #    /admin/tenants — si chiamano come rotte dell'API, e il vecchio elenco di prefissi se li
  #    prendeva: chi ricaricava una di quelle pagine riceveva un 404 in JSON o un 401 al posto
  #    dell'applicazione. Il deploy era verde, perché ogni sonda guardava l'API e nessuna
  #    guardava le pagine. Ora le API stanno sotto /api e queste devono tornare HTML.
  echo "• Pagine della SPA: devono tornare HTML, non il JSON dell'API..."
  for PAGINA in /portal /invoices /fornitori /timesheet /liquidazione-iva /reports /admin/tenants; do
    TIPO=$(curl -s -o /dev/null -w '%{content_type}' --max-time 10 "$VPS_BASE$PAGINA" || echo "000")
    case "$TIPO" in
      text/html*) ;;
      *)
        echo "ERRORE: $VPS_BASE$PAGINA ha risposto «$TIPO» invece di HTML: la richiesta è finita all'API invece che al frontend. Il location /api/ di nginx_bluman_app.inc è quello giusto?" >&2
        exit 1
        ;;
    esac
  done
  successo "Pagine della SPA: tutte HTML."

  echo "• Sonda rotta: POST /api/documenti/genera senza token deve dare 401, non 404..."
  CODICE_VPS=$(curl -s -o /dev/null -w '%{http_code}' --max-time 10 -X POST "$VPS_BASE/api/documenti/genera" -H 'Content-Type: application/json' -d '{}' || echo "000")
  if [ "$CODICE_VPS" = "401" ]; then
    successo "Sonda rotta: 401 come atteso."
  else
    echo "ERRORE: la sonda ha risposto $CODICE_VPS (atteso 401): se 404, l'immagine sul VPS è vecchia oppure il prefisso /api non arriva all'API." >&2
    exit 1
  fi

  # f) L'isolamento è la sola cosa che non si verifica «a occhio» dopo un deploy: una migrazione
  #    può aver creato una tabella, e `rls` è ciò che la copre. `checkRls` le introspeziona tutte
  #    e prova le policy con un tenant inesistente (atteso: 0 righe). Un fallimento qui non
  #    annulla il deploy — è già avvenuto — ma va saputo subito, non al primo cliente.
  echo "• Isolamento RLS (checkRls)..."
  RLS_OUT=$(ssh_vps "cd $VPS_DIR && $COMPOSE_PROD exec -T api npx tsx src/scripts/checkRls.ts" 2>&1 || true)
  if echo "$RLS_OUT" | grep -qE 'spento su 0'; then
    successo "RLS attivo su tutte le tabelle."
  else
    echo "ERRORE: checkRls non conferma l'isolamento. Output:" >&2
    echo "$RLS_OUT" | tail -20 >&2
    exit 1
  fi
fi

titolo "🎉 Distribuzione Completata con Successo!"
echo "🌐 Frontend: https://bluman.vercel.app"
echo "⚙️ Backend API: $API_BASE"
if [ "$VPS" -eq 1 ]; then
  echo "🖥️  VPS: $VPS_BASE"
else
  avviso "VPS non aggiornato (--no-vps): gira ancora il commit precedente."
fi
