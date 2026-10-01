#!/usr/bin/env bash
# ═════════════════════════════════════════════════════════════════════
# BLUMAN — SORVEGLIANZA DEL VPS (controlli + avvisi Telegram)
# ═════════════════════════════════════════════════════════════════════
#
# Gira dal cron dell'utente `bluman` ogni 10 minuti. Non fa nulla di distruttivo:
# legge, confronta, e scrive su Telegram solo quando qualcosa CAMBIA.
#
# ── PERCHÉ AVVISA SOLO SUI CAMBIAMENTI ───────────────────────────────────────
# Un controllo che manda un messaggio a ogni giro ne manda 144 al giorno e viene
# silenziato entro sera. Da lì in poi non avvisa più nemmeno quando serve, che è
# peggio di non averlo. Quindi ogni controllo ha uno stato ricordato in $STATO_DIR
# e si avvisa solo sulla TRANSIZIONE:
#   da non-fallito a fallito  → 🔴 avviso
#   da fallito a ok           → 🟢 rientro
#   qualunque cosa con `unknown` → silenzio, solo nel log e nel riepilogo
# `unknown` significa «non ho potuto leggere» (manca un permesso, il registro non
# risponde): non è un guasto e avvisare sarebbe rumore. Non sparisce però dal
# riepilogo, che è il posto giusto per accorgersi che un controllo è cieco da giorni.
#
# ── PERCHÉ C'È UN RIEPILOGO GIORNALIERO ──────────────────────────────────────
# Il silenzio di questo script è indistinguibile da «il monitor è morto». Il
# riepilogo delle 08:00 UTC (10:00 italiane) è ciò che rende il silenzio
# significativo: se un giorno non arriva, il problema è nel monitor stesso.
#
# ── CONFIGURAZIONE ───────────────────────────────────────────────────────────
# I segreti stanno in /etc/bluman/monitor.env (600, di bluman), NON nel .env
# dell'applicazione: quel file è dichiarato in `env_file:` di docker-compose.prod.yml,
# quindi ogni sua variabile finisce DENTRO il container dell'API. Un token che serve
# a sorvegliare il server non ha niente da fare là dentro. I nomi sono anche diversi
# di proposito: l'app ha già i suoi TELEGRAM_* (TELEGRAM_WEBHOOK_SECRET, il bot degli
# studi) e un token in più con lo stesso prefisso sarebbe una trappola.
#
#   BLUMAN_AVVISI_BOT_TOKEN   token del bot dedicato agli avvisi (da @BotFather)
#   BLUMAN_AVVISI_CHAT_ID     chat che riceve gli avvisi (si scopre con `--prova`)
#
# Opzionali: BLUMAN_MONITOR_BACKUP_MAX_ORE (26), BLUMAN_MONITOR_DISCO_PCT (85),
# BLUMAN_MONITOR_MEM_PCT (15), BLUMAN_MONITOR_SWAP_PCT (50),
# BLUMAN_MONITOR_RIEPILOGO_ORA (8), BLUMAN_MONITOR_APT_MAX_ORE (168),
# BLUMAN_MONITOR_STATO, BLUMAN_MONITOR_CONF, BLUMAN_BACKUP_DIR,
# BLUMAN_MONITOR_HEALTH_URL.
#
# ── USO ──────────────────────────────────────────────────────────────────────
#   bash ./scripts/monitor-vps.sh                 # un giro completo
#   bash ./scripts/monitor-vps.sh --riepilogo     # giro + riepilogo forzato
#   bash ./scripts/monitor-vps.sh --prova         # messaggio di prova, ed esce
#   bash ./scripts/monitor-vps.sh --ignora-stato  # come se fosse il primo giro
#
# ── TRAPPOLE GIÀ PAGATE (non toglierle) ──────────────────────────────────────
# 1. NIENTE `set -e`. Un monitor che esce al primo comando che fallisce smette di
#    avvisare proprio quando le cose vanno male, e in silenzio. Ogni controllo
#    gestisce il proprio errore e degrada a `unknown`.
# 2. Nessun `$2` letto senza `${2:-}`: con `set -u` una variabile non passata
#    aborta lo script — cioè l'unico modo in cui un monitor può morire zitto.
# 3. Il token NON deve finire nel log. `curl` stampa l'URL — che lo contiene — in
#    chiaro quando fallisce: qui lo stderr di curl è sempre soppresso e si registra
#    solo il codice HTTP.
# 4. Messaggio in TESTO SEMPLICE, senza parse_mode: percorsi e output dei comandi
#    contengono `_`, `*`, `[`, che in Markdown fanno fallire l'invio con un 400 e il
#    messaggio non arriva affatto.
# 5. `docker compose exec`/`run` eredita lo stdin e, invocato via ssh, se lo mangia.
#    Qui non si usa; se un domani servisse, va messo `-T` e `</dev/null`.
# 6. «Zero aggiornamenti» e «non ho potuto contarli» sono risposte diverse. Dove un
#    comando può fallire restituendo un numero che sembra valido, si verifica che
#    abbia davvero funzionato prima di credergli.

set -uo pipefail

CONF="${BLUMAN_MONITOR_CONF:-/etc/bluman/monitor.env}"
STATO_DIR="${BLUMAN_MONITOR_STATO:-/var/lib/bluman-monitor}"

# ── CONFIGURAZIONE ───────────────────────────────────────────────────────────
if [ -r "$CONF" ]; then
  set -a
  # shellcheck disable=SC1090
  . "$CONF"
  set +a
fi

BLUMAN_AVVISI_BOT_TOKEN="${BLUMAN_AVVISI_BOT_TOKEN:-}"
BLUMAN_AVVISI_CHAT_ID="${BLUMAN_AVVISI_CHAT_ID:-}"
MAX_ORE_BACKUP="${BLUMAN_MONITOR_BACKUP_MAX_ORE:-26}"
SOGLIA_DISCO="${BLUMAN_MONITOR_DISCO_PCT:-85}"
SOGLIA_MEM="${BLUMAN_MONITOR_MEM_PCT:-15}"
SOGLIA_SWAP="${BLUMAN_MONITOR_SWAP_PCT:-50}"
ORA_RIEPILOGO="${BLUMAN_MONITOR_RIEPILOGO_ORA:-8}"
MAX_ORE_LISTE_APT="${BLUMAN_MONITOR_APT_MAX_ORE:-168}"
HEALTH_URL="${BLUMAN_MONITOR_HEALTH_URL:-http://127.0.0.1/health}"
DIR_BACKUP="${BLUMAN_BACKUP_DIR:-/var/backups/bluman}"

CHIAVI=(backup disco memoria container health apt postgres)
declare -A ETICHETTE=(
  [backup]="Backup"          [disco]="Disco"        [memoria]="Memoria"
  [container]="Container"    [health]="API /health" [apt]="Aggiornamenti di sistema"
  [postgres]="Immagine PostgreSQL"
)

# ── UTILITÀ ──────────────────────────────────────────────────────────────────
# Tutto su stdout: il cron redirige verso /var/log/bluman/monitor.log, e a mano si
# legge direttamente. Nessun log scritto internamente, per non duplicare le righe.
riga() { printf '%s\n' "$*"; }
adesso() { date -u '+%Y-%m-%dT%H:%M:%SZ'; }

# Unisce gli argomenti con un a capo. Serve perché `printf '%s\n' "${a[@]}"` con un
# array vuoto stampa una riga vuota, e un messaggio Telegram che comincia con una
# riga vuota è solo brutto da leggere.
elenco() { local IFS=$'\n'; printf '%s' "$*"; }

# Quante ore possono passare fra due esecuzioni di un controllo. `apt` e il registro
# Docker si interrogano una volta al giorno: a ogni giro sarebbero 144 chiamate per
# un'informazione che cambia una volta al mese, e prima o poi si viene limitati.
# Nel frattempo vale l'ultimo stato letto, che resta visibile nel riepilogo.
cadenza_di() {
  case "$1" in
    apt|postgres) printf '24' ;;
    *)            printf '0' ;;
  esac
}

esegui_controllo() {
  case "$1" in
    backup)    controlla_backup ;;
    disco)     controlla_disco ;;
    memoria)   controlla_memoria ;;
    container) controlla_container ;;
    health)    controlla_health ;;
    apt)       controlla_apt ;;
    postgres)  controlla_postgres ;;
  esac
}

# ── CONTROLLI ────────────────────────────────────────────────────────────────
# Ognuno stampa UNA riga `stato|dettaglio`, con stato in {ok, fail, unknown}.

# 1. FRESCHEZZA DEL BACKUP — il controllo che chiude il buco del 01/10/2026.
#    Il cron notturno non manda email se fallisce: senza questo, il backup poteva
#    essere morto da giorni e nessuno se ne sarebbe accorto fino al giorno del
#    restore, cioè il giorno in cui serve.
controlla_backup() {
  local ultimo eta file
  ultimo="$(ls -1t "$DIR_BACKUP"/bluman_*.dump "$DIR_BACKUP"/bluman_*.dump.enc 2>/dev/null | head -1)"
  if [ -z "$ultimo" ]; then
    printf 'fail|Nessun backup in %s' "$DIR_BACKUP"
    return 0
  fi
  eta=$(( ( $(date +%s) - $(stat -c %Y "$ultimo") ) / 3600 ))
  file="$(basename "$ultimo")"
  if [ "$eta" -gt "$MAX_ORE_BACKUP" ]; then
    printf 'fail|ultimo %s ore fa (soglia %s) — %s' "$eta" "$MAX_ORE_BACKUP" "$file"
  else
    printf 'ok|ultimo %s ore fa (%s)' "$eta" "$file"
  fi
}

# 2. DISCO — riempirsi è l'unico guasto che ferma Postgres in un modo che sembra un
#    problema applicativo: gli errori che escono sono di scrittura, non «disco pieno».
controlla_disco() {
  local uso liberi
  uso="$(df -P / 2>/dev/null | awk 'NR==2 {gsub(/%/,"",$5); print $5}')"
  if [ -z "$uso" ]; then
    printf 'unknown|df non ha risposto'
    return 0
  fi
  liberi="$(df -Ph / 2>/dev/null | awk 'NR==2 {print $4}')"
  if [ "$uso" -ge "$SOGLIA_DISCO" ]; then
    printf 'fail|/ al %s%% (soglia %s%%), %s liberi' "$uso" "$SOGLIA_DISCO" "$liberi"
  else
    printf 'ok|/ al %s%%, %s liberi' "$uso" "$liberi"
  fi
}

# 3. MEMORIA E SWAP — `MemAvailable` e non `MemFree`: su Linux la seconda è quasi
#    sempre bassa perché il kernel usa la RAM libera come cache, e avviserebbe sempre.
#    `MemAvailable` è la stima di quanta se ne può davvero ottenere.
#    Lo swap è il segnale che precede il caso peggiore: quando si riempie, il kernel
#    comincia a uccidere processi — e il più grosso è il container di Postgres.
controlla_memoria() {
  local tot disp pct stot slib spct msg=""
  tot="$(awk '/^MemTotal:/     {print $2}' /proc/meminfo)"
  disp="$(awk '/^MemAvailable:/ {print $2}' /proc/meminfo)"
  if [ -z "$tot" ] || [ -z "$disp" ] || [ "$tot" -eq 0 ]; then
    printf 'unknown|/proc/meminfo non leggibile'
    return 0
  fi
  pct=$(( disp * 100 / tot ))

  stot="$(awk '/^SwapTotal:/ {print $2}' /proc/meminfo)"; stot="${stot:-0}"
  slib="$(awk '/^SwapFree:/  {print $2}' /proc/meminfo)"; slib="${slib:-0}"
  spct=0
  [ "$stot" -gt 0 ] && spct=$(( (stot - slib) * 100 / stot ))

  if [ "$pct" -lt "$SOGLIA_MEM" ]; then
    msg="disponibile ${pct}% (soglia ${SOGLIA_MEM}%)"
  fi
  # Lo swap si controlla SOLO se esiste. Questa macchina non ne ha (SwapTotal: 0) e
  # segnalarlo come guasto sarebbe un avviso che non può mai rientrare — non c'è nulla
  # da riparare, lo swap c'è o non c'è — e un allarme permanente è il modo più rapido
  # per far silenziare il monitor. Il fatto resta nel dettaglio e nel riepilogo.
  if [ "$stot" -gt 0 ] && [ "$spct" -ge "$SOGLIA_SWAP" ]; then
    msg="${msg:+$msg; }swap usato al ${spct}% (soglia ${SOGLIA_SWAP}%)"
  fi

  if [ -n "$msg" ]; then
    printf 'fail|%s' "$msg"
  elif [ "$stot" -eq 0 ]; then
    printf 'ok|disponibile %s%% (senza swap configurato)' "$pct"
  else
    printf 'ok|disponibile %s%%, swap al %s%%' "$pct" "$spct"
  fi
}

# 4. CONTAINER — i cinque di lunga durata. `migrate` e `rls` sono one-shot e restano
#    `Exited(0)`: cercarli qui darebbe un falso allarme a ogni giro.
controlla_container() {
  local attesi="bluman_postgres bluman_pgbouncer bluman_api bluman_nginx bluman_certbot"
  local giu="" c stato riavvii
  for c in $attesi; do
    stato="$(docker inspect -f '{{.State.Running}}' "$c" 2>/dev/null)"
    if [ "$stato" != "true" ]; then
      riavvii="$(docker inspect -f '{{.RestartCount}}' "$c" 2>/dev/null)"
      giu="${giu}${giu:+, }${c#bluman_} (riavvii: ${riavvii:-?})"
    fi
  done
  if [ -n "$giu" ]; then
    printf 'fail|non attivi: %s' "$giu"
  else
    printf 'ok|5 su 5 attivi'
  fi
}

# 5. API /health — il container può essere `Up` e l'app non rispondere. Il codice HTTP
#    distingue i due casi che contano: 200 con `db:ok`, oppure 503 quando il database
#    non risponde (src/server.ts). Non basta il 200: si controlla anche il corpo,
#    perché un 200 di rimbalzo dal proxy non è una risposta dell'API.
controlla_health() {
  local out codice corpo
  out="$(curl -sS --max-time 10 -w $'\n@@%{http_code}' "$HEALTH_URL" 2>/dev/null)"
  codice="${out##*@@}"
  corpo="${out%$'\n'@@*}"
  if [ -z "$codice" ]; then
    printf 'fail|nessuna risposta da %s' "$HEALTH_URL"
  elif [ "$codice" != "200" ]; then
    printf 'fail|%s ha risposto %s — %s' "$HEALTH_URL" "$codice" "$(printf '%s' "$corpo" | head -c 140)"
  elif ! printf '%s' "$corpo" | grep -q '"db"[: ]*"ok"'; then
    printf 'fail|200 ma il database non risulta ok — %s' "$(printf '%s' "$corpo" | head -c 140)"
  else
    printf 'ok|200, database ok'
  fi
}

# 6. AGGIORNAMENTI DI SISTEMA (una volta al giorno).
#    Il punto delicato è la FRESCHEZZA DELL'INDICE. `apt` legge un elenco scaricato da
#    `apt-get update`: se quell'elenco ha una settimana, il conteggio degli aggiornamenti
#    di sicurezza è zero perché *non sa* che esistono. Sarebbe un numero vero e una
#    conclusione falsa — il modo peggiore di sbagliare su un controllo di sicurezza.
#    Quindi prima si guarda l'età dell'indice; se è vecchio si risponde `unknown`.
controlla_apt() {
  local liste="/var/lib/apt/lists" eta out n_sic
  if [ ! -d "$liste" ]; then
    printf 'unknown|%s non esiste: impossibile contare gli aggiornamenti' "$liste"
    return 0
  fi
  eta=$(( ( $(date +%s) - $(stat -c %Y "$liste") ) / 3600 ))
  if [ "$eta" -gt "$MAX_ORE_LISTE_APT" ]; then
    printf 'unknown|indice apt vecchio di %s ore: serve "sudo apt-get update", il conteggio non sarebbe attendibile' "$eta"
    return 0
  fi
  # `|| true` per la ragione inversa del solito: `grep -c` stampa 0 ED esce con 1
  # quando non trova nulla. Senza il `|| true` l'assegnazione registrerebbe un
  # fallimento al posto di un risultato — «zero aggiornamenti» diventerebbe «rotto».
  out="$(apt-get -s -o Debug::NoLocking=1 dist-upgrade 2>/dev/null || true)"
  # La simulazione deve aver prodotto il suo riepilogo: se manca, apt non ha girato
  # (permessi, lock) e il conteggio che segue sarebbe 0 per la ragione sbagliata.
  if ! printf '%s' "$out" | grep -q 'upgraded,'; then
    printf 'unknown|apt-get non ha prodotto una simulazione leggibile (permessi o lock?)'
    return 0
  fi
  # Solo le righe `Inst` (i pacchetti che verrebbero davvero installati) e solo
  # quelle del ramo `-security`: contare la stringa ovunque pescherebbe anche le
  # righe di intestazione e gonfierebbe il numero.
  n_sic="$(printf '%s\n' "$out" | grep -c '^Inst.*-security' || true)"
  n_sic="${n_sic:-0}"
  if [ "$n_sic" -gt 0 ]; then
    printf 'fail|%s aggiornamenti di sicurezza in attesa (indice di %s ore fa)' "$n_sic" "$eta"
  else
    printf 'ok|nessun aggiornamento di sicurezza in attesa (indice di %s ore fa)' "$eta"
  fi
}

# 7. IMMAGINE POSTGRESQL (una volta al giorno).
#    Il database gira in un container: gli aggiornamenti di `apt` non lo toccano.
#    Si confronta il digest dell'immagine in uso con quello pubblicato sul registro.
#    Se il registro non risponde si dice `unknown`: non si può dichiarare «aggiornato»
#    un pezzo che non si è potuto confrontare.
controlla_postgres() {
  local locale remoto
  locale="$(docker image inspect postgres:17-alpine --format '{{index .RepoDigests 0}}' 2>/dev/null)"
  if [ -z "$locale" ]; then
    printf 'unknown|immagine postgres:17-alpine non presente in locale'
    return 0
  fi
  remoto="$(docker buildx imagetools inspect postgres:17-alpine --format '{{.Manifest.Digest}}' 2>/dev/null)"
  if [ -z "$remoto" ]; then
    printf 'unknown|registro Docker non raggiungibile: digest non confrontabile'
    return 0
  fi
  if [ "${locale##*@}" = "$remoto" ]; then
    printf 'ok|immagine allineata al registro'
  else
    printf 'fail|immagine locale superata: "docker compose pull postgres" e riavvio'
  fi
}

# ── STATO ────────────────────────────────────────────────────────────────────
# Se la directory non è scrivibile si prosegue lo stesso, ma con lo stato vuoto: ogni
# controllo fallito avviserebbe a ogni giro. È il verso giusto in cui sbagliare —
# rumoroso invece che silenzioso — e va detto nel log.
if ! mkdir -p "$STATO_DIR" 2>/dev/null || [ ! -w "$STATO_DIR" ]; then
  STATO_DIR=""
  riga "ATTENZIONE: la directory di stato non è scrivibile. Lo stato non viene ricordato:"
  riga "           ogni controllo fallito avviserà a OGNI esecuzione (una ogni 10 minuti)."
fi

leggi_stato() {
  [ -n "$STATO_DIR" ] && [ -f "$STATO_DIR/$1.state" ] && cat "$STATO_DIR/$1.state" 2>/dev/null
  return 0
}
scrivi_stato() {
  [ -n "$STATO_DIR" ] && printf '%s\n' "$2" > "$STATO_DIR/$1.state" 2>/dev/null
  return 0
}
# Vero se il controllo a bassa frequenza è scaduto (o non è mai stato eseguito).
cadenza_scaduta() {
  local stamp ore eta
  stamp="$STATO_DIR/$1.ultima"; ore="$2"
  [ -z "$STATO_DIR" ] && return 0
  [ -f "$stamp" ] || return 0
  eta=$(( ( $(date +%s) - $(stat -c %Y "$stamp") ) / 3600 ))
  [ "$eta" -ge "$ore" ]
}

# ── TELEGRAM ─────────────────────────────────────────────────────────────────
invia_telegram() {
  local testo="$1" codice
  if [ -z "$BLUMAN_AVVISI_BOT_TOKEN" ] || [ -z "$BLUMAN_AVVISI_CHAT_ID" ]; then
    riga "AVVISO NON INVIATO: BLUMAN_AVVISI_BOT_TOKEN o BLUMAN_AVVISI_CHAT_ID mancano in $CONF."
    riga "Testo che sarebbe stato inviato:"
    riga "$testo"
    return 1
  fi
  # stderr soppresso: `curl` ci stampa l'URL, e l'URL contiene il token.
  codice="$(curl -sS --max-time 15 -o /dev/null -w '%{http_code}' \
      --data-urlencode "chat_id=${BLUMAN_AVVISI_CHAT_ID}" \
      --data-urlencode "text=${testo}" \
      "https://api.telegram.org/bot${BLUMAN_AVVISI_BOT_TOKEN}/sendMessage" 2>/dev/null)" || codice="000"
  [ "$codice" = "200" ] && return 0
  # 401 = token sbagliato; 400 = chat_id sbagliato (quasi sempre: il bot non è mai
  # stato avviato in quella chat, quindi la chat non esiste per lui). Sono i due
  # errori del primo montaggio, e vanno detti perché il codice da solo non li spiega.
  riga "INVIO TELEGRAM FALLITO (http $codice)."
  [ "$codice" = "401" ] && riga "  401 = token non valido: ricontrolla BLUMAN_AVVISI_BOT_TOKEN."
  [ "$codice" = "400" ] && riga "  400 = chat non raggiungibile: apri Telegram, cerca il bot e scrivigli /start."
  riga "Testo che sarebbe stato inviato:"
  riga "$testo"
  return 1
}

# ── RIEPILOGO ────────────────────────────────────────────────────────────────
riepilogo() {
  local sintesi="$1" corpo
  corpo="📋 BLUMAN VPS — riepilogo giornaliero
$(date -u '+%d/%m/%Y %H:%M UTC')

${sintesi}

Disco: $(df -Ph / 2>/dev/null | awk 'NR==2 {print $3" usati su "$2" ("$5")"}')
Memoria: $(awk '/^MemTotal:/ {t=$2} /^MemAvailable:/ {a=$2} END {if (t) printf "%.1fGi totali, %.1fGi disponibili", t/1048576, a/1048576}' /proc/meminfo)
Container: $(docker ps -q --filter 'name=bluman_' 2>/dev/null | wc -l) attivi
Uptime: $(uptime -p 2>/dev/null | sed 's/^up //')"
  invia_telegram "$corpo"
}

# ── GIRO COMPLETO ────────────────────────────────────────────────────────────
giro() {
  local ignora_stato="${1:-}" forza_riepilogo="${2:-}"
  local nuovi=() rientri=() righe=() sintesi=""
  local chiave esito stato dettaglio precedente cadenza voce

  riga "── giro $(adesso) ──"

  for chiave in "${CHIAVI[@]}"; do
    cadenza="$(cadenza_di "$chiave")"
    if [ "$cadenza" -gt 0 ] && ! cadenza_scaduta "$chiave" "$cadenza"; then
      # Non è ora di rieseguirlo: si conserva lo stato precedente senza toccarlo.
      precedente="$(leggi_stato "$chiave")"
      voce="${ETICHETTE[$chiave]}: ${precedente:-sconosciuto} (non rieseguito)"
      righe+=("  ${chiave}: ${precedente:-?} (non rieseguito)")
      case "$precedente" in
        ok)      sintesi="${sintesi}✅ ${voce}"$'\n' ;;
        fail)    sintesi="${sintesi}🔴 ${voce}"$'\n' ;;
        unknown) sintesi="${sintesi}⚠️ ${voce}"$'\n' ;;
        *)       sintesi="${sintesi}❔ ${voce}"$'\n' ;;
      esac
      continue
    fi

    esito="$(esegui_controllo "$chiave")"
    # Un controllo che si rompe non deve poter diventare un «ok»: senza esito si
    # risponde `unknown`, che è silenzioso ma visibile nel riepilogo.
    [ -n "$esito" ] || esito="unknown|il controllo non ha prodotto alcun esito"
    stato="${esito%%|*}"; dettaglio="${esito#*|}"
    case "$stato" in
      ok|fail|unknown) ;;
      *) stato="unknown"; dettaglio="stato non riconosciuto: $esito" ;;
    esac

    if [ "$cadenza" -gt 0 ] && [ -n "$STATO_DIR" ]; then
      touch "$STATO_DIR/$chiave.ultima" 2>/dev/null
    fi

    precedente="$(leggi_stato "$chiave")"
    [ "$ignora_stato" = "1" ] && precedente=""

    if [ "$stato" = "fail" ] && [ "$precedente" != "fail" ]; then
      nuovi+=("• ${ETICHETTE[$chiave]}: $dettaglio")
    elif [ "$stato" = "ok" ] && [ "$precedente" = "fail" ]; then
      rientri+=("• ${ETICHETTE[$chiave]}: $dettaglio")
    fi

    scrivi_stato "$chiave" "$stato"
    voce="${ETICHETTE[$chiave]}: ${dettaglio}"
    righe+=("  ${chiave}: ${stato} — ${dettaglio}")
    case "$stato" in
      ok)      sintesi="${sintesi}✅ ${voce}"$'\n' ;;
      fail)    sintesi="${sintesi}🔴 ${voce}"$'\n' ;;
      unknown) sintesi="${sintesi}⚠️ ${voce}"$'\n' ;;
    esac
  done

  [ ${#righe[@]} -gt 0 ] && printf '%s\n' "${righe[@]}"

  # Un solo messaggio per giro, non uno per controllo: se il server è andato giù,
  # cinque controlli falliscono insieme per lo stesso motivo e devono leggersi come
  # una notizia sola, non come cinque.
  # `sep` invece di costruire il separatore dentro l'interpolazione: `${testo:+$'\n'}`
  # non è ANSI-C quoting dentro le graffe e produrrebbe un backslash-n letterale.
  local testo="" sep=""
  if [ ${#nuovi[@]} -gt 0 ]; then
    testo="🔴 BLUMAN VPS — problemi rilevati
$(date -u '+%d/%m/%Y %H:%M UTC')

$(elenco "${nuovi[@]}")"
    sep=$'\n\n────────────────────\n'
  fi
  if [ ${#rientri[@]} -gt 0 ]; then
    testo="${testo}${sep}🟢 Rientrato

$(elenco "${rientri[@]}")"
  fi
  [ -n "$testo" ] && invia_telegram "$testo"

  # Il riepilogo va mandato SEMPRE, anche quando va tutto bene: è l'unico segnale che
  # distingue «nessun guasto» da «il monitor non gira più».
  if [ "$forza_riepilogo" = "riepilogo" ] || [ "$(date -u +%-H)" = "$ORA_RIEPILOGO" ]; then
    riepilogo "$sintesi"
  fi
}

# ── AVVIO ────────────────────────────────────────────────────────────────────
# `flock` evita che due giri si sovrappongano se un controllo lento (il registro
# Docker) sfora i 10 minuti: due processi che scrivono lo stesso stato vedrebbero un
# «cambiamento» che non c'è, e arriverebbe un avviso falso.
if command -v flock >/dev/null 2>&1; then
  exec 9>/tmp/bluman-monitor.lock
  if ! flock -n 9; then
    riga "un'altra esecuzione è in corso: salto questo giro."
    exit 0
  fi
fi

case "${1:-}" in
  --prova)
    if invia_telegram "✅ BLUMAN VPS — messaggio di prova
$(date -u '+%d/%m/%Y %H:%M UTC')

Se leggi questo, bot e chat sono configurati bene. Da qui in poi arrivano solo gli
avvisi di cambiamento, più un riepilogo al giorno alle ${ORA_RIEPILOGO}:00 UTC."; then
      riga "Messaggio di prova inviato."
    else
      riga "Messaggio di prova NON inviato: vedi le due cause probabili qui sopra."
      exit 1
    fi
    ;;
  --riepilogo)    giro "" "riepilogo" ;;
  --ignora-stato) giro "1" ;;
  *)              giro "" ;;
esac
