# DNS di `blusmart.eu` — cosa caricare in Register.it

Servono **due record**, e il valore è uno solo: l'indirizzo del VPS di produzione.

| Nome / Host | Tipo | Valore | TTL |
|---|---|---|---|
| `@` (la radice, `blusmart.eu`) | A | `136.144.234.118` | 300 |
| `www` | A | `136.144.234.118` | 300 |

## I file

- **`blusmart.eu.csv`** — quello che hai chiesto, da importare. Colonne:
  `name,type,value,ttl,priority` (la `priority` resta vuota: serve solo agli MX).
- **`blusmart.eu.zone`** — la stessa cosa in formato BIND. È il formato che quasi tutti
  gli importatori di zona leggono, quindi è il primo ripiego se il CSV non entra.

⚠️ **Onestà su un punto:** non ho potuto aprire la documentazione di Register.it per
copiare il loro tracciato di importazione — in questa sessione l'accesso al web è a terra
(risponde con un errore di quota, sia la ricerca sia la lettura pagine). Quindi **non ti
garantisco che i nomi delle colonne combacino con il loro modello**. I due indirizzi IP
dentro il file sono invece verificati, e sono la parte che conta. Se l'import risponde
«formato non riconosciuto», in ordine di costo:

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

**2. L'IPv6 (AAAA).** Se sulla radice o su `www` esiste un AAAA, il browser che ha IPv6
prova **quello** e ignora il nostro A. Oggi il VPS non ha un indirizzo IPv6 configurato per
questo: un AAAA presente va **rimosso**, non corretto.

**3. I nameserver.** Tutto questo ha effetto solo se il dominio usa i nameserver di
Register.it (quelli che vedi nel pannello, nella sezione DNS). Se i NS puntano altrove, la
zona che modifichi qui non è quella che il mondo interroga.

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

## Dopo che il DNS risolve

Non serve aspettare il mondo intero, basta il resolver del VPS. Poi, in quest'ordine:

- verificare che `blusmart.eu` risolva a `136.144.234.118` **dal VPS**;
- `certbot` via webroot. Con `www` incluso, il comando è a due domini:
  ```bash
  docker compose -f docker-compose.prod.yml run --rm --entrypoint \
    "certbot certonly --webroot -w /var/www/certbot -d blusmart.eu -d www.blusmart.eu \
     --email TUA@EMAIL --agree-tos --no-eff-email" certbot
  ```
  (se alla fine preferisci **niente `www`**: cancella quella riga dal CSV e togli
  `-d www.blusmart.eu`. Il record `www` senza certificato che lo copra dà un avviso di
  nome non corrispondente nel browser — quindi o entrambi, o nessuno dei due);
- scommentare il blocco `server :443` e il `return 301` in `nginx/default.conf`
  (in `:80` c'è già `server_name _` e la location della sfida ACME: la verifica passa con
  qualunque `Host`, non serve toccarla prima), sostituire `IL.TUO.DOMINIO`, `nginx -s reload`;
- poi le variabili d'ambiente: `APP_BASE_URL=https://blusmart.eu`, `CORS_ORIGINS` senza
  `*.vercel.app`, il `connect-src` della CSP a `'self'`, HSTS acceso.

Telegram resta dov'è (Railway), e Railway/Vercel restano come ritorno indietro — come
deciso: DNS e TLS, senza toccare Telegram.
