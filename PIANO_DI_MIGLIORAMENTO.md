# 🛠️ BluMan — Piano di Miglioramento e Implementazione

> **Data**: 2025-07-14 (creazione) — ultimo aggiornamento al 2026-09-22
> **Stato**: Fasi 0 e 1 completate, 6.1 CI/CD completata; Fasi 2-5 e resto Fase 6 in attesa.
> **I lavori aperti del momento stanno nella sezione [1bis](#1bis-lavori-aperti--stato-al-17092026)** — è lì che si scrive cosa manca.
> **Autore**: Analisi AI completa del codebase
> **Priorità**: 🔴 Critica (sicurezza) → 🟠 Alta → 🟡 Media → 🟢 Bassa

---

## 📋 Indice

1. [Riepilogo Esecutivo](#1-riepilogo-esecutivo)
1ter. [Calendario, collaboratori e compiti assegnati](#1ter-calendario-collaboratori-e-compiti-assegnati)
2. [FASE 0 — Sicurezza Critica (immediata)](#2-fase-0--sicurezza-critica)
3. [FASE 1 — Affidabilità e Correttezza](#3-fase-1--affidabilità-e-correttezza)
4. [FASE 2 — Refactoring Architetturale](#4-fase-2--refactoring-architetturale)
5. [FASE 3 — Qualità del Codice](#5-fase-3--qualità-del-codice)
6. [FASE 4 — Performance e Scalabilità](#6-fase-4--performance-e-scalabilità)
7. [FASE 5 — Nuove Funzionalità](#7-fase-5--nuove-funzionalità)
8. [FASE 6 — DevOps e CI/CD](#8-fase-6--devops-e-cicd)
9. [Checklist Finale](#9-checklist-finale)

---

## 1. Riepilogo Esecutivo

### Cosa funziona bene ✅
- Architettura multi-tenant con RLS PostgreSQL reale (ruolo `bluman_app` senza BYPASSRLS)
- Motore di stato puro (`stateEngine.ts`) ben progettato e testato
- Autenticazione JWT senza segreti hardcoded, password scrypt, magic link con hash SHA-256
- Presidio automatico contro credenziali cablate (`credenziali.test.ts`)
- Dockerfile con `migrate deploy` (non `db push`)
- `secrets/` correttamente escluso da git

### Cosa va corretto 🔴
| # | Problema | Rischio | Fase |
|---|----------|---------|------|
| 1 | ~~CORS `origin: true` + `credentials: true`~~ ✅ (0.1) | ~~Furto sessione cross-origin~~ | 0.1 |
| 2 | ~~Fallback InMemoryApp in produzione~~ ✅ (0.2) | ~~Dati non persistenti, comportamento imprevedibile~~ | 0.2 |
| 3 | ~~Frontend: fallback silenziosi che restituiscono `{ok:true}`~~ ✅ (0.3) | ~~Dati persi senza errore visibile~~ | 0.3 |
| 4 | ~~TLS `rejectUnauthorized: false` su SMTP/IMAP~~ ✅ (0.4) | ~~MITM su credenziali email~~ | 0.4 |
| 5 | ~~Confronto firma JWT non constant-time~~ ✅ (0.5) | ~~Timing attack (basso)~~ | 0.5 |
| 6 | ~~Audit log fuori contesto AsyncLocalStorage~~ ✅ (0.6) | ~~Audit su tenant sbagliato o perso~~ | 0.6 |
| 7 | ~~PDF fatture reali nel repo~~ ✅ (0.7) | ~~Esposizione dati sensibili~~ | 0.7 |
| 8 | ~~`eliminaProgetto` non transazionale~~ ✅ (1.1) | ~~Dati orfani su fallimento parziale~~ | 1.1 |
| 9 | `server.ts` monolite 4300 righe | Manutenibilità, rischio bug | 2.1 |
| 10 | Nessuna validazione input strutturata | Injection, dati malformati | 2.2 |
| 11 | Nessuna paginazione | Performance con dati crescenti | 4.1 |
| 12 | Rate limit in-memory | Inefficace con più repliche | 4.2 |

---

## 1bis. Lavori aperti — stato al 17/09/2026

> Questa sezione è il posto dove si scrive cosa **manca**, perché il grafo (`graphify-out/`) è
> generato e non può ospitarlo. Va tenuta corta e cancellata man mano che le voci si chiudono.

### Canali di comunicazione per studio

**Fatto.** WhatsApp, Telegram e Signal instradano il messaggio nel fascicolo solo quando
mittente e progetto sono univoci; negli altri casi scrivono la riga di idempotenza e avvisano
lo studio con `tipoEvento: 'messaggio_non_instradabile'`
(`src/services/ingressoSenzaFascicolo.ts`). La scheda Telegram ha il pulsante che registra il
webhook e il pannello che ne legge lo stato da `getWebhookInfo`.

**Fatto anche il 16-17/09/2026 — il cliente dice lui a quale pratica si riferisce.** L'euristica a
due cancelli resta come ripiego, ma non è più l'unica strada: dalla testata della pratica il menu
`🔗 Link Telegram` copia `t.me/<Bot>?start=<payload>` oppure lo spedisce al cliente via email o
WhatsApp, e chi tocca il link aggancia la propria chat a **quella** pratica — non a quella dedotta
dall'anagrafica (`src/routes/collegamentoChat.ts`, tabella `collegamento_chat_progetto`, payload
firmato con HMAC in `src/util/webhookSecurity.ts`). Il caso «un cliente con due pratiche aperte»
smette di essere irrisolvibile. L'invito rientra nel fascicolo come comunicazione in uscita
(regola 3), la revoca è lo scollegamento, e il link è una **capacità**, non un segreto: contiene un
MAC, non il token del bot, e il token continua a non uscire dal backend.

**Lezione da non perdere (17/09/2026).** Il link si compone di due metà, e la seconda — lo
`@username` del bot — era **l'id numerico del bot**: `t.me/<numero>` apre «questo utente non esiste»
sul telefono del cliente, ed è esattamente quello che è successo. Tre buchi, tutti chiusi nello
stesso giro: `usernameBotTelegram` accettava un valore di sole cifre, che è la forma dell'id e non
di uno username (Telegram non ne assegna di numerici); la registrazione del webhook scriveva
`tgBotUsername` **solo se il campo era vuoto**, quindi un valore sbagliato ci restava per sempre; e
nessuno aveva mai confrontato il valore salvato con quello che `getMe` restituisce. **Telegram è la
fonte, la colonna del database è la sua copia**: un valore scritto a mano che Telegram contraddice è
un guasto da correggere, non una scelta da rispettare. Ora «Registra webhook» rilegge `getMe`,
corregge il campo e lo dichiara (`usernameCorretto`), e il pannello riporta il valore corretto nello
stato del modulo — senza quello, il primo «Salva» di un altro canale avrebbe riscritto il valore
vecchio e disfatto la correzione.

**Lezione da non perdere (i due punti di scarto).** Ogni rotta di ingresso scarta il messaggio in **due** punti —
mittente non attribuibile e progetto non univoco — e la prima correzione ne aveva collegato
uno solo per canale. WhatsApp li aveva entrambi, Telegram e Signal no: da qui un guasto che
sembrava inspiegabile, con l'invio funzionante e la ricezione no. **Quando si tocca uno dei
due rami, si tocchi anche l'altro**, in tutti i canali.

### Da fare

| # | Cosa | Dove | Come si chiude |
|---|------|------|----------------|
| 1 | **Verifica in ricezione Telegram** — ✅ **CHIUSA il 02/10/2026: la catena funziona, non c'era nessun guasto** | produzione | **Fatto il 17/09**: premuto «Registra webhook», il campo `tgBotUsername` si è corretto da solo — cioè la catena `getMe` → confronto → `update` → risposta con `usernameCorretto` funziona in produzione. **Misurato il 02/10/2026 con `ADMIN_DATABASE_URL` (sola lettura)**: il webhook è registrato su `https://bluman-api-production.up.railway.app/webhooks/communications/telegram`, **0 update in attesa, nessun errore di consegna**, `allowed_updates: message,channel_post`; `webhook_inbox` ha **18** righe `telegram_update` e l'ultima è del **02/10 alle 14:21:25 UTC**, 136 ms prima della notifica corrispondente. Quindi **Telegram consegna, il server riceve e scrive**: l'invio in uscita e la ricezione in ingresso funzionano entrambi. **Il pezzo che resta scoperto non è un guasto ma una condizione**: l'euristica a due cancelli (mittente in una sola scheda **e** un solo progetto aperto) rifiuta di scegliere quando la seconda non vale, e il messaggio vive **solo** come notifica `messaggio_non_instradabile` nella campanella. Le ultime due prove del titolare — «Ciao» alle 14:20:21 e «Kkkkkk» alle 14:21:25 — sono infatti finite lì con motivo «**Non ha nessun progetto aperto**»: la chat `245520495` è in anagrafica (`mario emirati arabi`, cancello 1 superato) ma quel cliente non ha più pratiche, e l'unica pratica aperta dello studio (`prova1`) è di un altro cliente. **Il collegamento per pratica aveva già funzionato una volta**: il 17/09 alle 08:23 la chat è stata collegata a «emirati arabi 123»; quella pratica è stata poi cancellata e la riga in `collegamento_chat_progetto` se n'è andata con lei (`onDelete: Cascade`, voluto) — è il motivo per cui la tabella è vuota mentre la notifica resta. **Conseguenza: `comunicazione_progetto` è vuota — nessun messaggio è mai stato archiviato da nessun canale.** **Il buco vero, e non è di consegna:** quelle notifiche hanno `link: null` (`src/services/ingressoSenzaFascicolo.ts:57`), quindi la campanella dice che il messaggio esiste ma non porta da nessuna parte — vedi voce 9(c). Da decidere col titolare se renderle cliccabili e se il messaggio di un cliente **senza** pratiche aperte debba restare solo in campanella |
| 2 | ~~**Le migrazioni non le applica nessuno**~~ **corretto il 16/09/2026: le applica il `Dockerfile`** | `Dockerfile:34`, `scripts/distribuisci.sh` | Lo script contiene zero occorrenze di `migrate` — è vero — ma il backend non gira dallo script: `railway up --service bluman-api` costruisce l'immagine, e il `CMD` dell'immagine è `npx prisma migrate deploy && npx tsx src/index.ts`. La migrazione si applica quindi **a ogni deploy del backend**, prima che il processo vada in ascolto, e se fallisce il container non parte (`&&`, non `;`). Il rischio residuo non è «non le applica nessuno» ma l'ordine fra i due deploy: il frontend su Vercel può andare online prima che l'immagine backend abbia applicato la migrazione |
| 3 | ~~**Migrazioni in attesa di deploy da confermare in produzione**~~ **confermato il 17/09/2026: applicate** | `prisma/migrations/` | `20260916180000_whatsapp_app_per_studio`, `20260916190000_signal_per_studio` e `20260916210000_collegamento_chat_progetto` sono in produzione. La prova è il log del container all'avvio del **17/09/2026 alle 06:54 UTC**: `36 migrations found` seguito da `No pending migrations to apply.` — `migrate deploy` confronta la cartella con la tabella `_prisma_migrations`, quindi «nessuna in attesa» significa che tutte e tre risultano applicate (Prisma scrive la riga **dopo** che l'SQL è andato a buon fine). La terza era stata applicata dal deploy del 16/09 (log: `Applying migration 20260916210000_collegamento_chat_progetto`), le prime due dallo stesso giro. Quelle due righe ricompaiono a ogni avvio del container, quindi il controllo resta rifacibile: `railway logs -s bluman-api \| head`. **Resta aperto** il rischio residuo della voce 2 — l'ordine fra il deploy del frontend su Vercel e quello del backend, che può mettere online una pagina che chiama una colonna non ancora creata — non l'applicazione |
| 4 | **Il ramo WhatsApp ha ancora uno scarto silenzioso** | `src/routes/webhooks.ts` | `if (!providerId || !fromNumber) continue;` — messaggio senza id o senza mittente. Non c'è modo di costruire una chiave di idempotenza, quindi l'avviso non si può mandare come gli altri: va deciso se registrare l'evento in altro modo o lasciarlo |
| 5 | **La cache del grafo è versionata** | `graphify-out/cache/` | 72 file che cambiano a ogni estrazione, e a ogni aggiornamento di CLI la directory viene rinominata lasciando indietro la vecchia. Vale la pena toglierla dal versionamento (`.gitignore` + `git rm -r --cached`) |
| 6 | **Il tetto di 5 secondi delle transazioni interattive** — ✅ **RISOLTO il 18/09/2026** | `src/util/prismaClient.ts:37` | Prisma chiude d'ufficio una transazione interattiva dopo 5 secondi, e la query successiva fallisce con `P2028`. Era già scattato due volte (in `eliminaProgetto`, e prima in `prismaIstanziazionePort` dove era stato risolto solo lì). **La regola unica c'è ora, e non è per call site:** il tetto è impostato **una volta** sul client condiviso con `new PrismaClient({ transactionOptions: { timeout: 15_000, maxWait: 5_000 } })`, quindi vale per ogni transazione interattiva — quelle di oggi e quelle di domani — senza dover ricordare il secondo argomento a ogni `$transaction`. È la scelta migliore rispetto a toccare gli 8 call site uno per uno: il difetto nasceva proprio dal dimenticarsene |
| 7 | **`PrismaApp` era legato a un solo studio** — ✅ **RISOLTO il 19/09/2026** | `src/adapters/prisma/prismaApp.ts`, `prismaIstanziazionePort.ts`, `src/routes/tenant.ts` | Il difetto mordeva davvero, non in teoria: un secondo studio **non registrava clienti né progetti**, e creare un nuovo tenant **dava errore**. Una radice, due sintomi. (a) `PrismaApp` e `PrismaIstanziazionePort` catturavano il `tenantId` **una volta sola** nel costruttore (Bluecode, l'unico studio quando `index.ts` crea l'istanza condivisa); ogni scrittura portava `tenant_id = Bluecode` mentre la sessione RLS era su un altro studio, e la `WITH CHECK (tenant_id = app_tenant_corrente())` la respingeva. **Scelta la strada A** (adattatore per richiesta): `tenantId` è ora un **getter** che legge `contestoTenant` a ogni query — lo stesso `app.current_tenant_id` su cui filtra la RLS — con ripiego al default del costruttore fuori da una richiesta (script, cron). Nessuna modifica ai 34 call site: usano già `this.tenantId`. (b) `POST /admin/tenants` creava lo studio (la policy `tenant` ha il bypass super_admin) ma la `user.create` del responsabile girava nel contesto sbagliato → RLS la respingeva → 500 e studio **orfano** senza utenti; ora gira dentro `contestoTenant.run({ tenantId: nuovo.id })`. Coperta da `src/tenantDinamicoScritture.test.ts` (4 test). **Resta la prova end-to-end**: creare un secondo studio reale in produzione |
| 8 | **Il piano multi-studio è scritto ma non deciso** | `PIANO_MULTITENANT.md` | Il documento c'è (dati separati, chat separate, le due strade, l'onboarding, le fasi). È la voce 7 vista dall'altro lato: la 7 dice *cosa manca nel codice*, questa dice *cosa manca nella decisione*. Nulla si implementa prima di sapere **quanti studi** e **chi li crea** — perché la strada A (adattatore per richiesta, poche righe) e la strada B (`tenantId` per chiamata, il refactor dei 34 call site) costano due ordini di grandezza diversi. Da riprendere quando la domanda commerciale ha una risposta |
| 9 | **Il link per progetto è solo Telegram, e non si può rigenerare** | `src/routes/collegamentoChat.ts`, `src/services/telegramService.ts` | Tre cose dichiarate fuori ambito quando il link è stato costruito, scritte qui perché non vengano riscoperte come difetti. (a) **Solo Telegram**: WhatsApp non ha un deep link con payload, quindi il collegamento esplicito non esiste per quel canale; la tabella ha la colonna `canale` proprio per non doverla rifare quando servirà. (b) **Nessuna rotazione del link**: la revoca è lo scollegamento (`DELETE /progetti/:id/collegamenti/:id`), ma il link resta spendibile da chi l'ha ricevuto in mano — la stessa chat può rientrare toccandolo di nuovo, ed è voluto (chi si è scollegato per sbaglio rientra da solo); se un giorno servisse invalidare un link già spedito, oggi non c'è un modo. (c) **L'avviso «messaggio non instradabile» non è cliccabile**: per renderlo utile servirebbe far aprire a `ClientsPage` la modifica dell'anagrafica di quel cliente, mentre `?client=<…>` oggi apre il modale del magic link (`frontend/src/pages/ClientsPage.tsx:239-244` — righe spostate dal rifacimento della pagina del 02/10/2026, che ha aggiunto le due viste e i filtri: il riferimento era `174-179`) |
| 10 | **La colonna `signal_cli_endpoint` è ancora nel database** — ✅ **RISOLTO il 18/09/2026** (DROP applicata a produzione con autorizzazione esplicita, migrazione `20260918190000_rimuovi_signal_cli_endpoint`) | `prisma/migrations/20260916190000_signal_per_studio/` | Non è un difetto: è un **debito con una scadenza che è già arrivata**. La migrazione del 16/09 ha aggiunto `signal_endpoint` e ci ha **copiato** il valore invece di rinominare la vecchia colonna, perché il backend allora in esecuzione su Railway era compilato contro lo schema vecchio e le sue query su `tenant` in gran parte non hanno un `select` esplicito: una rinomina le avrebbe fatte fallire tutte per la durata del deploy. La migrazione di pulizia è **nominata nel commento ma non esiste ancora**: `20260916200000_rimuovi_signal_cli_endpoint`. Ora che il backend che legge `signal_endpoint` è in produzione (deploy del 17/09), si può scrivere e applicare — e siccome è una **DROP**, serve l'autorizzazione esplicita del titolare. Nel frattempo il database ha una colonna che nessuno legge, e lo schema Prisma non la conosce. **Non è la sola divergenza fra `schema.prisma` e il database**, come questa voce affermava: misurato il 17/09/2026 con `prisma migrate diff`, le divergenze sono molte di più e di natura diversa. Vedi **voce 17**, che corregge questa affermazione con i numeri |
| 11 | ~~**La ricevuta di consegna WhatsApp non può arrivare**~~ — ✅ **RISOLTO il 17/09/2026** | `src/routes/webhooks.ts`, `src/services/whatsappService.ts`, `src/util/statoComunicazione.ts`, `src/routes/comunicazioni.ts` | Tre motivi indipendenti, tutti verificati e tutti chiusi. (a) Il webhook di stato cercava la riga con `externalId: 'whatsapp:<wamid>'`, ma le righe in uscita contengono il blob di stato: Prisma confronta per uguaglianza esatta, quindi non trovava mai nulla → ora cerca con `contains` dentro il blob, e solo fra le righe `direzione: 'uscita'` (quelle in ingresso portano lo stesso wamid e non vanno toccate). (b) **Il `wamid` non veniva conservato**: `inviaTestoWhatsapp` restituiva `{ ok: true }` e buttava via `messages[0].id` → ora `chiamaGraphWhatsapp`, `inviaTestoWhatsapp` e `inviaTemplateWhatsapp` lo propagano come `providerId`, e `registraEsitoInvio` lo deposita in `external_id` accanto allo stato. (c) Sulle righe in ingresso la chiave veniva **distrutta** dalla marcatura di lettura → ora `conStatoComunicazione` conserva la chiave di idempotenza accanto allo stato invece di sovrascriverla. In più il webhook scriveva lo stato in `allegatiJson`, che è la colonna degli allegati: una ricevuta cancellava gli allegati del messaggio → ora scrive **solo** `external_id`. Aggiunto un presidio monotono (`statoAvanza`) perché le ricevute di Meta non arrivano garantite in ordine: un `sent` in ritardo non può più riportare a `inviato` una riga già `consegnato`. **Conseguenza di prima:** su WhatsApp `consegnato` e `letto` non sono mai stati veri — il ✓✓ blu era dedotto, non ricevuto. **Prova:** `src/ricevutaWhatsapp.test.ts`, 16 test, verificati per mutazione (rimettendo `contains`→`equals` ne falliscono 7; togliendo il presidio sul regresso ne falliscono 2) |
| 12 | **I piani dichiarano aperto ciò che è chiuso, e non nominano ciò che è rotto** | `PIANO_DI_MIGLIORAMENTO.md` §2-8, `piano-debiti-noti-fiscale-e-split.md` | Verificato voce per voce il 17/09: **5.3 TOTP è fatto** (`src/util/totp.ts`, `POST /auth/totp/attiva`), **6.2 Sentry è fatto** (`src/plugins/sentry.ts:21`, `frontend/src/utils/sentry.ts:32`), **6.3 `.env.example` esiste**, **Debito 8 `portalDocs` è chiuso** (ora arriva dall'API, `usePortalData.ts:271`), e gli split di `ClientPortal.tsx` (848 righe) e `contabilita.ts` sono già stati eseguiti. Nessuno di questi piani nominava la voce 11. Un piano che mente in due direzioni non si può usare per decidere: va riallineato al codice prima di scegliere il prossimo lavoro |
| 13 | **Identificatori reali e link morti nei documenti** — ✅ **RISOLTO il 18/09/2026 (blocco 6)**, con lo scope **allargato** da ciò che la misura ha trovato | `README.md:5-6,141`, `GUIDA_META_WHATSAPP_INTEGRAZIONE.md:68,69,70,113,149,168,154,174,198,240`, `PIANO_SVILUPPO_COMPLETO.md:112,165`, `prisma/seed.ts:415,417`, `frontend/src/components/clients/AnagraficaErpModal.tsx:570`, `frontend/src/components/ComunicazioniTab.tsx:529`, `.env.example:46-58,186-199` | Nessun segreto era esposto — questo reggeva. Ma `README.md:141` stampava Phone ID e WABA reali, e **sbagliati**: il Phone ID a database è `1334566726400311` (non `1318817114639409`) e la WABA `1397431142562576` non esiste più (`GraphMethodException` subcode 33 — l'app è stata rifatta). **Misurato il 18/09/2026 con `ADMIN_DATABASE_URL`, e la riga 68 non era nella voce: anche l'App ID è vecchio** — la riga `tenant` di Bluecode ha `wa_app_id` di **16 cifre**, il documento ne stampava uno di 17, quindi è l'id dell'app precedente. Della stessa misura: dei 5 studi **uno solo** ha il canale WhatsApp configurato (Bluecode: phone id + app id + app secret + verify token), gli altri quattro hanno il solo `wa_webhook_slug` — nessuna credenziale, nessun ingresso. **Fatto**: i valori veri sono usciti dai documenti e sono diventati segnaposto che dicono **dove** il valore vive (colonne `wa_phone_id`/`wa_app_id` della riga `tenant`, inseriti da Impostazioni Studio → Canali), perché dal 16/09 sono **per studio** e un valore unico di piattaforma non può più essere giusto per cinque studi; la sezione 2 della guida non si chiama più «Parametri Ufficiali di Produzione»; i quattro link `file:///Users/mariodibenedetto/…` e `file:///Volumes/Macintosh%20HD/…` sono diventati percorsi **relativi** (puntavano a un Mac che non esiste per nessun altro lettore); il numero personale del titolare è uscito dalla guida (**quattro** occorrenze, non tre: righe 154, 174, 198, 240). **Lo scope è stato allargato due volte, e ogni volta per una misura.** (1) Il numero era anche **nel codice**: `prisma/seed.ts` lo metteva in due forme in `referenti_json` di un cliente dimostrativo — cioè il posto da cui un recapito vero entra nei dati di prova e, con un invio, nel telefono di qualcuno — e `AnagraficaErpModal.tsx:570` lo mostrava come `placeholder` nel campo «Numero Signal». **(2) `.env.example` raccontava la stessa storia vecchia della guida**, ed è il file che un operatore copia: dichiarava `WA_VERIFY_TOKEN` come «l'unica credenziale che NON sta sulla riga Tenant» e come ciò che l'handshake legge (falso dal 16/09: l'handshake legge `wa_verify_token` dello studio risolto dallo slug), diceva `WA_APP_SECRET` «a livello piattaforma, non per studio» (falso: è la colonna `wa_app_secret`, per studio, dalla migrazione `20260916180000`), e — il difetto vero — dichiarava **`WA_ACCESS_TOKEN`, che nessuno legge**: il seed legge `WHATSAPP_ACCESS_TOKEN`, che non era dichiarato da nessuna parte. Chi avesse compilato il nome scritto non avrebbe popolato niente, in silenzio. `WA_OTP_TEMPLATE`/`_LANG` non sono letti da nessuno nemmeno loro (`otpDispatch.ts` li nomina solo per dire che non li usa più). Ora il file dice che il backend in esecuzione non legge credenziali WhatsApp dall'ambiente, e tiene le tre variabili che **esistono** sotto un'intestazione che dice che le legge **solo il seed**. **Verificato in produzione, sola lettura**: esiste **un** cliente con il numero del titolare, `mario emirati arabi`, ed è una riga di prova del titolare su sé stesso — quindi non c'è niente da correggere nei dati, e non è stato scritto niente. Resta vero che **la cronologia di git non si dimentica**: i valori rimossi sono nei commit precedenti, e per il verify token la guida dice già da prima che va rigenerato su Meta se è mai comparso in un file versionato |
| 14 | **Il `telefono` dello studio è il numero di prova di Meta** | riga `tenant` dello studio Bluecode | A database è `+1 555-181-9633`, che è esattamente il `display_phone_number` del **Test Number** di Meta (`verified_name: "Test Number"`, `code_verification_status: NOT_VERIFIED`). Il numero vero dello studio, `+39 378 092 6461`, non è in nessuna riga. Finché resta così, ogni documento che stampa il recapito dello studio stampa un numero che non squilla |
| 15 | **Il frontend ha 6 file di test su 176 sorgenti** (~3%) | `frontend/src/` | Il backend ha 86 file e 1052 test; il frontend ha typecheck e build in CI e quasi nessuna rete. Ogni difetto di rendering — come il ✓✓ disegnato su righe mute, che stava in due componenti con la stessa bugia in entrambi — va scoperto a occhio |
| 16 | **Il calendario, i collaboratori e i compiti assegnati** — ✅ **RISOLTO il 18/09/2026 (Fasi A, B, C / C5 completate e rilasciate)** | `frontend/src/pages/CalendarPage.tsx`, `frontend/src/components/CalendarPreviewModal.tsx`, `src/routes/calendario.ts`, `src/services/compitiAssegnati.ts`, `src/services/calendarioEventi.ts` | Completato e rilasciato in produzione al 100%. (Fase A) Rotte backend in `src/routes/calendario.ts` (`GET/POST/PUT/DELETE /calendario/eventi`, `PATCH /stato`) con aggregazione scadenze reali (rate fatture, fine commessa progetti, contratti ricorrenti, KYC) e visibilità per ruolo/matrice permessi. (Fase B) Rimozione date e dati fittizi in `CalendarPage.tsx`: griglia dinamica con navigazione mese per mese e calcolo giorni reali (`calendarioDate.ts`). Modal `CalendarPreviewModal.tsx` allineato con salvataggio asincrono su DB. (Fase C / C5) Servizio centrale `src/services/compitiAssegnati.ts` per calcolare i compiti reali (`risorsaId` non nullo e `stato != 'done'`), nuova rotta `GET /calendario/compiti`, unificazione calcolo carico risorse in `/operatori-suggeriti` (`progetti.ts`), e sezione collassabile «📋 I miei compiti» in `CalendarPage.tsx`. Suite di test completa (1212 test totali verdi). |
| 17 | **Lo schema Prisma e il database divergono in più punti di quanto il piano dicesse** | `prisma/schema.prisma`, `prisma/migrations/`, database Supabase | Misurato il 17/09/2026 con `prisma migrate diff --from-schema-datasource … --to-schema-datamodel … --script` (sola lettura). Il piano, alla voce 10, affermava che `signal_cli_endpoint` fosse «la sola divergenza nota»: **falso**, e la correzione è istruttiva perché l'affermazione era stata scritta senza misurare. Le divergenze sono cinque, di gravità molto diversa. **(a) `fattura.cliente_id` era NULLABILE nel database e OBBLIGATORIO nel datamodel — ✅ RISOLTA il 18/09/2026.** Era l'unica davvero pericolosa: il database accettava una fattura senza cliente, TypeScript la leggeva come `string`, e il primo `.nome` su quella riga sarebbe stato un errore a runtime in una pagina che non c'entra nulla. Corretta con `20260918200000_fattura_cliente_id_not_null` (`SET NOT NULL`), dopo aver verificato in produzione (sola lettura) che le 4 fatture esistenti hanno **0 righe con `cliente_id` NULL**, quindi il vincolo non poteva fallire. **(b) 13 indici con nome scritto a mano** (`idx_*`, da `20260912150000_indici_performance` e `20260912160000_indici_performance_globale`) contro i nomi che Prisma genera da solo: sono **gli stessi indici sotto due nomi**, e Prisma li vede come 18 `RenameIndex`, 13 `DropIndex` e 4 `CreateIndex`. Non è un difetto — è che le migrazioni sono state scritte a mano — ma `prisma migrate dev` o `db push` proverebbero a «riconciliarlo» in modo distruttivo. **(c) 13 indici trigram** (`idx_*_trgm`, da `20260824150000_indici_trigram_ricerca_globale`) che Prisma **non sa esprimere** nel datamodel: li vorrà droppare per sempre. Fra questi c'è **`idx_evento_titolo_trgm` su `evento_calendario.titolo`**, che serve alla ricerca per titolo del calendario — quindi una ragione in più, concreta, per non eseguire mai `db push` su Supabase. **(d)** Deriva di default su `fattura` (`data`, `tipo_cliente_fiscale`, `canale`) e `fattura_riga` (`tipo`, `importo`). **(e)** `tenant.signal_cli_endpoint`, cioè la voce 10 — ✅ **RISOLTA il 18/09/2026** (colonna droppata). Restano aperte solo (b), (c) e (d), che sono deriva di indici e default da **non** toccare con `db push`. **La regola che ne esce, e che vale per chiunque tocchi le migrazioni: su Supabase si esegue solo `migrate deploy`** — che applica le migrazioni in sospeso e ignora la deriva — **mai `db push` né `migrate dev`.** Detto per inciso: `evento_calendario`, dopo la migrazione del 17/09, è **l'unica tabella a deriva zero**, ed è la verifica che quella migrazione è corretta |
| 18 | **La fatturazione salvava importi e IVA sbagliati** — ✅ **RISOLTO il 18/09/2026** | `src/adapters/prisma/prismaApp.ts` (`emettiFattura`), `src/routes/clienti.ts`, `src/schemas/clienti.schema.ts`, `prisma/migrations/20260918180000_regime_iva_cliente/`, `frontend/src/components/projectDetail/FatturazioneTab.tsx`, `frontend/src/components/clients/AnagraficaErpModal.tsx`, `frontend/src/pages/ProjectDetail.tsx`, `frontend/src/types/index.ts` | Due difetti confermati leggendo il codice, non solo il report. **(a) Netto scambiato per lordo.** `emettiFattura` trattava l'importo di riga come lordo e ci **scorporava** il 22% (`imp = tot/1.22`), mentre il modale manda l'**imponibile** e mostra «imponibile + IVA = totale»: a database finivano un imponibile più basso di quello approvato e un totale pari all'imponibile mostrato (selezioni €120 → l'anteprima dice €146,40, il DB diceva €120). Ora l'importo è l'imponibile, l'IVA si somma sopra. **(b) IVA sempre al 22%.** Scriveva `aliquotaIva: 22` fisso e ignorava il `tipoClienteFiscale`: un cliente estero mostrato «0%» era fatturato al 22%. Ora l'aliquota viene dal **regime del cliente** — nuove colonne `aliquota_iva_default`/`natura_esenzione_default` (migrazione additiva), impostabili in Anagrafica → Fatturazione SDI — con ripiego al comportamento di prima quando non è dichiarata (`??`, non `||`: 0 è un'aliquota valida, non «non dichiarato»). Anteprima del modale allineata al backend e anteprima delle fatture emesse che mostra l'IVA reale invece di un 22% cablato. **Prova:** `src/emettiFattura.test.ts`, 7 test, 3 mutazioni uccise (scorporo, aliquota fissa, `??`→`||`). Backend 1219 test + `tsc` verdi; frontend 81 test + `typecheck` verdi. Scelte del titolare: importo = imponibile; IVA guidata dal cliente; nessun blocco server sulle micro-voci non completate (resta il default di selezione sulle sole `done`) |
| 19 | **Firma portale: il modale del codice restava aperto e i canali non dicevano la loro disponibilità** — ✅ **RISOLTO il 18/09/2026** | `frontend/src/components/portal/usePortalFirma.ts`, `frontend/src/components/portal/FirmaOtpModal.tsx`, `frontend/src/pages/ClientPortal.tsx` | Due cose, di cui una sola era un difetto di codice. **(a) Il modale non si chiudeva a firma avvenuta** (difetto vero). In `confermaFirmaConOtp` la chiusura stava **dopo** `registraEsitoFirma`, che esegue riletture di vista post-firma: se una rilettura andava giù (rete), l'eccezione finiva nel `catch` e il modale del codice restava aperto con un errore **su una firma già apposta a database**. Ora la chiusura avviene subito dopo la verifica riuscita, e le riletture sono rese best-effort (un loro fallimento non si propaga: lo stato si riconcilia al prossimo accesso). **(b) Telegram «non invia il codice»** — non è un difetto del backend: il percorso di invio è integro e ogni fallimento torna come 502, mai un finto successo. Il vero problema è che il selettore di canale nel modale era un elenco **cablato** di quattro pulsanti tutti attivi, che ignorava la disponibilità calcolata dal backend (`canaliFirmaApi`): scegliere Telegram in uno studio senza bot non dava nessun riscontro. Ora il selettore rispetta `disponibile`/`motivo` — un canale spento è disabilitato e ne mostra la ragione. **Misurato in produzione (sola lettura, 18/09/2026):** dei 5 studi **solo Bluecode** ha il bot Telegram configurato (token + username `BlueCodeStudio_Bot`); gli altri quattro non hanno token, quindi lì Telegram non può spedire. **Azione lato titolare:** configurare il bot in Impostazioni → Canali nello studio in cui si prova, e verificare che la chat id del cliente sia una conversazione viva con *quel* bot |
| 20 | **166 `alert()` nativi sostituiti da un sistema di toast** — ✅ **RISOLTO (2026-09-21, commit e34d6de)** | `frontend/src/components/ui/ToastProvider.tsx`, `frontend/src/styles/tokens.css` (blocco `.toast-*`) | L'app usava `window.alert()` bloccante per ogni riscontro (successo, errore, avviso). Ora un `ToastProvider` montato in `App.tsx` espone un bus a livello di modulo (`export const toast`, con `useToast()` dentro l'albero) che accoda notifiche non bloccanti nel `.toast-viewport` (z-index 1100). Fuori dal provider il fallback resta `alert`. È la premessa dell'accessibilità della voce 21: un `confirm()` accessibile non aveva senso finché gli avvisi erano ancora nativi |
| 21 | **Modali accessibili + guardia «modifiche non salvate» + `confirm()` accessibile** — ✅ **RISOLTO (2026-09-21 Fase 1 commit c3eea01, 2026-09-22 Fase 2 commit bcc0653)** | `frontend/src/components/ui/Modal.tsx`, `frontend/src/components/ui/ConfirmProvider.tsx`, `frontend/src/App.tsx`, `frontend/src/styles/tokens.css` | Prima 45 modali replicavano a mano un overlay `position:fixed inset:0` senza `role="dialog"`, senza focus-trap, senza gestione di Escape, con z-index incoerenti (100–120 inline vs 1050 nelle classi) e nessuna guardia sulle modifiche; 14 file usavano `confirm()` nativo. Ora il `<Modal>` condiviso **avvolge** il contenuto esistente (form e stili inline invariati) e porta gratis: `role=dialog` + `aria-modal` + `aria-labelledby`, focus-trap con ripristino del focus al trigger, Escape, chiusura dal backdrop su `mouseDown`+`currentTarget`, e una **guardia auto-dirty** (listener `onInput`/`onChange` in cattura → chiede conferma di uscita **solo se** l'utente ha modificato qualcosa; sola lettura = mai dirty = chiude subito). La guardia scatta su **tutte** le chiusure (Escape, backdrop, ✕, Annulla) via `useModalClose()`. `ConfirmProvider` rispecchia il pattern del toast ma il bus ritorna `Promise<boolean>` (coda, un dialog per volta, `role=alertdialog`, z-index 1200 sopra modali e toast); ha sostituito tutti i 14 `confirm()` nativi. Completato anche il resto della voce a11y: `:focus-visible` globale, contrasto di `--hint` verificato ≥4.5:1, `aria-label="Chiudi"` sui pulsanti ✕. Verifica: typecheck 0, build 0, 105/105 vitest |
| 22 | **Lo storico contrattuale dichiarava «firmata» una engagement letter mai firmata** — ✅ **RISOLTO (2026-09-22, commit d2f1c0a)** | `src/adapters/prisma/prismaApp.ts` (`getProgetto`), `frontend/src/types/index.ts`, `frontend/src/pages/ProjectDetail.tsx`, `frontend/src/components/projectDetail/StoricoContrattiTab.tsx` | Il tab «Storico Contrattuale» deduceva lo stato di firma da `project.st`: un progetto passa a `in_progress` **solo accettando un preventivo** (`istanziaProgetto`), senza che il cliente abbia mai firmato — la firma OTP vera avviene in `firma.ts` ed è un fatto distinto. La UI mostrava quindi «🔒 FIRMATA / contratto congelato» su lettere mai firmate: un'affermazione legale falsa. Ora il backend espone il dato **reale** (`getProgetto` include i `preventivi` con `engagementLetter.statoFirma`/`firmatoAt`, escludendo le archiviate), il tipo `Progetto` porta `statoFirma?`/`firmatoAt?`, e il badge distingue **tre** stati senza mai affermare una firma non provata: **firmata** (`statoFirma === 'completata'`, verde, con la data reale), **in attesa** (`st === 'pre_project'` o `statoFirma === 'in_attesa'`, ambra), **non tracciata** (nessuna letter/dato: neutro, «emessa», con nota esplicita). Coerente con la regola 7 (il frontend non inventa dati). Verifica: BE tsc 0, FE typecheck/build 0, 105/105 vitest · ⚠️ **Aggiornamento 02/10/2026 — la fonte scelta qui era a sua volta sbagliata**: `getProgetto` leggeva `preventivi[].engagementLetter.statoFirma`, ma `engagement_letter` non la scrive **nessuna rotta** (in produzione: zero righe), quindi il default `in_attesa` non è mai cambiato e la scheda diceva «IN ATTESA» anche su lettere firmate — mentre il portale, che legge `firma_elettronica`, le dava per firmate. La fonte è ora `firma_elettronica` (ambito `engagement_letter`, riferimento = il progetto), esposta da `getProgetto` come `firmaLettera`: la stessa riga che legge il portale. Presidio: `src/firmaLetteraStudio.test.ts` |
| 23 | **Wizard nuovo progetto: moduli non ispezionabili + testo invisibile in tema chiaro** — ✅ **RISOLTO (2026-09-22, non ancora deployato)** | `frontend/src/components/NewProjectWizard.tsx`, `frontend/src/utils/index.ts` (`resolveRighe`) | Due difetti segnalati dall'operatore. **(a) Moduli non ispezionabili**: nello step «Libreria Moduli» i moduli mostravano solo nome, conteggio articoli e prezzo — l'operatore non poteva vedere *cosa contiene* un modulo (articoli, ore, importi) senza ricordarlo a memoria. Aggiunto un pulsante ℹ️ accanto a ciascun modulo (specifico/generico/altre-giurisdizioni) che apre una scheda di dettaglio (Modal di sola lettura, z-index 120) con la distinta reale da `resolveRighe`: per riga nome articolo, ore stimate, importo, badge «tariffa su misura» se c'è un override, più il totale ore+importo. Perché i dati fossero **reali** e non il ripiego generico di `resolveRighe` (`{n:'Prestazione', h:5, p:500}`), il caricamento moduli ora mappa `artObj` su ogni riga dai dati dell'API. **(b) Contrasto tema chiaro**: le card di giurisdizione, quando selezionate, usavano `color:'#fff'` cablato su uno sfondo `--surface-1` (`#f8fafc`, quasi bianco) → testo invisibile in tema chiaro (stesso pattern del bug della voce audit). Sostituito con token consapevoli del tema (`var(--indigo-l)` da selezionato, `var(--text)` altrimenti). Verifica: typecheck 0, build 0, 105/105 vitest. **Resta**: deploy previa autorizzazione del titolare |

### Cosa manca, misurato il 17/09/2026

Queste non sono voci da fare: sono il **punto di partenza** che rende oneste le voci sopra.
Lette con `railway run --service bluman-api` e il ruolo amministrativo — con il ruolo
`bluman_app` la RLS restituisce vuoto senza errore, quindi un elenco vuoto lì non significa
«non c'è niente».

**In produzione non è mai passato un cliente vero.** Ogni riga che sembra traffico è una prova
del titolare:

| Cosa | Quanti | Quali |
|---|---|---|
| Eventi WhatsApp in ingresso, da sempre | 2 | `wamid.TEST123`, `wamid.SIMULATE_20260917181719` — simulazioni |
| Messaggi Telegram in ingresso | 6 | «Hahahah», «Ccccccccc», «Bbbbbnn» |
| Avvisi `messaggio_non_instradabile` | 9 | tutti in un'ora, il 16/09 |

Questo non sminuisce i difetti, ma cambia il loro peso: **nessuno ha ancora subito un danno**, e
nessun canale è *dimostrato* funzionante con un cliente vero. Vale anche al contrario — un
difetto d'ingresso che sembra grave non ha ancora fatto perdere niente a nessuno.

**Configurazione dei canali per studio:** solo Bluecode ha credenziali WhatsApp (`waPhoneId`,
`waAppId`, `waVerifyToken`); gli altri quattro studi hanno lo `slug` webhook ma **nessuna**
credenziale. L'ingresso è predisposto per tutti, l'uscita per uno.

**Il numero WhatsApp in uso è il Test Number di Meta**, non un numero dello studio:
`+1 555-181-9633`, `platform_type: CLOUD_API`, `status: CONNECTED`, `code_verification_status:
NOT_VERIFIED`. L'invio verso l'esterno funziona (è la conferma che token e Phone Number ID sono
validi); la ricezione no.

**La catena di ricezione, lato nostro, è integra.** Verificato il 17/09 con Graph:
l'app `BluMan` (`1045995174927441`) ha la sottoscrizione attiva su
`whatsapp_business_account` con il campo `messages`; il callback URL punta al nostro slug giusto
(`…/webhooks/communications/whatsapp/5f719984df6792f50b35223dd33bf9bc`) e il numero ha quel
webhook come `webhook_configuration.application`. L'App Secret salvato **è valido** — la prova è
che `{app-id}|{app-secret}` viene accettato da Graph — quindi `verificaFirmaWhatsapp` non è la
causa. E due eventi simulati hanno attraversato tutta la catena fino al fascicolo.

**Quindi il punto è perché Meta non consegna.** L'ipotesi principale è il limite del Test
Number: un numero di prova accetta messaggi solo dai numeri registrati come destinatari di prova
nella dashboard dell'app. **Non è verificato** — la lettura della documentazione Meta non era
disponibile — e va confermato con la prova che segue, non dato per buono.

**La prova che chiude la domanda, in un minuto:** scrivere un messaggio WhatsApp al
`+1 555-181-9633` da un telefono e guardare i log mentre arriva —
`railway logs --service bluman-api`. Se compare un `POST /webhooks/communications/whatsapp/<slug>`
allora Meta consegna ed è il nostro handler a rifiutare (e il log dice con quale codice: 401
firma, 409 numero, 404 slug). Se non compare **niente**, Meta non consegna e nessuna correzione
di codice può farcela: la strada è registrare il numero vero, che è la stessa cosa che l'ingresso
aspetta da sempre.

---

## 1ter. Calendario, collaboratori e compiti assegnati

> Origine: piano proposto dall'utente il 17/09/2026, verificato riga per riga sul codice e qui
> ampliato. Le risposte alle due domande aperte sono registrate in §1ter.0. La parte che l'utente
> ha chiesto di curare in modo particolare — **chi visualizza cosa** — è §1ter.3, e non è una
> rifinitura: è il vincolo che decide la forma dell'endpoint.

### 1ter.0 Le due decisioni, registrate

| Domanda | Risposta | Cosa significa in pratica |
|---|---|---|
| Implementare il calendario per intero (backend + frontend + assegnazione reale)? | **Sì** | Le tre fasi di §1ter.4-1ter.6 si fanno tutte. Nessuna scorciatoia «solo frontend». |
| Aggregare automaticamente scadenze fatture e fine progetti nel calendario? | **Sì** | Il calendario legge le stesse regole che il cron già applica (§1ter.4, punto 2). Non una seconda verità. |

Istruzione aggiuntiva dell'utente, verbatim: *«stando attento a chi visualizza cosa»*.

### 1ter.1 Cosa c'è oggi, misurato

**La risposta secca, perché è la prima cosa da sapere: di questo piano non è implementato niente.**
Non «è implementato in parte», non «manca la rifinitura»: quello che esiste nel codice è la
**controffigura** del piano — un calendario che disegna date che nessuno ha, e un'assegnazione che
scrive in un posto dove nessuno legge. L'unico pezzo del piano già presente è il campo
`TeamMember.dbId` (`useTeamMembers.ts:80-82`), che porta lo `userId` vero accanto all'id numerico
della UI: è il gancio su cui si innesta C1, e c'è già.

Lo scheletro dei dati, invece, c'è dalla prima migrazione: `EventoCalendario`, `AccessoRisorsa` e
`MicrovoceProgetto.risorsaId` sono stati **progettati** fin dall'inizio. Nessuno li ha mai
**accesi**. La tabella in fondo a questa sezione lo misura.

Il calendario è la parte dell'applicazione dove la regola 7 (il frontend non inventa dati che il
database non ha) è violata più a fondo, perché l'invenzione è **sistematica** e non si vede: le date
finte sono costruite con un contatore, quindi sembrano dati veri.

**`frontend/src/pages/CalendarPage.tsx` (567 righe)**

| Riga | Cosa c'è | Perché è un difetto |
|---|---|---|
| 172-173 | `const daysInMonth = 31;` | Il mese mostrato ha sempre 31 giorni, anche a febbraio. |
| 295 | `` `2026-08-${…}` `` | L'anno e il mese sono costanti nel sorgente. |
| 283 | `<h3>Agosto 2026</h3>` | L'intestazione non deriva da nessuna data. |
| 297 | `const isToday = day === 14;` | «Oggi» è per sempre il 14. Il badge *Oggi* è una decorazione. |
| 49 | `c.dataKyc ? … : '2026-08-' + (12 + idx % 15)` | Se il KYC non c'è, la data **non manca**: viene inventata dal numero d'ordine del cliente. |
| 71 | `` `2026-08-${14 + pIdx % 12}` `` | La scadenza di consegna di ogni progetto è inventata. |
| 91 | `` `2026-08-${18 + iIdx % 10}` `` | La scadenza di ogni fattura è inventata. |
| 121-127 | `formData = '2026-08-18'`, `formOperatore = 'Joe Disabato'` | Valori di partenza cablati. |
| 535-538 | 4 clienti con 4 partite IVA inventate | Un elenco di clienti che non esiste, in un `<select>` che si presenta come «dall'Anagrafica ERP». |
| 105 vs 149-152 | legge `bluman_custom_calendar_events_tenant_<id>`, scrive `bluman_custom_calendar_events` | `getTenantStorageKey` (`utils/tenant.ts:141-144`) antepone `_tenant_<id>`: **la lettura e la scrittura usano due chiavi diverse.** Un evento creato a mano non ricompare dopo il ricaricamento. |
| 159-164 | `handleToggleComplete` | Cambia solo lo stato React. Nessuna persistenza: «completato» svanisce al reload. |
| — | nessuna chiamata a `EventoCalendario` | Il modello Prisma esiste da sempre e nessuno ci scrive (vedi sotto). |

**`frontend/src/components/CalendarPreviewModal.tsx` (332 righe)**

- riga 54: `Array.from({length: 31}, …)` — stesso mese di 31 giorni;
- riga 115: `🗓 Agosto 2026` cablato;
- righe 156/163/170: i preset «+3 Giorni», «+1 Settimana», «Fine Mese» sono tre date fisse
  (`2026-08-18`, `2026-08-22`, `2026-08-31`) — non calcolano niente;
- riga 32: `useState<number>(1)` — l'operatore preselezionato è l'id numerico 1, cioè quello che
  `useTeamMembers` assegna per hash al primo membro;
- riga 306: la casella dichiara *«Invia Notifica Email & Reminder SMTP all'Operatore ed al Cliente
  (24h prima)»*. Il valore `sendEmail` viene scritto nell'oggetto salvato in `localStorage`
  (`ProjectDetail.tsx:193`) e **nessuna email parte**: non c'è nessun consumatore di quel campo;
- riga 105: a conferma avvenuta annuncia *«notificato all'operatore»*. È la stessa classe di
  bugia: una notifica dichiarata senza che nessuno l'abbia inviata.

**Due archivi locali che non si parlano**

`ProjectDetail.tsx:193` scrive le attività pianificate in `bluman_calendar_events` (con la chiave
del tenant). `CalendarPage.tsx` legge **solo** `bluman_custom_calendar_events`. Quindi: pianificare
un'attività dal fascicolo non la fa comparire nel calendario. Sono due depositi disgiunti, nessuno
dei due è una tabella.

**`EventoCalendario` esiste e non ha scrittori**

`prisma/schema.prisma:1160` definisce `EventoCalendario`. Chi lo usa:

- `src/services/ricercaGlobaleService.ts:142` — lo **legge**;
- `src/adapters/prisma/prismaApp.ts:509` — cancella le righe del progetto;

nessuno lo **crea**. La tabella è vuota per costruzione, e la ricerca globale ha una sorgente che
non può restituire niente. Il modello è anche troppo magro per la UI: ha solo `titolo`,
`dataInizio`, `dataFine`, `userId`, `progettoId` — mancano categoria, stato, priorità, note,
cliente e l'assegnatario, e non ha **nessun indice** (nessun `@@index`), quindi qualunque query per
intervallo di date è una scansione completa.

**`src/routes/calendario.ts` non esiste.** Non c'è nessuna rotta che legga o scriva un evento.

**Assegnazione dell'operatore, i tre punti rotti**

| Dove | Cosa c'è | Effetto |
|---|---|---|
| `ProjectDetail.tsx:232` | `assegnaAccessoProgettoApi(String(project.id), \`usr-0${operatorId}\`, roleLevel)` | Manda un id costruito concatenando una stringa al numero della UI (`usr-01`). Lo `userId` vero viaggia in `TeamMember.dbId` (`useTeamMembers.ts:82`) e non viene usato. La riga di `accesso_risorsa` o non si crea o punta a nessuno. |
| `ProjectDetail.tsx:270` | `const assignedAs = mv.as \|\| mv.assegnatoId \|\| localMv?.as \|\| 1;` | Se a database non c'è un assegnatario, la micro-voce viene mostrata come assegnata all'operatore 1. Un compito non assegnato si presenta come assegnato. |
| `src/routes/progetti.ts:595` (`PUT /progetti/:id/stato-completo`) | non scrive mai `risorsaId` | `MicrovoceProgetto.risorsaId` esiste (`schema.prisma:548-549`, relazione `RisorsaAssegnata`) e resta sempre `NULL`: l'assegnazione fatta nella UI non arriva a database. |
| `GET /progetti/:id` | non include `risorsa` | Anche se `risorsaId` fosse scritto, la lettura non lo riporterebbe: manca il `include`. |

Conseguenza complessiva: **oggi non esiste un compito assegnato a una persona.** Esiste un numero
in una casella del browser. `AccessoRisorsa` (§19) e `MicrovoceProgetto.risorsaId` sono lo scheletro
di una funzione che nessuno ha ancora collegato.

**Le tre tabelle di questa funzione, lette in produzione il 17/09/2026**

| Tabella | Righe | Cosa significa |
|---|---|---|
| `evento_calendario` | **0** in tutti e 5 gli studi | Nessuno ci ha mai scritto. La lettura di `ricercaGlobaleService.ts:142` interroga una tabella vuota per costruzione. |
| `accesso_risorsa` | **0** in tutti e 5 gli studi | Nessun accesso a progetto è mai stato concesso. La rotta `assegnaAccessoProgettoApi` non ha mai scritto una riga utile. |
| `microvoce_progetto.risorsa_id` | **0 valorizzate** su tutte le micro-voci | Nessuna micro-voce è mai stata assegnata. Il carico di lavoro (`progetti.ts:1199`, via `caricoPerRisorse`) somma ore su un campo sempre `NULL`. |

E le sorgenti da cui il calendario dovrà derivare, nello stesso momento:

| Sorgente | Righe | Nota |
|---|---|---|
| `scadenza_incasso` | 2 (solo nel primo studio) | Esiste, ed è la sorgente giusta per le scadenze di incasso — non `Fattura.data`. |
| `cliente.data_kyc` | 2 clienti (solo nel primo studio) | Valorizzato dall'anagrafica. |
| `progetto.data_scadenza` | **0** | Nessun progetto ha una scadenza a database. La data di consegna che il calendario mostra oggi per ogni progetto è **interamente inventata**. |

Quest'ultima riga è la più importante delle tre: non è che il calendario mostri una data sbagliata
per i progetti. È che **non esiste nessuna data da mostrare**, e il calendario ne produce una per
ogni progetto. È il caso puro della regola 7.

### 1ter.2 La regola che tiene insieme il lavoro

Tutto quanto segue serve una cosa sola: **che un evento del calendario sia una riga, e che la riga
dica da dove viene.** Le date finte non sono un problema di dati, sono un problema di provenienza:
finché un evento può nascere nel browser, non c'è modo di sapere se una scadenza è vera.

Quindi: nessun evento nasce nel frontend. Il frontend chiede un intervallo di date e riceve righe.

### 1ter.3 Chi visualizza cosa

Questa è la parte che l'utente ha chiesto di curare. Il calendario è la superficie più delicata
dell'applicazione perché **aggrega sorgenti di sensibilità diversa nella stessa griglia**:

- un rinnovo KYC/AML riguarda l'antiriciclaggio di un cliente;
- una scadenza di rata porta l'importo;
- una milestone porta il nome di un progetto e di un cliente;
- un promemoria personale non riguarda nessun altro.

Metterli nella stessa risposta senza filtrare significa che chi vede il calendario vede tutto. La
regola va applicata **nel backend, per sorgente**, mai con un flag che il client manda.

**Il principio:** un evento eredita la visibilità della sua sorgente. Non esiste un permesso
«calendario»: esiste il permesso sull'oggetto da cui l'evento deriva.

| Categoria | Sorgente | Chi la vede |
|---|---|---|
| `promemoria` | `evento_calendario` | Solo `userId` proprietario, più l'`assegnatoAId` se il compito è stato affidato a qualcuno. Un `collaboratore_esterno` vede i propri. |
| `microvoce` | `microvoce_progetto` + `accesso_risorsa` | Chi ha una riga in `accesso_risorsa` su progetto, modulo o micro-voce; più `advisor` e `super_admin` dello studio. |
| `kyc` | `cliente.data_kyc` | Solo ruoli interni dello studio. **Mai** il ruolo `cliente`. |
| `fattura` | `scadenza_incasso` | Solo chi vede i dati contabili. **Mai** `collaboratore_esterno` né `cliente`: l'importo di una rata di un altro cliente non è un dato di lavoro, è un dato riservato. |
| `contratto` | `contratto_ricorrente` / `EngagementLetter` | Ruoli interni. |
| `progetto` | `progetto.data_scadenza` | Chi ha accesso a quel progetto (`accesso_risorsa`, risalendo da modulo e micro-voce), più `advisor` e `super_admin`. |

**La sesta categoria è stata aggiunta il 17/09/2026, ed è una deviazione dal piano.** La tabella qui
sopra ne prevedeva cinque e nessuna per la **fine di un progetto** — che è una delle due cose che
l'utente ha chiesto di aggregare automaticamente nel calendario. Non è stata mappata su `promemoria`
per la ragione che rende quella categoria inadatta: `promemoria` è la riga di **una persona**,
visibile solo a chi l'ha scritta, mentre la scadenza di un progetto la devono vedere tutti quelli che
sono sul progetto. Mapparla lì l'avrebbe resa invisibile a chi deve rispettarla. Le asserzioni
ruolo × categoria sono quindi **trenta**, non venticinque.

**L'assegnazione concede la lettura, e non solo la scrittura.** Assegnare un compito a qualcuno che
non può vederlo è un'assegnazione che non esiste, quindi una riga è leggibile dal suo proprietario
**e** dal suo assegnatario — le stesse due persone che `PATCH /:id/stato` autorizza a cambiare lo
stato. Il piano non lo diceva, e la prima stesura di questo codice non era coerente con sé stessa:
la lettura ammetteva il solo proprietario, la scrittura anche l'assegnatario. Un test ha reso la
contraddizione visibile, ed è la ragione per cui è scritta qui.

**Il portale del cliente è un'altra cosa, non un filtro di questa.** `clienti`/`cliente` oggi ha una
sessione separata (`bluman_portal_token`). Il portale deve avere un proprio feed, con dentro **solo**
gli appuntamenti che lo riguardano: videochiamate, riunioni, scadenze di documenti che deve
consegnare. Mai il rinnovo KYC (è una valutazione interna sul rischio del cliente), mai un importo
di rata, mai un nome di un altro cliente, mai una nota operativa scritta per il team.

**Tre presidi che rendono la regola verificabile invece che dichiarata:**

1. L'endpoint **non accetta un `userId` dal corpo o dalla query** per decidere di chi sono gli
   eventi: lo ricava dal token. Per un `collaboratore_esterno` chiedere il calendario di un altro
   non è un 403 con un messaggio che rivela che l'altro esiste — è un insieme vuoto.
2. Il filtro per categoria **restringe, non allarga**: se il ruolo non ha diritto a `fattura`,
   passare `?categorie=fattura` restituisce vuoto, non i dati.
3. Un test per ruolo × categoria, che asserisce l'assenza. La tabella qui sopra è la specifica di
   quel test: cinque ruoli (`super_admin`, `advisor`, `collaboratore_interno`,
   `collaboratore_esterno`, `cliente`) per le categorie della tabella — trenta asserzioni con la
   sesta categoria, e le trenta stanno in un file solo (`src/util/calendarioVisibilita.test.ts`).
   La matrice è scritta **una volta** e i test la percorrono: trenta `it` separati avrebbero
   prodotto trenta posti in cui correggere una cella invece di uno.

4. La categoria non è la sola cosa che filtra: la **matrice permessi** può togliere una categoria
   che il ruolo vedrebbe. Un `collaboratore_interno` con `scadenzario: denied` non vede le rate,
   perché `/calendario` non è in `ROTTE_MODULO` e il guard globale non lo tocca: senza questa
   lettura, il calendario diventerebbe la porta di servizio da cui quell'utente vede gli importi
   che gli sono stati esplicitamente tolti. Vale per `fattura` soltanto, che è l'unica categoria
   la cui sorgente ha un modulo nella matrice.

### 1ter.4 Fase A — Il backend del calendario

**A1. Estendere `EventoCalendario`** (`prisma/schema.prisma:1160`) — ✅ **fatto** il 17/09/2026,
migrazione `20260917120000_evento_calendario_compiti`, applicata su Supabase e verificata a deriva
zero. Serve una migrazione che aggiunga:

- `categoria` (enum: `promemoria`, `microvoce`, `kyc`, `fattura`, `contratto`);
- `stato` (enum: `da-fare`, `fatto`, `annullato`);
- `priorita` (enum: `alta`, `media`, `normale`);
- `note String?`, `luogoUrl String?`;
- `clienteId String?` (FK `Cliente`), `moduloProgettoId String?`, `microvoceProgettoId String?` — le
  tre provenienze, così un evento generato sa da dove viene e può essere rigenerato o spento;
- `assegnatoAId String` (FK `User`) — **distinto da `userId`**: `userId` è di chi è il calendario,
  `assegnatoAId` è chi deve fare il compito. Oggi il modello ha solo il primo, e senza il secondo
  «compito assegnato» non si può esprimere;
- `generato Boolean @default(false)` — vero per le righe che il sistema deriva da fatture, KYC e
  progetti. Serve a non cancellare per sbaglio un promemoria scritto a mano, e a distinguere in UI
  ciò che una persona ha scritto da ciò che una regola ha dedotto;
- **indici**: `@@index([tenantId, dataInizio])` (è la query del calendario) e
  `@@index([tenantId, assegnatoAId, stato])` (è la query «i miei compiti aperti»). Oggi non ce n'è
  nessuno.

**A2. La policy RLS va verificata, non aggiunta.** ✅ **verificato di nuovo** il 17/09/2026, questa
volta interrogando il database invece di ricordarlo: `relrowsecurity = true`,
`relforcerowsecurity = true`, **1 policy**. `evento_calendario` **è già protetta**: misurato
in produzione il 17/09/2026, ha `relrowsecurity = true`, `relforcerowsecurity = true` e la policy
`isolamento_tenant`. La modifica di A1 aggiunge colonne a una tabella che ha già un `tenant_id`
obbligatorio, quindi **non serve una nuova policy** — e va anche detto che `prisma migrate deploy`
(`Dockerfile`) non la creerebbe comunque: la RLS di base sta in
`supabase/migrations/20260819_rls_effettiva.sql`, che è uno script Supabase applicato una volta a
mano e che **introspeziona** invece di elencare:

```sql
FOR t IN SELECT c.relname FROM pg_class c …
   AND EXISTS (SELECT 1 FROM information_schema.columns col
                WHERE col.table_name = c.relname AND col.column_name = 'tenant_id'
                  AND col.is_nullable = 'NO')
```

quindi ogni tabella con `tenant_id` obbligatorio è coperta. La stessa interrogazione in produzione
dà **zero tabelle con `tenant_id` obbligatorio e nessuna policy**. Il modello da copiare, se un
giorno servisse per una tabella *nuova*, è
`prisma/migrations/20260912120000_webhook_inbox/migration.sql`, che avvolge tutto in un
`DO $$ … IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'bluman_app') …` così la migrazione
resta applicabile anche dove il ruolo non esiste. **La lezione da conservare è l'ordine: prima si
misura se la policy c'è, poi si scrive.** L'ipotesi contraria — «una tabella nuova nasce esposta» —
è ragionevole e in questo caso è falsa.

**A3. `src/routes/calendario.ts`** — cinque rotte, tutte con il filtro di §1ter.3 applicato dentro:

| Rotta | Cosa fa |
|---|---|
| `GET /calendario/eventi?da=&a=&categorie=` | L'intervallo, filtrato per ruolo e per diritti sulle sorgenti. Restituisce anche le righe **generate**, che non sono in tabella. |
| `POST /calendario/eventi` | Crea un promemoria. `userId` dal token, `tenantId` dal contesto. `categoria` limitata a `promemoria` e `contratto`: un evento `fattura` o `kyc` non si crea a mano, si deriva. |
| `PUT /calendario/eventi/:id` | Modifica titolo, date, note, priorità. 404 se la riga non è del tenant. |
| `PATCH /calendario/eventi/:id/stato` | `da-fare` ⇄ `fatto` ⇄ `annullato`. Sostituisce l'attuale `handleToggleComplete`, che non persiste. |
| `DELETE /calendario/eventi/:id` | Solo su righe `generato = false`. Un evento derivato da una fattura non si cancella: si cancella la fattura, o si annulla la scadenza. |

Una cosa scoperta misurando, e che conviene sapere prima di scrivere la ricerca per titolo:
`evento_calendario` ha **già** un indice trigram, `idx_evento_titolo_trgm`, creato a mano da
`20260824150000_indici_trigram_ricerca_globale` e invisibile al datamodel Prisma (voce 17). C'è
quindi un indice su `titolo` che Prisma non conosce: la ricerca `ILIKE '%…%'` è già coperta, e
quell'indice va dato per presente invece di aggiungerne un secondo.

**A4. Le regole di derivazione — una sola implementazione, due consumatori.** ✅ **fatto** il
17/09/2026 (`2bbf310`), in `src/util/scadenzeDerivate.ts`. Il cron
(`src/services/cronService.ts`) già calcola, per tenant:

- rinnovo KYC a `dataKyc + 1 anno − 30 giorni` (`cronService.ts:50-53`);
- rate in `stato = 'in_attesa'` a `−7 giorni`, oggi, o scadute da 3 (`cronService.ts:69-77`);
- fatture scadute e micro-voci in ritardo (report `runDailyNotificationCron`).

Il calendario **deve leggere quelle stesse regole**, non riscriverle. Due implementazioni della
stessa scadenza divergono, e allora il calendario e la notifica dicono due cose diverse — che è
esattamente la classe di difetto che questa sessione sta togliendo dal resto dell'applicazione. La
forma giusta è estrarre la parte di calcolo in un modulo puro (es.
`src/util/scadenzeDerivate.ts`) che il cron usa per notificare e la rotta usa per mostrare.

**A5. Correggere la sorgente delle scadenze di incasso.** La pagina oggi usa `inv.dataEmissione`
(`CalendarPage.tsx:91`) — cioè la data di **emissione** della fattura, che non è una scadenza. La
scadenza è `ScadenzaIncasso.dataScadenza`, per singola rata, con `importoCentesimi` e `stato`
(`schema.prisma:948-961`). Una fattura a 30gg con data di emissione oggi produce un evento sbagliato
di trenta giorni.

**A6. Fine progetto da `Progetto.dataScadenza`** (`schema.prisma`, campo `dataScadenza`), non dalla
posizione nell'elenco. Va incluso anche `stato`, perché un progetto `chiuso` non ha una scadenza
aperta.

### 1ter.5 Fase B — Il calendario diventa reale

**B1. `CalendarPage.tsx` perde le costanti di tempo.** Griglia costruita da `new Date()`: primo
giorno del mese, giorni del mese (`new Date(anno, mese + 1, 0).getDate()`), offset del giorno della
settimana, «oggi» vero. Navigazione mese precedente/successivo. L'intestazione deriva dalla data.

**B2. Spariscono le date inventate.** Le tre righe 49, 71, 91 e i loro ripieghi. Un cliente senza
`dataKyc` non produce un rinnovo KYC: non produce niente. **Un evento che manca è un'informazione;
un evento inventato è una bugia** — ed è la differenza che questo piano esiste per ripristinare.

**B3. Sparisce l'elenco di clienti finto** (righe 535-538) e i due valori cablati (righe 121-127).
Il `<select>` si popola da `fetchClienti()`, che la pagina già chiama alla riga 36 e poi non usa per
il modulo.

**B4. Un solo archivio.** Le due chiavi `localStorage` spariscono entrambe; eventi e attività
pianificate passano dalla rotta. `handleToggleComplete` chiama
`PATCH /calendario/eventi/:id/stato`.

**B5. `CalendarPreviewModal.tsx` perde il mese di agosto.** Minicalendario reale (riga 54), preset
calcolati da oggi e non tre costanti (righe 156-170), `initialDate` da chi apre il modale e non
`'2026-08-25'` (riga 27). La casella email (riga 306) o **invia davvero**, o si toglie: al momento
promette un reminder SMTP a 24 ore e l'unica cosa che fa è scrivere `sendEmail: true` in un oggetto
locale. La riga 105 («notificato all'operatore») si allinea alla verità: se la notifica parte, si
dice; se non parte, non si dice.

**B6. Il modale scrive un evento vero.** Oggi `handleSaveCalendarEvent` (`ProjectDetail.tsx:148`)
scrive in `localStorage` e chiama `salvaSuDatabase(updatedProject)`. Deve invece creare una riga in
`evento_calendario`, con `generato = false`, `microvoceProgettoId` valorizzato (così l'evento resta
agganciato al compito da cui è nato) e `assegnatoAId` = l'operatore scelto.

### 1ter.6 Fase C — L'assegnazione dell'operatore

**C1. `ProjectDetail.tsx:232`** — la correzione è di una riga ma è la più importante delle tre:
`\`usr-0${operatorId}\`` diventa lo `userId` vero. `useTeamMembers` lo porta già in
`TeamMember.dbId`; va reso obbligatorio, non opzionale: se `dbId` manca (il ripiego di
`loadTeamMembersFromDb` alle righe 119-127 costruisce un membro senza), l'assegnazione **non parte**
e lo dice, invece di mandare un id inventato.

**C2. `ProjectDetail.tsx:270`** — `|| 1` sparisce. Un assegnatario assente si mostra come «non
assegnato», e il selettore propone i membri veri. Il ripiego `localMv?.as` resta solo per le
modifiche non ancora salvate.

**C3. `PUT /progetti/:id/stato-completo`** — quando il corpo porta l'assegnatario di una micro-voce,
la rotta scrive `risorsaId`. Il campo esiste in tabella dalla prima migrazione e non è mai stato
scritto.

**C4. `GET /progetti/:id`** — aggiungere `risorsa` all'`include`, altrimenti C3 scrive un dato che
la lettura non riporta, e alla ricarica l'assegnazione sembra di nuovo sparita.

**C5. I «compiti assegnati» diventano una vista, non un archivio.** Un compito è una micro-voce con
`risorsaId` valorizzato e `stato != 'done'`. Non serve una tabella dei compiti: serve una query. Il
calendario la mostra come categoria `microvoce`, filtrata per `assegnatoAId` — e per un
`collaboratore_esterno` «il mio calendario» significa **solo** le micro-voci su cui ha
`accesso_risorsa`. La stessa query serve la vista «i miei compiti» e il carico di lavoro, che in
`src/routes/progetti.ts` esiste già e somma ore per `risorsaId` — un altro consumatore che oggi
lavora su un campo sempre `NULL`, e che questa fase accende. *(Chiuso il 18/09/2026: quel calcolo ora
passa da `caricoPerRisorse` in `src/services/compitiAssegnati.ts`, chiamato a `progetti.ts:1199`.)*

#### C1 era incompleto: il seed dimostrativo entrava ancora nel menu

Trovato il 18/09/2026 chiudendo il blocco 4, e **corretto qui**.

La guardia di C1 chiedeva che l'id fosse una **stringa non vuota**. Non basta. `DEFAULT_TEAM_USERS`
in `frontend/src/api/tenant.ts:7` usa `usr-01`…`usr-05`: stringhe non vuote, e non id di database.
Passavano la guardia, ricevevano `dbId: 'usr-01'`, e il menu tornava a offrire cinque persone che
`risorsa_id` avrebbe rifiutato — cioè esattamente il difetto che C1 esiste per chiudere.

Non è un caso di laboratorio, ed è questo che lo rende grave: `fetchUtentiTenant` restituisce
`DEFAULT_TEAM_USERS` per il tenant demo **ogni volta che l'API non risponde**, e lo fa *senza
sollevare eccezioni* — il ripiego è dentro di essa (`tenant.ts:57`). Quindi il ramo di ripiego di
`loadTeamMembersFromDb` non scattava mai, e nel frattempo l'elenco arrivava pieno di id inassegnabili
invece che vuoto. Il caso «API irraggiungibile» era precisamente quello che la guardia doveva
coprire, ed era l'unico che non copriva.

La correzione è una riga: l'id deve avere la forma di un uuid, perché `User.id` è
`String @id @default(uuid())` (`prisma/schema.prisma:164`) e `risorsaId` è una chiave esterna verso
di esso. **Verificato prima di applicarla** che non togliesse dal menu nessuna persona reale: in
produzione `bluman_user` ha 7 righe, 0 fuori forma.

**Verificato per mutazione:** ripristinando la guardia debole (`!u.id`) i test che cadono sono due, e
il messaggio è il difetto stesso — `expected [ { id: 16539, dbId: 'usr-01', …(4) } ] to deeply equal []`.
Il test sta in `frontend/src/hooks/useTeamMembers.test.ts`, che è anche il primo test del frontend su
questo hook: prima non ne esisteva nessuno, ed è il motivo per cui la lacuna è passata.

#### Due difetti trovati eseguendo C1-C4, e non corretti qui

Sono sulla stessa via di `usr-0${operatorId}` e si vedono solo percorrendola fino in fondo. Nessuno
dei due è nel piano, e nessuno dei due è stato toccato: il primo perché è una decisione di merito,
il secondo perché è un cambio di firma in un'interfaccia condivisa, e vale la pena discuterli prima.

1. **`invitatoDaUser` registra l'invitato, non chi invita.** In
   `src/adapters/prisma/prismaApp.ts:342` la creazione di un accesso connette lo stesso `userId` sia
   come titolare dell'accesso sia come `invitatoDaUser`. La conseguenza è che la traccia dice che
   ognuno ha invitato sé stesso: alla domanda «chi ha dato a questa persona l'accesso a questa
   pratica?» il database risponde con il nome della persona che l'ha ricevuto. È una colonna di
   audit che oggi non è utilizzabile, e la correzione richiede di far arrivare `req.userId` fino
   all'adattatore, cioè di cambiare la firma di `assegnaAccessoProgetto` nel port e in entrambi gli
   adattatori.

2. **`RedditivitaTab.tsx:35` ripete `|| 1` e aggiunge una tabella di tariffe cablata.** La riga è
   `const opId = mv.as || (m.team && m.team[0]) || 1;`, seguita da
   `OPERATOR_RATES[opId]?.rate || 95`. Cioè: l'operatore numero 1, con una tariffa di 95 €/h scritta
   nel sorgente del browser, applicata alle ore di ogni micro-voce non assegnata. Il pannello
   «Redditività» somma quindi costi veri su tariffe inventate — e con C3 appena chiuso gli
   assegnatari cominciano a esistere davvero, quindi il numero smetterà di essere sbagliato *solo*
   sulle voci assegnate, rendendo la differenza meno visibile invece che più. Va deciso dove vivono
   le tariffe: se in `bluman_user` (una colonna) o in una tabella dedicata.

### 1ter.7 Cosa non fare

- **Non** un `CalendarioEventoDto` costruito nel frontend a partire da liste già scaricate. È la
  forma attuale (tre `fetch` completi, righe 34-38, poi filtri locali) e non regge: il browser di un
  `collaboratore_esterno` non deve ricevere l'elenco completo dei clienti e delle fatture per
  mostrarne tre righe. Il filtro va a database.
- **Non** un flag `visibileA` sulla riga dell'evento, con l'endpoint che si fida di quello che il
  client chiede. La visibilità si calcola dalla sorgente a ogni lettura (§1ter.3).
- **Non** riusare `Notifica` come archivio del calendario. `Notifica` (`schema.prisma:1225`) è la
  traccia di un messaggio spedito, con `canale`, `statoLettura`, `inviataAt`. Un evento è un
  impegno, non un invio: mescolarli renderebbe impossibile rispondere a «cosa devo fare» senza
  passare per «cosa ti ho mandato».
- **Non** cancellare `bluman_custom_calendar_events` e `bluman_calendar_events` senza prima
  leggerne il contenuto in produzione: sono due archivi locali che dal loro rilascio hanno
  accumulato righe, e se una sola di quelle righe è un impegno vero, cancellarla lo perde. Vanno
  migrati in `evento_calendario` con una lettura una volta sola, e la chiave di lettura è quella
  giusta — cioè quella che la scrittura ha usato, non quella che la lettura cercava.

**Residuo aperto dopo il blocco 5 (18/09/2026).** Il blocco ha tolto i **lettori e gli scrittori**
delle due chiavi, non le chiavi: `ProjectDetail.tsx` non scrive più `bluman_calendar_events`,
`CalendarPage.tsx` non legge più `bluman_custom_calendar_events`, e `CalendarioProgettoTab` non ha
più il suo terzo elenco. Quindi non si perde più niente di nuovo — ma le righe già scritte nei
browser restano dove sono, e **nessuno le ha ancora lette in produzione**. La migrazione una-tantum
descritta qui sopra è ancora da fare, e non è stata fatta adesso perché richiede una lettura dei
dati reali che questo blocco non aveva motivo di toccare. Va detto anche che
`bluman_calendar_events` era **già** un archivio senza lettori prima di questo blocco: il
fascicolo scriveva e nessuno leggeva, quindi quelle righe erano già irraggiungibili dall'app — il
che le rende più facili da perdere, non meno importanti.

### 1ter.8 Ordine dei lavori e criteri di accettazione

L'ordine non è arbitrario: A4 (le regole di derivazione) precede A3 (le rotte) perché le rotte
leggono quelle regole; A1 precede tutto perché è la tabella.

| Passo | Stato | Fatto quando |
|---|---|---|
| A4 | ✅ **fatto** il 17/09/2026 (`2bbf310`) | Il cron e la derivazione usano la stessa funzione, e un test lo dimostra: cambiando la regola in un punto cambia in entrambi. **Verificato per mutazione**: `>` → `>=` in `kycInAvviso` porta il cron da 2 a 3 clienti avvisati, l'inversione del segno di `GIORNI_SOLLECITO_RATA` lo porta da 3 rate a 1. |
| A1 + A2 | ✅ **fatto** il 17/09/2026 — migrazione applicata su Supabase | La migrazione gira su un database vuoto **e** su uno con dati; `\d evento_calendario` mostra le colonne e gli indici; la policy RLS è presente e `bluman_app` non vede righe di un altro tenant. **Verificato**: `prisma migrate diff` dà **deriva zero** su `evento_calendario`; la RLS era già attiva (`relrowsecurity`, `relforcerowsecurity`, 1 policy) e non è stata toccata. Il criterio «gira anche su un database con dati» non è stato provato con righe dentro: la tabella è vuota in produzione, e i default `NOT NULL` sono lì per quello. |
| A5 + A6 | ✅ **fatto** il 17/09/2026 (blocco 3) | La scadenza di una rata viene da `ScadenzaIncasso.dataScadenza`, la fine di un progetto da `Progetto.dataScadenza`: nessun evento porta una data che il database non contiene. **Verificato per mutazione**: facendo leggere alla derivazione `fattura.dataEmissione` invece di `rata.dataScadenza`, il test della rata fallisce con `expected '2026-09-10' to be '2026-09-25'` — cioè l'errore esatto che la pagina commetteva, riprodotto e catturato. |
| A3 | ✅ **fatto** il 17/09/2026 (blocco 3) | Le cinque rotte rispondono; le asserzioni ruolo × categoria passano; `?categorie=fattura` con ruolo `collaboratore_esterno` restituisce `[]`. **Verificato per mutazione**: rendendo pubblico un `promemoria` (`case 'promemoria': return true`), due test falliscono e mostrano la riga di un altro comparire nell'elenco. **Le asserzioni sono 30 e non 25**: le categorie sono sei, non cinque — vedi la sesta categoria qui sotto. |
| B1-B4 | ✅ **fatto** il 18/09/2026 (blocco 5) | La griglia viene da `new Date()` e si naviga; il mese, «oggi» e i giorni di coda sono calcolati da `calendarioDate.ts`, che ha **24 test** scritti per uccidere le costanti (l'intestazione di agosto 2026, il `day === 14`); nessun evento è fabbricato nella pagina — le derivate le calcola il server dalle sue sorgenti; l'archivio è uno solo, `evento_calendario`, e la spunta è una `PATCH` che sopravvive al reload (le due chiavi `localStorage` non hanno più né lettori né scrittori nel calendario). **Verificato per mutazione**: `etichettaMese(2026, 8)` deve dare `'Settembre 2026'`, la griglia deve essere un rettangolo di settimane intere che comincia di lunedì per **ogni** mese dal 2024 al 2028, agosto 2026 deve avere 42 celle e cominciare il `2026-07-27`, `oggi(new Date(2026, 8, 19, 0, 30))` deve dare `'2026-09-19'` (locale, non UTC) e `istanteDaGiornoEOra('2026-09-24','25:99')` deve dare mezzanotte — quest'ultima ha trovato un difetto reale: `/^\d{2}:\d{2}$/` controlla la forma, non l'intervallo, e `25:99` passava. Un secondo difetto reale è stato trovato **scrivendo** lo scadenzario del fascicolo, non dai test: `Progetto.start` è `toLocaleDateString()` e `Progetto.due` è la costante `'30 giorni'`, quindi nessuno dei due è una data; `giornoDi('18/09/2026')` restituisce dieci caratteri e `aggiungiGiorni` ne costruiva un `Invalid Date`, cioè una richiesta con estremi non validi che il server rifiuta parlando di `da`/`a` mentre il campo sbagliato è un altro. Presidia ora `eGiornoIso`, che controlla forma **e** valore; **verificato per mutazione**: togliendo la verifica rotonda cade il test di `2026-13-45`, mentre togliendo il controllo di forma **non cade nessun test** (è la verifica rotonda a portare il peso) — ed è scritto nel commento della funzione, perché la riga che può sparire in silenzio è quella. |
| B5-B6 | ✅ **fatto** il 18/09/2026 (blocco 5) | Il mini-calendario si apre sul mese corrente e naviga; i tre pulsanti rapidi si calcolano da oggi; l'operatore è l'uuid vero (`dbId`) e non più l'hash numerico della UI; la casella «invia email» è stata **tolta** invece che lasciata spenta, perché prometteva un invio che nessun codice faceva. Pianificando dal fascicolo l'evento **compare nel calendario**: `POST /calendario/eventi` con `categoria: 'microvoce'` e `microvoceProgettoId`, e la promessa torna al modale, che aspetta la risposta invece di dichiarare il successo per conto proprio. Tolta anche la **terza** copia (`CalendarioProgettoTab`), che mostrava quattro scadenze di agosto 2026 con i nomi di quattro persone — le stesse per ogni progetto di ogni studio — e confermava con un `alert` un salvataggio che finiva in un `useState`. **Rotta estesa**: `GET /calendario/eventi?progettoId=` filtra per progetto su **tutte e cinque** le sorgenti, perché le righe trovano il progetto per tre strade (`progettoId`, `moduloProgetto.progettoId`, `microvoceProgetto.moduloProgetto.progettoId`) e un filtro sulla sola colonna diretta avrebbe mostrato una scheda vuota proprio per le attività pianificate dal fascicolo. **Verificato per mutazione, cinque volte**: rimuovendo l'`OR` delle righe cadono 4 test, e togliendo uno per uno i filtri di rata, fine progetto, contratto e KYC cade il test corrispondente. Le asserzioni del calendario passano da 40 a 50. |
| C1-C4 | ✅ **fatto** il 17/09/2026 (blocco 4), **esteso il 18/09** | L'assegnazione scrive `risorsa_id` con lo `userId` vero, e riaprendo il fascicolo l'assegnazione è ancora lì — `GET /progetti/:id` include `risorsa`. **Verificato per mutazione**, tre volte: (1) disattivando il controllo dello studio (`const valida = true`) falliscono i tre test che provano a scrivere l'utente di un altro tenant, del super_admin e di un id inesistente; (2) trattando il campo `risorsaId` **assente** come un valore da esaminare (`if (true)`) fallisce il test del campo assente, con `expected [ Array(1) ] to deeply equal []` — cioè l'avviso di errore falso che quella modifica produce su un salvataggio riuscito; (3) ripristinando la guardia debole dell'id (`!u.id`), falliscono i due test del seed dimostrativo con `expected [ { id: 16539, dbId: 'usr-01', …(4) } ] to deeply equal []`. Il punto (3) è una **correzione a C1 stesso**, che era incompleto: vedi «C1 era incompleto» qui sopra. Il frontend passa da 44 a 50 test. |
| C5 | ✅ **fatto** il 18/09/2026 (blocco 7) | I compiti assegnati diventano una vista calcolata (`src/services/compitiAssegnati.ts`, `compitiDiUtente` e `caricoPerRisorse`) da PostgreSQL. `GET /calendario/compiti` restituisce i compiti dell'utente in sessione con isolamento tenant; il carico di lavoro in `progetti.ts` legge la stessa funzione; frontend con vista collassabile «📋 I miei compiti» in `CalendarPage.tsx`. Verificato con 19 test `compitiAssegnati.test.ts`, 9 test `operatoriSuggeriti.test.ts`, 56 test `calendario.test.ts`. |

**Le due deviazioni da A1, e perché.** Il piano prevedeva `assegnatoAId String` **obbligatorio** e
l'enum `stato` con i valori `da-fare`/`fatto`/`annullato`. Entrambe sono state cambiate, e nessuna
delle due è un dettaglio:

1. **`assegnato_a_id` è nullable.** «Nessuno se l'è preso» è uno stato legittimo — un compito appena
   creato non ha ancora un assegnatario — ed è uno stato che serve poter distinguere. Un campo
   obbligatorio avrebbe costretto a inventare un assegnatario per ogni riga, che è la stessa classe
   di bugia che questo piano esiste per togliere. Effetto collaterale voluto: `ON DELETE SET NULL`
   su `user`, quindi cancellare un collaboratore lascia i suoi compiti in giro **visibili e senza
   assegnatario** invece di farli sparire.
2. **`da_fare`, non `da-fare`.** Prisma non ammette il trattino in un valore di enum (`P1012`), e la
   convenzione del progetto è già `snake_case` (`in_attesa`, `attesa_dipendenza`,
   `in_progress`). Per non avere due grafie della stessa cosa a un trattino di distanza, è stato
   allineato anche `StatoScadenza` in `scadenzeDerivate.ts`, che era nato con il trattino. Restano
   due vocabolari distinti e lo sono di proposito: lo stato di un evento è `da_fare`/`fatto`/
   `annullato`, lo stato di una **scadenza** è `da_fare`/`scaduta`/`fatta` — «scaduta» non è uno
   stato dell'evento, è `da_fare` con una data passata.


**La prova che chiude tutta la fase, in una riga:** creare un progetto con una scadenza al 3 del
mese prossimo, una rata a 30 giorni, un cliente con KYC vecchio di un anno, assegnare una micro-voce
a un collaboratore esterno — poi aprire il calendario con il token di quel collaboratore. Deve
vedere il **suo** compito alla data vera, e **non** deve vedere né la rata, né il rinnovo KYC, né
il nome dell'altro cliente.

---

## 2. FASE 0 — Sicurezza Critica

> **Obiettivo**: Chiudere tutte le vulnerabilità di sicurezza note.
> **Tempo stimato**: 2-3 giorni
> **Impatto**: NESSUNA modifica funzionale, solo hardening.

### 0.1 🔴 CORS: whitelist delle origini — ✅ RISOLTO (2026-08-26)

**Risoluzione**: whitelist implementata in `src/server.ts` (~righe 269-301): le origini ammesse arrivano da variabili d'ambiente (`ALLOWED_ORIGINS`/frontend URL), con fail-fast in produzione se la whitelist manca o contiene `*` — l'avvio si blocca invece di riflettere qualunque origine.

**Problema**: `origin: true` riflette qualunque origine del richiedente. Combinato con `credentials: true`, un sito malevolo può fare richieste autenticate all'API BluMan usando i cookie/token del browser della vittima.

**File**: `src/server.ts` riga ~247

**Soluzione**:
```typescript
const ORIGINI_CONSENTITE = [
  'http://localhost:5173',           // dev frontend
  'http://127.0.0.1:5173',          // dev frontend
  'https://bluman.vercel.app',       // produzione frontend
  // Aggiungere qui eventuali altri domini autorizzati
];

server.register(cors, {
  origin: (origin, callback) => {
    // Consenti richieste senza Origin (curl, server-to-server, app mobile)
    if (!origin) return callback(null, true);
    if (ORIGINI_CONSENTITE.includes(origin)) return callback(null, true);
    callback(new Error('Origine non consentita'), false);
  },
  methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'x-tenant-id', 'Accept'],
  credentials: true,
  strictPreflight: true,
});
```

**Nota**: In produzione, le origini dovrebbero venire da variabile d'ambiente `CORS_ORIGINS` (separata da virgole), non hardcoded.

**Verifica**:
```bash
# Deve restituire errore CORS
curl -H "Origin: https://evil.com" http://localhost:3000/health -v
# Deve funzionare
curl -H "Origin: http://localhost:5173" http://localhost:3000/health -v
```

---

### 0.2 🔴 Rimuovere fallback InMemoryApp in produzione — ✅ RISOLTO (2026-08-26)

**Risoluzione**: fail-fast in `src/index.ts` (§3.2): in produzione, senza PostgreSQL raggiungibile, il processo fa `process.exit(1)`; il fallback `InMemoryApp` resta attivo solo in sviluppo.

**Problema**: Se il DB non risponde, il server parte con `InMemoryApp`. In produzione questo significa: dati non persistenti, nessun isolamento tenant, comportamento imprevedibile. L'utente non sa che i suoi dati non vengono salvati.

**File**: `src/index.ts`

**Soluzione**:
```typescript
async function start() {
  console.log('🚀 Avvio del processo BluMan API...');

  const isProduction = process.env.NODE_ENV === 'production';

  let app: any;
  try {
    console.log('🔌 Connessione a PostgreSQL / Prisma in corso...');
    await prisma.$connect();
    // Verifica che il DB risponda davvero
    await prisma.$queryRaw`SELECT 1`;
    console.log('✅ Connessesso a PostgreSQL con successo.');
    app = new PrismaApp(prisma, TENANT_ID);
  } catch (e)
    if (isProduction) {
      // In produzione: fail-fast, non partire con dati finti
      console.error('❌ FATALE: impossibile connettersi a PostgreSQL in produzione.');
      console.error('   Il server non può avvi senza database. Controlla DATABASE_URL.');
      process.exit(1);
    }
    // Solo in sviluppo: fallback InMemory
    console.warn('⚠️ Impossibile connettersi a PostgreSQL, uso InMemoryApp fallback (solo dev):', e);
    app = new InMemoryApp();
  }

  // ... resto invariato
}
```

**Verifica**: Avviare il server senza DB in `NODE_ENV=production` → deve uscire con codice 1.

---

### 0.3 🔴 Frontend: eliminareare fallback silenziosi sulle scritture — ✅ RISOLTO (2026-08-26)

**Risoluzione**: verificato `frontend/src/api/client.ts`: le scritture non restituiscono più `{ ok: true }` con dati finti quando il backend non risponde; gli errori reali vengono propagati al chiamante (nessun catch silenzioso residuo).

**Problema**: Diverse funzioni in `frontend/src/api/client.ts`, se il backend non risponde, restituiscono `{ ok: true }` con dati finti. L'utente crede che l'azione sia stata salvata, ma non è così.

 è esattamente il meccanismoanicmo che ha causato il bug documentato "il cliente non vede i moduli inseriti dall'operatore".

**Funzioni da correg** (tutte in `frontend/src/api/client.ts`):

| Fun | Comportamento attuale | Correzione |
|------|---------------------|------------|
| `uploadFileApi` | `catch → { ok: true, url: ... }` | Propagare l'errore, mostrare messaggio UI |
| `creaGiurisdizioneApi` | `catch → { id: 'giur-...' }` | Propagare l'errore |
| `updateArticoloPrezzoApi` | `catch → { ok: true, ...input }` | Propagare l'errore |
| `fetchProgetti` | `catch → null` | Accettabile per letture, ma mostrare stato "offline" nella UI |
| `fetchProgettoDettaglio` | `catch → null` | Come sopra |
| `fetchModuliLibreria` | `catch → null` | Come sopra |
| `fetchClienti` | `catch → null` | Come sopra |

**Regola**: Le **scritture** (POST, PUT, PATCH, DELETE) non devono MAI avere fallback silenziosi. Le **letture** possono mostrare uno stato "offline" ma devono comunque segnalare il problema.

**Esempio di correzione per `uploadFileApi`**:
```typescript
export async function uploadFileApi(filename: string, contentBase64: string) {
  const res = await apiFetch(`${API_BASE}/upload`, {
    method: 'POST',
    headers: getAuthHeaders(),
    body: JSON.stringify({ filename, contentBase64 }),
  });
  if (!res.ok) {
    const data = await res.json().catch(() => null);
    throw new Error(data?.errore || 'Errore upload file: server non disponibile');
  }
  return await res.json();
}
```

**Verifica**: Disattivare il backend, provare a caricare un file → deve comparire un errore esplicito, non un finto successo.

---

### 0.4 🔴 TLS: riattivare verifica certificati — ✅ RISOLTO (2026-08-26)

**Risoluzione**: `tlsRejectUnauthorized()` in `src/services/imapFetcher.ts:30` e `src/services/emailRelay.ts:197` impone `rejectUnauthorized: true` di default; la disattivazione è possibile solo in sviluppo tramite variabile d'ambiente esplicita.

**Problema**: `rejectUnauthorized: false` in `emailService.ts` disattiva la verifica del certificato TLS. Un attaccante in posizione di rete intermedia può intercettare le credenziali SMTP.

**File**: `src/services/emailService.ts` (righe ~38, ~92, ~166)

**Soluzione**:
```typescript
// RIMUOVERE da tutti i transporter:
// tls: { rejectUnauthorized: false }

// SOSTITUIRE CON:
tls: {
  rejectUnauthorized: true,  // Verifica certificato
  minVersion: 'TLSv1.2',    // Minimo TLS 1.2
}
```

**Eccezione**: Se il provider SMTP (es. Register.it) usa un certificato self-signed, configurare il CA specifico:
```typescript
tls: {
  rejectUnauthorized: true,
  ca: fs.readFileSync('/path/to/register-it-ca.pem'),
}
```

**Per IMAP** (`verifyRealImap`): stessa correzione sul socket TLS.

**Verifica**: Test SMTP con `npm run dev` → deve connettersi correttamente con verifica TLS attiva.

---

### 0.5 🟠 JWT: confronto firma constant-time — ✅ RISOLTO (2026-08-26)

**Risoluzione**: `src/util/jwt.ts` usa `crypto.timingSafeEqual` per il confronto della firma (righe 129 e 165), eliminando il confronto stringa vulnerabile a timing attack.

**Problema**: `verifyJwt` usa `signature !== expectedSignature` (confronto stringa). Questo è teoricamente vulnerabile a timing attack, anche se il rischio è basso per HMAC-SHA256.

**File**: `src/util/jwt.ts` riga ~73

**Soluzione**:
```typescript
export function verifyJwt(token: string): JwtPayload | null {
  try {
    const parts = token.split('.');
    if (parts.length !== 3) return null;

    const [base64Header, base64Payload, signature] = parts;
    if (!base64Header || !base64Payload || !signature) return null;

    const expectedSignature = crypto
      .createHmac('sha256', JWT_SECRET)
      .update(`${base64Header}.${base64Payload}`)
      .digest('base64url');

    // Confronto a tempo costante
    const sigBuf = Buffer.from(signature, 'utf8');
    const expBuf = Buffer.from(expectedSignature, 'utf8');
    if (sigBuf.length !== expBuf.length) return null;
    if (!crypto.timingSafeEqual(sigBuf, expBuf)) return null;

    const payload: JwtPayload = JSON.parse(
      Buffer.from(base64Payload, 'base64url').toString('utf8')
    );
    if (payload.exp && Math.floor(Date.now() / 1000) > payload.exp) {
      return null;
    }

    return payload;
  } catch {
    return null;
  }
}
```

---

### 0.6 🟠 Audit log: tenant esplicito — ✅ RISOLTO (2026-08-26)

**Risoluzione**: `recordAudit` ora ha `tenantId` obbligatorio (non optional), scrive con `prismaAmministrativo()` (operazione di sistema, non soggetta a RLS), non usa più `setImmediate` (tutti i ~44 chiamanti fanno `await`) e logga gli errori con `console.error('[AUDIT] ...')` invece di ingoiarli. I due audit del login passano `userTenantId || TENANT_DEFAULT` perché per il super_admin `utente.tenantId` è null.

**Problema**: `recordAudit` in `server.ts` usa `prisma.auditLog.create` dentro `setImmediate`. A quel punto l'`AsyncLocalStorage` potrebbe non avere più il contesto tenant, quindi l'audit finisce sul tenant di default o fallisce silenziosamente (c è un `catch {}`).

**File**: `src/server.ts` funzione `recordAudit`

**Soluzione**: Passare il tenant esplicitamente e usare il client amministrativo per l'audit (l'audit è un'operazione di sistema, non soggetta a RLS del tenant corrente):
```typescript
async function recordAudit(params: {
  tenantId: string;  // OBBLIGATORIO, non optional
  userId?: string;
  userEmail?: string;
  userNome?: string;
  ruolo?: string;
  azione: string;
  entita: string;
  dettagli: string;
  ipAddress?: string | null;
}) {
  // Non usare setImmediate: se il processo muore, l'audit è perso.
  // Meglio await diretto o una coda con retry.
  try {
    await prismaAmministrativo().auditLog.create({
      data: {
        tenantId: params.tenantId,
        userId: params.userId ?? 'usr-system',
        userEmailEmail: params.userEmail ?? 'system@bluecode.advisory',
        userNome: params.userNome ?? 'Sistema / Operatore',
        ruolo: params.ruolo ?? 'operator',
        azione: params.azione,
        entita: params.entita,
        dettagli: params.dettagli,
        ipAddress: params.ipAddress ?? null,
      },
    });
  } catch (err) {
    // L'audit non deve bloccare l'operazione, ma il fallimento VA loggato
    console.error('[AUDIT] Impossile registrare audit log:', err);
  }
}
```

**Nota**: Ogni chim a `recordAudit` deve già il `tenantId` dal payload JWT. Verificare che nessuna chimata lo passi senza.

---

### 0.7 🟠 Ripulire file sensibili dal repo — ✅ RISOLTO (2026-08-26)

**Risoluzione**: verificato con `git ls-files`: nessun PDF né file con dati reali è tracciato; l'unico file di configurazione tracciato è `.env.example` (solo segnaposto).

**Problema**: Nel repo ci sono file che contengono dati realieli:
- `BluMan_Fattura_FT-2026-001.pdf`
 `BluMan_Fattura_FT-2026-002.pdf`
- `Engagement_Leter_Mario_Dibenedetto.pdf`
- `BLUECODE-Logo-orizzontale-2-1.jpeg` (logo, meno critico)

**Soluzione**:
1. Spostare i PDF in una cartella non tracciata (es. `docs/privati/`)
 aggiungerla al `.gitignore`
2. Verficare con `git ls-filesles` che non siano già stati committati
3. Se sono nel history di git: valutare `git filter-branch` o BFG per rimuoverli

```bash
# .gitignore - aggiungerere:
*.pdf
docs/privati/
```

---

## 3. FASE 1 — Affidabilità e Corretteza

> **Obietivo**: Eliminare i comportmenti che posono portare a dati corrotti o inconsistenti.
> **Tempo stimato**: 3-4 giorni
> **Impatto**: Nessuna modfica funziomle est, solo robbstezza.

### 1.1 🟠 `elimProgetto`: transazione atomica — ✅ RISOLTO (2026-08-26)

**Risoluzione**: la logica transazionale FK-safe esisteva già nell'adapter (`PrismaApp.eliminaProgetto`) ma era orfana: nessuna rotta HTTP la esponeva, quindi il frontend (`eliminaProgettoApi` in ProjectDetail) riceveva 404. Aggiunta la rotta `DELETE /progetti/:id` in `src/server.ts` con: guard di ruolo (solo `super_admin`/`advisor`, come `/progetti/:id/ricalcola`), audit `PROGETTO_ELIMINATO`, errori tradotti dal gestore centrale (progetto inesistente → 404, fatture presenti → 409). L'adapter ora riceve il tenant della richiesta JWT (prima usava solo quello fisso del costruttore) e `ProgettoNonTrovatoError` non viene più mascherato da errore di record collegati. Coperta da 4 test in `src/server.test.ts` (suite a 273 test verdi).

**Problema**: La cancellazione di un progetto avviene con una serie di `deleteMany`/ `delete` in sequenza. Se uno fallisce a metà, restano dati orfni.

**File**: `src/adapters/prisma/prismaApp.ts` metodo `elimProgetto`

**Soluz**: Avvolgereere tutto in una transione interattiva:
```typescript
async eliminaProgetto(id: string): Promise<void> {
  const fatture = await this.prisma.fattura.count({
    where: { progettoId: id, tenantId: this.tenantId },
  });
  if (fatture > 0) {
    throw new TransizioneNonValidaError(
      `Impossibile eliminare il progetto: contiene ${fatture} fatture/NC. Archivialo.`
    );
  }

  await this.prisma.$transaction(async (tx) => {
    // Imposta contesto tenant nella transazione
    await conContestoInTransazione(tx, async () => {
      const moduli = await tx.moduloProgetto.findMany({ where: { progettoId: id } });
      for (const m of moduli) {
        await tx.moduloProgettoDipendenza.deleteMany({ where: { dipendeDaModuloProgettoId: m.id } });
        await tx.moduloProgettoDipendenza.deleteMany({ where: { moduloProgettoId: m.id } });
        await tx.passaggioProgetto.deleteMany({ where: { microvoceProgetto: { moduloProgettoId: m.id } } });
        await tx.microvoceProgetto.deleteMany({ where: { moduloProgettoId: m.id } });
      }
      await tx.moduloProgetto.deleteMany({ where: { progettoId: id } });
      await tx.preventivo.deleteMany({ where: { progettoId: id } });
      await tx.eventoCalendario.deleteMany({ where: { progettoId: id } });
      await tx.accessoRisorsa.deleteMany({ where: { progettoId: id } });
      await tx.comunicazioneProgetto.deleteMany({ where: { progettoId: id } });
      await tx.progetto.delete({ where: { id, tenantId: this.tenantId } });
    });
  });
}
```

**Alternativa migliore (lungo termine)**: Aggiungere `onDelete: Cascade` alle relazioni in `prisma/schema.prisma` dove appropriato, così il DB gestisce la cascata automaticamente.

---

### 1.2 🟠 Cron service: rimuovere fallback mock — ✅ RISOLTO (2026-08-26)

**Risoluzione**: `src/services/cronService.ts` ora crea le notifiche reali sul database (nessun cliente fittizio nei catch), con deduplicazione giornaliera (`giaNotificataOggi`): il report del cron riflette solo la realtà.

**Problema**: `cronService.ts` ha un `catch` che, se la query al DB fallisce, inventa un cliente fittizio e lo conta come "notifica inviata". Il report del cron deve riflettere solo la realtà.

**File**: `src/services/cronService.ts` righe ~35-44

**Soluzione**:
```typescript
// RIMUOVERE il blocco catch con i dati mock:
// catch {
//   clienti = [{ id: 'c-1', nome: 'Holding Beta S.r.l.', ... }];
// }

// SOSTITUIRE CON:
try {
  clienti = await prisma.cliente.findMany({ where: tenantFilter });
} catch (err) {
  console.error('[CRON] Errore lettura clienti:', err);
  report.dettagli.push('[ERRORE] Impossibile leggere i clienti dal database');
  return report;  // Interrompe il cron, non inventa dati
}
```

---

### 1.3 🟠 Health check con verifica DB — ✅ RISOLTO (2026-08-26)

**Risoluzione**: `GET /health` in `src/server.ts` esegue un ping reale del database (`SELECT 1` con timeout corto); se il DB è irraggiungibile risponde 503 con `{ stato: 'degradato' }`, così Railway riavvia l'istanza invece di servire errori.

**Problema**: `GET /health` restituisce `{ stato: 'ok' }` senza verificare che il DB sia raggiungibile. Railway può continuare a mandare traffico a un'istanza il cui DB è giù.

**File**: `src/server.ts`

**Soluzione**:
```typescript
server.get('/health', async (_req, reply) => {
  try {
    await prismaAmministrativo().$queryRaw`SELECT 1`;
    return { stato: 'ok', database: 'connesso', timestamp: new Date().toISOString() };
  } catch {
    reply.code(503);
    return { stato: 'degradato', database: 'non raggiungibile', timestamp: new Date().toISOString() };
  }
});
```

**Nota**: Usare `prismaAmministrativo()` perché l'health check non ha un tenant corrente.

---

### 1.4 🟡 Frontend: rimuovere `mockData` da App.tsx — ✅ RISOLTO (2026-08-26)

**Risoluzione**: `frontend/src/store/mockData.ts` è stato rimosso (la cartella `store/` non esiste più); App.tsx usa solo dati provenienti dalle API. Aggiornato anche `.agents/AGENTS.md` (Regola 7).

**Problema**: `App.tsx` importa `PROJECTS` da `store/mockData.ts` per il conteggio alert. Dat finti mescolati a a dati reali.

**File**: `frontend/src/App.tsx` riga ~24, ~50

**Soluzione**: Il conteggio alert deve venire dai dati reali dell'API (progetti con `segngnaleRischio` o stato `delayed`/`blocked`).

---

### 1.5 🔴 Upload documenti microvoce: 413 ingoiato e documento fantasma — ✅ RISOLTO (2026-08-28)

**Problema** (segnalazione del titolare): nel modale della microvoce l'anteprima mostrava «Nessun file fisico collegato o documento generato localmente» e dal portale cliente il file selezionato dall'operatore non risultava mai caricato.

**Causa**: catena di tre guasti, non uno solo.
1. Fastify aveva il `bodyLimit` di default (1 MiB): gli upload viaggiano come JSON con il file in base64, quindi ogni allegato >~750 KB produceva un corpo >1 MiB e veniva respinto con **413 prima ancora di raggiungere la rotta** (`FST_ERR_CTP_BODY_TOO_LARGE`). Il limite vale per tutti i parser, incluso quello JSON personalizzato con `parseAs: 'string'`.
2. In `PassaggioModal.tsx`, `eseguiSalvataggioConfigurato` ingoiava l'errore in un `catch` silenzioso (`console.warn`), creava comunque la voce documento in stato locale con `fileUrl: undefined`, e mostrava l'alert «✓ collegato con successo» — un falso successo. La riga a DB non veniva mai creata, quindi il portale cliente restava vuoto.
3. L'upload su Supabase Storage dichiarava `Content-Type: application/pdf` per ogni file: i .docx e le scansioni .jpg venivano serviti col MIME sbagliato e l'anteprima iframe non riusciva ad aprirli.

Non erano bug: il default `statoDoc: 'bozza'` rende il documento invisibile al portale finché l'operatore non preme «Pubblica al Cliente» (by design).

**Risoluzione**:
- `src/server.ts`: `bodyLimit: 45 * 1024 * 1024` sull'istanza Fastify. Il vero tetto ai file resta lo scanner di sicurezza (§28: max 30 MB); 45 MiB copre i ~40 MB di corpo base64 di un file da 30 MB più l'involucro JSON.
- `src/services/storageService.ts`: nuova funzione `mimeDaEstensione()` — il Content-Type dichiarato a Supabase Storage segue l'estensione reale; i tipi non riconosciuti ricadono su `application/octet-stream`. Inoltre `nomeFileSicuro()` ora collassa le sequenze di punti: un nome d'origine come `../../etc/passwd` diventava `.._.._etc_passwd` — caratteri ammessi ma contenente `..`, che `nomeFileValido` rifiuta in lettura, lasciando il file scritto ma irrecuperabile. La divergenza è stata scoperta dai nuovi test `src/services/storageService.test.ts` (che verificano l'invariante scrittura→lettura).
- `frontend/src/components/PassaggioModal.tsx`: `eseguiSalvataggioConfigurato` ora ha i guard `!effProgettoId` e `!tmpl && !fileBase64` (alert + return), e il `catch` mostra il messaggio reale del backend e si ferma — nessun documento fantasma, nessun alert di falso successo; la finestra di configurazione resta aperta per il retry. `handleFileUploadPassaggio` e `handleFileNuovaVersione` rifiutano subito i file >30 MB prima di codificarli.

**Verifica**: `npx tsc -b` frontend EXIT 0; `npx vitest run` 360/360 (27 file).

**Nota per l'operazione**: su Railway devono essere impostate `SUPABASE_URL` e `SUPABASE_SERVICE_KEY`, altrimenti i file finiscono sul disco effimero del container e si perdono a ogni redeploy. I documenti già salvati come bozza restano invisibili al portale finché non vengono pubblicati (comportamento corretto).

---

## 4. FASE 2 — Refactoring Archititettrale

> **Obiettivo**: Rendere il codice manutengile e testabile.
> **Tempo stimato**: 1-2 setimane
> **Impatto**: Nessuna modifca funzionale. Il comportmento est deve restare identico.

### 2.1 ✅ Spezz `server.ts` in moduli di route — COMPLETATO (27/08/2026)

**Problema**: 4.300+ r in un singlo file. Ogni modfica è a rischio di trovare, testare, revieware.

**Risoluzione**: fatto il 27/08/2026 in 9 commit bisectabili ("Split monoliti 1/9…9/9"). `src/server.ts` è passato da ~4.570 a 513 righe: tiene middleware, hook `onRequest`, `/stream` SSE, health/refresh, error handler centrale e chiusura del wrapper `server.register`. Le rotte vivono in 11 moduli `src/routes/*.ts` (auth, tenant, catalogo, clienti, progetti, contabilita, documenti, portale, firma, notifiche, webhooks), registrate con `await registraRotte*(server[, app])` SEMPRE dentro il wrapper — hook auth e rate-limit si applicano esattamente come prima. Gli helper condivisi sono in `src/util/serverHelpers.ts`. Split puramente meccanico: zero cambi di comportamento, nessun rename; a ogni passo vitest (352/352), `tsc --noEmit` root e `tsc -b` frontend verdi. Nota: hook/limiter/error handler sono rimasti nel guscio invece che in `src/plugins/` per non spostare la chiusura del contesto di incapsulamento — la struttura proposta qui sotto è indicativa, quella reale è questa.

**Struttura proposta**:
```
src/
├── server.ts              → buildServer() registra, registra plugin
├── routes/
│   ├── index.ts           → registra tutte le route
│   ├── auth.ts            → /auth/* (login, magic, me,│   ├── clienti.ts         → /clientien/*
│   ├── progetti.ts        → /proget/*
│   ├── moduli.ts           → /moduli/*, /articoli/*
│   ├── fatture.ts         → /fatture/*
│   ├── tenant.ts          → /tenant/*
│   ├── admin.ts           → /admin/*
│   ├── portal.ts          → /portal/*
│   ├── upload.ts          → /upload, /uploads/*
│   ├── webhooks.ts        → /webhooks/*
│   ├── comunicazioni.ts   → /comunicazioni/*
│   └── cron.ts            → /cron/*
├── plugins/
│   ├── authGuard.ts       → hook onRequest + ROTTE_PUBBLICHE
│   ├── rateLimiter.ts     → rate limiting
│   └── errorHandler.ts    → setErrorHandler
```

**Approccio**:
1. Creare `src/routes/` e `src/plugins/`
2. Estrarre un gruppo di route alla volta
3. Dopo ogni estrazione: `npm test` deve passare
4. `server.ts` finale: ~100 righe che registrano i plugin

**Esempio `src/plugins/authGuard.ts`**:
```typescript
import { type FastifyInstance } from 'fastify';
import { verifyJwt, signJwt } from '../util/jwt.js';
import { attivaContestoTenant } from '../util/prismaClient.js';

export const ROTTE_PUBBLICHE = new Set<string>([
  'GET /health',
  'POST /auth/login',
  // ...
]);

export async function authGuardPlugin(server: FastifyInstance) {
  server.addHook('onRequest', async (req, reply) => {
    // ... logica esistente estratta da server.ts
  });
}
```

---

### 2.1b ✅ Split frontend: `ClientPortal.tsx` — COMPLETATO (28/08/2026)

**Problema**: `frontend/src/pages/ClientPortal.tsx` era il monolite più grande del frontend (4.668 righe): login, 7 tab, 6 modali e tutto lo stato del portale cliente in un solo file.

**Risoluzione**: fatto il 28/08/2026 (commit `6aee803`). `ClientPortal.tsx` è passato da 4.668 a 1.890 righe: mantiene **tutto lo stato** (useState), gli handler async e gli useEffect; il JSX è migrato in 18 componenti presentazionali in `frontend/src/components/portal/`:

```
components/portal/
├── types.ts               → tipi condivisi del portale (NotificaPortale, ModuloProposta, PortalTab, BersaglioFirma…)
├── mapPortalModules.ts    → mapProjectToPortalModules
├── format.ts              → dataOraLeggibile
├── styles.ts              → stili condivisi (portalWrapper, topNav, heroBanner, tabsBar, docBox…)
├── PortalLogin.tsx        → schermata di accesso (credenziali + magic link)
├── TabProposta.tsx        → tab proposta/incarico + addendum
├── TabAvanzamento.tsx     → tab avanzamento moduli
├── TabForm.tsx            → tab form proposta dati
├── TabDocumenti.tsx       → tab vault documenti + firma
├── TabFatture.tsx         → tab fatture
├── TabContatti.tsx        → tab contatti studio
├── TabProfilo.tsx         → tab profilo + cambio password
├── FirmaOtpModal.tsx      → modale OTP della firma SES
├── DocumentViewerModal.tsx→ viewer A4 pre-firma
├── ModificaDocModal.tsx   → richiesta modifiche documento
├── SuccessSealModal.tsx   → attestazione/ricevuta di firma
├── InvioManualeModal.tsx  → conferma invio firma a penna/qualificata esterna
└── DettaglioModuloModal.tsx→ dettaglio attività modulo + firma conclusione
```

Split puramente presentazionale: nessun cambio di comportamento, `App.tsx` invariato (`<Route path="/portal" element={<ClientPortal />} />`), `npx tsc -b` verde. Restano da spezzare gli altri monoliti frontend (§2.1c).

### 2.1c ✅ Split frontend: gli altri monoliti — COMPLETATO

**Problema**: restano file frontend sopra le ~1.300 righe: `ProjectDetail.tsx` (3.377), `Library.tsx` (2.879), `api/client.ts` (2.792), `SettingsPage.tsx` (1.905), `PassaggioModal.tsx` (1.801), `DocumentEditorPage.tsx` (1.552), `ClientsPage.tsx` (1.384).

**Approccio**: stesso metodo di §2.1b — estrazione presentazionale (stato e logica restano nel padre), un file alla volta, `npx tsc -b` dopo ogni estrazione. `api/client.ts` è un caso a parte: non è JSX ma un catalogo di funzioni API, si spezza per dominio (clienti, progetti, documenti, portale, firma…) mantenendo la barrel export per non rompere gli import esistenti.

**Progresso**:
- ✅ `ProjectDetail.tsx` (28/08/2026, commit `8a19b6f`): da 3.377 a 883 righe. La pagina mantiene stato, handler ed effetti; estratti 10 componenti in `frontend/src/components/projectDetail/` (`HeaderProgetto`, `ModuliTab`, `DocumentiTab`, `CalendarioProgettoTab`, `RedditivitaTab`, `StoricoContrattiTab`, `RichiesteAddendumTab`, `GrafoModuliProgettoView`, `ModalAccessiProgetto` + `documentiUtils.ts`). `FatturazioneTab` e `ModuloBlock` erano già stati estratti in `15a630d`. `npx tsc -b` verde.
- ✅ `Library.tsx` (28/08/2026, commit `dbc8358`): da 2.879 a 449 righe. I 6 componenti già autonomi nel monolite traslocati in `frontend/src/components/library/` (`AssegnaModuloClienteModal`, `ArticoliCatalogView`, `GiurisdizioniView`, `LibreriaDocumentiEForm`, `NuovoArticoloModal`, `CreaModuloForm`); corpi byte-identici, nessun import circolare, `tsc -b` verde. `LibreriaDocumentiEForm` (730 righe) resta candidato a un futuro frazionamento.
- ✅ `api/client.ts` (28/08/2026, commit `f50cc8f`): da 2.792 righe a 13 file dominio + `http.ts` (helper condivisi) in `frontend/src/api/` — `auth`, `clienti`, `progetti`, `documenti`, `libreria`, `fatturazione`, `portale`, `firma`, `tenant`, `notifiche`, `report`, `timesheet`. `client.ts` diventa barrel (14 righe): tutti i 151 export originali conservati, zero import da aggiornare nel resto del codebase. Corpi byte-identici (verifica multiset), `tsc -b` verde.
- ✅ `SettingsPage.tsx` (28/08/2026, commit `eaeae7d`): da 1.905 a 661 righe. La pagina mantiene stato (72 useState), effetti, handler e tab bar; estratti 10 componenti presentazionali in `frontend/src/components/settings/` (`TabCompany`, `TabInvoiceDesign`, `InvoicePreviewModal`, `TabChannels`, `TabUsers`, `TabSdi`, `TabManutenzione`, `OperatorDetailModal` traslocato 1:1, `InviteUserModal`, `ResetPasswordModal`). Corpi byte-identici, `tsc -b` verde.
- ✅ `ClientsPage.tsx` (28/08/2026, commit `1d291b1`): da 1.384 a 377 righe. I tre modali già autonomi traslocati 1:1 in `frontend/src/components/clients/` (`AnagraficaErpModal` 643 con helper `tabBtn`, `MagicLinkExplainModal` 122, `CredentialsExplainModal` 255); corpi byte-identici (multiset 1273=1273), `tsc -b` verde. `AnagraficaErpModal` candidato a futuro frazionamento.
- ✅ `PassaggioModal.tsx` (28/08/2026, commit `fa29925`): da 1.801 a 730 righe. Il container mantiene stato (16 useState), tutti gli handler (incluso `eseguiSalvataggioConfigurato`, zona bug #21 lasciata intatta come da piano) e la modale anteprima documento; estratti 5 componenti presentazionali in `frontend/src/components/passaggio/` (`TabPassaggi` 248, `TabNote` 55, `TabDocumenti` 453, `ModaleCatalogo` 79, `ModaleConfigFirma` 239) più moduli di supporto (`catalogoModelliStudio.ts` con `getSmartDocumentRecommendation`, `passaggioUtils.ts` con `etichettaTipoFirma`/`getDefaultPassaggi`/`TYPE_LABEL`/`TYPE_COLOR`, `types.ts` con `NoteEntry`/`DocumentoEntry`/`ConfigFirmaModalState`, `passaggioStyles.ts`). Corpi byte-identici (verifica multiset: perse solo le 12 righe strutturali attese), `tsc -b` verde.
- ✅ `DocumentEditorPage.tsx` (28/08/2026, commit `124623e`): da 1.552 a 906 righe. La pagina mantiene stato (22 useState), effetti, handler (creazione/import/export/salvataggio template, export PDF/Word) e re-export; estratti 6 componenti presentazionali in `frontend/src/components/editor/` (`HeaderEditor` 146, `SelettoreDestinazione` 121, `PannelloTag` 115, `LibreriaTemplate` 243, `EditorCanvas` 107, `ModaleNuovoTemplate` 130) più `editorStyles.ts` con le costanti di stile condivise. Corpi byte-identici (verifica multiset: perse solo le 2 costanti diventate export), `tsc -b` verde. **Lista monoliti §2.1c completata.**

**Coda futura (non bloccante)**: `tenant.ts` (567), `LibreriaDocumentiEForm.tsx` (730), `AnagraficaErpModal.tsx` (643) restano candidati a frazionamento se cresceranno ancora.

---

### 2.2 🔴 Validazione input con Zod

**Problema**: La validazione degli input è manuale e sparsa. Ogni endpoint fa i propri controlli `if (!email || !password)`. Manca una validazione strutturata di tipi, lunghezze, formati.

**Soluzione**: Introdurre [Zod](https://zod.dev/) + integrazione Fastify.

```bash
npm install zod fastify-type-provider-zod
```

**Esempio**:
```typescript
// src/schemas/auth.ts
import { z } from 'zod';

export const LoginSchema = z.object({
  email: z.string().email().max(255).transform(v => v.toLowerCase().trim()),
  password: z.string().min(1).max(128),
});

export const MagicLoginSchema = z.object({
  magicToken: z.string().min(10).max(500),
});

// src/routes/auth.ts
server.post('/auth/login', {
  schema: { body: LoginSchema },
}, async (req, reply) => {
  const { email, password } = req.body; // già validato e trasformato
  // ...
});
```

**Schema da creare per ogni endpoint**:
- `auth.ts`: login, magic-login, change-password
- `clienti.ts`: crea/aggiorna cliente
- `progetti.ts`: crea progetto, consuntiva, ritardo
- `fatture.ts`: emetti fattura
- `tenant.ts`: crea utente, aggiorna settings

---

### 2.3 🟡 Tipizzare Fastify request (eliminare `as any`)

**Problema**: `(req as any).tenantId`, `(req as any).ruolo`, `(req as any).user` — TypeScript non può verificare questi campi.

**Soluzione**: Decorare Fastify con tipi propri:
```typescript
// src/types/fastify.d.ts
import 'fastify';

declare module 'fastify' {
  interface FastifyRequest {
    tenantId: string;
    ruolo?: string;
    user?: JwtPayload;
    userId?: string;
  }
}
```

Dopo questa dichiarazione, `req.tenantId` funziona senza `as any`.

---

### 2.4 🟡 Eliminare `(prisma as any)` nei servizi

**Problema**: `otpService.ts` usa `(prisma as any).codiceOtp` — il tipo del client esteso non include i modelli.

**Soluzione**: Il tipo `PrismaConContesto` in `prismaClient.ts` dovrebbe già includere tutti i modelli. Verificare che `prisma generate` sia stato eseguito e che il tipo sia corretto. Se il problema persiste, creare un'interfaccia esplicita:
```typescript
// Invece di (prisma as any).codiceOtp.findFirst(...)
// Usare:
prisma.codiceOtp.findFirst(...)  // Se il tipo è corretto
```

---

## 5. FASE 3 — Qualità del Codice

> **Obiettivo**: Migliorare testabilità, logging, gestione errori.
> **Tempo stimato**: 1 settimana

### 3.1 🟡 Logging strutturato con Pino

**Problema**: `Fastify({ logger: false })` + `console.log` sparsi. In produzione i log non sono strutturati, non si possono filtrare, non hanno correlation ID.

**Soluzione**:
```typescript
const server = Fastify({
  logger: {
    level: process.env.LOG_LEVEL || 'info',
    transport: process.env.NODE_ENV !== 'production'
      ? { target: 'pino-pretty' }
      : undefined,
  },
});
```

Sostituire tutti i `console.log`/`console.error` con `req.log.info()`/`req.log.error()`.

---

### 3.2 🟡 Test E2E sul flusso critico

**Flusso da testare**:
1. Bootstrap super_admin
2. Login → JWT
3. Crea cliente
4. Crea progetto
5. Crea preventivo
6. Accetta preventivo → istanziazione
7. Consuntiva microvoce
8. Verifica cascata stati
9. Emetti fattura
10. Verifica PDF

**Strumento**: Vitest + supertest (o Playwright per il frontend).

---

### 3.3 🟢 OpenAPI / Swagger

Generare documentazione automatica delle ~87 rotte con `@fastify/swagger`:
```bash
npm install @fastify/swagger @fastify/swagger-ui
```

---

## 6. FASE 4 — Performance e Scalabilità

> **Obiettivo**: Preparare il sistema alla crescita.
> **Tempo stimato**: 1 settimana

### 4.1 🟡 Paginazione su tutte le liste

**Problema**: `listaProgetti`, `listaClienti`, `listaFattureTutte` caricano tutto. Con centinaia di progetti e migliaia di fatture, le query diventano lente e la risposta enorme.

**Soluzione**: Parametri `page` e `pageSize` su ogni endpoint GET di lista:
```typescript
// GET /progetti?page=1&pageSize=50
const { page = 1, pageSize = 50 } = req.query;
const skip = (page - 1) * pageSize;
const [progetti, totale] = await Promise.all([
  prisma.progetto.findMany({ skip, take: pageSize, ... }),
  prisma.progetto.count({ ... }),
]);
return { data: progetti, meta: { page, pageSize, totale, pagine: Math.ceil(totale / pageSize) } };
```

---

### 4.2 🟡 Rate limiting distribuito (Redis)

**Problema**: Il rate limit in-memory funziona solo con una singola istanza. Con più repliche Railway, ogni istanza ha il suo contatore.

**Soluzione**: `@fastify/rate-limit` con store Redis:
```bash
npm install @fastify/rate-limit ioredis
```
```typescript
server.register(rateLimit, {
  max: 100,
  timeWindow: '1 minute',
  redis: new Redis(process.env.REDIS_URL),
  // Whitelist per health check e webhook
  whitelist: (req) => req.url === '/health' || req.url.startsWith('/webhooks/'),
});
```

---

### 4.3 🟢 Indici database

Verificare che esistano indici su:
- `cliente.tenant_id`
- `progetto.tenant_id`, `progetto.cliente_id`, `progetto.stato`
- `fattura.tenant_id`, `fattura.progetto_id`
- `microvoce_progetto.modulo_progetto_id`
- `user.email` (già unique)
- `magic_link.token_hash`

---

## 7. FASE 5 — Nuove Funzionalità

> **Obiettivo**: Completare le funzionalità mancanti.
> **Tempo stimato**: 2-3 settimane

### 5.1 🟡 Scheduler cron reale

**Problema**: Il cron è un endpoint HTTP (`POST /cron/esegui-notifiche-scadenze`) che va chiamato manualmente o con un servizio esterno.

**Soluzione**: Integrare `node-cron` nel processo:
```bash
npm install node-cron
```
```typescript
import cron from 'node-cron';

// Ogni giorno alle 8:00
cron.schedule('0 8 * * *', async () => {
  for (const tenant of await prismaAmministrativo().tenant.findMany()) {
    attivaContestoTenant({ tenantId: tenant.id, ruolo: 'system' });
    await runDailyNotificationCron(tenant.id);
  }
});
```

---

### 5.2 🟡 Coda per notifiche con retry

**Problema**: L'invio email/WhatsApp è inline nella richiesta. Se il provider è lento o giù, la richiesta HTTP fallisce o va in timeout.

**Soluzione**: Coda semplice in-memory (o BullMQ con Redis per produzione):
```typescript
// src/services/notificationQueue.ts
const coda: Array<{ tipo: 'email' | 'whatsapp'; payload: any; tentativi: number }> = [];

export function accodaNotifica(tipo: 'email' | 'whatsapp', payload: any) {
  coda.push({ tipo, payload, tentativi: 0 });
}

// Worker che processa la coda ogni 5 secondi con retry (max 3 tentativi)
```

---

### 5.3 🟢 TOTP per super_admin

Il campo `totpSecret` esiste già in `User`. Implementare:
- Generazione secret TOTP al bootstrap
- Verifica TOTP al login per `super_admin`
- Libreria: `otplib` (pure JS, no binding nativi)

---

### 5.4 🟢 Backup DB schedulato

Lo script `src/scripts/backupDb.ts` esiste. Schedularlo:
- Railway: cron job separato
- Oppure: `node-cron` nel processo principale (ogni notte alle 3:00)
- Destinazione: Supabase Storage o S3

---

### 5.5 🟠 Modulo KYC/AML governato

> **🇲🇹 SVOLTA 23/09/2026 — Malta-first (spec v0.2).** L'app parte da **Malta**: la nuova
> [`bluman-kyc-compliance-specifica-v0.2.md`](bluman-kyc-compliance-specifica-v0.2.md) **sostituisce
> come direzione** l'impianto italiano qui sotto (D.Lgs. 231, UIF, 10 anni, rischio a singolo albero)
> e il primo taglio già deployato (5.5.1: `FascicoloKyc`+`kycEngine`, IT-flavored). Cambia il
> baricentro: **FIAU + MFSA + MBR**, PMLA/PMLFTR/Implementing Procedures, canale **goAML** (prepara,
> non invia), conservazione **5 anni**, figura **MLRO**, **rischio a 4 pilastri** (cliente/geografia/
> prodotto/canale) versionato, fascicolo **anomalie** separato (divieto di *tipping-off*), regole **per
> configurazione** (`jurisdictionPack` MT/IT + `regulatoryProfile` CSP_MFSA|ALTRO + feature flag).
>
> **Decisioni titolare (23/09):** (1) **evolvere** `FascicoloKyc` → `KycCase`+`RiskAssessment` a
> pilastri+`TenantComplianceSettings` (non ricostruire); (2) **MLRO** nominato dalle Impostazioni;
> (3) consulente AML maltese **da configurare** → intanto valori default `[da verificare]` in config,
> mai cablati. **Fasi nuove K0→K10** (K0 = settings+giurisdizione+feature flag+modalità bozza).
>
> ⚠️ **PRIMA di K0**, priorità del titolare: **aggiornare moduli e documenti** (libreria/BOM + template)
> leggendo i 3 file nella cartella `template/`, ed eventualmente l'**anagrafica Bluecode con dati reali**.
> La descrizione italiana qui sotto resta come contesto storico (pacchetto `IT`, predisposto non prioritario).

**Problema**: il KYC/AML è oggi *passivo* — i campi `rischioAml`, `ubo`, `dataKyc`,
`fontePatrimonio` su `Cliente` esistono ma non guidano né bloccano alcun processo. Un incarico
si apre, un contratto si firma e un'operazione straordinaria si avvia anche con un fascicolo KYC
scaduto o mai iniziato. Per uno studio soggetto al D.Lgs. 231/2007 (adeguata verifica, artt.
17-25, conservazione decennale ex art. 31) è un obbligo con sanzioni, non un campo opzionale.

**Soluzione**: trasformarlo in un processo governato, proporzionato al rischio e il più
automatizzato possibile. **Specifica tecnica completa**: [`bluman-kyc-aml-spec-tecnica.md`](bluman-kyc-aml-spec-tecnica.md)
(5 moduli — modello dati, motore di rischio, portale cliente, dashboard studio, automazioni —
con modello Prisma, criteri di accettazione e punti aperti).

**Scaletta di rilascio** (dettaglio nella spec §8):

- [x] **5.5.1 Motore + stati** — modello dati (`FascicoloKyc`, `StoricoFascicoloKyc`, `OverrideKyc`,
  `DocumentoKyc` + enum), motore di rischio a regole statiche (`livelloVerifica` calcolato, non
  scelto dall'operatore), badge stato in `AnagraficaErpModal`. Nessun blocco: prima si misura.
  → **FATTO 22-23/09**: schema+migrazione+RLS, `src/domain/kycEngine.ts` (puro, 9 test), rotte
  `src/routes/kyc.ts`, badge in anagrafica, script `backfillKyc.ts` (dry-run). Non ancora deployato.
- [ ] **5.5.2 Integrazioni dati** — API Registro Imprese/visura (UBO precompilato), screening
  PEP/liste sanzionatorie automatico. Interfaccia comune `ProviderVerificaEsterna` disaccoppiata.
  Prioritaria: è ciò che abbatte di più il lavoro manuale.
- [ ] **5.5.3 Portale Cliente** — wizard onboarding (solo livelli ordinario/rafforzato), firma
  del modulo di adeguata verifica riusando l'infrastruttura FEA/OTP esistente.
- [ ] **5.5.4 Dashboard e Gate selettivo** — coda di lavoro prioritizzata, approvazione massiva,
  four-eyes sul rafforzato, KYC gate bloccante su wizard nuovo progetto e invio alla firma (con
  override motivato e loggato in `OverrideKyc` + notifica al Responsabile Compliance). Il gate va
  attivato **per ultimo**, dopo aver validato che il motore non generi troppi falsi positivi.
- [ ] **5.5.5 Automazioni e rivalutazione continua** — estensione di `cronService.ts`
  (scadenzario T-30/T-15/T-0), rivalutazione del rischio su variazione UBO/PEP/soglia (art. 18).

**Note di allineamento al repo**: lo schema usa `@default(uuid())` (non `cuid()`); i quattro
campi KYC già su `Cliente` vanno migrati nel fascicolo o tenuti come proiezione di sola lettura,
mai come secondo stato divergente. Il calendario aggrega già le scadenze KYC (`categoria: kyc`,
sola lettura ai ruoli interni) e il cron gestisce i rinnovi UBO: il nuovo modulo estende, non
duplica. La conservazione decennale (art. 31) vieta la cancellazione di fascicoli/documenti/log
entro i 10 anni, anche a fronte di richieste GDPR (anonimizzazione parziale, non cancellazione).

**Punti aperti da decidere con il titolare** (spec §10): provider per screening PEP/adverse
media/Registro Imprese (costi e SLA), soglie economiche di default per tenant, modalità di
anonimizzazione oltre il periodo di conservazione obbligatoria.

---

## 8. FASE 6 — DevOps e CI/CD

> **Obiettivo**: Automatizzare test, deploy, monitoring.
> **Tempo stimato**: 1 settimana

### 6.1 ✅ CI/CD con GitHub Actions (fatto, 27 agosto 2026)

La workflow reale è `.github/workflows/ci.yml` (push e PR su `main`) e comprende,
nell'ordine: setup Node 20 con cache npm su entrambi i lockfile, `npm ci` in radice,
`npx prisma generate`, **typecheck backend** (`npx tsc --noEmit`), **suite completa**
(`npx vitest run`), **build backend** (`npm run build`), `npm ci` in `frontend/`,
**typecheck frontend REALE** (`npx tsc -b --force` — il `tsc --noEmit` sul tsconfig del
frontend con `"files": []` non verifica nulla) e **build frontend** (`tsc -b && vite build`).
`frontend/package-lock.json` è versionato perché `npm ci` funzioni in CI.

---

### 6.2 🟢 Monitoring

- **Sentry**: Error tracking backend + frontend
- **Uptime check**: `GET /health` ogni 60s da un servizio esterno
- **Alerting**: Notifica se health check fallisce per 3 minuti consecutivi

---

### 6.3 🟢 Variabili d'ambiente documentate

Creare `.env.example`:
```bash
# Database
DATABASE_URL=postgresql://bluman_app:PASSWORD@host:5432/bluman
DIRECT_URL=postgresql://postgres:PASSWORD@host:5432/bluman
ADMIN_DATABASE_URL=postgresql://postgres:PASSWORD@host:5432/bluman

# Auth
JWT_SECRET=  # minimo 32 caratteri, genera con: node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"

# App
NODE_ENV=production
PORT=3000
APP_BASE_URL=https://bluman.vercel.app
CORS_ORIGINS=https://bluman.vercel.app

# SMTP (fallback, le credenziali reali stanno in tenant)
SMTP_HOST=
SMTP_PORT=465
SMTP_USER=
SMTP_PASS=

# Supabase Storage (opzionale)
SUPABASE_URL=
SUPABASE_SERVICE_KEY=

# Redis (per rate limit distribuito, Fase 4)
REDIS_URL=
```

---

## 9. Checklist Finale

### FASE 0 — Sicurezza (2-3 giorni)
- [x] 0.1 CORS whitelist origini
- [x] 0.2 Fail-fast senza DB in produzione
- [x] 0.3 Frontend: rimuovere fallback silenziosi su scritture
- [x] 0.4 TLS `rejectUnauthorized: true`
- [x] 0.5 JWT confronto constant-time
- [x] 0.6 Audit log con tenant esplicito
- [x] 0.7 File sensibili fuori dal repo

### FASE 1 — Affidabilità (3-4 giorni)
- [x] 1.1 `eliminaProgetto` in transazione
- [x] 1.1bis `eliminaModulo` con transazione, controllo ruoli e blocco ore consuntivate
- [x] 1.2 Cron senza dati mock
- [x] 1.3 Health check con verifica DB
- [x] 1.4 Frontend: rimuovere mockData da App.tsx
- [x] 1.5 §WF-DOC: Workflow bidirezionale documenti (bozza ⇄ pubblicato ⇄ revisione ⇄ firma OTP con versioning a DB)
- [x] 1.6 §WF-DOC hardening (27/08/2026): documento firmato blocca tutto con 409 (stato/nuova versione/eliminazione), sblocco riservato all'admin del tenant con motivazione ≥10 caratteri e audit, tracciabilità a ritroso nel portale cliente (`documentoPadreId` + `versioniPrecedenti[]`)

### FASE 2 — Refactoring (1-2 settimane)
- [x] 2.1 Spezzare server.ts in moduli route (27/08/2026, commit da 246d313 a 05c3d7e)
- [x] 2.1b Split frontend ClientPortal.tsx (28/08/2026, commit 6aee803)
- [x] 2.1c Split frontend altri monoliti (ProjectDetail ✅ 8a19b6f; Library ✅ dbc8358; api/client.ts ✅ f50cc8f; SettingsPage ✅ eaeae7d; ClientsPage ✅ 1d291b1; PassaggioModal ✅ fa29925; DocumentEditorPage ✅ 124623e)
- [x] 2.2 Validazione Zod su tutti gli endpoint principali (collegati schemi su auth, clienti, progetti, documenti, contabilità, fornitori, liquidazioneIva, solleciti)
- [x] 2.2b Fix Sicurezza & Sessione Multi-Tenant (Fix 4: separazione token portale `bluman_portal_token` e filtro `GET /progetti` su `clienteId` per token portale)
- [x] 2.2c Hub Comunicazioni Multicanale (allegati WhatsApp e IMAP Inbound con imapflow, spunte stato WhatsApp-style `✓`/`✓✓`, smart scroll chat)
- [x] 2.3 Tipizzare FastifyRequest (12/09/2026, tipizzazione route Fastify, generic params e AppPort)
- [x] 2.4 Eliminare `as any` residui (12/09/2026, FASE 8.1 — zero `as any` in tutte le route)

### FASE 3 — Qualità (1 settimana)
- [x] 3.1 Logging Pino strutturato (FASE 3 — Pino JSON con censura dati sensibili e serializzatore req)
- [x] 3.2 Test E2E flusso critico (FASE 7 — `src/e2eFlussiCritici.test.ts` su creazione progetto, firma FEA e SDI)
- [x] 3.3 OpenAPI/Swagger (12/09/2026, FASE 6.2 — `@fastify/swagger` + `@fastify/swagger-ui` su `/docs`)

### FASE 4 — Performance (1 settimana)
- [x] 4.1 Paginazione liste (FASE 1 — PaginazioneQuerySchema su fatture, prima nota, progetti, clienti, audit)
- [x] 4.2 Rate limit Redis & Cache Backend Distribuita (2026-09-12: provisioning database Redis su Railway, client `src/util/redis.ts`, rate limit distribuito `@fastify/rate-limit`, cache multi-layer `src/services/backendCache.ts` per giurisdizioni, moduli catalogo e articoli con abbattimento overhead RLS, suite `src/backendCache.test.ts`)
- [x] 4.3 Indici DB & Caching Globale Piattaforma (migrazioni `20260912150000_indici_performance` e `20260912160000_indici_performance_globale`: indici compositi su AuditLog, Notifica, Progetto, MovimentoPrimaNota, Cliente, Fattura, FatturaRiga, ScadenzaIncasso, Fornitore, FatturaRicevuta, Documento e ContrattoRicorrente; estensione cache client-side 0ms a Archivio Documenti, Fornitori, Conti Bancari, Retainers e LIPE)

### FASE 5 — Funzionalità (2-3 settimane)
- [x] 5.1 Cron schedulato reale (FASE 2.1 — runner CLI `runDailyNotificationCron.ts` e test dedicato)
- [x] 5.2 Coda notifiche con retry (FASE 2.3 — `src/services/notificationQueue.ts` con backoff esponenziale)
- [x] 5.3 TOTP super_admin & Ricorda Postazione IP (2026-09-12/13, `src/util/totp.ts` — RFC 6238 puro crypto nativo, compatibilità 100% Apple Passwords / Google Authenticator / 1Password, cifratura AES-GCM segreto, 8 backup codes, migrazioni `20260913133000_totp_campi_user` e `20260913150000_totp_ip_fidati`, memorizzazione postazioni/IP fidati con login diretto dopo la prima verifica, rotta `/auth/totp/dimentica-ip`, 19 test unitari e di rotta HTTP green, frontend completo `TabSicurezza.tsx` e `LoginPage.tsx`)
- [x] 5.4 Backup DB schedulato (2026-09-12, `src/scripts/runScheduledBackup.ts` — AES-256-GCM, retention 14gg, multi-tenant, script npm `backup:scheduled`, 6 test)
- [ ] 5.5 Modulo KYC/AML governato (D.Lgs. 231/2007) — spec `bluman-kyc-aml-spec-tecnica.md`; scaletta 5.5.1 motore+stati → 5.5.2 integrazioni dati → 5.5.3 portale cliente → 5.5.4 dashboard+gate → 5.5.5 automazioni. Non ancora iniziato.

### FASE 6 — DevOps (1 settimana)
- [x] 6.1 CI/CD GitHub Actions
- [ ] 6.2 Monitoring Sentry + uptime
- [ ] 6.3 `.env.example` documentato

---

## 📊 Timeline Complessiva

| Fase | Durata | Priorità | Dipendenze |
|------|--------|----------|------------|
| 0 — Sicurezza | 2-3 giorni | 🔴 CRITICA | Nessuna |
| 1 — Affidabilità | 3-4 giorni | 🟠 ALTA | Fase 0 |
| 2 — Refactoring | 1-2 settimane | 🔴 ALTA | Fase 1 |
| 3 — Qualità | 1 settimana | 🟡 MEDIA | Fase 2 |
| 4 — Performance | 1 settimana | 🟡 MEDIA | Fase 2 |
| 5 — Funzionalità | 2-3 settimane | 🟢 BASSA | Fase 2 |
| 6 — DevOps | 1 settimana | 🟢 BASSA | Fase 3 |

**Totale stimato**: 6-8 settimane per completamento integrale.
**Minimo indispensabile per produzione sicura**: Fasi 0 + 1 = ~1 settimana.

---

*Ultimo aggiornamento: 2026-09-22 (Aggiunta la voce **§5.5 Modulo KYC/AML governato**
sotto FASE 5, con la scaletta di rilascio in cinque tappe e il rimando alla specifica tecnica
`bluman-kyc-aml-spec-tecnica.md`. Il modulo trasforma il KYC/AML da campo descrittivo passivo a
processo governato risk-based (D.Lgs. 231/2007), riusando calendario, cron rinnovi UBO e
infrastruttura FEA/OTP esistenti. Non ancora iniziato: registrato nel piano e nella checklist.)*
*Prossima priorità operativa: la prova in un minuto sull'ingresso WhatsApp (§1bis) — scrivere al
`+1 555-181-9633` con `railway logs --service bluman-api` aperto; poi §1ter Fase A, che è il punto
in cui l'assegnazione dei compiti smette di essere un numero nel browser.*
