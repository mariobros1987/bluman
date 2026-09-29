# 07 · Prima Nota & Riconciliazione bancaria

## 👤 Cosa fa e come si usa
La **Prima Nota** (`/prima-nota`) è il registro dei movimenti di **cassa e banca** dello studio:
entrate e uscite, con categoria e collegamento a fattura/fornitore.
- **Movimenti automatici**: quando registri un incasso nello Scadenzario (§06) o versi un F24 dalla
  LIPE (§08), il movimento entra qui **da solo**.
- **Movimenti manuali**: si aggiungono a mano (es. spese, giroconti).
- **Conti bancari**: si gestiscono i conti dello studio (IBAN) su cui si appoggiano i movimenti.
- **Riconciliazione CSV**: si importa l'estratto conto e si riconciliano i movimenti.

## 📐 Calcoli & logica
- Ogni movimento ha **segno** (entrata/uscita), importo in centesimi, categoria (`incasso_fattura`,
  ecc.) ed eventuale collegamento a `fattura`/`fatturaRicevuta`/cliente/fornitore.
- Il saldo si ricava dai movimenti; la riconciliazione confronta le righe importate con i movimenti
  registrati.
- Cancellando una fattura collegata, il movimento **non** sparisce: la FK va a `null` (SetNull), il
  movimento resta come riga di prima nota.

## 🔗 Collegamenti
- **Scadenzario/Fatture** (§05–06): l'incasso di una rata genera il movimento.
- **LIPE** (§08): il versamento F24 registra il movimento di uscita.
- **Fornitori / Ciclo passivo**: le fatture ricevute alimentano le uscite.

## ⚠️ Stati limite & errori
- Import CSV malformato: si segnala l'errore, non si inventano movimenti.
- Empty state sincero se non ci sono movimenti.

## 🔧 Nota tecnica
- Rotte: `src/routes/contabilitaPrimaNota.ts` — `GET /prima-nota`, `POST /prima-nota` (movimento),
  `POST /prima-nota/import-csv` (riconciliazione), `DELETE /prima-nota/:id`. I conti bancari hanno il
  proprio prefisso `/conti-bancari`.
- Frontend: `pages/PrimaNotaPage.tsx`.
- Schema: `MovimentoPrimaNota` (`tipo`, `categoria`, `importoCentesimi`, FK `fattura`/`fatturaRicevuta`/
  `cliente`/`fornitore` a SetNull), `ContoBancario`.
- Fonti: `.agents/AGENTS.md`, `AUDIT_2026-09-27/04-contabilita-fatturazione.md`.
