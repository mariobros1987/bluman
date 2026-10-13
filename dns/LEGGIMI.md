# DNS di `blusmart.eu` — i record pubblicati

**Due record, e il valore è uno solo**: l'indirizzo del VPS di produzione. Questa pagina li descrive
come **sono in giro**, non come andrebbero caricati: fino al 13/10/2026 diceva «carica questi record»
quando erano già pubblicati da un giorno, che è il modo più semplice di mandare qualcuno a rifare un
lavoro fatto.

| Nome / Host | Tipo | Valore | TTL **pubblicato** |
|---|---|---|---|
| `@` (la radice, `blusmart.eu`) | A | `136.144.234.118` | 3600 |
| `www` | A | `136.144.234.118` | 300 |

Verificati il **13/10/2026** interrogando un resolver **pubblico** (il DoH di Cloudflare) e non quello
di casa: la rete di casa è dirottata da TIM e per questo dominio risponde `127.0.0.1`, quindi da lì si
concluderebbe che il DNS è rotto mentre è solo il proprio.

⚠️ Il TTL della radice è **3600**, non i 300 chiesti: è Register.it che ha pubblicato così. Non è un
guasto, ma cambia una cosa che conta il giorno in cui servirà — una modifica su `@` si propaga in
**un'ora**, non in cinque minuti. Su `www` il TTL è rimasto 300.

## I file

- **`blusmart.eu.csv`** — quello che hai chiesto, da importare. Colonne:
  `name,type,value,ttl,priority` (la `priority` resta vuota: serve solo agli MX).
- **`blusmart.eu.zone`** — la stessa cosa in formato BIND. È il formato che quasi tutti
  gli importatori di zona leggono, quindi è il primo ripiego se il CSV non entra.

⚠️ **Onestà su un punto:** non ho potuto aprire la documentazione di Register.it per copiare il loro
tracciato di importazione — in quella sessione l'accesso al web era a terra (rispondeva con un errore
di quota, sia la ricerca sia la lettura pagine). Quindi **non garantisco che i nomi delle colonne
combacino con il loro modello**. I record sono in giro, quindi una delle tre strade qui sotto ha
funzionato — ma *quale* non è registrato da nessuna parte, e il caveat resta perché tornerà utile alla
prossima zona da importare. Gli indirizzi IP dentro i file sono verificati, e sono la parte che conta.
Se un import risponde «formato non riconosciuto», in ordine di costo:

1. togli la riga di intestazione e riprova (alcuni importatori vogliono solo i dati);
2. usa `blusmart.eu.zone`;
3. **cancella l'import e scrivi le due righe a mano** dalla tabella qui sopra. Sono due
   righe: si fa in mezzo minuto, ed è la strada che non può fallire in modo silenzioso.

## Le tre trappole, in ordine di probabilità

**1. Il record di parcheggio.** Un dominio appena registrato di solito ha già un record A
sulla radice che punta alla pagina di parcheggio di Register.it. Se l'import **aggiunge**
invece di **sostituire**, restano due A sulla radice e il browser va a metà delle volte sul
VPS e a metà sul parcheggio — un guasto che sembra intermittente e non lo è. Dopo l'import,
guarda l'elenco della zona: su `@` deve esserci **un solo** record A, il nostro.

✓ **Verificato il 13/10/2026**: sulla radice c'è **un solo** A, il nostro.

**2. L'IPv6 (AAAA).** Se sulla radice o su `www` esiste un AAAA, il browser che ha IPv6
prova **quello** e ignora il nostro A. Oggi il VPS non ha un indirizzo IPv6 configurato per
questo: un AAAA presente va **rimosso**, non corretto.

✓ **Verificato il 13/10/2026**: nessun AAAA, né sulla radice né su `www`.

**3. I nameserver.** Tutto questo ha effetto solo se il dominio usa i nameserver di
Register.it (quelli che vedi nel pannello, nella sezione DNS). Se i NS puntano altrove, la
zona che modifichi qui non è quella che il mondo interroga.

✓ **Verificato il 13/10/2026**: i nameserver del dominio sono `ns1.register.it` e
`ns2.register.it`, quindi la zona che si modifica in Register.it è quella che il mondo interroga.

## Perché dentro non c'è la posta

Non ci sono MX, SPF, DKIM o DMARC. Non è una dimenticanza: quei valori **li conosce solo il
provider della casella**, e indovinarli fa danni — un `include:` SPF sbagliato autorizza i
server sbagliati e peggiora il recapito rispetto a non avere il record. È la stessa regola
che l'app applica da sola nel pannello *Impostazioni → Canali → Record DNS del dominio*
(`frontend/src/components/settings/PannelloRecordDns.tsx`), che infatti scrive
`include:<valore indicato dal provider>` invece di proporne uno.

Quando saprai se `blusmart.eu` ospita anche una casella di posta, i record si aggiungono
dopo, leggendoli dal pannello del provider. Se la casella sarà su Register.it, il pannello
stesso ti dà MX e SPF: sono valori che pubblica lui, non che scelgo io.

## Cosa è stato fatto (12–13/10/2026)

I passi che qui erano elencati come **da fare** sono fatti, e vale la pena tenerne il *modo*, perché è
quello che rende la verifica ripetibile:

- `blusmart.eu` e `www.blusmart.eu` **risolvono al VPS**. Verificato il 13/10/2026 da un resolver
  **pubblico** (DoH di Cloudflare) e non da quello di casa: per questo dominio la rete di casa
  risponde `127.0.0.1`, e da lì dentro non si distingue «il DNS non è pubblicato» da «il mio resolver
  mente» — con la conclusione sbagliata che è sempre la prima.
- **Certificato Let's Encrypt** per entrambi i nomi: emesso il **12/10/2026 09:15 UTC**, scade il
  **10/01/2027**, SAN `blusmart.eu` + `www.blusmart.eu`. Lo rinnova il servizio `certbot` del compose
  (webroot, ogni 12h), e il rinnovo ripassa dalla sfida su `:80`, che per questo resta in chiaro di
  proposito.
- **HTTPS attivo** (`:443` in `nginx/default.conf`) e `:80` che rimanda: `http://blusmart.eu/` →
  **301** `https://blusmart.eu/`. Quel blocco non è più «da scommentare»: è la configurazione in
  servizio, e i segnaposto tipo `IL.TUO.DOMINIO` non esistono più nel file.
- **HSTS** acceso su HTTPS (`max-age=31536000; includeSubDomains`) e il `connect-src` della **CSP** a
  `'self'`: entrambe confermate nelle intestazioni della risposta sul dominio.
- **Variabili d'ambiente**: `APP_BASE_URL` è il dominio **con** `https`, e `CORS_ORIGINS` **non**
  contiene più `*.vercel.app`. Verificate il 13/10/2026 dentro il container `api`, chiedendo la
  classificazione e non il valore: il `.env` di produzione non si stampa, e delle due variabili basta
  sapere se sono nella forma giusta. Contano più di quanto sembri — `APP_BASE_URL` è ciò che l'app
  dichiara a Meta come Callback URL, e un'origine fuori da `CORS_ORIGINS` non dà 401 ma **500**: il
  login sembra «password sbagliata» e invece è la whitelist.

## Cosa resta aperto

**Il record CAA** — c'è in `blusmart.eu.zone`, commentato. Senza, qualunque CA può emettere un
certificato per questo dominio; con `0 issue "letsencrypt.org"` può farlo solo Let's Encrypt, che è
l'unica che usiamo. Ne basta **uno, sulla radice**: la ricerca di un record CAA risale l'albero dei
nomi, quindi copre anche `www`. Non è un guasto — è un permesso in più che nessuno esercita.

**I record di posta** (MX, SPF, DKIM, DMARC): restano assenti di proposito, per il motivo spiegato
sopra. Si aggiungono quando si saprà se `blusmart.eu` ospita una casella, leggendoli dal pannello del
provider.

Telegram resta dov'è (Railway), e Railway/Vercel restano come ritorno indietro — come deciso: DNS e
TLS, senza toccare Telegram.
