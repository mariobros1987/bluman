# BluMan API — avvio backend

Copre le Fasi 1, 5, 6 e 7 del `BluMan_piano_di_sviluppo.md`: schema, motore di calcolo stati, API di pre-progetto (§15) ed esecuzione (§17). Stack: Node.js + TypeScript + Prisma (Postgres) + Fastify + Vitest.

## Cosa c'è, verificato per davvero

- **`prisma/schema.prisma`** — tutte le tabelle di §14 con le estensioni successive (§19, §26, §28) incluse fin dall'inizio, più il fix di `Preventivo.progettoId` (vedi sotto).
  **Non validato con `prisma validate`/`prisma generate`**: rete bloccata verso `binaries.prisma.sh` in questo ambiente — verificato che entrambi i comandi falliscono per lo stesso motivo. Controllato manualmente: parentesi bilanciate, modelli senza duplicati, relazioni con nome esplicito tutte in coppia.
- **`src/domain/stateEngine.ts`** — le funzioni di §16.1-16.5, modulo puro. 35 test.
- **`src/services/istanziaProgetto.ts`** — la transazione di istanziazione (§15.3), il pezzo più delicato del sistema. 13 test, incluso un test di rollback verificato disattivando temporaneamente l'isolamento transazionale per confermare che il test lo cattura davvero.
- **`src/services/esecuzione.ts`** — §17: consuntivazione, ritardo/blocco, e la validazione che lega procedura guidata e motore di stati (§17.1 — una micro-voce non si completa se i suoi passaggi non sono tutti fatti). 11 test, incluso un test di integrazione sullo sblocco a cascata delle dipendenze **durante l'esecuzione** (non solo alla creazione), verificato con lo stesso trucco del rollback.
- **`src/server.ts` + `src/adapters/inMemoryApp.ts`** — server HTTP Fastify funzionante *ora*, senza database: l'intero ciclo cliente → progetto → preventivo → accettazione → consuntivazione → procedura guidata → completamento. Verificato con test automatici (`fastify.inject()`, 13+ test su `server.test.ts`) e con `curl` reale contro il processo in ascolto (le volte in cui il sandbox lo permette — vedi nota sotto).
- **`src/util/password.ts`** — hashing con `scrypt` nativo di Node, niente dipendenze compilate. 5 test.
- **`src/adapters/prisma/`** — bootstrap (§27), seed, `PrismaIstanziazionePort` + `PrismaApp` (implementazione completa di `AppPort` e `EsecuzionePort` sopra Postgres reale), entry point dedicato (`npm run start:db`). Funziona con qualunque Postgres via `DATABASE_URL` — **incluso Supabase**. Scritti ma **non eseguibili in questo ambiente** (stesso blocco di rete di Prisma) — cartella esclusa dal type-check qui apposta, va verificata sulla tua macchina.
- **`src/services/appPort.ts`** — interfaccia comune tra `InMemoryApp` e `PrismaApp`: `server.ts` dipende solo da questa, non sa quale implementazione gira sotto. Stesso principio di `IstanziazionePort`/`EsecuzionePort`.
- **`frontend/index.html`** — interfaccia vera, collegata per davvero al backend via `fetch()` (non il vecchio mockup statico con dati finti). Copre solo i flussi che il backend supporta oggi: clienti, progetti, preventivi, accettazione, e l'intera esecuzione (§17) — consuntivazione, ritardo, procedura guidata. Stile coerente col prototipo originale, ma niente tab "Fatturazione"/"Team"/ecc. che non hanno ancora un'API dietro: meglio niente che finto. Verificato con un DOM simulato (jsdom) popolato di dati realistici, non solo controllato a vista.
- **80/80 test passano**, `tsc --noEmit` pulito su tutto il codice verificabile in questo ambiente.

**Due buchi reali trovati scrivendo, non solo "collegato e via":**
- Lo schema `Preventivo` (§14) non aveva mai un campo `progetto_id`, anche se l'API di §15.2 lo richiede esplicitamente nel body — incoerenza tra §14 e §15.2 del documento, corretta in `schema.prisma`.
- Lo schema `User` non aveva un campo password — mancava del tutto, aggiunto (`passwordHash`, `totpSecret`) scrivendo il bootstrap (§27).

## Cosa manca — onestamente, non solo "in arrivo"

- **Upload documento è simulato**: `/passaggi/:id/completa-documento` marca il passaggio come fatto senza salvare un file vero. La sicurezza upload (§28) resta da collegare quando c'è uno storage reale.
- **`PrismaApp` non è mai stato eseguito contro un Postgres vero.** Prima cosa da provare col Percorso B/Supabase.
- Nella creazione di un preventivo, `PrismaApp` apre una transazione solo per una lettura del template — funzionalmente corretto ma inefficiente (commentato nel codice).
- **Ancora mancanti**: engagement letter con firma digitale reale (qui accettare un preventivo istanzia il progetto direttamente, senza il doppio step invia-per-firma/webhook-firma di §15.2), riordino/aggiunta/rimozione passaggi personalizzati, documenti liberi, job promemoria (§17.2-17.4), e tutte le route di §18-21 (fatturazione, permessi, calendario, dashboard super admin).
- **Row-Level Security e il CHECK su `accesso_risorsa`** restano commenti SQL da applicare a mano dopo il primo `migrate dev`.
- **Il caso limite delle dipendenze soddisfatte da un progetto precedente dello stesso cliente** (§7ter) non è gestito da `istanziaProgetto` — dichiarato nei commenti del file.

## Comandi

```bash
npm install
npm test               # 80 test
npx tsc --noEmit        # type-check, nessun errore atteso
npm run dev             # server in-memory su :3000, nessun database necessario

# con un Postgres vero (locale via Docker o Supabase — vedi ISTRUZIONI_INSTALLAZIONE.md):
cp .env.example .env    # poi incolla DATABASE_URL (es. quella di Supabase)
npx prisma generate
npx prisma migrate dev --name init
npm run seed             # popola tenant/libreria di prova
BOOTSTRAP_EMAIL=tuo@indirizzo.it npm run bootstrap
npm run start:db         # server collegato al Postgres/Supabase vero
```

## Nota sul sandbox di sviluppo

In questo ambiente i processi in background (es. `npm run dev`) non sopravvivono in modo affidabile tra una chiamata al terminale e l'altra — non è un bug del codice, è un limite dell'ambiente stesso. Sulla tua macchina, con un terminale normale, il processo resta vivo finché non lo chiudi tu. I test automatici (`npm test`) restano la verifica affidabile qui; il `curl` dal vivo è la verifica affidabile sulla tua macchina.

Istruzioni passo-passo complete, con cosa segnalarmi in caso di errore: **`ISTRUZIONI_INSTALLAZIONE.md`**.
