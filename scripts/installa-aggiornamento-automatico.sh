#!/usr/bin/env bash
#
# installa-aggiornamento-automatico.sh [--togli]
#
# Mette (o toglie) nel cron dell'utente `bluman` la riga che lancia ogni 10 minuti
# `scripts/aggiorna-blusmart-auto.sh`. Gira SUL SERVER, in /opt/bluman, una volta sola; dal PC
# lo lancia Fabio (DEPLOY.md):
#
#   ssh blusmart "cd /opt/bluman && git pull --ff-only && bash scripts/installa-aggiornamento-automatico.sh"
#
# Si può rilanciare: la riga c'è una volta sola. Le altre righe del cron (backup notturno,
# sorveglianza) restano come sono, e lo script verifica che ci siano ancora dopo la scrittura.
# Prima di scrivere controlla che main si legga da GitHub senza chiedere niente e che il bot
# degli avvisi sia configurato, poi fa un giro di prova a vuoto.
set -euo pipefail
cd "$(cd "$(dirname "$0")/.." && pwd)"

MARCA="# bluman-aggiornamento-automatico"
RIGA="*/10 * * * * cd $(pwd) && bash scripts/aggiorna-blusmart-auto.sh >> /var/log/bluman/aggiorna-auto.log 2>&1 $MARCA"
TOGLI=no
for a in "$@"; do
  case "$a" in
    --togli) TOGLI=si ;;
    *) echo "argomento sconosciuto: $a (ammesso: --togli)" >&2; exit 2 ;;
  esac
done
errore() { printf 'ERRORE: %s\n' "$1" >&2; exit 1; }

[ -f docker-compose.prod.yml ] && [ -f scripts/aggiorna-blusmart-auto.sh ] \
  || errore "qui non c'è il repo di BluMan aggiornato: lo script va lanciato sul server, in /opt/bluman, dopo git pull."
[ "$(id -un)" != root ] || errore "va lanciato come utente bluman, non root: il cron giusto è il suo."

# `crontab -l` senza cron risponde 1 con «no crontab»: quello è un cron vuoto. Qualunque altro
# errore no, e scrivere sopra un cron che non si è letto cancellerebbe backup e sorveglianza.
if ATTUALE="$(crontab -l 2>&1)"; then :; else
  grep -qi 'no crontab' <<<"$ATTUALE" || errore "non riesco a leggere il cron: $ATTUALE"
  ATTUALE=""
fi
ALTRE="$(grep -vF "$MARCA" <<<"$ATTUALE" || true)"

if [ "$TOGLI" = si ]; then
  printf '%s\n' "$ALTRE" | crontab -
  echo "✔ Aggiornamento automatico tolto dal cron. blusmart.eu torna ad aggiornarsi a mano (aggiorna-blusmart.sh --applica)."
  exit 0
fi

GIT_TERMINAL_PROMPT=0 git ls-remote --exit-code origin main </dev/null >/dev/null \
  || errore "non riesco a leggere main di origin senza chiavi né password: il cron non potrebbe aggiornare. (git remote -v)"
echo "✔ main di GitHub si legge senza chiavi."
[ -r /etc/bluman/monitor.env ] && grep -q '^BLUMAN_AVVISI_BOT_TOKEN=' /etc/bluman/monitor.env \
  && echo "✔ Bot degli avvisi configurato: inizio ed esito di ogni aggiornamento arrivano su Telegram." \
  || echo "⚠️ /etc/bluman/monitor.env non si legge o non ha il bot: gli aggiornamenti girano lo stesso, ma senza avvisi."
[ -s .git/bluman-ultimo-aggiornamento ] \
  || errore "manca .git/bluman-ultimo-aggiornamento: prima un aggiornamento a mano con aggiorna-blusmart.sh --applica."
mkdir -p /var/log/bluman 2>/dev/null || true
[ -w /var/log/bluman ] || errore "/var/log/bluman non è scrivibile dall'utente $(id -un): il cron non avrebbe dove scrivere."

{ [ -n "$ALTRE" ] && printf '%s\n' "$ALTRE"; printf '%s\n' "$RIGA"; } | crontab -
DOPO="$(crontab -l)"
[ "$(grep -cF "$MARCA" <<<"$DOPO")" = 1 ] || errore "la riga dell'aggiornamento automatico non risulta nel cron."
[ "$(grep -vF "$MARCA" <<<"$DOPO" || true)" = "$ALTRE" ] || errore "le altre righe del cron sono cambiate: controlla con crontab -l."
echo "✔ Cron: ogni 10 minuti; le altre righe sono rimaste com'erano."

echo
echo "Giro di prova (non tocca niente):"
bash scripts/aggiorna-blusmart-auto.sh --prova || true
echo
echo "Fatto. Per una pausa: touch $(pwd)/.git/bluman-auto-pausa (e rm per riprendere)."
echo "Per togliere tutto:   bash scripts/installa-aggiornamento-automatico.sh --togli"
