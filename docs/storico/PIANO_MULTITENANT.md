# BluMan — Piano multi-studio

> **Stato: piano, non implementazione.** Questo documento non descrive codice che esiste: descrive
> cosa manca perché un secondo studio possa usare BluMan con i **suoi** dati e le **sue** chat. È la
> voce 8 della scaletta in `PIANO_DI_MIGLIORAMENTO.md` §1bis, ed è la voce 7 vista dall'altro lato:
> la 7 dice cosa manca nel codice, questa dice cosa manca nella decisione.
>
> **Ultimo aggiornamento: 17/09/2026.** Il §3 ha ora un pezzo che codice lo è davvero — il
> collegamento chat → pratica, in produzione dal 16/09 — ed è l'unica parte di questo documento che
> descrive qualcosa di già costruito. Serve a una cosa sola: è la prima tabella nata **dopo** che
> questo piano ha scritto la regola «ogni tabella porta la sua policy nella sua migrazione», quindi
> vale come prova che la regola si possa seguire.
>
> **Nessuna credenziale in questo file**, nemmeno come esempio. I punti non ancora verificati sono
> marcati **«da verificare»** invece di essere affermati.
>
> **Niente si implementa prima della risposta a due domande:** quanti studi, e chi li crea. Le due
> strade del §4 costano due ordini di grandezza diversi, e la scelta fra loro *è* la risposta a
> quelle domande.

---

## 1. Il fatto

BluMan è più vicino al multi-studio di quanto sembri, e il punto esatto in cui non lo è si indica
con una riga.

**Quello che già funziona per studio.** Lo schema è interamente intestato: tutti i 46 modelli oltre
`Tenant` hanno una colonna `tenant_id` (`user` ce l'ha nullable, per il `super_admin` che sovrintende
tutti gli studi). Le policy RLS esistono e sono **per richiesta**, non per processo:
`src/util/prismaClient.ts` avvolge ogni operazione in una transazione che imposta
`app.current_tenant_id`, il contesto arriva da un `AsyncLocalStorage` riempito nell'hook in
`src/server.ts:407-439`, e il client si connette col ruolo `bluman_app`, che non può scavalcare le
policy. Le credenziali dei canali sono colonne di `Tenant` e `credenzialiCanali()`
(`src/services/otpDispatch.ts:68`) **non ripiega su nessuna variabile d'ambiente**: uno studio senza
credenziali proprie risulta spento, non invia a nome di un altro. Il cron notturno
(`src/scripts/runDailyNotificationCron.ts:43,59-64`) già **itera gli studi** e per ciascuno apre un
contesto RLS con `contestoTenant.run({ tenantId, ruolo: 'super_admin' }, …)`. E il seam per
spostarsi fra studi esiste già: `src/server.ts:536-542` onora `X-Tenant-Id` **solo** per il
`super_admin` — per tutti gli altri il tenant del token è vincolante.

**Quello che non funziona.** `src/index.ts:11,20` costruisce **una sola** istanza:

```ts
const TENANT_ID = '00000000-0000-0000-0000-000000000001';
app = new PrismaApp(prisma, TENANT_ID);
```

e `PrismaApp` (**34 metodi**, con 34 occorrenze di `this.tenantId`) filtra su quel tenant congelato
alla costruzione. Il tenant però non è solo nella classe: il costruttore lo passa a **tre**
collaboratori, che se lo tengono per tutta la vita dell'oggetto
(`prismaApp.ts:73-77` — `PrismaIstanziazionePort`, `NotificheStudioPort`, più `this.tenantId`).

**La conseguenza, detta senza addolcirla: un secondo studio non riceve un errore, riceve il vuoto.**
Non è una fuga di dati — la RLS tiene, ed è progettata perché un contesto dimenticato produca un
guasto visibile invece di una fuga silenziosa — ma **non è nemmeno un prodotto**: liste vuote,
«non trovato» su risorse che esistono, e nessun messaggio che spieghi perché.

**Ed è già raggiungibile oggi, non domani.** La catena esiste: un `super_admin` manda `X-Tenant-Id`,
l'hook lo accetta, il contesto RLS si sposta sull'altro studio — e l'adattatore resta fermo su
`00000000-…-0001`. A quel punto la RLS filtra per B e il filtro applicativo per A: intersezione
vuota, cioè **nessun dato**. Che il difetto non si manifesti in produzione dipende solo dal fatto
che finora c'è un solo studio. *(Da verificare: quante righe ha oggi la tabella `tenant`.)*

**Il modello da propagare esiste già nel repo.** Le rotte dei webhook risolvono il tenant dalla
richiesta e lo passano **esplicito a ogni query** (`src/routes/webhooks.ts`, ramo WhatsApp
~455-505: `where: { tenantId, clienteId: … }`, e `tenantId` in ogni `create`). Sono scritte così
perché un webhook è anonimo — non c'è un JWT da cui leggere il tenant — e quindi hanno dovuto
risolvere il problema che il resto dell'API non ha mai avuto. È la forma da cui copiare.

---

## 2. «Dati separati»: le quattro superfici

Un dato è separato quando lo è su **tutte e quattro**. Oggi lo è su due e mezza.

### 2a. Schema — ✅ fatto

Ogni tabella con `tenant_id NOT NULL` ha RLS attiva, forzata e una policy `isolamento_tenant` con
`USING` **e** `WITH CHECK` (quindi anche le scritture: non si può inserire una riga a nome di un
altro studio). Tre tabelle fanno eccezione e hanno una policy scritta a mano, perché il ciclo
generico non le copre: `user` (tenant nullable per il super_admin), `tenant` (il vincolo è sulla
chiave primaria), `passaggio_template` (non ha `tenant_id`, appartiene a un articolo). Più
`_prisma_migrations`, che è di Prisma.

### 2b. Runtime — ⚠️ fatto a metà, ed è il buco vero

La RLS è per richiesta (bene). Il filtro applicativo è per processo (è il §1). Le due cose oggi
coincidono perché c'è uno studio solo, e **questa coincidenza è l'intero debito**: non è un filtro
sbagliato, è un filtro che non ha mai dovuto essere giusto.

### 2c. Credenziali — ✅ fatto

Tutto sulla riga `Tenant`, niente variabili d'ambiente di piattaforma come ripiego: WhatsApp
(`wa_phone_id`, `wa_access_token`, `wa_verify_token`, `wa_app_id`, `wa_app_secret`,
`wa_webhook_slug`, template OTP), Telegram (`tg_bot_token`, `tg_bot_username`), SMTP e IMAP
completi, Signal (`signal_endpoint`, `signal_token`, `signal_number`). Il commento in
`otpDispatch.ts:58-67` documenta il guasto che questo ha chiuso: prima gli invii partivano
dall'account di un solo studio per tutti i tenant, cioè «il messaggio di firma di un cliente
spedito dal numero di un altro».

### 2d. File — ⚠️ la superficie debole, e va detto chiaramente

**La RLS non copre i file.** Non è una dimenticanza: i file stanno su disco e in un bucket, dove non
esistono policy. Le regole attuali sono queste, e sono più debolmente isolate dei dati:

- **Un solo bucket** (`bluman-documents`) e **una sola cartella** (`uploads/`), condivisi.
- L'isolamento è un **prefisso nel nome**: `uploadDocumento(nome, contenuto, tenantId?)` scrive
  `<tenantId>_<timestamp>_<nome>` (`src/services/storageService.ts:110-126`).
- La lettura lo rilegge: `GET /uploads/:filename` (`src/routes/catalogo.ts:172-212`) estrae il
  tenant con `tenantDaNomeFile()` e risponde **404** — non 403, per non confermare l'esistenza — se
  il file è di un altro studio.
- Il controllo però si applica **solo** a una richiesta autenticata con Bearer, non `super_admin`, e
  con un nome che **dichiara** il tenant. Restano fuori tre casi, tutti deliberati:
  1. **URL firmato** (HMAC in query string): è una capacità che vale per sé stessa e non porta
     contesto utente — serve perché questi URL finiscono in `<img src>` e negli href delle stampe,
     dove nessuno può mandare un header;
  2. **file storici**, senza prefisso, caricati prima dell'isolamento: non dichiarano un
     proprietario e vengono serviti come prima;
  3. **`super_admin`**, che vede tutti gli studi per costruzione.
- La firma Supabase (`urlSupabaseFirmato`) produce un URL che **non passa da nessun controllo di
  tenant**: chi lo possiede legge, fino alla scadenza del token.

Conclusione onesta: fra «dati» e «file» c'è una differenza di garanzia, non di dettaglio. Il
database rifiuta a livello di motore; i file si difendono con una convenzione sul nome e un
controllo in una rotta. Se il multi-studio diventa reale, **questa è la prima superficie da
rifare** (percorso per studio nel bucket, o bucket per studio).

---

## 3. «Chat separate»

Qui la notizia è buona: **è già quasi tutto fatto**, perché il canale è per studio per costruzione e
non per scelta.

- **Telegram** — un bot per studio (`tg_bot_token` su `Tenant`). E non è una convenzione: il segreto
  di verifica del webhook si **deriva** dal token, `creaSegretoTelegram(tenantId, botToken, master)`
  in `src/util/webhookSecurity.ts:37-44`, quindi due studi con lo stesso token produrrebbero due
  segreti diversi e **non possono** condividere un bot. Il tenant si ricava dal segreto stesso
  (`tenantIdDaSegretoTelegram`), cioè il webhook sa a chi appartiene il messaggio senza cercarlo.
- **WhatsApp** — un'app Meta per studio (`wa_app_id`, `wa_app_secret`), con la firma
  `X-Hub-Signature-256` verificata con l'App Secret di **quello** studio. Il path di callback porta
  uno **slug per studio**, `wa_webhook_slug`, `@unique` e generato con entropia dal database: serve a
  dedurre lo studio dall'URL senza una ricerca cross-tenant sul `phone_number_id`. Il template OTP
  approvato vive sulla riga dello studio, perché è la sua app che l'ha fatto approvare.
- **Signal** — `signal_endpoint` e `signal_token` per studio, più `signal_number`. Il demone è
  `signal-cli-rest-api`, uno per studio, dietro un reverse proxy che impone il token (`signal-cli`
  non ha autenticazione propria). *(Da verificare: chi avvia e ospita il demone dei nuovi studi —
  oggi è documentato come «dello studio», quindi presuppone che lo studio lo abbia.)*
- **Il collegamento chat → pratica** (`CollegamentoChatProgetto`) è `tenant_id`-scoped, con la chiave
  unica su `(tenantId, canale, chatId)`: la stessa chat fisica può essere collegata a due studi
  diversi senza che i due si vedano. **Non è più un progetto: è in produzione dal 16/09/2026**
  (`prisma/migrations/20260916210000_collegamento_chat_progetto`, applicata dal `migrate deploy` del
  `Dockerfile` — vedi `PIANO_DI_MIGLIORAMENTO.md` §1bis voce 3). La policy `isolamento_tenant` sta
  **dentro la migrazione**, come per ogni tabella nuova, perché `migrate deploy` gira senza nessuno
  davanti a ogni deploy: una tabella che si affidasse a una policy aggiunta a mano dopo resterebbe
  senza isolamento esattamente nel momento in cui nasce. È anche la prima tabella nata **dopo** che
  questo documento ha scritto la regola, quindi vale come verifica che la regola si possa seguire.

  Un dettaglio che riguarda la separazione: la chat si aggancia a una **pratica**, e il payload
  firmato che il cliente tocca copre `tenantId` **e** `progettoId`
  (`creaPayloadCollegamento`, `src/util/webhookSecurity.ts`). Il link di uno studio non è quindi
  spendibile su un altro nemmeno se i due condividono il master secret — che è l'unica cosa che
  `TELEGRAM_WEBHOOK_SECRET` è, essendo una variabile d'ambiente della piattaforma e non una riga
  `Tenant`. Per un secondo studio questo va rivisto: o un master secret per studio, o lo si accetta
  consapevolmente come segreto di piattaforma, visto che il MAC copre il tenant.

**Cosa NON vuol dire «chat separate».** Non vuol dire una chat interna fra studi: non esiste e non
serve. Vuol dire che un operatore dello studio A non vede **mai** una conversazione dello studio B —
e questo lo garantisce la RLS su `comunicazione_progetto` e su `webhook_inbox`, non l'interfaccia.

---

## 4. Le due strade

### Strada A — l'adattatore per richiesta (poche righe, pochi studi)

`PrismaApp` **accetta già il tenant nel costruttore**, e i suoi collaboratori pure. Serve costruirlo
dove il tenant è noto — cioè nell'hook che già chiama `attivaContestoTenant` — invece che una volta
sola all'avvio, con una piccola cache `tenantId → PrismaApp` (gli oggetti sono senza stato oltre al
tenant, quindi condividerli è sicuro; la cache va solo limitata nel numero).

Il punto da non sottovalutare: le rotte ricevono `app` come **parametro catturato**
(`registraRotteProgetti(server, app)`, e dentro `await app.getProgetto(id)`). Non basta costruire
l'istanza giusta: bisogna che le 34 chiamate vedano quella. Il modo che non tocca una riga di rotta
è un **inoltro**: un oggetto che implementa `AppPort` e, a ogni chiamata, risolve l'istanza dal
contesto della richiesta e le delega il metodo.

- **Costo:** mezza giornata, più i test.
- **Cosa lascia in piedi:** il filtro applicativo resta dov'è, e torna a essere giusto perché
  coincide di nuovo col tenant della richiesta. Nessun call site da toccare.
- **Cosa non risolve:** `X-Tenant-Id` per il `super_admin` continua a funzionare solo per i due
  metodi che accettano il parametro (`archiviaProgetto`, `eliminaProgetto`), a meno di non far
  leggere al contesto il tenant **effettivo** e non quello del token — che è la cosa giusta, ed è
  una riga nell'hook.

### Strada B — il tenant per chiamata nella porta (il refactor)

`tenantId` diventa il primo argomento di ogni metodo di `AppPort` e dei suoi collaboratori: cade
`this.tenantId` e con esso l'idea che un adattatore appartenga a uno studio.

- **Costo:** giorni, non ore. 34 metodi di `PrismaApp`, i collaboratori che li implementano, i due
  adattatori (`InMemoryApp` compreso), e i test che li usano — più il rischio, distribuito su tutto
  il codice, di dimenticarne uno: un metodo dimenticato continua a compilare e a girare, e filtra
  sul tenant sbagliato.
- **Cosa compra:** il tenant non è più uno stato implicito dell'oggetto, è un parametro. Un secondo
  studio non può *dipendere* da una costruzione fatta bene altrove.
- **Nota:** buona parte del lavoro è meccanica e il compilatore la guida — il che è il motivo per
  cui conviene farla **tutta insieme**, non a pezzi.

### Come scegliere

| | Strada A | Strada B |
|---|---|---|
| Studi previsti | pochi, gestiti a mano | molti, creati da altri |
| Chi crea uno studio | tu, con uno script | un flusso di onboarding |
| Costo | mezza giornata | giorni |
| Rischio residuo | l'istanza giusta va risolta per ogni richiesta | un call site dimenticato |

**Consiglio: non fare né l'una né l'altra prima della decisione commerciale.** La strada A è così
piccola che farla «per sicurezza» è una tentazione ragionevole, ma senza un secondo studio reale non
c'è niente che la provi, e il codice che non si può esercitare invecchia peggio di quello che non
esiste. Se la decisione è «due o tre studi, li apro io», è A. Se è «uno studio si iscrive da solo»,
allora A è solo il primo passo e va pianificato B — e a quel punto conviene affrontare anche
l'onboarding (§5), che è più lavoro del refactor.

---

## 5. L'onboarding di uno studio

Nell'ordine in cui va fatto, perché ogni passo presuppone il precedente. Serve anche come lista di
verifica per la strada A: sono i punti in cui un secondo studio si rompe.

1. **Riga `tenant`** con ragione sociale e dati fiscali. Da qui pende tutto il resto.
2. **Primo utente** con ruolo `advisor` (o `super_admin`, con `tenant_id` NULL — ma un super_admin
   per studio non è il modello: il super_admin sovrintende tutti).
3. **Credenziali dei canali** (`Impostazioni → Canali`): SMTP/IMAP, WhatsApp, Telegram, Signal.
   Ogni canale non configurato resta **spento con un motivo**, che è il comportamento voluto.
4. **WhatsApp**: app Meta dello studio, `wa_app_id`/`wa_app_secret`, slug di callback, template OTP
   approvato, e la registrazione del webhook su Meta.
5. **Telegram**: token del bot, poi `setWebhook` **con il segreto derivato** — il pulsante «Registra
   webhook» della scheda; è anche il momento in cui `tg_bot_username` viene letto da `getMe` e
   salvato, senza cui il link per progetto non si compone. **Non compilare `tg_bot_username` a mano:
   lascia che lo scriva la registrazione.** Il 17/09/2026 è successo l'opposto su questo studio —
   nel campo c'era l'**id numerico** del bot (che è anche la prima metà del token), `t.me/<numero>`
   apriva «questo utente non esiste» sul telefono del cliente, e la registrazione del webhook non
   correggeva niente perché scriveva **solo se il campo era vuoto**. Ora rilegge `getMe`, confronta e
   corregge, quindi il guasto si sana da solo; ma la lezione per l'onboarding di un secondo studio è
   che il campo non va compilato a mano, e che `getMe` è la fonte mentre la colonna è la sua copia.
6. **Signal**: demone dello studio, endpoint e token. *(Da verificare: chi lo ospita.)*
7. **Libreria di articoli e moduli** — ✅ **già per studio**: `Articolo` e `ModuloTemplate` hanno
   `tenant_id` e la chiave unica `(tenantId, nome, versione)`. Uno studio nuovo parte **vuoto**, non
   con il catalogo di un altro. Resta da decidere **cosa** gli si mette dentro: la libreria di uno
   studio nuovo nasce vuota e va popolata, e il catalogo di partenza è una scelta editoriale, non
   tecnica *(da verificare: se `scripts/seedData.ts` sappia popolare un tenant arbitrario o ne
   presupponga uno)*.
8. **Storage**: nessuna configurazione per studio, ed è il punto — i file finiscono nel bucket
   condiviso col prefisso nel nome (§2d).
9. **Verifica RLS**, e non è una formalità: `npx tsx src/scripts/checkRls.ts` risponde a tre
   domande sul database reale (RLS è attiva? con che ruolo si connette Prisma? quel ruolo è
   soggetto alle policy o le scavalca?) e fa una **prova pratica**: imposta
   `app.current_tenant_id` a un tenant inesistente e conta i clienti visibili. Se il conto è > 0,
   le policy non filtrano nulla per quel ruolo. È l'unica verifica che non si può dedurre leggendo
   il codice.

---

## 6. Le fasi

| # | Cosa | Perché in questo ordine | Costo |
|---|---|---|---|
| 0 | **Decisione**: quanti studi, chi li crea | Determina A o B. Niente codice prima | — |
| 1 | **Secondo studio di prova** (riga `tenant` + un utente) e `checkRls.ts` | Rende il difetto **visibile**: liste vuote su dati esistenti. Da qui in poi ogni passo si può esercitare | ore |
| 2 | **Strada A** (o B, se la decisione la impone) | Chiude il §2b, cioè il buco vero | mezza giornata (A) / giorni (B) |
| 3 | **Isolamento dei file** (§2d) | È la superficie con la garanzia più debole, e la più esposta appena ci sono due studi | da stimare dopo aver scelto bucket-per-studio o percorso-per-studio |
| 4 | **Onboarding** (§5) come procedura scritta, ripetibile | Trasforma «so farlo» in «si può fare» | mezza giornata |
| 5 | **Verifica con due studi reali** su tutti i canali | L'unica prova che conta: due chat, due fascicoli, nessuna interferenza | un giorno |

Le fasi 1 e 2 sono quelle che rendono la piattaforma multi-studio *nel codice*. La 3 è quella che la
rende **difendibile** davanti a un cliente che chiede dove stanno i suoi documenti.

---

## 7. Cosa non è multi-studio oggi (elenco esplicito)

- **`PrismaApp`**: una istanza per processo, tenant cablato (`src/index.ts:11,20`). È il §1.
- **Il tenant effettivo per il `super_admin`**: `X-Tenant-Id` sposta il contesto RLS ma non
  l'adattatore, quindi funziona solo per i due metodi che accettano il parametro.
- **I file**: bucket e cartella condivisi, isolamento per prefisso nel nome, tre eccezioni
  deliberate (§2d).
- **Il catalogo iniziale di uno studio nuovo**: la struttura è per tenant, il *contenuto* del seed no
  *(da verificare: se `seedData.ts` sappia popolare un tenant arbitrario o ne presupponga uno)*.
- **Il demone Signal**: per studio per configurazione, ma l'ospitalità è dello studio *(da verificare)*.
- **La creazione di uno studio**: oggi è uno script, non un flusso. Nessuno può farlo da solo.

## 8. Cosa resta da verificare prima di dire «multi-studio»

1. Quante righe ha oggi `tenant` — se sono due, il difetto del §1 è già raggiungibile e va
   verificato in produzione con la massima priorità.
2. `npx tsx src/scripts/checkRls.ts` sul database reale: ruolo di connessione, `rolbypassrls`,
   tabelle con RLS accesa e policy presenti. Nessuna deduzione dal codice.
3. Che in produzione esistano il ruolo `bluman_app` e la funzione `app_tenant_corrente()`: le
   migrazioni RLS che girano su `migrate deploy` **si annullano in silenzio** se mancano (fanno
   `RAISE NOTICE` e `RETURN`), quindi la loro assenza non fa fallire il deploy — e questo è il modo
   in cui la RLS può essere spenta senza che nessuno se ne accorga.
4. Se `seedData.ts` sappia popolare un tenant arbitrario.
5. Chi ospita il demone Signal di un nuovo studio.
