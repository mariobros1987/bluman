#!/usr/bin/env bash
# backup.sh [sottocartella] [quanti]  — dump -Fc del DB, tiene gli ultimi N.
# Senza argomenti: in BACKUP_DIR, ultimi KEEP_BACKUPS (come prima).
# Il giornaliero (backup.yml, dal 04/11/2026): `backup.sh giornalieri 30`, in
# BACKUP_DIR/giornalieri, separato dalle copie dei deploy: un giorno con molti
# deploy non si mangia i backup dei giorni prima.
# Il dump si scrive in un file .parziale e diventa .dump solo se pg_dump è
# riuscito e pg_restore lo sa leggere: un dump a metà non conta come backup.
set -Eeuo pipefail
# REPO_DIR dall'ambiente quando lo script gira da una copia (backup.yml).
REPO_DIR="${REPO_DIR:-$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)}"
# shellcheck disable=SC1091
source "$REPO_DIR/scripts/deploy.env"
[[ -n "${DB_CONTAINER:-}" ]] || { echo "nessun database configurato"; exit 0; }
DIR="$BACKUP_DIR${1:+/$1}"
TIENI="${2:-$KEEP_BACKUPS}"
[[ "$TIENI" =~ ^[0-9]+$ ]] && (( TIENI > 0 )) || { echo "quanti backup tenere: $TIENI non è un numero"; exit 2; }
mkdir -p "$DIR"
STAMP="$(date +%Y%m%d-%H%M%S)"
F="$DIR/$DB_NAME-$STAMP.dump"
trap 'rm -f "$F.parziale"' EXIT
docker exec "$DB_CONTAINER" pg_dump -U "$DB_USER" -d "$DB_NAME" -Fc > "$F.parziale"
[[ -s "$F.parziale" ]] || { echo "dump vuoto"; exit 1; }
docker exec -i "$DB_CONTAINER" pg_restore -l < "$F.parziale" >/dev/null || { echo "dump illeggibile"; exit 1; }
mv "$F.parziale" "$F"
ls -1t "$DIR"/*.dump | tail -n +"$((TIENI + 1))" | xargs -r rm -f
echo "ok $F ($(du -h "$F" | cut -f1)), $(ls -1 "$DIR"/*.dump | wc -l) copie in $DIR, $(df -h "$DIR" | awk 'NR==2 {print $4}') liberi sul disco"
