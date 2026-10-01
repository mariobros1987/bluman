#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────────────
# BLUMAN — backup del VPS (Opzione «tutto su VPS»).
# Sostituisce i backup automatici che prima dava Supabase (§8 del PIANO_MIGRAZIONE_VPS).
#
# Cosa copre — TRE cose, e tutte e tre servono per ripartire:
#   1. il DATABASE         → pg_dump --format=custom dentro il container postgres
#   2. i DOCUMENTI         → archivio del volume `bluman_uploads` (/app/uploads)
#   3. i SEGRETI           → il file `.env` accanto al compose
#
# Perché anche i documenti: il database non contiene i file, contiene i loro **percorsi**.
# Un restore del solo database dà un archivio pieno di link che non portano a niente — è
# la situazione «20 documenti, 8 senza il loro file» già vista il 01/10/2026.
# Perché anche il .env: `JWT_SECRET`, `SIGILLO_HMAC_SECRET`, `SMTP_*` e i token dei canali
# NON sono in git. Senza quel file l'applicazione non riparte, nemmeno col database intatto.
#
# Ogni artefatto è cifrato con BACKUP_ENCRYPTION_KEY (AES-256), si ruota e — se configurato —
# va anche off-site.
#
# ⚠️ DOVE FINISCONO I BACKUP. Il default è `/var/backups/bluman`, scelto perché sta **fuori**
#    da due posti che si cancellano da soli:
#      · fuori da `/opt/bluman`   → un deploy andato storto, un `git clean -xfd` o un `rm`
#                                    nella cartella dell'app non portano via i backup;
#      · fuori da `/var/lib/docker/volumes` → `docker compose down -v` distrugge i volumi,
#                                    non /var/backups.
#    Questo protegge dagli ERRORI APPLICATIVI. **Non** protegge dalla morte del disco o del
#    server: su questa macchina c'è un solo filesystem (/dev/vda1). L'unica copia che
#    sopravvive al server è quella off-site, ed è per questo che esiste il passo rclone.
#
# ⚠️ LA CHIAVE DI CIFRATURA STA DENTRO IL .env CHE VIENE CIFRATO CON SÉ STESSA. Finché il
#    server è vivo la chiave si legge da lì e il restore funziona. Se il server muore, senza
#    una copia della chiave **fuori dal server** (gestore di password) i backup off-site
#    cifrati non si aprono più.
#
# ⚠️ Un backup mai ripristinato NON è un backup: testa il restore (vedi in fondo) prima di
#    fidarti. Il test copre tutte e tre le parti, non solo il database.
#
# Da mettere in cron sul VPS (l'utente `bluman` è nel gruppo docker, quindi non serve root):
#   17 3 * * *  cd /opt/bluman && ./scripts/backup-vps.sh >> /var/log/bluman/backup.log 2>&1
set -euo pipefail

cd "$(dirname "$0")/.."
REPO_ROOT="$(pwd)"

COMPOSE="docker compose -f docker-compose.prod.yml"
DEST="${BLUMAN_BACKUP_DIR:-/var/backups/bluman}"
RETENZIONE="${BLUMAN_BACKUP_KEEP:-14}"   # quanti backup tenere (per ogni tipo di artefatto)
TS="$(date +%Y%m%d_%H%M%S)"
mkdir -p "$DEST"

# Le credenziali DB dal .env accanto al compose (owner: può leggere tutto per il dump).
set -a; . ./.env; set +a
: "${POSTGRES_USER:?manca POSTGRES_USER nel .env}"
: "${POSTGRES_DB:?manca POSTGRES_DB nel .env}"

# Gli artefatti di questa esecuzione, riempito man mano: cifratura e rotazione girano su tutti.
ARTEFATTI=()

# ── 1. DATABASE ──────────────────────────────────────────────────────
FILE="$DEST/bluman_${TS}.dump"
echo "[$(date -Is)] Dump di ${POSTGRES_DB}…"
# `</dev/null` su ogni chiamata a docker: il container eredita lo stdin e, invocato via ssh,
# se lo mangia — la sessione si interrompe a metà SENZA errore. È la trappola già pagata due
# volte in questo progetto (vedi distribuisci.sh), e l'ha ripagata il primo test di questo
# script: metà delle righe sparite e nessun messaggio.
$COMPOSE exec -T postgres pg_dump -U "$POSTGRES_USER" -d "$POSTGRES_DB" --format=custom > "$FILE" </dev/null
[ -s "$FILE" ] || { echo "ERRORE: dump vuoto"; rm -f "$FILE"; exit 1; }
ARTEFATTI+=("$FILE")

# ── 2. DOCUMENTI (volume uploads) ────────────────────────────────────
# Il nome del volume non si indovina: il progetto compose lo prefissa. Si legge dal container
# api in esecuzione (autorevole) e si ripiega sul nome atteso. Se il volume non esiste lo
# script si FERMA: un archivio senza documenti è peggio di nessun archivio, perché sembra
# riuscito.
VOLUME_UPLOADS="${BLUMAN_UPLOADS_VOLUME:-}"
if [ -z "$VOLUME_UPLOADS" ]; then
  VOLUME_UPLOADS="$(docker inspect bluman_api \
    --format '{{range .Mounts}}{{if eq .Destination "/app/uploads"}}{{.Name}}{{end}}{{end}}' 2>/dev/null || true)"
fi
VOLUME_UPLOADS="${VOLUME_UPLOADS:-bluman_bluman_uploads}"
if ! docker volume inspect "$VOLUME_UPLOADS" >/dev/null 2>&1; then
  echo "ERRORE: volume '$VOLUME_UPLOADS' non trovato. I documenti NON sono stati salvati." >&2
  echo "  Trova il nome vero: docker volume ls | grep uploads" >&2
  exit 1
fi

FILE="$DEST/bluman_${TS}_uploads.tar.gz"
echo "[$(date -Is)] Archivio dei documenti dal volume ${VOLUME_UPLOADS}…"
# `--entrypoint tar` esplicito: l'immagine postgres ha un entrypoint suo che altrimenti
# interpreterebbe gli argomenti. Il volume si monta in sola lettura (:ro) di proposito:
# un backup non deve poter scrivere nel posto che sta fotografando.
docker run --rm --entrypoint tar -v "${VOLUME_UPLOADS}:/data:ro" postgres:17-alpine \
  -C /data -czf - . > "$FILE" </dev/null
[ -s "$FILE" ] || { echo "ERRORE: archivio documenti vuoto"; rm -f "$FILE"; exit 1; }
N_DOCUMENTI="$(tar -tzf "$FILE" | grep -cv '/$' || true)"
echo "[$(date -Is)] Documenti archiviati: ${N_DOCUMENTI} (voci di file, cartelle escluse)"
ARTEFATTI+=("$FILE")

# ── 3. SEGRETI (.env) ────────────────────────────────────────────────
# L'unico pezzo NON ricostruibile da GitHub: tutto il resto (codice, compose, nginx,
# migrazioni) si ritira dal repository.
FILE="$DEST/bluman_${TS}_env.tar.gz"
echo "[$(date -Is)] Copia dei segreti (.env)…"
tar -C "$REPO_ROOT" -czf "$FILE" .env
[ -s "$FILE" ] || { echo "ERRORE: archivio .env vuoto"; rm -f "$FILE"; exit 1; }
ARTEFATTI+=("$FILE")

# ── 4. CIFRATURA A RIPOSO ────────────────────────────────────────────
if [ -n "${BACKUP_ENCRYPTION_KEY:-}" ]; then
  for f in "${ARTEFATTI[@]}"; do
    openssl enc -aes-256-cbc -pbkdf2 -salt -in "$f" -out "${f}.enc" -pass "pass:${BACKUP_ENCRYPTION_KEY}"
    rm -f "$f"
    echo "[$(date -Is)] Cifrato → $(basename "${f}.enc") ($(du -h "${f}.enc" | cut -f1))"
  done
  CIFRATO=1
else
  echo "⚠️  BACKUP_ENCRYPTION_KEY assente: i backup restano NON cifrati. Impostala in .env."
  CIFRATO=0
fi

# ── 5. COPIA OFF-SITE ────────────────────────────────────────────────
# È l'unica copia che sopravvive alla perdita del server: senza, tutti i backup stanno
# sullo stesso disco del database e spariscono con lui.
if [ -n "${BLUMAN_BACKUP_RCLONE_REMOTE:-}" ] && command -v rclone >/dev/null 2>&1; then
  for f in "${ARTEFATTI[@]}"; do
    [ "$CIFRATO" -eq 1 ] && f="${f}.enc"
    rclone copy "$f" "$BLUMAN_BACKUP_RCLONE_REMOTE"
  done
  echo "[$(date -Is)] Copiati off-site su $BLUMAN_BACKUP_RCLONE_REMOTE"
else
  echo "ℹ️  Nessuna copia off-site (imposta BLUMAN_BACKUP_RCLONE_REMOTE e installa rclone)."
  echo "    ⚠️  Finché non c'è, i backup stanno sullo STESSO disco del database."
fi

# ── 6. ROTAZIONE ─────────────────────────────────────────────────────
# Un conteggio per tipo, così un tipo non viene mai sfoltito per colpa di un altro.
# `|| true` necessario: con `pipefail` un `ls` che non trova nulla (prima esecuzione, o tipo
# ancora assente) farebbe uscire la pipeline con errore e `set -e` interromperebbe lo script
# PROPRIO alla fine, dopo un backup riuscito.
for modello in 'bluman_*.dump*' 'bluman_*_uploads.tar.gz*' 'bluman_*_env.tar.gz*'; do
  ls -1t "$DEST"/$modello 2>/dev/null | tail -n +"$((RETENZIONE + 1))" | xargs -r rm -f || true
done
echo "[$(date -Is)] Fatto. Conservati: $(ls -1 "$DEST"/bluman_*.dump* 2>/dev/null | wc -l) database, \
$(ls -1 "$DEST"/bluman_*_uploads.tar.gz* 2>/dev/null | wc -l) documenti, \
$(ls -1 "$DEST"/bluman_*_env.tar.gz* 2>/dev/null | wc -l) segreti."

# ── RESTORE-TEST (da eseguire A MANO, periodicamente, su un DB usa-e-getta) ──
# Non basta l'exit code: un dump che si apre ma è vuoto passa ogni controllo superficiale.
# Si confrontano i CONTEGGI con la produzione (§5.6 del piano: due numeri uguali con i file
# sbagliati è il caso che sembra a posto e non lo è).
#
#   set -a; . /opt/bluman/.env; set +a      # serve BACKUP_ENCRYPTION_KEY e POSTGRES_USER
#   D=/var/backups/bluman
#
#   # 1) DATABASE
#   openssl enc -d -aes-256-cbc -pbkdf2 -in $D/bluman_XXXX.dump.enc -pass "pass:$BACKUP_ENCRYPTION_KEY" -out /tmp/t.dump
#   docker run --rm -e POSTGRES_PASSWORD=test -d --name pgtest postgres:17-alpine
#   sleep 5
#   docker cp /tmp/t.dump pgtest:/t.dump
#   docker exec pgtest sh -c 'createdb -U postgres t && pg_restore --no-owner -U postgres -d t /t.dump'
#   # i conteggi devono COINCIDERE con la produzione, non solo essere > 0:
#   docker exec pgtest psql -U postgres -d t -c "select count(*) from cliente;"
#   docker exec bluman_postgres psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" -c "select count(*) from cliente;"
#   docker rm -f pgtest
#
#   # 2) DOCUMENTI — i file devono essere tanti quanti ne dichiara il database
#   openssl enc -d -aes-256-cbc -pbkdf2 -in $D/bluman_XXXX_uploads.tar.gz.enc -pass "pass:$BACKUP_ENCRYPTION_KEY" | tar -tzf - | wc -l
#   # e il confronto che conta davvero: documenti in tabella SENZA il loro file
#   docker exec bluman_postgres psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" -tAc \
#     "select count(*) from documento where percorso like '/uploads/%'"
#
#   # 3) SEGRETI — il .env deve riaprirsi e contenere le chiavi attese
#   openssl enc -d -aes-256-cbc -pbkdf2 -in $D/bluman_XXXX_env.tar.gz.enc -pass "pass:$BACKUP_ENCRYPTION_KEY" | tar -xzO .env | grep -cE '^(JWT_SECRET|SIGILLO_HMAC_SECRET|BACKUP_ENCRYPTION_KEY)='
