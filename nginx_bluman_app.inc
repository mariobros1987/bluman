# ═════════════════════════════════════════════════════════════════════
# BLUMAN — corpo condiviso dei server block (incluso da nginx.conf su :80 e :443)
# Sta in un file a parte per non duplicare l'instradamento in due posti:
# una sola copia significa che non possono divergere.
# ═════════════════════════════════════════════════════════════════════

client_max_body_size 50M;

# Intestazioni di sicurezza applicabili a qualunque risposta di questa origine.
add_header X-Content-Type-Options "nosniff" always;
add_header X-Frame-Options "DENY" always;
add_header Referrer-Policy "strict-origin-when-cross-origin" always;

# ─────────────────────────────────────────────────────────────────────
# API Fastify — tutto sotto `/api`, e il prefisso si toglie strada facendo.
#
# Qui c'era un elenco di 45 prefissi API scritto a mano, generato dai percorsi reali delle
# rotte. Il 02/10/2026 si è visto cosa costa: `/portal`, `/invoices`, `/fornitori`,
# `/timesheet`, `/liquidazione-iva`, `/reports` e `/admin/tenants` sono ANCHE percorsi della
# SPA, e la regex se li prendeva tutti. Chi ricaricava una di quelle pagine — o apriva un link
# diretto, o un segnalibro — riceveva il 404 dell'API, o un 401, al posto dell'applicazione.
# Nessuno se n'era accorto perché i link interni sono navigazione client-side e non ripassano
# da nginx: si rompeva solo la ricarica.
#
# Col prefisso il problema non esiste per costruzione — `/api/invoices` è l'API, `/invoices` è
# la pagina — e soprattutto non c'è più nessun elenco da tenere aggiornato: una rotta nuova
# nasce già sotto `/api`. Una rotta dimenticata prima tornava `200` con l'HTML della SPA, cioè
# un guasto che sembrava un bug del frontend.
# ─────────────────────────────────────────────────────────────────────
location ^~ /api/ {
    # `proxy_pass` CON uri dentro un location di prefisso sostituisce il prefisso:
    # `/api/invoices?x=1` diventa `http://api:3000/invoices?x=1`. La query string la conserva
    # nginx da sé, senza `rewrite` e senza `$is_args$args`.
    proxy_pass http://api:3000/;
    include /etc/nginx/conf.d/bluman_proxy.inc;
}

# ─────────────────────────────────────────────────────────────────────
# Le tre eccezioni — percorsi che NON stanno sotto `/api`, ognuno per un motivo che non
# dipende da questo repository. Non sono dimenticanze: non vanno «sistemate» spostandole.
#
# `^~` e non il prefisso nudo: se un domani qualcuno aggiunge un location con regex, senza `^~`
# gliela soffierebbe, e la soffierebbe in silenzio.
# ─────────────────────────────────────────────────────────────────────

# L'indirizzo lo compone `urlPubblicaBackend()` (src/util/urlPubblica.ts) e lo consegna a Meta
# e a Telegram. Spostarlo sotto /api non è una riga di nginx: è ri-registrare il webhook presso
# due fornitori esterni — e Telegram ha un solo slot webhook, oggi occupato da Railway.
# `proxy_pass` SENZA uri passa il percorso invariato.
location ^~ /webhooks/ {
    proxy_pass http://api:3000;
    include /etc/nginx/conf.d/bluman_proxy.inc;
}

# Il vault dei documenti. Gli URL sono salvati a database e già dentro email e documenti
# spediti: cambiarne la forma sarebbe una migrazione di dati, non una modifica di configurazione.
# Servirli staticamente sarebbe peggio: chiunque conosca il nome del file lo scaricherebbe senza
# token e senza tenant. L'autorizzazione la fa `GET /uploads/:filename` (src/routes/catalogo.ts),
# che pretende il Bearer oppure una firma HMAC a scadenza e blocca il path traversal.
location ^~ /uploads/ {
    proxy_pass http://api:3000;
    include /etc/nginx/conf.d/bluman_proxy.inc;
}

# L'URL che interroga il monitor del VPS (scripts/monitor-vps.sh, `BLUMAN_MONITOR_HEALTH_URL`).
# Se finisse sulla SPA il controllo non direbbe «ok» per sbaglio — `controlla_health` pretende
# `"db":"ok"` nel corpo, non si accontenta del 200 — ma darebbe un falso allarme a ogni giro.
location = /health {
    proxy_pass http://api:3000/health;
    include /etc/nginx/conf.d/bluman_proxy.inc;
}

# ─────────────────────────────────────────────────────────────────────
# Frontend SPA — tutto il resto.
# ─────────────────────────────────────────────────────────────────────
location / {
    root /usr/share/nginx/html;
    index index.html;
    try_files $uri $uri/ /index.html;
}
