# 📖 BluMan — Guida Dettagliata Configurazione Canali Multicanale & Associazione Automatica Progetti

Questa guida fornisce le istruzioni passo-passo per configurare le credenziali API di ciascun canale (WhatsApp, Telegram, Email, Signal) e spiega le regole con cui BluMan **associa automaticamente ogni messaggio ed allegato al Progetto del Cliente**.

> **Dove vivono le credenziali (§35).** Ogni token, password e verify token si inserisce da
> **Impostazioni Studio → Canali** e finisce sulla riga Tenant del database, cifrata dal
> perimetro RLS: appartengono allo studio che le ha inserite, non all'installazione. Il
> browser non le vede mai — l'API le restituisce come stringa vuota accompagnata da un
> `<chiave>Impostata: true`, così l'interfaccia può dire «configurata» senza conoscere il
> valore. L'invio non parte dal browser: passa da `POST /comunicazioni/invia-email`,
> `POST /comunicazioni/invia-whatsapp` e `POST /comunicazioni/email-in-arrivo`, tutte
> autenticate. **Nessun valore reale va scritto in questo file o in qualunque altro file
> versionato**, nemmeno come esempio: gli esempi qui sotto sono forme, non segreti.

---

## 🟢 1. WhatsApp Business API (Official Meta Cloud API)

### A. Ottenere le Credenziali da Meta Developers
1. Vai su [developers.facebook.com](https://developers.facebook.com) ed accedi con il tuo account Facebook Aziendale.
2. Clicca su **My Apps** → **Create App** → Seleziona il tipo **Other** → **Business**.
3. Nell'elenco prodotti, seleziona **WhatsApp** e clicca su **Set Up**.
4. Nella scheda **API Setup**, copia il **WhatsApp Phone Number ID** (una quindicina di cifre).
5. Genera un **System User Permanent Access Token** con i permessi `whatsapp_business_messaging` e `whatsapp_business_management`.
6. Incolla Phone Number ID e Access Token in **BluMan → Impostazioni Studio → Canali**. Non
   passano da un file `.env` né da un file di questo repository: da lì servirebbero un solo
   numero mittente per tutti gli studi.

### B. Configurare il Webhook di Ricezione Messaggi
1. Nella dashboard WhatsApp di Meta Developers, vai su **Configuration** → **Webhook**.
2. Imposta l'**URL Callback**, che porta lo **slug dello studio**:
   `https://<dominio-del-backend>/webhooks/communications/whatsapp/<slug>`. Non inventarlo:
   **Impostazioni Studio → Canali** lo mostra già composto, perché non è un dato dello studio ma una
   conseguenza del suo slug e dell'indirizzo del backend.
   - Il dominio è quello di **Railway** (`RAILWAY_PUBLIC_DOMAIN`), non quello del sito: l'ingestione
     termina sul backend Fastify, ed è lì che si verifica la firma. Fino al 16/09/2026 esisteva anche
     un ponte su Vercel (`api/webhooks/communications/whatsapp.ts`), ed è stato rimosso — inoltrava a
     Railway **scartando `x-hub-signature-256`**, cioè l'unica intestazione che prova l'autenticità
     dell'evento, e rispondeva `200` a Meta anche quando l'inoltro falliva.
3. Genera un **Verify Token** casuale e incollalo in **due punti**: qui su Meta e nel campo
   *Webhook Verify Token* di **Impostazioni Studio → Canali**. Per generarlo:
   ```bash
   node -e "console.log(require('crypto').randomBytes(24).toString('base64url'))"
   ```
   > **Il token è dello studio, e da qui viene.** L'handshake risolve lo studio dallo slug nel path e
   > confronta con il **suo** `wa_verify_token`; uno studio che non ne ha uno non può essere
   > sottoscritto da nessuno (risponde 503). Serve perché Meta configura il verify token per
   > **applicazione**, non per numero: non esiste un token di piattaforma con cui rispondere a un
   > handshake che non nomina lo studio. Fino al 16/09/2026 era il contrario — l'handshake
   > confrontava la variabile d'ambiente `WA_VERIFY_TOKEN`, e il campo in Impostazioni veniva
   > salvato senza essere mai letto.
   > La variabile d'ambiente **c'è ancora, ma non è più l'handshake a leggerla**: la usa il solo
   > `prisma/seed.ts` per **popolare** `wa_verify_token` di uno studio già esistente. Il valore che
   > conta è quello in Impostazioni → Canali (che il browser non vede mai: torna come stringa vuota
   > più `waVerifyTokenImpostata: true`).
4. Spunta gli eventi: `messages`.
   > ⚠️ Lo slug dello studio si può **ruotare** (`POST /tenant/whatsapp-slug`, con `conferma: true`),
   > ma ruotarlo **smette di ricevere** i messaggi WhatsApp finché la Callback URL non viene
   > aggiornata su Meta. È una rotazione da fare con la dashboard aperta, non da premere per curiosità.

### C. Associazione Automatica al Progetto Cliente
- Quando il cliente scrive dal suo cellulare (es. `+39 335 1234567`), BluMan cerca il numero nell'anagrafica **Clienti ERP**.
- Se il numero è registrato nell'anagrafica di un Cliente, il messaggio e tutti i file inviati (PDF, foto, note audio) confluiscono **istantaneamente nella scheda "💬 Comunicazioni" del Progetto attivo**!

---

## ✈️ 2. Telegram Bot API (100% Gratuito)

### A. Creare il Bot dello Studio con @BotFather
1. Apri Telegram e cerca l'utente ufficiale **`@BotFather`**.
2. Invia il comando `/newbot` e segui le istruzioni per impostare il nome (es: `BluMan Advisory Bot`) e lo username, che è quello che BotFather assegna nella forma `@qualcosa_bot` (es: `@StudioDiProvaBot`).
3. Copia l'**HTTP API Access Token** fornito da BotFather: ha la forma `<id numerico>:<stringa
   casuale>`. È un segreto — si incolla solo nel campo di BluMan, mai in un file del repository.
   > **Lo `<id numerico>` in testa al token non è il destinatario dei messaggi, e non è lo
   > username.** È l'identificativo interno del bot. Nella prima metà del token si legge senza
   > chiedere niente a Telegram, e in **Impostazioni Studio → Canali** compare due volte: come
   > destinatario di una chat (sbagliato: un bot non può scrivere a se stesso, e Telegram risponde
   > «the bot can't send messages to the bot») e nel campo *Bot Username* (sbagliato due volte:
   > `t.me/<numero>` apre «questo utente non esiste»). Se ti serve sapere qual è, il campo non
   > serve: lo cambia la registrazione del webhook, che lo rilegge da Telegram.

### B. Registrazione Automatica Webhook
1. Vai in BluMan in `Impostazioni` → `💬 Integratore Canali Omnichannel`.
2. Incolla il **Token** del Bot e clicca su **Salva Credenziali**.
3. Premi il pulsante del webhook — si chiama **🔗 Registra Webhook** finché nessun webhook è
   registrato, poi **🔄 Aggiorna Webhook**: è lo stesso pulsante, cambia solo l'etichetta. BluMan
   esegue l'handshake con le API di Telegram, registra il webhook sul dominio del backend e
   **rilegge lo username con `getMe`**, salvandolo nel campo *Bot Username*. Non serve compilarlo a
   mano.
   - Se il campo conteneva un valore diverso da quello vero, la registrazione lo **corregge** e la
     pagina te lo dice: è il caso dell'id numerico copiato al posto dello username, che componeva un
     link che apriva «questo utente non esiste» sul telefono del cliente (capitato il 17/09/2026).
     Telegram è la fonte, il campo è la sua copia: un valore scritto a mano che Telegram contraddice
     viene riallineato, non rispettato.
   - Il campo *Bot Username* è un'alternativa manuale, e serve solo se il pulsante non è utilizzabile.
     Il valore giusto è quello nella forma `@qualcosa_bot`: **5-32 caratteri fra lettere, cifre e
     `_`**, e non di sole cifre.

### C. Associazione Automatica al Progetto
BluMan associa i messaggi in ingresso al progetto in **tre** modi, dal più esplicito al più
dedotto. Il primo è quello che funziona sempre; gli altri due sono ripieghi, e hanno dei limiti
che conviene conoscere.

1. **Il link della pratica — il cliente dice lui a quale pratica si riferisce.** Nella testata di
   una pratica, il menu **`🔗 Link Telegram ▾`** copia un indirizzo del tipo
   `t.me/<Bot>?start=<codice firmato>`, oppure lo spedisce al cliente via **email** o **WhatsApp**.
   Chi apre quel link e preme *Avvio* aggancia la propria chat a **quella** pratica, e da quel
   momento i suoi messaggi entrano in quel fascicolo senza che debba indicare niente.
   - È l'unico metodo che regge i due casi in cui gli altri due si arrendono: un cliente con **due
     pratiche aperte**, e una persona che scrive **per due clienti diversi**.
   - L'invito spedito rientra nel fascicolo come comunicazione in uscita: chi apre la pratica domani
     vede che quel link è stato mandato, a chi e quando.
   - Le chat collegate sono elencate sotto lo stesso menu, con **scollega**. Il link resta valido
     dopo lo scollegamento (chi si è scollegato per sbaglio rientra da solo toccandolo di nuovo).
   - Su WhatsApp il testo libero parte solo entro **24 ore** dall'ultimo messaggio del cliente: fuori
     da quella finestra Meta rifiuta, e BluMan riporta il rifiuto invece di dire «inviato». Per
     email non c'è questo limite, e il link resta comunque copiabile a mano.
2. **L'Handle Telegram in anagrafica** (es: `@RobertoRossi`), se il cliente è uno solo con quel
   contatto e ha **un solo** progetto aperto.
3. **Il codice dell'incarico nel primo messaggio** (es: `[INC-2026-089]`).

Quando nessuno dei tre si applica — nessun link toccato, mittente non attribuibile o progetto non
univoco — il messaggio **non viene archiviato in un fascicolo a caso**: lo studio riceve l'avviso
«Messaggio Telegram non archiviato», e da lì la via d'uscita è mandare al cliente il link della
pratica giusta.

---

## ✉️ 3. Email Inbound Webhook Parse (SendGrid / SMTP / PEC)

### A. Configurazione Inbound Parse
1. Nel tuo pannello DNS o SendGrid, imposta il dominio di ricezione (es. `inbound.tuostudio.com`).
2. Configura l'URL di destinazione Inbound Parse Webhook:
   `https://api.tuostudio.com/webhooks/communications/email`

### B. Associazione Automatica
- Tutte le email ricevute da `client@holdingbeta.advisory` vengono intercettate.
- Se l'oggetto contiene il tag `[INC-2026-089]`, l'email viene assegnata a quell'incarico specifico. Se non è specificato il tag, viene associata al progetto attivo con valore più alto del cliente.

### C. Casella dello studio: invio e lettura (§35)
Host, porta, utente e password di SMTP e IMAP si inseriscono in **Impostazioni Studio → Canali**
e stanno sulla riga Tenant. Il percorso dell'invio ha una particolarità che conviene conoscere
prima di diagnosticare un guasto: la rete in uscita di Railway non lascia passare le porte SMTP
(465, 587 e 25 finiscono in `ETIMEDOUT`), quindi il messaggio già composto dal backend viene
affidato alla funzione `POST /api/send-email` su Vercel, che gira su un'altra rete. L'SMTP
diretto resta come ripiego per gli ambienti in cui funziona.

Quella funzione **non è un endpoint per il browser**: accetta solo chiamate che presentano
l'header `x-bluman-relay` uguale a `EMAIL_RELAY_SECRET`, un segreto da impostare con lo stesso
valore su Railway e su Vercel. Senza quell'header risponde 401. Prima esisteva senza segreto,
con `Access-Control-Allow-Origin: *` e con ripiego sulle variabili d'ambiente: chiunque
conoscesse l'URL poteva spedire email a nome dello studio.

Il test della casella si fa da BluMan (`POST /tenant/test-imap` per la posta in arrivo), non
con curl verso la funzione.

---

## 🔒 4. Signal End-to-End Encrypted (Clienti VIP)

### A. Setup Daemon REST API
1. Avvia il container Docker ufficiale Signal Daemon sul server dello studio:
   `docker run -p 8080:8080 -v ~/.local/share/signal-cli:/home/cli/.local/share/signal-cli bbernhard/signal-cli-rest-api`
2. Collega il numero di telefono aziendale di Signal dello studio.

### B. Associazione Automatica
- I messaggi cifrati vengono associati in base al numero di cellulare Signal verificato del cliente.
