# 🟢 BluMan — Guida Ufficiale Integrazione WhatsApp Business API & Meta MCP

Questa guida documenta in modo completo e definitivo l'architettura, i parametri ufficiali, le procedure di configurazione dei Webhook e le modalità operative per l'integrazione di **WhatsApp Business Cloud API** di Meta e del server **Remote MCP Meta DevTools** nella piattaforma **BluMan Advisory**.

---

## 🏛 1. Architettura dell'Integrazione

```
                                  ┌─────────────────────────────┐
                                  │        Meta Platform        │
                                  │  • WhatsApp Cloud API       │
                                  │  • Remote MCP DevTools      │
                                  └──────────────┬──────────────┘
                                                 │
                                 Webhook Events  │  Invio Messaggi
                                (Inbound Chat)   │  (Graph API v21.0)
                                                 ▼
               ┌─────────────────────────────────────────────────────────────────┐
               │                     BluMan Cloud Infrastructure                 │
               │                                                                 │
               │  ▲ Vercel Serverless Function                                   │
               │    /api/webhooks/communications/whatsapp.ts                     │
               │                                                                 │
               │  🚂 Railway Docker Container (Fastify Backend)                  │
               │    POST /webhooks/communications/whatsapp                       │
               │    POST /progetti/:id/comunicazioni                             │
               │                                                                 │
               │  🗄 Supabase PostgreSQL Database                                │
               │    • Match Automatico Numero Mittente (Anagrafica ERP)          │
               │    • Indicizzazione Live nel Vault Progetto                     │
               └─────────────────────────────────────────────────────────────────┘
```

---

## 🔑 2. Parametri Ufficiali di Produzione

| Parametro | Valore Ufficiale | Descrizione / Utilizzo |
| :--- | :--- | :--- |
| **Meta App ID** | `28073663662286834` | App ufficiale **`bluman`** su Meta Developers |
| **WhatsApp Phone Number ID** | `1318817114639409` | ID univoco del numero per l'invio messaggi |
| **WhatsApp Business Account ID** | `1397431142562576` | ID dell'account aziendale WABA |
| **Numero di Prova (Sandbox)** | `+1 (555) 663-5565` | Numero mittente di test certificato Meta |
| **Webhook Verify Token** | `bluman_wa_secure_token_2026` | Token segreto per handshake tra Meta e BluMan |
| **Tipo di Token** | `SYSTEM_USER (Permanente)` | Token con validità illimitata (`expires_at: 0`) |
| **Permessi Attivi (Scopes)** | `whatsapp_business_messaging`<br>`whatsapp_business_management`<br>`business_management` | Invio/ricezione chat, gestione risorse e webhook |
| **Remote MCP Endpoint** | `https://mcp.facebook.com/devtools` | Server MCP per connessione agenti AI |

---

## ⚙️ 3. Configurazione Webhook su Meta Developers

Per ricevere i messaggi inviati dai clienti su WhatsApp direttamente dentro BluMan:

1. Accedi al portale **[Meta for Developers](https://developers.facebook.com/apps/28073663662286834/whatsapp-business/wa-dev-console/)**.
2. Nel menu laterale, seleziona **WhatsApp ➔ Configurazione** (*Configuration*).
3. Nella sezione **Webhook**, clicca su **Modifica** (*Edit*):
   - **URL di callback**:
     ```text
     https://bluman.vercel.app/webhooks/communications/whatsapp
     ```
     *(oppure `https://bluman-api-production.up.railway.app/webhooks/communications/whatsapp`)*
   - **Verifica il token**:
     ```text
     bluman_wa_secure_token_2026
     ```
4. Clicca su **Verifica e salva** (*Verify and save*).
5. Sotto **Campi Webhook** (*Webhook fields*), clicca su **Gestisci** (*Manage*) e attiva la spunta su **`messages`**.

---

## 📲 4. Come Inviare Messaggi di Test (CURL & Script)

### A. Invio Template Standard Ufficiale (`hello_world`)
```bash
curl -i -X POST \
     "https://graph.facebook.com/v21.0/1318817114639409/messages" \
     -H "Authorization: Bearer <TUO_TOKEN_PERMANENTE>" \
     -H "Content-Type: application/json" \
     -d '{
       "messaging_product": "whatsapp",
       "to": "393335936278",
       "type": "template",
       "template": {
         "name": "hello_world",
         "language": {
           "code": "en_US"
         }
       }
     }'
```

### B. Invio Messaggio Testuale Diretto (Sessione 24h)
```bash
curl -i -X POST \
     "https://graph.facebook.com/v21.0/1318817114639409/messages" \
     -H "Authorization: Bearer <TUO_TOKEN_PERMANENTE>" \
     -H "Content-Type: application/json" \
     -d '{
       "messaging_product": "whatsapp",
       "recipient_type": "individual",
       "to": "393335936278",
       "type": "text",
       "text": {
         "preview_url": false,
         "body": "Gentile Cliente, la documentazione per l incarico BluMan è pronta per la consultazione."
       }
     }'
```

---

## 🤖 5. Configurazione Server Remote MCP in Antigravity

Nel file di configurazione globale `~/.gemini/config/mcp_config.json`:

```json
{
  "mcpServers": {
    "meta-devtools": {
      "serverUrl": "https://mcp.facebook.com/devtools",
      "headers": {
        "Authorization": "Bearer <TUO_TOKEN_PERMANENTE>"
      }
    }
  }
}
```

---

## 🔄 6. Flusso di Binding Automatico all'Anagrafica ERP

Quando un cliente risponde su WhatsApp:
1. Meta invia una notifica `POST` all'endpoint Webhook con il campo `from` (es. `393335936278`).
2. Il server Fastify normalizza il numero telefonico e cerca corrispondenze in **Supabase** nell'anagrafica `Cliente` (`telefono` o `referentiJson.cellulare` / `whatsapp`).
3. Il messaggio viene automaticamente salvato nella tabella `ComunicazioneProgetto` del progetto aperto del cliente.
4. L'Advisor visualizza la conversazione live nella scheda **💬 Comunicazioni & Ingestion** del progetto (`/projects/:id`).

---

## 🐙 7. Istruzioni per Aggiornamento su GitHub

Per sincronizzare tutti i file e avviare il deploy automatico su **Vercel** e **Railway**:

```bash
cd "/Volumes/Macintosh HD/Users/mariodibenedetto/Downloads/bluman-api"
git add .
git commit -m "docs(meta): guida ufficiale integrazione WhatsApp Cloud API, MCP e Webhooks"
git push
```
