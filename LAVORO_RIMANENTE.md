# Lavoro rimanente — BluMan

**Ultimo aggiornamento:** 20/10/2026. Fonte: verifica diretta nel codice, non nelle caselle dei piani.

Questo è l'unico elenco da leggere prima di riprendere un lavoro. Se contraddice un altro file
(`PIANO_DI_MIGLIORAMENTO.md`, `BluMan_analisi_professionale.md`, `.agents/BluMan_piano_di_sviluppo.md`),
vale questo: quegli altri sono vecchi e le loro caselle mentono in tutte e due le direzioni.
Quando una voce è chiusa si toglie da qui e si annota in «Fatto, verificato» con data e commit.

## Decisioni del 17/10/2026

1. Si parte dal **codice**: KYC e firma.
2. KYC esterno: **cercare un fornitore** (visura e liste PEP/sanzioni), non più solo inserimento a mano.
3. Firma: **cercare un servizio** di marca temporale (anche gratuito per iniziare).
4. Fisco (F24 automatico, Certificazione Unica, conservazione a norma): **dopo, quando servirà**.
5. Le **credenziali dei servizi esterni** si inseriscono dalle Impostazioni (predisposte il 17/10/2026).

---

## P1 — Codice: KYC e firma (si comincia qui)

### P1.1 — Fornitore KYC esterno

**Cosa manca.** `src/services/verificaEsternaKyc.ts` è solo interfaccia + stub: nessuna visura
Registro Imprese, nessuna lista PEP/sanzioni. Il resto del KYC (portale, fascicoli, screening
manuale, pannelli, cron) c'è già.

**Predisposto il 17/10/2026.** Tabella `credenziale_servizio_esterno` (una riga per servizio,
per studio, con RLS), rotte `GET/PUT /tenant/servizi-esterni/:servizio` e scheda
Impostazioni → «🔑 Servizi esterni (Malta)». I segreti non tornano mai al browser (solo coda
mascherata) e non finiscono nel registro di compliance. Servizi previsti: `kyc_visura`,
`kyc_screening`, `tsa`.

**Cosa deve offrire il fornitore.** Copertura Malta + Italia; visura camerale; liste PEP e sanzioni
(UE, ONU, OFAC); screening iniziale e continuo; API con documentazione; dati trattati in UE;
contratto/DPA; prezzo per pratica e minimo.

**Ricerca del 17/10/2026 — candidati (pagine ufficiali, da riconfermare al momento del contratto):**

- **Kyckr** (<https://www.kyckr.com>): accesso diretto al **Malta Business Registry** e ad altri
  299+ registri, API REST JSON, pagamento a chiamata senza minimi. Fa **solo** dati di registro
  (visura, UBO, documenti): non fa screening PEP/sanzioni, va abbinato.
- **ComplyCube** (<https://www.complycube.com>): screening PEP/sanzioni/media negativi + KYB.
  Prezzi pubblici: Starter 99 $/mese (1.000 crediti, screening 0,50 $/controllo), Core 299 $/mese
  (0,35 $/controllo), prova di 14 giorni con 50 controlli gratuiti. Copertura Malta da confermare.
- **Sanction Scanner** (<https://www.sanctionscanner.com>): 3.000+ liste, 220+ paesi, API REST,
  800+ clienti, anche KYB. Prezzi su richiesta.
- **Sumsub** (<https://www.sumsub.com>): KYB con 30.000+ fonti in 220+ paesi e screening su
  11.000+ fonti. Prezzi su richiesta; impronta più enterprise.

**Proposta.** Kyckr per la visura; ComplyCube per lo screening (la prova gratuita permette di
provarlo su nomi veri); Sanction Scanner come alternativa da confrontare sul prezzo. La scelta
finale resta del titolare.

**Poi.** Scegliere 2 candidati, provarli su una pratica vera, scrivere l'adapter che legge le
credenziali dal database e chiama il fornitore, gestire timeout/errore senza bloccare la pratica
per un disservizio del fornitore.

### P1.2 — Marca temporale e validazione della firma

**Cosa manca.** La firma PAdES/PKCS#7 si valida, ma:
(a) ~~il client RFC 3161 non è usato dal flusso di firma~~ — **collegato il 20/10/2026** (sotto);
(b) `src/services/firmaFileValidazione.ts:12` dichiara di **non** controllare catena del
certificato, CRL/OCSP e EU Trust List.

**Predisposto il 17/10/2026.** Le credenziali TSA si salvano dalla stessa scheda «Servizi esterni»
(servizio `tsa`): indirizzo RFC 3161, utenza e segreto.

**Cosa deve offrire il servizio.** RFC 3161 (qualificato eIDAS o, per iniziare, gratuito);
catena del certificato disponibile; costi e disponibilità; come si verifica la risposta della TSA.

**Ricerca del 17/10/2026 — candidati:**

- **FreeTSA** (<https://freetsa.org/tsr>): gratuito, RFC 3161, SHA-1/224/256/384/512, OCSP e CRL,
  certificato valido fino a febbraio 2040. **Non** è qualificato eIDAS e non ha un contratto/SLA:
  adatto per sviluppo e per iniziare.
- **DigiCert** (<http://timestamp.digicert.com>): gratuito, RFC 3161; certificati ruotati ogni
  ~15 mesi. **Non** qualificato.
- **Marca temporale qualificata**: Malta **non ha** un proprio servizio di marca temporale (nella
  lista di fiducia dell'MCA risultano solo certificati, nessun timestamp). Si usa un QTSP di un
  altro Stato UE, riconosciuto in tutta l'UE. In Italia risultano attivi, tra gli altri: ArubaPEC,
  Actalis, InfoCert, Namirial, Poste Italiane, Intesi Group, Register, InfoCamere, TeamSystem,
  Notartel, Telecom Italia Trust Technologies, Zucchetti, Uanataca. Serve un contratto e le
  credenziali (utenza/password o certificato cliente).

**Proposta.** Integrare subito FreeTSA dietro l'interfaccia TSA (credenziali `tsa`); passare a un
QTSP quando serve la marca qualificata per la conservazione a norma.

**Fatto il 17/10/2026 — adapter TSA (FreeTSA).** `src/services/marcaTemporaleService.ts` costruisce
e legge RFC 3161 senza dipendenze (`node:crypto` + `fetch`): stato, impronta, nonce, `genTime`,
policy, seriale; il token base64 è pronto per essere conservato accanto al documento. Prova di
collegamento in Impostazioni → Servizi esterni → «Verifica collegamento» (POST
`/tenant/servizi-esterni/tsa/verifica`: marca un'impronta casuale e non conserva nulla).
11 test in `src/marcaTemporale.test.ts`, tarati su una risposta **vera** di FreeTSA del 17/10/2026.
Senza riga `tsa` si usa FreeTSA; una riga configurata vince sempre, e se il database non si legge
l'errore si propaga — nessun ripiego silenzioso su un'altra TSA.

**Limite dichiarato, non nascosto.** Il token viene legato all'impronta e al nonce, ma la **firma
CMS del token, la catena del certificato e la revoca non sono verificate**: ogni esito riuscito
porta un `avviso` che lo dice. Per la verifica completa serve un servizio DSS/eIDAS o
`openssl ts -verify`. FreeTSA inoltre **non è qualificata eIDAS**: va bene per iniziare, non per la
conservazione a norma.

**Fatto il 20/10/2026 — il token è collegato al flusso di firma.** Al momento della firma il
server chiede alla TSA di marcare il **digest del sigillo** (i 32 byte dell'HMAC, non l'impronta
del documento: il token attesta l'evento di firma, e si verifica con
`openssl ts -verify -token_in -digest <sigilloDigest> -in token.tsr -CAfile freetsa-cacert.pem`).
`marcaTemporaleFirma`
(`src/services/marcaTemporaleService.ts`) conserva token, impronta, TSA, `genTime`, policy,
seriale e SHA-256 del token in nove colonne additive di `firma_elettronica`
(migrazione `20261020120000_marca_temporale_firma`).
La marca è richiesta **dopo** la registrazione della firma, con timeout di 5 s, e **non può
farla fallire**: un guasto della TSA resta scritto in `marca_temporale_errore` e il verbale lo
dichiara. È collegata a tutti e quattro i punti che creano una firma: portale OTP, portale con
file, studio grafometrica/OTP e studio con file. La ricevuta mostra ora attestata, TSA e seriale
e scarica il `.tsr` (`GET /firme/:id/marca-temporale`, tenant + proprietario cliente); il verbale
ha una sezione «Marca temporale RFC 3161» con l'impronta marcata e il limite di verifica.
Test: 14 in `src/marcaTemporale.test.ts` (3 nuovi sulla firma) e 3 di rotta in
`src/marcaTemporaleFirmaRotta.test.ts`. **Limite del test**: la risposta di FreeTSA usata non
può avere in anticipo nonce e impronta della richiesta, quindi il fixture viene patchato su
quei due campi; la firma CMS del token non viene ricalcolata — coerente col limite dichiarato
dell'adapter. La prova dal vivo resta il pulsante «Verifica collegamento» in Impostazioni.

**Fatto il 20/10/2026 — il token è verificato anche da OpenSSL.** `src/marcaTemporaleOpenssl.test.ts`
prende il token prodotto dal nostro parser e lo dà a `openssl ts -verify` con l'ancora di fiducia
di FreeTSA (`src/test-fixtures/freetsa-cacert.pem`, preso da <https://freetsa.org/files/cacert.pem>
il 20/10/2026): quattro casi, token valido → `Verification: OK`; impronta diversa → rifiutato;
un byte manomesso dentro la firma CMS → rifiutato (è la prova che la firma viene davvero
controllata); ancora di fiducia presente e leggibile. Il test si salta se `openssl` non è nel
PATH — sul VPS c'è (il `Dockerfile` installa `openssl` su alpine). Due cose imparate scrivendolo:
il file conservato è il **TimeStampToken**, non la TimeStampResp, quindi serve `-token_in` (senza,
openssl si ferma su `status_info`); e la risposta vera è condivisa con `marcaTemporale.test.ts`
in `src/test-fixtures/freetsa.ts`, per non avere due copie che divergono.

**Poi.** Passare a un QTSP quando serve la marca qualificata per la conservazione a norma.

### P1.3 — Export goAML (K8b)

**Cosa manca.** Il file XML per la FIAU. Oggi si registra solo il riferimento della segnalazione.
**Bloccato** dallo schema XSD della FIAU: senza, ogni implementazione è a indovinare.

---

## P2 — Rischio dati (non è codice, è mezza giornata)

Va fatto **presto e in parallelo**, anche se si parte dal codice: è l'unico rischio irreversibile.

- **Copia off-site:** `/var/lib/bluman-backup/config/rclone.conf` è assente, quindi `copia-remota`
  è rossa e tutti i backup stanno sullo stesso disco del database. Serve `rclone authorize dropbox`
  e il token dal pannello super admin. Il token **non** va scritto in questo file né nel `.env`.
- **Chiave su carta:** va scritta a mano e provata con un restore **da un'altra macchina**.
  Il restore del 17/10 ha usato la chiave letta dal server.
- **Minore:** i file `.enc` sono `664`; uno `umask 077` nello script chiuderebbe la lettura agli
  altri account locali.

---

## P3 — Dati veri dello studio (prima della prima fattura)

Nella riga `tenant` di produzione: telefono `555…`, IBAN di esempio ripetuto in `note_pie_fattura`,
PEC su casella ordinaria, `regime_fiscale` IRES/IRAP con giurisdizione Malta, `lead_advisor` del seed.
Vanno corretti in Impostazioni. Nel catalogo: 60 righe di `articolo` per 53 voci (seed applicato due
volte) e la voce `SMOKE TEST Articolo Prova` — sono cancellazioni di dati di produzione, quindi
**si chiedono**.

---

## P4 — Completamenti (pomeriggi, nessuno blocca)

- **Validazione zod**: restano **29** `Record<string, any>` in **5** file di rotte (dai 39 in 8
  del 20/10/2026; `notifiche.ts`, `progetti.ts` e `compliance.ts` sono chiusi): `kyc.ts` 12,
  `tenant.ts` 9, `clienti.ts` 6, `webhooks.ts` 1, `portale.ts` 1. Gli ultimi due non sono
  corpi non validati: il webhook WhatsApp è JSON esterno (autenticato via HMAC, la forma la detta
  Meta) e in `portale.ts` è un helper, non una richiesta.
- **Sentry**: codice pronto, ma `SENTRY_DSN` e `VITE_SENTRY_DSN` non sono nel `.env` del VPS:
  oggi non raccoglie niente.
- **Accessibilità**: i pulsanti che mostrano solo un simbolo (✕ di chiusura, ← indietro) hanno ora
  un nome accessibile in tutti i file del frontend (12 corretti il 20/10/2026). Resta da fare il
  controllo dei campi modulo: l'etichetta è spesso solo visiva accanto all'input, e in jsdom i test
  non lo vedono. Le tabelle L3 sono già coperte (30 wrapper di scroll in 25 file).
- **Cifratura a riposo dei segreti nel database**: oggi le credenziali dei canali (WhatsApp,
  Telegram, SMTP) e le nuove credenziali dei servizi esterni stanno in chiaro nelle rispettive
  tabelle, protette da RLS e dai backup cifrati. Se si vuole una cassaforte con chiave separata,
  è un lavoro a sé (nuova variabile d'ambiente + migrazione dei valori esistenti).

### Chiusi il 20/10/2026

- **SSE lato client**: `ComunicazioniTab` si sottoscrive a `/stream` e si aggiorna sul frame
  `messaggio_cliente` della *sua* pratica; resta un giro periodico a 60 s che riprende i frame
  persi e scarica la posta IMAP (quella la tira il browser, non il backend).
- **CORS**: una `CORS_ORIGINS` dichiarata ora **sostituisce** i default invece di fondersi con
  loro, quindi `*.vercel.app` si può togliere da `.env`; `/stream` riflette l'`Origin` solo se è
  in whitelist. Il `.env` del VPS dichiara già le origini vere, quindi lì non cambia niente.
- **Modulo senza voci**: `POST /progetti/:id/moduli/:moduloId/ripristina-microvoci` ricrea le
  micro-voci dalla distinta del modulo di libreria con cui il modulo è nato. Serve ai moduli
  istanziati quando il template non aveva ancora articoli: da lì non c'era nessun modo di
  riempirli. Solo su moduli vuoti (409 altrimenti), additivo, con audit.
- **Deploy verso il progetto giusto**: `distribuisci.sh` passa ora `-p`/`-s`/`-e` espliciti
  (`RAILWAY_PROJECT`/`RAILWAY_SERVICE`/`RAILWAY_ENVIRONMENT`, default `bluman-backend` →
  `bluman-api`), invece di fidarsi del link della CLI. La verifica post-deploy aspetta che il
  deployment attivo **cambi** ed è `RUNNING`: prima bastava `/health`, che risponde anche con
  l'immagine vecchia e faceva passare per riuscito un deploy fallito.
- **Progetto Railway `Bluman` cancellato** (20/10/2026, su richiesta dell'utente): era il
  residuo creato per sbaglio da un `railway up` senza link, col servizio `Bluman` in crash per
  `DIRECT_URL` mancante. Non conteneva database né volumi. Railway ne schedula la rimozione
  definitiva (`deletedAt` 22/10/2026); il backend resta `bluman-backend` → `bluman-api`.
- **Coda KYC con approvazione massiva** (20/10/2026): `GET /kyc/coda` elenca le pratiche aperte
  con il motivo per cui non sono approvabili, `POST /kyc/coda/approva` approva fino a 100 id per
  volta riportando **per singolo id** com'è andata (un blocco non ferma gli altri). I gate
  (§8.2 profilo, §8.3 MLRO, §8.4 screening, K9 conservazione) vivono ora in **una sola porta**
  (`transizioneKycConGate`), condivisa con la rotta singola: la coda li **annuncia** tramite
  `valutaApprovazione`, e un test di parità lega il suo verdetto all'esito reale della
  transizione — la coda non può promettere un'approvazione che il backend rifiuterebbe.
  Pagina `/compliance` («Coda KYC / AML»), stessa chiave RBAC `clients`.


---

## P5 — Bloccati da terzi o da decisioni

- **Scelta del fornitore KYC** e **del servizio TSA** (candidati in P1.1 e P1.2: serve una
  decisione del titolare e, per la marca qualificata, un contratto).
- **XSD della FIAU** per l'export goAML (→ P1.3).
- **Secondo studio reale**: l'isolamento multi-tenant non è mai stato provato con due studi veri.
- **`regulatory_profile`**: oggi senza produce solo un avviso (scelta del titolare); l'anagrafica
  KYC dello studio va completata prima dell'operatività piena.
- **WhatsApp**: la ricezione non è mai stata provata con un cliente vero.
- **Email GDPR maltese**: manca testo/fornitore.

---

## Fatto, verificato nel codice il 17/10/2026 — non rifare

- **11 ALTA dell'audit 27/09**: preToken 2FA (`src/routes/auth.ts:820`, `src/totpRotte.test.ts`),
  guardia su `PATCH /tenant/info` (`src/routes/tenant.ts:321`), consuntivazione nel dominio
  (`src/adapters/prisma/prismaApp.ts:870`), KYC gate sulle fatture (`src/routes/progetti.ts:1686`,
  `contabilitaRegistro.ts:47`, `contabilitaFatture.ts:74`), IVA, sigillo HMAC, backup.
- **KYC 5.5.3–5.5.5**: portale, pannelli, cron di monitoraggio.
- **HSTS** (`nginx/default.conf:113`) e **CSP con hash** (`nginx/bluman_app.inc:35`).
- **Backup cifrato + restore provato** (17/10/2026: 73 tabelle, 0 errori). Ricetta nei commenti di
  `scripts/backup-vps.sh`.
- **Playwright E2E** (4 spec), base zod, `.env.example`.
- **Scroll tabelle** (30 wrapper in 25 file).
- **Credenziali dei servizi esterni, predisposizione** (17/10/2026): tabella
  `credenziale_servizio_esterno` + migrazione `20261017180000_credenziali_servizi_esterni`,
  rotte `GET/PUT /tenant/servizi-esterni`, scheda Impostazioni, 10 test di rotta.
  La migrazione si applica al prossimo deploy.
- **Adapter TSA RFC 3161 con FreeTSA** (17/10/2026): `src/services/marcaTemporaleService.ts`,
  rotta POST `/tenant/servizi-esterni/tsa/verifica`, pulsante in Impostazioni, 11 test con una
  risposta reale di FreeTSA. (→ P1.2)
- **Marca temporale collegata alla firma** (20/10/2026): token conservato in
  `firma_elettronica` (migrazione `20261020120000_marca_temporale_firma`), marca su tutti e
  quattro i flussi di firma, `GET /firme/:id/marca-temporale` per il `.tsr`, sezione nel
  verbale e nella ricevuta. La marca non può far fallire la firma; la verifica CMS/catena/
  revoca resta dichiaratamente non fatta (→ P1.2).
- **Token verificato con OpenSSL** (20/10/2026): `src/marcaTemporaleOpenssl.test.ts` (4 test)
  verifica il token conservato con `openssl ts -verify -token_in` e l'ancora di fiducia
  `src/test-fixtures/freetsa-cacert.pem`; un byte manomesso nella firma CMS lo fa rifiutare.
  La risposta reale di FreeTSA è condivisa in `src/test-fixtures/freetsa.ts` (→ P1.2).

---

## Come si usa questo file

- Si aggiorna **quando cambia qualcosa**, non alla fine di un progetto.
- Una voce chiusa si sposta in «Fatto, verificato» con la data e, se c'è, il commit.
- Non si scrivono qui segreti: chiavi, token, URL di battito.
