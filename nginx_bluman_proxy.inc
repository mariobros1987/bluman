# ═════════════════════════════════════════════════════════════════════
# BLUMAN — direttive di proxy condivise dai location che parlano con Fastify
# ═════════════════════════════════════════════════════════════════════
#
# Estratto perché i location che parlano con l'API sono diventati quattro (`/api/`,
# `/webhooks/`, `/uploads/`, `/health`) e le stesse dieci righe stavano per essere copiate
# quattro volte. Non è ordine: gli header qui sotto sono la prova che l'audit registra, e un
# location che ne dimentica uno scrive nel registro l'IP del container nginx invece di quello
# di chi ha firmato (regola 7). Quattro copie significano quattro occasioni di divergere.
#
# Non contiene nessun `location`: viene incluso DENTRO un blocco. Il nome finisce in `.inc` e non
# in `.conf` perché nginx carica da solo tutti i `*.conf` di `conf.d/`, e direttive di proxy
# fuori da un `location` farebbero fallire l'avvio.

proxy_http_version 1.1;
proxy_set_header Upgrade $http_upgrade;
proxy_set_header Connection 'upgrade';
proxy_set_header Host $host;
proxy_cache_bypass $http_upgrade;
proxy_set_header X-Real-IP $remote_addr;
proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
proxy_set_header X-Forwarded-Proto $scheme;
proxy_read_timeout 90s;

# Server-Sent Events: senza `buffering off` le notifiche restano nel buffer di nginx e arrivano
# a blocchi, o non arrivano affatto.
proxy_buffering off;
