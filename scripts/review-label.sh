#!/usr/bin/env bash
# review-label.sh <numero-pr> <inizio-revisione-ISO8601> [livello]
# Mette l'etichetta di esito leggendola dal commento del revisore, poi prova il merge.
# Livello «leggero» (scripts/livello.sh, calcolato in review.yml con i file di
# produzione): il revisore non gira e l'esito è review-ok, con un commento che lo
# dice (Fabio, 10/11). Ogni altro livello, o livello vuoto: il commento del revisore.
# Gira nel job `etichetta` di review.yml (pull_request_target: versione di
# produzione) dopo il revisore, con GH_TOKEN e GH_REPO impostati.
#
# Perché uno script e non `gh pr edit` dentro il revisore: il 03/11 (PR #5) il
# revisore ha scritto il commento ma l'etichetta non è arrivata
# (permission_denials_count 2). L'etichetta è una regola fissa, non un giudizio:
# la mette uno script, sempre allo stesso modo.
#
# Dopo l'etichetta:
#   serve-fabio          → avviso Telegram (ci-notify.sh)
#   review-da-correggere → lancia il correttore (fix.yml), al massimo MAX_GIRI volte
#                          per PR; oltre, serve-fabio e avviso
#
# Il commento valido è l'ultimo di un bot, scritto dopo l'inizio di QUESTA
# revisione, che comincia con «**Revisione automatica — <esito>**».
# Nessun commento valido = la revisione non c'è stata: serve-fabio, mai review-ok.
set -Eeuo pipefail
PR="$1"; SINCE="$2"; LIVELLO="${3:-}"
MAX_GIRI=2
# Script COMUNE, identico in ogni progetto. Il nome negli avvisi viene da
# scripts/progetto.env: lo script gira nel checkout del ramo di produzione, mai
# in quello della PR.
# shellcheck disable=SC1091
[[ -f scripts/progetto.env ]] && source scripts/progetto.env
NOME="${NOME_PROGETTO:-${GH_REPO##*/}}"
log() { printf '[review-label #%s] %s\n' "$PR" "$*"; }

if [[ "$LIVELLO" == leggero ]]; then
  esito=review-ok
  log "livello leggero: niente revisore, $esito"
  gh pr comment "$PR" --body "**Revisione automatica — review-ok**
Livello leggero (\`scripts/livello.sh\`, \`.github/livelli.txt\` di produzione): solo documenti o file che non portano regole. Niente revisore; build e typecheck li fa la CI." >/dev/null
else
  esito="$(gh api --paginate "repos/$GH_REPO/issues/$PR/comments" --jq \
    ".[] | select(.user.type == \"Bot\" and .created_at >= \"$SINCE\") | .body" \
    | grep -oE '^\*\*Revisione automatica — (review-ok|review-da-correggere|serve-fabio)\*\*' \
    | tail -n1 | sed -E 's/.*— ([a-z-]+)\*\*$/\1/' || true)"

  if [[ -z "$esito" ]]; then
    esito=serve-fabio
    log "nessun commento del revisore dopo $SINCE: $esito"
    gh pr comment "$PR" --body "**Revisione automatica — serve-fabio**
La revisione non ha lasciato un esito leggibile (job fallito, saltato o commento senza intestazione). Guarda il run di \`review\` in Actions; per mergiare comunque serve \`ok-fabio\` (Fabio lo chiede in chat)." >/dev/null
  else
    log "esito del revisore: $esito"
  fi
fi

for l in review-ok review-da-correggere serve-fabio; do
  [[ "$l" == "$esito" ]] && continue
  gh api -X DELETE "repos/$GH_REPO/issues/$PR/labels/$l" >/dev/null 2>&1 || true   # 404 = non c'era
done
gh api -X POST "repos/$GH_REPO/issues/$PR/labels" -f "labels[]=$esito" >/dev/null

pr="$(gh api "repos/$GH_REPO/pulls/$PR")"
titolo="$(jq -r .title <<<"$pr")"; url="$(jq -r .html_url <<<"$pr")"
prod="$(jq -r .base.ref <<<"$pr")"
avvisa() { bash scripts/ci-notify.sh "$1
#$PR $titolo
$url"; }

case "$esito" in
  serve-fabio)
    avvisa "🟠 $NOME: una PR aspetta te" ;;
  review-da-correggere)
    giri="$(gh api --paginate "repos/$GH_REPO/issues/$PR/comments" --jq \
      '[.[] | select(.user.type == "Bot" and (.body | startswith("**Correzione automatica")))] | length' \
      | awk '{s+=$1} END {print s+0}')"
    if (( giri < MAX_GIRI )); then
      log "correzione automatica, giro $((giri + 1)) di $MAX_GIRI"
      gh workflow run fix.yml --ref "$prod" -f pr="$PR"
    else
      log "già $giri correzioni automatiche: serve-fabio"
      gh api -X POST "repos/$GH_REPO/issues/$PR/labels" -f "labels[]=serve-fabio" >/dev/null
      gh pr comment "$PR" --body "**Ferma: dopo $giri correzioni automatiche il revisore trova ancora problemi.** Leggi l'ultimo commento del revisore e decidi tu: una correzione (anche chiesta a Claude Code su questa PR) fa ripartire la revisione con un commit nuovo." >/dev/null
      avvisa "🔴 $NOME: correzioni automatiche esaurite"
    fi ;;
esac

# Un'etichetta messa con GITHUB_TOKEN non fa partire automerge.yml: il controllo
# del merge si lancia da qui (se la CI non è ancora verde lo rifà ci.yml alla fine).
bash scripts/automerge.sh "$PR"
