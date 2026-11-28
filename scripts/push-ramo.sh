#!/usr/bin/env bash
# push-ramo.sh <ramo> [base]
# L'UNICO punto da cui correttore e task da issue mandano codice a GitHub.
# Claude committa e basta: il push lo fa questo script, dopo i controlli, perché
# il permesso «git push origin HEAD:*» lasciava passare anche
# «git push origin HEAD:<ramo di produzione>», cioè la produzione senza CI né revisione
# (analisi critica del 04/11 sul pilota; GitHub Free non protegge i rami dei repo privati).
#
# Script COMUNE, identico in ogni progetto. Non legge file del repo (Claude
# potrebbe averli cambiati): solo l'ambiente che gli passa il workflow.
#   PROD          ramo di produzione (se manca: il ramo predefinito di origin)
#   RAMI_VIETATI  altri rami da non toccare mai, separati da spazi (es. un vecchio
#                 ramo di produzione rinominato, che ha un nome ammesso come feat/…)
#
# Rifiuta: il ramo di produzione, `main`, `master` e RAMI_VIETATI; nomi fuori da fix/ feat/ docs/ test/
# chore/ ci/ refactor/ claude/ thread/; una storia riscritta (HEAD che non discende dal
# ramo remoto, se esiste). Niente da mandare = esce 0 senza fare niente.
#
# Il workflow lo copia fuori dalla cartella di lavoro PRIMA di lanciare Claude e
# lo esegue da lì: una copia nel repo Claude potrebbe modificarla. Per lo stesso
# motivo gli hook di git sono spenti e l'origin si controlla.
set -Eeuo pipefail
RAMO="${1:?ramo}"
# Ramo di produzione: dall'ambiente (il workflow lo passa) o dal ramo predefinito di origin.
PROD="${PROD:-$(command git ls-remote --symref origin HEAD | awk '/^ref:/ {sub("refs/heads/", "", $2); print $2}')}"
[[ -n "$PROD" ]] || { printf '[push-ramo] rifiutato: ramo di produzione non letto\n'; exit 1; }
log() { printf '[push-ramo] %s\n' "$*"; }
git() { command git -c core.hooksPath=/dev/null "$@"; }

if [[ -n "${GH_REPO:-}" ]]; then
  atteso="https://github.com/$GH_REPO"
  # L'azione di Claude scrive l'URL con dentro la chiave (https://x-access-token:…@github.com/…):
  # si confronta senza utente e chiave, che non vanno mai nel log (04/11: il correttore
  # veniva rifiutato a ogni giro).
  origine="$(git remote get-url origin | sed -E 's#^(https?://)[^/@]+@#\1#; s#\.git$##')"
  [[ "$origine" == "$atteso" ]] || { log "rifiutato: origin non è $atteso"; exit 1; }
fi

[[ "$RAMO" != "$PROD" && "$RAMO" != main && "$RAMO" != master ]] || { log "rifiutato: $RAMO è un ramo di produzione"; exit 1; }
for v in ${RAMI_VIETATI:-}; do [[ "$RAMO" != "$v" ]] || { log "rifiutato: $RAMO è fra i rami da non toccare"; exit 1; }; done
[[ "$RAMO" =~ ^(fix|feat|docs|test|chore|ci|refactor|claude|thread)/[A-Za-z0-9._/-]+$ ]] || { log "rifiutato: nome di ramo non ammesso ($RAMO)"; exit 1; }

git fetch --quiet origin "$PROD"
if git ls-remote --exit-code --heads origin "$RAMO" >/dev/null 2>&1; then
  git fetch --quiet origin "$RAMO"
  git merge-base --is-ancestor "origin/$RAMO" HEAD || { log "rifiutato: HEAD non discende da origin/$RAMO (storia riscritta)"; exit 1; }
  [[ -n "$(git log --oneline "origin/$RAMO..HEAD")" ]] || { log "niente di nuovo da mandare su $RAMO"; exit 0; }
else
  [[ -n "$(git log --oneline "origin/$PROD..HEAD")" ]] || { log "niente di nuovo rispetto a $PROD"; exit 0; }
fi
git push origin "HEAD:refs/heads/$RAMO"
log "mandato su $RAMO: $(git rev-parse --short HEAD)"
