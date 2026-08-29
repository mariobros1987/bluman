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
