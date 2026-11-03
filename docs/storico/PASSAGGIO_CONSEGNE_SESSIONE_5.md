# 📑 Passaggio Consegne — Sessione 5 (1° ottobre 2026)

> **Stato repository:** `main` = `71692cf5`, spinto su GitHub e **distribuito su tutti e tre gli
> ambienti**: Vercel (frontend), Railway (backend, via auto-deploy del push) e VPS (codice,
> frontend, database, backend). La migrazione è applicata su Supabase **e** sul VPS.

---

## 🚀 Esito della distribuzione (01/10/2026)

| Ambiente | Esito | Prova |
|---|---|---|
| **GitHub** | `458f7087..71692cf5  main -> main` | `git ls-remote origin main` = `71692cf5` |
| **Vercel** | `readyState: READY`, **alias riassegnato** | `▲ Aliased https://bluman.vercel.app`; il bundle servito è passato da `index-C5Fzan5v.js` a `index-oXt1sLSL.js`, e «In forza dal» è passato da **0 a 3** occorrenze |
| **Railway** | sano | `/health` → `{"stato":"ok","db":"ok"}`, sonda rotta **401**. Qui la correzione dei webhook è un **no-op per costruzione** (`RAILWAY_PUBLIC_DOMAIN` resta prioritario): il criterio è «non si è rotto niente» |
| **VPS** | i quattro passi + le verifiche, tutti verdi | allineato a `71692cf5`, frontend costruito, migrazioni+RLS applicate, container ricreati; `/health` ok, frontend 200, sonda **401**, `checkRls` **attivo su tutte le tabelle** |

### La prova che conta, letta *dentro* il container in esecuzione

Non un'inferenza dal codice: il modulo è stato eseguito nel container `api` di produzione, con il
suo ambiente vero (`docker compose exec api npx tsx …` su `src/util/urlPubblica.ts`).

| | |
|---|---|
| `RAILWAY_PUBLIC_DOMAIN` | `null` — **la variabile non esiste**, come diagnosticato |
| `APP_BASE_URL` | `http://136.144.234.118` |
| `urlPubblicaBackend()` | `http://136.144.234.118` — **non più `railway.app`** |
| Webhook Telegram | `http://136.144.234.118/webhooks/communications/telegram` |
| Callback WhatsApp | `http://136.144.234.118/webhooks/communications/whatsapp/<slug>` |

Prima della correzione tutti e tre si sarebbero composti su
`https://bluman-api-production.up.railway.app`. **Vercel e VPS servono la stessa app**: entrambi i
bundle contengono «In forza dal» **3** volte e «Operatori archiviati» **1** volta.

### ⚠️ `distribuisci.sh` non è lanciabile senza terminale

`--solo-push` ha validato tutto (120 file di test, 1430 test, ~6 minuti) e poi si è **piantato sul
`git push`**: l'helper di sistema vuole un terminale e senza terminale non fallisce, resta appeso.
Il run è stato terminato dal timeout con GitHub, Vercel e VPS **intatti** — il tempo speso a
validare è stato buttato.

**`git push --dry-run` non è una prova valida**: passa con exit 0 anche quando il push vero si
blocca, perché non arriva a farsi autenticare. Mi ha ingannato proprio su questo.

La sequenza che funziona, in quest'ordine:

1. push con l'helper `gh`: `git -c credential.helper= -c credential.helper='!gh auth git-credential' push origin main`
2. `npx vercel --prod --scope fanta-ia --yes` a mano;
3. `bash scripts/distribuisci.sh --solo-vps` (salta push e Vercel; **rifà comunque** la validazione
   del passo 1, quindi va lanciato solo dopo aver spinto davvero).

---

## 🔍 Due difetti dello stesso tipo: un indirizzo scritto a mano

Trovati leggendo il codice dopo la distribuzione, non da un test rosso. **Il difetto è uno solo,
in due punti**: dove il progetto compone un indirizzo per conto di *questo* backend, qualcuno
aveva scritto l'indirizzo di Railway nel codice. Su Railway è corretto e non si vede; sul VPS
manda la richiesta **a un altro backend, con un altro database** — e non produce nessun errore.

### a) Il logo dello studio — `458f7087`

`getFormattedLogoUrl` (`frontend/src/utils/index.ts`) anteponeva l'indirizzo di Railway ai
percorsi `/uploads/…`. Sul VPS il frontend e l'API sono sulla **stessa origine**, quindi la base
delle API è `''` e il percorso deve restare relativo: il logo veniva chiesto a Railway, che quel
file non ce l'ha.

Era **latente** — `tenant.logo_url` sul VPS è ancora il marchio statico `/logo.png`, che non passa
da quel ramo — e sarebbe esploso al **primo caricamento di un logo**. Lo stesso file usava già la
base corretta per `urlFileArchivio` e `urlDocumentoAssoluto`: era una riga rimasta indietro.

Presidio nuovo: `frontend/src/utils/index.test.ts` (3 test), che reimporta il modulo dopo aver
stabilito le variabili — `API_BASE` si calcola al caricamento, quindi senza `resetModules` il test
passerebbe senza provare niente.

### b) I webhook di WhatsApp e Telegram — `71692cf5`

`urlPubblicaBackend()` (`src/util/urlPubblica.ts`) leggeva la sola `RAILWAY_PUBLIC_DOMAIN`.
Sul VPS quella variabile **non esiste** — verificato sull'ambiente in esecuzione — quindi la
Callback URL di WhatsApp mostrata allo studio (`tenant.ts`) e l'endpoint su cui Telegram consegna
(`webhooks.ts`) si componevano su `bluman-api-production.up.railway.app`.

Questo è **peggio del logo**: il valore si copia nella dashboard di Meta, quindi uno studio che
avesse configurato il canale da lì avrebbe mandato i messaggi dei **suoi clienti** all'ambiente
sbagliato, e nessuno se ne sarebbe accorto finché un cliente non avesse scritto senza ricevere
risposta.

La correzione aggiunge la seconda sorgente, che è già la convenzione del progetto per «dove vive
questo deployment» (la leggono `emailRelay`, `imapInbound`, `serverHelpers`, `emailService`):

| | |
|---|---|
| `RAILWAY_PUBLIC_DOMAIN` | dominio **nudo** fornito da Railway: vince dove esiste, e copre anche gli ambienti di prova |
| `APP_BASE_URL` | **URL completo**: decide fuori da Railway, e lo **schema si conserva** (sul VPS, prima del TLS, è legittimamente `http://`) |
| dominio di produzione Railway | solo ripiego per chi non dichiara nulla |

Due normalizzatori distinti perché le variabili hanno forme diverse. Un valore senza host
(`https://`) vale come variabile assente invece di produrre `https://https:`.

Presidio: `src/urlPubblica.test.ts`, da 13 a **18 test**. Ora svuota **entrambe** le variabili:
`APP_BASE_URL` è impostata anche nel `.env` di sviluppo (`http://localhost:5173`) e senza
toglierla il ripiego non sarebbe mai raggiunto — il test avrebbe osservato questa macchina
credendo di provare il VPS.

---

## ✅ Le tre verifiche chieste dal titolare — tutte chiuse

### a) Recupero degli 8 file — **non erano persi**

La premessa di ieri («stanno sul disco locale del container, e un container è effimero, quindi
sono spartiti») era **sbagliata**. `/app/uploads` su Railway **non è il filesystem del container**:
è un **volume persistente** montato (`bluman-api-volume`).

Due riscontri indipendenti: `.railway/railway.ts:40` e `railway status`
(`volume: bluman-api-volume · /app/uploads · 0.1 GB / 4.9 GB`). Un volume Railway sopravvive ai
redeploy.

`railway ssh 'ls -la /app/uploads'` ha elencato **tutti e 8** i file attesi (caricati fra il 27 e
il 31 agosto). Scaricati via `base64 -w0` sullo ssh, confrontati byte per byte (le dimensioni
combaciano, tutti iniziano con `%PDF`) e ricaricati sul VPS.

**Il verdetto si dà dopo aver letto, non prima** — è la lezione di ieri: la diagnosi era
ragionevole e sbagliata.

### b) Isolamento RLS sul VPS — **TUTTO VERDE**

Due studi veri creati sul VPS, due login veri, via API:

| Prova | Esito |
|---|---|
| Ogni studio vede solo il proprio cliente | ✅ |
| Lettura per id di un cliente dell'altro studio | ✅ 404 |
| Controprova: lettura del proprio cliente | ✅ 200 |
| Richiesta senza token | ✅ 401 |

La controprova serve a non far passare il test **per il motivo sbagliato**: un test che verifica
solo i 404 è verde anche quando l'API risponde 404 a tutto. Gli studi di prova (2 clienti, 2 utenti,
2 tenant, 2 righe di audit) sono stati **cancellati**, e il conteggio finale verificato: **0**.

### c) Volume degli upload sul VPS — confronto **per nome**, non per numero

Due numeri uguali con i file sbagliati è il caso che sembra a posto e non lo è. Quindi il confronto
è stato fatto nome per nome, più la lettura end-to-end di ogni file con la firma HMAC vera.

| | Prima | Dopo il recupero |
|---|---|---|
| Documenti che puntano a `/uploads/` | 20 | 20 |
| File presenti nel volume | 19 | **27** |
| Documenti **senza** il loro file | **8** | **0** |

Gli 8 mancanti erano tutti nomi legacy (senza prefisso di studio). I 7 `.docx` «gemelli» non
referenziati da nessun documento sono rimasti dove sono: non erano un problema e non lo sono ora.

---

## 🐛 Tre difetti trovati e chiusi (`d51f2318`)

Trovati rileggendo la funzione di archiviazione appena scritta, non da un test rosso. Il terzo
invece **l'ha trovato il test** che ho scritto per il primo.

1. **Un collaboratore appena invitato non si poteva archiviare.** Nasceva senza periodo aperto,
   quindi `POST /tenant/utenti/:id/disattiva` gli rispondeva **409 «non risulta in forza» per
   sempre**: «Archivia» non avrebbe mai funzionato sul caso più comune di tutti. La migrazione lo
   aveva fatto per chi c'era già; ora lo fa `apriPeriodoIniziale`, chiamata dall'invito — e
   idempotente, quindi chiamata fuori dal ramo di creazione, così sistema anche chi entra in uno
   studio per la prima volta passando da lì.

2. **Il reset password su un archiviato lo riportava dentro.** Quella rotta scrive
   `stato: 'invitato'`, e su una persona archiviata la riga ha l'effetto **opposto**
   dell'intenzione: sparisce dagli archiviati, ricompare fra gli attivi, torna assegnabile ai
   progetti e capace di entrare — **senza che nessun periodo sia stato riaperto**. L'invariante
   cadeva in silenzio, da una rotta che sembra non c'entrare. Ora **409**, con l'invito a usare
   «Riattiva», che è l'unica operazione che apre un periodo nuovo.

3. **Invitare la mattina e archiviare il pomeriggio dava 400.** `dal` è un **istante** (l'invito, o
   il `created_at` copiato dal backfill) mentre la data di fine si sceglie da un calendario ed è un
   **giorno**: il confronto era fra istanti, quindi mezzanotte < 09:14. Ora è fra giorni
   (`inizioDelGiorno`). La data scritta a database resta quella scelta — si accorcia solo il termine
   di paragone.

Presidio: `src/periodiCollaborazione.test.ts` da **19 a 24 test**.

---

## 🚀 Distribuzione — tutto in produzione

La migrazione `20261001_periodi_collaborazione` è **applicata**:

- **Supabase** (via auto-deploy Railway): `64 migrations found` → `Applying migration
  20261001_periodi_collaborazione` → `All migrations have been successfully applied`;
- **VPS**: applicata a mano, poi `rls` riapplicata → **71 tabelle con RLS attivo, 0 scoperte**,
  tenant inesistente → **0 righe**.

Il VPS è stato aggiornato con i quattro passi (codice, frontend, database, backend) e verificato:
`/health` ok, frontend `200`, sonda rotta `401`, e le **due rotte nuove** (`disattiva`/`riattiva`)
rispondono **401 e non 404** — cioè l'immagine in esecuzione è davvero quella nuova.

Verificato anche che il bundle servito da nginx contenga la UI nuova («Archivia», «In forza dal»):
una build senza il flag giusto, o non rifatta, darebbe un'app che sembra a posto e parla col
backend sbagliato.

---

## 🧩 `distribuisci.sh` ora aggiorna anche il VPS (`9cca76ba`)

Prima aggiornava Vercel e Railway. Il VPS — secondo bersaglio di deploy — restava indietro, ed è
esattamente la classe di guasto che quello script esiste per evitare: **due ambienti con codice
diverso**, e chi prova la correzione la prova contro il codice vecchio.

Il passo VPS sta **in coda al push**, perché il server prende il codice da GitHub. Quattro cose, e
tre sono invisibili se saltate:

| Passo | Comando | Se si salta |
|---|---|---|
| Codice | `git pull --ff-only` in `/opt/bluman` + verifica che l'HEAD sia il commit appena distribuito | si costruisce l'immagine dal codice vecchio |
| Frontend | build `node:22` usa-e-getta con `VITE_API_SAME_ORIGIN=true` | l'app parla col backend di Railway **in silenzio** |
| Database | `build api migrate` → `run --rm -T migrate` → `run --rm -T rls` | schema vecchio; e senza `rls` la tabella nuova resta **scoperta** |
| Backend | `up -d` | il container continua con l'immagine precedente |

**`rls` non è ridondante dopo `migrate`**: la migrazione crea la policy della tabella nuova solo se
il ruolo `bluman_app` **e** la funzione `app_tenant_corrente` esistono già, mentre `rls` riapplica
le policy a **tutte** le tabelle per introspezione ed è idempotente (`DROP POLICY IF EXISTS` prima
di ogni `CREATE`). È la rete di sicurezza contro lo stato peggiore possibile.

Verifica in coda, bloccante: `/health`, `200` sulla radice, sonda rotta (**401, mai 404**) e
`checkRls` («spento su 0»).

Il VPS **non si salta in silenzio**: se non risponde, lo script **esce** dicendolo, e per
distribuire senza c'è `--no-vps` — una scelta esplicita. Flag nuovi: `--solo-vps`, `--no-vps`,
e `VPS_HOST`/`VPS_BASE`/`VPS_DIR` per puntare altrove senza editare lo script.

---

## ⚠️ Da sapere

- **Il 414 è distribuito, e va distinto dagli 8 file.** Sono **due fatti diversi**, che è facile
  confondere: gli 8 recuperati avevano nomi **legacy corti** (senza prefisso di studio) e il loro
  problema era che il file non c'era; il `414 URI Too Long` riguarda invece i nomi **lunghi**
  prodotti dall'app (`<tenantId>_<timestamp>_<originale>`: 51 caratteri di solo prefisso, contro
  un tetto di 100 nel router). Il commit `3b1cd393` era fermo **non spinto**, quindi ogni ambiente
  serviva ancora l'immagine vecchia. Ora è distribuito; la verifica va fatta sui nomi lunghi, non
  sui recuperati.
- **Il push su `main` applica le migrazioni**, non solo il codice (Railway auto-deploy +
  `prisma migrate deploy` nel Dockerfile). Vale anche per il futuro: `main` deve restare sempre
  deployabile.
- **Un indirizzo cablato non si vede finché l'ambiente coincide.** I due difetti qui sopra hanno la
  stessa forma e nessuno dei due produce un errore: su Railway l'indirizzo scritto a mano *è*
  quello giusto. È la ragione per cui servono presidi che reimportino il modulo con **un'altra**
  configurazione, invece di test che confermano l'ambiente di chi li esegue.
- **`distribuisci.sh --solo-push` fa push + Vercel + VPS**, saltando solo `railway up` (il backend
  su Railway lo prende dall'auto-deploy del push). La validazione — typecheck backend e frontend,
  lint, build Vite, suite Vitest intera — è **bloccante** e precede il push: non si spinge codice
  che non è già verde.
- **La passphrase di `bluman_vps` esiste solo nella testa del titolare.** Non va chiesta in chat.
  Basta che la chiave sia **nell'agente** (`ssh-add ~/.ssh/bluman_vps`): lo script la usa da lì.
- **`docker compose run/exec` eredita lo stdin.** In un'invocazione `ssh` il container se lo
  mangia e la sessione si interrompe **a metà senza errore**. Nello script tutte le chiamate
  passano da un wrapper con `</dev/null`.
- **Un volume Railway non è un container.** `/app/uploads` sopravvive ai redeploy: prima di
  dichiarare perso un file, si legge.

---

## 📌 Prossimi passi

1. **TLS sul VPS** quando il DNS punterà al server: `docs/vps-primo-avvio.md` §6.
2. **Secondo studio**: `voce7` (tenant dinamico) è risolta, quindi è sbloccato.
3. **Backlog dell'audit 27/09**: X3/L2/B3/D3 ancora aperti, da fare insieme.
4. **Review visiva** del tema chiaro/scuro: il codice è in produzione, manca il giro a occhio.
