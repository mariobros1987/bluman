# 16 · Impostazioni Studio

## 👤 Cosa fa e come si usa
Le **Impostazioni** (`/settings`) configurano lo studio (tenant):
- **Dati studio**: ragione sociale, sedi, P.IVA, **logo**, colore del tema PDF;
- **Email Suite**: credenziali **SMTP/IMAP** dello studio (per invio/ingestione posta);
- **Canali**: WhatsApp/Telegram/Signal (token, username bot, callback);
- **Configuratore PDF** della fattura;
- **Team**: gli utenti dello studio (iniziali, ruoli), gli **operatori archiviati** e la **Matrice Permessi RBAC** (§17);
- **Sicurezza**: 2FA/TOTP;
- **Compliance**: profilo regolatorio e **MLRO** (per il modulo KYC, §13).

## 📐 Calcoli & logica
- Le **credenziali dello studio** vivono nella riga **Tenant** del database e si aggiornano via
  `PUT /tenant/settings`; le password delle **persone** solo come **hash scrypt** su
  `user.password_hash` (mai in chiaro, regola 5). Nessun valore di ripiego precompilato nella UI.
- `PATCH /tenant/info` (impostazioni studio) è **riservato ad advisor/super_admin** — non passa dalla
  matrice permessi (è funzione da titolare, decisione 27/09).
- I segreti (SMTP/IMAP pass, token canali) non vengono mai restituiti in chiaro alle letture.
- **La Callback URL mostrata nei Canali è l'indirizzo di *questo* backend**, non di Railway: si compone
  in `src/util/urlPubblica.ts` (`RAILWAY_PUBLIC_DOMAIN` → `APP_BASE_URL` → dominio di produzione). È il
  valore che lo studio incolla nella dashboard di Meta, quindi un errore qui **non si vede come errore**:
  si vede come clienti che scrivono e nessuno che riceve. Su un VPS senza `RAILWAY_PUBLIC_DOMAIN` la
  sorgente è `APP_BASE_URL`, letta **con il suo schema** (prima del TLS è `http://`, ed è corretto).
  Dettaglio in §15; presidio `src/urlPubblica.test.ts`.

### 📦 Archiviare un operatore che non lavora più nello studio

Quando una persona smette di collaborare, **non si cancella**: i progetti a cui ha lavorato, le ore
registrate e i documenti che ha caricato la citano con chiavi esterne, e cancellarla vorrebbe dire o
romperli o azzerarli. Si **archivia**.

- Nella scheda **Gestione Team**, ogni persona attiva ha il pulsante **`📦 Archivia`**. Si indica il
  **giorno in cui la collaborazione è finita** (precompilato a oggi, modificabile: non è per forza il
  giorno in cui ci si ricorda di archiviare) e, se serve, un motivo.
- Chi si **invita** nasce già «in forza» dal giorno dell'invito: non c'è niente da fare perché
  compaia con la sua data di inizio, e lo si può archiviare anche il giorno stesso. Le date sono
  confrontate **per giorno**, non all'istante: invitare la mattina e archiviare il pomeriggio è una
  cosa normale e non viene respinta.
- Da quel momento l'utenza è **spenta**: la persona non accede più e **non compare più tra gli
  operatori assegnabili** ai progetti e agli eventi.
- Chi è archiviato finisce in una sezione a parte, **«Operatori archiviati»**, con il periodo in cui
  ha lavorato. Da lì il pulsante **`↩️ Riattiva`** lo riporta in forza indicando la **data di inizio**.
- Chi era stato **invitato** e non aveva mai scelto una password personale non se la ritrova
  pronta: al primo accesso dopo la riattivazione gli viene chiesto di cambiarla, esattamente come
  al primo invito. È voluto — quella password temporanea la conosce anche chi l'ha creata.
- Se una persona rientra dopo anni, la sua storia ha **due periodi**: il precedente non viene
  sovrascritto. È il motivo per cui i periodi sono registrati uno per uno e non in due colonne.

Chi può archiviare: **super admin** e **responsabile dello studio** (advisor). Un advisor agisce solo
sul proprio studio e non tocca un super admin della piattaforma.

Le regole che impediscono di chiudersi fuori da soli:

- **non si archivia sé stessi** — serve un altro responsabile;
- **non si archivia l'ultimo responsabile attivo** dello studio: senza di lui nessuno può più creare
  utenti né riattivare chi è stato archiviato;
- un **super admin di piattaforma** non appartiene a uno studio e non si archivia da qui.

Nessuna data è modificabile a posteriori: un periodo chiuso è un fatto registrato, non una bozza.
Se è stato scritto male, si riattiva e si richiude con la data giusta — e restano agli atti entrambe
le operazioni.

### 📋 Dati obbligatori dello studio (i sei che servono per fatturare)

Sei campi dell'anagrafica sono la materia prima di ogni documento fiscale: **senza di loro l'app non
compone la fattura elettronica e lo dice**, invece di riempire i vuoti con un valore plausibile. Non è
una formalità — fino a ottobre 2026 l'app **inventava**: un XML con la P.IVA a zero, l'indirizzo «Via
Roma 1» e il regime «RF01» non è un documento con un buco, è un documento che dice il falso, e SdI o
lo scarta o — peggio — lo accetta.

| Campo (Impostazioni → Anagrafica) | Dove finisce | Cosa l'app scriveva al suo posto |
|---|---|---|
| **Ragione Sociale Studio** | la «Denominazione» del cedente in ogni fattura elettronica e l'intestazione dei documenti | «Studio Advisory» |
| **Partita IVA / VAT Number** | l'`IdCodice` dell'identificativo fiscale del cedente nell'XML SDI | «00000000000» |
| **Codice Fiscale Societario** | il `CodiceFiscale` del cedente nell'XML SDI | ripiegava sulla P.IVA e, senza quella, «00000000000» |
| **Indirizzo Sede Legale** | l'indirizzo della sede del cedente nell'XML e nelle intestazioni | «Via Roma 1» |
| **Regime Fiscale** | il `RegimeFiscale` del cedente nell'XML SDI | «RF01», cioè «ordinario», che potrebbe non essere il tuo |
| **IBAN per Accredito Fatture** | le coordinate di pagamento stampate in fattura e nei solleciti | la fattura usciva senza coordinate su cui pagare |

Come si comporta l'app:

- **Al primo accesso** del responsabile dello studio compare una guida che elenca i campi mancanti, a
  che cosa servono e cosa l'app scriveva al loro posto. Si chiude con **«Più tardi»** e non ricompare
  per quello studio; resta richiamabile da **Impostazioni → Anagrafica** («📋 Dati obbligatori per
  fatturare» → **Rivedi la guida**), dove lo stesso riquadro dice se l'anagrafica è completa o quali
  campi mancano.
- **Scaricando l'XML di una fattura** (`GET /invoices/:id/sdi-xml`) con l'anagrafica incompleta, la
  risposta è **409** e il messaggio **nomina i campi** mancanti: non «anagrafica incompleta», che
  costringerebbe a indovinare fra sei campi in un'altra schermata.
- Nel **fascicolo fiscale per il commercialista** (ZIP), le fatture con l'anagrafica incompleta restano
  nel registro CSV — sono comunque accadute — ma **non producono XML**, e l'indice del fascicolo dice
  quali campi mancano. Far fallire l'intero archivio per una fattura sarebbe peggio che dirlo.
- La lista dei sei campi è **una sola**, in `src/domain/anagraficaStudio.ts`: la usano la rotta della
  guida (`GET /tenant/anagrafica`), il controllo prima dell'XML e il motore dello ZIP. Due copie
  divergerebbero.

Cosa **non** è ancora strutturato, ed è bene saperlo: `Tenant.sedeLegale` è una riga di testo libero,
mentre l'XML richiede CAP, Comune e Provincia separati. Il generatore non li valorizza e ripiega su
`00100` / `Roma` / `RM`, e la nazione del cedente è fissa a `IT`. Per uno studio non italiano quei
campi sono da correggere: serve separare l'indirizzo in quattro colonne e aggiungere i campi nel
modulo (decisione a sé, non ancora presa).

## 🔗 Collegamenti
- **Comunicazioni** (§15): SMTP/IMAP e canali si impostano qui.
- **RBAC** (§17): la Matrice Permessi e il team si gestiscono da qui.
- **KYC** (§13): profilo regolatorio e MLRO.
- **Fatture** (§05): il Configuratore PDF e i dati studio finiscono in fattura.

## ⚠️ Stati limite & errori
- Modifica impostazioni studio da un collaboratore → **403** (solo advisor/super_admin).
- Un canale con credenziali errate → messaggi di configurazione mirati (non un fallimento muto).
- Archiviazione o riattivazione da un ruolo che non sia advisor/super_admin → **403**; da un advisor su
  un altro studio → **403**; su sé stessi, sull'ultimo responsabile attivo o con una data incoerente
  (fine prima dell'inizio, inizio prima della fine del periodo precedente) → **400** con il motivo;
  archiviare chi non è in forza o riattivare chi lo è già → **409**. In nessun caso la scrittura
  avviene a metà: periodo e stato dell'utenza cambiano insieme o non cambiano affatto.
- **Rigenerare la password a una persona archiviata → 409**, con l'invito a **riattivarla** invece.
  Non è un divieto formale: quella rotta rimette l'utenza in `invitato`, e su un archiviato la
  riporterebbe dentro — fra gli attivi, assegnabile ai progetti e capace di entrare — senza che
  nessun periodo sia stato riaperto. Per farla rientrare si usa **`↩️ Riattiva`**, che è l'unica
  operazione che apre un periodo nuovo.

## 🔧 Nota tecnica
- Rotte: `src/routes/tenant.ts` (`/tenant/info`, `/tenant/settings`, `/tenant/utenti`,
  `POST /tenant/utenti/:id/disattiva`, `POST /tenant/utenti/:id/riattiva`, `/tenant/moduli`,
  `GET /tenant/anagrafica` — i dati obbligatori, §7).
- **Invariante dei periodi**: `user.stato = 'disattivato'` **se e solo se** non esiste una riga di
  `periodo_collaborazione` con `al` nullo. A presidiarla è un solo punto di scrittura,
  `src/services/periodiCollaborazione.ts` (`disattivaCollaboratore` / `riattivaCollaboratore` /
  `apriPeriodoIniziale`), che chiude/apre il periodo e aggiorna `stato` (con `sessionVersion`
  incrementata, così la sessione aperta muore subito) nella **stessa transazione**. Due scritture in
  due posti lascerebbero una persona disattivata col periodo ancora aperto.
- Il backfill nella migrazione è una **fotografia**, non una regola: vale per chi c'era già. Per chi
  arriva dopo, il periodo aperto lo crea `apriPeriodoIniziale`, chiamata da `POST /tenant/utenti`
  all'invito. Senza, un collaboratore appena invitato non avrebbe nessun periodo aperto e `Archivia`
  gli risponderebbe 409 «non risulta in forza» **per sempre** — su un utente appena creato, cioè il
  caso più comune di tutti. La funzione è idempotente (se un periodo aperto c'è già non fa niente),
  quindi è chiamata anche fuori dal ramo di creazione e sistema chi entra in uno studio per la prima
  volta passando da lì.
- Il confronto fra `dataFine` e l'inizio del periodo è **fra giorni, non fra istanti**
  (`inizioDelGiorno`): `dal` è l'istante dell'invito (o il `created_at` copiato dal backfill), mentre
  la data di fine si sceglie da un calendario. Invitare alle 09:14 e archiviare lo stesso giorno
  avrebbe `dataFine` = mezzanotte < `dal`, e un confronto fra istanti respingerebbe con 400 il caso
  più normale. La data scritta a database resta quella scelta: si accorcia solo il termine di
  paragone.
- Il controllo sull'**ultimo responsabile attivo** è fatto *dentro* la transazione: due responsabili
  che si archiviano a vicenda nello stesso istante passerebbero entrambi un controllo fatto fuori.
- Frontend: `pages/SettingsPage.tsx`, `components/settings/` (`TabCompany`, `TabChannels`, `TabSdi`,
  `TabUsers`, `ArchiviaOperatoreModal`, `OperatorDetailModal`, `TabSicurezza`, `TabCompliance`,
  `TabInvoiceDesign`); la guida ai dati obbligatori è `components/AnagraficaStudioModal.tsx`, montata
  in `components/layout/AppLayout.tsx` e letta da `hooks/useAnagraficaStudio.ts`.
- **Il logo dello studio** si carica con `POST /upload` e finisce in `tenant.logo_url`. Quando lo
  storage in uso è il **ripiego locale**, il backend ne restituisce un percorso **relativo**
  (`/uploads/<nome>?firma=…`, da `storageService.urlUploadFirmato`) ed è il frontend a risolverlo:
  `getFormattedLogoUrl` (`utils/index.ts`) antepone **`API_BASE`**, che sul VPS vale **`/api`** (il
  prefisso che nginx toglie prima di consegnare la richiesta all'API) e su Vercel l'indirizzo di
  Railway. ⚠️ Con l'indirizzo del backend
  **fissato nel codice** il logo veniva chiesto a Railway — un altro database e un altro volume — e
  sul VPS spariva; corretto il 01/10/2026. Su un VPS senza Supabase Storage il ripiego locale è la
  **norma**, non l'eccezione (20 documenti su 20 con `file_url` = `/uploads`), quindi `logoUrl` e
  `fileUrl` sono percorsi relativi e non vanno mai risolti con un indirizzo scritto a mano.
  Presidio: `frontend/src/utils/index.test.ts`.
- Schema: `Tenant` (dati studio, `smtp_pass`/`imap_pass`, servername certificati), `User`,
  **`PeriodoCollaborazione`** (`periodo_collaborazione`: `dal`, `al` nullo = in forza, `motivo`,
  `creato_da`, `stato_precedente`; migrazione `20261001_periodi_collaborazione`, che fa anche il
  **backfill** di un periodo aperto da `user.created_at` per ogni utente già esistente non
  disattivato).
- **`stato_precedente`** è lo stato dell'utenza prima di spegnerla, e serve a non promuovere
  nessuno per sbaglio: chi era **`invitato`** — creato, mai entrato, con la password temporanea
  ancora da cambiare — **torna `invitato`**, non `attivo`. Riattivarlo come `attivo` gli darebbe un
  accesso pieno retto da una password che chi l'ha creato conosce. Per tutti gli altri il ritorno è
  `attivo`, ed è anche il ripiego per le righe nate prima che la colonna esistesse.
- Presidio: `src/periodiCollaborazione.test.ts` (24 test).
- Fonti: `.agents/AGENTS.md`, `AUDIT_2026-09-27/01-sicurezza-multitenant.md`.
