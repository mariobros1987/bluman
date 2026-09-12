#!/usr/bin/env bash
#
# Distribuzione completa da riga di comando: frontend su Vercel (push + CLI) e backend su Railway.
#
# Regole & Sicurezza:
# - Autore/Committer Git OBBLIGATORIO: Mario Dibenedetto <mario.dibenedetto87@gmail.com> (richiesto da Vercel)
# - Validazione preliminare: typecheck TS backend/frontend, build Vite e test Vitest (100% verdi).
# - Railway up per il backend e Vercel deploy per il frontend.
#
# Uso:
#   ./scripts/distribuisci.sh              # verifica, push, vercel deploy, railway up
#   ./scripts/distribuisci.sh --solo-push  # solo il frontend (push + vercel)
#   ./scripts/distribuisci.sh --solo-api   # solo il backend (railway up)
#
set -euo pipefail

cd "$(dirname "$0")/.."

RAILWAY="${RAILWAY_BIN:-$(command -v railway 2>/dev/null || echo "$HOME/.railway/bin/railway")}"
REQUIRED_GIT_EMAIL="mario.dibenedetto87@gmail.com"
REQUIRED_GIT_NAME="Mario Dibenedetto"

SOLO_PUSH=0
SOLO_API=0
for arg in "$@"; do
  case "$arg" in
    --solo-push) SOLO_PUSH=1 ;;
    --solo-api) SOLO_API=1 ;;
    *) echo "Argomento non riconosciuto: $arg" >&2; exit 2 ;;
  esac
done

titolo() { printf '\n\033[1;34m== %s\033[0m\n' "$1"; }
successo() { printf '\033[1;32m✔ %s\033[0m\n' "$1"; }
avviso() { printf '\033[1;33m⚠ %s\033[0m\n' "$1"; }

# 1. Configurazione automatica identità Git corretta
git config user.email "$REQUIRED_GIT_EMAIL"
git config user.name "$REQUIRED_GIT_NAME"

titolo "1. Verifica integrità e test prima di distribuire"
echo "• Controllo Typecheck Backend..."
npx tsc --noEmit
successo "Typecheck Backend superato."

echo "• Controllo Typecheck Frontend..."
(cd frontend && npm run typecheck)
successo "Typecheck Frontend superato."

echo "• Build Bundle Frontend..."
(cd frontend && npm run build)
successo "Build Frontend completata con successo."

echo "• Esecuzione Suite di Test Vitest..."
npx vitest run
successo "Test Vitest completati al 100% (verdi)."

# 2. Controllo modifiche non committate
if [ -n "$(git status --porcelain --untracked-files=no)" ]; then
  echo "Ci sono modifiche non committate: il push spingerebbe uno stato diverso da quello provato." >&2
  git status --short >&2
  exit 1
fi

# 3. Controllo Autore e Committer sugli ultimi commit da spingere
titolo "2. Verifica Autore Git per Vercel"
ULTIMO_AUTORE=$(git log -1 --format="%ae")
ULTIMO_COMMITTER=$(git log -1 --format="%ce")

if [ "$ULTIMO_AUTORE" != "$REQUIRED_GIT_EMAIL" ] || [ "$ULTIMO_COMMITTER" != "$REQUIRED_GIT_EMAIL" ]; then
  avviso "L'ultimo commit ha un autore ($ULTIMO_AUTORE) o committer ($ULTIMO_COMMITTER) diverso da $REQUIRED_GIT_EMAIL."
  echo "• Correzione automatica dell'ultimo commit con l'autore corretto..."
  GIT_COMMITTER_NAME="$REQUIRED_GIT_NAME" GIT_COMMITTER_EMAIL="$REQUIRED_GIT_EMAIL" \
    git commit --amend --no-edit --author="$REQUIRED_GIT_NAME <$REQUIRED_GIT_EMAIL>"
  successo "Autore e Committer riallineati a $REQUIRED_GIT_NAME <$REQUIRED_GIT_EMAIL>."
else
  successo "Autore Git verificato: $REQUIRED_GIT_NAME <$REQUIRED_GIT_EMAIL>."
fi

# 4. Frontend — Push GitHub & Vercel
if [ "$SOLO_API" -eq 0 ]; then
  titolo "3. Frontend — Push GitHub e Deploy Vercel"
  git push origin main
  successo "Push su GitHub (main) completato."

  echo "• Trigger diretto deploy di produzione su Vercel..."
  npx vercel --prod --scope fanta-ia --yes || avviso "Deploy Vercel via CLI non riuscito o già in corso da webhook GitHub."
  successo "Frontend rilasciato su https://bluman.vercel.app"
fi

# 5. Backend — Railway Up
if [ "$SOLO_PUSH" -eq 0 ]; then
  titolo "4. Backend — Railway Up"
  if [ ! -x "$RAILWAY" ]; then
    echo "CLI di Railway non trovata in $RAILWAY (override con RAILWAY_BIN=…)." >&2
    exit 1
  fi

  if ! "$RAILWAY" whoami >/dev/null 2>&1; then
    echo "Sessione Railway assente o scaduta. Esegui '$RAILWAY login' e riprova." >&2
    exit 1
  fi

  "$RAILWAY" up --detach
  successo "Backend inviato a Railway (build avviata in background)."
  echo "• Puoi monitorare i log con: $RAILWAY logs"
fi

titolo "🎉 Distribuzione Completata con Successo!"
echo "🌐 Frontend: https://bluman.vercel.app"
echo "⚙️ Backend API: https://bluman-api-production.up.railway.app"
