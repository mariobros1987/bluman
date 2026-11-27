# ARCHITECTURE — BluMan

Com'è fatto **oggi**. Si aggiorna quando cambia la struttura, non a ogni commit.
Ogni dato dichiara se è misurato, dichiarato o ipotizzato. La mappa file per file è
`.agents/AGENTS.md`; il grafo e la storia stanno in README.md; una scheda per modulo in
`docs/manuale/` (che l'app serve a runtime in ❓ Aiuto).

## Topologia
```
browser ──► frontend React 19 + Vite (frontend/)
              │  fetch verso l'API (VITE_API_BASE: /api sul server dello studio, Railway su Vercel)
              ▼
            Fastify 5 (src/server.ts, rotte in src/routes/) ──► Prisma 5 ──► PostgreSQL (RLS, ruolo bluman_app)
              │                                             └► Redis (coda notifiche, cache) se REDIS_URL
              ├► SMTP / IMAP (email studio), WhatsApp Cloud API, Telegram, Signal (src/services/)
              └► uploads/ o Supabase Storage (documenti), PDF (pdfkit), XML SdI
```

## Componenti
| Componente | Dove | Cosa fa |
|---|---|---|
| Server e guardia | `src/server.ts`, `src/plugins/` | avvio Fastify, JWT, whitelist rotte pubbliche, rate limit, `/health` |
| Rotte | `src/routes/` | una per modulo: auth, tenant, progetti, clienti, contabilità (fatture, prima nota, SdI, scadenzario), firma, KYC, portale, webhooks, manuale |
| Logica | `src/services/` | motore fatture e SdI, LIPE, solleciti, firma (livelli, verbale, marca temporale, OTP), KYC/AML, comunicazioni, backup off-site |
| Motore di stato | `src/domain/stateEngine.ts`, `src/services/calcoloService.ts` | stati e percentuali dei progetti (puro + unico punto che scrive) |
| Accessi | `src/util/authorization.ts`, `rbacModuli.ts`, `permessiModulo.ts`, `jwt.ts`, `password.ts`, `totp.ts` | ruoli, permessi per modulo, token, scrypt, 2FA |
| Isolamento | `src/util/prismaClient.ts`, `supabase/migrations/20260819_rls_effettiva.sql` | client con contesto tenant (RLS); `prismaAmministrativo()` solo fuori dalle richieste |
| Schema | `prisma/schema.prisma`, `prisma/migrations/` (69 migrazioni, misurato 17/11) | migrazioni versionate, ogni tabella con `tenant_id` porta la sua policy |
| Frontend | `frontend/src/pages/`, `components/`, `api/client.ts` | pagine per modulo, portale cliente, aiuto in-app |
| Relay email | `api/send-email.ts` | funzione serverless su Vercel (invio a nome dello studio) |
| Prove | `src/**/*.test.ts` (159 file), `frontend/src/**/*.test.tsx` (56), `e2e/` (Playwright, non in CI) | la suite backend non vuole un DB (`vitest.setup.ts`); misurato 17/11 |

## Flussi principali
- **Fattura → SdI**: `src/routes/contabilitaFatture.ts` → `fatturaEngine.ts` (importi in centesimi) → `sdiXmlGenerator.ts` → `sdiService.ts`; stato e numerazione per anno dal DB.
- **Firma**: `src/routes/firma.ts` → `livelloFirmaService.ts` → OTP (`otpService.ts`) → `verbaleFirma.ts`, `copiaFirmata.ts`, sigillo HMAC-SHA256, marca temporale (`marcaTemporaleService.ts`).
- **KYC/AML**: `src/routes/kyc.ts` → `kycCaseService.ts`, `kycGate.ts` (blocca la fatturazione da progetto senza KYC) → `src/domain/kycStateMachine.ts`, `calcoloRischio.ts`, `segnalazioneFiau*`.
- **Avanzamento progetto**: ogni scrittura su moduli e micro-voci passa da `calcoloService.ts`, che applica `stateEngine.ts`.

## Dati
- Un record = uno studio (`tenant_id`); il `super_admin` ha `tenant_id` NULL. Il filtro applicativo non è la difesa: lo è RLS.
- Importi `Int` in centesimi. Password solo come hash scrypt. Documenti firmati e audit non si cancellano (archiviazione, non eliminazione).

## Integrazioni esterne
| Servizio | A cosa serve | Autenticazione | Se cade |
|---|---|---|---|
| SMTP/IMAP dello studio | email in uscita e in entrata | credenziali nella riga `Tenant` | invii in coda, diagnosi posta in Impostazioni |
| WhatsApp Cloud API, Telegram, Signal | comunicazioni col cliente | token per studio (DB) | il canale risulta non configurato, nessun invio inventato |
| SdI | fatture elettroniche | webhook con `WEBHOOK_SECRET_SDI` | stato «da inviare» resta tale |
| Supabase Storage | documenti (facoltativo) | `SUPABASE_SERVICE_KEY` | ripiego su `uploads/` locale |
| Sentry | errori | `SENTRY_DSN` | niente |

## Installazioni
- **blusmart.eu** (server Register.it, del titolare): `docker-compose.prod.yml` (postgres 17 → migrate → rls → api → nginx + certbot), `/opt/bluman`, backup in `/var/backups/bluman`, monitor ogni 10 minuti. Dichiarato da `docs/manuale/19-infra-deploy.md`, non misurato da qui.
- **Railway** (backend, `Dockerfile`: `prisma migrate deploy` all'avvio) e **Vercel** (frontend, bluman.vercel.app): pubblicano da `main` di `mariobros1987/bluman`. Copia di riserva (dichiarato da Fabio, 17/11).
- **Fork** `wolftradesystem-tech/bluman`: nessuna installazione, solo il pilota (DEPLOY.md).
