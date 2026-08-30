# Piano di Sviluppo — Chiusura Gap Workflow Documenti/Firma
## BluMan — Estensione moduli documento, firma, notifiche

Riferimento: `schema.prisma` v2.3 (§WF-DOC, §23bis, Blocco 3).
Questo piano copre i 4 punti aperti dall'audit, in ordine di priorità operativa.

---

## Priorità e sequenza consigliata

1. **Punto 3** (integrità referenziale) — va deciso e implementato per primo perché condiziona come si scrivono i punti 1 e 2 (se si introducono nuove righe collegate a `Documento`/`FirmaElettronica`, l'integrità va già impostata correttamente).
2. **Punto 1** (export PDF/Word) — base per il punto 2 (il verbale è anch'esso un documento esportabile).
3. **Punto 2** (verbale di firma) — dipende dai due precedenti.
4. **Punto 4** (matrice notifiche) — trasversale, si chiude per ultimo perché va agganciata a tutti i nuovi trigger creati sopra.

---

## Stato di avanzamento (aggiornato al 27 agosto 2026)

> Sequenza operativa decisa dal titolare: **3 → 2 → 1 → 4**.

- **Punto 3 — ✅ chiuso il 27/08/2026.** Migrazione additiva `20260827180000_archiviazione_documenti_firmati` (`isArchiviato`/`archiviatoAt`/`archiviatoDaId` su `Documento`, `isArchiviato` su `EngagementLetter`); hard delete vietato con **409** su documento firmato o con firma/OTP pendente collegati — **per tutti, admin inclusi**; `PATCH /documenti/:id/archivia` (solo admin, idempotente, audit `DOCUMENTO_ARCHIVIATO`); liste operative senza archiviati (`?includiArchiviati=true` per lo storico); pulsante «📦 Archivia» nella UI; 17 test in `src/archiviazioneDocumentiFirmati.test.ts`. `riferimentoId` resta stringa libera (niente FK tipizzate), come deciso in questo stesso punto.
- **Punto 2 — ✅ chiuso il 27/08/2026.** Migrazione additiva `20260827210000_verbale_documento_id_firma` (`FirmaElettronica.verbaleDocumentoId` nullable + relation verso `Documento`); builder puro `src/services/verbaleFirma.ts` (pdfkit, `compress:false`); hook `generaVerbaleDiFirma` in `server.ts` subito dopo `FirmaElettronica.create` in `POST /portal/verify-otp-and-sign`: genera il PDF, lo carica nello storage, crea un `Documento` tipo `verbale_firma`/statoDoc `pubblicato` nel progetto di origine (fallback: ultimo progetto del cliente), collega la firma al verbale, audit `VERBALE_FIRMA_GENERATO` e notifica cliente `verbale_disponibile`. **Deviazione**: `Documento.caricatoDa` reso nullable perché l'utente del portale ha `userId = client-<id>` senza riga `User`; il verbale ha `caricatoDa = null` (generato dal sistema). Guard 409: il verbale è atto certificativo → niente hard delete (`DELETE /documenti/:id`) né richieste di revisione (`POST /portal/documenti/:id/richiesta-modifica`). Fallimento della generazione (es. storage giù) non invalida la firma. 14 test in `src/verbaleFirma.test.ts` (builder PDF, guard, flusso E2E con mock prisma+storage).
- **Punto 1 — ✅ chiuso il 27/08/2026.** Decisione titolare 27/08/2026: **Docxtemplater (Word) + pdfkit (PDF)** dallo stesso merge dati — **niente LibreOffice su Railway**; hash legale fissato sul PDF. Migrazione additiva `20260827230000_export_pdf_word_documenti` (`file_pdf_url`, `file_docx_url`, `formato_origine TEXT NOT NULL DEFAULT 'pdf'` su `Documento`). Motore `src/services/generazioneDocumenti.ts` (21 tag identici client/server, risoluzione server-side da DB; pdfkit `compress:false`; docxtemplater `paragraphLoop+linebreaks`); endpoint `POST /documenti/genera` (template grezzo o `modelloId`, produce e archivia PDF+Word, `tipo='compilato'`, `statoScansione='pulito'`, audit `DOCUMENTO_GENERATO`, notifica `documento_da_firmare` se pubblicato); `GET /portal/documenti/:id/download?formato=pdf|docx`; frontend portale con Word nascosto se `fileDocxUrl` assente; `PassaggioModal`/`ProjectDetail` lato operatore preferiscono il Word reale. 32 test in `src/generazioneDocumenti.test.ts`.
- **Punto 4 — ✅ chiuso il 27/08/2026.** Audit riga per riga della matrice + implementazione dei trigger mancanti. Evento `messaggio_cliente` riutilizzato per i tre gap cliente→studio (richiesta modifica documento, richiesta addendum, proposta dati); due **eventi nuovi** per i gap studio→cliente: `risposta_addendum` (solo su stati terminali `pronta`/`rifiutata`, mai su `in_preparazione` che resta rumore interno) e `risposta_proposta_dati` (conferma/rifiuto con motivazione). Deep-link cliente `/portal/proposal` e `/portal/avanzamento` gestiti dal portale; etichette campi in chiaro (`IBAN`, non `iban`). Fix collaterale: wording SES sulla notifica `firma_apposta` allineato al commit `0509f96`. Prerequisito 3 risolto: `canale` è solo `in_app`, i canali esterni esistono solo per l'OTP. 8 test in `src/matriceNotifiche.test.ts` (suite ora a 352).
- **Punto 5 (§36) — ✅ chiuso il 29/08/2026.** La firma entra **dentro** il documento: segnaposto `{{firma_cliente}}` / `{{firma_studio}}` nei template, blocchi risolti persistiti alla generazione (`contenuto_blocchi_json`), ricomposizione in una riga nuova alla firma dal portale. L'originale sigillato non viene mai riscritto. Dettaglio nella sezione qui sotto.
- **Punto 6 (§37) — ✅ chiuso il 29/08/2026.** Archivio documentale dello studio: `GET /documenti/archivio` (albero Cliente → Progetto con i conteggi, **nessuna migrazione**) e la pagina `/archivio` a cartelle. Il contenuto di una cartella resta a `GET /documenti?progettoId=…`: l'archivio è la mappa, non una seconda verità sui documenti. Dettaglio nella sezione qui sotto.
- **§34 — 🔶 diagnosi chiusa il 29/08/2026, verifica in campo aperta.** Il 404 in produzione su `POST /documenti/genera` non viene dal codice: la rotta c'è, ed è nel ramo distribuito. Restano tre cause di configurazione o di deploy, distinguibili con un `curl` sul dominio Railway; dal sandbox quell'host non è raggiungibile, quindi la prova finale è del titolare. Aggiunti nel frattempo i presidi che rendono il guasto riconoscibile invece che muto. Dettaglio nella sezione qui sotto.

---

## Punto 3 — Integrità referenziale `ambito` / `riferimentoId` — ✅ chiuso il 27/08/2026

### Problema
`FirmaElettronica.riferimentoId` e `CodiceOtp.riferimentoId` sono stringhe libere, non FK. Se un `Documento` (o altra entità referenziata) viene cancellato fisicamente, il legame diventa un puntatore a nulla, non rilevabile da Prisma né da un vincolo DB.

### Decisione architetturale
**Non convertire in FK tipizzate** (comporterebbe union type impossibile da esprimere pulitamente in Prisma per più ambiti diversi — engagement_letter, documento_vault, modulo_completato, addendum). Si adotta invece **soft-delete obbligatorio** su tutte le entità referenziabili da una firma.

### Modifiche allo schema
```prisma
model Documento {
  // ...esistente...
  isArchiviato   Boolean   @default(false) @map("is_archiviato")
  archiviatoAt   DateTime? @map("archiviato_at")
  archiviatoDaId String?   @map("archiviato_da_id")
}

model EngagementLetter {
  // ...esistente...
  isArchiviato Boolean @default(false) @map("is_archiviato")
}

model RichiestaAddendum {
  // già ha `stato`: si usa stato per il ciclo di vita, non serve nuovo campo
}
```

### Logica applicativa
- **Vietare l'hard delete** di qualunque riga con `Documento`/`EngagementLetter` referenziata da almeno una `FirmaElettronica.riferimentoId` o `CodiceOtp.riferimentoId` con lo stesso `ambito`.
- Service layer: prima di ogni `delete()` su queste entità, query di controllo:
  ```ts
  const firmeCollegate = await prisma.firmaElettronica.count({
    where: { ambito: 'documento_vault', riferimentoId: documentoId }
  });
  if (firmeCollegate > 0) throw new ConflictError('Documento firmato: non eliminabile, solo archiviabile');
  ```
- Sostituire ovunque nel codice le `delete()` dirette su `Documento` con `update({ isArchiviato: true, archiviatoAt: now() })`.
- I documenti archiviati restano visibili solo in una vista "storico/archivio", esclusi dalle liste operative standard.

### Migrazione
Migrazione additiva (nuove colonne nullable con default), zero downtime. Nessun backfill necessario oltre al default `false`.

### Test da coprire
- Tentativo di cancellazione di un `Documento` con firma collegata → deve fallire con errore esplicito.
- Cancellazione di un `Documento` mai firmato → deve procedere normalmente (hard delete resta permesso lì dove non c'è firma).
- Query di reportistica/audit devono includere gli archiviati quando richiesto esplicitamente.

### Stima
0.5 giornata schema+migrazione, 1 giornata refactor dei punti di cancellazione esistenti (da individuare con grep su `.delete(` sui modelli coinvolti), 0.5 giornata test.

---

## Punto 1 — Export contestuale PDF + Word — ✅ chiuso il 27/08/2026

> **Implementazione** — coerente con il modello previsto, con le precisazioni:
> - Schema realizzato con migrazione additiva `20260827230000_export_pdf_word_documenti`: `file_pdf_url TEXT NULL`, `file_docx_url TEXT NULL`, `formato_origine TEXT NOT NULL DEFAULT 'pdf'` su `Documento`. `fileUrl` resta il master (per i generati coincide con il PDF).
> - **Motore unico** `src/services/generazioneDocumenti.ts`: `contestoTagDocumento` costruisce il contesto dai dati autorevoli di DB (tenant, cliente, progetto); `risolviTagDocumento` sostituisce 21 tag `{{...}}` (identici tra client e server) via split/join; `blocchiDaHtml` riduce l'HTML a blocchi tipizzati (titolo/paragrafo/intestazione/evidenza/firma); `generaPdfDocumento` (pdfkit, `compress:false`) e `generaDocxDocumento` (docxtemplater + pizzip, `paragraphLoop`+`linebreaks`) partono **dallo stesso array di blocchi**. I tag sconosciuti restano letterali.
> - **Risoluzione server-side**: il frontend (`PassaggioModal`) invia il template HTML **grezzo** (placeholder irrisolti) a `POST /documenti/genera`; il merge avviene sul server dai dati di DB, non dallo snapshot localStorage del client — coerenza dei dati legali e un solo merge per entrambi i motori.
> - `POST /documenti/genera` accetta `contenutoHtml` inline oppure `modelloId` (ModelloDocumentoCustom), `titolo`, `categoriaDoc`, `statoDoc` (`bozza`|`pubblicato`), `dataScadenzaDoc`; genera PDF+Word, li carica nello storage e crea il `Documento` con `tipo='compilato'`, `fileUrl=filePdfUrl=uploadPdf.url`, `fileDocxUrl=uploadDocx?.url ?? null`, `formatoOrigine='pdf'`, `statoScansione='pulito'` (byte di sistema, stessa regola del verbale di firma). **Word fallito → audit `DOCUMENTO_WORD_FALLITO` ma non blocca** (edge case previsto); audit `DOCUMENTO_GENERATO` e notifica `documento_da_firmare` se pubblicato.
> - **Hash legale sul PDF per costruzione**: l'hash di firma è calcolato server-side da `leggiFileArchivio(doc.fileUrl)`; con `fileUrl` = PDF master l'impronta probatoria resta sempre sul PDF, il Word non entra nel calcolo.
> - Endpoint portale: `GET /portal/documenti/:id/download?formato=pdf|docx&clienteId=` restituisce `{ url, filename, contentType }` del formato richiesto. `GET /documenti` e `GET /portal/documenti` espongono `filePdfUrl`/`fileDocxUrl`/`formatoOrigine`.
> - **Frontend**: `ClientPortal` (3 punti: elenco, viewer, ricevuta post-firma) usa `scaricaDocumentoPortaleApi` e **nasconde il bottone Word se `fileDocxUrl` è assente**; `PassaggioModal` e `ProjectDetail` (lato operatore) preferiscono il Word reale da `fileDocxUrl` quando presente, con fallback allo stub `.doc` solo per gli allegati manuali privi di docx.
> - Copertura: `src/generazioneDocumenti.test.ts` — 32 test (contesto tag, risoluzione, blocchi da HTML, PDF e DOCX con contenuto decodificato).

### Problema
`Documento.fileUrl` è un campo singolo: non distingue se il file pubblicato è disponibile anche nell'altro formato. La spec richiede che il cliente possa scaricare **sia PDF che Word** dello stesso documento pubblicato.

### Modifiche allo schema
```prisma
model Documento {
  // sostituisce l'uso esclusivo di fileUrl per i documenti generati da template
  fileUrl      String   @map("file_url")       // resta il "primario" (retrocompatibilità)
  filePdfUrl   String?  @map("file_pdf_url")
  fileDocxUrl  String?  @map("file_docx_url")
  formatoOrigine String @default("pdf") @map("formato_origine") // pdf|docx — qual è il master
}
```
Si mantiene `fileUrl` per non rompere il codice esistente che lo legge; i due nuovi campi sono opzionali e si popolano solo per i documenti generati da template (tipo=`compilato`), non per gli `allegato` caricati manualmente dal cliente (che restano nel loro formato originale).

### Logica applicativa
- Il motore di generazione documento (già esistente per produrre il PDF da template) va esteso per produrre **in un solo passaggio** entrambe le versioni:
  - Generazione Word da template con **Docxtemplater** → `fileDocxUrl`
  - Generazione PDF dallo stesso merge dati con **pdfkit** (già in uso nel progetto) → `filePdfUrl` — decisione del titolare 27/08/2026: due motori dallo stesso merge dati, **niente LibreOffice su Railway**.
- Un solo hash di riferimento per `documento_hash` in `FirmaElettronica`: si fissa sul **PDF**, che resta il formato di sigillo legale; il Word è fornito solo come comodità per firma cartacea, non entra nel calcolo del hash probatorio.
- Endpoint portale cliente: `GET /portal/documenti/:id/download?formato=pdf|docx`

### Edge case
- Se la generazione DOCX→PDF fallisce, pubblicare comunque il PDF se generato con altro metodo, loggare l'anomalia in `AuditLog`, non bloccare la pubblicazione per il solo mancato Word (il Word è un "nice to have" per firma cartacea, non blocca il flusso principale).
- Documenti già esistenti in produzione (pre-migrazione): `fileDocxUrl` resta null — il download Word è indisponibile solo per i documenti storici, non retroattivo salvo rigenerazione esplicita.

### Migrazione
Additiva, nullable, nessun backfill.

### Stima
1 giornata per l'estensione del motore di generazione (dipende dal tool già in uso per la generazione attuale — da confermare quale libreria genera oggi il PDF), 0.5 giornata per endpoint download, 0.5 giornata test.

---

## Punto 2 — Verbale di firma (sigillo leggibile) — ✅ chiuso il 27/08/2026

> **Implementazione** — coerente con il modello previsto, con le precisazioni:
> - `FirmaElettronica.verbaleDocumentoId` (l'aggiunta "opzionale" qui sotto) è stata realizzata: migrazione `20260827210000_verbale_documento_id_firma`.
> - Template non HTML→PDF ma **pdfkit diretto** (`src/services/verbaleFirma.ts`, funzione pura `generaPdfVerbaleFirma`): A4, sezioni DOCUMENTO SOTTOSCRITTO / FIRMATARIO / MODALITÀ DI SOTTOSCRIZIONE / DATI DELLA REGISTRAZIONE, sezione OTP presente **solo** se un codice è stato usato, recapito sempre mascherato (`mascheraRecapito`), IP/UA mancanti scritti come "non registrato", grafometrica incorporata solo se decodificabile, impronta SHA-256 del sigillo in chiusura.
> - Generazione **sincrona dentro la richiesta di firma** (niente coda: volumi bassi); un fallimento della generazione (storage, PDF) viene loggato e **non invalida la firma**.
> - `verbale_disponibile` aggiunto a `EVENTI_NOTIFICA` in `notificheService.ts` (anticipa una riga della matrice del punto 4); audit dedicato `VERBALE_FIRMA_GENERATO` con `userId = 'usr-system'`.
> - Collocazione nel fascicolo: progetto del documento/modulo firmato; per ambiti senza riferimento (es. engagement letter non ancora proiettata) fallback all'ultimo progetto del cliente; se nemmeno quello esiste il verbale non viene creato (la firma resta valida).
> - **Deviazione dallo schema**: `Documento.caricatoDa` è ora **nullable** — l'utente del portale ha `userId = client-<clienteId>` che non corrisponde a una riga `User`, quindi il verbale (generato dal sistema) ha `caricatoDa = null`.
> - Frontend: icona 📜 e badge "atto certificativo" per i verbali nel portale cliente; richiesta-modifica e archiviazione disabilitate lato UI oltre che lato server (409).
> - Copertura: `src/verbaleFirma.test.ts` — 14 test (contenuto certificativo del PDF decodificando le stringhe esadecimali di pdfkit, guard 409 su delete/revisione, E2E `verify-otp-and-sign` con Prisma e storage mockati).

### Problema
`FirmaElettronica` contiene tutti i dati probatori (hash, IP, canale verificato, OTP collegato, eventuale grafometrica) ma non esiste un documento umano-leggibile generato automaticamente che riassuma l'evento di firma — utile sia per lo studio (fascicolo) sia per il cliente (ricevuta).

### Modello
Non serve una nuova tabella: si usa `Documento` con `tipo = 'verbale_firma'`, collegato al progetto/microvoce di origine, generato automaticamente subito dopo la scrittura della riga in `FirmaElettronica`.

```prisma
// Nessuna modifica di schema necessaria oltre al punto 3 (isArchiviato) e punto 1
// (filePdfUrl). Si riusa Documento con un nuovo valore di `tipo`.
```

Aggiunta opzionale per tracciabilità diretta bidirezionale:
```prisma
model FirmaElettronica {
  // ...esistente...
  verbaleDocumentoId String?    @map("verbale_documento_id")
  verbaleDocumento    Documento? @relation(fields: [verbaleDocumentoId], references: [id])
}
```

### Contenuto del verbale (template)
- Identificativo firma (`signatureId`)
- Documento firmato: titolo, hash SHA-256, link/riferimento
- Firmatario: nome, ruolo, cliente
- Modalità: `tipoFirma` (fea_otp / manuale_scansionata / qualificata_esterna) espresso in chiaro
- Canale di verifica (`canaleVerificato`) — es. "OTP via WhatsApp al +39 3XX..."
- Timestamp firma, IP, user agent
- Per fea_otp: riferimento al `CodiceOtp` usato (canale, target dichiarato/anagrafica, timestamp invio/uso)
- Eventuale immagine della firma grafometrica incorporata

### Logica applicativa
- Trigger: al completamento con successo del flusso di firma (dopo scrittura `FirmaElettronica`), generazione sincrona (o in coda, se il volume lo richiede) del PDF verbale da template HTML→PDF.
- Salvataggio come nuovo `Documento` (tipo=`verbale_firma`, statoDoc=`pubblicato` direttamente, non richiede revisione cliente).
- Notifica automatica al cliente con il verbale in allegato/scaricabile (collegamento al punto 4) — ✅ realizzata (evento `verbale_disponibile`, deep-link al documento).
- Il verbale **non è modificabile né richiedibile in revisione** dal cliente (non passa per `RichiestaModificaDocumento`) — è un atto certificativo, non negoziabile.

### Test
- Ogni firma completata produce esattamente un verbale.
- Il verbale contiene correttamente i dati anche nel caso `manuale_scansionata`/`qualificata_esterna` (dove non c'è OTP, quindi la sezione OTP va omessa senza rompere il template).
- Verifica che il hash nel verbale coincida con `documento_hash` della firma.

### Stima
1.5 giornate (template + generazione + collegamento), 0.5 giornata test.

---

## Punto 4 — Matrice completa dei trigger di notifica — ✅ chiuso il 27/08/2026

### Problema
`Notifica` e il relativo `tipoEvento` esistono, ma va verificato che ogni transizione di stato rilevante del workflow documento/firma generi effettivamente una notifica — oggi non è chiaro se tutte le transizioni siano cablate.

### Matrice eventi da garantire

| Transizione | Trigger | Destinatario | tipoEvento |
|---|---|---|---|
| `Documento` bozza → pubblicato | operatore pubblica | cliente | `documento_da_firmare` (sempre: il contratto eventi è chiuso, niente variante `documento_pubblicato`) — ✅ coperta |
| Cliente crea `RichiestaModificaDocumento` | cliente invia richiesta | operatore/advisor assegnato | `messaggio_cliente` — ✅ implementata (Punto 4, prima era solo audit log) |
| Operatore ripubblica nuova versione dopo modifica | pubblicazione v2 | cliente | `documento_da_firmare` (ri-notifica) — ✅ coperta |
| `FirmaElettronica` creata con successo | fine flusso firma | operatore/advisor + cliente (conferma) | `firma_apposta` — ✅ coperta (wording SES corretto nel Punto 4) |
| Verbale di firma generato (punto 2) — ✅ coperta | post-generazione | cliente | `verbale_disponibile` (valore aggiunto in `EVENTI_NOTIFICA` col punto 2, più la riga studio `firma_apposta`) |
| `CodiceOtp` inviato | invio OTP | — (non è una Notifica di sistema, è il canale stesso: email/WA/TG con il codice) | n/a |
| `RichiestaAddendum` cambia stato → pronta/rifiutata | operatore gestisce addendum | cliente | `risposta_addendum` (evento **nuovo**) — ✅ implementata; niente notifica su `in_preparazione` |
| `PropostaDatiFiscale` confermata/rifiutata | operatore decide | cliente | `risposta_proposta_dati` (evento **nuovo**) — ✅ implementata |
| Richiesta addendum dal portale | cliente invia | operatore/advisor | `messaggio_cliente` — ✅ implementata (gap simmetrico) |
| Proposta modifica dati dal portale | cliente invia | operatore/advisor | `messaggio_cliente` — ✅ implementata (gap simmetrico) |

### Azione consigliata
Prima di scrivere nuovo codice: **audit del codice esistente** (`grep -rn "tipoEvento"` e ricerca dei punti che scrivono `Notifica`) per verificare quali righe della matrice sono già coperte. Solo le righe mancanti richiedono nuovo codice — evitando duplicati o doppie notifiche sullo stesso evento.

Aggiungere eventualmente il valore `verbale_disponibile` all'enum informale di `tipoEvento` (è una stringa libera, non un `enum` Prisma, quindi non serve migrazione — solo aggiornare la documentazione interna dei valori ammessi).

### Stima
0.5 giornata audit codice esistente, 1 giornata implementazione trigger mancanti (dipende da quanti risultano già coperti), 0.5 giornata test end-to-end sull'intera matrice.

### Esito audit e implementazione (27/08/2026)

**Audit** (`grep -nE "tipoEvento|notificaStudio|notificaCliente"` su `server.ts` + `notificheService.ts`): righe 1, 3, 4, 5 già cablate; riga 6 (OTP) correttamente fuori dal sistema `Notifica` (il canale stesso è l'email/WA/TG via `otpService`); righe 7 e 8 e i due gap simmetrici cliente→studio (richiesta modifica, addendum, proposta dati) erano **muti** — solo audit log, campanella silenziosa.

**Scelte di progetto** (contratto eventi chiuso, 10 valori in `EVENTI_NOTIFICA`):
- **cliente→studio**: riuso di `messaggio_cliente` per tutti e tre i trigger (nessun nuovo evento; lo studio vede tre righe distinte dall'`oggetto`: «Richiesta di modifica documento», «Richiesta di addendum», «Proposta di modifica dati»).
- **studio→cliente**: due eventi **nuovi e solo client-facing** — `risposta_addendum` e `risposta_proposta_dati` (l'`AppLayout` dello studio non li conosce e non serve: il destinatario è il portale).
- **Gating addendum**: notifica al cliente solo su stati terminali cliente-visibili (`pronta`, `rifiutata`); `in_preparazione` è lavorazione interna e resta silenziosa per il cliente (l'audit c'è sempre).
- **Etichette campi**: la notifica parla per persone, non per DB — `IBAN`/`Partita IVA`/ecc. via `ETICHETTE_CAMPI_PROPONIBILI`, mai il nome tecnico.
- **Deep-link**: studio → `/projects/<id>` (addendum e modifica documento) e `/clients` (proposta dati); cliente → `/portal/proposal` (addendum e proposta dati) e `/portal/avanzamento` (conferme firma). `ClientPortal.tsx` mappa i nuovi link alle tab `proposta`/`avanzamento` e assegna le icone 📄 (addendum) e 🗂️ (proposta dati).
- **Fix collaterale**: il corpo della notifica `firma_apposta` allo studio ora dice «Firma Elettronica Semplice (OTP verificata · art. 20 CAD)» — prima il wording SES del commit `0509f96` non aveva aggiornato la campanella.
- Riga 1 della matrice: la pubblicazione notifica **sempre** con `documento_da_firmare` (anche senza firma richiesta) perché il contratto eventi è chiuso e non esiste `documento_pubblicato`; variante documentata qui invece di inventare un undicesimo evento.

**File toccati**: `src/services/notificheService.ts` (2 nuovi eventi commentati), `src/server.ts` (8 punti: include esteso richiesta-modifica, trigger cliente→studio ×3, trigger studio→cliente ×3 con gating, fix wording firma_apposta), `frontend/src/pages/ClientPortal.tsx` (deep-link + icone), `src/matriceNotifiche.test.ts` (nuovo, 8 test: 3 cliente→studio, 3 addendum con il caso negativo `in_preparazione`, 2 proposta dati). Suite a **352 test** verdi; `tsc --noEmit` e `tsc -b` puliti.

---

## Punto 5 — La firma dentro il documento (§36) — ✅ chiuso il 29/08/2026

### Problema
Il Punto 2 ha reso il sigillo leggibile in un PDF **a parte**. Chi apriva il contratto firmato vedeva però l'area firme vuota, col filetto tratteggiato del template e nient'altro: la prova esisteva altrove (riga `FirmaElettronica`, verbale allegato) e andava cercata. Per il cliente e per un terzo che riceve il contratto, un documento in cui non si vede nessuna firma non è un documento firmato.

### Vincoli che hanno deciso l'architettura
- **Il PDF originale non si annota.** Fra le dipendenze non c'è una libreria che scriva dentro un PDF esistente (`pdf-lib` non è installato), e soprattutto quel file è quello su cui è fissato `documentoHash` del sigillo: riscriverlo invaliderebbe la prova che si vuole rendere visibile.
- **Rigenerare dal template non basta**: il merge dei dati è avvenuto alla generazione, e i valori di allora (ragione sociale, importo, referente) possono essere cambiati nell'anagrafica.

Da qui la scelta: **persistere i blocchi risolti** alla generazione e **ricomporre** alla firma in un file nuovo.

### Modifiche allo schema
Migrazione additiva `20260829200000_blocchi_documento_per_firma_incorporata`: `Documento.contenuto_blocchi_json JSONB` nullable, nessun backfill. Un documento generato prima di §36 resta senza blocchi e alla firma produce solo il verbale, esattamente come prima.

### Logica applicativa
- `src/services/slotFirma.ts` (nuovo): il vocabolario. Solo `{{firma_cliente}}` e `{{firma_studio}}` sono riconosciuti (un `{{firma_notaio}}` resta letterale invece di diventare un'area firma che nessuno riempirà); il tag diventa il marcatore interno `[[firma:slot]]`, che il parser trasforma in slot conservando come etichetta il testo che il template aveva scritto attorno. `bytePngFirma()` verifica i magic bytes PNG: pdfkit su un buffer che non è né PNG né JPEG solleva **dentro** il rendering.
- `src/services/generazioneDocumenti.ts`: `BloccoDocumento.slotColonne` parallelo a `colonne`; `generaPdfDocumento(blocchi, firme?)` disegna la grafometrica nello slot e stampa le righe di attestazione — senza `firme` produce byte per byte il documento di prima. Corretto anche il criterio di riconoscimento dell'area firme (vedi sotto).
- `POST /documenti/genera`: salva i blocchi **già risolti** (`contenutoBlocchiJson`); nel JSON non resta nessun `{{...}}`.
- `src/services/copiaFirmata.ts` (nuovo): ricompone il PDF con la firma nello slot e lo archivia come riga **nuova** (`tipo: 'firmato'`, `documentoPadreId` → originale, `caricatoDa: null` perché il firmatario del portale non ha riga `User`, `statoDoc: 'firmato'`, `statoScansione: 'pulito'`). `righeAttestazione()` scrive nome, valore legale reale, data **in UTC** (non `toLocaleString`, che dipende dal fuso e dall'ICU della macchina), ID firma e impronta del sigillo.
- `/portal/verify-otp-and-sign`: `archiviaCopiaFirmata()` dopo `segnaDocumentoFirmato`, con audit `COPIA_FIRMATA_GENERATA`. L'audit sta nella rotta e non nel servizio perché solo la rotta conosce l'IP della richiesta; un esito `null` **non** viene auditato (sarebbe rumore su ogni firma di ogni documento vecchio).
- Frontend: gruppo «Aree Firma» nel Document Studio (`components/editor/PannelloTag.tsx`), rendering del segnaposto come **spazio** tratteggiato nell'anteprima (`resolveDocumentTemplateHtml`), e i tag inseriti nei modelli che hanno già un'area firme — 5 dei 7 prebuilt e tutti e 22 i modelli di riorganizzazione.

### Difetto trovato per strada (parser)
Verificando che i 22 modelli di riorganizzazione producessero davvero uno slot cliente è emerso che **non producevano nemmeno un documento leggibile**: il criterio «due o più div figli = area firme» prendeva per riga di firme l'involucro `<div style="font-family: Arial">` con cui quei modelli si aprono, e l'intero documento usciva come una singola area firme a quattro colonne. Ora un div è area firme solo se dichiara `display: flex`, ha **solo** div come figli e nessuna colonna contiene elementi blocco. Dopo il fix i 22 modelli danno 27-39 blocchi ciascuno con **una** area firme a due colonne (`studio`, `cliente`).

### Politica di fallimento
Identica al verbale (Punto 2): la copia firmata è un effetto collaterale, non un requisito della firma. `generaCopiaFirmata` ritorna `null` senza sollevare quando il documento è antecedente a §36, il template non ha l'area firma del cliente, la riga è già una copia firmata, il documento è di un altro tenant o lo storage è caduto. La firma resta valida e il sigillo intatto in tutti e cinque i casi.

### Limiti dichiarati
- **Solo PDF.** La copia di cortesia in Word non si rigenera firmata: incorporare un'immagine in un `.docx` richiederebbe il modulo immagini di docxtemplater, che non è una dipendenza del progetto. Il documento che fa fede è il PDF.
- **Il canale di firma su file caricato resta fuori** (`tipoFirma: 'manuale_scansionata' | 'qualificata_esterna'`): lì la sottoscrizione è già dentro il file che il cliente ha ricaricato (`fileFirmatoUrl`), e ricomporre sostituirebbe la prova con una resa fatta dal server.

### Test
20 test nuovi: `src/copiaFirmata.test.ts` (17 — vocabolario, resa, primitive, archiviazione e i cinque casi `null`), 3 end-to-end in `src/verbaleFirma.test.ts` attraverso la rotta reale, più il presidio del criterio area firme in `src/generazioneDocumenti.test.ts`. Suite complessiva: **426 test** verdi; `tsc --noEmit` e `tsc -b` in `frontend/` puliti.

---

## Punto 6 — Archivio documentale dello studio (§37) — ✅ chiuso il 29/08/2026

### Problema
I documenti dello studio si potevano vedere solo un progetto alla volta: bisognava sapere *quale* cliente e *quale* progetto per arrivare a una carta, aprendo la scheda del progetto e la scheda documenti. Non esisteva un posto da cui rispondere a «quante carte abbiamo», «quali sono pubblicate e ancora non firmate», «dove sta il contratto di quel cliente».

### Vincoli rispettati
- **Nessuna migrazione.** Ogni numero mostrato è un conteggio di righe che il database ha già (`documento`, `progetto`, `cliente`, `firma_elettronica`). Non è stato aggiunto un campo, e nemmeno una tabella di cache dei conteggi: si sarebbe dovuta mantenere aggiornata a ogni upload, e un conteggio sbagliato in un archivio legale è peggio di un conteggio calcolato ogni volta.
- **Una sola verità sul documento.** L'archivio *non* restituisce documenti. Le carte di una cartella continuano ad arrivare da `GET /documenti?progettoId=…`, che è l'unico posto che rinnova la firma HMAC degli URL `/uploads/` e legge lo stato di firma dalla tabella dei sigilli. Duplicare quella logica avrebbe prodotto due risposte diverse sullo stesso file.
- **Regola 8.** `src/routes/documenti.ts` è oltre le 1.000 righe: la rotta nuova sta in `src/routes/archivioDocumenti.ts` (~170 righe), che legge e non scrive. Lato frontend la pagina e la tabella dei documenti sono due file, non uno.

### Logica applicativa
- `src/routes/archivioDocumenti.ts` — `GET /documenti/archivio`. Restituisce l'albero `clienti[] → progetti[]`, ciascun nodo con `documenti`, `firmati`, `daFirmare`, `archiviati`, `ultimoCaricamento`, più i `totali` di tenant. Quattro letture: clienti con i loro progetti, documenti (select minima, senza `fileUrl`: qui non si scarica niente), le micro-voci **solo** di quei documenti che hanno l'aggancio alla micro-voce e non al progetto, i sigilli dei documenti trovati.
- **Criterio «firmato»**: identico a `GET /documenti` — un sigillo in `firma_elettronica` con `ambito: 'documento_vault'`, oppure `tipo: 'firmato'` (la copia ricomposta di §36, che nasce già sottoscritta). «Da firmare» è il documento *pubblicato* e non firmato: la bozza non conta, il cliente non l'ha nemmeno vista.
- **Archiviati a parte**: non entrano in `documenti` e non alzano `ultimoCaricamento`, così una cartella ferma da mesi non sembra viva perché qualcuno vi ha archiviato una vecchia carta.
- **Un cliente non entra**: `ruolo === 'cliente'` → **403**. RLS isola il tenant, non i clienti fra loro; l'archivio attraversa tutti i clienti dello studio, quindi la separazione la fa la rotta.
- `frontend/src/pages/ArchivioDocumentiPage.tsx` — la navigazione a cartelle (`/archivio`, voce di sidebar «📂 Archivio Documentale», chiave RBAC riusata `documents`): percorso Archivio / Cliente / Progetto, riquadri dei totali, ricerca, «nascondi le cartelle senza documenti», «mostra anche gli archiviati».
- `frontend/src/components/documenti/ElencoDocumentiCartella.tsx` — il livello 3: tabella dei documenti con nome file pulito dal prefisso `${Date.now()}_`, tipo, stato, chi ha caricato, apertura e scarico di PDF e Word.

### Documenti senza cartella
`Documento.progettoId` ha `onDelete: SetNull`: se il progetto viene eliminato, il documento resta e perde il suo posto nell'albero. Non vengono nascosti per far tornare i conti: la rotta li conta in `totali.nonCollocati` e la pagina scrive che il progetto a cui erano agganciati è stato eliminato mentre file e firme restano conservati (regola 7).

### Test
9 test in `src/archivioDocumenti.test.ts` con client Prisma finto: 401 senza token, 403 col token cliente, albero restituito anche a documenti zero (e query delle micro-voci che non parte), conteggi per progetto sommati sul cliente con la data corretta, documento risalito dalla micro-voce al progetto, criterio «firmato»/«da firmare», archiviati separati, orfani dichiarati, nessuna carta nella cartella di un altro cliente. Suite complessiva: **435 test** verdi; `tsc --noEmit` e `tsc -b` in `frontend/` puliti.

---

## §34 — Il 404 in produzione su `POST /documenti/genera` — 🔶 diagnosi chiusa il 29/08/2026, verifica in campo aperta

### Che cosa è stato accertato qui
- La rotta **esiste** in `src/routes/documenti.ts:332` e viene registrata dentro il wrapper autenticato di `buildServer`, quindi risponde a `POST /documenti/genera`.
- La rotta **esiste anche nel ramo distribuito**: `git grep -c "documenti/genera" origin/main -- src/routes/documenti.ts` dà 3 riscontri.
- Non esiste alcun `setNotFoundHandler` personalizzato: il 404 di una rotta assente è quello di Fastify, con corpo `{"error":"Not Found","statusCode":404}` e **senza** la chiave `errore` che usano le rotte dello studio.
- Il 404 quindi non nasce dal codice del server. Non è stato possibile chiuderlo osservandolo: da questo ambiente l'egress verso l'host Railway è negato, quindi la verifica sul dominio vero resta al titolare.

### Le tre cause possibili, e come si distinguono da fuori
Comando: `curl -i -X POST https://bluman-api-production.up.railway.app/documenti/genera`

| Risposta | Causa | Rimedio |
|---|---|---|
| `401` JSON `{"errore":"Non autenticato"}` | L'immagine distribuita **ha** la rotta: il 404 nasce dal percorso richiesto dal browser, non dal server | vedi la barra finale in `VITE_API_BASE` |
| `404` JSON `{"error":"Not Found"}` | L'immagine su Railway è **più vecchia** della rotta | ridistribuire Railway su `origin/main` |
| HTML, o `404` di Railway | La richiesta non parla con il backend (dominio sbagliato, servizio spento) | correggere `VITE_API_BASE` / riavviare il servizio |

La stessa POST sul dominio del frontend risponde con l'HTML di `index.html`, perché `vercel.json` riscrive su `/index.html` tutto ciò che non è `/api/send-email` o i due webhook: se `VITE_API_BASE` punta là, nessuna chiamata raggiunge mai Railway.

### Presidi aggiunti (perché il guasto non torni muto)
- `src/rotteNonTrovate.test.ts` — 2 test nuovi: `POST /documenti/genera` senza token dà **401 JSON dello studio, mai 404**, e una rotta gemella inesistente dà **404 col corpo di Fastify**. Fissano le due forme su cui si basa il `curl` di sopra: se un domani qualcuno spostasse la rotta fuori dal wrapper autenticato, la sonda di deploy smetterebbe di distinguere «assente» da «protetta» e il test diventerebbe rosso.
- `frontend/src/api/http.ts` — `getApiBase()` ora **taglia la barra finale** di `VITE_API_BASE` (`https://…app/` + `/documenti/genera` faceva `//documenti/genera`, che per il router di Fastify è un altro percorso: 404 con la rotta presente) e **rifiuta una base uguale all'origine della pagina**, tornando a Railway e scrivendolo in console.
- `frontend/src/api/http.ts` — `apiFetch` solleva un errore parlante quando la risposta è `text/html`: nessuna rotta dell'API risponde HTML, quindi quella pagina è la prova che la richiesta non è arrivata al backend. Prima l'operatore vedeva un errore di lettura JSON, e una pagina HTML con stato 200 passava per salvataggio riuscito (regola 3).

### Da fare, e non è codice
`origin/main` è a `711f265` (ultimo stato noto: da questo ambiente l'egress verso `github.com:443` è negato, quindi il riferimento non è aggiornabile con un `fetch`). Non spinto: `9b78cc5`, l'addendum «il nome del certificato è un campo, non l'host». Un push aggiorna **solo** il frontend su Vercel: il backend su Railway non è collegato a GitHub e si distribuisce con `railway up`.

---

## §35 (addendum posta) — «le mail non partono e non arrivano» — ✅ codice chiuso il 30/08/2026, intervento sulle impostazioni aperto

### Il sintomo, e le tre righe lette in produzione
```
❌ Errore SMTP: getaddrinfo ENOTFOUND mail.bluecode-ltd.com
❌ Errore IMAP: Hostname/IP does not match certificate's altnames:
   Host: imap.register.it. is not in the cert's altnames: DNS:*.securemail.pro, DNS:securemail.pro
dalle impostazioni neanche il test passa
```
Sono **tre guasti diversi** che chiedono tre interventi diversi, e nessuna delle tre righe lo dice. Chi le legge conclude «la posta è rotta» e cambia la password, che è l'unica cosa che non c'entra.

| Riga | Causa vera | Intervento |
|---|---|---|
| `ENOTFOUND` | Il nome nel campo «Server SMTP» della riga Tenant non esiste nel DNS | correggere il campo con il nome che il provider pubblica |
| `altnames` | Il server risponde ma presenta un certificato emesso per altri nomi | usare il nome coerente col certificato, **non** disattivare la verifica |
| «neanche il test passa» | La prova percorreva solo l'**SMTP diretto**, cioè le porte che Railway blocca in uscita, mentre gli invii veri passavano dal relay e riuscivano | la prova deve percorrere la strada degli invii veri |

### Che cosa è cambiato nel codice
- **`src/services/diagnosiPosta.ts` (nuovo)** — l'unico posto che traduce un errore di posta in un intervento: sei cause riconosciute dal **testo** (non solo da `err.code`, che si perde quando il guasto arriva di seconda mano dal relay), i nomi che il certificato copre davvero, e la proposta del nome coerente conservando la prima etichetta. Ordine di riconoscimento deliberato — DNS, certificato, timeout, credenziali — perché su Railway il timeout delle porte chiuse compare **insieme** alla causa vera e non deve coprirla. Non propone mai di disattivare la verifica dei certificati (§3.4).
- **`src/services/emailService.ts`** — `verifyAndSendTestSmtp` (quattordici coppie host/porta, cinque delle quali **server di altri**, messaggio di prova con mittente e intestazione di un solo studio) sostituita da `provaPostaInUscita()`, che compone e consegna a `inviaEmail()`: stessa strada degli invii veri, relay compreso, e `via` nella risposta dice da dove è passata. `verifyRealImap` → `provaPostaInArrivo()`, con ogni guasto tradotto. Rimossi i due ripieghi su un host e un'utenza di terzi in `sendMagicLinkEmail` e `sendClientCredentialsEmail`; rimossa l'esportazione `createTransporter`.
- **`src/routes/tenant.ts`** — `POST /tenant/test-email`, `POST /tenant/test-imap` e il ramo email di `POST /tenant/test-channel` provano **esattamente quello che c'è** (corpo della richiesta, altrimenti riga Tenant) e non completano più la configurazione mancante con `process.env.SMTP_*` né con host e utenza cablati: una casella non configurata risponde 400 «non configurata», non un successo ottenuto con la casella della piattaforma.
- **`src/services/imapInbound.ts`**, **`api/send-email.ts`** — via il ripiego sull'host IMAP di un provider: senza host la lettura si rifiuta invece di collegarsi al server di qualcun altro con le credenziali di questo studio.
- **`src/services/imapFetcher.ts` — eliminato**: 157 righe di secondo client IMAP scritto a mano, senza nessun importatore, con l'host di un provider come ripiego.
- **`frontend/src/pages/SettingsPage.tsx`** — «✓ CONNESSO!» solo con `success: true`. Prima bastava che il messaggio — scritto dal server — contenesse «successo» o «verificata» (regola 7).
- **`src/routes/tenant.ts`, `POST /audit-logs`** — l'attore lo dice il token, non il corpo della richiesta: c'erano il nome e l'indirizzo di una persona reale come ripiego, attribuiti a chiunque chiamasse la rotta senza indicarsi. In un registro immutabile un attore inventato è peggio di un attore ignoto.

### Presidi
- `src/postaDiagnosi.test.ts` (15 test) — la traduzione sui messaggi verbatim di produzione, il punto finale del nome DNS (`imap.register.it.`, com'è scritto da Node), il certificato che non copre nessun nome utilizzabile (nessuna proposta inventata), la stringa composta da `inviaEmail` dove il timeout non deve coprire il certificato, e il presidio strutturale: **nessun nome di server di terzi in posizione di codice** in `src/` e `api/`, nessun mittente cablato nei moduli della posta.
- `src/postaProveRotte.test.ts` (8 test) — le due rotte di prova su una casella non configurata: 400 con l'elenco di cosa manca, 401 senza token, e con `SMTP_USER`/`SMTP_PASS` nell'ambiente la prova **non** ricade su quelle credenziali.
- Suite completa: **460 test, 34 file, verde**; `npx tsc --noEmit` e `npm run typecheck` in `frontend/` puliti.

### Secondo giro (30/08/2026) — il nome a cui collegarsi e il nome che il certificato attesta sono due cose

Il punto 2 di «Da fare» sopra diceva che la posta in arrivo era ferma perché non esiste un nome insieme
risolvibile e coperto dal certificato. Era vero, ed era vero anche che **nessun singolo campo «Server»
poteva soddisfare entrambe le condizioni**: la sonda del titolare misura `imap.register.it` →
`195.110.124.132` con certificato per `*.securemail.pro`, e `imap.securemail.pro` coperto dal
certificato ma **senza record DNS**. Chi scriveva il nome che risolve leggeva
«is not in the cert's altnames», chi scriveva quello del certificato leggeva `ENOTFOUND`. L'operatore
alternava i due errori senza poter uscire.

**Il tentativo che non poteva funzionare** (commit `711f265`): risolvere il nome sul backend con
`dns.lookup` e collegarsi all'IP ottenuto. Un nome senza record A non risolve da Railway più di quanto
risolva da Vercel — il DNS è lo stesso. In più, collegarsi a un indirizzo fisso toglie al provider la
possibilità di spostare o bilanciare il servizio. Quel codice è stato rimosso e il suo ritorno è
presidiato da un test che rifiuta `dns.(lookup|promises|resolve)` in posizione di codice nei tre moduli
della posta.

**La correzione**: separare i due nomi. `host` è l'indirizzo a cui si apre la connessione, `servername`
il nome che il certificato deve attestare — `tls.connect({ host, servername })` per IMAP,
`tls: { servername }` per nodemailer. Due colonne nuove sulla riga Tenant
(migrazione `20260830120000_nome_certificato_posta`):

| Colonna | Campo nell'interfaccia | Vuota significa |
|---|---|---|
| `smtp_servername` | Posta in uscita → «Nome nel certificato (solo se diverso dall'host)» | si verifica il certificato contro l'host |
| `imap_servername` | Posta in arrivo → «Nome nel certificato (solo se diverso dall'host)» | si verifica il certificato contro l'host |

Quello che questo campo **non** è: un modo per non verificare il certificato. `rejectUnauthorized`
resta `tlsRejectUnauthorized()` in ogni percorso (§3.4); cambia il nome con cui il certificato viene
confrontato, non il fatto che venga confrontato. Il nome lo dichiara l'operatore: non viene mai letto
dal certificato che il server presenta, perché un certificato non fidato non può decidere contro quale
nome essere verificato. Precedenza deliberata: **riga Tenant prima di `SMTP_SERVERNAME`** — su
un'installazione multi-studio l'ambiente è di uno solo, e verificare il certificato di uno studio
contro il nome di un altro è un guasto silenzioso.

Il nome viaggia su **tutte** le strade, non solo su quella che si prova per prima: corpo del relay
(`smtpServername`, `imapServername`), SMTP diretto di ripiego, `api/send-email.ts` fino a nodemailer, e
le due rotte di prova. Se si fermasse al relay, la correzione funzionerebbe solo sul ripiego, cioè
quasi mai; se si fermasse alla prova, il pulsante «Testa» misurerebbe una connessione diversa da quella
degli invii veri.

`diagnosiPosta` ora offre **due strade in ordine** invece di una: (1) scrivere il nome coerente col
certificato nel campo «Server», che chiude il caso quando il provider lo pubblica nel DNS; (2) se quel
nome non risolve, lasciare l'host che risolve e scrivere il nome nel campo «Nome nel certificato». Il
campo `nomeCertificatoSuggerito` porta la proposta per la seconda strada, e il ramo `ENOTFOUND` rimanda
al campo dedicato invece di far tornare l'operatore al punto di partenza.

**Presidi aggiunti**: `src/postaNomeCertificato.test.ts` (8 test) — il nome che arriva a
`tls.servername` con `rejectUnauthorized` vero, il campo vuoto che non aggiunge nulla, i corpi del
relay in uscita e in arrivo, la precedenza Tenant/ambiente, il divieto di `dns.lookup`.
`src/postaDiagnosi.test.ts` +2 (le due strade, il nome che non risolve), `src/postaProveRotte.test.ts`
+1 (il campo provato e non ignorato), `api/sendEmail.test.ts` +2 (il nome fino a nodemailer nel relay).
Suite completa: **473 test, 35 file, verde**; `npx tsc --noEmit` e `npm run typecheck` puliti.

### Da fare, e non è codice
1. **Correggere l'host della posta in uscita nella riga Tenant** (Impostazioni → Posta, oppure `PUT /tenant/settings`). Dalla sonda DNS/TLS eseguita dal titolare: `mail.bluecode-ltd.com` **non risolve**; `smtp.securemail.pro` risolve su `81.88.48.66`, che è lo **stesso indirizzo** di `authsmtp.register.it`, ed è fra i nomi coperti dal certificato che quel server presenta sulla 465 — quindi è il nome che funziona con la verifica TLS attiva.

   Qui sta anche la risposta a **«prima arrivava il codice OTP della firma, adesso neanche quello arriva»**: prima di §35 ogni invio partiva da `process.env.SMTP_*`, cioè dalla casella della piattaforma, per tutti i tenant. Ora vince la riga Tenant (deliberato: su un'installazione multi-studio spedire il codice di firma di un cliente dalla casella di un altro studio è un guasto silenzioso, regola 1), e la riga Tenant contiene `mail.bluecode-ltd.com`, che non esiste nel DNS. `inviaEmail` fallisce su entrambe le strade — il relay risolve lo stesso nome, l'SMTP diretto dà `ENOTFOUND` — quindi nessun codice esce. **Non è un guasto del percorso OTP**: correggere il campo «Server SMTP» rimette in funzione OTP, magic link e credenziali portale insieme.
2. **Configurare la posta in arrivo con i due nomi.** `imap.register.it` risolve ma presenta un certificato per `*.securemail.pro`, e `imap.securemail.pro` è coperto dal certificato ma non ha record DNS: nessun campo «Server» da solo basta. Va tenuto l'indirizzo che risolve nel campo «Server posta in arrivo (IMAP)» e scritto `imap.securemail.pro` nel campo «Nome nel certificato». Il nome esatto resta da confermare col provider — se ne pubblica uno che risolve **ed** è coperto, quello va nel campo «Server» e il secondo campo torna vuoto. Disattivare la verifica non è la via d'uscita: la password della casella viaggia in quella connessione (§3.4).
3. **Verificare che `EMAIL_RELAY_SECRET` sia identico su Railway e su Vercel**: se differiscono, il relay risponde 401 e la posta ripiega sull'SMTP diretto, cioè sulle porte bloccate.
4. **Distribuire il backend**: Railway non è collegato a GitHub, quindi un push su `main` aggiorna solo il frontend su Vercel. Le modifiche di questo addendum arrivano in produzione con `railway up`, che da questo ambiente non è eseguibile (egress negato).

---

## Riepilogo effort complessivo

| Punto | Stima |
|---|---|
| 3 — Integrità referenziale | 2 giorni |
| 1 — Export PDF/Word | 2 giorni |
| 2 — Verbale di firma | 2 giorni |
| 4 — Matrice notifiche | 2 giorni |
| **Totale** | **~8 giorni/persona**, sequenziali per le dipendenze indicate |

## Prerequisiti da chiarire prima di iniziare
1. ✅ **Risolto (Punto 1, 27/08/2026)** — Prima il PDF era fabbricato **client-side** con **jsPDF** (`frontend/src/utils/pdfGenerator.ts`, `generateRealPdfBase64`/`downloadRealPdf`) e il Word era uno stub `.doc` ricostruito dall'HTML (`downloadRealWordDoc`/`scaricaDocumentoWordClient`). Ora la generazione è **server-side**: motore unico `src/services/generazioneDocumenti.ts` con **pdfkit** (PDF) + **docxtemplater** (Word) dallo stesso array di blocchi, invocato da `POST /documenti/genera`. Niente LibreOffice su Railway.
2. ✅ **Risolto (Punto 2, 27/08/2026)** — Non esiste job/queue asincrono: la generazione del verbale è **sincrona dentro la richiesta di firma** (volumi bassi); un fallimento viene loggato e non invalida la firma.
3. ✅ **Risolto (Punto 4, 27/08/2026)** — `Notifica` **non ha dispatcher esterni**: il campo `canale` è sempre `'in_app'` (hardcoded in `notificaStudio`/`notificaCliente`/`notificaStudioSilenziosa`). Il DB è la fonte di verità (chi non è connesso ritrova le righe al prossimo accesso), lo stream SSE è la scorciatoia real-time. I canali email/WhatsApp/Telegram esistono **solo per l'OTP** via `otpService` — la riga 6 della matrice è infatti `n/a`.

---

## Prossimo capitolo — Piano Firma Legale (28/08/2026)

I 4 punti operativi sopra sono chiusi. L'audit della **sezione 4 dello spec** (SES/FEA/FEQ) aveva aperto un capitolo nuovo: il backend etichettava ancora come **FEA** firme che sono **SES** (DB, audit log, verbale PDF, email OTP — il frontend era già corretto dal commit `0509f96`). Il piano completo — matrice delle contraddizioni, schema `livelloFirmaRichiesto`/`valoreLegale`, enforcement server-side, fasi FEA/FEQ — è in **`piano-firma-legale-ses-fea-feq.md`**. **Fase 1 (verità nelle etichette) completata il 28/08/2026**: standard SES esplicito, default prudente, prefissi `SIGILLO-SES-`, audit `FIRMA_SES_APPOSTA`, email e risposta API rietichettate; suite 353/353 verde. **Fase 2 (etichettatura per tipo documento) completata il 28/08/2026**: migrazioni `20260828120000` e `20260828150000`, enforcement 409 su entrambe le rotte di firma (`livelloRichiestoPerFirma` su `documento_vault` e `modulo_completato`), UI operatore (template, pubblicazione, passaggio di modulo) e gating portale a tre livelli (canale ammesso in TabDocumenti, guard preventivo in `avviaFirmaDocumento`, select bloccato in `InvioManualeModal`), riga «Valore legale della firma» nel verbale, `livelloFirmaService.ts` + 13 test; suite 373/373 verde. **Fase 3 (misure FEA reali) completata il 29/08/2026**: migrazione `20260828180000` (session_id, login_at, doc_riconoscimento_hash, doc_riconoscimento_tipo su firma_elettronica), identificazione del firmatario con elenco chiuso `firmatariAmmessi` (cliente o legaleRappresentante) validato nelle 3 rotte di firma, grafometrica obbligatoria su livello fea (400 pre-OTP), documento di riconoscimento scan+hash nel digest, certificato di sessione (sid+iat) nel digest e persistito, `valoreLegale: 'fea'` dal flusso OTP misurato con audit `FIRMA_FEA_APPOSTA`, verbale con righe condizionali, frontend FirmaOtpModal/TabDocumenti/ClientPortal; firme SES byte-identiche (digest invariato); suite 375/375 verde. Fase 4 esclusa (resta `qualificata_esterna`).
