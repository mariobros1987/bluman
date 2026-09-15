# E2E Playwright — i tre flussi critici

Suite end-to-end dei flussi che, se si rompono, fermano lo studio e i clienti:
login con cambio password obbligatorio, firma SES della lettera d'incarico dal
portale cliente, emissione fattura dal compositore di microvoci.

## Architettura: database usa-e-getta, mai produzione

L'unico database che esiste fuori da questi test è quello **reale** su Supabase.
Gli E2E non lo toccano mai: girano su un container Postgres 16 usa-e-getta
(`bluman-e2e-pg`, porta **5433**), creato e popolato da `scripts/e2e/prepara.mjs`.
Il database va svuotato con `docker rm -f bluman-e2e-pg` quando non serve più.

Le protezioni, in ordine:

- `scripts/e2e/avvia-backend.mjs` cabla le URL di connessione su
  `localhost:5433` prima di avviare il server: il `.env` della root (che punta
  a Supabase) viene caricato dopo, e dotenv non sovrascrive le variabili già
  presenti.
- `playwright.config.ts` usa `reuseExistingServer: false` per il backend: se
  sulla porta 3000 girasse già un processo avviato a mano con l'ambiente di
  produzione, Playwright si rifiuta di partire invece di usarlo.
- `src/scripts/seedE2E.ts` (l'overlay) legge l'URL **solo** dalla variabile
  `E2E_DATABASE_URL`, rifiuta di girare senza, e in più esige che punti a
  `localhost`.

Le email dell'OTP di firma finiscono in **Mailpit** (`bluman-e2e-mailpit`,
SMTP su 1025, API su http://localhost:8025): un SMTP vero, per quanto di test,
perché `/portal/request-otp` annulla il codice e risponde 502 se l'invio
fallisce — un mock della sola chiamata HTTP non eserciterebbe il percorso
reale. L'helper `leggiOtpDaMailpit` (in `e2e/helpers.ts`) riconosce l'email
dall'oggetto «Codice di sicurezza» e legge il codice dallo span monospace
dell'HTML: l'invio è solo HTML (il campo Text di Mailpit è vuoto) e la riga
«Codice di firma BluMan: …» esiste solo nel testo WhatsApp.

## Esecuzione

```bash
npm run test:e2e     # prepara l'ambiente (container, migrazioni, seed) e lancia i test
npm run e2e:prepara  # solo la preparazione, senza eseguire i test
```

Prerequisiti: Docker Desktop in esecuzione e i browser Playwright
(`npx playwright install chromium`, una volta sola per macchina).

La preparazione è idempotente: riavvia i container fermi, applica
`prisma migrate deploy`, esegue il seed master solo a database vuoto, poi
l'overlay E2E che ridefinisce sempre utenti, SMTP e progetto di test ai valori
noti, e infine **svuota la coda di Mailpit**: i container sopravvivono tra le
corse e senza flush le email della corsa precedente resterebbero leggibili
dagli helper. La suite gira con `workers: 1`: i flussi condividono lo stesso
database e quello del portale consuma magic link e OTP soggetti a anti-abuso.

## Utenti e dati di test (dall'overlay)

| Cosa | Valore |
| :-- | :-- |
| Password staff (mario, lorenzo) | `E2E_PASSWORD` oppure `E2e-BluMan-2026` |
| Utente invitato (flusso login) | `mario.dibenedetto@bluecode.advisory` |
| Advisor attivo (flusso fattura) | `lorenzo.marino@bluecode.advisory` |
| Cliente portale | `cli-03` — Belfort Industries S.A. |
| Progetto di test | «Incarico E2E — Belfort Industries» (mod-m01 + mod-m02) |

I tre flussi:

- `flusso-login.spec.ts` — login dell'invitato, modale «Primo Accesso», cambio
  password, riaccesso con la nuova credenziale.
- `flusso-portale-firma.spec.ts` — magic link emesso via API, sessione
  passwordless nel portale, OTP via email letto da Mailpit, firma SES senza
  firma grafica, sigillo con Signature ID.
- `flusso-fattura.spec.ts` — scheda progetto, tab Fatturazione & SDI,
  compositore con «Tutte da Fatturare», emissione serie FT e verifica sul
  registro `GET /invoices`.

## Pulizia

```bash
docker rm -f bluman-e2e-pg bluman-e2e-mailpit   # cancella tutto l'ambiente
```

I dati vivono solo nei container: nessuna pulizia del database di produzione è
necessaria (è il motivo per cui `cleanupTestData.ts` è diventato superfluo per
questi test).
