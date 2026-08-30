#!/usr/bin/env bash
#
# Distribuzione completa da riga di comando: frontend su Vercel (via push) e backend su Railway.
#
# Esiste perché le due metà del sistema si distribuiscono in due modi diversi e la differenza
# non è visibile da nessuna parte: Railway **non** è collegato a GitHub, quindi `git push`
# aggiorna soltanto il frontend su Vercel e lascia il backend all'immagine precedente. Chi
# spingeva e poi provava la correzione la provava contro il codice vecchio.
#
# Le migrazioni non vanno lanciate a mano: il `CMD` del Dockerfile è
# `npx prisma migrate deploy && npx tsx src/index.ts`, quindi le colonne nuove arrivano
# all'avvio del container. Questo script non tocca il database.
#
# Uso:
#   ./scripts/distribuisci.sh              # verifica, push, railway up
#   ./scripts/distribuisci.sh --solo-push  # solo il frontend
#   ./scripts/distribuisci.sh --solo-api   # solo il backend
#
set -euo pipefail

cd "$(dirname "$0")/.."

RAILWAY="${RAILWAY_BIN:-$HOME/.railway/bin/railway}"
SOLO_PUSH=0
SOLO_API=0
for arg in "$@"; do
  case "$arg" in
    --solo-push) SOLO_PUSH=1 ;;
    --solo-api) SOLO_API=1 ;;
    *) echo "Argomento non riconosciuto: $arg" >&2; exit 2 ;;
  esac
done

titolo() { printf '\n\033[1m== %s\033[0m\n' "$1"; }

titolo "Verifica prima di distribuire"
# Distribuire codice che non compila o con la suite rossa significa scoprirlo in produzione.
npx tsc --noEmit
(cd frontend && npm run typecheck)
npx vitest run

if [ -n "$(git status --porcelain --untracked-files=no)" ]; then
  echo "Ci sono modifiche non committate: il push spingerebbe uno stato diverso da quello provato." >&2
  git status --short >&2
  exit 1
fi

if [ "$SOLO_API" -eq 0 ]; then
  titolo "Frontend — push su GitHub (Vercel distribuisce da sé)"
  # Autenticazione: il remoto è HTTPS, quindi git chiede utenza e password. La «password» è un
  # Personal Access Token di GitHub (Settings → Developer settings → Tokens, ambito `repo`), non
  # la password dell'account, che GitHub non accetta più su HTTPS. Per non riscriverlo ogni volta:
  #   git config --global credential.helper osxkeychain
  # Nessun browser si apre: il token si incolla nel terminale.
  git push origin main
fi

if [ "$SOLO_PUSH" -eq 0 ]; then
  titolo "Backend — railway up"
  if [ ! -x "$RAILWAY" ]; then
    echo "CLI di Railway non trovata in $RAILWAY (override con RAILWAY_BIN=…)." >&2
    exit 1
  fi
  # `railway whoami` non apre niente: dice solo se la sessione salvata è ancora valida.
  if ! "$RAILWAY" whoami >/dev/null 2>&1; then
    echo "Sessione Railway assente o scaduta. Due modi:"
    echo "  $RAILWAY login              → apre il browser e torna qui autenticato"
    echo "  $RAILWAY login --browserless → stampa un codice da incollare in una pagina già aperta"
    exit 1
  fi
  # `--detach` non aspetta i log della build: lo stato si guarda con `railway logs`.
  "$RAILWAY" up --detach
  echo "Build avviata. Log: $RAILWAY logs"
fi

titolo "Fatto"
echo "Il backend applica da sé la migrazione all'avvio (CMD del Dockerfile: prisma migrate deploy)."
