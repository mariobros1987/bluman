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
# ⚠️ LA CREDENZIALE DELLA COPIA OFF-SITE NON STA NEL .env, e non è un dettaglio: il .env è una
#    delle tre cose che questo script archivia e spedisce su Dropbox, quindi una credenziale
#    scritta lì viaggerebbe insieme alla cassaforte che apre. Sta in un file a parte,
#    `$DIR_CONFIG_BACKUP/rclone.conf`, che scrive l'API dal pannello del super admin (voce
#    8-bis, 10/10/2026), con permessi 0640 di `1000:bluman`. La **destinazione** invece è
#    configurazione e resta nel .env: non è un segreto e da sola non autentica niente.
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

# Le due cartelle della copia off-site (voce 8-bis). `config/` la scrive l'API, `stato/` la
# scrive questo script e la legge l'API: sono montate nei container come CARTELLE e non come
# file singoli, così una sostituzione via `rename` si vede subito (lezione nginx del 09/10).
DIR_CONFIG_BACKUP="${BLUMAN_BACKUP_CONFIG_DIR:-/var/lib/bluman-backup/config}"
CONFIG_RCLONE="$DIR_CONFIG_BACKUP/rclone.conf"
DIR_STATO_BACKUP="${BLUMAN_BACKUP_STATO_DIR:-/var/lib/bluman-backup/stato}"

# ── STATO PER L'APPLICAZIONE ─────────────────────────────────────────
# L'esito si deposita in un file che l'API legge e mostra nel pannello: senza, un backup
# fallito alle 03:17 resta invisibile fino al giorno del restore. Il trap su EXIT copre il caso
# peggiore — lo script che muore a metà (dump vuoto, volume assente) — perché scriva comunque
# l'esito invece di lasciare in vista il successo della notte prima.
STATO_SCRITTO=0
ESITO_LOCALE="fallito"
ESITO_LOCALE_DETTAGLIO="il backup si è interrotto prima di concludersi"
COPIA_OFFSITE="saltata"
COPIA_DETTAGLIO="il backup non è arrivato al passo della copia"
FILE_DB=""
BYTE_DB="null"

# Toglie virgolette, barre e a capo dal testo libero: il file dev'essere JSON valido anche se
# un dettaglio li contiene, e il dettaglio non deve poter rompere il file che l'app legge.
solo_testo_sicuro() { printf '%s' "${1:-}" | tr -d '"\\' | tr '\n\r\t' '   '; }
valore_json() { if [ -n "${1:-}" ]; then printf '"%s"' "$(solo_testo_sicuro "$1")"; else printf 'null'; fi; }

scrivi_stato_backup() {
  [ "$STATO_SCRITTO" -eq 1 ] && return 0
  [ -d "$DIR_STATO_BACKUP" ] || return 0
  # File temporaneo + rinomina: l'API può leggere questo file in qualunque momento, e un
  # mezzo JSON verrebbe interpretato come «sconosciuto» — cioè un falso allarme.
  if {
    printf '{\n'
    printf '  "esito": "%s",\n' "$ESITO_LOCALE"
    printf '  "quando": "%s",\n' "$(date -u '+%Y-%m-%dT%H:%M:%SZ')"
    printf '  "file": %s,\n' "$(valore_json "$FILE_DB")"
    printf '  "byte": %s,\n' "$BYTE_DB"
    printf '  "copiaOffSite": "%s",\n' "$COPIA_OFFSITE"
    printf '  "dettaglio": "%s"\n' "$(solo_testo_sicuro "$ESITO_LOCALE_DETTAGLIO")"
    printf '}\n'
  } > "$DIR_STATO_BACKUP/backup.json.tmp" 2>/dev/null; then
    mv -f "$DIR_STATO_BACKUP/backup.json.tmp" "$DIR_STATO_BACKUP/backup.json" 2>/dev/null \
      && STATO_SCRITTO=1
  fi
  return 0
}
trap 'codice=$?; scrivi_stato_backup || true; exit $codice' EXIT

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
# Il nome e la dimensione del dump si fissano qui (dopo la cifratura il file non cifrato non
# esiste più): sono i due numeri che finiscono nello stato letto dall'applicazione.
FILE_DB="$(basename "$FILE")"

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
#
# La *destinazione* (`dropbox:bluman-backup`) si legge dal .env; la *credenziale* sta in
# `$CONFIG_RCLONE`, che scrive l'API dal pannello del super admin. Le due cose mancano in modo
# diverso e vanno dette in modo diverso: una destinazione senza credenziale non è «non
# configurato», è una copia che **non parte** — e il verso giusto in cui sbagliare è rumoroso.
BYTE_DB="$(stat -c %s "$DEST/bluman_${TS}.dump.enc" 2>/dev/null \
  || stat -c %s "$DEST/bluman_${TS}.dump" 2>/dev/null || printf 'null')"

if [ -z "${BLUMAN_BACKUP_RCLONE_REMOTE:-}" ]; then
  echo "ℹ️  Nessuna copia off-site (imposta BLUMAN_BACKUP_RCLONE_REMOTE e installa rclone)."
  echo "    ⚠️  Finché non c'è, i backup stanno sullo STESSO disco del database."
  COPIA_DETTAGLIO="nessuna destinazione configurata (BLUMAN_BACKUP_RCLONE_REMOTE)"
elif ! command -v rclone >/dev/null 2>&1; then
  COPIA_OFFSITE="fallita"
  COPIA_DETTAGLIO="destinazione impostata ma rclone non è installato sul server"
  echo "⚠️  BLUMAN_BACKUP_RCLONE_REMOTE è impostata ma rclone NON è installato: la copia non è partita." >&2
elif [ ! -s "$CONFIG_RCLONE" ]; then
  COPIA_OFFSITE="fallita"
  COPIA_DETTAGLIO="credenziale assente: $CONFIG_RCLONE non esiste (va salvata dal pannello del super admin)"
  echo "⚠️  Destinazione impostata ma la credenziale non c'è: nessuna copia off-site." >&2
  echo "    Salva il token rclone dal pannello «Backup off-site» e riprova." >&2
else
  # Il nome del remote è la parte prima dei due punti (`dropbox:bluman-backup` → `dropbox`).
  NOME_REMOTE="${BLUMAN_BACKUP_RCLONE_REMOTE%%:*}"
  if ! grep -q "^\[${NOME_REMOTE}\]" "$CONFIG_RCLONE"; then
    # Senza questo controllo rclone fallirebbe con un errore che parla d'altro («didn't find
    # section in config»), cioè del file sbagliato invece che della destinazione sbagliata.
    COPIA_OFFSITE="fallita"
    COPIA_DETTAGLIO="la credenziale non definisce il remote '${NOME_REMOTE}'"
    echo "⚠️  La credenziale in $CONFIG_RCLONE non definisce il remote '${NOME_REMOTE}': copia non partita." >&2
  else
    FALLITI=0
    for f in "${ARTEFATTI[@]}"; do
      if [ "$CIFRATO" -eq 1 ]; then f="${f}.enc"; fi
      if rclone --config "$CONFIG_RCLONE" copy "$f" "$BLUMAN_BACKUP_RCLONE_REMOTE" </dev/null; then
        echo "[$(date -Is)] Copiato off-site: $(basename "$f")"
      else
        FALLITI=$((FALLITI + 1))
        echo "⚠️  Copia off-site FALLITA per $(basename "$f")" >&2
      fi
    done
    if [ "$FALLITI" -eq 0 ]; then
      COPIA_OFFSITE="ok"
      COPIA_DETTAGLIO="$(( ${#ARTEFATTI[@]} )) artefatti copiati su $BLUMAN_BACKUP_RCLONE_REMOTE"
      echo "[$(date -Is)] Copiati off-site su $BLUMAN_BACKUP_RCLONE_REMOTE"
    else
      COPIA_OFFSITE="fallita"
      COPIA_DETTAGLIO="${FALLITI} su ${#ARTEFATTI[@]} artefatti non copiati"
    fi
  fi
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

# ── 7. STATO PER L'APPLICAZIONE ──────────────────────────────────────
# Due fatti distinti, due campi distinti: `esito` dice se il backup locale è riuscito,
# `copiaOffSite` se è uscito da questa macchina. Fonderli nasconderebbe proprio il caso che
# questa voce esiste per rendere visibile — il backup che si dichiara riuscito e non è mai
# arrivato su Dropbox.
ESITO_LOCALE="ok"
ESITO_LOCALE_DETTAGLIO="database, documenti e segreti archiviati, cifrati e ruotati"
if [ "$COPIA_OFFSITE" != "ok" ]; then
  ESITO_LOCALE_DETTAGLIO="$ESITO_LOCALE_DETTAGLIO; copia off-site: $COPIA_DETTAGLIO"
fi
scrivi_stato_backup

# ── RESTORE-TEST (da eseguire A MANO, periodicamente, su un DB usa-e-getta) ──
# Non basta l'exit code: un dump che si apre ma è vuoto passa ogni controllo superficiale.
# Si confrontano i CONTEGGI con la produzione (§5.6 del piano: due numeri uguali con i file
# sbagliati è il caso che sembra a posto e non lo è).
#
#   set -a; . /opt/bluman/.env; set +a      # serve BACKUP_ENCRYPTION_KEY e POSTGRES_USER
#   D=/var/backups/bluman
#
#   # 1) DATABASE
#   # `-pass stdin` e non `-pass "pass:$BACKUP_ENCRYPTION_KEY"`: così la chiave non compare
#   # nella riga di comando, cioè in `ps` per chiunque sia sulla macchina in quel momento.
#   printf '%s' "$BACKUP_ENCRYPTION_KEY" | openssl enc -d -aes-256-cbc -pbkdf2 \
#     -in $D/bluman_XXXX.dump.enc -pass stdin -out /tmp/t.dump
#   # `-d --rm` con i dati in tmpfs: se il test si interrompe non resta un cluster da svuotare.
#   docker run -d --rm --name pgtest -e POSTGRES_PASSWORD=test \
#     --tmpfs /var/lib/postgresql/data:rw,size=512m postgres:17-alpine
#   for i in $(seq 1 40); do docker exec pgtest pg_isready -U postgres -q && break; sleep 1; done
#   # I RUOLI VENGONO PRIMA DEL RESTORE. Il dump contiene le policy di isolamento dei tenant
#   # (`CREATE POLICY ... TO bluman_app`): senza il ruolo la policy non si crea e un dump sano
#   # produce 293 errori. I nomi veri si leggono con `\du` — qui sono quelli di produzione.
#   docker exec pgtest psql -U postgres -qc "CREATE ROLE bluman_owner NOLOGIN; CREATE ROLE bluman_app NOLOGIN;"
#   docker exec pgtest createdb -U postgres t
#   # `pg_trgm` va creata a mano: su un cluster nuovo non c'è, e la migrazione dei trigram
#   # ingoia l'errore invece di fermarsi (vedi la nota sul VPS nuovo).
#   docker exec pgtest psql -U postgres -d t -qc 'CREATE EXTENSION IF NOT EXISTS pg_trgm;'
#   docker cp /tmp/t.dump pgtest:/t.dump
#   docker exec pgtest pg_restore --no-owner --no-acl -U postgres -d t /t.dump
#   # Deve uscire 0 e non stampare NIENTE: un restore con errori non è riuscito, anche se le
#   # tabelle ci sono. Poi i conteggi devono COINCIDERE con la produzione, non solo essere > 0:
#   docker exec pgtest psql -U postgres -d t -c "select count(*) from cliente;"
#   docker exec bluman_postgres psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" -c "select count(*) from cliente;"
#   # Un conteggio che non torna va spiegato con ciò che è cambiato DOPO il backup (righe
#   # cancellate, migrazioni applicate), non ignorato: è lì che si nasconde il dump sbagliato.
#   docker rm -f pgtest
#
#   # 2) DOCUMENTI — i file devono essere tanti quanti ne dichiara il database
#   printf '%s' "$BACKUP_ENCRYPTION_KEY" | openssl enc -d -aes-256-cbc -pbkdf2 \
#     -in $D/bluman_XXXX_uploads.tar.gz.enc -pass stdin | tar -tzf - | wc -l
#   # e il confronto che conta davvero: documenti in tabella SENZA il loro file.
#   # La colonna del percorso è `file_url`, non `percorso` (`file_pdf_url`/`file_docx_url`
#   # sono le copie nei due formati e vanno guardate solo se valorizzate).
#   docker exec bluman_postgres psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" -tAc \
#     "select count(*) from documento where file_url like '/uploads/%'"
#
#   # 3) SEGRETI — il .env deve riaprirsi e contenere le chiavi attese
#   printf '%s' "$BACKUP_ENCRYPTION_KEY" | openssl enc -d -aes-256-cbc -pbkdf2 \
#     -in $D/bluman_XXXX_env.tar.gz.enc -pass stdin | tar -xzO .env \
#     | grep -cE '^(JWT_SECRET|SIGILLO_HMAC_SECRET|BACKUP_ENCRYPTION_KEY)='
