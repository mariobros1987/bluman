# VPS — checklist «primo avvio» (dopo aver comprato il server)

Runbook essenziale per accendere lo stack `docker-compose.prod.yml` su un VPS **nuovo**. Presuppone
VPS pronto (Ubuntu, Docker, firewall 22/80/443, Postgres non esposto) e il dettaglio in
`PIANO_MIGRAZIONE_VPS.md`. La catena migrate→rls→api è stata verificata in dry-run locale (PG17).

## 1. Prima di `up`
- [ ] Copia `.env.prod.example` → `.env` accanto al compose e **riempi tutti i segreti**
      (genera con i comandi indicati; `DATABASE_URL`/`DIRECT_URL` le mette il compose, non tu).
- [ ] Se nginx serve anche il frontend: builda il frontend (`cd frontend && npm run build`) — nginx
      monta `frontend/dist`. (Consigliato invece tenere il frontend su Vercel e puntarlo all'API del VPS.)
- [ ] DNS del dominio API → IP del VPS.

## 2. Primo avvio (ancora in HTTP, TLS dopo)
```bash
docker compose -f docker-compose.prod.yml --env-file .env up -d
docker compose -f docker-compose.prod.yml ps -a   # atteso: migrate/rls Exited(0), postgres/api Up
```

## 3. Verifica RLS e isolamento — NON saltare
```bash
docker compose -f docker-compose.prod.yml exec api npx tsx src/scripts/checkRls.ts
#   atteso: RLS attivo su tutte le tabelle (0 spente); tenant inesistente → 0 righe.
docker compose -f docker-compose.prod.yml exec api npx tsx src/scripts/verificaAccessi.ts
#   atteso: i super_admin come «tutti i tenant».
```
Se `checkRls` mostra `bluman_app` con `bypassrls=true` o righe > 0 col tenant finto → **STOP**: gli
studi si vedrebbero a vicenda.

## 4. Dati
- **Fresh** (consigliato, dati di prova): `docker compose … exec api npm run bootstrap` (primo
  super_admin, stampa la password una volta) + seed master (`npm run seed`), poi ricrea i 2 studi.
- **Restore** da Supabase: segui §5 di `PIANO_MIGRAZIONE_VPS.md` (dump→restore→grant→riverifica RLS).

## 5. Smoke test
- [ ] Health: `{"stato":"ok","db":"ok"}`.
- [ ] Login reale → lista progetti + lista clienti + apri un documento.
- [ ] Isolamento via API con due studi diversi (non solo via SQL).

## 6. TLS (dopo che il DNS punta al VPS)
```bash
docker compose -f docker-compose.prod.yml run --rm --entrypoint \
  "certbot certonly --webroot -w /var/www/certbot -d IL.TUO.DOMINIO --email TUA@EMAIL --agree-tos --no-eff-email" certbot
```
Poi in `nginx.conf` scommenta il blocco `server :443` e il `return 301` su :80, sostituisci il dominio,
e `docker compose … exec nginx nginx -s reload`. Il servizio `certbot` rinnova poi da solo.

## 7. Dopo il cut-over
- [ ] Backup in cron: `scripts/backup-vps.sh` (+ `BACKUP_ENCRYPTION_KEY` e copia off-site) e **restore-test**.
- [ ] Monitoraggio disco/connessioni/slow query; aggiornamenti OS+PostgreSQL; rotazione password.
- [ ] Tieni Supabase/Railway **accesi** come rollback per qualche giorno.
