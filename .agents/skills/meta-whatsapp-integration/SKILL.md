---
name: meta-whatsapp-integration
description: >-
  Guida operativa e runbook per l'integrazione di WhatsApp Business Cloud API di Meta,
  gestione del server Remote MCP Meta DevTools (https://mcp.facebook.com/devtools),
  configurazione dei Webhook e associazione automatica delle chat ai Clienti ERP e Progetti BluMan.
---

# 🟢 WhatsApp Business & Meta DevTools MCP — Integration Skill

Questa skill fornisce tutte le procedure, i flussi di autenticazione e le istruzioni operative per collegare la piattaforma **BluMan** alle API ufficiali **WhatsApp Business Cloud API** di Meta e gestire l'integrazione tramite il server **Remote MCP Meta DevTools**.

---

## 🏛 1. Architettura dell'Integrazione

```
┌─────────────────────────────────────────────────────────────┐
│                       Meta Platform                         │
│  ┌───────────────────────┐       ┌───────────────────────┐  │
│  │ Meta Remote MCP Server│       │ WhatsApp Cloud API    │  │
│  │ mcp.facebook.com/     │       │ graph.facebook.com/   │  │
│  │ devtools (OAuth)      │       │ v21.0/{phone_id}/msgs │  │
│  └──────────┬────────────┘       └───────────▲───────────┘  │
└─────────────┼────────────────────────────────┼──────────────┘
              │ Tool Discovery                 │ Invia/Ricevi
              │ & App Management               │ Messaggi
┌─────────────▼────────────────────────────────┴──────────────┐
│                    BluMan Advisory Studio                   │
│  ┌───────────────────────┐       ┌───────────────────────┐  │
│  │ Fastify Webhook API   │       │ Anagrafica Clienti ERP│  │
│  │ /webhooks/comm/wa     │──────►│ (Match Cellulare ➔    │  │
│  │                       │       │  Vault Progetto)      │  │
│  └───────────────────────┘       └───────────────────────┘  │
└─────────────────────────────────────────────────────────────┘
```

---

## 🛠 2. Modalità di Connessione

### Modalità A: Tramite Meta Remote MCP (`meta-devtools`)
L'endpoint ufficiale `https://mcp.facebook.com/devtools` consente all'agente di:
1. Ispezionare lo stato dell'App Meta e del prodotto WhatsApp.
2. Recuperare automaticamente i `Phone Number ID` e i numeri registrati.
3. Configurare e validare i Webhook senza interventi manuali.
4. Verificare lo stato di salute (*Health & Compliance*) dell'integrazione.

**Configurazione in `~/.gemini/config/mcp_config.json`:**
```json
{
  "mcpServers": {
    "meta-devtools": {
      "serverUrl": "https://mcp.facebook.com/devtools"
    }
  }
}
```

---

### Modalità B: Tramite WhatsApp Cloud API Diretta (Graph API)

1. **Endpoint Invio Messaggi:**
   `POST https://graph.facebook.com/v21.0/{PHONE_NUMBER_ID}/messages`
   - **Headers:**
     - `Authorization: Bearer {WHATSAPP_ACCESS_TOKEN}`
     - `Content-Type: application/json`
   - **Payload Invio Testuale:**
     ```json
     {
       "messaging_product": "whatsapp",
       "recipient_type": "individual",
       "to": "393351234567",
       "type": "text",
       "text": {
         "preview_url": false,
         "body": "Gentile Roberto, la notifica per il deposito marchio è stata registrata su BluMan."
       }
     }
     ```

2. **Endpoint Webhook Ricezione Messaggi:**
   `GET/POST https://api.tuostudio.com/webhooks/communications/whatsapp`
   - **GET (Verifica Handshake Meta):**
     - Parametri: `hub.mode=subscribe`, `hub.verify_token={VERIFY_TOKEN}`, `hub.challenge={CHALLENGE}`
     - Risposta: ritorno del solo valore `hub.challenge` con status 200.
   - **POST (Notifica Messaggio Entrante):**
     - Ricezione payload webhook con `entry[0].changes[0].value.messages[0]`.

---

## 🔄 3. Regole di Binding Automatico all'Anagrafica ERP

1. **Estrazione Numero Mittente:**
   - Quando Meta invia un messaggio entrante, il campo `from` (es. `393351234567`) viene normalizzato (rimozione prefissi, spazi, caratteri speciali).

2. **Scansione Anagrafica Clienti (`Cliente` / `referentiJson`):**
   - BluMan cerca corrispondenze nei campi: `cellulare`, `telefono`, `referentiJson.whatsapp`, `referentiJson.telefono`.

3. **Associazione al Progetto:**
   - Se il cliente ha un solo progetto attivo, il messaggio viene registrato direttamente in `ComunicazioneProgetto` con `direzione: 'entrata'` e `canale: 'whatsapp'`.
   - Se sono presenti allegati (documenti PDF, immagini, note vocali), l'API scarica il file dai server Meta e lo deposita in `./uploads/` indicizzandolo nel **Vault Documentale del Progetto**.

---

## ⚠️ 4. Risoluzione Errori Comuni (Troubleshooting)

| Codice Errore | Causa | Risoluzione |
|---|---|---|
| **190 (Invalid OAuth Token)** | Il token di accesso è scaduto (token temporaneo 24h). | Generare un *System User Permanent Access Token* in Meta Business Manager con validità illimitata. |
| **131030 (Recipient Not In Sandbox)** | L'account è in modalità Sandbox/Sviluppo e il numero destinatario non è stato verificato. | Aggiungere il numero del destinatario nella lista dei numeri di test in *API Setup*, oppure pubblicare l'App in modalità *Live*. |
| **100 (Missing Permissions)** | Il token non ha i permessi necessari. | Assicurarsi che il token abbia i permessi `whatsapp_business_messaging` e `whatsapp_business_management`. |
| **Webhook Verification Failed** | Il `Verify Token` inserito su Meta non corrisponde a quello del server. | Allineare il valore di `WA_VERIFY_TOKEN` sia nel `.env` del server che nel campo *Verify Token* della dashboard Meta. |

---

## 📋 5. Checklist di Validazione Finale

- [ ] Remote MCP `meta-devtools` attivo e autorizzato via OAuth.
- [ ] Parametri `WA_PHONE_ID` e `WA_ACCESS_TOKEN` memorizzati in sicurezza.
- [ ] Webhook URL `https://.../webhooks/communications/whatsapp` verificato con successo da Meta.
- [ ] Invio messaggio di test dal pannello *Impostazioni Studio* (`/settings` ➔ *Omnichannel*).
- [ ] Ricezione messaggio con binding verificato nell'Anagrafica Cliente e nel Progetto (`/projects/:id`).
