# HANDOFF — Canali di comunicazione per studio

> Documento di lavoro, non documentazione del progetto: serve a riprendere questa modifica su
> un altro PC. Va cancellato quando il lavoro è chiuso.

## ⏸️ DA QUI RIPRENDE L'ALTRO PC (fermato il 16/09/2026)

**Stato al momento dello spegnimento:** il guasto Telegram lato *invio* è chiuso; il guasto
lato *ricezione* ha la causa accertata e la correzione **scritta ma non ancora distribuita**.

Cosa fare appena riacceso, in quest'ordine:

```bash
git pull                                   # prende i commit di questa sessione
npx tsc --noEmit                           # deve dare 0 errori
npx vitest run                             # deve essere tutto verde
./scripts/distribuisci.sh                  # distribuisce la correzione dell'ingresso
```

Poi **verificare che i messaggi entrino davvero**, perché è la cosa che non si poteva provare
prima di distribuire: scrivere al bot `@BlueCodeStudio_Bot` da Telegram e controllare che il
messaggio compaia nel fascicolo — oppure che arrivi una notifica «Messaggio Telegram non
archiviato».

**Lavoro interrotto a metà (da completare):**

1. **Instradare gli altri due canali.** `registraIngressoSenzaFascicolo` esiste
   (`src/services/ingressoSenzaFascicolo.ts`) ed è collegata **solo** al ramo Telegram
   (`src/routes/webhooks.ts`, ramo `project_not_unique`). WhatsApp (`src/routes/webhooks.ts:362`,
   il `continue` dopo `attivi.length !== 1`) e Signal (`src/services/signalInbound.ts:150`)
   hanno lo **stesso** difetto e vanno collegati allo stesso modo. Il titolare ha detto che
   vale per tutti i canali.
2. **Il pulsante di registrazione del webhook nell'interfaccia** (vedi sotto: è la causa 2, e
   senza di esso la registrazione resta un'operazione da riga di comando).
3. Test dedicati a `registraIngressoSenzaFascicolo` (idempotenza su replay, testo troncato,
   motivo che nomina i progetti).

**Ramo:** `feat/canali-per-studio` (creato da `main`).
**Ultimo commit:** `21c4bcc` — *fix(telegram): la risposta di Telegram tradotta in cosa fare*.
**Stato:** distribuito in produzione il 16/09/2026 (frontend Vercel + backend Railway + migrazioni),
poi **di nuovo** con il fix Telegram: seconda `distribuisci.sh` chiusa con exit 0 — Vercel `READY`,
Railway inviato, `/health` 200, sonda `POST /documenti/genera` 401.

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

## Il guasto Telegram del 16/09/2026 (chiuso)

Il titolare ha riportato: *«Telegram non ha accettato l'invio: Forbidden: the bot can't send
messages to the bot»*. Non era un difetto del codice nuovo: era **il codice nuovo che diceva la
verità**. Prima di questa modifica il ramo Telegram della chat annunciava «notificato via
TELEGRAM» senza spedire niente; ora la richiesta parte davvero, Telegram risponde, e la risposta
arriva all'operatore.

**Causa accertata**, non ipotizzata. Sullo studio *Bluecode Advisory Malta Ltd*:

| | |
|---|---|
| Bot | `BlueCodeStudio_Bot` — id **8973080750** (`getMe`) |
| `telegramChatId` del cliente «mario emirati arabi» | **8973080750** — cioè il bot stesso |

Un bot non può scrivere a se stesso: da qui la risposta di Telegram. Il valore giusto stava in
`getUpdates` (chat privata «Mario», `chat.id` **245520495**).

**Cosa è stato fatto**

- `spiegaErroreTelegram` (`src/services/telegramService.ts`) traduce i rifiuti di Telegram in
  cosa fare — chat id del bot, `chat not found`, bot bloccato, permessi — e **lascia il testo
  originale in coda**. Un errore non previsto esce com'è: inventare una causa manda a cercare il
  difetto altrove. 5 test nuovi, `telegramService.test.ts` a 14.
- Avvisi nell'anagrafica (`AnagraficaErpModal.tsx`, campo `✈️ Chat ID Telegram`) e nella guida
  di `TabChannels.tsx`: **non** usare l'identificativo che risponde `getMe`.
- Corretto il dato in produzione: `telegramChatId` di quel cliente passa a `245520495`, in
  colonna e in `referentiJson`.
- Provato l'invio end-to-end: `sendMessage` → HTTP 200, `ok: true`, `message_id: 9`. Il canale
  funziona.

**Nota sulla rotta di prova.** `POST /tenant/test-channel` con `channel: 'telegram'` interroga
solo `getMe`: conferma il token, **non** che esista una chat su cui spedire. Un token valido con
tutte le chat id sbagliate passa quella prova. Il messaggio di risposta lo dice, ma resta una
prova parziale: la verifica vera è un invio.

---

## L'ingresso Telegram: tre cause, non una (16/09/2026)

Il titolare: *«i messaggi mandati dall'app telegram verso il portale non arrivano»*, e
*«l'invio tramite nostra app funziona»* — quest'ultimo confermato con un invio vero
(`sendMessage` → `message_id: 9`). Quindi il guasto era solo in **entrata**, e le cause erano
tre, in serie: ognuna bastava da sola a impedire la ricezione.

### Causa 1 — `TELEGRAM_WEBHOOK_SECRET` non è mai stata configurata su Railway

```bash
railway variables --service bluman-api   # prima: nessuna variabile TELEGRAM_*
```

Quella chiave è la base di derivazione del segreto per-tenant (`creaSegretoTelegram`), e senza
di essa **due** rotte rispondono 503: `POST /tenant/telegram-webhook-setup` (`webhooks.ts:541`)
e la rotta di ingresso (`webhooks.ts:441`). Nessuno studio ha quindi mai potuto registrare il
webhook. Prova: `getWebhookInfo` rispondeva `url: ""` con `pending_update_count: 7` — sette
messaggi fermi da giorni sui server di Telegram.

**Fatto:** chiave generata (48 byte casuali, base64url) e impostata su Railway. Non è in nessun
file del repository, e non deve finirci (regola 6).

### Causa 2 — la rotta di registrazione non era invocabile dall'interfaccia

`POST /tenant/telegram-webhook-setup` pretende `botToken` **nel corpo**
(`webhooks.ts:521`). Ma il token è un segreto salvato: non torna mai al browser (regola 6), e
l'interfaccia non può quindi mandarlo. La rotta era irraggiungibile **per costruzione**, e
infatti il frontend non la chiama da nessuna parte (`grep telegram-webhook-setup frontend/src`
→ niente).

**Fatto a metà:** il webhook dello studio reale è stato registrato da riga di comando
(`setWebhook` con il segreto derivato, `url` = `https://bluman-api-production.up.railway.app/webhooks/communications/telegram`).
**Resta da fare:** far sì che la rotta usi il token *salvato* quando il corpo non ne porta uno,
e aggiungere in `TabChannels.tsx` (scheda Telegram) il pulsante che la chiama, con lo stato del
webhook letto da `getWebhookInfo`. Oggi la scheda ha solo «Test Telegram Bot», che interroga
`getMe`: conferma il token e **non dice niente sulla ricezione**.

### Causa 3 — il messaggio veniva distrutto in silenzio (la più grave)

Con il webhook finalmente attivo, Telegram ha consegnato tutti e 7 gli aggiornamenti: `pending`
è passato da 7 a 0 e `last_error_message` è rimasto `null` — quindi la rotta ha risposto `200`
a ognuno. Eppure:

```
aggiornamenti Telegram ricevuti dal backend: 0
messaggi entrati nei fascicoli: 0
```

**Nessuno dei sette è arrivato.** La causa è la regola di instradamento: un messaggio entra in
un fascicolo solo se il mittente è un cliente univoco **e** ha **esattamente un** progetto
aperto (`attivi.length !== 1` → `reply.status(202).send({ ok: true, ignored: 'project_not_unique' })`,
`webhooks.ts:475`). Il cliente «mario emirati arabi» ha **due** progetti aperti — «emirati
arabi 123» e «ciaociao» — quindi ogni suo messaggio finiva in quel ramo: risposta `ok` a
Telegram, riga **non** scritta in `webhook_inbox` (sta dentro la transazione, dopo
l'instradamento), fascicolo vuoto, nessun avviso. Un messaggio perso con il provider convinto
del contrario.

La prudenza di non scegliere il fascicolo a caso è giusta: con due pratiche aperte, qualunque
scelta sarebbe un'invenzione. Il difetto è cosa succedeva **dopo**.

**Fatto (non ancora distribuito):**

- `src/services/ingressoSenzaFascicolo.ts` (nuovo): scrive la riga in `webhook_inbox` — così un
  rinvio dello stesso update non avvisa due volte — e poi avvisa lo studio con
  `tipoEvento: 'messaggio_non_instradabile'`, riportando chi ha scritto, il testo (troncato a
  500 caratteri) e **cosa fare**: quanti progetti sono aperti e come si chiamano, così
  l'operatore chiude quelli conclusi e il prossimo messaggio entra da sé.
- `src/services/notificheService.ts`: nuovo evento `messaggio_non_instradabile` in
  `EVENTI_NOTIFICA`. `Notifica` non richiede un progetto (`link` è opzionale), quindi il
  messaggio trova posto senza toccare lo schema.
- `src/routes/webhooks.ts`: il ramo Telegram usa il nuovo aiuto, e il testo si compone **prima**
  dell'instradamento — calcolarlo dopo significherebbe averlo già perso.

**Perché non si mette il messaggio in `comunicazione_progetto`:** `progettoId` è obbligatorio
(`prisma/schema.prisma:1282`). Renderlo opzionale sarebbe la soluzione definitiva — un
messaggio «non assegnato» che l'operatore instrada a mano — ma è un cambio di contratto che
tocca ogni lettore di quel modello, e va deciso, non introdotto di sfuggita.

### Il quadro generale: vale per tutti i canali

La regola `attivi.length !== 1` è la stessa in tre punti — WhatsApp (`webhooks.ts:362`), Telegram
(`webhooks.ts:475`) e Signal (`signalInbound.ts:150`) — e tutti e tre scartavano in silenzio.
Il titolare ha osservato che il frazionamento per tenant e per progetto *«vale per tutti i tipi
di comunicazione»* ed *«è già così»*: **per tenant lo è davvero** (WhatsApp risolve lo studio
dallo slug del path, Telegram dal segreto derivato, che lega tenant e bot token con un HMAC), e
**per progetto lo è solo quando la scelta è univoca**. La lacuna non è il frazionamento: è il
silenzio quando il frazionamento non è possibile.

### Come rigenerare la registrazione del webhook a mano

Se serve rifarla (token cambiato, URL cambiato, bot nuovo), dal repository:

```bash
# la chiave si legge da Railway e non viene mai stampata
npx tsx -e "
import { execFileSync } from 'node:child_process';
import { prismaAmministrativo } from './src/util/prismaClient';
import { creaSegretoTelegram } from './src/util/webhookSecurity';
import { urlWebhookTelegram } from './src/util/urlPubblica';
(async () => {
  const kv = execFileSync('npx', ['--yes','@railway/cli','variables','--service','bluman-api','--kv'], { encoding: 'utf8' });
  const master = kv.split(/\r?\n/).find(l => l.startsWith('TELEGRAM_WEBHOOK_SECRET=')).slice(31).trim();
  const p = prismaAmministrativo();
  const t = await p.tenant.findFirst({ where: { tgBotToken: { not: null } }, select: { id: true, tgBotToken: true } });
  const r = await fetch('https://api.telegram.org/bot' + t.tgBotToken + '/setWebhook', {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ url: urlWebhookTelegram(), secret_token: creaSegretoTelegram(t.id, t.tgBotToken, master), allowed_updates: ['message','channel_post'] }),
  });
  console.log((await r.json()).ok);
  await p.\$disconnect();
})();
"
```

`getWebhookInfo` dice se è registrato (`url`), se ci sono arretrati (`pending_update_count`) e
se Telegram ha ricevuto errori consegnando (`last_error_message`) — è la prima cosa da guardare
quando «i messaggi non arrivano».

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
