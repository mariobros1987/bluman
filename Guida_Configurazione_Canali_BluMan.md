# 📖 BluMan — Guida Dettagliata Configurazione Canali Multicanale & Associazione Automatica Progetti

Questa guida fornisce le istruzioni passo-passo per configurare le credenziali API di ciascun canale (WhatsApp, Telegram, Email, Signal) e spiega le regole con cui BluMan **associa automaticamente ogni messaggio ed allegato al Progetto del Cliente**.

---

## 🟢 1. WhatsApp Business API (Official Meta Cloud API)

### A. Ottenere le Credenziali da Meta Developers
1. Vai su developers.facebook.com ed accedi con il tuo account Facebook Aziendale.
2. Clicca su My Apps → Create App → Seleziona il tipo Other → Business.
3. Nell'elenco prodotti, seleziona WhatsApp e clicca su Set Up.
4. Nella scheda API Setup, copia il WhatsApp Phone Number ID (es. 102938475610293).
5. Genera un System User Permanent Access Token con i permessi whatsapp_business_messaging e whatsapp_business_management.

### B. Configurare il Webhook di Ricezione Messaggi
1. Nella dashboard WhatsApp di Meta Developers, vai su Configuration → Webhook.
2. Imposta l'URL Callback: https://api.tuostudio.com/webhooks/communications/whatsapp
3. Inserisci il tuo Verify Token (definito nelle Impostazioni BluMan, es: bluman_wa_secure_token_2026).
4. Spunta gli eventi: messages.

### C. Associazione Automatica al Progetto Cliente
- Quando il cliente scrive dal suo cellulare (es. +39 335 1234567), BluMan cerca il numero nell'anagrafica Clienti ERP.
- Se il numero è registrato nell'anagrafica di un Cliente, il messaggio e tutti i file inviati (PDF, foto, note audio) confluiscono istantaneamente nella scheda "💬 Comunicazioni" del Progetto attivo!

---

## ✈️ 2. Telegram Bot API (100% Gratuito)

### A. Creare il Bot dello Studio con @BotFather
1. Apri Telegram e cerca l'utente ufficiale @BotFather.
2. Invia il comando /newbot e segui le istruzioni per impostare il nome ed il token.

---

## ✉️ 3. Email Inbound Webhook Parse (SendGrid / SMTP / PEC)
1. Imposta l'URL Callback: https://api.tuostudio.com/webhooks/communications/email
2. Le email inviate da client@holdingbeta.advisory vengono associate all'incarico attivo.
