#!/usr/bin/env bash
# pubblica.sh [--merge [--backup-fatto] | --automatico]
# Script PROPRIO di BluMan (non dello Standard). La pubblicazione è una PR da
# wolftradesystem-tech:main (il fork, dove gira il pilota) a mariobros1987/bluman main
# (il repo del titolare, `upstream`, con push disattivato). All'unione Railway (backend,
# `prisma migrate deploy` all'avvio del container) e Vercel (bluman.vercel.app, copia di
# riserva) pubblicano da soli; blusmart.eu si aggiorna dopo con `scripts/aggiorna-blusmart.sh` (Fabio) o
# `scripts/distribuisci.sh --solo-vps`. DEPLOY.md.
#
#   senza argomenti  apre o aggiorna la PR su upstream: elenco dei commit, dove arriva,
#                    e in TESTA l'avviso se cambiano le migrazioni (la PR lo segnala da sola).
#   --automatico     lo lancia deploy.yml dopo ogni merge nel fork (Fabio, 28/11: «tutto
#                    automatico», d'accordo il titolare): unisce da solo se la pubblicazione
#                    NON porta migrazioni; se le porta apre o aggiorna la PR, esce con 3 e
#                    aspetta il «pubblica» di Fabio dopo il backup del DB di Railway.
#   --merge          unisce con `gh pr merge --merge`, a mano, quando Fabio scrive «pubblica»;
#                    con migrazioni rifiuta senza --backup-fatto, perché Railway applica le
#                    migrazioni senza fare un backup (regola di 90-progetto.md).
#                    Dopo l'unione riallinea main del fork a upstream (gh repo sync): il
#                    merge commit sta solo su upstream, e senza il sync la pubblicazione
#                    successiva vedrebbe i due rami divergere.
# Serve `gh` autenticato come wolftradesystem-tech (in deploy.yml: GH_TOKEN = secret
# PUBBLICA_TOKEN), e il remote `upstream` nel clone.
set -Eeuo pipefail
UP=mariobros1987/bluman
FORK=wolftradesystem-tech/bluman
TESTA_PR="wolftradesystem-tech:main"
MERGE=no; BACKUP=no; AUTO=no
for a in "$@"; do
  case "$a" in
    --merge) MERGE=si ;;
    --backup-fatto) BACKUP=si ;;
    --automatico) AUTO=si ;;
    *) echo "argomento sconosciuto: $a (ammessi: --merge, --backup-fatto, --automatico)"; exit 2 ;;
  esac
done
if [[ "$AUTO" == si && ( "$MERGE" == si || "$BACKUP" == si ) ]]; then
  echo "--automatico va da solo: con migrazioni la pubblicazione si unisce a mano (--merge --backup-fatto)"; exit 2
fi
log() { printf '[pubblica] %s\n' "$*"; }

# Le chiamate a GitHub si ritentano: il 28/11 una risposta vuota («unexpected end of JSON
# input») ha chiuso la pubblicazione al primo colpo, senza una riga che dicesse dove. Un
# rifiuto (HTTP 4xx, tranne 429) non cambia riprovando e non si ritenta. Se non basta, la
# riga [pubblica] dice quale chiamata e con che errore: è quella che arriva nell'avviso.
TENTATIVI="${PUBBLICA_TENTATIVI:-3}"; ATTESA="${PUBBLICA_ATTESA:-5}"
gh_api() { # gh_api «cosa sta facendo» <argomenti di gh api…>
  local cosa="$1" t=1 risposta errore; shift
  errore="$(mktemp)"
  while :; do
    if risposta="$(gh api "$@" 2>"$errore")"; then rm -f "$errore"; printf '%s' "$risposta"; return 0; fi
    if (( t >= TENTATIVI )) || grep -qE 'HTTP 4(0[0-9]|1[0-9]|2[0-8])\)' "$errore"; then break; fi
    sleep "$(( ATTESA * t ))"; t=$(( t + 1 ))
  done
  log "GitHub non ha risposto a «$cosa» (tentativi: $t): $(head -n 1 "$errore" | cut -c1-200)" >&2
  rm -f "$errore"; return 1
}

git fetch --quiet origin main
git fetch --quiet upstream main
base="$(git rev-parse upstream/main)"; testa="$(git rev-parse origin/main)"
if [[ "$base" == "$testa" ]]; then log "niente da pubblicare: upstream/main = origin/main (${testa:0:7})"; exit 0; fi
git merge-base --is-ancestor "$base" "$testa" || {
  log "origin/main (${testa:0:7}) non discende da upstream/main (${base:0:7}): il titolare ha pubblicato altro. Prima si porta upstream/main nel fork con una PR normale, poi si ripubblica."
  exit 1
}

commit="$(git log --format='- %h %s' "$base..$testa")"
n="$(git rev-list --count "$base..$testa")"
migr="$(git diff --name-only "$base...$testa" -- prisma/migrations | sed -nE 's#^prisma/migrations/([^/]+)/.*#\1#p' | sort -u)"
oggi="$(date +%d/%m/%Y)"
titolo="pubblicazione del $oggi: $n commit dal fork"

corpo="$(mktemp)"
{
  if [[ -n "$migr" ]]; then
    echo "## ⚠️ Questa pubblicazione cambia lo schema del database"
    echo
    echo "Railway applica le migrazioni all'avvio del container (\`prisma migrate deploy\`) **senza fare un backup**."
    echo "Si unisce solo DOPO un backup del DB di produzione (regola di \`.claude/rules/90-progetto.md\`)."
    echo "Migrazioni che entrano:"
    sed 's/^/- `/; s/$/`/' <<<"$migr"
    echo
  fi
  echo "## Cosa va in produzione"
  echo
  echo "$n commit da \`$FORK\` main (\`${testa:0:7}\`) a \`$UP\` main (\`${base:0:7}\`):"
  echo
  echo "$commit"
  echo
  echo "## Dove arriva all'unione"
  echo
  echo "- Railway: backend (\`prisma migrate deploy\` all'avvio, poi il server)."
  echo "- Vercel: frontend su bluman.vercel.app (copia di riserva)."
  echo "- blusmart.eu (server Register.it, produzione dello studio): entro 10 minuti dall'unione, da solo (\`scripts/aggiorna-blusmart-auto.sh\` dal cron del server, con la copia del database prima)."
  echo
  echo "## Come si unisce"
  echo
  if [[ -n "$migr" ]]; then
    echo "**Non si unisce da sola**: dopo il backup del DB di Railway, quando Fabio scrive «pubblica»: \`bash scripts/pubblica.sh --merge --backup-fatto\`."
  else
    echo "Da sola, dopo ogni merge nel fork (\`deploy.yml\` → \`bash scripts/pubblica.sh --automatico\`)."
  fi
  echo "Ogni commit è arrivato su main del fork da una PR con CI verde e revisione (pilota dello Standard)."
} > "$corpo"

pr="$(gh_api "cerca la PR aperta" "repos/$UP/pulls?head=$TESTA_PR&base=main&state=open" --jq '.[0].number // empty')"
if [[ -z "$pr" ]]; then
  pr="$(gh_api "apri la PR" -X POST "repos/$UP/pulls" -f title="$titolo" -f head="$TESTA_PR" -f base=main -F body=@"$corpo" --jq .number)"
  log "PR aperta: https://github.com/$UP/pull/$pr"
else
  gh_api "aggiorna la PR #$pr" -X PATCH "repos/$UP/pulls/$pr" -f title="$titolo" -F body=@"$corpo" >/dev/null
  log "PR aggiornata: https://github.com/$UP/pull/$pr"
fi
rm -f "$corpo"
[[ -n "$migr" ]] && log "⚠️ migrazioni dentro: $(tr '\n' ' ' <<<"$migr")"

if [[ "$AUTO" == si && -n "$migr" ]]; then
  log "NON unita: porta migrazioni. Prima il backup del DB di Railway, poi «pubblica» (--merge --backup-fatto)"
  exit 3
fi
[[ "$AUTO" == si ]] && MERGE=si
[[ "$MERGE" == si ]] || { log "non unita: --merge solo quando Fabio scrive «pubblica»"; exit 0; }
if [[ -n "$migr" && "$BACKUP" != si ]]; then
  log "RIFIUTATO: la pubblicazione porta migrazioni e manca --backup-fatto (prima il backup del DB di produzione)"
  exit 1
fi
# --merge (merge commit) e non squash: i commit restano gli stessi del fork, e alla
# pubblicazione dopo si vede cosa c'è di nuovo. --match-head-commit: si unisce quello
# che è stato letto e scritto nella PR, non un main avanzato nel frattempo.
gh pr merge "$pr" -R "$UP" --merge --match-head-commit "$testa"
log "unita: Railway e Vercel pubblicano da soli; blusmart.eu si aggiorna da solo entro 10 minuti (aggiorna-blusmart-auto.sh)"
gh repo sync "$FORK" --source "$UP" --branch main
log "main del fork riallineato a upstream (merge commit compreso)"
