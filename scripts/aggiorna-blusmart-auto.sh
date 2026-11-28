#!/usr/bin/env bash
#
# aggiorna-blusmart-auto.sh — blusmart.eu si aggiorna da solo dopo ogni pubblicazione.
#
# Gira SUL SERVER dal cron dell'utente `bluman`, ogni 10 minuti (lo mette
# `scripts/installa-aggiornamento-automatico.sh`). A ogni giro:
#
#   1. legge `main` di `origin` (= mariobros1987/bluman, pubblico: niente chiavi, niente token);
#   2. se è la versione già in servizio (`.git/bluman-ultimo-aggiornamento`) non fa niente, zitto;
#   3. altrimenti porta i file su disco a quella versione (`git merge --ff-only`) e lancia
#      `scripts/aggiorna-blusmart.sh --applica`: copia del database, frontend, migrate, rls,
#      container, nginx, sonde. È lo stesso aggiornamento che Fabio lancia a mano via ssh;
#   4. scrive l'inizio e l'esito sul bot degli avvisi del server (`/etc/bluman/monitor.env`,
#      lo stesso di `monitor-vps.sh`).
#
# Quando NON aggiorna (e lo dice una volta sola):
#   - c'è il file `.git/bluman-auto-pausa` (si mette e si toglie a mano, vedi DEPLOY.md);
#   - il repo sul server non è sul ramo `main` (per esempio durante un ritorno a una versione
#     precedente: l'aggiornamento automatico la ricoprirebbe);
#   - sul server ci sono file del repo modificati a mano, o `main` di GitHub non discende da
#     quello su disco (qualcuno ha riscritto la storia): servono occhi, non un automatismo;
#   - quella stessa versione è già stata tentata ed è fallita: non si riprova ogni 10 minuti
#     (ogni tentativo fa una copia e ricostruisce le immagini). Riparte con la versione dopo,
#     o con `aggiorna-blusmart.sh --applica` lanciato a mano.
#
# Opzioni: `--prova` dice cosa farebbe e non tocca niente (nemmeno il file dell'ultimo avviso).
#
# Tutto il corpo sta in una funzione: bash la legge intera prima di eseguirla, quindi il
# `git merge` che sostituisce questo file a metà giro non cambia il codice che sta girando.
set -uo pipefail

principale() {
  local PROVA=no
  for a in "$@"; do
    case "$a" in
      --prova) PROVA=si ;;
      *) echo "argomento sconosciuto: $a (ammesso: --prova)" >&2; return 2 ;;
    esac
  done

  export PATH="/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin"
  export GIT_TERMINAL_PROMPT=0
  cd "${BLUMAN_DIR:-$(cd "$(dirname "$0")/.." && pwd)}" || return 1

  local CONF="${BLUMAN_MONITOR_CONF:-/etc/bluman/monitor.env}"
  local FILE_ULTIMO=".git/bluman-ultimo-aggiornamento"
  local FILE_TENTATO=".git/bluman-auto-tentato"
  local FILE_AVVISO=".git/bluman-auto-ultimo-avviso"
  local FILE_PAUSA=".git/bluman-auto-pausa"
  local DIR_LOG=/var/log/bluman
  [ -w "$DIR_LOG" ] || DIR_LOG=/tmp

  # Un giro alla volta: un aggiornamento dura più di 10 minuti quando ricostruisce le immagini.
  exec 9>".git/bluman-auto.lock" || return 1
  flock -n 9 || { riga "un altro giro è ancora in corso: salto"; return 0; }

  if [ -r "$CONF" ]; then
    set -a
    # shellcheck disable=SC1090
    . "$CONF"
    set +a
  fi

  # Un avviso che si ripeterebbe uguale a ogni giro (pausa, file modificati, GitHub che non
  # risponde) si manda una volta: il testo si ricorda, e torna a valere quando cambia.
  avvisa_una_volta() {
    local testo="$1"
    riga "$testo"
    [ "$(cat "$FILE_AVVISO" 2>/dev/null)" = "$testo" ] && return 0
    [ "$PROVA" = si ] && return 0
    invia_telegram "$testo" && printf '%s' "$testo" > "$FILE_AVVISO"
  }

  local ora; ora="$(date -u '+%Y-%m-%dT%H:%M:%SZ')"
  riga "== $ora"

  if [ -e "$FILE_PAUSA" ]; then
    avvisa_una_volta "⏸️ blusmart.eu: aggiornamento automatico in pausa (c'è $FILE_PAUSA sul server)."
    return 0
  fi

  local ok_fetch=no
  for n in 1 2 3; do
    if git fetch --quiet origin main </dev/null; then ok_fetch=si; break; fi
    sleep $((n * 10))
  done
  if [ "$ok_fetch" != si ]; then
    avvisa_una_volta "⚠️ blusmart.eu: non riesco a leggere main da GitHub, l'aggiornamento automatico aspetta."
    return 1
  fi

  local REMOTO IN_SERVIZIO SU_DISCO RAMO
  REMOTO="$(git rev-parse origin/main)"
  IN_SERVIZIO="$(cat "$FILE_ULTIMO" 2>/dev/null || true)"
  SU_DISCO="$(git rev-parse HEAD)"
  RAMO="$(git symbolic-ref --quiet --short HEAD || true)"

  if [ -z "$IN_SERVIZIO" ]; then
    # «Non lo so» non è «è vecchia»: senza sapere cosa è in servizio non si decide da soli.
    avvisa_una_volta "⚠️ blusmart.eu: non so quale versione è in servizio ($FILE_ULTIMO manca): il primo aggiornamento va lanciato a mano con aggiorna-blusmart.sh --applica."
    return 1
  fi
  if [ "$REMOTO" = "$IN_SERVIZIO" ]; then
    riga "in servizio c'è già ${REMOTO:0:8}: niente da fare"
    rm -f "$FILE_AVVISO"
    return 0
  fi
  if [ "$RAMO" != main ]; then
    avvisa_una_volta "⏸️ blusmart.eu: il repo sul server non è su main (${RAMO:-nessun ramo, ${SU_DISCO:0:8}}), forse è un ritorno a una versione di prima: non aggiorno da solo. Per ripartire: git checkout main."
    return 0
  fi
  if [ -n "$(git status --porcelain --untracked-files=no)" ]; then
    avvisa_una_volta "⚠️ blusmart.eu: sul server ci sono file del repo modificati a mano, non aggiorno da solo. Vanno capiti prima (git status in /opt/bluman)."
    return 1
  fi
  if ! git merge-base --is-ancestor "$SU_DISCO" "$REMOTO"; then
    avvisa_una_volta "⚠️ blusmart.eu: main di GitHub (${REMOTO:0:8}) non discende dalla versione sul server (${SU_DISCO:0:8}), non aggiorno da solo."
    return 1
  fi
  if [ "$(cat "$FILE_TENTATO" 2>/dev/null)" = "$REMOTO" ]; then
    riga "${REMOTO:0:8} è già stata tentata ed è fallita: aspetto una versione nuova o un --applica a mano"
    return 0
  fi

  local DESCR; DESCR="$(git log -1 --format='%h %s' "$REMOTO")"
  if [ "$PROVA" = si ]; then
    riga "PROVA: aggiornerei da ${IN_SERVIZIO:0:8} a $DESCR (niente è cambiato)"
    return 0
  fi

  printf '%s' "$REMOTO" > "$FILE_TENTATO"
  git merge --quiet --ff-only "$REMOTO" </dev/null || {
    avvisa_una_volta "⚠️ blusmart.eu: git merge --ff-only non è riuscito su ${REMOTO:0:8}, non aggiorno."
    return 1
  }

  local LOG="$DIR_LOG/aggiorna-auto-$(date +%Y%m%d_%H%M%S).log"
  invia_telegram "🔄 blusmart.eu: aggiornamento automatico partito, verso $DESCR. Prima fa la copia del database; per qualche minuto il sito può non rispondere. Log sul server: $LOG"
  riga "aggiorno a $DESCR, log in $LOG"

  # BLUMAN_STACCATO=1: dal cron non c'è nessun terminale da cui staccarsi; si aspetta l'esito.
  if BLUMAN_STACCATO=1 bash ./scripts/aggiorna-blusmart.sh --applica > "$LOG" 2>&1 </dev/null; then
    rm -f "$FILE_AVVISO"
    invia_telegram "✅ blusmart.eu aggiornato: in servizio $DESCR. Copia del database fatta prima, sonde verdi."
    riga "fatto"
    return 0
  fi
  # Solo la riga ERRORE dello script (scritta da lui, senza segreti), non il log intero.
  local MOTIVO; MOTIVO="$(grep -m1 '^ERRORE:' "$LOG" | cut -c1-300)"
  invia_telegram "🔴 blusmart.eu: aggiornamento automatico verso $DESCR NON riuscito. ${MOTIVO:-Nessuna riga ERRORE: vedi il log.} Log sul server: $LOG. Non riprovo questa versione da solo; la copia del database fatta prima è in /var/backups/bluman."
  riga "fallito: ${MOTIVO:-vedi $LOG}"
  return 1
}

riga() { printf '%s\n' "$*"; }

# Come in monitor-vps.sh: testo semplice, stderr di curl soppresso (l'URL contiene il token).
invia_telegram() {
  local testo="$1" codice
  if [ -z "${BLUMAN_AVVISI_BOT_TOKEN:-}" ] || [ -z "${BLUMAN_AVVISI_CHAT_ID:-}" ]; then
    riga "AVVISO NON INVIATO (manca il bot degli avvisi in /etc/bluman/monitor.env): $testo"
    return 1
  fi
  codice="$(curl -sS --max-time 15 -o /dev/null -w '%{http_code}' \
      --data-urlencode "chat_id=${BLUMAN_AVVISI_CHAT_ID}" \
      --data-urlencode "text=${testo}" \
      "https://api.telegram.org/bot${BLUMAN_AVVISI_BOT_TOKEN}/sendMessage" 2>/dev/null)" || codice="000"
  [ "$codice" = "200" ] && return 0
  riga "INVIO TELEGRAM FALLITO (http $codice): $testo"
  return 1
}

principale "$@"
exit $?
