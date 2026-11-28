#!/usr/bin/env bash
# ci-rossa.sh <numero-pr> <id-del-run-ci>
# Le prove di una PR sono rosse: nessuna PR resta ferma in silenzio (Fabio, 10/11:
# «non voglio più che si blocchi»). Gira in automerge.yml (versione di
# produzione) quando ci.yml finisce in failure, con GH_TOKEN e GH_REPO.
#   - fino a MAX_GIRI volte: lancia il correttore (fix.yml, motivo=prove), che
#     legge i log del run, corregge sullo stesso ramo o, se il codice non c'entra
#     (rete, runner, tempo scaduto), rilancia le sole parti fallite;
#   - oltre: serve-fabio e avviso Telegram.
#   - ramo di un thread (dal 27/11, ramo_thread): niente fix.yml, corregge il thread; qui si contano
#     i giri e oltre MAX_GIRI serve-fabio.
# Giri contati dai commenti «**Correzione delle prove — giro N**», che scrive fix.yml.
set -Eeuo pipefail
PR="$1"; RUN="$2"
MAX_GIRI=2
# shellcheck disable=SC1091
[[ -f scripts/progetto.env ]] && source scripts/progetto.env
NOME="${NOME_PROGETTO:-${GH_REPO##*/}}"
# Rami dei thread dei Projects di Claude Code (00-metodo, punto 10): quello che dà
# Claude Code (claude/project-thread-…) o thread/…. Lì il correttore è il thread.
ramo_thread() { [[ "$1" == thread/* || "$1" == claude/project-thread-* ]]; }
log() { printf '[ci-rossa #%s] %s\n' "$PR" "$*"; }

pr="$(gh api "repos/$GH_REPO/pulls/$PR")"
[[ "$(jq -r .state <<<"$pr")" == open ]] || { log "PR non aperta"; exit 0; }
# Solo il run del commit di testa: uno vecchio è superato dal commit nuovo.
testa="$(jq -r .head.sha <<<"$pr")"
run_sha="$(gh api "repos/$GH_REPO/actions/runs/$RUN" --jq .head_sha)"
[[ "$run_sha" == "$testa" ]] || { log "run di ${run_sha:0:7}, la PR è a ${testa:0:7}: niente"; exit 0; }
prod="$(jq -r .base.ref <<<"$pr")"
ramo="$(jq -r .head.ref <<<"$pr")"
conta() { gh api --paginate "repos/$GH_REPO/issues/$PR/comments" --jq \
  "[.[] | select(.user.type == \"Bot\" and (.body | startswith(\"**Correzione delle prove\")) and (.body | contains(\"$1\")))] | length" \
  | awk '{s+=$1} END {print s+0}'; }

# Ramo di un thread (Projects di Claude Code, dal 27/11): le prove le corregge il thread
# che ha scritto la PR e la segue, non fix.yml (due correttori sullo stesso ramo si
# scriverebbero addosso). Qui si conta il giro con un commento, uno per run (lo script
# lo chiamano sia automerge.yml sia la sentinella), e oltre MAX_GIRI serve-fabio. Se
# il thread non manda un commit, se ne accorge la sentinella (ATTESA_THREAD).
if ramo_thread "$ramo"; then
  (( $(conta "(run $RUN)") == 0 )) || { log "run $RUN già segnalato al thread"; exit 0; }
  giri="$(conta "— thread")"
  if (( giri < MAX_GIRI )); then
    log "ramo di un thread: corregge il thread, giro $((giri + 1)) di $MAX_GIRI"
    gh pr comment "$PR" --body "**Correzione delle prove — thread, giro $((giri + 1)) di $MAX_GIRI (run $RUN)**
Prove rosse: le corregge il thread che ha scritto questa PR, sullo stesso ramo. Se non arriva un commit nuovo, la sentinella mette serve-fabio." >/dev/null
    exit 0
  fi
else
  giri="$(conta "")"
fi
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
