#!/usr/bin/env bash
# ci-notify.sh "<testo>"
# Manda una riga su Telegram dai workflow GitHub (revisione, merge, correzioni).
# Token e chat dai secret del repo, passati come env: CI_TELEGRAM_TOKEN, CI_TELEGRAM_CHAT.
# Senza secret non fa niente e non fallisce: un avviso mancato non ferma il lavoro.
# Il testo lo costruiscono i chiamanti da campi strutturati (numero e titolo della
# PR, link): mai log, mai login MT5, mai host di proxy.
set -u
[[ -n "${CI_TELEGRAM_TOKEN:-}" && -n "${CI_TELEGRAM_CHAT:-}" ]] || exit 0
curl -fsS --max-time 10 "https://api.telegram.org/bot$CI_TELEGRAM_TOKEN/sendMessage" \
  -d chat_id="$CI_TELEGRAM_CHAT" -d disable_web_page_preview=true \
  --data-urlencode text="$1" >/dev/null 2>&1 || true
