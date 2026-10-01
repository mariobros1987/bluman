# 15 · Comunicazioni & Canali

## 👤 Cosa fa e come si usa
Le comunicazioni con il cliente sono **omnichannel** e finiscono nel **fascicolo della pratica**:
**email** (SMTP/IMAP), **WhatsApp**, **Telegram**, **Signal**.
- **Invio**: dallo studio (scheda Comunicazioni del progetto) via il canale configurato; ogni invio è
  registrato come comunicazione in uscita.
- **Ingestione**: i messaggi in arrivo (webhook/IMAP) entrano nel fascicolo del cliente/pratica.
- **Collegamento chat per pratica**: un link `t.me/<bot>?start=<payload>` aggancia la chat Telegram del
  cliente a **quella** pratica (il payload è firmato HMAC); si copia o si invia via email/WhatsApp.
- I canali si configurano in **Impostazioni** (§16).

## 📐 Calcoli & logica
- **Invio governato dalla Matrice Permessi** (modulo `communications`, §17): l'admin decide chi può
  spedire (write) o solo consultare (read); ogni invio è **auditato**.
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

## 🔗 Collegamenti
- **Progetti** (§01): le comunicazioni stanno nel fascicolo del progetto.
- **Scadenzario** (§06): i solleciti escono da qui.
- **Impostazioni** (§16): credenziali SMTP/IMAP e configurazione canali.

## ⚠️ Stati limite & errori
- Relay non configurato → invio email non parte (fail-closed).
- Bot Telegram con username errato / id numerico → messaggi guidati diversi per rimedi diversi.
- Chi non ha il permesso `communications=write` → invio bloccato.

## 🔧 Nota tecnica
- Servizi: `src/services/emailRelay.ts`, `imapInbound.ts`, `collegamentoChat.ts`; funzione Vercel
  `api/send-email.ts` (relay). Rotte: comunicazioni (`/comunicazioni/invia-*`), webhooks,
  `collegamentoChat.ts`.
- Frontend: `components/ComunicazioniTab.tsx`, `components/settings/TabChannels.tsx`,
  `components/projectDetail/LinkTelegramProgetto.tsx`.
- **L'indirizzo pubblico del backend**: `src/util/urlPubblica.ts` — `urlPubblicaBackend()`,
  `urlWebhookWhatsapp(slug)`, `urlWebhookTelegram()`, `slugValido()`. Fino al **01/10/2026** il modulo
  leggeva solo `RAILWAY_PUBLIC_DOMAIN`: sul VPS quella variabile **non esiste**, quindi i callback si
  componevano su `bluman-api-production.up.railway.app` — **un altro backend, con un altro database**.
  Ora la seconda sorgente è `APP_BASE_URL` (la convenzione del progetto per «dove vive questo
  deployment»), e il suo **schema si conserva**: sul VPS, prima del TLS, l'indirizzo è legittimamente
  `http://` e imporgli `https://` comporrebbe un callback che non risponde. Presidio:
  `src/urlPubblica.test.ts` (18 test).
- Schema: `ComunicazioneProgetto`, `CollegamentoChatProgetto`.
- Fonti: `.agents/AGENTS.md`, `AUDIT_2026-09-27/06-comunicazioni-canali.md`, `GUIDA_CONFIGURAZIONE_CANALI.md`.
