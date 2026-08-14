# BluMan API — Istruzioni di installazione

Due percorsi. **Parti dal Percorso A** — è il più veloce per vedere che tutto funziona, non serve Postgres né Docker. Il Percorso B è quello vero, con dati persistenti, e lo fai quando il primo ti convince.

---

## Prerequisiti (per entrambi i percorsi)

- **Node.js versione 20 o superiore.** Controlla con:
  ```bash
  node --version
  ```
  Se non ce l'hai: scarica da [nodejs.org](https://nodejs.org) (versione "LTS").

- **Un terminale.** Su Windows: PowerShell (cercalo nel menu Start) o il terminale integrato di VS Code. Su Mac: Terminale (Applicazioni → Utility). Su Linux: quello che usi sempre.

---

## Percorso A — Quick start, nessun database (5 minuti)

Ti fa vedere l'intero flusso (cliente → progetto → preventivo → istanziazione) funzionante per davvero, con i dati tenuti in memoria (si azzerano se riavvii il server — va bene per provarlo, non per uso reale).

**1. Scompatta il progetto** (il file `bluman-api.zip` che ti ho dato) in una cartella a tua scelta.

**2. Apri il terminale in quella cartella.**
   - Windows: dentro la cartella, Shift + tasto destro del mouse → "Apri finestra PowerShell qui" (o "Apri terminale qui")
   - Mac/Linux: `cd` fino alla cartella, es. `cd ~/Downloads/bluman-api`

**3. Installa le dipendenze:**
   ```bash
   npm install
   ```
   Ci vuole un minuto o due. Se vedi righe gialle "warning" è normale, ignora. Se vedi "error" in rosso, fermati e mandami il messaggio esatto.

**4. Esegui i test — per confermare che tutto è a posto prima ancora di avviare il server:**
   ```bash
   npm test
   ```
   Ti aspetti: `Tests  80 passed (80)`. Se qualcosa fallisce, mandami l'output completo.

**5. Avvia il server:**
   ```bash
   npm run dev
   ```
   Ti aspetti di vedere:
   ```
   BluMan API (quick start, in-memory) in ascolto su http://127.0.0.1:3000
   ```
   **Lascia questo terminale aperto** — il server resta acceso finché non premi Ctrl+C o chiudi la finestra.

**6. Apri un SECONDO terminale** (senza chiudere il primo) e prova le richieste:

   ```bash
   curl http://127.0.0.1:3000/health
   ```
   Ti aspetti: `{"stato":"ok"}`

**6bis. Apri il frontend vero** (nuovo, collegato per davvero al backend — non il vecchio mockup statico):

   Vai nella cartella `frontend/` e apri `index.html` con un doppio click nel tuo file manager (di solito basta, il browser lo apre come `file://...`).

   **Se vedi un errore di connessione/CORS nella pagina** (capita con alcuni browser quando si apre un file locale): serve un piccolo server statico invece di aprire il file direttamente. Nel terminale, dentro la cartella `frontend`:
   ```bash
   npx serve .
   ```
   e apri l'indirizzo che ti mostra (di solito `http://localhost:3000` — se coincide con la porta del backend, cambiala: `npx serve . -l 5500` e apri `http://localhost:5500`).

   In alto a sinistra nella pagina vedi scritto a quale indirizzo backend è collegato — di default `http://127.0.0.1:3000`, giusto per il Percorso A. Se cambi porta o passi a Postgres (`npm run start:db`, stessa porta di default), non serve toccare nulla.

   Da qui puoi fare **tutto** cliccando invece che con `curl`: crea un cliente, un progetto, un preventivo, accettalo, apri il progetto, clicca su una micro-voce, consuntiva ore, prova a completarla prima di aver fatto i passaggi (vedrai il pulsante disabilitato, esattamente come previsto da §17.1), completa i passaggi, poi completa la micro-voce.

**7. Se preferisci restare da terminale**, lo stesso flusso via `curl` — utile anche solo per curiosità tecnica:
   ```bash
   curl http://127.0.0.1:3000/moduli
   ```
   Ti aspetti: la lista dei 2 moduli di esempio (Analisi patrimoniale iniziale, Corporate structuring Malta). Oppure apri lo stesso indirizzo nel browser.

   Il flusso completo (crea un cliente, un progetto, un preventivo, poi accettalo):
   ```bash
   curl -X POST http://127.0.0.1:3000/clienti -H "Content-Type: application/json" -d "{\"nome\":\"Marco Ricci\",\"tipo\":\"individual\"}"
   ```
   Copia l'`id` che ti restituisce, usalo nel prossimo comando al posto di `INCOLLA_CLIENTE_ID`:
   ```bash
   curl -X POST http://127.0.0.1:3000/progetti -H "Content-Type: application/json" -d "{\"clienteId\":\"INCOLLA_CLIENTE_ID\",\"nome\":\"Struttura Holding\"}"
   ```
   Copia l'`id` del progetto, poi:
   ```bash
   curl -X POST http://127.0.0.1:3000/preventivi -H "Content-Type: application/json" -d "{\"clienteId\":\"INCOLLA_CLIENTE_ID\",\"progettoId\":\"INCOLLA_PROGETTO_ID\",\"righe\":[{\"moduloTemplateId\":\"M01\",\"moduloTemplateVersione\":1},{\"moduloTemplateId\":\"M02\",\"moduloTemplateVersione\":1}]}"
   ```
   Copia l'`id` del preventivo, poi il momento clou:
   ```bash
   curl -X POST http://127.0.0.1:3000/preventivi/INCOLLA_PREVENTIVO_ID/accetta
   ```
   Questo è §15.3: crea moduli, micro-voci e passaggi tutti insieme. Poi verifica:
   ```bash
   curl http://127.0.0.1:3000/progetti/INCOLLA_PROGETTO_ID
   ```
   Dovresti vedere il progetto `in_progress`, con 2 moduli e le loro micro-voci — nota che le micro-voci di "Corporate structuring Malta" risultano `attesa_dipendenza`, non `pending`, perché quel modulo dipende da "Analisi patrimoniale iniziale" (§7ter).

**Qualunque errore in questi passaggi: copiami esattamente cosa hai scritto e cosa è comparso.** Non serve che tu capisca cosa significa l'errore, basta il testo esatto.

---

## Percorso B — con Postgres vero (dati persistenti)

Due varianti equivalenti per il database: **Postgres locale con Docker**, oppure **Supabase** (Postgres gestito in cloud, niente da installare sul tuo computer). Scegli quella che preferisci — dal punto 5 in poi le istruzioni sono identiche.

### Variante Supabase (nessun Docker necessario)

1. Vai su [supabase.com](https://supabase.com), crea un account e un nuovo progetto (gratuito per iniziare).
2. Nel progetto: **Project Settings → Database → Connection string**, scegli la modalità **"Transaction"** (porta 6543) o **"Session"** (porta 5432) — per `prisma migrate` serve la modalità Session/diretta, non quella pooled. Copia la stringa, sostituisci `[YOUR-PASSWORD]` con la password del database che hai scelto in fase di creazione progetto.
3. Salta il punto 4 sotto (non serve Docker) e vai direttamente al punto 5.

### Variante Docker locale

Richiede **Docker Desktop** installato ([docker.com](https://www.docker.com/products/docker-desktop/) — scarica, installa, apri, aspetta che dica "Docker Desktop is running").

**1-3.** Come nel Percorso A (scompatta, apri terminale, `npm install`).

**4. Avvia Postgres con Docker:**
   ```bash
   docker compose up -d
   ```
   Verifica con `docker compose ps` — deve dire `healthy` accanto a `postgres`.

### Da qui in poi, uguale per entrambe le varianti

**5. Copia il file d'ambiente e incolla la connection string:**
   ```bash
   cp .env.example .env
   ```
   (su Windows PowerShell: `copy .env.example .env`)

   Apri `.env` con un editor di testo qualsiasi e sostituisci il valore di `DATABASE_URL`:
   - Docker locale: lascia quello già presente nel file.
   - Supabase: incolla la connection string copiata al punto 2 sopra.

**6. Genera il client Prisma e crea le tabelle nel database:**
   ```bash
   npx prisma generate
   npx prisma migrate dev --name init
   ```
   **Questo è il comando che nel mio ambiente di sviluppo non ho mai potuto eseguire** (rete bloccata) — è la prima verifica vera dello schema che ho scritto. Se fallisce con un errore legato allo schema (non di rete/connessione), è la prima cosa da segnalarmi: significa che ho scritto qualcosa che Prisma non accetta, e va corretto in `prisma/schema.prisma`.

**7. Popola la libreria di prova:**
   ```bash
   npm run seed
   ```
   Ti aspetti: `Seed completato.` con il nome del tenant e dei due moduli creati. Con Supabase, puoi anche aprire il **Table Editor** nella loro dashboard e vedere le righe create con i tuoi occhi — è un buon modo per controllare che sia andato tutto bene.

**8. Crea il primo utente (Super Admin):**
   ```bash
   BOOTSTRAP_EMAIL=tuo@indirizzo.it npm run bootstrap
   ```
   (su Windows PowerShell: `$env:BOOTSTRAP_EMAIL="tuo@indirizzo.it"; npm run bootstrap`)

   Ti stampa una password temporanea **una sola volta** — salvala, non la rivedrai più.

**9. Avvia il server collegato al database vero:**
   ```bash
   npm run start:db
   ```
   Ti aspetti:
   ```
   BluMan API (Postgres reale) in ascolto su http://127.0.0.1:3000
   ```
   Da qui, le stesse prove del Percorso A (punti 6-7: `curl`/browser su `/health`, `/moduli`, e il flusso completo cliente → progetto → preventivo → accettazione) — con la differenza che stavolta, se riavvii il server, **i dati restano**. Con Supabase puoi anche verificare nel Table Editor che le righe di `modulo_progetto` e `microvoce_progetto` siano comparse davvero dopo aver accettato un preventivo.

**Anche questo intero percorso (6, 7, 8, 9) lo eseguo qui per la prima volta insieme a te** — se qualcosa si inceppa, è un'informazione preziosa, non solo un fastidio.

---

## Novità — §17, esecuzione del progetto

Dopo aver accettato un preventivo (punto 7 del Percorso A, o il flusso equivalente nel B), il progetto ha moduli e micro-voci reali. Con l'`id` di una micro-voce (lo trovi in `GET /progetti/:id`, dentro `moduli[].microvoci[]`) puoi provare:

```bash
# consuntiva ore
curl -X POST http://127.0.0.1:3000/microvoci/ID_MICROVOCE/consuntiva -H "Content-Type: application/json" -d '{"ore":2}'

# marca un ritardo (causaNota è obbligatoria, §7bis)
curl -X POST http://127.0.0.1:3000/microvoci/ID_MICROVOCE/ritardo -H "Content-Type: application/json" -d '{"stato":"blocked","causaNota":"KYC respinto dalla banca"}'

# vedi i passaggi della procedura guidata
curl http://127.0.0.1:3000/microvoci/ID_MICROVOCE/passaggi

# completa un passaggio (usa l'id restituito sopra)
curl -X POST http://127.0.0.1:3000/passaggi/ID_PASSAGGIO/completa-documento

# prova a completare la micro-voce PRIMA di aver fatto tutti i passaggi: deve dare 409
curl -w "\nHTTP %{http_code}\n" -X PATCH http://127.0.0.1:3000/microvoci/ID_MICROVOCE/completa
```

---

## Cosa segnalarmi se qualcosa va storto

Per ogni errore, questi tre elementi bastano:
1. **A quale numero del percorso eri** (es. "Percorso A, punto 4")
2. **Il comando esatto che hai lanciato**
3. **L'output esatto** (copia-incolla tutto il testo dell'errore, anche se sembra incomprensibile — a me dice molto di più che a te)

Non serve che tu interpreti l'errore prima di mandarmelo — anzi, meglio se non lo fai, per non perdere dettagli che sembrano irrilevanti ma non lo sono.
