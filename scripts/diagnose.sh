#!/usr/bin/env bash
# diagnose.sh [righe]  — fotografia della produzione del progetto su QUESTO server.
# Script COMUNE, identico in ogni progetto.
# Solo lettura. Lo lancia .github/workflows/diagnose.yml sul runner del server.
# Usa lo script del repo come sta sul server, cioè dell'ultimo deploy: un
# diagnose.sh cambiato in una PR vale solo dopo il suo deploy.
set -uo pipefail
REPO_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
# shellcheck disable=SC1091
source "$REPO_DIR/scripts/deploy.env"
RIGHE="${1:-200}"
[[ "$RIGHE" =~ ^[0-9]+$ ]] || RIGHE=200
(( RIGHE > 2000 )) && RIGHE=2000

# Toglie dal testo ciò che somiglia a un segreto: chiave=valore, Bearer, URL con
# utente:password, token di Telegram, chiavi di 32+ caratteri esadecimali.
pulisci() {
  sed -E \
    -e 's/((Bearer|Basic)[[:space:]]+)[A-Za-z0-9._~+\/=-]+/\1***/Ig' \
    -e 's/((password|passwd|secret|token|apikey|api_key|adminkey|authorization|cookie|key)["'"'"']?[[:space:]]*[:=][[:space:]]*["'"'"']?)[^"'"'"'[:space:],}]+/\1***/Ig' \
    -e 's#(://)[^/@[:space:]]+:[^/@[:space:]]+@#\1***:***@#g' \
    -e 's/[0-9]{8,10}:[A-Za-z0-9_-]{30,}/***telegram***/g' \
    -e 's/\b[0-9a-fA-F]{32,}\b/***/g'
}
titolo() { printf '\n===== %s =====\n' "$*"; }

titolo "Server $(hostname) · $(date -Is)"
titolo "Codice in produzione"
git -C "$REPO_DIR" log --oneline -1
echo "ultimi deploy: $(git -C "$REPO_DIR" tag -l 'deploy/*' | sort | tail -n 3 | tr '\n' ' ')"

titolo "Processo pm2 $PM2_NAME"
pm2 describe "$PM2_NAME" 2>&1 | grep -E 'status|uptime|restarts|memory|cpu|unstable|exec mode|created at' | pulisci

titolo "Health http://127.0.0.1:$PORT$HEALTH_PATH"
curl -sS --max-time 10 "http://127.0.0.1:$PORT$HEALTH_PATH" 2>&1 | head -c 2000 | pulisci; echo

titolo "Disco e memoria"
df -h / | tail -n 1
free -h | head -n 2

titolo "Ultime $RIGHE righe di log di $PM2_NAME"
pm2 logs "$PM2_NAME" --lines "$RIGHE" --nostream --raw 2>&1 | pulisci

titolo "Fine"
exit 0
