# 📊 Piano Operativo di Riforma: Gestione Fatture & Contabilità Integrata (OpenSTAManager Engine)

Questo documento definisce l'architettura completa, il modello dati e la scaletta operativa per riformare e integrare il modulo Fatturazione, Scadenzario e Prima Nota di BluMan, traendo ispirazione diretta dai moduli contabili di **OpenSTAManager** (`openstamanager_source/modules/fatture/`).

> ### ⚠️ Documento storico: il progetto fu eseguito, le caselle no
>
> Fermo al **31/08/2026** con 41 caselle su 41 vuote, quindi sembra una lista di cose ancora da
> fare. Non lo è: **è già costruito**. I campi che questo piano propone — `prezzoUnitarioCent`,
> `scontoPercentuale`, `aliquotaIva`, `naturaEsenzione`, `tipoCassa`, `aliquotaRitenuta`,
> `totaleBolloCentesimi` — sono nello schema (`prisma/schema.prisma`), e il primo obiettivo («zero
> `localStorage`») è chiuso per i due file che nomina: né `InvoicesPage.tsx` né
> `FatturazioneTab.tsx` ne fanno più uso.
>
> Nessuno è tornato indietro a spuntare niente, ed è tutto ciò che dicono quelle caselle. Qui
> dentro resta il **ragionamento** — perché la riga fattura ha quella struttura e non un'altra — ed
> è per questo che il `README.md` del manuale lo cita come spec di dominio della contabilità.

---

## 🎯 1. Obiettivi & Visione Architetturale

1. **Integrazione Totale a Database (Zero `localStorage`):**
   - Eliminare ogni lettura e scrittura da `localStorage` su `InvoicesPage.tsx` e `FatturazioneTab.tsx`. Le fatture, le rate e i movimenti risiedono esclusivamente in PostgreSQL/Supabase con isolamento RLS multi-tenant (`tenant_id`).
2. **Modello Dati Completo per le Righe Fattura:**
   - Superare la struttura minimale `{ tipo, importo, descrizione }` per supportare il calcolo professionale: quantità, prezzo unitario, sconto %, aliquota IVA, natura esenzione (N1-N7), rivalsa cassa previdenziale (es. 4% INPS/Cassa Dottori Commercialisti/Avvocati) e ritenuta d'acconto (es. 20%).
3. **Collegamento End-to-End con le Sorgenti di Business:**
   - Generazione guidata di fatture e note di credito partendo da:
     - 📁 **Progetto & Moduli Istanza** (moduli completati, percentuali di avanzamento)
     - 📋 **Preventivi Accettati** (importazione righe preventivo)
     - 🔄 **Contratti Ricorrenti (Retainer)** (fatturazione periodica pianificata)
     - ⏱️ **Timesheet & Ore Consuntivate** (ore approvate moltiplicate per tariffa oraria)
     - ✍️ **Prestazione Libera / Manuale**
4. **Ciclo di Vita Automatico (Emissione ➔ Scadenzario ➔ Incasso ➔ Prima Nota ➔ Redditività):**
   - **All'Emissione:** Generazione automatica del piano delle scadenze di pagamento in `scadenza_incasso` (vista fattura, 30gg, 60gg, 90gg con calcolo rate).
   - **All'Incasso:** Registrazione automatica del movimento in `transazione_prima_nota` con associazione al conto corrente bancario/cassa, aggiornamento stato scadenza e fattura (`incassata`), notifica allo studio e al cliente.
   - **Redditività Progetto:** Ricalcolo in tempo reale del margine commessa (Fatturato reale vs Budget vs Costo orario consuntivato).
5. **Tracciato XML SDI FatturaPA 1.2 & PDF Ufficiale:**
   - Compilazione conforme di tutti i blocchi ministeriali (`DatiGeneraliDocumento`, `DatiBeniServizi`, `DatiRitenuta`, `DatiCassaPrevidenziale`, `DatiPagamento`).
6. **Immutabilità Fiscale del Documento Emesso:**
   - Una fattura con `stato != bozza` (quindi trasmessa a SDI) non è più modificabile per legge. Ogni correzione post-emissione deve transitare obbligatoriamente da una Nota di Credito (TD04), mai da un update diretto sulle righe o sui totali.
7. **Ciclo Passivo & Liquidazione IVA Periodica:**
   - Il modulo non si limita alla fatturazione attiva: integra fornitori, fatture ricevute (registro acquisti) e liquidazione IVA periodica (LIPE), per costituire una vera "contabilità integrata" e non solo un motore di emissione.
8. **Tracciabilità, Conservazione e Auditabilità:**
   - Ogni fattura elettronica trasmessa va conservata digitalmente a norma (10 anni) e ogni operazione critica (emissione, annullamento, incasso, storno) deve lasciare una traccia di audit verificabile per tenant.

---

## 🏛️ 2. Modello Dati Relazionale (Schema Prisma)

```prisma
// Aggiornamenti a prisma/schema.prisma

enum CondizionePagamento {
  immediato
  bonifico_30gg
  bonifico_60gg
  bonifico_30_60gg
  bonifico_fine_mese
  personalizzato
}

enum TipoCassaPrevidenziale {
  nessuna
  inps_gestione_separata // TC22 - 4%
  cassa_commercialisti   // TC03 - 4%
  cassa_forense          // TC01 - 4%
  inarcassa              // TC04 - 4%
}

enum EsigibilitaIva {
  immediata   // "I" - regime ordinario
  differita   // "D" - art. 6 DPR 633/72
  split       // "S" - scissione dei pagamenti (fatture verso PA)
}

enum MotivoNotaCredito {
  errore_esposizione
  reso_merce
  sconto_post_fattura
  abbuono
  annullo_totale
  correzione_dati
}

model Fattura {
  id                        String                 @id @default(uuid())
  tenantId                  String                 @map("tenant_id")
  progettoId                String?                @map("progetto_id")
  progetto                  Progetto?              @relation(fields: [progettoId], references: [id], onDelete: SetNull)
  clienteId                 String                 @map("cliente_id")
  cliente                   Cliente                @relation(fields: [clienteId], references: [id])
  preventivoId              String?                @map("preventivo_id")
  preventivo                Preventivo?            @relation(fields: [preventivoId], references: [id], onDelete: SetNull)
  contrattoRicorrenteId     String?                @map("contratto_ricorrente_id")
  contrattoRicorrente       ContrattoRicorrente?   @relation(fields: [contrattoRicorrenteId], references: [id], onDelete: SetNull)
  
  tipoDocumento             TipoDocumentoFiscale   @default(fattura) @map("tipo_documento")
  serie                     String                 @default("FT") // "FT" o "NC"
  numeroProgressivoSerie    Int                    @default(1) @map("numero_progressivo_serie")
  numero                    String?                // es. "FT-2026/001"
  data                      DateTime               @default(now())
  stato                     StatoFattura           @default(bozza)
  
  // Condizioni Commerciali & Fiscali
  condizionePagamento       CondizionePagamento    @default(bonifico_30gg) @map("condizione_pagamento")
  metodoPagamento           MetodoPagamento        @default(bonifico) @map("metodo_pagamento")
  contoAccreditoId          String?                @map("conto_accredito_id")
  contoAccredito            ContoBancario?         @relation(fields: [contoAccreditoId], references: [id], onDelete: SetNull)
  
  tipoCassa                 TipoCassaPrevidenziale @default(nessuna) @map("tipo_cassa")
  aliquotaCassa             Float                  @default(0) @map("aliquota_cassa")
  aliquotaRitenuta          Float                  @default(0) @map("aliquota_ritenuta") // es. 20.0
  esigibilitaIva            EsigibilitaIva         @default(immediata) @map("esigibilita_iva")
  
  // Totali Calcolati (in centesimi per precisione assoluta)
  totaleImponibileCentesimi Int                    @default(0) @map("totale_imponibile_centesimi")
  totaleCassaCentesimi      Int                    @default(0) @map("totale_cassa_centesimi")
  totaleIvaCentesimi        Int                    @default(0) @map("totale_iva_centesimi")
  totaleRitenutaCentesimi   Int                    @default(0) @map("totale_ritenuta_centesimi")
  totaleBolloCentesimi      Int                    @default(0) @map("totale_bollo_centesimi") // €2 se op. esenti/escluse > 77,47€
  totaleDocumentoCentesimi  Int                    @default(0) @map("totale_documento_centesimi")
  nettoAPagareCentesimi     Int                    @default(0) @map("netto_a_pagare_centesimi")
  
  // Correzioni post-emissione: SOLO tramite Nota di Credito, mai update diretto su fattura emessa
  fatturaOrigineId          String?                @map("fattura_origine_id") // valorizzato sulla NC (TD04)
  fatturaOrigine             Fattura?              @relation("NotaCreditoDiFattura", fields: [fatturaOrigineId], references: [id], onDelete: SetNull)
  noteCredito                Fattura[]             @relation("NotaCreditoDiFattura")
  motivoNotaCredito          MotivoNotaCredito?    @map("motivo_nota_credito")
  
  // Conservazione sostitutiva a norma (obbligo legale 10 anni)
  conservazioneRiferimento  String?                @map("conservazione_riferimento") // id pacchetto/hash del provider
  conservazioneDataInvio    DateTime?              @map("conservazione_data_invio")
  
  note                      String?
  notePiePagina             String?                @map("note_pie_pagina")
  
  // Fatturazione Elettronica SDI
  canale                    CanaleFattura          @default(sdi)
  statoSdi                  StatoSdi               @default(n_a) @map("stato_sdi")
  codiceDestinatario        String?                @map("codice_destinatario")
  pecDestinatario           String?                @map("pec_destinatario")
  esitoSdiDettagli          String?                @map("esito_sdi_dettagli")
  
  righe                     FatturaRiga[]
  scadenzeIncasso           ScadenzaIncasso[]
  registrazioniIncasso      RegistrazioneIncasso[]
  
  createdAt                 DateTime               @default(now()) @map("created_at")
  updatedAt                 DateTime               @updatedAt @map("updated_at")

  @@unique([tenantId, serie, numeroProgressivoSerie, data])
  @@index([tenantId, clienteId])
  @@index([tenantId, progettoId])
  @@map("fattura")
}

model FatturaRiga {
  id                    String          @id @default(uuid())
  tenantId              String          @map("tenant_id")
  fatturaId             String          @map("fattura_id")
  fattura               Fattura         @relation(fields: [fatturaId], references: [id], onDelete: Cascade)
  
  tipo                  TipoFatturaRiga @default(milestone_libera)
  articoloId            String?         @map("articolo_id")
  articolo              Articolo?       @relation(fields: [articoloId], references: [id], onDelete: SetNull)
  moduloProgettoId      String?         @map("modulo_progetto_id")
  moduloProgetto        ModuloProgetto? @relation(fields: [moduloProgettoId], references: [id], onDelete: SetNull)
  
  descrizione           String
  quantita              Float           @default(1.0)
  unitaMisura           String          @default("ore") @map("unita_misura") // ore, corpo, forfait
  prezzoUnitarioCent    Int             @map("prezzo_unitario_cent")
  scontoPercentuale     Float           @default(0) @map("sconto_percentuale")
  
  aliquotaIva           Int             @default(22) @map("aliquota_iva")
  naturaEsenzione       String?         @map("natura_esenzione") // N1, N2.2, N3.1, N4
  applicaCassa          Boolean         @default(true) @map("applica_cassa")
  applicaRitenuta       Boolean         @default(true) @map("applica_ritenuta")
  applicaBollo          Boolean         @default(false) @map("applica_bollo") // true se riga esente/esclusa IVA rilevante ai fini bollo
  
  imponibileCentesimi   Int             @map("imponibile_centesimi")
  ivaCentesimi          Int             @map("iva_centesimi")
  totaleRigaCentesimi   Int             @map("totale_riga_centesimi")
  ordine                Int             @default(1)

  @@map("fattura_riga")
}

// --- Audit trail: traccia ogni operazione critica sul ciclo fatturazione ---
model AuditLogFattura {
  id          String   @id @default(uuid())
  tenantId    String   @map("tenant_id")
  fatturaId   String   @map("fattura_id")
  utenteId    String   @map("utente_id")
  azione      String   // "emissione", "annullo_bozza", "nota_credito", "incasso", "storno_incasso", "invio_sdi"
  dettagli    Json?
  createdAt   DateTime @default(now()) @map("created_at")

  @@index([tenantId, fatturaId])
  @@map("audit_log_fattura")
}

// --- Ciclo passivo: fornitori e fatture ricevute ---
model Fornitore {
  id            String              @id @default(uuid())
  tenantId      String              @map("tenant_id")
  ragioneSociale String             @map("ragione_sociale")
  partitaIva    String?             @map("partita_iva")
  codiceFiscale String?             @map("codice_fiscale")
  fattureRicevute FatturaRicevuta[]

  @@map("fornitore")
}

model FatturaRicevuta {
  id                    String     @id @default(uuid())
  tenantId              String     @map("tenant_id")
  fornitoreId           String     @map("fornitore_id")
  fornitore             Fornitore  @relation(fields: [fornitoreId], references: [id])
  numero                String
  data                  DateTime
  imponibileCentesimi   Int        @map("imponibile_centesimi")
  ivaCentesimi          Int        @map("iva_centesimi")
  totaleCentesimi       Int        @map("totale_centesimi")
  esigibilitaIva        EsigibilitaIva @default(immediata) @map("esigibilita_iva")
  pagata                Boolean    @default(false)
  dataPagamento         DateTime?  @map("data_pagamento")
  xmlSdiRaw             String?    @map("xml_sdi_raw") // xml ricevuto via SDI, se disponibile
  createdAt             DateTime   @default(now()) @map("created_at")

  @@index([tenantId, fornitoreId])
  @@map("fattura_ricevuta")
}

// --- Liquidazione IVA periodica (LIPE) ---
model LiquidazioneIva {
  id                    String   @id @default(uuid())
  tenantId              String   @map("tenant_id")
  periodo               String   // "2026-Q3" o "2026-09"
  ivaDebitoCentesimi     Int      @default(0) @map("iva_debito_centesimi")   // da fatture attive
  ivaCreditoCentesimi    Int      @default(0) @map("iva_credito_centesimi")  // da fatture ricevute
  saldoCentesimi         Int      @default(0) @map("saldo_centesimi")       // debito - credito
  versata                Boolean  @default(false)
  dataVersamento         DateTime? @map("data_versamento")

  @@unique([tenantId, periodo])
  @@map("liquidazione_iva")
}
```

---

## 🛠️ 3. Scaletta Dettagliata di Sviluppo (Fasi 0 – 8)

### 🔹 Fase 0: Fondamenta Fiscali (pregiudiziale alle altre fasi)
- [ ] Definire la logica di calcolo del **bollo virtuale** (€2 automatico se totale operazioni esenti/escluse IVA in fattura > €77,47), a carico cliente salvo diversa configurazione.
- [ ] Implementare la gestione di **esigibilità IVA** (`immediata` / `differita` art. 6 DPR 633/72 / `split` per fatture verso PA — split payment).
- [ ] Progettare e imporre il vincolo di **immutabilità post-emissione**: a livello di service (non solo UI), bloccare ogni `UPDATE` su `righe`/totali quando `Fattura.stato != bozza`. Unica via di correzione: Nota di Credito.
- [ ] Definire la policy di **numerazione progressiva**: buco ammesso solo su annullo di fattura in stato `bozza`; su fattura emessa, buco vietato per legge → obbliga a nota di credito; reset annuale della sequenza per serie (`FT`, `NC`).

### 🔹 Fase 1: Schema Prisma & Migrazione Additiva
- [ ] Aggiornare `prisma/schema.prisma` con i modelli arricchiti `Fattura`, `FatturaRiga`, `AuditLogFattura`, `Fornitore`, `FatturaRicevuta`, `LiquidazioneIva`.
- [ ] Generare la migrazione SQL idempotente e retrocompatibile `prisma/migrations/20260901_riforma_fatturazione_integrata/`.
- [ ] Definire e documentare il **piano di rollback** della migrazione (script di reversione testato su ambiente di staging Supabase prima del deploy in produzione).
- [ ] Applicare la migrazione su Supabase ed eseguire `npx prisma generate`.

### 🔹 Fase 2: Motore di Calcolo Fiscale (`src/services/fatturaEngine.ts`)
- [ ] Implementare `calcolaTotaliFattura(righe, opzioni)` per il calcolo esatto di imponibile, cassa, IVA per aliquota, ritenuta, **bollo virtuale** e netto a pagare.
- [ ] Implementare `generaPianoScadenze(fattura, condizionePagamento, dataEmissione)` per la generazione automatica delle rate.
- [ ] Implementare `generaNotaCredito(fatturaOrigineId, righeDaStornare, motivo)`: crea documento TD04 collegato, con effetto a cascata su scadenzario (annulla/riduce rate non incassate) e su Prima Nota (se rata già incassata, genera movimento di storno — mai cancellazione diretta).
- [ ] Implementare il guard di **immutabilità**: ogni funzione di update su `Fattura`/`FatturaRiga` verifica `stato === bozza`, altrimenti lancia eccezione esplicita.
- [ ] Implementare la suite di test unitari `src/services/fatturaEngine.test.ts` con casi di test reali (regime ordinario 22%, cassa 4%, ritenuta 20%, regime forfettario esente IVA con bollo virtuale, nota di credito totale e parziale, split payment PA).

### 🔹 Fase 3: Importatori Sorgente & API Backend (`src/routes/contabilita.ts`)
- [ ] `POST /fatture/da-progetto`: importa i moduli/microvoci selezionate con avanzamento %.
- [ ] `POST /fatture/da-preventivo`: importa le righe del preventivo approvato.
- [ ] `POST /fatture/da-retainer`: genera la fattura per il canone ricorrente e aggiorna la data del prossimo rinnovo.
- [ ] `POST /fatture/da-timesheet`: genera la fattura aggregando le ore approvate per operatore/tariffa.
- [ ] `POST /invoices/:id/emetti`: valida i dati fiscali, assegna il numero progressivo con lock, genera lo scadenzario rate e scrive la voce di `AuditLogFattura`.
- [ ] `POST /invoices/:id/nota-credito`: genera nota di credito (totale o parziale) collegata alla fattura origine, con propagazione su scadenzario/Prima Nota.
- [ ] `POST /invoices/scadenze/:id/incassi`: incassa la rata, genera la registrazione in Prima Nota, aggiorna la redditività commessa e scrive `AuditLogFattura`.
- [ ] `POST /invoices/scadenze/:id/sollecito`: genera sollecito automatico per rata scaduta non incassata, calcolando gli interessi di mora ai sensi del D.Lgs. 231/2002 per rapporti B2B.
- [ ] `POST /invoices/:id/conserva`: invia la fattura al provider di conservazione sostitutiva a norma e registra `conservazioneRiferimento`/`conservazioneDataInvio`.

### 🔹 Fase 4: Generazione PDF & Tracciato XML FatturaPA 1.2
- [ ] Aggiornare `src/services/pdfService.ts` (`generateInvoicePdfBuffer`) con la nuova impaginazione conforme OpenSTAManager (riepilogo IVA per aliquota, cassa, ritenuta, bollo, coordinate bancarie IBAN dello Studio).
- [ ] Aggiornare `src/services/sdiService.ts` per popolare accuratamente tutti i nodi XML di FatturaPA 1.2, inclusi `EsigibilitaIVA`, `DatiBollo` e, per note di credito, il blocco `DatiFattureCollegate`.
- [ ] Definire e integrare il **provider/intermediario SDI** (es. Aruba, invio diretto SDI, altro): valutazione tecnica, credenziali, endpoint di trasmissione.
- [ ] Gestire il ciclo notifiche SDI completo: RC (ricevuta consegna), NS (scarto), MC (mancata consegna), NE (notifica esito), DT (decorrenza termini) — con transizioni di stato esplicite su `statoSdi` e relativo audit log.

### 🔹 Fase 5: Frontend — Rinnovo `InvoicesPage.tsx` e `FatturazioneTab.tsx`
- [ ] Rimuovere ogni traccia di `localStorage` e collegare tutte le tabelle a `fetchTutteFattureStudioApi()`.
- [ ] Creare il componente `NuovaFatturaModal.tsx` con:
  - Selezione cliente con auto-completamento P.IVA, CF, SDI, indirizzo.
  - Tabella righe dinamica (aggiunta riga, selezione articolo da catalogo, qta, prezzo, iva, ritenuta).
  - Box di riepilogo finanziario live in tempo reale.
  - Selezione condizioni di pagamento e conto IBAN di accredito.
- [ ] Integrare il tab di fatturazione in `ProjectDetail.tsx` per mostrare l'avanzamento economico reale e lo stato incassi sincronizzato.

### 🔹 Fase 6: Collaudo Completo & Rilascio
- [ ] Esecuzione della test suite completa (`npm test`) garantendo 100% test verdi.
- [ ] Test **end-to-end** del flusso integrale: bozza → emissione → trasmissione SDI → notifica RC/NS → incasso rata → registrazione Prima Nota → ricalcolo redditività commessa → (caso alternativo) nota di credito → storno.
- [ ] Typecheck TypeScript backend e frontend (`npx tsc --noEmit` & `npm run build`).
- [ ] Deploy sincrono su GitHub (`origin main`), Supabase, Railway e Vercel, con verifica post-deploy che il piano di rollback (Fase 1) sia eseguibile senza perdita dati.

### 🔹 Fase 7: Ciclo Passivo & Liquidazione IVA Periodica (LIPE)
- [ ] Modellare e implementare l'anagrafica `Fornitore` e la registrazione di `FatturaRicevuta` (manuale o da import XML SDI ricevuto).
- [ ] Implementare `calcolaLiquidazioneIva(tenantId, periodo)`: aggregazione IVA a debito (fatture attive emesse nel periodo, secondo esigibilità) vs IVA a credito (fatture ricevute), con generazione record `LiquidazioneIva` mensile/trimestrale.
- [ ] Implementare la generazione **F24** per il versamento dell'IVA periodica e delle ritenute d'acconto trattenute a professionisti.
- [ ] Implementare la generazione della **Certificazione Unica (CU)** annuale riepilogativa delle ritenute operate verso i professionisti sostituiti.
- [ ] Collegare il registro acquisti (fatture ricevute) al cruscotto di redditività commessa, per un margine reale che consideri anche i costi esterni fatturati.

### 🔹 Fase 8: Conservazione Sostitutiva, Audit & Solleciti
- [ ] Integrare un provider di **conservazione digitale a norma** (10 anni) per tutte le fatture elettroniche emesse e ricevute; automatizzare l'invio post-emissione/post-ricezione.
- [ ] Attivare la scrittura sistematica su `AuditLogFattura` per ogni operazione critica (emissione, annullo bozza, nota di credito, incasso, storno incasso, invio/notifica SDI, invio in conservazione), con vista di consultazione per tenant.
- [ ] Implementare il job schedulato di **solleciti automatici**: rilevazione rate scadute non incassate, calcolo interessi di mora (D.Lgs. 231/2002 per B2B), invio email/PDF di sollecito al cliente con storicizzazione degli invii.
