#!/usr/bin/env bash
# pubblica.sh [--merge [--backup-fatto]]
# Script PROPRIO di BluMan (non dello Standard). La pubblicazione è una PR da
# wolftradesystem-tech:main (il fork, dove gira il pilota) a mariobros1987/bluman main
# (il repo del titolare, `upstream`, con push disattivato). All'unione Railway (backend,
# `prisma migrate deploy` all'avvio del container) e Vercel (bluman.vercel.app, copia di
# riserva) pubblicano da soli; blusmart.eu lo aggiorna solo il titolare con
# `scripts/distribuisci.sh --solo-vps`. DEPLOY.md.
#
#   senza argomenti  apre o aggiorna la PR su upstream: elenco dei commit, dove arriva,
#                    e in TESTA l'avviso se cambiano le migrazioni (la PR lo segnala da sola).
#   --merge          unisce con `gh pr merge --merge`, SOLO quando Fabio scrive «pubblica»;
#                    con migrazioni rifiuta senza --backup-fatto, perché Railway applica le
#                    migrazioni senza fare un backup (regola di 90-progetto.md).
#                    Dopo l'unione riallinea main del fork a upstream (gh repo sync): il
#                    merge commit sta solo su upstream, e senza il sync la pubblicazione
#                    successiva vedrebbe i due rami divergere.
# Serve `gh` autenticato come wolftradesystem-tech, e il remote `upstream` nel clone.
set -Eeuo pipefail
UP=mariobros1987/bluman
FORK=wolftradesystem-tech/bluman
TESTA_PR="wolftradesystem-tech:main"
MERGE=no; BACKUP=no
for a in "$@"; do
  case "$a" in
    --merge) MERGE=si ;;
    --backup-fatto) BACKUP=si ;;
    *) echo "argomento sconosciuto: $a (ammessi: --merge, --backup-fatto)"; exit 2 ;;
  esac
done
log() { printf '[pubblica] %s\n' "$*"; }

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
  echo "- blusmart.eu (server Register.it, produzione dello studio): **no**, lo aggiorna solo il titolare con \`scripts/distribuisci.sh --solo-vps\`."
  echo
  echo "## Come si unisce"
  echo
  echo "Solo quando Fabio scrive «pubblica»: \`bash scripts/pubblica.sh --merge\`${migr:+ \`--backup-fatto\`}."
  echo "Ogni commit è arrivato su main del fork da una PR con CI verde e revisione (pilota dello Standard)."
} > "$corpo"

pr="$(gh api "repos/$UP/pulls?head=$TESTA_PR&base=main&state=open" --jq '.[0].number // empty')"
if [[ -z "$pr" ]]; then
  pr="$(gh api -X POST "repos/$UP/pulls" -f title="$titolo" -f head="$TESTA_PR" -f base=main -F body=@"$corpo" --jq .number)"
  log "PR aperta: https://github.com/$UP/pull/$pr"
else
  gh api -X PATCH "repos/$UP/pulls/$pr" -f title="$titolo" -F body=@"$corpo" >/dev/null
  log "PR aggiornata: https://github.com/$UP/pull/$pr"
fi
rm -f "$corpo"
[[ -n "$migr" ]] && log "⚠️ migrazioni dentro: $(tr '\n' ' ' <<<"$migr")"

[[ "$MERGE" == si ]] || { log "non unita: --merge solo quando Fabio scrive «pubblica»"; exit 0; }
if [[ -n "$migr" && "$BACKUP" != si ]]; then
  log "RIFIUTATO: la pubblicazione porta migrazioni e manca --backup-fatto (prima il backup del DB di produzione)"
  exit 1
fi
# --merge (merge commit) e non squash: i commit restano gli stessi del fork, e alla
# pubblicazione dopo si vede cosa c'è di nuovo. --match-head-commit: si unisce quello
# che è stato letto e scritto nella PR, non un main avanzato nel frattempo.
gh pr merge "$pr" -R "$UP" --merge --match-head-commit "$testa"
log "unita: Railway e Vercel pubblicano da soli; blusmart.eu resta al titolare"
gh repo sync "$FORK" --source "$UP" --branch main
log "main del fork riallineato a upstream (merge commit compreso)"
