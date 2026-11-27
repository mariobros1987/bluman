#!/usr/bin/env bash
# livello.sh <file-delle-aree>   (su stdin: una riga «stato<TAB>percorso» per file)
# Stampa il livello di controllo di una modifica: leggero | normale | sensibile.
#   leggero   → build e typecheck; niente prove, niente revisore
#   normale   → in più le prove collegate ai file toccati e il revisore
#   sensibile → in più la suite intera (divisa in parti, in parallelo)
# (Fabio, 10/11: «veloce, automatico e sicuro; la suite intera solo se serve».)
#
# Ogni file prende il livello dell'ULTIMA riga del file delle aree
# (.github/livelli.txt) che lo descrive, come in .gitignore: prima la regola
# larga, poi le eccezioni. Un file che nessuna riga descrive è «normale». La
# modifica prende il livello più alto fra i suoi file.
# Barriere fisse, che il file delle aree non abbassa:
#   - un file tolto o rinominato, workflow, script, regole, hook: almeno normale
#     (il revisore li guarda sempre);
#   - dipendenze (package.json, lockfile, workspace): sensibile;
#   - nessun file, o file delle aree mancante: sensibile («non lo so» non è «poco»).
# Chi lo chiama legge il file delle aree e questo script dal ramo di PRODUZIONE:
# una PR non sceglie il proprio livello.
set -uo pipefail
AREE="${1:-}"
peso() { case "$1" in leggero) echo 0;; normale) echo 1;; sensibile) echo 2;; *) echo 1;; esac; }
nome=(leggero normale sensibile)

[[ -n "$AREE" && -s "$AREE" ]] || { echo sensibile; exit 0; }
regole=()
while read -r liv pat _; do
  [[ -z "${liv:-}" || "$liv" == \#* ]] && continue
  case "$liv" in leggero|normale|sensibile) regole+=("$liv $pat");; esac
done <"$AREE"

tot=-1
livello_di() {   # livello_di <stato> <percorso>
  local stato="$1" file="$2" p=-1 r liv pat
  for r in "${regole[@]}"; do
    liv="${r%% *}"; pat="${r#* }"
    # shellcheck disable=SC2053  # il percorso è un modello: * vale anche per «/»
    [[ "$file" == $pat ]] && p="$(peso "$liv")"
  done
  (( p < 0 )) && p=1
  case "$stato" in D*|R*|removed|renamed) (( p < 1 )) && p=1;; esac
  case "$file" in
    .github/*|scripts/*|.claude/*|CLAUDE.md|*/CLAUDE.md|.gitattributes|*.sh) (( p < 1 )) && p=1;;
  esac
  case "$file" in
    package.json|*/package.json|pnpm-lock.yaml|pnpm-workspace.yaml|package-lock.json|yarn.lock) p=2;;
  esac
  echo "$p"
}
# Una riga: stato, percorso e, per un file spostato, l'altro percorso (git diff:
# «R100 vecchio nuovo»; API: «renamed nuovo vecchio»). Contano tutti e due.
while IFS=$'\t' read -r stato file altro; do
  for f in "${file:-}" "${altro:-}"; do
    [[ -z "$f" ]] && continue
    p="$(livello_di "$stato" "$f")"
    (( p > tot )) && tot=$p
  done
done
(( tot < 0 )) && tot=2
echo "${nome[$tot]}"
