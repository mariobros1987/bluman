# 15 · Comunicazioni & Canali

## 👤 Cosa fa e come si usa
Le comunicazioni con il cliente sono **omnichannel** e finiscono nel **fascicolo della pratica**:
**email** (SMTP/IMAP), **WhatsApp**, **Telegram**, **Signal**.
- **Invio**: dallo studio (scheda Comunicazioni del progetto) via il canale configurato; ogni invio è
  registrato come comunicazione in uscita.
- **Ingestione**: i messaggi in arrivo (webhook/IMAP) entrano nel fascicolo del cliente/pratica.
- **Quando il messaggio non si può archiviare**, non si butta e non si indovina: se il mittente non
  è univoco, o il cliente ha **più di una pratica aperta** (o nessuna), scegliere il fascicolo
  sarebbe un'invenzione. Il messaggio vive allora in **campanella** come avviso «messaggio non
  archiviato», che dice chi ha scritto, cosa ha scritto e **cosa fare** perché il prossimo entri da
  solo. **Dal 09/10/2026 l'avviso è cliccabile**: porta alla scheda della **pratica** quando la
  pratica è nota (chat collegata a una pratica poi chiusa), altrimenti all'**anagrafica** di quel
  cliente. Se il mittente non è stato identificato il clic non porta da nessuna parte, ed è
  voluto: non c'è una scheda da aprire, e l'avviso dice cosa cercare. La campanella ha un filtro
  **«senza fascicolo»** che isola questi avvisi dagli altri, e compare solo quando ce n'è almeno uno.
  **Non** si crea un fascicolo generico: un messaggio che a nessuna pratica appartiene non ha un
  fascicolo, e inventarne uno sarebbe un archivio finto.
- **Collegamento chat per pratica**: un link `t.me/<bot>?start=<payload>` aggancia la chat Telegram del
  cliente a **quella** pratica (il payload è firmato HMAC); si copia o si invia via email/WhatsApp.
- **Messaggi ↔ micro-voci**: ogni messaggio può essere legato alla micro-voce di cui parla, così
  aprendo una voce si vedono i messaggi che la riguardano **senza rileggere la chat a mano**.
  - **Il cliente lo dichiara da sé**: il link della micro-voce (dal tab «💬 Messaggi» di una voce, o dal
    pannello del link) aggancia la chat alla pratica **e** arma un *contesto* — da lì i messaggi di
    quella conversazione nascono abbinati a quella voce.
  - **L'operatore lo decide a mano**: nella scheda Comunicazioni, si seleziona un messaggio (o più) e
    si preme «🔗 Abbina a micro-voce».
  - **L'operatore lo arma per WhatsApp, Signal e portale**, dove il cliente non ha un link: dal
    pannello del link, sezione «Micro-voce in ascolto», si sceglie la conversazione e la voce.
  - **Una volta armato, l'abbinamento è automatico su Telegram, WhatsApp, Signal e portale**: i
    messaggi *in arrivo* di quella conversazione nascono già legati alla voce. Il portale fa eccezione
    in una cosa sola: la sua conversazione è il **cliente**, e non avendo un `chatId` di provider
    compare nell'elenco delle chat col nome del cliente.
  - **L'email non si abbina**, e non è una mancanza: la posta in arrivo si legge dalla casella e si
    **mostra** nel fascicolo, non diventa una riga archiviata — non c'è nessuna riga da legare.
  - **L'operatore scrive da dentro la voce**: dal tab «💬 Messaggi» di una micro-voce c'è il
    compositore, con tutti e cinque i canali e gli allegati. Il messaggio nasce **già abbinato**
    (`origine: microvoce`): non si risponde più uscendo dalla voce, andando in Comunicazioni e
    ritrovando la conversazione fra i messaggi di tutta la pratica.
    - **L'elenco si aggiorna da sé ogni 30 s**, come la chat della pratica: un messaggio che arriva
      da Telegram o dal portale compare nella voce **senza doverla chiudere e riaprire**. Prima si
      leggeva una volta sola all'apertura, e la cosa si notava nel modo peggiore — il messaggio
      c'era nella chat e non nella voce, e riaprire il modale lo faceva comparire.
    - Il canale predefinito è **quello dell'ultimo messaggio di quella voce** (se la voce è vuota:
      il **portale**, l'unico canale che non contatta nessuno). Resta un predefinito: appena
      l'operatore lo cambia, la sua scelta vince.
    - **Slegare non si fa da qui**, si fa dalla chat, dove si vede la conversazione intorno. Nella
      voce c'è solo il ritorno («Apri nella chat della pratica →»), che è a un clic.
    - **Il cliente vede una conversazione sola.** La voce è una lente dell'operatore, non un canale:
      il messaggio gli arriva sul canale scelto come tutti gli altri, e resta nel fascicolo abbinato
      a quella voce. Il compositore lo dice, perché dalla schermata non si vede.
  - **Un messaggio in *uscita* non eredita il contesto armato**: quello dice «questa conversazione
    parla di questa voce» dei messaggi che *arrivano*. Un messaggio scritto da dentro una voce nasce
    legato per un'altra via — il legame è **nato con lui**, non dedotto dalla chat (vedi «quattro
    origini» nella nota tecnica). L'«eredità» vera e propria (una **risposta** a un messaggio già
    abbinato) resta l'unica parte non cablata: dipende dal payload del provider e va verificata per
    canale.
- I canali si configurano in **Impostazioni** (§16).

### Posta dei clienti (l'accentratore delle mail)
La voce di menu **📬 Posta dei clienti** raccoglie in un elenco solo la posta che arriva nelle
**caselle dei clienti**: non solo quello che il cliente scrive allo studio, ma tutta la posta che lo
studio deve tenere d'occhio per lui (banca, fornitori, enti). Un cliente entra nella raccolta in uno
di due modi, e si sceglie **cliente per cliente**:
- **Inoltro.** Lo studio collega una sua **casella di raccolta**; per ogni cliente si attiva
  l'inoltro e BluMan gli assegna un **indirizzo personale** (la casella di raccolta con un codice dopo
  il «+», per esempio `posta+k7m2p9qa@studio.it`). Il cliente imposta nella sua casella l'inoltro
  automatico verso quell'indirizzo. Lo studio non conosce la password del cliente.
- **Casella collegata.** Il cliente dà allo studio le credenziali della sua casella (meglio una
  «password per le app») e BluMan la legge direttamente. Chi la collega deve **dichiarare che il
  cliente ha autorizzato per iscritto** lo studio a leggerla: la dichiarazione resta nel Log Audit
  con nome e data. La password si salva cifrata e non torna più a schermo.

BluMan le caselle **le legge e basta**: non segna i messaggi come letti, non li sposta, non li
cancella. Per il cliente la sua posta resta com'era.

- **Messaggi**: l'elenco si filtra (tutti, da smistare, attribuiti; per cliente; solo da leggere;
  archiviati) e si cerca per oggetto, testo e mittente. Aprendo un messaggio si vedono testo, allegati
  e **perché è sotto quel cliente**; da lì lo si **smista** a un cliente e a un suo progetto, lo si
  segna letto, lo si archivia. «Letto» e «archiviato» valgono dentro BluMan, non nella casella.
- **Raccolta**: parte da sola ogni pochi minuti e a mano con **↻ Raccogli ora**. Una casella che non
  risponde compare in cima alla pagina con il motivo.
- **Configurazione** (solo il responsabile dello studio): caselle collegate (prova, pausa, cambio
  password, scollega) e inoltro dei clienti (attiva, copia l'indirizzo, disattiva).
- **Chi la vede**: di default solo il responsabile dello studio. Ai collaboratori interni la apre la
  Matrice Permessi (voce «Posta dei clienti»: lettura, o lettura e smistamento). Ai collaboratori
  esterni non si apre in nessun caso.

## 📐 Calcoli & logica
- **Tutto il modulo è governato dalla Matrice Permessi** (`communications`, §17): l'admin decide chi
  può scrivere ai clienti e chi può soltanto **consultare**. Dal 09/10/2026 la matrice copre anche la
  **lettura** — casella in arrivo (`/comunicazioni/email-in-arrivo`, `/comunicazioni/poll-imap-allegati`,
  `/comunicazioni/signal-in-arrivo`) e fascicoli (`/progetti/:id/comunicazioni`,
  `/microvoci/:id/comunicazioni`). Prima erano mappate le sole rotte di invio: un collaboratore con
  `communications: denied` non poteva scrivere ma leggeva tutta la corrispondenza dei clienti. Ogni
  invio è **auditato**.
- **Relay fail-closed**: senza `EMAIL_RELAY_SECRET` l'endpoint di relay è **disattivato** (non un open
  relay); il segreto è condiviso fra backend (Railway) e la funzione serverless (Vercel).
- **Ingestione solo sul backend**: niente «ponte» su Vercel che scartava le intestazioni di autenticità
  (`x-telegram-bot-api-secret-token`, `x-hub-signature-256`) — si perdevano messaggi.
- **L'indirizzo che si copia in Meta e in Telegram è quello di *questo* backend.** La Callback URL di
  WhatsApp e l'endpoint di Telegram si compongono da `src/util/urlPubblica.ts`, che risolve
  `RAILWAY_PUBLIC_DOMAIN` → `APP_BASE_URL` → dominio di produzione. Un errore qui **non produce un
  errore**: produce un webhook che punta a un altro backend, con un altro database — e ce ne si accorge
  solo quando un cliente scrive e non riceve risposta.
- **Regola 7**: un invio fallito **non** lascia la riga «inviato»; il collegamento chat è unico per
  pratica (un secondo `/start` **sposta** il collegamento).

### Il contesto micro-voce: quando vale e quando no
Un **contesto** è la dichiarazione «in questa chat si sta parlando di questa micro-voce». Non si
indovina mai: o lo arma il cliente toccando il link della voce, o lo arma l'operatore. Tre regole lo
tengono onesto, e sono tutte necessarie:
- **Scade per inattività**: 24 ore senza messaggi abbinati. Un contesto di tre settimane fa non
  descrive più la conversazione, e continuerebbe ad abbinare **in silenzio** i messaggi sbagliati.
- **Ha un tetto assoluto**: 7 giorni dall'armamento, **anche se è attivo**. Il rinnovo misura
  l'attività, non la pertinenza: senza tetto, una chat che scrive tutti i giorni non scadrebbe mai.
- **Cade quando la chat lascia la pratica**, o si sposta su un'altra; e **non abbina un messaggio che
  è finito in un'altra pratica** (serve su Signal, dove la pratica si deduce dal messaggio, e sul
  portale, dove la chiave del contesto è il **cliente** e un cliente ha più pratiche).
- **Il link della micro-voce non sposta il collegamento**, lo arma soltanto: la chiave del
  collegamento è sulla chat, e una chat parla di tutte le voci della pratica — se la voce spostasse il
  collegamento, un cliente con due moduli lo farebbe saltellare a ogni messaggio.
- Ri-armare (il cliente che ritocca il link, l'operatore che risceglie la voce) è una decisione nuova:
  riporta l'armamento a ora e fa ripartire il tetto.

### Posta dei clienti: a chi si attribuisce un messaggio
Un messaggio raccolto si attribuisce da solo **solo quando c'è un solo cliente possibile**, e dice
sempre con quale criterio:
- **casella collegata** → il cliente a cui la casella appartiene;
- **inoltro** → il cliente il cui codice compare nell'indirizzo di consegna (dopo il «+»);
- se manca il codice: il cliente il cui indirizzo in anagrafica è **fra i destinatari**, poi quello
  che è il **mittente**. Se lo stesso indirizzo è di due clienti, non si sceglie.

Tutto il resto finisce in **Da smistare** e lo attribuisce un operatore. Il progetto non si deduce
mai: lo sceglie l'operatore, e scegliendo un progetto il messaggio va sotto il cliente di quel
progetto. Un'attribuzione fatta a mano si può cambiare o togliere, e resta marcata «a mano».

Alla **prima raccolta** di una casella BluMan prende i messaggi degli ultimi 30 giorni, o dal giorno
indicato collegandola. Poi prende solo i nuovi, al massimo 50 per casella a ogni giro: il resto
arriva al giro successivo. Di ogni messaggio salva fino a 20 allegati, ciascuno fino a 15 MB.

## 🔗 Collegamenti
- **Progetti** (§01): le comunicazioni stanno nel fascicolo del progetto.
- **Scadenzario** (§06): i solleciti escono da qui.
- **Impostazioni** (§16): credenziali SMTP/IMAP e configurazione canali.
- **Clienti** (§02): la posta raccolta si attribuisce ai clienti dell'anagrafica; l'indirizzo email del cliente serve a riconoscerlo.
- **Team & Permessi** (§17): la voce «Posta dei clienti» della matrice.

## ⚠️ Stati limite & errori
- Relay non configurato → invio email non parte (fail-closed).
- Bot Telegram con username errato / id numerico → messaggi guidati diversi per rimedi diversi.
- Chi non ha il permesso `communications=write` → invio bloccato; chi non ha nemmeno `read` non vede
  né la scheda del fascicolo né la linguetta «Messaggi» della micro-voce, e le rotte rispondono **403**
  anche se le chiama a mano.
- **Un messaggio abbinato non si perde mai**: togliere l'abbinamento toglie l'etichetta, non il
  messaggio dal fascicolo.
- **Il ruolo cliente non può abbinare a mano** (403): può solo *dichiarare* la voce toccando il link
  — e sul **portale**, dove un link non esiste, è l'operatore ad armare il contesto per lui. Non ha
  né il selettore né la vista dei moduli, **né può scrivere da dentro una voce**.
- **Da una voce si scrive solo se la voce esiste a database**: se la micro-voce non è mai stata
  salvata, il compositore non compare. Un compositore che scrivesse senza legare sarebbe peggio di
  nessun compositore — l'operatore crederebbe di aver risposto «dentro la voce» e non è vero.
- **Un messaggio scritto dalla voce resta nel fascicolo** anche se poi lo si slega: si toglie
  l'etichetta, non il messaggio.
- **Un messaggio non archiviabile non sparisce in silenzio.** Prima il webhook rispondeva «ok» al
  provider e usciva: Telegram e Meta, soddisfatti, non riprovavano, il fascicolo restava vuoto e
  nessuno sapeva che un messaggio era esistito. Ora l'avviso arriva in campanella, e se l'avviso
  stesso non parte la riga di idempotenza viene **rimossa** perché il provider ritenti — altrimenti
  al rinvio si troverebbe la riga già scritta e uscirebbe in silenzio, cioè lo stesso guasto per
  una porta più stretta.

- **Posta dei clienti — una casella che non risponde non è «nessun messaggio»**: password
  cambiata, server irraggiungibile, casella di un cliente tolto dall'anagrafica. Il motivo compare in
  cima alla pagina e nella Configurazione, con la data dell'ultima raccolta riuscita. Le altre caselle
  continuano a essere raccolte.
- **Posta dei clienti — un allegato non salvato si dichiara** (troppo grande, tipo rifiutato dal
  controllo dei file, archivio non raggiungibile): resta il nome con il motivo, senza un link vuoto.
  Il messaggio si salva comunque.
- **Posta dei clienti — la casella viene rinumerata dal fornitore** (migrazione, ripristino): BluMan
  rilegge gli ultimi 30 giorni e riconosce ciò che aveva già raccolto, dall'identificativo del
  messaggio o, se manca, da mittente, data e oggetto. Niente doppioni.
- **Posta dei clienti — il database cade mentre si salvano gli allegati**: il messaggio resta con gli
  allegati scritti fin lì e la casella mostra l'errore. La raccolta non lo supera: dopo un quarto
  d'ora lo riprende e aggiunge gli allegati che mancavano, poi prosegue con i messaggi successivi.
- **Posta dei clienti — il fornitore non consegna gli indirizzi con il «+»**: i messaggi arrivano lo
  stesso nella casella di raccolta e si attribuiscono dall'indirizzo del cliente in anagrafica; quelli
  che non si riconoscono restano in «Da smistare».
- **Posta dei clienti — scollegare una casella** ferma la raccolta e cancella la password salvata; i
  messaggi già raccolti restano. Disattivare l'inoltro di un cliente annulla il suo indirizzo
  personale: riattivandolo ne riceve uno nuovo e deve aggiornare l'inoltro nella sua casella.
- **Posta dei clienti — la raccolta gira dove la porta IMAP (993) è raggiungibile**: sul server dello
  studio sì; su un servizio che blocca le porte della posta la casella risulterà «non risponde».

## 🔧 Nota tecnica
- Servizi: `src/services/emailRelay.ts`, `imapInbound.ts`, `collegamentoChat.ts`,
  `comunicazioniMicrovoci.ts`; funzione Vercel `api/send-email.ts` (relay). Rotte: comunicazioni
  (`/comunicazioni/invia-*`), webhooks, `collegamentoChat.ts`, `progetti.ts`.
- Frontend: `components/ComunicazioniTab.tsx`, `components/ComposerComunicazione.tsx`,
  `hooks/useInvioComunicazione.ts`, `hooks/useCanaliStudio.ts`, `utils/recapitiCliente.ts`,
  `utils/origineAbbinamento.ts`, `components/settings/TabChannels.tsx`,
  `components/projectDetail/LinkTelegramProgetto.tsx`, `components/passaggio/TabMessaggi.tsx`,
  `components/passaggio/ComposerMicrovoce.tsx`.
- **L'indirizzo pubblico del backend**: `src/util/urlPubblica.ts` — `urlPubblicaBackend()`,
  `urlWebhookWhatsapp(slug)`, `urlWebhookTelegram()`, `slugValido()`. Fino al **01/10/2026** il modulo
  leggeva solo `RAILWAY_PUBLIC_DOMAIN`: sul VPS quella variabile **non esiste**, quindi i callback si
  componevano su `bluman-api-production.up.railway.app` — **un altro backend, con un altro database**.
  Ora la seconda sorgente è `APP_BASE_URL` (la convenzione del progetto per «dove vive questo
  deployment»), e il suo **schema si conserva**: sul VPS, prima del TLS, l'indirizzo è legittimamente
  `http://` e imporgli `https://` comporrebbe un callback che non risponde. Presidio:
  `src/urlPubblica.test.ts` (18 test).
- **I due payload del deep link** (`src/util/webhookSecurity.ts`): `<32hex>_<mac>` = pratica (forma
  storica, **invariata**: i link già spediti continuano a funzionare), `z<32hex>_<mac>` = micro-voce.
  Il prefisso `z` sta fuori dall'alfabeto esadecimale che apre i payload di pratica, quindi li
  distingue senza toccarli; il MAC usa un **dominio proprio**
  (`telegram-deeplink-microvoce`), così i due non sono interscambiabili. Telegram accetta al massimo
  **64 caratteri** in `?start=`: la pratica ne usa 55, la micro-voce 56 — un secondo UUID non ci
  starebbe, ed è per questo che il link della voce porta **solo** la voce (la pratica si risale da lì).
  Presidio: `src/collegamentoChat.test.ts`, `src/comunicazioniMicrovoci.test.ts`.
- **I quattro punti che consultano il contesto armato** — `abbinaAlContesto`, sempre **dentro la
  stessa transazione** che scrive il messaggio, così non esiste la finestra in cui il fascicolo ha il
  messaggio e ha perso il motivo per cui è lì: i webhook Telegram e WhatsApp (`src/routes/webhooks.ts`),
  l'ingestione Signal (`src/services/signalInbound.ts`) e la scrittura dal portale/operatore
  (`src/routes/progetti.ts`). Sugli ultimi due il `chatId` non arriva da un provider: su Signal è la
  conversazione dedotta dal messaggio, sul **portale è il cliente**. Presidio:
  `src/collegamentoChat.test.ts` (7 test sul solo portale: abbinamento, isolamento fra clienti e fra
  pratiche, scadenza, e il confine dell'uscita).
- **Le quattro origini di un abbinamento** (`comunicazione_microvoce.origine`): `contesto` (il cliente
  ha toccato il link della voce), `manuale` (l'operatore, a mano dalla chat), `microvoce` (il messaggio
  è **nato** scritto da dentro quella voce) ed `eredita` (una risposta a un messaggio già abbinato —
  **non ancora cablata**: dipende dal payload del provider e va verificata per canale prima di
  prometterla). Si mostra, perché un abbinamento automatico sbagliato si riconosce solo sapendo che
  era automatico — e **il colore lo dice**: azzurro il cliente, grigio una persona, indaco questa voce,
  ambra l'inferenza da controllare (`frontend/src/utils/origineAbbinamento.ts`, una tabella sola per
  entrambe le viste). **Regola di precedenza, decisa prima che l'eredità esista:** quando entrambe
  potrebbero valere, vince l'**eredità**, perché parla di *quel messaggio* invece che della *chat*.
  `microvoce` **non** è `manuale`, e non è un cavillo: la metrica con cui si deciderà la Fase 3 legge
  `manuale` come «il residuo che l'operatore ha dovuto sistemare a mano», e contarci un messaggio nato
  abbinato la falserebbe in su.
- **Il compositore è uno, i punti di montaggio due.** La consegna (upload → scrittura → dispatch →
  esito) sta in `frontend/src/hooks/useInvioComunicazione.ts`; il form in
  `components/ComposerComunicazione.tsx`, che è sola presentazione. Lo monta la chat
  (`ComunicazioniTab`) e la voce (`passaggio/ComposerMicrovoce.tsx`). **Due copie della consegna
  sarebbero due verità su una cosa sola** — è il guasto che `SpunteStato.tsx` racconta (sei messaggi
  rifiutati da Meta per mesi con le spunte blu disegnate, perché il ternario che le disegnava era
  stato copiato in due file). I recapiti dell'anagrafica si leggono in un posto solo,
  `frontend/src/utils/recapitiCliente.ts`: due letture darebbero due pareri sullo stesso cliente,
  col canale disponibile in una vista e non nell'altra.
- **Scrivere da dentro una voce è un atto dell'operatore** (`RUOLI_ABBINAMENTO` in
  `src/routes/progetti.ts`): il ruolo `cliente` — che usa la stessa rotta `POST /comunicazioni` dal
  portale — riceve **403** se prova a passare `microvoceProgettoId`. Può solo *dichiarare* la voce
  toccando il link. E la voce dev'essere di **questa** pratica e di **questo** studio
  (`microvoceDiProgetto`), o la rotta risponde 400 senza scrivere niente: senza il filtro, l'id di una
  voce basterebbe ad appendere un messaggio al fascicolo di un'altra pratica. Presidio:
  `src/comunicazioneDaMicrovoce.test.ts`.
- Schema: `ComunicazioneProgetto`, `CollegamentoChatProgetto`, `ComunicazioneMicrovoce`,
  `ContestoMicrovoceChat` (con `progetto_id` denormalizzato: rende il controllo «la voce armata è di
  *questa* pratica?» un confronto fra due campi).
- Fonti: `.agents/AGENTS.md`, `docs/storico/AUDIT_2026-09-27/06-comunicazioni-canali.md`, `GUIDA_CONFIGURAZIONE_CANALI.md`.
- **Posta dei clienti (accentratore).** Tabelle `casella_posta`, `messaggio_posta`,
  `allegato_posta` e `cliente.alias_posta` (migrazione `20261128130000_accentratore_posta`, con RLS).
  Lettura IMAP in `src/services/postaImap.ts` (`imapflow`, casella aperta `readOnly`, nessun flag
  scritto; il segnalibro è `uidValidity` + `ultimoUid` sulla riga della casella), giro in
  `postaRaccolta.ts`, attribuzione pura in `postaAttribuzione.ts`. Password cifrate con
  `src/util/cifraturaSegreti.ts` (AES-256-GCM, chiave derivata da `JWT_SECRET`, riapribile con
  `JWT_PREVIOUS_SECRETS` e ricifrata alla prima lettura dopo una rotazione). Rotte `/posta/*` in
  `src/routes/posta.ts` (chiave RBAC `posta`) e `postaConfigurazione.ts` (in più: solo
  advisor/super_admin). Raccolta automatica dal processo dell'API (`POSTA_RACCOLTA_MINUTI`, 5 se
  assente, 0 la spegne) o da `npm run cron:posta`. Frontend: `pages/PostaPage.tsx`,
  `components/posta/`. Presidi: `src/posta*.test.ts`, `src/cifraturaSegreti.test.ts`.
