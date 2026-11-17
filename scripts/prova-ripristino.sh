#!/usr/bin/env bash
# Script COMUNE, identico in ogni progetto (dallo standard).
# prova-ripristino.sh — un backup vale solo se si ripristina.
# Prende il giornaliero più recente (BACKUP_DIR/giornalieri, altrimenti l'ultimo
# di BACKUP_DIR), lo ripristina in <DB_NAME>_ripristino nello stesso container,
# conta le righe delle tabelle scritte in progetto.env, cancella la copia. Il database vero non si
# tocca: si scrive solo nella copia, con nome diverso.
# Esce 0 se il ripristino è riuscito e le tabelle di TABELLE_DA_CONTARE hanno
# righe; quelle di TABELLE_DA_MOSTRARE si contano e si mostrano e basta.
# Lo lancia backup.yml il primo giorno del mese (e a mano da Actions).
set -Eeuo pipefail
REPO_DIR="${REPO_DIR:-$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)}"
# shellcheck disable=SC1091
[[ -f "$REPO_DIR/scripts/progetto.env" ]] && source "$REPO_DIR/scripts/progetto.env"
source "$REPO_DIR/scripts/deploy.env"
[[ -n "${DB_CONTAINER:-}" ]] || { echo "nessun database configurato"; exit 0; }
COPIA="${DB_NAME}_ripristino"
[[ "$COPIA" != "$DB_NAME" ]] || exit 1
dump="$(ls -1t "$BACKUP_DIR"/giornalieri/*.dump 2>/dev/null | head -n1 || true)"
[[ -n "$dump" ]] || dump="$(ls -1t "$BACKUP_DIR"/*.dump 2>/dev/null | head -n1 || true)"
[[ -n "$dump" ]] || { echo "nessun backup trovato in $BACKUP_DIR"; exit 1; }
pulisci() { docker exec "$DB_CONTAINER" dropdb -U "$DB_USER" --if-exists "$COPIA" >/dev/null 2>&1 || true; }
trap pulisci EXIT
pulisci
echo "backup: $(basename "$dump") ($(du -h "$dump" | cut -f1), $(( ($(date +%s) - $(stat -c %Y "$dump")) / 3600 )) ore fa)"
docker exec "$DB_CONTAINER" createdb -U "$DB_USER" "$COPIA"
esito=0
# pg_restore esce 1 anche per errori innocui (lo schema public che createdb ha già
# creato): contano gli errori che restano dopo aver tolto quelli.
out="$(docker exec -i "$DB_CONTAINER" pg_restore -U "$DB_USER" -d "$COPIA" --no-owner --no-privileges < "$dump" 2>&1)" || true
errori="$(grep -E '^pg_restore: error' <<<"$out" | grep -v 'schema "public" already exists' || true)"
if [[ -n "$errori" ]]; then echo "errori del ripristino:"; head -n 5 <<<"$errori"; esito=1; else echo "ripristino: ok"; fi
# progetto.env (o deploy.env): TABELLE_DA_CONTARE = tabelle che in produzione non possono essere
# vuote (es. "users"); TABELLE_DA_MOSTRARE = tabelle da contare e basta.
# Senza TABELLE_DA_CONTARE la prova non sa cosa controllare: non è «riuscita».
[[ -n "${TABELLE_DA_CONTARE:-}" ]] || { echo "TABELLE_DA_CONTARE vuota in progetto.env: niente da controllare"; esito=1; }
for t in ${TABELLE_DA_CONTARE:-} ${TABELLE_DA_MOSTRARE:-}; do
  [[ "$t" =~ ^[A-Za-z_][A-Za-z0-9_]*$ ]] || { echo "$t: nome di tabella non valido"; esito=1; continue; }
  n="$(docker exec "$DB_CONTAINER" psql -U "$DB_USER" -d "$COPIA" -tAc "SELECT count(*) FROM \"$t\"" 2>/dev/null | tr -d '[:space:]')" || n=
  echo "$t: ${n:-illeggibile}"
  if [[ " ${TABELLE_DA_CONTARE:-} " == *" $t "* ]]; then [[ "$n" =~ ^[1-9][0-9]*$ ]] || esito=1; fi
done
exit "$esito"
