# 📖 BluMan — Guida Dettagliata Configurazione Canali Multicanale & Associazione Automatica Progetti

Questa guida fornisce le istruzioni passo-passo per configurare le credenziali API di ciascun canale (WhatsApp, Telegram, Email, Signal) e spiega le regole con cui BluMan **associa automaticamente ogni messaggio ed allegato al Progetto del Cliente**.

---

## 🟢 1. WhatsApp Business API (Official Meta Cloud API)

### A. Ottenere le Credenziali da Meta Developers
1. Vai su [developers.facebook.com](https://developers.facebook.com) ed accedi con il tuo account Facebook Aziendale.
2. Clicca su **My Apps** → **Create App** → Seleziona il tipo **Other** → **Business**.
3. Nell'elenco prodotti, seleziona **WhatsApp** e clicca su **Set Up**.
4. Nella scheda **API Setup**, copia il **WhatsApp Phone Number ID** (es. `102938475610293`).
5. Genera un **System User Permanent Access Token** con i permessi `whatsapp_business_messaging` e `whatsapp_business_management`.

### B. Configurare il Webhook di Ricezione Messaggi
1. Nella dashboard WhatsApp di Meta Developers, vai su **Configuration** → **Webhook**.
2. Imposta l'**URL Callback**: `https://api.tuostudio.com/webhooks/communications/whatsapp`.
3. Inserisci il tuo **Verify Token** (definito nelle Impostazioni BluMan, es: `bluman_wa_secure_token_2026`).
4. Spunta gli eventi: `messages`.

### C. Associazione Automatica al Progetto Cliente
- Quando il cliente scrive dal suo cellulare (es. `+39 335 1234567`), BluMan cerca il numero nell'anagrafica **Clienti ERP**.
- Se il numero è registrato nell'anagrafica di un Cliente, il messaggio e tutti i file inviati (PDF, foto, note audio) confluiscono **istantaneamente nella scheda "💬 Comunicazioni" del Progetto attivo**!

---

## ✈️ 2. Telegram Bot API (100% Gratuito)

### A. Creare il Bot dello Studio con @BotFather
1. Apri Telegram e cerca l'utente ufficiale **`@BotFather`**.
2. Invia il comando `/newbot` e segui le istruzioni per impostare il nome (es: `BluMan Advisory Bot`) e lo username (es: `@BluManStudioBot`).
3. Copia l'**HTTP API Access Token** fornito da BotFather (es: `7182930412:AAHj39201982736192`).

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

---

## 🔒 4. Signal End-to-End Encrypted (Clienti VIP)

### A. Setup Daemon REST API
1. Avvia il container Docker ufficiale Signal Daemon sul server dello studio:
   `docker run -p 8080:8080 -v ~/.local/share/signal-cli:/home/cli/.local/share/signal-cli bbernhard/signal-cli-rest-api`
2. Collega il numero di telefono aziendale di Signal dello studio.

### B. Associazione Automatica
- I messaggi cifrati vengono associati in base al numero di cellulare Signal verificato del cliente.
