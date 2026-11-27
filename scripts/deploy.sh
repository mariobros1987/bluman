#!/usr/bin/env bash
# deploy.sh <sha|tag>  — deploy con backup, db push condizionato, health e rollback.
# Gira SUL server, lanciato dal runner GitHub (o a mano, in emergenza).
# Script COMUNE: identico in ogni progetto (viene dallo standard, si aggiorna con
# strumenti/aggiorna-metodo.sh). Quello che cambia fra un progetto e l'altro sta in
# scripts/progetto.env (versionato, uguale su tutti i server del progetto); quello
# che cambia fra un server e l'altro in scripts/deploy.env (non versionato, lo
# scrive bootstrap). deploy.env viene letto dopo, quindi può sovrascrivere.
set -Eeuo pipefail

REPO_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$REPO_DIR"
# shellcheck disable=SC1091
[[ -f "$REPO_DIR/scripts/progetto.env" ]] && source "$REPO_DIR/scripts/progetto.env"
# shellcheck disable=SC1091
source "$REPO_DIR/scripts/deploy.env"
# progetto.env definisce (vedi il file per gli esempi):
#   NOME_PROGETTO, WEB_RE, DB_URL_FILE, PROVA_SCHEMA_CMD, MISURA_RIAVVIO_CMD,
#   MISURA_RIAVVIO_NOME, TABELLE_DA_CONTARE, TABELLE_DA_MOSTRARE
# deploy.env definisce:
#   PM2_NAME        nome del processo pm2
#   PORT            porta dell'health
#   HEALTH_PATH     es. /health
#   WEB_SRC         es. apps/web/dist-web   (vuoto = nessun web)
#   WEB_DIR         es. /var/www/xxx
#   DB_CONTAINER    es. app-postgres        (vuoto = nessun DB)
#   DB_USER / DB_NAME
#   BACKUP_DIR      es. /root/backup/app
#   PNPM            es. "pnpm"  oppure "npx -y pnpm@9.12.0"
#   BUILD_CMD       es. 'pnpm --filter "@app/backend..." build'
#   WEB_BUILD_CMD   es. 'pnpm --filter @app/web build'
#   DB_PUSH_CMD     es. 'cd packages/db && ../../node_modules/.pnpm/node_modules/.bin/prisma db push --schema=prisma/schema.prisma && ../../node_modules/.pnpm/node_modules/.bin/prisma generate --schema=prisma/schema.prisma'
#   SCHEMA_PATH     es. packages/db/prisma/schema.prisma
#   KEEP_BACKUPS    es. 14   (copie dei deploy; il giornaliero ne tiene 30, backup.yml)

TARGET="${1:-}"
[[ -n "$TARGET" ]] || { echo "uso: deploy.sh <sha|tag>"; exit 2; }
STAMP="$(date +%Y%m%d-%H%M%S)"
log() { printf '[deploy %s] %s\n' "$(date +%H:%M:%S)" "$*"; }

# PREV_SHA: il commit di partenza, se il workflow ha già fatto il checkout del nuovo.
PREV="${PREV_SHA:-$(git rev-parse HEAD)}"
log "da $PREV a $TARGET"

# 1. codice
for n in 1 2 3; do git fetch --quiet origin && break; [[ $n == 3 ]] && { log "fetch non riuscito: GitHub non risponde"; exit 1; }; log "fetch non riuscito (tentativo $n di 3)"; sleep $((n * 30)); done
git checkout --quiet --force "$TARGET"
NOW="$(git rev-parse HEAD)"
log "checkout $NOW"

# Che cosa serve davvero, dai file cambiati fra l'ULTIMO DEPLOY RIUSCITO e NOW.
# La base è l'ultimo tag deploy/* (si scrive solo a «FATTO»), non PREV: se un
# deploy si è fermato prima della build (backup o fetch falliti), il repo è già
# sul commit nuovo ma in esecuzione c'è la build vecchia, e confrontare con PREV
# farebbe sembrare «niente» una modifica al backend mai arrivata.
#   niente   → solo documenti, test, workflow, regole o script comuni del metodo
#              (scripts/*.sh dello Standard: girano nella CI o sul server, mai
#              dentro l'app; 12/11): niente build, niente restart. Il codice in
#              produzione non cambia, quindi non si ferma.
#   solo-web → in più solo apps/web/: si ricostruisce e si copia il web, il
#              backend non si riavvia (i pacchetti e il lockfile non sono cambiati).
#   completo → tutto il resto; e sempre quando non c'è un tag di deploy, quando
#              la base è NOW (un rilancio a mano è un rilancio vero) o quando il
#              confronto non riesce («non lo so» non è «niente»).
# --no-renames: un file spostato conta per il percorso vecchio E per il nuovo
# (un .ts del backend spostato in docs/ toglie un file al backend).
# Gli script comuni sono per nome esatto: un altro file in scripts/ può essere
# del progetto e servire all'app (per esempio alla build), quindi non è fermo.
FERMO_RE='(^docs/|\.md$|^\.github/|^\.claude/|/test/|\.test\.ts$|^scripts/(push-ramo|review-label|automerge|deploy|rollback|notify|ci-notify|backup|prova-ripristino|diagnose|setup-github|livello|ci-rossa|sentinella)\.sh$|^scripts/deploy\.env\.example$)'
# WEB_RE (progetto.env): la cartella dell'interfaccia (es. '^apps/web/'). Vuota =
# nessuna interfaccia separata: il modo solo-web non esiste (una regex vuota
# prenderebbe tutto e farebbe passare il backend per web).
WEB_RE="${WEB_RE:-}"
BASE="$(git tag -l 'deploy/*' | sort | tail -n1)"
BASE_SHA="$( [[ -n "$BASE" ]] && git rev-parse --quiet --verify "$BASE^{commit}" || true )"
MODO=completo
if [[ -n "$BASE_SHA" && "$BASE_SHA" != "$NOW" ]] && cambiati="$(git diff --no-renames --name-only "$BASE_SHA" "$NOW")"; then
  resto="$(grep -Ev "$FERMO_RE" <<<"$cambiati" || true)"
  if [[ -z "$resto" ]]; then MODO=niente
  elif [[ -n "$WEB_RE" ]] && ! grep -Evq "$WEB_RE" <<<"$resto"; then MODO=solo-web
  fi
fi
log "base ${BASE:-nessun tag} (${BASE_SHA:0:7})"
log "modo: $MODO"
# Nota per l'avviso Telegram (notify.sh la legge e la cancella): cosa è successo
# oltre all'esito. Fuori dal repo, così il checkout non la vede.
NOTA="/tmp/deploy-nota-$PM2_NAME"
case "$MODO" in
  niente)   echo "solo documenti, test o metodo: backend non riavviato" > "$NOTA" ;;
  solo-web) echo "solo interfaccia: backend non riavviato" > "$NOTA" ;;
  *)        : > "$NOTA" ;;
esac

# Misura facoltativa prima e dopo il riavvio (progetto.env, MISURA_RIAVVIO_CMD):
# un numero che il riavvio non dovrebbe far scendere (per esempio le connessioni
# attive verso un servizio esterno). Il comando gira nella cartella del repo e stampa un
# numero; se esce male o stampa altro, «non letto»: «non lo so» non è «zero».
misura() { local n; n="$(bash -c "$MISURA_RIAVVIO_CMD" 2>/dev/null)" || return 0; n="${n//[[:space:]]/}"; [[ "$n" =~ ^[0-9]+$ ]] && echo "$n"; return 0; }
PRIMA=""
if [[ "$MODO" == completo && -n "${MISURA_RIAVVIO_CMD:-}" ]]; then
  PRIMA="$(misura)"
  log "${MISURA_RIAVVIO_NOME:-misura} prima del riavvio: ${PRIMA:-non letto}"
fi

# 2. backup, in ogni modo (anche niente e solo-web)
if [[ -n "${DB_CONTAINER:-}" ]]; then
  mkdir -p "$BACKUP_DIR"
  docker exec "$DB_CONTAINER" pg_dump -U "$DB_USER" -d "$DB_NAME" -Fc > "$BACKUP_DIR/$DB_NAME-$STAMP.dump"
  log "backup $BACKUP_DIR/$DB_NAME-$STAMP.dump ($(du -h "$BACKUP_DIR/$DB_NAME-$STAMP.dump" | cut -f1))"
  ls -1t "$BACKUP_DIR"/*.dump 2>/dev/null | tail -n +"$((KEEP_BACKUPS + 1))" | xargs -r rm -f
fi

# Prova dello schema su una COPIA del database, prima di toccare quello vero
# (dal pilota, 04/11/2026: «prova delle migrazioni su una copia dei dati veri»).
# La copia è il backup appena fatto, ripristinato in <DB_NAME>_prova nello
# stesso container; PROVA_SCHEMA_CMD (progetto.env) gira lì. Se la prova fallisce,
# o non si può fare (ripristino non riuscito, URL non riconoscibile, comando non
# configurato), il deploy si ferma: «non lo so» non è «va bene».
prova_schema() {
  local env_db="$REPO_DIR/${DB_URL_FILE:-packages/db/.env}" dump="$BACKUP_DIR/$DB_NAME-$STAMP.dump" vera url prova="${DB_NAME}_prova" out esito=0
  ferma() { log "prova dello schema: $1"; echo "❌ prova dello schema su una copia non riuscita ($1): database di produzione non toccato" >> "$NOTA"; docker exec "$DB_CONTAINER" dropdb -U "$DB_USER" --if-exists "$prova" >/dev/null 2>&1 || true; return 1; }
  [[ -n "${PROVA_SCHEMA_CMD:-}" ]] || { ferma "PROVA_SCHEMA_CMD non configurato in progetto.env"; return 1; }
  [[ -n "${DB_CONTAINER:-}" && -f "$dump" ]] || { ferma "manca il backup appena fatto"; return 1; }
  vera="$( { grep -E '^DATABASE_URL=' "$env_db" 2>/dev/null || true; } | tail -n 1 | cut -d= -f2- | tr -d "\"'")"
  # Si cambia solo il NOME DEL DATABASE in fondo all'URL (prima di un eventuale
  # «?…»): con un utente che si chiama come il database (app:…@…/app) la
  # sostituzione del primo «/app» rinominava l'utente e la prova falliva (05/11).
  local base="${vera%%\?*}" resto
  resto="${vera:${#base}}"
  url=""
  [[ "$base" == */"$DB_NAME" ]] && url="${base%/"$DB_NAME"}/$prova$resto"
  [[ -n "$vera" && -n "$url" ]] || { ferma "URL del database non riconosciuto in ${DB_URL_FILE:-packages/db/.env}"; return 1; }
  docker exec "$DB_CONTAINER" dropdb -U "$DB_USER" --if-exists "$prova" >/dev/null 2>&1 || true
  docker exec "$DB_CONTAINER" createdb -U "$DB_USER" "$prova" || { ferma "createdb"; return 1; }
  docker exec -i "$DB_CONTAINER" pg_restore -U "$DB_USER" -d "$prova" --no-owner --no-privileges < "$dump" || { ferma "ripristino della copia"; return 1; }
  # La barriera sta nella struttura: il comando gira in una cartella temporanea
  # con la sola copia dello schema, senza .env né package.json accanto, così
  # l'unico DATABASE_URL che può leggere è quello della copia (accanto allo
  # schema vero c'è il .env con l'URL VERO, e un controllo sull'output
  # arriverebbe dopo il push).
  local tmp; tmp="$(mktemp -d)" || { ferma "cartella temporanea"; return 1; }
  cp "$REPO_DIR/$SCHEMA_PATH" "$tmp/" || { rm -rf "$tmp"; ferma "copia dello schema"; return 1; }
  out="$(cd "$tmp" && DATABASE_URL="$url" REPO_DIR="$REPO_DIR" bash -c "$PROVA_SCHEMA_CMD" 2>&1)" || esito=1
  rm -rf "$tmp"
  printf '%s\n' "$out" | tail -n 15
  # Seconda verifica, non la barriera: lo strumento stampa il nome del database
  # su cui lavora (Prisma lo fa). Se il tuo non lo stampa, togli questa riga.
  grep -q "$prova" <<<"$out" || { ferma "il comando non ha lavorato sulla copia"; return 1; }
  (( esito == 0 )) || { ferma "comando di prova sulla copia fallito"; return 1; }
  docker exec "$DB_CONTAINER" dropdb -U "$DB_USER" --if-exists "$prova" >/dev/null 2>&1 || true
  log "prova dello schema su una copia: ok"
  echo "prova dello schema su una copia: ok" >> "$NOTA"
}

SCHEMA=no
# Il rollback torna all'ULTIMO DEPLOY RIUSCITO (BASE_SHA), non a PREV: dopo un
# deploy fermo prima della build PREV è un commit mai andato in produzione, e
# «tornarci» vorrebbe dire compilarlo e avviarlo per la prima volta. Senza tag: PREV.
INDIETRO="${BASE_SHA:-$PREV}"
rollback() {
  log "ROLLBACK a $INDIETRO"
  # Il rollback riporta il CODICE, non lo schema: lo si dice com'è.
  case "$SCHEMA" in
    tentato)   echo "❌ db push fallito: lo schema può essere rimasto a metà; codice tornato a ${INDIETRO:0:7}, backup in $BACKUP_DIR" >> "$NOTA" ;;
    applicato) echo "⚠️ schema nuovo applicato, ma il codice è tornato a ${INDIETRO:0:7}: controllare che la versione vecchia lo regga (backup in $BACKUP_DIR)" >> "$NOTA" ;;
  esac
  git checkout --quiet --force "$INDIETRO"
  # Il rollback rifà solo ciò che il deploy aveva toccato: nei modi niente e
  # solo-web il backend non è stato ricompilato né riavviato, e non lo si
  # riavvia adesso (sarebbe proprio il restart che quei modi evitano).
  case "$MODO" in
    completo)
      $PNPM install --frozen-lockfile >/dev/null 2>&1 || true
      bash -c "$BUILD_CMD" >/dev/null 2>&1 || true
      pm2 restart "$PM2_NAME" >/dev/null 2>&1 || true
      echo "rollback: codice tornato a ${INDIETRO:0:7}, backend ricompilato e riavviato" >> "$NOTA" ;;
    solo-web)
      if [[ -n "${WEB_SRC:-}" ]] && bash -c "$WEB_BUILD_CMD" >/dev/null 2>&1 && cp -a "$WEB_SRC/." "$WEB_DIR/"; then
        echo "rollback: web tornato a ${INDIETRO:0:7}; backend non toccato" >> "$NOTA"
      else
        echo "rollback: web NON ricostruito (controllare $WEB_DIR); backend non toccato" >> "$NOTA"
      fi ;;
    *)
      echo "rollback: codice tornato a ${INDIETRO:0:7}; backend non toccato" >> "$NOTA" ;;
  esac
  exit 1
}
trap 'rollback' ERR

if [[ "$MODO" == completo ]]; then
  # 3. dipendenze
  $PNPM install --frozen-lockfile

  # 4. schema, solo se è cambiato
  # Anche lo schema si confronta con l'ultimo deploy riuscito (senza tag: con PREV).
  if [[ -n "${SCHEMA_PATH:-}" ]] && ! git diff --quiet "${BASE_SHA:-$PREV}" "$NOW" -- "$SCHEMA_PATH"; then
    log "schema cambiato: prima la prova su una copia"
    prova_schema
    log "schema cambiato: db push"
    SCHEMA=tentato
    bash -c "$DB_PUSH_CMD"
    SCHEMA=applicato
    echo "ℹ️ modifica al database applicata (db push riuscito, backup fatto prima)" >> "$NOTA"
  else
    log "schema invariato"
  fi

  # 5. build
  bash -c "$BUILD_CMD"

  # 6. restart
  pm2 restart "$PM2_NAME" --update-env
  sleep 10
fi

# 7. health: anche senza restart, per dire che dopo il deploy il backend risponde
if ! curl -fsS --max-time 10 "http://127.0.0.1:$PORT$HEALTH_PATH" >/dev/null; then
  log "health FALLITO"
  if [[ "$MODO" != completo ]]; then
    echo "❌ il backend non risponde all'health, e questo deploy non l'ha toccato: era già giù prima?" >> "$NOTA"
  fi
  rollback
fi
log "health ok"

# 8. web
if [[ -n "${WEB_SRC:-}" && "$MODO" != niente ]]; then
  bash -c "$WEB_BUILD_CMD"
  mkdir -p "$WEB_DIR"
  cp -a "$WEB_SRC/." "$WEB_DIR/"
  log "web copiato in $WEB_DIR"
fi

# La misura DOPO, a health passata (il backend ha finito di partire).
if [[ "$MODO" == completo && -n "${MISURA_RIAVVIO_CMD:-}" ]]; then
  DOPO="$(misura)"; nome="${MISURA_RIAVVIO_NOME:-misura}"
  log "$nome dopo il riavvio: ${DOPO:-non letto} (prima ${PRIMA:-non letto})"
  if [[ ! "$PRIMA" =~ ^[0-9]+$ || ! "$DOPO" =~ ^[0-9]+$ ]]; then echo "$nome: prima del riavvio ${PRIMA:-non letto}, dopo ${DOPO:-non letto}" >> "$NOTA"
  elif (( DOPO < PRIMA )); then echo "⚠️ $nome: $PRIMA prima del riavvio, $DOPO dopo (può anche essere sceso da solo in quei secondi)" >> "$NOTA"
  else echo "$nome: $PRIMA prima e $DOPO dopo il riavvio" >> "$NOTA"; fi
fi

# 9. tag del deploy
git tag -f "deploy/$STAMP" "$NOW" >/dev/null
trap - ERR
log "FATTO $NOW"
