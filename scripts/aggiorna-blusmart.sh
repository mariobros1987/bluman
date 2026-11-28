#!/usr/bin/env bash
#
# aggiorna-blusmart.sh [--applica]
#
# Aggiorna blusmart.eu. Gira SUL SERVER, come utente `bluman`, nella cartella del repo
# (/opt/bluman); dal PC lo lancia Fabio con ssh (DEPLOY.md):
#
#   ssh blusmart "cd /opt/bluman && git pull --ff-only && bash scripts/aggiorna-blusmart.sh"
#   ssh blusmart "cd /opt/bluman && bash scripts/aggiorna-blusmart.sh --applica"
#
# Con `--applica` lo script si stacca dalla connessione: gira in una sessione sua e scrive in
# /var/log/bluman/aggiorna-<data>.log, mentre il terminale segue il log. Se ssh cade (il 27/11 è
# caduto a metà della build delle immagini) l'aggiornamento continua, e il log si rilegge.
#
# Senza argomenti controlla e basta: dice cosa cambierebbe (versione in servizio, versione su
# disco, migrazioni da applicare, spazio, ultima copia) e non tocca niente. Con `--applica`:
#
#   1. copia di sicurezza ADESSO (scripts/backup-vps.sh, la stessa del notturno): se non
#      riesce ci si ferma prima di toccare qualunque cosa;
#   2. frontend costruito con VITE_API_BASE=/api;
#   3. immagini, `migrate`, `rls` (in quest'ordine: la RLS va riapplicata dopo ogni migrazione);
#   4. container ricreati, nginx allineato al repo e ricaricato;
#   5. sonde: health, pagine HTML, cache della radice, manuale, rotte nuove.
#
# Sono i passi di `scripts/distribuisci.sh --solo-vps` del titolare, eseguiti sul server invece
# che dal suo PC: niente identità Git imposta, niente chiave di qualcun altro. Lo stdin di ogni
# comando docker è chiuso (`</dev/null`): lanciato via ssh, un container che eredita il terminale
# se lo mangia e la sessione si interrompe a metà senza errore (diario del 30/09/2026).
set -euo pipefail
# BLUMAN_DIR serve al ritorno a una versione precedente, che lo script non ce l'ha: lo si lancia
# da una copia in /tmp (vedi la riga «Per tornare indietro» alla fine).
cd "${BLUMAN_DIR:-$(cd "$(dirname "$0")/.." && pwd)}"

COMPOSE="docker compose -f docker-compose.prod.yml"
BASE="${BLUMAN_BASE:-http://127.0.0.1}"
FILE_ULTIMO=".git/bluman-ultimo-aggiornamento"
APPLICA=no
for a in "$@"; do
  case "$a" in
    --applica) APPLICA=si ;;
    *) echo "argomento sconosciuto: $a (ammesso: --applica)" >&2; exit 2 ;;
  esac
done

# Staccarsi dalla connessione. `setsid` mette lo script in una sessione nuova, che la caduta di ssh
# non raggiunge; il processo resta figlio di questa shell, quindi `wait` ne legge l'esito.
if [ "$APPLICA" = si ] && [ -z "${BLUMAN_STACCATO:-}" ]; then
  DIR_LOG=/var/log/bluman
  [ -w "$DIR_LOG" ] || DIR_LOG=/tmp
  LOG="$DIR_LOG/aggiorna-$(date +%Y%m%d_%H%M%S).log"
  BLUMAN_STACCATO=1 setsid nohup bash "$0" --applica > "$LOG" 2>&1 </dev/null &
  FIGLIO=$!
  echo "Aggiornamento avviato sul server. Se la connessione cade continua lo stesso;"
  echo "per rileggere il log: ssh blusmart \"tail -40 $LOG\""
  tail -n +1 -f --pid="$FIGLIO" "$LOG"
  wait "$FIGLIO"
  exit $?
fi

titolo() { printf '\n== %s\n' "$1"; }
ok() { printf '✔ %s\n' "$1"; }
errore() { printf 'ERRORE: %s\n' "$1" >&2; exit 1; }

[ -f docker-compose.prod.yml ] && [ -f .env ] \
  || errore "qui non c'è docker-compose.prod.yml con il suo .env: lo script va lanciato sul server, in /opt/bluman."

# Le variabili del database servono per leggere le migrazioni già applicate. Non si stampano.
set -a; . ./.env; set +a
: "${POSTGRES_USER:?manca POSTGRES_USER nel .env}"
: "${POSTGRES_DB:?manca POSTGRES_DB nel .env}"

titolo "Situazione"
SU_DISCO="$(git rev-parse HEAD)"
IN_SERVIZIO="$(cat "$FILE_ULTIMO" 2>/dev/null || true)"
echo "• Versione su disco:      $(git log -1 --format='%h %ad %s' --date=short)"
if [ -n "$IN_SERVIZIO" ]; then
  # È l'ultimo commit messo in servizio da questo script: un `git pull` cambia i file su disco,
  # non il sito, quindi la versione «di prima» non si ricava da git.
  echo "• In servizio:            $(git log -1 --format='%h %ad %s' --date=short "$IN_SERVIZIO" 2>/dev/null || echo "$IN_SERVIZIO")"
else
  echo "• In servizio:            non registrata (nessun aggiornamento fatto con questo script)"
fi

# I file tracciati devono essere quelli di GitHub: una modifica fatta a mano sul server
# finirebbe in servizio senza essere passata da nessuna prova.
if [ -n "$(git status --porcelain --untracked-files=no)" ]; then
  git status --short --untracked-files=no >&2
  errore "sul server ci sono file del repo modificati a mano (sopra). Vanno capiti prima di aggiornare."
fi
ok "Nessun file del repo modificato a mano."

APPLICATE="$($COMPOSE exec -T postgres psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" -Atc \
  "select migration_name from _prisma_migrations where finished_at is not null and rolled_back_at is null" </dev/null)" \
  || errore "non riesco a leggere le migrazioni dal database: il container postgres è acceso?"
DA_APPLICARE=()
for d in prisma/migrations/*/; do
  nome="$(basename "$d")"
  grep -qxF "$nome" <<<"$APPLICATE" || DA_APPLICARE+=("$nome")
done
if [ "${#DA_APPLICARE[@]}" -eq 0 ]; then
  ok "Nessuna migrazione da applicare."
else
  echo "• Migrazioni da applicare (${#DA_APPLICARE[@]}):"
  printf '    %s\n' "${DA_APPLICARE[@]}"
fi

ULTIMA_COPIA="$(ls -t /var/backups/bluman/*.dump.enc 2>/dev/null | head -1 || true)"
echo "• Ultima copia del database: ${ULTIMA_COPIA:-nessuna in /var/backups/bluman}"
echo "• Spazio libero: $(df -h / | awk 'NR==2 {print $4 " su " $2}')"

if [ "$APPLICA" != si ]; then
  titolo "Solo controllo: niente è cambiato"
  echo "Per aggiornare: bash scripts/aggiorna-blusmart.sh --applica"
  exit 0
fi

titolo "1. Copia di sicurezza"
bash ./scripts/backup-vps.sh </dev/null
COPIA="$(ls -t /var/backups/bluman/*.dump* 2>/dev/null | head -1 || true)"
[ -n "$COPIA" ] || errore "la copia di sicurezza non ha lasciato nessun file: non aggiorno."
ok "Copia fatta: $COPIA"

titolo "2. Frontend"
# Montato il repo INTERO: il frontend importa da `src/`. Senza VITE_API_BASE=/api l'app
# parlerebbe in silenzio col backend di Railway.
docker run --rm -u "$(id -u):$(id -g)" -e HOME=/tmp -e npm_config_cache=/tmp/.npm -e VITE_API_BASE=/api \
  -v "$(pwd)":/app -w /app/frontend node:22 sh -c 'npm ci --no-audit --no-fund && npm run build' </dev/null >/dev/null
ok "Frontend costruito."

titolo "3. Database: immagini, migrate, rls"
$COMPOSE build api migrate </dev/null >/dev/null
$COMPOSE run --rm -T migrate </dev/null
$COMPOSE run --rm -T rls </dev/null >/dev/null
ok "Migrazioni applicate e RLS riapplicata."

titolo "4. Container e nginx"
$COMPOSE up -d </dev/null >/dev/null
ok "Container aggiornati."
CONF_REPO="$(sha256sum nginx/bluman_app.inc | awk '{print $1}')"
conf_container() { $COMPOSE exec -T nginx sha256sum /etc/nginx/conf.d/bluman_app.inc </dev/null | awk '{print $1}' | tr -d '\r'; }
if [ "$(conf_container)" != "$CONF_REPO" ]; then
  echo "• nginx serve una configurazione diversa da quella del repo: lo ricreo."
  $COMPOSE up -d --force-recreate --no-deps nginx </dev/null >/dev/null
fi
[ "$(conf_container)" = "$CONF_REPO" ] || errore "il container nginx non serve la configurazione del repo."
# nginx risolve `api` solo all'avvio: con il container ricreato l'IP cambia e senza reload
# tutte le rotte API risponderebbero 502 con l'API viva.
$COMPOSE exec -T nginx nginx -t </dev/null >/dev/null 2>&1 || errore "la configurazione di nginx non è valida: non ricarico."
$COMPOSE exec -T nginx nginx -s reload </dev/null >/dev/null
ok "nginx allineato e ricaricato."

titolo "5. Verifiche su $BASE"
VIVO=no
for _ in $(seq 1 12); do
  if curl -fsS --max-time 10 "$BASE/health" >/dev/null 2>&1; then VIVO=si; break; fi
  sleep 10
done
[ "$VIVO" = si ] || errore "/health non risponde dopo 2 minuti. Log: $COMPOSE logs --tail 50 api"
ok "Backend vivo."

[ "$(curl -s -o /dev/null -w '%{http_code}' --max-time 10 "$BASE/")" = "200" ] || errore "la radice non risponde 200."
CACHE="$(curl -s -o /dev/null -D - --max-time 10 "$BASE/" | tr -d '\r' | awk 'tolower($1)=="cache-control:" {print tolower($0); exit}')"
case "$CACHE" in
  *no-cache*|*no-store*|*must-revalidate*|*max-age=0*) ok "Radice servita e non cacheabile senza rivalidazione." ;;
  *) errore "la radice non impone la rivalidazione (Cache-Control: «${CACHE:-nessuno}»): chi ha l'app aperta vedrebbe la versione vecchia." ;;
esac

# Pagine della SPA: devono tornare HTML. Le prime sette si chiamano come rotte dell'API
# (guasto del 02/10/2026); /aiuto/<scheda> è un indirizzo profondo; /note-beta è nuova.
for PAGINA in /portal /invoices /fornitori /timesheet /liquidazione-iva /reports /admin/tenants /aiuto /aiuto/05-fatture-sdi /note-beta; do
  TIPO="$(curl -s -o /dev/null -w '%{content_type}' --max-time 10 "$BASE$PAGINA")"
  case "$TIPO" in
    text/html*) ;;
    *) errore "$PAGINA ha risposto «$TIPO» invece di HTML: la richiesta non arriva al frontend." ;;
  esac
done
ok "Pagine della SPA: tutte HTML."

# Rotte che devono esistere nell'immagine nuova: senza token rispondono 401, un 404 vuol dire
# che il container in servizio è rimasto indietro.
ROTTE=("GET /api/manuale" "POST /api/documenti/genera")
[ -f src/routes/noteBeta.ts ] && ROTTE+=("GET /api/note-beta")
for ROTTA in "${ROTTE[@]}"; do
  set -- $ROTTA
  CODICE="$(curl -s -o /dev/null -w '%{http_code}' --max-time 10 -X "$1" "$BASE$2" -H 'Content-Type: application/json' -d '{}')"
  [ "$CODICE" = "401" ] || errore "$1 $2 ha risposto $CODICE (atteso 401): l'immagine in servizio non è quella appena costruita."
done
ok "Rotte dell'immagine nuova presenti."

# Il manuale si legge a runtime da docs/manuale dentro l'immagine: tanti file quanti nel repo.
ATTESI="$(ls docs/manuale | wc -l | tr -d '[:space:]')"
TROVATI="$($COMPOSE exec -T api sh -c 'ls /app/docs/manuale | wc -l' </dev/null | tr -d '[:space:]')"
[ "$TROVATI" = "$ATTESI" ] || errore "dentro l'immagine ci sono $TROVATI file del manuale, nel repo $ATTESI: l'Aiuto sarebbe incompleto."
ok "Manuale: $TROVATI file dentro l'immagine."

echo "$SU_DISCO" > "$FILE_ULTIMO"
titolo "Fatto"
echo "blusmart.eu è su $(git log -1 --format='%h %s' "$SU_DISCO")."
echo "Copia di sicurezza di prima: $COPIA"
if [ -n "$IN_SERVIZIO" ] && [ "$IN_SERVIZIO" != "$SU_DISCO" ]; then
  echo "Per tornare alla versione di prima:"
  echo "  cp scripts/aggiorna-blusmart.sh /tmp/ && git checkout ${IN_SERVIZIO:0:8} && BLUMAN_DIR=\"\$(pwd)\" bash /tmp/aggiorna-blusmart.sh --applica"
  echo "  e poi, per ripartire: git checkout main"
  echo "(lo schema del database resta quello nuovo: le migrazioni si fanno compatibili all'indietro)."
fi
