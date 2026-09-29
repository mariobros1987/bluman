#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────────────
# BLUMAN — backup del database sul VPS (Opzione «tutto su VPS»).
# Sostituisce i backup automatici che prima dava Supabase (§8 del PIANO_MIGRAZIONE_VPS).
#
# Cosa fa: pg_dump (formato custom) del DB dentro il container postgres, dump cifrato con
# BACKUP_ENCRYPTION_KEY (AES-256), rotazione (tiene gli ultimi N), e — se configurata — copia
# off-site. Da mettere in cron sul VPS, es. ogni notte alle 03:17:
#   17 3 * * *  cd /opt/bluman && ./scripts/backup-vps.sh >> /var/log/bluman-backup.log 2>&1
#
# ⚠️ Un backup mai ripristinato NON è un backup: testa il restore (vedi in fondo) prima di fidarti.
# ⚠️ La copia off-site (altro provider/bucket) è OBBLIGATORIA per un vero disaster recovery:
#    un backup sullo stesso disco del DB sparisce insieme al disco.
set -euo pipefail

cd "$(dirname "$0")/.."

COMPOSE="docker compose -f docker-compose.prod.yml"
DEST="${BLUMAN_BACKUP_DIR:-./backups}"
RETENZIONE="${BLUMAN_BACKUP_KEEP:-14}"   # quanti backup tenere
TS="$(date +%Y%m%d_%H%M%S)"
mkdir -p "$DEST"

# Le credenziali DB dal .env accanto al compose (owner: può leggere tutto per il dump).
set -a; . ./.env; set +a
: "${POSTGRES_USER:?manca POSTGRES_USER nel .env}"
: "${POSTGRES_DB:?manca POSTGRES_DB nel .env}"

FILE="$DEST/bluman_${TS}.dump"

echo "[$(date -Is)] Dump di ${POSTGRES_DB}…"
$COMPOSE exec -T postgres pg_dump -U "$POSTGRES_USER" -d "$POSTGRES_DB" --format=custom > "$FILE"
[ -s "$FILE" ] || { echo "ERRORE: dump vuoto"; rm -f "$FILE"; exit 1; }

# Cifratura a riposo, se la chiave c'è. Senza chiave si lascia in chiaro con un avviso.
if [ -n "${BACKUP_ENCRYPTION_KEY:-}" ]; then
  openssl enc -aes-256-cbc -pbkdf2 -salt -in "$FILE" -out "${FILE}.enc" -pass "pass:${BACKUP_ENCRYPTION_KEY}"
  rm -f "$FILE"; FILE="${FILE}.enc"
  echo "[$(date -Is)] Cifrato → $(basename "$FILE")"
else
  echo "⚠️  BACKUP_ENCRYPTION_KEY assente: dump NON cifrato. Impostala in .env."
fi
echo "[$(date -Is)] Backup pronto: $FILE ($(du -h "$FILE" | cut -f1))"

# Copia off-site (rclone verso un remote configurato). Opzionale ma raccomandata.
if [ -n "${BLUMAN_BACKUP_RCLONE_REMOTE:-}" ] && command -v rclone >/dev/null 2>&1; then
  rclone copy "$FILE" "$BLUMAN_BACKUP_RCLONE_REMOTE" && echo "[$(date -Is)] Copiato off-site su $BLUMAN_BACKUP_RCLONE_REMOTE"
else
  echo "ℹ️  Nessuna copia off-site (imposta BLUMAN_BACKUP_RCLONE_REMOTE e installa rclone)."
fi

# Rotazione: tieni gli ultimi $RETENZIONE, elimina i più vecchi.
ls -1t "$DEST"/bluman_*.dump* 2>/dev/null | tail -n +"$((RETENZIONE + 1))" | xargs -r rm -f
echo "[$(date -Is)] Fatto. Backup conservati: $(ls -1 "$DEST"/bluman_*.dump* 2>/dev/null | wc -l)."

# ── RESTORE-TEST (da eseguire A MANO, periodicamente, su un DB usa-e-getta) ──
#   openssl enc -d -aes-256-cbc -pbkdf2 -in bluman_XXXX.dump.enc -pass "pass:$BACKUP_ENCRYPTION_KEY" -out /tmp/t.dump
#   docker run --rm -e POSTGRES_PASSWORD=test -d --name pgtest postgres:17-alpine
#   docker cp /tmp/t.dump pgtest:/t.dump
#   docker exec pgtest sh -c 'createdb -U postgres t && pg_restore --no-owner -U postgres -d t /t.dump'
#   docker exec pgtest psql -U postgres -d t -c "select count(*) from cliente;"   # deve avere righe
#   docker rm -f pgtest
