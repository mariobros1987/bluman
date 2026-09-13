#!/usr/bin/env bash
#
# Distribuzione completa da riga di comando: frontend su Vercel (push + CLI) e backend su Railway.
#
# Regole & Sicurezza:
# - Autore/Committer Git: l'ultimo commit deve avere l'identità attesa da Vercel. La verifica
#   è BLOCCANTE (errore + uscita): il vecchio `git commit --amend` automatico riscriveva la
#   storia senza chiedere, e un amend involontario su un commit già spinto crea problemi che
#   si scoprono troppo tardi. Se l'autore è sbagliato, lo si corregge a mano con
#   `git commit --amend --author="Nome <email>"` sapendo cosa si sta facendo.
# - Validazione preliminare: typecheck TS backend/frontend, lint frontend, build Vite e test
#   Vitest (100% verdi).
# - Railway up per il backend e Vercel deploy per il frontend, con verifica post-deploy
#   dell'health e della sonda rotta sul dominio di produzione.
#
# Uso:
#   ./scripts/distribuisci.sh              # verifica, push, vercel deploy, railway up
#   ./scripts/distribuisci.sh --solo-push  # solo il frontend (push + vercel)
#   ./scripts/distribuisci.sh --solo-api   # solo il backend (railway up)
#
set -euo pipefail

cd "$(dirname "$0")/.."

RAILWAY="${RAILWAY_BIN:-$(command -v railway 2>/dev/null || echo "$HOME/.railway/bin/railway")}"
API_BASE="${API_BASE:-https://bluman-api-production.up.railway.app}"
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

# 1. Identità Git: si CONFIGURA, non si corregge a posteriori. Il config locale vale per i
# commit FUTURI di questo repo; la verifica sull'ultimo commit (punto 3) è bloccante.
git config user.email "$REQUIRED_GIT_EMAIL"
git config user.name "$REQUIRED_GIT_NAME"

titolo "1. Verifica integrità e test prima di distribuire"
echo "• Controllo Typecheck Backend..."
npx tsc --noEmit
successo "Typecheck Backend superato."

echo "• Controllo Typecheck Frontend..."
(cd frontend && npm run typecheck)
successo "Typecheck Frontend superato."

echo "• Lint Frontend (oxlint)..."
(cd frontend && npm run lint)
successo "Lint Frontend superato."

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

# 3. Controllo Autore e Committer sull'ultimo commit da spingere — BLOCCANTE, niente amend
#    automatico: riscrivere la storia in uno script è un'azione che nessuno vede.
titolo "2. Verifica Autore Git per Vercel"
ULTIMO_AUTORE=$(git log -1 --format="%ae")
ULTIMO_COMMITTER=$(git log -1 --format="%ce")

if [ "$ULTIMO_AUTORE" != "$REQUIRED_GIT_EMAIL" ] || [ "$ULTIMO_COMMITTER" != "$REQUIRED_GIT_EMAIL" ]; then
  echo "ERRORE: l'ultimo commit ha autore ($ULTIMO_AUTORE) o committer ($ULTIMO_COMMITTER)" >&2
  echo "diversi da $REQUIRED_GIT_EMAIL, richiesti da Vercel." >&2
  echo "" >&2
  echo "Correggi A MANO se sei consapevole di cosa comporta:" >&2
  echo "  git commit --amend --no-edit --author=\"$REQUIRED_GIT_NAME <$REQUIRED_GIT_EMAIL>\"" >&2
  echo "" >&2
  echo "e rilancia lo script. Lo script non riscrive la storia da solo." >&2
  exit 1
fi
successo "Autore Git verificato: $REQUIRED_GIT_NAME <$REQUIRED_GIT_EMAIL>."

# 4. Frontend — Push GitHub & Vercel
if [ "$SOLO_API" -eq 0 ]; then
  titolo "3. Frontend — Push GitHub e Deploy Vercel"
  git push origin main
  successo "Push su GitHub (main) completato."

  # La CLI Vercel senza credenziali parte in interactive login e appende lo script per
  # sempre: si verifica PRIMA, e chi lancia sa cosa fare (vercel login apre il browser).
  if npx vercel whoami >/dev/null 2>&1; then
    echo "• Deploy di produzione su Vercel via CLI..."
    if npx vercel --prod --scope fanta-ia --yes; then
      successo "Frontend rilasciato via CLI."
    else
      avviso "Deploy CLI non riuscito: resta il deploy del webhook GitHub (vedi dashboard Vercel)."
    fi
  else
    avviso "CLI Vercel non autenticata: salto il deploy CLI. Il webhook GitHub ha comunque avviato un deploy. Per abilitarlo: npx vercel login"
  fi

  # Il webhook GitHub a volte resta appeso: deployment UNKNOWN, build 0ms, zero log.
  # Si aspetta che l'ULTIMO deployment di produzione diventi Ready, con un tetto di
  # 4 minuti; se resta UNKNOWN è il deployment appeso e serve l'intervento manuale.
  echo "• In attesa che il deployment di produzione sia Ready (max 4 minuti)..."
  ATTESA_OK=0
  for i in $(seq 1 24); do
    ULTIMO_URL=$(npx vercel ls --prod 2>/dev/null | awk '/fanta-ia\.vercel\.app/ {print $NF=="" ? $(NF-1) : $NF; exit}')
    if [ -n "$ULTIMO_URL" ] && [ "$ULTIMO_URL" != "-" ]; then
      STATO=$(npx vercel inspect "$ULTIMO_URL" 2>/dev/null | awk -F'\t' '/status/ {print $2}' | tr -d ' ' | head -1)
      if [ "$STATO" = "READY" ]; then ATTESA_OK=1; break; fi
    fi
    sleep 10
  done
  if [ "$ATTESA_OK" -eq 1 ]; then
    successo "Deployment Vercel di produzione Ready: $ULTIMO_URL"
  else
    avviso "Il deployment Vercel non risulta Ready dopo 4 minuti (stato: ${STATO:-sconosciuto})."
    echo "  Controlla https://vercel.com/fanta-ia/bluman — se è UNKNOWN con build a 0ms è"
    echo "  il deployment appeso: rimuovilo dalla dashboard e rilancia 'npx vercel --prod --scope fanta-ia'."
  fi
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

  # 6. Verifica post-deploy: l'health DEVE rispondere sul dominio di produzione. La build
  #    Railway gira in background (--detach): si attende che il nuovo container risponda,
  #    con un tetto di ~5 minuti. Il fallimento NON è silenzioso.
  titolo "5. Verifica post-deploy su $API_BASE"
  echo "• In attesa del nuovo deploy (health check, max 5 minuti)..."
  HEALTH_OK=0
  for i in $(seq 1 30); do
    if curl -fsS --max-time 10 "$API_BASE/health" >/dev/null 2>&1; then
      HEALTH_OK=1
      break
    fi
    sleep 10
  done
  if [ "$HEALTH_OK" -eq 1 ]; then
    successo "Health check di produzione raggiungibile."
  else
    avviso "Health check NON raggiungibile dopo 5 minuti: controlla '$RAILWAY logs' — il deploy potrebbe essere fallito."
    exit 1
  fi

  # Sonda rotta (pattern presidiato da src/rotteNonTrovate.test.ts): una rotta vera senza
  # token deve dare 401 con corpo {errore}, mai 404. Un 404 qui significa che l'immagine
  # distribuita non contiene la rotta — il caso tipico del deploy dimenticato.
  echo "• Sonda rotta: POST /documenti/genera senza token deve dare 401, non 404..."
  CODICE=$(curl -s -o /dev/null -w '%{http_code}' --max-time 10 -X POST "$API_BASE/documenti/genera" \
    -H 'Content-Type: application/json' -d '{}' || echo "000")
  if [ "$CODICE" = "401" ]; then
    successo "Sonda rotta: 401 come atteso."
  else
    avviso "Sonda rotta ha risposto $CODICE (atteso 401): se 404, l'immagine in produzione è vecchia."
    exit 1
  fi
fi

titolo "🎉 Distribuzione Completata con Successo!"
echo "🌐 Frontend: https://bluman.vercel.app"
echo "⚙️ Backend API: $API_BASE"
