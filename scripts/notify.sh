#!/usr/bin/env bash
# notify.sh "<titolo>" "<success|failure|cancelled>" "<sha>"
# Manda una riga su Telegram. Token e chat: i secret del repo passati dal workflow
# (CI_TELEGRAM_TOKEN, CI_TELEGRAM_CHAT), altrimenti deploy.env (TELEGRAM_BOT_TOKEN,
# TELEGRAM_CHAT_ID). Senza token non fa niente e non fallisce.
set -u
# REPO_DIR dall'ambiente quando gira da una copia (deploy.yml la prende prima del deploy).
REPO_DIR="${REPO_DIR:-$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)}"
# shellcheck disable=SC1091
source "$REPO_DIR/scripts/deploy.env" 2>/dev/null || true
TELEGRAM_BOT_TOKEN="${CI_TELEGRAM_TOKEN:-${TELEGRAM_BOT_TOKEN:-}}"
TELEGRAM_CHAT_ID="${CI_TELEGRAM_CHAT:-${TELEGRAM_CHAT_ID:-}}"
[[ -n "$TELEGRAM_BOT_TOKEN" && -n "$TELEGRAM_CHAT_ID" ]] || exit 0
TITLE="$1"; STATUS="$2"; SHA="${3:0:7}"
case "$STATUS" in
  success) ICON="✅";;
  failure) ICON="❌";;
  *) ICON="⚠️";;
esac
MSG="$ICON deploy $TITLE · $SHA · $STATUS"
NOTA="/tmp/deploy-nota-${PM2_NAME:-}"
if [[ -n "${PM2_NAME:-}" && -s "$NOTA" ]]; then MSG="$MSG
$(cat "$NOTA")"; fi
rm -f "$NOTA" 2>/dev/null || true
curl -fsS --max-time 10 "https://api.telegram.org/bot$TELEGRAM_BOT_TOKEN/sendMessage" \
  -d chat_id="$TELEGRAM_CHAT_ID" --data-urlencode text="$MSG" >/dev/null || true
