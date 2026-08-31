# 📊 Piano Operativo di Riforma: Gestione Fatture & Contabilità Integrata (OpenSTAManager Engine)

Questo documento definisce l'architettura completa, il modello dati e la scaletta operativa per riformare e integrare il modulo Fatturazione, Scadenzario e Prima Nota di BluMan, traendo ispirazione diretta dai moduli contabili di **OpenSTAManager** (`openstamanager_source/modules/fatture/`).

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
  
  // Totali Calcolati (in centesimi per precisione assoluta)
  totaleImponibileCentesimi Int                    @default(0) @map("totale_imponibile_centesimi")
  totaleCassaCentesimi      Int                    @default(0) @map("totale_cassa_centesimi")
  totaleIvaCentesimi        Int                    @default(0) @map("totale_iva_centesimi")
  totaleRitenutaCentesimi   Int                    @default(0) @map("totale_ritenuta_centesimi")
  totaleDocumentoCentesimi  Int                    @default(0) @map("totale_documento_centesimi")
  nettoAPagareCentesimi     Int                    @default(0) @map("netto_a_pagare_centesimi")
  
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
  
  imponibileCentesimi   Int             @map("imponibile_centesimi")
  ivaCentesimi          Int             @map("iva_centesimi")
  totaleRigaCentesimi   Int             @map("totale_riga_centesimi")
  ordine                Int             @default(1)

  @@map("fattura_riga")
}
```

---

## 🛠️ 3. Scaletta Dettagliata di Sviluppo (Fasi 1 – 6)

### 🔹 Fase 1: Schema Prisma & Migrazione Additiva
- [ ] Aggiornare `prisma/schema.prisma` con i modelli arricchiti `Fattura` e `FatturaRiga`.
- [ ] Generare la migrazione SQL idempotente e retrocompatibile `prisma/migrations/20260901_riforma_fatturazione_integrata/`.
- [ ] Applicare la migrazione su Supabase ed eseguire `npx prisma generate`.

### 🔹 Fase 2: Motore di Calcolo Fiscale (`src/services/fatturaEngine.ts`)
- [ ] Implementare `calcolaTotaliFattura(righe, opzioni)` per il calcolo esatto di imponibile, cassa, IVA per aliquota, ritenuta e netto a pagare.
- [ ] Implementare `generaPianoScadenze(fattura, condizionePagamento, dataEmissione)` per la generazione automatica delle rate.
- [ ] Implementare la suite di test unitari `src/services/fatturaEngine.test.ts` con casi di test reali (regime ordinario 22%, cassa 4%, ritenuta 20%, regime forfettario esente IVA con bollo virtuale).

### 🔹 Fase 3: Importatori Sorgente & API Backend (`src/routes/contabilita.ts`)
- [ ] `POST /fatture/da-progetto`: importa i moduli/microvoci selezionate con avanzamento %.
- [ ] `POST /fatture/da-preventivo`: importa le righe del preventivo approvato.
- [ ] `POST /fatture/da-retainer`: genera la fattura per il canone ricorrente e aggiorna la data del prossimo rinnovo.
- [ ] `POST /fatture/da-timesheet`: genera la fattura aggregando le ore approvate per operatore/tariffa.
- [ ] `POST /invoices/:id/emetti`: valida i dati fiscali, assegna il numero progressivo con lock e genera lo scadenzario rate.
- [ ] `POST /invoices/scadenze/:id/incassi`: incassa la rata, genera la registrazione in Prima Nota e aggiorna la redditività commessa.

### 🔹 Fase 4: Generazione PDF & Tracciato XML FatturaPA 1.2
- [ ] Aggiornare `src/services/pdfService.ts` (`generateInvoicePdfBuffer`) con la nuova impaginazione conforme OpenSTAManager (riepilogo IVA per aliquota, cassa, ritenuta, coordinate bancarie IBAN dello Studio).
- [ ] Aggiornare `src/services/sdiService.ts` per popolare accuratamente tutti i nodi XML di FatturaPA 1.2.

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
- [ ] Typecheck TypeScript backend e frontend (`npx tsc --noEmit` & `npm run build`).
- [ ] Deploy sincrono su GitHub (`origin main`), Supabase, Railway e Vercel.
