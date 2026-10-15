# 07 · Prima Nota & Riconciliazione bancaria

## 👤 Cosa fa e come si usa
La **Prima Nota** (`/prima-nota`) è il registro dei movimenti di **cassa e banca** dello studio:
entrate e uscite, con categoria e collegamento a fattura/fornitore.
- **Movimenti automatici**: quando registri un incasso nello Scadenzario (§06) o versi un F24 dalla
  LIPE (§08), il movimento entra qui **da solo**.
- **Movimenti manuali**: si aggiungono a mano (es. spese, giroconti).
- **Conti bancari**: si gestiscono i conti dello studio (IBAN) su cui si appoggiano i movimenti.
- **Riconciliazione CSV**: si incolla l'estratto conto (una riga per movimento,
  `Data;Causale;Importo;CRO`), si sceglie il conto di destinazione e si importa. Le righe che non si
  riescono a leggere **non** diventano movimenti: restano elencate nel modale, con il numero di riga
  e il motivo, così si corregge il file e si reimportano solo quelle.

## 📐 Calcoli & logica
- Ogni movimento ha **segno** (entrata/uscita), importo in centesimi, categoria (`incasso_fattura`,
  ecc.) ed eventuale collegamento a `fattura`/`fatturaRicevuta`/cliente/fornitore.
- Il saldo si ricava dai movimenti; la riconciliazione confronta le righe importate con i movimenti
  registrati.
- Cancellando una fattura collegata, il movimento **non** sparisce: la FK va a `null` (SetNull), il
  movimento resta come riga di prima nota.
- **Forme accettate nell'import**: la data come `2026-10-15` (ISO) o `15/10/2026`; l'importo con la
  virgola o con il punto decimale (`1.234,56` e `1234.56`), con il simbolo di valuta tollerato. Una
  data che **non esiste** — `31/02/2026` — viene rifiutata, non fatta rotolare al mese successivo.

## 🔗 Collegamenti
- **Scadenzario/Fatture** (§05–06): l'incasso di una rata genera il movimento.
- **LIPE** (§08): il versamento F24 registra il movimento di uscita.
- **Fornitori / Ciclo passivo**: le fatture ricevute alimentano le uscite.

## ⚠️ Stati limite & errori
- Import CSV: una riga con un importo o una data che non si legge **non entra** in Prima Nota e viene
  elencata nel modale (numero di riga, motivo, testo della riga). Non si ripiega su un valore
  plausibile — né un importo né la data di oggi — perché un movimento inventato è indistinguibile da
  uno vero. Il messaggio di esito dice sempre quante righe sono entrate **e** quante sono state
  scartate.
- Empty state sincero se non ci sono movimenti.

## 🔧 Nota tecnica
- Rotte: `src/routes/contabilitaPrimaNota.ts` — `GET /prima-nota`, `POST /prima-nota` (movimento),
  `POST /prima-nota/import-csv` (riconciliazione), `DELETE /prima-nota/:id`. I conti bancari hanno il
  proprio prefisso `/conti-bancari`.
- Frontend: `pages/PrimaNotaPage.tsx`.
- Schema: `MovimentoPrimaNota` (`tipo`, `categoria`, `importoCentesimi`, FK `fattura`/`fatturaRicevuta`/
  `cliente`/`fornitore` a SetNull), `ContoBancario`.
- Fonti: `.agents/AGENTS.md`, `AUDIT_2026-09-27/04-contabilita-fatturazione.md`.
