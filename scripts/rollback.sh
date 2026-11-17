#!/usr/bin/env bash
# rollback.sh            elenca gli ultimi deploy
# rollback.sh <tag|sha>  torna a quel deploy (passa da deploy.sh: backup, health)
set -Eeuo pipefail
REPO_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$REPO_DIR"
if [[ -z "${1:-}" ]]; then
  git tag -l 'deploy/*' --sort=-creatordate | head -n 15 | while read -r t; do
    printf '%s  %s  %s\n' "$t" "$(git rev-parse --short "$t")" "$(git log -1 --format=%s "$t")"
  done
  exit 0
fi
exec bash "$REPO_DIR/scripts/deploy.sh" "$1"
