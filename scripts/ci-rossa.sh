#!/usr/bin/env bash
# ci-rossa.sh <numero-pr> <id-del-run-ci>
# Le prove di una PR sono rosse: nessuna PR resta ferma in silenzio (Fabio, 10/11:
# «non voglio più che si blocchi»). Gira in automerge.yml (versione di
# produzione) quando ci.yml finisce in failure, con GH_TOKEN e GH_REPO.
#   - fino a MAX_GIRI volte: lancia il correttore (fix.yml, motivo=prove), che
#     legge i log del run, corregge sullo stesso ramo o, se il codice non c'entra
#     (rete, runner, tempo scaduto), rilancia le sole parti fallite;
#   - oltre: serve-fabio e avviso Telegram.
# Giri contati dai commenti «**Correzione delle prove — giro N**», che scrive fix.yml.
set -Eeuo pipefail
PR="$1"; RUN="$2"
MAX_GIRI=2
# shellcheck disable=SC1091
[[ -f scripts/progetto.env ]] && source scripts/progetto.env
NOME="${NOME_PROGETTO:-${GH_REPO##*/}}"
log() { printf '[ci-rossa #%s] %s\n' "$PR" "$*"; }

pr="$(gh api "repos/$GH_REPO/pulls/$PR")"
[[ "$(jq -r .state <<<"$pr")" == open ]] || { log "PR non aperta"; exit 0; }
# Solo il run del commit di testa: uno vecchio è superato dal commit nuovo.
testa="$(jq -r .head.sha <<<"$pr")"
run_sha="$(gh api "repos/$GH_REPO/actions/runs/$RUN" --jq .head_sha)"
[[ "$run_sha" == "$testa" ]] || { log "run di ${run_sha:0:7}, la PR è a ${testa:0:7}: niente"; exit 0; }
prod="$(jq -r .base.ref <<<"$pr")"

giri="$(gh api --paginate "repos/$GH_REPO/issues/$PR/comments" --jq \
  '[.[] | select(.user.type == "Bot" and (.body | startswith("**Correzione delle prove")))] | length' \
  | awk '{s+=$1} END {print s+0}')"
if (( giri < MAX_GIRI )); then
  log "prove rosse: correttore, giro $((giri + 1)) di $MAX_GIRI"
  gh workflow run fix.yml --ref "$prod" -f pr="$PR" -f motivo=prove -f run="$RUN"
  exit 0
fi
labels="$(jq -r '[.labels[].name] | join(",")' <<<"$pr")"
[[ ",$labels," == *",serve-fabio,"* ]] && { log "già serve-fabio"; exit 0; }
log "prove ancora rosse dopo $giri correzioni: serve-fabio"
gh api -X POST "repos/$GH_REPO/issues/$PR/labels" -f "labels[]=serve-fabio" >/dev/null
gh pr comment "$PR" --body "**Ferma: prove ancora rosse dopo $giri correzioni automatiche.** Run: $(gh api "repos/$GH_REPO/actions/runs/$RUN" --jq .html_url). Una correzione (anche chiesta a Claude Code su questa PR) fa ripartire tutto con un commit nuovo." >/dev/null
bash scripts/ci-notify.sh "🔴 $NOME: prove rosse anche dopo le correzioni automatiche
#$PR $(jq -r .title <<<"$pr")
$(jq -r .html_url <<<"$pr")"
