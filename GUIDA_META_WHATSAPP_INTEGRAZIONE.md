# 🟢 BluMan — Guida Ufficiale Integrazione WhatsApp Business API & Meta MCP

Questa guida documenta in modo completo e definitivo l'architettura, **dove stanno** i parametri del canale, le procedure di configurazione dei Webhook e le modalità operative per l'integrazione di **WhatsApp Business Cloud API** di Meta e del server **Remote MCP Meta DevTools** nella piattaforma **BluMan Advisory**.

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
               │  🚂 Railway Docker Container (Fastify Backend) — unico ingresso     │
               │    GET  /webhooks/communications/whatsapp/<slug>  (handshake Meta)  │
               │    POST /webhooks/communications/whatsapp/<slug>  (ingresso)        │
               │    POST /comunicazioni/invia-whatsapp       (uscita, §35)       │
               │    POST /progetti/:id/comunicazioni         (riga in archivio)  │
               │                                                                 │
               │  🗄 Supabase PostgreSQL Database                                │
               │    • Credenziali del canale sulla riga Tenant (waPhoneId,       │
               │      waAccessToken) — mai nel browser                           │
               │      Verify token dell'handshake: colonna `wa_verify_token`     │
               │      dello studio, risolto dallo slug nel path (§2)             │
               │    • Match Automatico Numero Mittente (Anagrafica ERP)          │
               │    • Indicizzazione Live nel Vault Progetto                     │
               └─────────────────────────────────────────────────────────────────┘
```

> **Il ponte su Vercel non esiste più (16/09/2026).** In alto in questo schema c'era una Vercel
> Serverless Function (`api/webhooks/communications/whatsapp.ts`) che inoltrava a Railway gli eventi
> di Meta. È stata rimossa, e con lei il `rewrite` in `vercel.json`: inoltrava **scartando
> `x-hub-signature-256`**, cioè l'unica intestazione che prova che l'evento viene davvero da Meta, e
> rispondeva `200` a Meta anche quando l'inoltro falliva — quindi Meta non ritentava mai e i
> messaggi si perdevano in silenzio. Va detto chiaramente perché non è una preferenza di stile:
> **l'ingestione deve terminare sul backend**, dove la firma si può verificare.

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

## 🔑 2. I parametri del canale — dove stanno i valori

Gli identificativi qui sotto **appartengono allo studio, non alla piattaforma**: ogni studio ha
la sua app Meta, il suo numero e il suo webhook. Si leggono dalla console Meta del suo titolare e
si inseriscono da **Impostazioni Studio → Canali**; qui restano come **segnaposto**, non come
valori, perché un valore vero in un documento invecchia — e quello che questo file riportava fino
al 18/09/2026 era già vecchio: era di un'app **rifatta**, e la WABA che nominava non esiste più
(`GraphMethodException`, subcode 33). **I segreti non stanno in questa tabella e non stanno in
nessun file del repository** (regola 6): access token, verify token e App Secret vivono sulla riga
Tenant del database.

| Parametro | Dove sta il valore | Descrizione / Utilizzo |
| :--- | :--- | :--- |
| **Meta App ID** | `<APP_ID>` — colonna `wa_app_id` | L'app dello studio su Meta Developers |
| **WhatsApp Phone Number ID** | `<PHONE_NUMBER_ID>` — colonna `wa_phone_id` | ID univoco del numero che spedisce |
| **WhatsApp Business Account ID** | `<WABA_ID>` — solo console Meta | WABA dell'app. **Non c'è una colonna**: il backend non ne ha mai avuto bisogno, quindi non si inventa un posto dove metterla |
| **Numero di Prova (Sandbox)** | `<NUMERO_DI_PROVA>` — console Meta | Il numero che Meta assegna alla app di prova per spedire senza un numero approvato. **Attenzione a non usarlo come recapito dello studio**: al 18/09/2026 la riga `tenant` di Bluecode ha in `telefono` un numero di prova Meta (`verified_name: "Test Number"`, `code_verification_status: NOT_VERIFIED`), e ogni documento che stampa il recapito dello studio stampa un numero che non squilla — vedi `PIANO_DI_MIGLIORAMENTO.md` voce 14 |
| **App Secret** | *(colonna `wa_app_secret` sulla riga Tenant)* | Verifica `X-Hub-Signature-256` dei messaggi in ingresso. Non si scrive qui |
| **Webhook Verify Token** | *(colonna `wa_verify_token` sulla riga Tenant)* | Lo si genera a caso e si incolla in due posti: il campo *Webhook Verify Token* in **Impostazioni Studio → Canali** e la console Meta. Non si scrive qui. |
| **Access Token** | *(campo `waAccessToken` sulla riga Tenant)* | Token `SYSTEM_USER` permanente (`expires_at: 0`), per studio |
| **Tipo di Token** | `SYSTEM_USER (Permanente)` | Token con validità illimitata (`expires_at: 0`) |
| **Permessi Attivi (Scopes)** | `whatsapp_business_messaging`<br>`whatsapp_business_management`<br>`business_management` | Invio/ricezione chat, gestione risorse e webhook |
| **Remote MCP Endpoint** | `https://mcp.facebook.com/devtools` | Server MCP per connessione agenti AI |

> Il verify token va **rigenerato su Meta** se è mai comparso in un file versionato: la
> cronologia di git non si dimentica, e chi legge il repository può superare l'handshake del
> webhook al posto nostro.

> **La divergenza è sanata, il 16/09/2026 — e la strada scelta è la seconda.** Il verify token era
> l'unica credenziale del canale che **non** veniva letta dalla riga Tenant: l'handshake confrontava
> la variabile d'ambiente `WA_VERIFY_TOKEN`, perché è una GET pubblica — senza JWT, quindi senza
> contesto tenant — e risolvere lo studio avrebbe richiesto una lettura che scavalca RLS. Il campo
> *Webhook Verify Token* in Impostazioni veniva salvato e **non usato da nessuno**: chi lo compilava
> credeva di aver configurato l'handshake e non l'aveva fatto. Le due strade erano togliere il campo
> dall'interfaccia, oppure **dare a ogni studio il proprio URL di callback** così che il tenant fosse
> deducibile dal path. È stata presa la seconda: la rotta è `…/whatsapp/<slug>` (dove `<slug>` è
> `wa_webhook_slug`, `@unique` e generato con entropia dal database), lo studio si risolve dallo
> slug **senza nessuna ricerca cross-tenant**, e l'handshake confronta con il token di **quello**
> studio. Uno studio senza verify token non può essere sottoscritto da nessuno: risponde `503`.
> La variabile d'ambiente è rimasta solo come **ingresso del seed** (`prisma/seed.ts` la usa per
> popolare `wa_verify_token`), non come ciò che l'handshake legge.

> ⚠️ Lo slug si può **ruotare** (`POST /tenant/whatsapp-slug`, con `conferma: true` obbligatorio),
> ma ruotarlo **smette di ricevere** i messaggi WhatsApp finché la Callback URL non viene aggiornata
> su Meta: va fatto con la dashboard Meta aperta davanti.

Un token nuovo si genera così, e il valore va incollato solo nei due punti (campo in
Impostazioni Studio → Canali e console Meta):

```bash
node -e "console.log(require('crypto').randomBytes(24).toString('base64url'))"
```

---

## ⚙️ 3. Configurazione Webhook su Meta Developers

Per ricevere i messaggi inviati dai clienti su WhatsApp direttamente dentro BluMan:

1. Accedi al portale **[Meta for Developers](https://developers.facebook.com/apps/)** e apri **l'app dello studio** — il link diretto è `https://developers.facebook.com/apps/<APP_ID>/whatsapp-business/wa-dev-console/`, con l'App ID che si legge da *Impostazioni Studio → Canali*.
2. Nel menu laterale, seleziona **WhatsApp ➔ Configurazione** (*Configuration*).
3. Nella sezione **Webhook**, clicca su **Modifica** (*Edit*):
   - **URL di callback** — porta lo **slug dello studio**, e il valore esatto lo mostra
     **Impostazioni Studio → Canali** già composto (non si inventa):
     ```text
     https://bluman-api-production.up.railway.app/webhooks/communications/whatsapp/<slug>
     ```
     ⚠️ Il dominio è quello del **backend su Railway**, non quello di Vercel. Fino al 16/09/2026
     questo passo indicava `https://bluman.vercel.app/webhooks/communications/whatsapp`, che oggi
     non esiste più: il ponte su Vercel è stato rimosso, e la firma `x-hub-signature-256` si può
     verificare solo sul backend.
   - **Verifica il token**: lo stesso valore che hai messo nel campo *Webhook Verify Token* di
     **Impostazioni Studio → Canali**. Se quello studio non ne ha uno, l'handshake risponde `503` —
     è voluto: meglio un webhook da riconfigurare di uno che accetta chiunque.
4. Clicca su **Verifica e salva** (*Verify and save*).
5. Sotto **Campi Webhook** (*Webhook fields*), clicca su **Gestisci** (*Manage*) e attiva la spunta su **`messages`**.

Presidio dell'handshake: `src/webhooksSicurezza.test.ts` — token dello studio giusto → 200 con la
challenge, token inventato o di piattaforma → 403, studio **senza** verify token → 503. In
`src/services/communications.test.ts` resta la parte che non dipende dal database: uno **slug che
non risolve nessuno studio** risponde 404 a chiunque, e la vecchia variabile d'ambiente
`WA_VERIFY_TOKEN` non apre l'handshake nemmeno quando è impostata.

---

## 📲 4. Come Inviare Messaggi di Test (CURL & Script)

I due `curl` qui sotto parlano **direttamente con Meta** e servono a una cosa sola: capire se
il numero, il token e il template sono a posto, escludendo BluMan dall'equazione. Non sono la
strada applicativa: l'applicazione spedisce con `POST /comunicazioni/invia-whatsapp` (§4-bis),
che è autenticata e usa le credenziali dello studio che chiede.

### A. Invio Template Standard Ufficiale (`hello_world`)
```bash
curl -i -X POST \
     "https://graph.facebook.com/v21.0/<PHONE_NUMBER_ID>/messages" \
     -H "Authorization: Bearer <TUO_TOKEN_PERMANENTE>" \
     -H "Content-Type: application/json" \
     -d '{
       "messaging_product": "whatsapp",
       "to": "<NUMERO_DESTINATARIO>",
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
     "https://graph.facebook.com/v21.0/<PHONE_NUMBER_ID>/messages" \
     -H "Authorization: Bearer <TUO_TOKEN_PERMANENTE>" \
     -H "Content-Type: application/json" \
     -d '{
       "messaging_product": "whatsapp",
       "recipient_type": "individual",
       "to": "<NUMERO_DESTINATARIO>",
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
       "numero": "+39 000 000 0000",
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
1. Meta invia una notifica `POST` all'endpoint Webhook con il campo `from` (es. `390000000000`).
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
