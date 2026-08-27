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
- **Punto 2 — ⏳ prossimo.** Verbale di firma come `Documento` con `tipo = 'verbale_firma'`, `statoDoc = 'pubblicato'`, non negoziabile (atto certificativo).
- **Punto 1 — ⏳ motore definito.** Decisione titolare 27/08/2026: **Docxtemplater (Word) + pdfkit (PDF)** dallo stesso merge dati — **niente LibreOffice su Railway**; hash legale fissato sul PDF.
- **Punto 4 — ⏳ in coda.** Audit del cablaggio esistente + implementazione dei trigger mancanti (non solo report).

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

## Punto 1 — Export contestuale PDF + Word

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

## Punto 2 — Verbale di firma (sigillo leggibile)

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
- Notifica automatica al cliente con il verbale in allegato/scaricabile (collegamento al punto 4).
- Il verbale **non è modificabile né richiedibile in revisione** dal cliente (non passa per `RichiestaModificaDocumento`) — è un atto certificativo, non negoziabile.

### Test
- Ogni firma completata produce esattamente un verbale.
- Il verbale contiene correttamente i dati anche nel caso `manuale_scansionata`/`qualificata_esterna` (dove non c'è OTP, quindi la sezione OTP va omessa senza rompere il template).
- Verifica che il hash nel verbale coincida con `documento_hash` della firma.

### Stima
1.5 giornate (template + generazione + collegamento), 0.5 giornata test.

---

## Punto 4 — Matrice completa dei trigger di notifica

### Problema
`Notifica` e il relativo `tipoEvento` esistono, ma va verificato che ogni transizione di stato rilevante del workflow documento/firma generi effettivamente una notifica — oggi non è chiaro se tutte le transizioni siano cablate.

### Matrice eventi da garantire

| Transizione | Trigger | Destinatario | tipoEvento |
|---|---|---|---|
| `Documento` bozza → pubblicato | operatore pubblica | cliente | `documento_da_firmare` (se richiedeFirmaCliente=true) oppure `documento_pubblicato` |
| Cliente crea `RichiestaModificaDocumento` | cliente invia richiesta | operatore/advisor assegnato | `messaggio_cliente` |
| Operatore ripubblica nuova versione dopo modifica | pubblicazione v2 | cliente | `documento_da_firmare` (ri-notifica) |
| `FirmaElettronica` creata con successo | fine flusso firma | operatore/advisor + cliente (conferma) | `firma_apposta` |
| Verbale di firma generato (punto 2) | post-generazione | cliente | `documento_pubblicato` (o nuovo tipo `verbale_disponibile`) |
| `CodiceOtp` inviato | invio OTP | — (non è una Notifica di sistema, è il canale stesso: email/WA/TG con il codice) | n/a |
| `RichiestaAddendum` cambia stato → pronta | operatore prepara addendum | cliente | evento esistente da verificare |
| `PropostaDatiFiscale` confermata/rifiutata | operatore decide | cliente | evento esistente da verificare |

### Azione consigliata
Prima di scrivere nuovo codice: **audit del codice esistente** (`grep -rn "tipoEvento"` e ricerca dei punti che scrivono `Notifica`) per verificare quali righe della matrice sono già coperte. Solo le righe mancanti richiedono nuovo codice — evitando duplicati o doppie notifiche sullo stesso evento.

Aggiungere eventualmente il valore `verbale_disponibile` all'enum informale di `tipoEvento` (è una stringa libera, non un `enum` Prisma, quindi non serve migrazione — solo aggiornare la documentazione interna dei valori ammessi).

### Stima
0.5 giornata audit codice esistente, 1 giornata implementazione trigger mancanti (dipende da quanti risultano già coperti), 0.5 giornata test end-to-end sull'intera matrice.

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
1. Quale libreria genera oggi il PDF da template per `Documento.tipo='compilato'` (serve per estendere al Word senza duplicare la logica di merge dati).
2. Se esiste già un job/queue asincrono in uso (per la generazione verbale, meglio asincrona se il volume di firme è alto) o se tutto è sincrono nel request/response oggi.
3. Conferma se `Notifica` ha già un dispatcher effettivo verso email/WhatsApp/Telegram o se il campo `canale` è solo documentale/futuro.
