#!/usr/bin/env bash
# setup-github.sh <owner/repo> <ramo-di-produzione>
# Prepara il repo su GitHub per il pilota automatico (METODO.md §7). Idempotente.
# Si lancia dal PC con `gh` autenticato come proprietario del repo.
#   - etichette di esito: review-ok, review-da-correggere, serve-fabio, ok-fabio
#   - ramo predefinito = ramo di produzione (serve a review.yml)
#   - cancellazione automatica dei rami dopo il merge, merge squash ammesso
# Non crea il secret CLAUDE_CODE_OAUTH_TOKEN: lo stampa come ultimo passo.
set -Eeuo pipefail
REPO="$1"; PROD="$2"

label() {
  gh api -X POST "repos/$REPO/labels" -f name="$1" -f color="$2" -f description="$3" >/dev/null 2>&1 \
    || gh api -X PATCH "repos/$REPO/labels/$1" -f color="$2" -f description="$3" >/dev/null
  echo "etichetta $1"
}
label review-ok            2e6b12 "Revisione automatica: nessun problema"
label review-da-correggere a32d2d "Revisione automatica: l'autore deve correggere"
label serve-fabio          ba7517 "Serve una decisione di Fabio"
label ok-fabio             185fa5 "Via libera di Fabio: merge e deploy"

gh api -X PATCH "repos/$REPO" \
  -f default_branch="$PROD" \
  -F delete_branch_on_merge=true \
  -F allow_squash_merge=true >/dev/null
echo "ramo predefinito: $PROD · rami cancellati dopo il merge"

if gh secret list -R "$REPO" | grep -q '^CLAUDE_CODE_OAUTH_TOKEN'; then
  echo "secret CLAUDE_CODE_OAUTH_TOKEN: presente"
else
  echo "MANCA il secret CLAUDE_CODE_OAUTH_TOKEN:"
  echo "  claude setup-token          # copia il token sk-ant-oat..."
  echo "  gh secret set CLAUDE_CODE_OAUTH_TOKEN -R $REPO"
fi
for sec in CI_TELEGRAM_TOKEN CI_TELEGRAM_CHAT; do
  gh secret list -R "$REPO" | grep -q "^$sec" && echo "secret $sec: presente" \
    || echo "manca $sec (avvisi Telegram): gh secret set $sec -R $REPO"
done
