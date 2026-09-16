# HANDOFF — Canali di comunicazione per studio

> Documento di lavoro, non documentazione del progetto: serve a riprendere questa modifica su
> un altro PC. Va cancellato quando il lavoro è chiuso.

**Ramo:** `feat/canali-per-studio` (creato da `main`).
**Ultimo commit:** `21c4bcc` — *fix(telegram): la risposta di Telegram tradotta in cosa fare*.
**Stato:** distribuito in produzione il 16/09/2026 (frontend Vercel + backend Railway + migrazioni).

---

## Come riprendere su un altro PC

```bash
git fetch origin
git checkout feat/canali-per-studio
git pull
# poi, dentro Claude Code:
#   leggi HANDOFF.md e riprendi da dove è rimasto
```

Il ramo è **già unito a `main`** (commit di merge `7eb9bdb`): per riprendere, `main` va bene
quanto il ramo.

Prima di toccare qualcosa, rifai il punto:

```bash
npx tsc --noEmit            # radice: deve dare 0 errori
cd frontend && npm run typecheck && cd ..
npx vitest run              # 921 test, 80 file: deve essere tutto verde
```

---

## Il problema che questa modifica risolve

Il titolare ha chiesto che **ogni studio configuri da sé le proprie credenziali** per WhatsApp,
email, Telegram e Signal, e che il canale funzioni **sia dal lato operatori dell'app sia dal
lato cliente** che sceglie come comunicare. Vincolo esplicito, ripetuto: *«la chat con la mail
funziona, cerca di non romperla»*.

Tre difetti trovati e sanati lungo la strada, tutti della stessa famiglia — **una cosa che
l'interfaccia dà per funzionante e che il server non sa fare**:

1. **Telegram e Signal erano annunciati e non esistevano.** La chat lato operatore diceva
   «notificato via SIGNAL/TELEGRAM» per canali senza rotta. Ora ci sono
   `POST /comunicazioni/invia-signal` e `POST /comunicazioni/invia-telegram`, e la chiamata
   Telegram è stata estratta in `src/services/telegramService.ts` perché la rotta potesse
   raggiungerla (prima viveva privata dentro `otpDispatch.ts`).
2. **`telegramChatId` era letto da quattro punti e non lo scriveva nessuno.** L'OTP di firma
   (`firma.ts`), `recapitiCliente` (`otpDispatch.ts`), i webhook (`webhooks.ts`) e la scheda
   cliente lo leggono; l'anagrafica salvava uno `@username`, che `sendMessage` rifiuta. Ora
   `clienti.ts` lo scrive in colonna, tenendo solo ciò che `chatIdTelegram` riconosce.
3. **L'elenco dei canali era copiato in tre posti e uno era rimasto indietro.**
   `serverHelpers.canaleOtpValido` era fermo a tre canali quando `CANALI_OTP` ne aveva quattro:
   il canale preferito di un cliente non poteva essere Signal, e l'anagrafica lo scartava in
   silenzio. Ora delega all'elenco unico, e `src/canaliCoerenza.test.ts` presidia la coerenza.

---

## Cosa è fatto

**Backend**

- `src/services/telegramService.ts` (+ `telegramService.test.ts`, 9 test): `telegramConfigurato`,
  `chatIdTelegram` (accetta solo `/^-?\d{5,20}$/`), `inviaTestoTelegram`. Un `200` con
  `ok: false` **non** è un successo.
- `src/services/signalService.ts` (già presente dalle sessioni precedenti): invio verso il
  demone `signal-cli-rest-api` dello studio.
- `src/routes/comunicazioni.ts`: le due rotte nuove. Il controllo di dimensione dell'allegato
  Signal precede la verifica di rete, così un file troppo grande dà «troppo grande» e non un
  errore di policy.
- `src/util/serverHelpers.ts`: `canaleOtpValido` delega a `otpService.canaleValido`.
- `src/schemas/clienti.schema.ts`: `canaleOtpPreferito` accetta `signal`; `telegramChatId`
  dichiarato.
- `src/routes/clienti.ts`: `clientTelegramChatId` scritto in colonna su creazione e modifica.
- `src/scripts/verifyAll.ts`: il presidio sui canali non è più `length === 3` (una fotografia
  dell'elenco) ma quattro condizioni scritte per nome, così non diventa rosso da solo.

**Frontend**

- `api/tenant.ts`: `sendSignalDirectApi`, `sendTelegramDirectApi`, `fetchSignalInArrivoApi`;
  `testChannelApi` porta anche `signalEndpoint`/`signalToken`/`signalNumber`.
- `components/settings/TabChannels.tsx`: scheda Signal riscritta (endpoint, numero, token con
  nota sul segreto, test onesto — via la riga «daemon in ascolto», che era falsa), scheda nuova
  del **canale interno** (nessuna credenziale da configurare), guida riscritta in quattro punti,
  eliminata la scheda morta «Email Inbound Webhook Parse».
- `pages/SettingsPage.tsx`: stato e salvataggio dei tre campi Signal; `signalToken` non torna
  mai al browser dopo il salvataggio.
- `components/clients/AnagraficaErpModal.tsx`: il campo Telegram chiede la **chat id numerica**
  (non più `@RobertoRossi`) e il campo Signal dice che serve la forma internazionale e che un
  cellulare senza Signal non riceve niente.
- `components/ComunicazioniTab.tsx`: i recapiti letti combaciano con quelli che legge il
  backend (WhatsApp non ripiega più sul fisso, Telegram legge `telegramChatId`); i rami Signal e
  Telegram inviano davvero, e il ramo finale che dichiarava un falso successo è stato tolto.
- Lato cliente: `api/firma.ts` (`CanaleOtp` con `signal`), `FirmaOtpModal.tsx` (quattro
  canali), `usePortalFirma.ts`, `TabProposta.tsx`.

**Migrazioni** — entrambe scritte, **nessuna applicata in produzione**:

| Migrazione | Cosa fa |
|---|---|
| `20260916180000_whatsapp_app_per_studio` | App Meta per studio: `wa_app_id`, `wa_app_secret`, `wa_webhook_slug` (unico, generato dal DB), `wa_otp_template`, `wa_otp_template_lang` |
| `20260916190000_signal_per_studio` | `signal_endpoint`, `signal_token`, `signal_number`; copia il valore da `signal_cli_endpoint`, che **resta** |

---

## ⚠️ L'ordine del deploy non è indifferente

> **Fatto il 16/09/2026.** Le due migrazioni sono state applicate a produzione *prima* del
> deploy, con questo stesso ordine. Le colonne `signal_endpoint`, `signal_token`,
> `signal_number`, `wa_app_id`, `wa_app_secret`, `wa_webhook_slug`, `wa_otp_template`,
> `wa_otp_template_lang` esistono in produzione; `signal_cli_endpoint` è ancora lì, come
> previsto. Lo studio reale (Bluecode Advisory Malta) ha SMTP, IMAP, WhatsApp, Telegram e
> Signal configurati, quindi la catena della posta non è stata toccata. La sezione resta
> perché la trappola vale per il prossimo deploy con migrazioni in attesa.

`./scripts/distribuisci.sh` fa `git push` → Vercel → `railway up` → health check, ma **non esegue
`prisma migrate deploy`**. Le migrazioni le applica il cron `cron-notifiche` alle 07:00 UTC.

Quindi, se si distribuisce il backend **prima** di applicare le due migrazioni:

1. `credenzialiCanali` (`src/services/otpDispatch.ts:71`) fa un `select` che comprende
   `signal_endpoint`, `signal_token`, `signal_number`;
2. quelle colonne non esistono → Prisma solleva;
3. il `catch` vuoto che segue inghiotte l'errore e restituisce credenziali **tutte nulle**;
4. senza SMTP l'invio email si ferma → **si rompe esattamente la cosa che non va rotta**, e
   resta rotta fino alle 07:00 successive.

**L'ordine corretto è: prima le migrazioni, poi il deploy.** Le due migrazioni sono additive —
`ADD COLUMN`, un `UPDATE` che riempie una colonna appena creata, un `CREATE UNIQUE INDEX` che
genera slug su una colonna nuova — e non cancellano né sovrascrivono nulla.

```bash
npx prisma migrate status          # deve elencare le due in attesa
npx prisma migrate deploy          # applica
npx prisma migrate status          # deve dire «Database schema is up to date!»
git checkout main && git merge feat/canali-per-studio
./scripts/distribuisci.sh
```

### Perché `signal_cli_endpoint` non è stata rinominata

La versione iniziale della migrazione faceva `RENAME COLUMN signal_cli_endpoint TO
signal_endpoint`. Non si può: il backend **già in esecuzione** è compilato contro lo schema
vecchio e molte query su `tenant` non hanno un `select` esplicito (`clienti.ts:113,411`,
`portale.ts:50`, `solleciti.ts:96,164`, `contabilitaPdfEmail.ts:31,104`, `contabilitaSdi.ts:31`,
`documenti.ts:461`, `tenant.ts:149,832,929,962`). Prisma, per quelle, genera un `SELECT` che
elenca tutte le colonne, `signal_cli_endpoint` compresa: rinominarla durante il deploy le fa
fallire tutte con «column does not exist». Copiare invece lascia in piedi entrambe le colonne e
il backend vecchio convive con quello nuovo — nessuna finestra di errore.

### Lavoro di pulizia che resta (sicuro, senza fretta)

Quando il backend che legge `signal_endpoint` è in produzione, la colonna vecchia si può
togliere. A quel punto nessun codice la nomina, quindi si può applicare in qualunque momento,
anche dal cron:

```bash
mkdir -p prisma/migrations/20260916200000_rimuovi_signal_cli_endpoint
cat > prisma/migrations/20260916200000_rimuovi_signal_cli_endpoint/migration.sql <<'SQL'
-- `signal_cli_endpoint` è stata sostituita da `signal_endpoint`, che ne ha copiato il valore
-- nella migrazione 20260916190000. Era rimasta in piedi solo perché il backend in esecuzione
-- la leggeva ancora in molte query senza `select`: ora quel backend non c'è più.
ALTER TABLE "tenant" DROP COLUMN "signal_cli_endpoint";
SQL
npx prisma migrate deploy
```

**Non crearla adesso**: `migrate deploy` applica tutte le migrazioni in attesa, quindi
crearla prima del deploy del backend riaprirebbe la finestra che si sta evitando.

---

## Cosa resta da fare

### Verifiche non ancora eseguite

- **`prisma migrate diff`** fra migrazioni e schema: Docker è spento su questo PC
  (`docker ps` → *cannot find the file specified*), quindi non è stato possibile costruire il
  database ombra. Va rifatto con Docker acceso.
- **E2E Playwright** sull'ambiente usa-e-getta (`bluman-e2e-pg` porta 5433, **mai** Supabase —
  regola 10). È la suite che costruisce il database dalle migrazioni: è la prova che la
  migrazione Signal modificata è valida.
- **Prova della chat mail** dopo il deploy: `POST /tenant/test-email` più un invio reale.
  È il presidio della funzionalità che non va rotta, e va ripetuta.
- **Grafo Graphify** (regola 5 di `.agents/AGENTS.md`): `py -m graphify` — qui il comando nudo
  non è in PATH.

### Documentazione

- `.agents/AGENTS.md`: sezione Signal, la migrazione `20260916190000_signal_per_studio`
  nell'elenco, la regola sul prefisso internazionale di `numeroSignal`.
- `frontend/src/utils/pdfGenerator.ts`: la guida Meta va resa per-studio (app propria,
  Callback URL con slug, App Secret, Verify Token).
- `src/credenziali.test.ts:66-71`: il commento afferma ancora il falso («il valore vive solo nel
  campo `waVerifyToken` della riga Tenant»).

### Scritture su produzione che aspettano un assenso esplicito

- **Generare un `waVerifyToken` nuovo per lo studio reale**: quello attuale contiene un valore
  pubblico compromesso.
- Svuotare il `wa_verify_token` corrente, che è quel valore.

### Lavoro che spetta al titolare, fuori dal codice

- **Un'app Meta per studio**, con la procedura sulla dashboard Meta.
- **Ospitare `signal-cli-rest-api` per studio**, con un numero registrato: senza un demone
  raggiungibile il canale Signal resta spento, e l'interfaccia lo dice invece di fingere.
- Decidere se anche `WEBHOOK_SECRET_SDI` debba diventare per-tenant: oggi è un segreto unico di
  piattaforma mentre l'SDI è per-studio per natura.

---

## Accordi in vigore

- Procedere senza chiedere autorizzazioni, **tranne** `git push` (fa scattare il deploy) e le
  operazioni distruttive sul database di produzione (`DELETE`, `TRUNCATE`, `DROP`,
  `db push --accept-data-loss`, reset) — quelle vanno proposte e approvate prima, sempre con un
  backup o un dry-run alle spalle.
- Nel codice delle richieste HTTP si usa `prisma` da `src/util/prismaClient.ts`, mai
  `new PrismaClient()`; `prismaAmministrativo()` scavalca RLS e vive solo in script, seed,
  bootstrap, backup, lettura utente al login e verifica dei magic token.
- Nessuna credenziale reale nel codice versionato, **nemmeno come ripiego** del tipo
  `|| 'password-qualunque'`. Un segreto salvato in banca dati non torna mai al browser: esce
  come stringa vuota più un flag `<chiave>Impostata`.
- Il frontend non inventa dati che la banca dati non ha, e la prova legale viene solo dal
  sigillo lato server.
- Identità git richiesta da Vercel: `mario.dibenedetto87@gmail.com`.
