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
               │  ▲ Vercel Serverless Function (solo INGRESSO)                   │
               │    /api/webhooks/communications/whatsapp.ts                     │
               │                                                                 │
               │  🚂 Railway Docker Container (Fastify Backend)                  │
               │    POST /webhooks/communications/whatsapp   (ingresso)          │
               │    POST /comunicazioni/invia-whatsapp       (uscita, §35)       │
               │    POST /progetti/:id/comunicazioni         (riga in archivio)  │
               │                                                                 │
               │  🗄 Supabase PostgreSQL Database                                │
               │    • Credenziali del canale sulla riga Tenant (waPhoneId,       │
               │      waAccessToken) — mai nel browser                           │
               │      Verify token del webhook: variabile WA_VERIFY_TOKEN (§2)   │
               │    • Match Automatico Numero Mittente (Anagrafica ERP)          │
               │    • Indicizzazione Live nel Vault Progetto                     │
               └─────────────────────────────────────────────────────────────────┘
```

> **§35 — l'uscita passa dal backend.** Fino ad agosto 2026 il browser spediva i messaggi
> da sé, chiamando una funzione serverless `api/send-whatsapp.ts` senza autenticazione e con
> `Access-Control-Allow-Origin: *`, che ricadeva sulle variabili d'ambiente: un solo numero
> mittente per tutti gli studi, e chiunque conoscesse l'URL poteva spedire. Quella funzione
> non esiste più. L'unica strada in uscita è `POST /comunicazioni/invia-whatsapp`, che
> richiede un JWT valido e legge Phone ID e access token dalla riga Tenant di chi chiede.
> Non c'è nessun ripiego automatico su `hello_world`: fuori dalla finestra di 24 ore Meta
> risponde 131047 e l'interfaccia riporta quel motivo, invece di consegnare «Hello World» al
> cliente e annunciare un successo all'operatore.


---

## 🔑 2. Parametri Ufficiali di Produzione

Gli identificativi qui sotto non sono segreti: si leggono dalla console Meta e servono per
riconoscere le risorse giuste. **I segreti non stanno in questa tabella e non stanno in nessun
file del repository** (regola 6): access token, verify token e password vivono sulla riga
Tenant del database e si inseriscono da **Impostazioni Studio → Canali**.

| Parametro | Valore Ufficiale | Descrizione / Utilizzo |
| :--- | :--- | :--- |
| **Meta App ID** | `28073663662286834` | App ufficiale **`bluman`** su Meta Developers |
| **WhatsApp Phone Number ID** | `1318817114639409` | ID univoco del numero per l'invio messaggi |
| **WhatsApp Business Account ID** | `1397431142562576` | ID dell'account aziendale WABA |
| **Numero di Prova (Sandbox)** | `+1 (555) 663-5565` | Numero mittente di test certificato Meta |
| **Webhook Verify Token** | *(variabile `WA_VERIFY_TOKEN` su Railway)* | Lo si genera a caso e si incolla in due posti: la variabile d'ambiente del backend e la console Meta. Non si scrive qui. |
| **Access Token** | *(campo `waAccessToken` sulla riga Tenant)* | Token `SYSTEM_USER` permanente (`expires_at: 0`), per studio |
| **Tipo di Token** | `SYSTEM_USER (Permanente)` | Token con validità illimitata (`expires_at: 0`) |
| **Permessi Attivi (Scopes)** | `whatsapp_business_messaging`<br>`whatsapp_business_management`<br>`business_management` | Invio/ricezione chat, gestione risorse e webhook |
| **Remote MCP Endpoint** | `https://mcp.facebook.com/devtools` | Server MCP per connessione agenti AI |

> Il verify token va **rigenerato su Meta** se è mai comparso in un file versionato: la
> cronologia di git non si dimentica, e chi legge il repository può superare l'handshake del
> webhook al posto nostro.

> **Attenzione, divergenza da sanare.** Il verify token è l'unica credenziale del canale che
> **non** viene letta dalla riga Tenant: `src/routes/webhooks.ts:37` confronta ciò che Meta
> manda con la variabile d'ambiente `WA_VERIFY_TOKEN`, perché l'handshake è una GET pubblica,
> senza JWT e quindi senza contesto tenant, e risolvere lo studio richiederebbe una lettura
> che scavalca RLS (vietata fuori da script e bootstrap, regola 1). Nel frattempo
> **Impostazioni Studio → Canali** mostra un campo *Webhook Verify Token* che viene salvato ma
> non usato da nessuno: chi lo compila crede di aver configurato l'handshake e non l'ha fatto.
> Le due strade sono: togliere il campo dall'interfaccia, oppure dare a ogni studio il proprio
> URL di callback così che il tenant sia deducibile dal path. Serve una decisione del titolare.

Un token nuovo si genera così, e il valore va incollato solo nei due punti (variabile su
Railway e campo su Meta):

```bash
node -e "console.log(require('crypto').randomBytes(24).toString('base64url'))"
```

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
   - **Verifica il token**: lo stesso valore impostato in `WA_VERIFY_TOKEN` su Railway. Se la
     variabile non c'è, l'handshake risponde `503 WA_VERIFY_TOKEN non configurato` — è voluto:
     meglio un webhook da riconfigurare di uno che accetta chiunque conosca una stringa
     pubblicata.
4. Clicca su **Verifica e salva** (*Verify and save*).
5. Sotto **Campi Webhook** (*Webhook fields*), clicca su **Gestisci** (*Manage*) e attiva la spunta su **`messages`**.

Presidio dell'handshake: `src/services/communications.test.ts` — token giusto → 200 con la
challenge, token sbagliato → 403, variabile assente → 503.

---

## 📲 4. Come Inviare Messaggi di Test (CURL & Script)

I due `curl` qui sotto parlano **direttamente con Meta** e servono a una cosa sola: capire se
il numero, il token e il template sono a posto, escludendo BluMan dall'equazione. Non sono la
strada applicativa: l'applicazione spedisce con `POST /comunicazioni/invia-whatsapp` (§4-bis),
che è autenticata e usa le credenziali dello studio che chiede.

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

## 📤 4-bis. La strada applicativa: `POST /comunicazioni/invia-whatsapp`

Questa è l'unica rotta che l'interfaccia usa per spedire. Richiede un JWT valido, legge
`waPhoneId` e `waAccessToken` dalla riga Tenant di chi chiama, e non ricade su nessuna
variabile d'ambiente: se il canale non è configurato risponde 400 con «canale WhatsApp non
configurato», non con un finto successo.

```bash
curl -i -X POST \
     "https://bluman-api-production.up.railway.app/comunicazioni/invia-whatsapp" \
     -H "Authorization: Bearer <JWT_DELL_OPERATORE>" \
     -H "Content-Type: application/json" \
     -d '{
       "numero": "+39 333 593 6278",
       "testo": "Gentile Cliente, la documentazione per l'\''incarico è pronta."
     }'
```

Cosa può rispondere, e perché conviene leggerlo:

| Esito | Significato |
| :--- | :--- |
| `200 { ok: true, messageId }` | Meta ha accettato il messaggio. |
| `400 /non è configurato/` | La riga Tenant non ha Phone ID o access token: si compilano in **Impostazioni Studio → Canali**. |
| `400 /numero/`, `400 /8 cifre/` | Il numero destinatario è assente o troppo corto per essere un numero. |
| `400` con motivo `131047` | Fuori dalla finestra di 24 ore: Meta accetta solo template approvati. Il messaggio **non** viene sostituito da `hello_world`. |
| `401` | Nessun JWT: la rotta non è pubblica. |

Presidio: `src/comunicazioniCanali.test.ts` (16 test) verifica il 400 a canale non
configurato, i 400 di validazione del numero e il 401 senza token.

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
