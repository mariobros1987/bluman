#!/usr/bin/env bash
# sentinella.sh
# Ogni mezz'ora (sentinella.yml, versione di produzione, runner del server) guarda
# le PR aperte: nessuna resta ferma in silenzio (Fabio, 10/11: «non voglio più che
# si blocchi»). Dall'11/11 non si limita ad avvisare: quello che il sistema sa
# sistemare lo fa ripartire da solo, e scrive a Fabio solo quando serve lui.
# Per ogni PR verso il ramo di produzione, guardando l'ULTIMO run del workflow `ci`
# sul commit di testa:
#   1. CI in coda da più di ATTESA_MIN minuti (PC spento, runner giù) o mai
#      partita, o un correttore in coda da tanto: avviso, uno per commit;
#   2. correttore già in coda o in corso: si aspetta lui;
#   3. CI rossa (una parte fallita, anche se le altre sono state annullate):
#      scripts/ci-rossa.sh, che lancia il correttore o mette serve-fabio — una volta
#      per run, e dopo ATTESA_FIX minuti (prima ci pensa automerge.yml);
#   4. CI annullata o mai avviata (runner caduto, job interrotto, nessuna parte
#      rossa): rilancia, al massimo RILANCI volte per commit; oltre, avviso.
#      Un tempo scaduto DENTRO una prova è una CI rossa (punto 3), non si rilancia;
#   5. review-da-correggere senza correttore dopo il commento del revisore, da più
#      di ATTESA_FIX minuti: rilancia il correttore (con i giri di review-label.sh);
#   6. altrimenti automerge.sh, che mergia se è tutto verde e avvia l'allineamento
#      se c'è un conflitto (un evento perso non lascia la PR ferma).
# Con GH_TOKEN e GH_REPO. Un errore su una PR non ferma il giro sulle altre.
set -Eeuo pipefail
export LC_ALL=C   # confronti fra date ISO come stringhe
ATTESA_MIN="${ATTESA_MIN:-45}"
ATTESA_FIX="${ATTESA_FIX:-30}"
RILANCI=2
MAX_GIRI=2
# shellcheck disable=SC1091
[[ -f scripts/progetto.env ]] && source scripts/progetto.env
NOME="${NOME_PROGETTO:-${GH_REPO##*/}}"
PROD="${PROD:-$(gh api "repos/$GH_REPO" --jq .default_branch)}"
log() { printf '[sentinella] %s\n' "$*"; }
ora="$(date -u +%s)"
minuti_da() { local t; t="$(date -u -d "$1" +%s 2>/dev/null)" || { echo 0; return 0; }; echo $(( (ora - t) / 60 )); }
# Commenti della PR scritti da un bot che cominciano con un segno: quanti, e l'ultimo
# quando. Una lettura che non riesce esce con errore e chi chiama salta la PR in
# questo giro: «non lo so» non è «nessun commento», altrimenti i tetti (RILANCI, un
# avviso per commit, MAX_GIRI) smettono di valere.
quanti() { local out; out="$(gh api --paginate "repos/$GH_REPO/issues/$1/comments" --jq "[.[] | select(.user.type == \"Bot\" and (.body | startswith(\"$2\")))] | length" </dev/null)" || return 1; awk '{s+=$1} END {print s+0}' <<<"$out"; }
ultimo() { local out; out="$(gh api --paginate "repos/$GH_REPO/issues/$1/comments" --jq ".[] | select(.user.type == \"Bot\" and (.body | startswith(\"$2\"))) | .created_at" </dev/null)" || return 1; sort <<<"$out" | tail -n 1; }
non_letti() { log "#$1: commenti non letti, la riguardo al prossimo giro"; }
commenta() { gh pr comment "$1" --body "$2" >/dev/null </dev/null || log "#$1: commento non scritto"; }
avvisa_una_volta() {  # avvisa_una_volta <pr> <sha> <titolo> <cosa>
  local segno="**Sentinella — ferma ${2:0:7}**"
  local n; n="$(quanti "$1" "$segno")" || { non_letti "$1"; return 0; }
  (( n == 0 )) || return 0
  log "#$1: $4"
  commenta "$1" "$segno
$4. La sentinella lo dice una volta per commit."
  bash scripts/ci-notify.sh "⏳ $NOME: #$1 ferma, $4
${3:0:120}
https://github.com/$GH_REPO/pull/$1" </dev/null || true
}

# Correttori (fix.yml) in coda o in corso, per PR: il titolo del run è «fix #N».
correttori="$( { for st in queued pending waiting in_progress; do
  gh api "repos/$GH_REPO/actions/workflows/fix.yml/runs?status=$st&per_page=50" --jq '.workflow_runs[] | "\(.display_title)\t\(.created_at)"' </dev/null || true
done; } | sed -nE 's/^fix #([0-9]+)\t/\1\t/p')"

controlla() {  # controlla <pr> <sha> <etichette> <titolo>
  local pr="$1" sha="$2" labels="$3" titolo="$4"
  # 2. Un correttore già in coda o in corso: si aspetta lui (o si avvisa se è fermo).
  local fix; fix="$(awk -F'\t' -v p="$pr" '$1 == p {print $2}' <<<"$correttori" | sort | head -n1)"
  if [[ -n "$fix" ]]; then
    if (( $(minuti_da "$fix") >= ATTESA_MIN )); then
      avvisa_una_volta "$pr" "$sha" "$titolo" "il correttore è in coda da $(minuti_da "$fix") minuti (il PC dei test è acceso?)"
    else log "#$pr: correttore in coda o in corso"; fi
    return 0
  fi

  # L'ultimo run di ci su questo commit (un rilancio è lo stesso run, un tentativo dopo).
  local run
  run="$(gh api "repos/$GH_REPO/actions/runs?head_sha=$sha&event=pull_request&per_page=50" \
    --jq '[.workflow_runs[] | select(.name == "ci")] | max_by(.created_at) // empty | "\(.id)\t\(.status)\t\(.conclusion // "-")\t\(.updated_at)\t\(.created_at)"' </dev/null)" \
    || { log "#$pr: run non letti, la riguardo al prossimo giro"; return 0; }
  local id="" stato="" esito="" agg="" nato=""
  [[ -n "$run" ]] && IFS=$'\t' read -r id stato esito agg nato <<<"$run"

  # 1. CI mai partita o ferma in coda.
  if [[ -z "$id" ]]; then
    local suite; suite="$({ gh api --paginate "repos/$GH_REPO/commits/$sha/check-suites?per_page=100" --jq '.check_suites[].created_at' </dev/null || true; } | sort | head -n1)"
    if [[ -n "$suite" ]] && (( $(minuti_da "$suite") >= ATTESA_MIN )); then
      avvisa_una_volta "$pr" "$sha" "$titolo" "le prove non sono mai partite"
    fi
    return 0
  fi
  if [[ "$stato" != completed ]]; then
    if (( $(minuti_da "$nato") >= ATTESA_MIN )); then
      avvisa_una_volta "$pr" "$sha" "$titolo" "prove in coda o in corso da $(minuti_da "$nato") minuti (il PC dei test è acceso?)"
    else log "#$pr: prove in corso"; fi
    return 0
  fi

  # 3. CI rossa: il correttore delle prove, una volta per run.
  if [[ "$esito" == failure ]]; then
    local dopo; dopo="$(ultimo "$pr" "**Correzione delle prove")" || { non_letti "$pr"; return 0; }
    if [[ ",$labels," == *",serve-fabio,"* ]]; then log "#$pr: prove rosse, già serve-fabio"
    elif [[ -n "$dopo" ]] && ! [[ "$dopo" < "$agg" ]]; then log "#$pr: prove rosse, correttore già passato"
    elif (( $(minuti_da "$agg") < ATTESA_FIX )); then log "#$pr: prove rosse da poco, ci pensa automerge.yml"
    else
      log "#$pr: prove rosse senza correttore da $(minuti_da "$agg") minuti: ci-rossa.sh"
      bash scripts/ci-rossa.sh "$pr" "$id" </dev/null || log "#$pr: ci-rossa.sh è uscito con errore"
    fi
    return 0
  fi

  # 4. CI annullata o mai avviata: non dice niente sul codice, si rilancia. Ma un job
  # fermato dal suo tempo massimo è una prova che si pianta: codice, come una rossa.
  if [[ "$esito" == cancelled ]]; then
    local scaduti; scaduti="$(gh api "repos/$GH_REPO/actions/runs/$id/jobs?per_page=100" --jq '[.jobs[] | select(.conclusion == "timed_out")] | length' </dev/null || echo 0)"
    if (( scaduti > 0 )); then
      log "#$pr: CI annullata con $scaduti job scaduti: come una CI rossa"
      local dopo; dopo="$(ultimo "$pr" "**Correzione delle prove")" || { non_letti "$pr"; return 0; }
      if [[ ",$labels," != *",serve-fabio,"* ]] && { [[ -z "$dopo" ]] || [[ "$dopo" < "$agg" ]]; }; then
        bash scripts/ci-rossa.sh "$pr" "$id" </dev/null || log "#$pr: ci-rossa.sh è uscito con errore"
      fi
      return 0
    fi
  fi
  if [[ "$esito" == cancelled || "$esito" == startup_failure ]]; then
    local segno="**Sentinella — rilancio ${sha:0:7}**" fatti
    fatti="$(quanti "$pr" "$segno")" || { non_letti "$pr"; return 0; }
    if (( fatti < RILANCI )); then
      log "#$pr: CI $esito (run $id), rilancio $((fatti + 1)) di $RILANCI"
      if gh run rerun "$id" --failed </dev/null || gh run rerun "$id" </dev/null; then
        commenta "$pr" "$segno ($((fatti + 1)) di $RILANCI)
CI $esito (non dice niente sul codice): rilanciata."
      else log "#$pr: rilancio del run $id rifiutato"; fi
    else
      avvisa_una_volta "$pr" "$sha" "$titolo" "CI interrotta anche dopo $fatti rilanci"
    fi
    return 0
  fi

  # 5. Il revisore ha chiesto correzioni e il correttore non è partito (evento perso).
  if [[ ",$labels," == *",review-da-correggere,"* && ",$labels," != *",serve-fabio,"* ]]; then
    local chiesto fatto giri
    chiesto="$(ultimo "$pr" "**Revisione automatica — review-da-correggere**")" || { non_letti "$pr"; return 0; }
    fatto="$(ultimo "$pr" "**Correzione automatica")" || { non_letti "$pr"; return 0; }
    giri="$(quanti "$pr" "**Correzione automatica")" || { non_letti "$pr"; return 0; }
    if [[ -n "$chiesto" ]] && { [[ -z "$fatto" ]] || [[ "$fatto" < "$chiesto" ]]; } && (( $(minuti_da "$chiesto") >= ATTESA_FIX )) && (( giri < MAX_GIRI )); then
      log "#$pr: correzione chiesta da $(minuti_da "$chiesto") minuti e mai partita: correttore"
      gh workflow run fix.yml --ref "$PROD" -f pr="$pr" </dev/null || log "#$pr: lancio del correttore rifiutato"
    fi
    return 0
  fi

  # 6. Tutto il resto: il controllo del merge (e dei conflitti).
  log "#$pr: controllo del merge"
  bash scripts/automerge.sh "$pr" </dev/null || log "#$pr: automerge.sh è uscito con errore"
}

gh api --paginate "repos/$GH_REPO/pulls?state=open&base=$PROD&per_page=100" \
  --jq '.[] | select(.draft == false) | "\(.number)\t\(.head.sha)\t\([.labels[].name] | join(","))\t\(.title)"' |
while IFS=$'\t' read -r pr sha labels titolo; do
  [[ "$pr" =~ ^[0-9]+$ ]] || continue
  controlla "$pr" "$sha" "$labels" "$titolo" || log "#$pr: controllo interrotto da un errore"
done
