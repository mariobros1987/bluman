# Piano Firma Legale — Etichettatura SES / FEA / FEQ

## BluMan — Portale firma documenti: audit sezione 4 dello spec e piano di adeguamento

Data: 28 agosto 2026 · Riferimento normativo: sezione 4 di `spec-portale-moduli-firma.md` (SES/FEA/FEQ, eIDAS UE 910/2014, art. 20 CAD)

Questo file integra `piano-sviluppo-gap-firma-documenti.md` (i 4 punti operativi sono chiusi) e traduce la **sezione 4 dello spec** in decisioni concrete: cosa il sistema dichiara oggi, cosa dichiara di falso, e come arrivare a un'etichettatura per cui ogni documento firmato porta scritto **esattamente** il valore legale della firma ricevuta.

---

## 1. Audit — cosa c'è già (e regge)

Il flusso firma attuale è solido nella sostanza. Punti di forza verificati sul codice:

| Requisito FEA (spec §4) | Stato attuale | Dove |
|---|---|---|
| Collegamento univoco ai dati firmati | ✅ **Forte** — impronta SHA-256 calcolata **server-side** dal file in archivio (`documento_vault`) o dai dati canonici del modulo (`modulo_completato`); l'hash del browser è ignorato. Solo per `engagement_letter` l'hash arriva dal browser (il testo è composto lì, non c'è alternativa documentata) | `src/routes/firma.ts:687` (`improntaDocumentoDelFascicolo`), `:767` (`improntaModuloCompletato`) |
| Rilevabilità di modifiche successive | ✅ **Forte** — `statoDoc: 'firmato'` è terminale, hard delete vietato (vincolo 9), catena versioni via `documentoPadreId`, sigillo con digest HMAC che lega tutti gli elementi | `firma.ts:846` (`segnaDocumentoFirmato`) |
| Controllo esclusivo del mezzo | 🟡 **Parziale** — OTP a 6 cifre su recapito in anagrafica (o dichiarato, marcato `targetDichiarato`); TTL 5 min, max 3 tentativi, max 3 reinvii a 60 s di distanza; codice hashato, monouso (`usatoAt`) | `src/services/otpService.ts:91,207` |
| Identificazione del firmatario | 🟡 **Parziale** — la sessione portale è vincolata al cliente (`client-<clienteId>`), IP e userAgent finiscono nel sigillo; **ma** `firmatarioNome` è dichiarato liberamente dal body senza riscontro in anagrafica | `firma.ts:1103` (`firmatarioNome = req.body?.signerName ... \|\| cliente.nome`) |
| Verbale / log crittografico | ✅ Presente — PDF probatorio generato server-side, collegato alla firma e al fascicolo | `src/services/verbaleFirma.ts`, `firma.ts:872` (`generaVerbaleDiFirma`) |
| Etichettatura del tipo firma | 🟡 Esiste il campo, manca il livello richiesto — `FirmaElettronica.tipoFirma` (`fea_otp` / `manuale_scansionata` / `qualificata_esterna`) è salvato e il verbale lo stampa; **nessun modello ha un "livello firma richiesto"** (solo boolean `richiedeFirma` / `richiedeFirmaCliente`) | `prisma/schema.prisma:1101`, `:497`, `:530` |

**Conclusione dell'audit**: le garanzie tecniche di collegamento ai dati e anti-manomissione sono già di livello FEA; quello che manca per dichiarare FEA la firma OTP sono le misure di **identificazione** del firmatario, e soprattutto manca — come chiede lo spec — il meccanismo con cui l'operatore **sceglie e impone** il livello di firma per tipo documento.

---

## 2. Audit — le contraddizioni da sanare (etichette FEA false)

Il frontend è già stato rietichettato SES (commit `0509f96`), ma il backend no. Oggi lo stesso evento di firma è descritto in modi contraddittori:

| Dove | Cosa dice | Vero/falso |
|---|---|---|
| `FirmaElettronica.tipoFirma` (DB) | `fea_otp` | **Falso** — OTP semplice è SES (lo dice lo spec: "Un semplice OTP via chat/email non basta a qualificarsi come FEA") |
| `FirmaElettronica.standard` (DB) | `eIDAS UE 910/2014 Advanced Electronic Signature (FEA)` — default di `creaSigilloFea`, mai sovrascritto nel flusso OTP (`firma.ts:1106`) | **Falso** |
| Audit log | azione `FIRMA_FEA_APPOSTA`, dettagli "Firma Elettronica Avanzata…" (`firma.ts:1146-1149`) | **Falso** |
| Notifica a studio/cliente | "Firma Elettronica Semplice (OTP verificata · art. 20 CAD)" | ✅ Vero |
| Frontend portale (modali, attestazioni, badge) | SES ovunque | ✅ Vero |
| Verbale PDF | riga "Tipo di firma" = Semplice ✅, ma riga "Standard di riferimento" = `…Advanced Electronic Signature (FEA)` ❌ (`verbaleFirma.ts:163`) | **Contraddittorio nello stesso atto certificativo** |
| Email OTP | header "Firma Elettronica Avanzata (FEA) eIDAS", footer "Sigillo Digitale Conforme eIDAS UE 910/2014" (`emailService.ts:304,316`) | **Falso** |
| `signatureId` | prefisso `EIDAS-FEA-…` per **tutti** i tipi, inclusa la firma a penna scansionata (`otpService.ts:356`) | **Falso** per `manuale_scansionata`/`qualificata_esterna` |
| Nome funzione | `creaSigilloFea()` usata anche per firme non-FEA | Confondente (solo codice, non atto) |

**Perché importa**: il verbale di firma è un atto che lo studio potrebbe produrre in giudizio. Un atto che dichiara "FEA eIDAS" per una firma che non ne ha i requisiti è peggio di un'etichetta sbagliata: è un'attestazione inesatta su un documento probatorio. Le etichette vanno allineate al **vero** prima di ogni altra cosa.

**Regola sugli atti esistenti**: le righe `FirmaElettronica` già registrate **non si toccano** (sono atti probatori; la riscrittura retroattiva dei valori cambierebbe la storia legale). La correzione vale da ora in poi; per lo storico resta la data di registrazione come discriminante, da dichiarare se mai servisse.

---

## 3. Il modello di etichettatura (cosa chiede lo spec §4)

Tre livelli, un solo campo nuovo di verità:

- **`ses`** — Firma Elettronica Semplice: OTP su recapito verificato. Valore probatorio liberamente valutabile (art. 20 CAD). È **tutto quello che il portale sa fare oggi** via `verify-otp-and-sign`.
- **`fea`** — Firma Elettronica Avanzata: richiede identificazione univoca, controllo esclusivo del mezzo, collegamento univoco, rilevabilità modifiche. L'OTP da solo **non basta** (spec §4): servono le misure aggiuntive della Fase 3.
- **`feq`** — Firma Elettronica Qualificata: SPID/CNS/CIE o certificato qualificato. Oggi l'unico modo per ottenerla è il cliente che firma col proprio provider e **ricarica il file** (`qualificata_esterna`, `firma.ts:1222`): la piattaforma attesta la ricezione, **non** valida il certificato (già dichiarato onestamente nel verbale).

### 3.1 Schema (migrazione additiva, un solo passaggio)

```prisma
// ModelloDocumentoInBianco — il livello che l'operatore impone ai documenti generati da questo template
livelloFirmaRichiesto  String  @default("ses") @map("livello_firma_richiesto")  // ses | fea | feq

// Documento — copiato dal template alla generazione; per i caricamenti manuali lo sceglie l'operatore alla pubblicazione
livelloFirmaRichiesto  String  @default("ses") @map("livello_firma_richiesto")  // ses | fea | feq

// PassaggioProgetto — per la conferma firmata dei moduli (oggi solo boolean richiedeFirmaCliente)
livelloFirmaRichiesto  String  @default("ses") @map("livello_firma_richiesto")  // ses | fea | feq

// FirmaElettronica — il valore legale EFFETTIVO della firma apposta (verità legale, distinto da tipoFirma che è il meccanismo)
valoreLegale           String  @default("ses") @map("valore_legale")            // ses | fea | feq
```

Decisioni:

1. **`tipoFirma` resta com'è** (`fea_otp` incluso): è il *meccanismo*, non il valore legale. Il valore `fea_otp` è storicamente infelice ma i valori del DB sono atti; il nuovo campo `valoreLegale` porta la verità, `descrizioneTipoFirma()` resta la mappa di leggibilità (già corregge in SES). Nessun rename di righe esistenti.
2. **`valoreLegale` sulle firme future** viene scritto dalle rotte di firma: `ses` per `verify-otp-and-sign`; il valore del documento per `firma-con-file` (`qualificata_esterna` → `feq`; `manuale_scansionata` → `ses`, con l'attestazione di ricezione già onesta nel `canaleVerificato`).
3. **Default `ses`** ovunque: nessun comportamento esistente cambia finché l'operatore non alza un livello.
4. Il **verbale** stampa una riga nuova "Valore legale della firma" accanto a "Tipo di firma" e "Standard di riferimento".

### 3.2 Enforcement server-side (il livello non è cosmetico)

- `POST /portal/verify-otp-and-sign` e `POST /portal/firma-con-file` risolvono il livello richiesto del documento (da `Documento.livelloFirmaRichiesto`, o dal `PassaggioProgetto` per `modulo_completato`, o dal template per `engagement_letter`):
  - livello richiesto `ses` → tutto come oggi;
  - livello `fea` → OTP **consentito**: il flusso misurato della Fase 3 lo produce (grafometrica obbligatoria + sessione certificata nel digest); firma-con-file solo con `qualificata_esterna` (il valore legale superiore soddisfa anche l'esigenza inferiore), mentre la sottoscrizione autografa scansionata è respinta con 409 "sottoscrizione autografa scansionata non è sufficiente";
  - livello `feq` → **409** sulla rotta OTP; `firma-con-file` con `qualificata_esterna` è ammesso (è l'unico modo attuale di ottenere FEQ).
- `GET /portal/documenti` espone `livelloFirmaRichiesto`; il frontend nasconde il pulsante firma OTP quando il livello è `fea`/`feq` e mostra il percorso adeguato.
- L'operatore può cambiare il livello di un documento pubblicato **finché non è firmato**; dopo la firma il campo è immodificabile (stesso principio di `statoDoc: 'firmato'`).

### 3.3 API operatore

- `PATCH /documenti/:id` (o il punto di pubblicazione esistente) accetta `livelloFirmaRichiesto`;
- il form template (`POST/PUT /documenti-template`) espone il livello con default `ses`;
- `GET /firme` restituisce anche `valoreLegale`.

---

## 4. Le fasi

### Fase 1 — Verità nelle etichette (immediata, nessun cambio di comportamento) — ✅ completata 28/08/2026
1. ✅ `verify-otp-and-sign` passa a `creaSigilloFea` uno `standard` esplicito: `'Firma Elettronica Semplice (SES) · art. 20 CAD — eIDAS UE 910/2014 art. 3 n. 10'` (costante `STANDARD_SES` in `otpService.ts`).
2. ✅ `firma-con-file` già sovrascrive `standard` onestamente; ora passa anche `valoreLegale: 'feq'` per il file qualificato esterno, `'ses'` per la scansione autografa.
3. ✅ Default di `creaSigilloFea`: da `…Advanced Electronic Signature (FEA)` a `STANDARD_SES` (chi non dichiara uno standard ottiene l'etichetta **più prudente**, mai la più forte).
4. ✅ `signatureId`: prefisso per valore legale (`SIGILLO-SES-`, predisposti `SIGILLO-FEA-`/`SIGILLO-FEQ-`); gli id esistenti restano `EIDAS-FEA-…`.
5. ✅ Audit: nuova azione `FIRMA_SES_APPOSTA` (la `FIRMA_FEA_APPOSTA` storica resta leggibile nei log già scritti); dettagli senza la parola "Avanzata".
6. ✅ `emailService.ts`: header/footer email OTP → "Firma Elettronica Semplice (OTP) · art. 20 CAD"; corpo "per la firma digitale di" → "per la firma di" (non si promette firma digitale); risposta HTTP di `verify-otp-and-sign` → "Firma Elettronica Semplice registrata (art. 20 CAD)".
7. ✅ Test: `verbaleFirma.test.ts` aggiornato sulle nuove etichette + nuovo test che il flusso OTP non produca **da nessuna parte** (DB, audit, verbale PDF, notifiche) la parola "Avanzata"; `newFeatures.test.ts` sul prefisso `SIGILLO-SES-`. Suite: 353/353 verdi, `tsc --noEmit` pulito, `verifyAll.ts` 13/13.

### Fase 2 — Etichettatura per tipo documento (migrazione + enforcement) — ✅ completata 28/08/2026
1. ✅ Migrazione additiva (§3.1) — 4 colonne, tutte con default: `20260828120000_livello_firma_richiesto_e_valore_legale` (DocumentoVault.livelloFirmaRichiesto, ModuloDocumentoPassaggio.livelloFirmaRichiesto, FirmaElettronica.valoreLegale) e `20260828150000_livello_firma_modello_documento_custom` (ModelloDocumentoCustom.livelloFirmaRichiesto); `npx prisma generate`.
2. ✅ Enforcement §3.2 sulle due rotte di firma (`livelloRichiestoPerFirma` in `src/routes/firma.ts` gestisce entrambi gli ambiti: `documento_vault` legge `doc.livelloFirmaRichiesto`; `modulo_completato` calcola il `livelloPiuAlto` sui passaggi del modulo) + esposizione nel portale (GET /portal/documenti e GET /progetti/:id espongono `livelloFirmaRichiesto` normalizzato).
3. ✅ UI operatore: scelta livello su template (`ModaleNuovoTemplate`), su documento alla pubblicazione (`DocumentEditorPage`), sul passaggio di modulo (`ModaleConfigFirma`/`PassaggioModal`); UI portale: gating a tre livelli — `TabDocumenti` mostra solo il canale ammesso (badge FEA ambra / FEQ viola), guard preventivo in `avviaFirmaDocumento` (`ClientPortal.tsx`: livello ≠ ses → modale con avviso, nessun invio di codice consumato), `InvioManualeModal` blocca la modalità scansionata quando il documento esige feq; `livelloFirma.ts` condivide le etichette e gli avvisi allineati 1:1 ai 409 del server (`livelloFirmaService.ts`).
4. ✅ Verbale: riga "Valore legale della firma" (`verbaleFirma.ts`).
5. ✅ Test: `livelloFirmaService.test.ts` 13 test (messaggi 409, normalizzazione, livelloPiuAlto); regressione piena: **373/373 verdi in 28 file**, `tsc --noEmit` pulito, `npx tsc -b` frontend EXIT 0.

### Fase 3 — Misure FEA reali — ✅ completata 29/08/2026 (approvata dal titolare, §6.1)
Le quattro misure del §4, tutte attuate senza integrazioni esterne:
1. ✅ **Identificazione del firmatario**: `firmatariAmmessi(cliente)` in `src/routes/firma.ts` (elenco chiuso: `cliente.nome` per persona fisica o referenti in `referentiJson.legaleRappresentante`), esposto da `GET /portal/canali-firma` come `firmatariAmmessi` e validato in tutte e tre le rotte di firma (request-otp, verify-otp-and-sign, firma-con-file) — niente più nomi liberi nel body. Caricamento una-tantum del documento di riconoscimento: `scanFileBuffer` (securityScanner) + hash nel digest del sigillo; campi `doc_riconoscimento_hash`/`doc_riconoscimento_tipo` sulla `firma_elettronica` (migrazione `20260828180000_firma_fea_sessione_e_identificazione`, solo colonne nullable).
2. ✅ **Controllo esclusivo rafforzato**: grafometrica **obbligatoria** quando il livello è `fea` — la rotta request-otp risponde 400 *prima* di consumare un invio di codice se il frontend non la imposta (opzione "doppio canale" scartata: OTP su due recapiti è raro nello studio professionale).
3. ✅ **Certificato di sessione**: `sessionId` (sid del login portale) + `loginAt` (iat) nel payload del digest del sigillo (`otpService.ts` creaSigilloFea, ora 10 elementi) — propagate da `jwt.ts` → `auth.ts` → rotte di firma; campi `session_id`/`login_at` persistiti sulla firma. Le firme SES passano `null` sui 4 parametri FEA → digest **identico** a prima (byte-compatibile).
4. ✅ `valoreLegale: 'fea'` scritto dal flusso OTP misurato, con audit dedicato `FIRMA_FEA_APPOSTA` (il SES continua con `FIRMA_SES_APPOSTA`); verbale con righe condizionali (documento di riconoscimento, sessione, grafometrica) omesse per le firme SES storiche; `verificaLivelloFirma` Fase 3: fea+otp consentito, fea+file solo `qualificata_esterna`.
Frontend: `FirmaOtpModal.tsx` (selettore firmatario ammesso, upload documento di riconoscimento, grafica obbligatoria quando fea), `TabDocumenti.tsx` (gating per livello), `ClientPortal.tsx` (`livelloFirmaModale` con un solo punto di verità in `inviaCodiceFirma`), `api/firma.ts` con `firmatariAmmessi` e i campi FEA. Test: suite **375/375 verdi in 28 file**, `tsc --noEmit` pulito, `npx tsc -b` frontend EXIT 0.

### Fase 4 — FEQ nativa (decisione commerciale, provider esterno)
Il ri-caricamento di file qualificato (`qualificata_esterna`) copre già il caso FEQ senza integrazioni. Un'integrazione diretta (Aruba/InfoCert/Namirial, SPID/CIE) è un progetto separato: costi, contratto col provider e responsabilità della verifica certificato cambiano. Non è un prerequisito delle Fasi 1–3.

---

## 5. Rischi e vincoli rispettati

- **Atti esistenti intoccabili**: nessuna riscrittura di righe `FirmaElettronica` (vincolo 9 esteso ai valori probatori); le correzioni di Fase 1 valgono dalle firme future.
- **Migrazione additiva**: solo colonne con default; mai `db push --accept-data-loss` (vincolo 2).
- **RLS**: i campi nuovi seguono le colonne esistenti (stesse tabelle, nessun nuovo privilegio).
- **Default prudente**: finché l'operatore non decide, ogni documento è `ses` — il sistema non dichiara mai più di quanto garantisce.
- **Niente dati inventati dal frontend** (vincolo 7): `livelloFirmaRichiesto` e `valoreLegale` vivono solo nel server e nel DB; il portale li mostra, non li produce.

## 6. Domande aperte per il titolare

1. ✅ **Risposta 28/08/2026** — Sì: lo studio vuole offrire firme FEA "vere". La Fase 3 è entrata nel piano di lavoro ed è stata **completata il 29/08/2026** (vedi sopra).
2. ✅ **Risposta 28/08/2026** (implicita nell'approvazione della Fase 2 con enforcement) — Il livello `feq` **blocca** il flusso OTP (409) finché il cliente non firma col proprio provider; niente degradazione silenziosa a SES.
3. ⚠️ **Regola adottata in implementazione** — Per livelli `fea`/`feq` l'hash deve essere **server-side** (documento generato dal server, `POST /documenti/genera`); l'hash composto dal browser resta ammesso solo per documenti `ses`. Se il titolare vuole diversamente, dirlo e si cambia.
4. ✅ **Risposta 28/08/2026** (Fase 4) — Niente integrazione diretta con provider: resta il ri-caricamento del file firmato dal cliente (`qualificata_esterna`), già funzionante e onestamente etichettato FEQ dalla Fase 1.

## 7. Interventi 21/09/2026 (post-audit) e follow-up esterni

Dall'audit del 21/09/2026 (vedi `ANALISI_APPROFONDITA_2026-09-21.md`), corretto lato codice:

- **Sigillo con chiave.** `creaSigilloFea` (`otpService.ts`) non calcola più un SHA-256 in chiaro del payload — ricalcolabile da chiunque conosca i campi — ma un **HMAC-SHA256 con una chiave del server** (`SIGILLO_HMAC_SECRET`, ripiego su `JWT_SECRET`). L'impronta ora prova che è stata la piattaforma a sigillare (integrità + non ripudio lato piattaforma), non è più una semplice checksum. In produzione la chiave è obbligatoria (≥32 char) o l'avvio si ferma; il nome del campo resta `sha256Digest` (64 hex) per compatibilità con verbali e DB storici.
- **FEQ onesta — verifica di PRESENZA della firma.** Un file caricato come `qualificata_esterna` ora deve contenere davvero una struttura di firma digitale (PAdES nel PDF, oppure contenitore PKCS#7/CAdES `.p7m/.p7s`), verificata da `firmaFileValidazione.ts`. Vale su **entrambi** i canali: cliente (`routes/firma.ts` `/portal/firma-con-file`) e studio (`routes/documentiFirmaStudio.ts`). Un PDF qualunque viene ora respinto con 422, chiudendo il buco "qualunque file soddisfa un requisito FEQ".

**Follow-up che richiedono provider esterni (NON implementati — servono decisioni del titolare):**

1. **Validazione crittografica completa del certificato.** Oggi la piattaforma verifica solo che una firma sia PRESENTE, non la valida (catena, revoca CRL/OCSP, stato "qualificato" via EU Trust List). Serve una libreria/servizio dedicato (es. DSS eIDAS). Finché non c'è, il verbale continua a dichiarare onestamente che il certificato non è validato dalla piattaforma.
2. **Marca temporale qualificata (RFC 3161).** Il `timestampIso` del sigillo è l'orologio del server, non una data certa opponibile ai terzi. Serve un contratto con una TSA (Time Stamping Authority) qualificata e l'apposizione della marca sul digest. Decidere il provider TSA.

---

## 8. Decisioni del titolare — 3 ottobre 2026

Chiudono le domande del §6.3 e i follow-up del §7, e fissano cosa fare sulla firma dello studio. Da qui in poi queste scelte **non si riaprono** senza una ragione nuova.

### 8.1 Controfirma bidirezionale: sì, ma solo sulla lettera d'incarico
La controfirma (studio **e** cliente sullo stesso documento, con la cronologia di entrambe le firme sul PDF finale) resta, **limitata all'ambito `engagement_letter`**. È il caso classico: il cliente firma per accettazione, lo studio controfirma.

Conseguenze sul codice (i tre difetti di `src/services/copiaFirmata.ts`, **tutti chiusi il 03/10/2026**, migrazione `20261003120000_firma_parte_e_sigillo`):
- **Provenienza scritta nel dato, non dedotta.** ~~Oggi `copiaFirmata.ts:186,216,240` riconoscono lo studio annusando la stringa~~ → **fatto**: due colonne nuove su `FirmaElettronica`, `parte` (`cliente`|`studio`) e `sigilloDigest`, scritte dalle quattro `create` (due rotte cliente, due rotte studio). Tutte le letture della parte usano `parte`: `copiaFirmata.ts` (riquadri e cronologia), `effettiFirma.ts` (`segnaDocumentoFirmato`), `routes/documenti.ts`, `routes/firma.ts` (elenco del portale, firme orfane). La vecchia deduzione sopravvive solo nel backfill della migrazione, che assegna `studio` alle righe con `tipo_firma = 'studio'` **e** a quelle del ramo file dello studio (canale `Firma Digitale Qualificata Esterna` / `Copia Cartacea Controfirmata`: stringhe che scrive solo quella rotta, chiusa ad advisor/super_admin).
- **Sigillo persistito per parte.** ~~`copiaFirmata.ts:195,225` leggono `firmaStudioDb.sigilloDigest`, campo che nello schema non esiste~~ → **fatto**: il digest è persistito a ogni firma e riletto. Rimosso il ripiego `|| sigilloDigest`, che stampava sotto il nome di una parte l'impronta dell'evento in corso. Per le firme anteriori l'impronta non è ricostruibile (l'HMAC include IP, sessione e istante) e la riga dice `Sigillo SHA-256 non registrato`, come il verbale fa con l'IP mancante.
- **Anti-ri-firma per parte corretto.** ~~`documentiFirmaStudio.ts:74` filtra `tipoFirma: 'studio'`~~ → **fatto**: la guardia dello studio filtra `parte: 'studio'` e quella del cliente (`firma.ts`) `parte: 'cliente'`.

**Punto aperto, da chiarire col titolare.** Il meccanismo di controfirma che esiste nel codice non sta sulla lettera d'incarico: `generaCopiaFirmata` è invocata solo per l'ambito `documento_vault`, e le due aree firma (`{{firma_cliente}}`/`{{firma_studio}}`) vivono nei template del Document Studio — i 22 modelli di riorganizzazione societaria chiudono tutti con quell'area a due colonne. L'ambito `engagement_letter` non passa da qui: la lettera si firma e la sua prova è la riga `firma_elettronica`, senza ricomposizione. Quindi «limitata a `engagement_letter`» **non è oggi una restrizione applicata**: applicarla significherebbe rendere lo slot `{{firma_studio}}` non riempibile su quei 22 template, e i test di §36 (`copiaFirmata.test.ts`, `e2eFlussiCritici.test.ts`) coprono proprio quel caso. Il 03/10/2026 ho chiuso i tre difetti di integrità — che valgono su qualunque documento — senza introdurre la restrizione, perché sarebbe un cambio di comportamento su una funzione esistente e documentata. Serve una riga di conferma: **(a)** la controfirma resta ammessa sui documenti del Vault con area a due colonne (lettura che consiglio), oppure **(b)** la si limita davvero, e allora si decide anche cosa diventa lo slot `{{firma_studio}}` su quei template.

### 8.2 Chi firma a nome dello studio
Solo **advisor e super_admin**. Firmare per lo studio impegna lo studio: è funzione da titolare, non un permesso documenti generico. Oggi la rotta blocca solo `req.ruolo === 'cliente'` (`documentiFirmaStudio.ts:45`), quindi basta che un admin conceda `documents:write` in matrice perché un collaboratore firmi a nome dello studio. La guardia va cablata nella rotta.

### 8.3 Il percorso studio si allinea a quello cliente
La firma dello studio deve comportarsi come quella del cliente su tre punti, oggi mancanti in `src/routes/documentiFirmaStudio.ts`:
- **guardia `statoDoc === 'bozza'`** (il percorso cliente la ha: `firma.ts:955`, 409 «non è firmabile finché non viene pubblicato»);
- **aggiornamento dello `statoDoc` del documento padre** (il percorso cliente chiama `segnaDocumentoFirmato`, `firma.ts:1200`);
- **verbale di firma** (il percorso cliente chiama `generaVerbaleDiFirma`, `firma.ts:1275`). Con la controfirma limitata alla lettera d'incarico (§8.1), il verbale a due parti resta **uno solo**, aggiornato dalla seconda firma.

### 8.4 L'hash della lettera d'incarico lo calcola il server
Chiude la deroga del §6.3. L'hash della lettera d'incarico — l'atto che fa partire il progetto — **non** arriva più dal browser: il server rilegge il file e calcola il digest. Oggi lo dichiara il client (`firma.ts:1494-1501`). La regola del §6.3 (server-side per `fea`/`feq`, browser ammesso per `ses`) **non si applica più alla lettera**: per questo documento è sempre server-side, a qualsiasi livello.

### 8.5 Marca temporale qualificata (RFC 3161) — rinviata
Il follow-up §7.2 **resta rinviato**: in produzione c'è solo traffico di prova e nessun cliente reale, quindi il tempo resta l'orologio del server finché non serve davvero. Si attiverà scegliendo allora il provider TSA. Il rilievo D3 resta aperto **con motivo scritto**, non dimenticato.

### 8.6 Validazione dei certificati FEQ — per ora no
Il follow-up §7.1 **non si implementa ora**: si continua a verificare la **presenza** della firma (`firmaFileValidazione.ts`) e il verbale dichiara che il certificato non è validato dalla piattaforma. La validazione piena (catena, CRL/OCSP, EU Trust List, es. EU DSS) si farà quando le firme qualificate esterne diventeranno frequenti.

### 8.7 Le due firme di prova senza progetto — lasciate «IN ATTESA»
Le due firme di lettera d'incarico con `riferimento_id` NULL (24/08 e 08/09/2026, dati di prova, precedenti al 02/10) **restano come sono**: non firmano nessun progetto, e la lettura «IN ATTESA» è quella veritiera. Nessun backfill (ricostruirebbe un fatto che non è avvenuto) e nessuna cancellazione (operazione distruttiva su dati di produzione).
