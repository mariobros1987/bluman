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
2. Imposta l'**URL Callback**: `https://api.tuostudio.com/webhooks/communications/whatsapp`.
3. Genera un **Verify Token** casuale e incolla lo stesso valore in due punti: qui su Meta e
   nella variabile d'ambiente `WA_VERIFY_TOKEN` del backend (su Railway). È un segreto: non va
   scritto in un file versionato, e se ci è finito una volta va rigenerato. Per generarlo:
   ```bash
   node -e "console.log(require('crypto').randomBytes(24).toString('base64url'))"
   ```
   > Il campo *Webhook Verify Token* che vedi in **Impostazioni Studio → Canali** oggi viene
   > salvato ma **non** viene letto dall'handshake: quello confronta con `WA_VERIFY_TOKEN`.
   > La divergenza è annotata in `GUIDA_META_WHATSAPP_INTEGRAZIONE.md` §2 e attende una
   > decisione; fino ad allora è la variabile d'ambiente a contare.
4. Spunta gli eventi: `messages`.

### C. Associazione Automatica al Progetto Cliente
- Quando il cliente scrive dal suo cellulare (es. `+39 335 1234567`), BluMan cerca il numero nell'anagrafica **Clienti ERP**.
- Se il numero è registrato nell'anagrafica di un Cliente, il messaggio e tutti i file inviati (PDF, foto, note audio) confluiscono **istantaneamente nella scheda "💬 Comunicazioni" del Progetto attivo**!

---

## ✈️ 2. Telegram Bot API (100% Gratuito)

### A. Creare il Bot dello Studio con @BotFather
1. Apri Telegram e cerca l'utente ufficiale **`@BotFather`**.
2. Invia il comando `/newbot` e segui le istruzioni per impostare il nome (es: `BluMan Advisory Bot`) e lo username (es: `@BluManStudioBot`).
3. Copia l'**HTTP API Access Token** fornito da BotFather: ha la forma `<id numerico>:<stringa
   casuale>`. È un segreto — si incolla solo nel campo di BluMan, mai in un file del repository.

### B. Registrazione Automatica Webhook
1. Vai in BluMan in `Impostazioni` → `💬 Integratore Canali Omnichannel`.
2. Incolla lo username ed il Token del Bot e clicca su **Salva Credenziali**.
3. BluMan registrerà automaticamente il Webhook eseguendo l'handshake con le API di Telegram.

### C. Associazione Automatica al Progetto
- Il cliente viene identificato tramite l'**Handle Telegram** registrato in anagrafica (es: `@RobertoRossi`) oppure inserendo il codice dell'incarico nel primo messaggio (es: `[INC-2026-089]`).

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
