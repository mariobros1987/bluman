#!/usr/bin/env bash
# automerge.sh <numero-pr>
# Mergia una PR verso il ramo di produzione quando è tutto verde, poi lancia il deploy.
# Gira in GitHub Actions (automerge.yml, sempre nella versione di produzione)
# con GH_TOKEN e GH_REPO impostati.
#
# Condizioni, tutte:
#   - PR aperta, non in bozza, verso il ramo di produzione (PROD dall'ambiente, o il ramo predefinito del repo)
#   - CI verde sull'ultimo commit: check run «check» e «test» = success
#   - etichetta review-ok (o ok-fabio), messa dopo il commit di testa; nessuna review-da-correggere, serve-fabio solo con ok-fabio
# Nessuna area aspetta Fabio (deciso da Fabio il 03/11, ribadito il 04/11):
# backend, schema, motore, interfaccia e automazione si mergiano con CI e revisione verdi.
# Fabio serve solo quando il revisore mette serve-fabio (decisione di prodotto,
# spesa, dati veri, piano mancante, revisione saltata): lì Fabio dice in chat
# «mergia la #N» e una sessione di Claude mette ok-fabio. Un commit nuovo toglie
# tutte le etichette di esito (automerge.yml, job reset).
set -Eeuo pipefail
PR="$1"
log() { printf '[automerge #%s] %s\n' "$PR" "$*"; }
# Letture verso GitHub con 3 tentativi: il 04/11 un 502 alla prima lettura ha
# lasciato la #22 ferma come il 502 al merge aveva lasciato la #21. Solo le
# letture: ripetere una scrittura (un commento) potrebbe farla due volte.
leggi() {
  local n
  for n in 1 2 3; do
    command gh api "$@" && return 0
    log "GitHub non risponde (tentativo $n di 3)"; sleep $((n * 15))
  done
  return 1
}

# Script COMUNE, identico in ogni progetto. Il nome negli avvisi viene da
# scripts/progetto.env: lo script gira nel checkout del ramo di produzione, mai
# in quello della PR.
# shellcheck disable=SC1091
[[ -f scripts/progetto.env ]] && source scripts/progetto.env
NOME="${NOME_PROGETTO:-${GH_REPO##*/}}"
pr="$(leggi "repos/$GH_REPO/pulls/$PR")"
state="$(jq -r .state <<<"$pr")"; draft="$(jq -r .draft <<<"$pr")"
base="$(jq -r .base.ref <<<"$pr")"; sha="$(jq -r .head.sha <<<"$pr")"
labels="$(jq -r '[.labels[].name] | join(",")' <<<"$pr")"
PROD="${PROD:-$(leggi "repos/$GH_REPO" --jq .default_branch)}"
[[ "$state" == open && "$draft" == false && "$base" == "$PROD" ]] || { log "non applicabile ($state, bozza=$draft, base=$base)"; exit 0; }

has() { [[ ",$labels," == *",$1,"* ]]; }
# ok-fabio (messa su richiesta di Fabio) vale come via libera del revisore e scavalca serve-fabio,
# ma non review-da-correggere: un errore segnalato si corregge, non si approva.
if has review-da-correggere; then log "il revisore chiede correzioni"; exit 0; fi
has review-ok || has ok-fabio || { log "revisione non ancora verde ($labels)"; exit 0; }
if has serve-fabio && ! has ok-fabio; then log "aspetta l'etichetta ok-fabio"; exit 0; fi

for name in check test; do
  # L'ultimo run con quel nome (una CI rilanciata lascia anche il vecchio).
  c="$(leggi "repos/$GH_REPO/commits/$sha/check-runs?check_name=$name" --jq '[.check_runs[]] | sort_by(.started_at // "") | last | .conclusion // "pending"')"
  [[ "$c" == success ]] || { log "CI $name = $c"; exit 0; }
done

# Il via libera deve essere arrivato DOPO il commit di testa. Un commit nuovo toglie
# le etichette (job reset), ma reset e merge girano sullo stesso runner del server,
# in coda: se il merge passasse prima, l'etichetta del commit vecchio varrebbe per
# quello nuovo (revisione indipendente del 09/11). L'istante del commit è la
# nascita della prima check suite di quel commit: la crea GitHub al push, prima di
# ogni coda (la data del commit invece la sceglie chi lo scrive). «Non lo so» = non
# si mergia: riprova il prossimo evento.
ci_dal="$(leggi --paginate "repos/$GH_REPO/commits/$sha/check-suites?per_page=100" --jq '.check_suites[].created_at' | sort | head -n 1)"
via="$(leggi --paginate "repos/$GH_REPO/issues/$PR/events" --jq '.[] | select(.event == "labeled" and (.label.name == "review-ok" or .label.name == "ok-fabio")) | .created_at' | sort | tail -n 1)"
[[ -n "$ci_dal" && -n "$via" ]] || { log "non so quando è arrivato il via libera rispetto al commit (CI: ${ci_dal:-?}, etichetta: ${via:-?})"; exit 0; }
LC_ALL=C; [[ "$via" > "$ci_dal" ]] || { log "il via libera ($via) è del commit di prima (CI di $sha dal $ci_dal): aspetto la revisione nuova"; exit 0; }

# Conflitto col ramo di produzione (di solito due PR che scrivono in fondo al
# DIARIO): il merge fallirebbe in silenzio. GitHub calcola «mergeable» dopo
# qualche secondo: null = non ancora, si riprova; ancora null = «non lo so», ci si
# ferma qui e riprova il prossimo evento.
mergeable=null
for _ in 1 2 3 4 5 6; do
  # Non «.mergeable // "null"»: in jq «//» scarta anche false, e un conflitto vero
  # diventava «non ancora calcolato» per sempre (Match #76 ferma dal 17/11).
  mergeable="$(leggi "repos/$GH_REPO/pulls/$PR" --jq 'if .mergeable == null then "null" else (.mergeable | tostring) end')"
  [[ "$mergeable" != null ]] && break
  sleep 5
done
if [[ "$mergeable" == null ]]; then log "GitHub non ha ancora calcolato se si mergia: riprova al prossimo evento"; exit 0; fi
if [[ "$mergeable" == false ]]; then
  giri="$(leggi --paginate "repos/$GH_REPO/issues/$PR/comments" --jq \
    '[.[] | select(.user.type == "Bot" and (.body | startswith("**Allineamento automatico")))] | length' \
    | awk '{s+=$1} END {print s+0}')"
  if (( giri < 2 )); then
    log "conflitto con $PROD: allineamento automatico, giro $((giri + 1)) di 2"
    gh workflow run fix.yml --ref "$PROD" -f pr="$PR" -f motivo=conflitto
  elif ! has serve-fabio; then
    log "conflitto ancora dopo $giri allineamenti: serve-fabio"
    gh api -X POST "repos/$GH_REPO/issues/$PR/labels" -f "labels[]=serve-fabio" >/dev/null
    gh pr comment "$PR" --body "**Ferma: conflitto con $PROD che l'allineamento automatico non ha risolto in $giri giri.** Va risolto a mano (anche chiedendolo a Claude Code su questa PR)." >/dev/null
    bash scripts/ci-notify.sh "🔴 $NOME: PR in conflitto, non si mergia da sola
#$PR $(jq -r .title <<<"$pr")
$(jq -r .html_url <<<"$pr")"
  fi
  exit 0
fi

log "merge di $sha"
# GitHub a volte risponde 502/503 al merge (04/11, #21: PR verde rimasta ferma in
# silenzio). Si riprova 3 volte; se è già mergiata (un altro evento ci è arrivato
# prima) va bene; altrimenti avviso e stop, senza deploy.
fatto=no
for tentativo in 1 2 3; do
  if gh pr merge "$PR" --squash --delete-branch --match-head-commit "$sha"; then fatto=si; break; fi
  # Mergiata da un altro run (due eventi insieme): il deploy l'ha lanciato lui.
  # Un secondo lancio rifarebbe il deploy completo (base = commit nuovo = rilancio vero).
  [[ "$(gh api "repos/$GH_REPO/pulls/$PR" --jq .merged 2>/dev/null)" == true ]] && { log "già mergiata da un altro run: deploy già lanciato da lui"; exit 0; }
  log "merge non riuscito (tentativo $tentativo di 3)"
  sleep $((tentativo * 20))
done
if [[ "$fatto" != si ]]; then
  bash scripts/ci-notify.sh "🔴 $NOME: PR pronta ma il merge non riesce (GitHub ha risposto con un errore)
#$PR $(jq -r .title <<<"$pr")
$(jq -r .html_url <<<"$pr")"
  exit 1
fi
# Un merge fatto con GITHUB_TOKEN non fa partire i workflow su push: il deploy
# si lancia esplicitamente (workflow_dispatch è l'eccezione ammessa).
lanciato=no
for tentativo in 1 2 3; do
  gh workflow run deploy.yml --ref "$PROD" && { lanciato=si; break; }
  log "deploy non lanciato (tentativo $tentativo di 3)"; sleep $((tentativo * 15))
done
if [[ "$lanciato" != si ]]; then
  bash scripts/ci-notify.sh "🔴 $NOME: #$PR mergiata ma il deploy non è partito (GitHub ha risposto con un errore): va rilanciato da Actions → deploy → Run workflow"
  exit 1
fi
log "merge fatto, deploy lanciato"
