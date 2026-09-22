# ═════════════════════════════════════════════════════════════════════
# BLUMAN — corpo condiviso dei server block (incluso da nginx.conf su :80 e :443)
# Sta in un file a parte per non duplicare l'elenco dei prefissi API in due posti:
# una sola copia significa che non possono divergere.
# ═════════════════════════════════════════════════════════════════════

client_max_body_size 50M;

# Intestazioni di sicurezza applicabili a qualunque risposta di questa origine.
add_header X-Content-Type-Options "nosniff" always;
add_header X-Frame-Options "DENY" always;
add_header Referrer-Policy "strict-origin-when-cross-origin" always;

# ─────────────────────────────────────────────────────────────────────
# API Fastify — l'elenco è generato dai percorsi reali delle rotte, non dai nomi dei
# file di src/routes/. Presidio: src/infrastrutturaDeploy.test.ts.
# `/uploads/` è qui e non servito staticamente: l'autorizzazione la fa la rotta.
# ─────────────────────────────────────────────────────────────────────
location ~ ^/(addendum|admin|articoli|audit-logs|auth|calendario|checklist|clienti|comunicazioni|contabilita|conti-bancari|contratti-ricorrenti|cron|documenti|documenti-template|fatture|fatture-ricevute|firme|fornitori|giurisdizioni|health|invoices|kyc|liquidazione-iva|microvoci|moduli|moduli-template|notifiche|operatori-suggeriti|passaggi|portal|preventivi|prima-nota|progetti|proposte-dati|reports|search|stream|tenant|timesheet|upload|uploads|webhooks)(/|$) {
    proxy_pass http://api:3000;
    proxy_http_version 1.1;
    proxy_set_header Upgrade $http_upgrade;
    proxy_set_header Connection 'upgrade';
    proxy_set_header Host $host;
    proxy_cache_bypass $http_upgrade;
    proxy_set_header X-Real-IP $remote_addr;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    # L'IP e lo schema che il server registra nel sigillo di firma (regola 7) arrivano
    # da qui: senza questi header l'audit vedrebbe l'IP del container nginx.
    proxy_set_header X-Forwarded-Proto $scheme;
    proxy_read_timeout 90s;

    # Server-Sent Events: senza `buffering off` le notifiche restano nel buffer di nginx
    # e arrivano a blocchi, o non arrivano affatto.
    proxy_buffering off;
}

# ─────────────────────────────────────────────────────────────────────
# Frontend SPA
# ─────────────────────────────────────────────────────────────────────
location / {
    root /usr/share/nginx/html;
    index index.html;
    try_files $uri $uri/ /index.html;
}
