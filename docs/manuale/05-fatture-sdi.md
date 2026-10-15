# 05 · Fatture / Note di Credito & SDI

## 👤 Cosa fa e come si usa
Il registro **Fatture/NC** (`/invoices`) emette e traccia fatture e note di credito, con export del
tracciato **XML SdI** (FatturaPA).
- **Emettere una fattura**: dal registro o da scheda progetto (fattura su **modulo** completo,
  parziale o milestone libera); si scelgono cliente, righe, canale (SdI / standard).
- **Nota di Credito**: totale o **parziale per riga** (selezioni righe e quantità); i totali si
  ricalcolano dalle righe scelte.
- **SdI**: generazione XML e connettore 1-click; il registro mostra lo **stato SdI** e le fatture
  scartate/da ritrasmettere.
- **Filtri**: ricerca, stato, e **periodo** (data di emissione) — che circoscrive anche i totali del
  riepilogo (emesso/incassato/sospeso/NC).

## 📐 Calcoli & logica
- **Numerazione progressiva per serie e per anno**: il progressivo è `max(numeroProgressivoSerie) +
  1` fra le fatture **emesse nell'anno in corso**, quindi riparte da `001` a ogni gennaio (art. 21
  DPR 633/72): la prima fattura del 2027 è `FT-2027/001`, non `FT-2027/043`. Un indice UNIQUE
  parziale su (studio, serie, **anno**, progressivo) protegge dai doppioni, e l'anno è quello
  **stampato nel numero** — data e progressivo vengono dallo stesso istante, così una fattura emessa
  a cavallo della mezzanotte di capodanno non è numerata 2027 e contata nel 2026.
- Nessun contatore separato da tenere allineato: cancellando le fatture, il progressivo riparte da 1.
  È il rovescio della medaglia di «niente stato in più», e vale la pena saperlo prima di cancellare.
- **IVA e totali**: calcolati dal motore (`calcolaTotaliFattura`/`fatturaEngine`); riepilogo IVA SdI
  coerente con arrotondamento **di gruppo** (evita il ±1 cent che l'SdI rifiuta).
- **NC parziale**: la fattura resta `emessa` se lo storno non copre tutto; le rate aperte calano in
  proporzione, una rata azzerata senza incassi diventa `stornata`.
- **Gate KYC**: l'emissione può essere vincolata alla compliance del cliente (§13).
- **L'XML si compone solo con l'anagrafica dello studio completa**: scaricandolo
  (`GET /invoices/:id/sdi-xml`) con uno dei sei campi obbligatori vuoto la risposta è **409** e il
  messaggio **nomina i campi** («manca il Codice Fiscale Societario»), invece di comporre un XML con
  la P.IVA a zero e l'indirizzo «Via Roma 1» — che non è un documento con un buco, è un documento
  falso. I sei campi e il perché sono in §16.

## 🔗 Collegamenti
- **Progetti** (§01): si fattura sul **modulo**; un progetto con fatture non si elimina (si archivia).
- **Scadenzario** (§06): la fattura genera le **rate** di incasso.
- **Prima Nota** (§07): l'incasso registra il movimento.
- **Clienti** (§02): P.IVA/CF/SDI/IBAN per l'XML.
- **Impostazioni** (§16): l'anagrafica dello studio — senza i sei dati obbligatori l'XML non si compone.

## ⚠️ Stati limite & errori
- Incassare una rata **stornata** → **409**.
- `PUT /invoices/:id` atomico (niente stati incoerenti).
- SdI scartata: ritrasmissione (scarto tecnico) **o** NC + riemissione (scarto di contenuto) — la UI guida.

## 🔧 Nota tecnica
- Rotte: `src/routes/contabilitaRegistro.ts` (`GET /invoices`, filtri+periodo+riepilogo),
  `contabilitaFatture.ts` (emissione/NC), `contabilitaSdi.ts` (SdI). Motore: `services/fatturaEngine.ts`,
  `mappaturaFatturaSdi.ts`, `sdiXmlGenerator.ts`.
- Frontend: `pages/InvoicesPage.tsx`.
- Schema: `Fattura` (`tipoDocumento`, `serie`, `numeroProgressivoSerie`, `data`, `statoSdi`,
  `fatturaOrigineId`), `FatturaRiga`, `ScadenzaIncasso`.
- Fonti: `.agents/AGENTS.md`, `AUDIT_2026-09-27/04-contabilita-fatturazione.md`.
