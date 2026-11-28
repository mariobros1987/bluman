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
- **Importo proposto per ogni voce** nel compositore = **prezzo di listino** del suo articolo
  (etichetta «da listino»). Se il modulo ha un prezzo a pacchetto diverso dalla somma dei listini,
  il prezzo del modulo è ripartito **in proporzione al listino** («in proporzione al listino»), al
  centesimo: la somma delle voci è sempre il prezzo del modulo. Se gli articoli non hanno listino,
  in parti uguali («parti uguali»). Lo calcola il server; l'operatore lo può cambiare. Un modulo
  senza prezzo lascia le voci con «importo mancante», da scrivere a mano prima di emettere.
- **Sconto del progetto** (§01): si toglie da ogni modulo in proporzione al suo prezzo, quindi gli
  importi proposti sono già al netto; la fattura emessa dal progetto porta la nota «Sconto concordato
  sul progetto: X su Y», che esce nel PDF.
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
- **Liquidazione IVA** (§08): una fattura a **esigibilità differita** entra nella liquidazione del
  periodo della fattura, e il prospetto la segnala a parte nominandola — perché per legge la sua IVA
  sarebbe esigibile al pagamento.
- **Impostazioni** (§16): l'anagrafica dello studio — senza i sei dati obbligatori l'XML non si compone.

## ⚠️ Stati limite & errori
- **Mancano i dati del cliente** → la fattura **non si emette** (409), dal progetto, dal registro e dal canone Retainer: il messaggio elenca cosa manca e il pulsante porta alla scheda del cliente. Servono **partita IVA o codice fiscale** (ne basta uno; non richiesti al cliente estero) e un **indirizzo** (sede legale o residenza). Non è stato emesso niente e nessun numero è stato usato. La nota di credito non è bloccata: corregge un documento già uscito.
- Incassare una rata **stornata** → **409**.
- `PUT /invoices/:id` atomico (niente stati incoerenti).
- SdI scartata: ritrasmissione (scarto tecnico) **o** NC + riemissione (scarto di contenuto) — la UI guida.

## 🔧 Nota tecnica
- Rotte: `src/routes/contabilitaRegistro.ts` (`GET /invoices`, filtri+periodo+riepilogo),
  `contabilitaFatture.ts` (emissione/NC), `contabilitaSdi.ts` (SdI). Motore: `services/fatturaEngine.ts`,
  `mappaturaFatturaSdi.ts`, `sdiXmlGenerator.ts`.
- Dati del cliente per fatturare: `domain/datiFiscaliCliente.ts` (puro, usato dalle tre rotte che emettono);
  in pagina `components/contabilita/DatiClienteMancanti.tsx`.
- Frontend: `pages/InvoicesPage.tsx`.
- Schema: `Fattura` (`tipoDocumento`, `serie`, `numeroProgressivoSerie`, `data`, `statoSdi`,
  `fatturaOrigineId`), `FatturaRiga`, `ScadenzaIncasso`.
- Fonti: `.agents/AGENTS.md`, `docs/storico/AUDIT_2026-09-27/04-contabilita-fatturazione.md`.
