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
- **Il saldo di un conto si ricava dai suoi movimenti**: `saldo iniziale + entrate − uscite`. Non è
  un numero conservato a parte — è il totale di quello che il conto ha registrato. Un movimento
  **senza conto** non entra nel saldo di nessuna banca, e resta visibile in Prima Nota come non
  attribuito: è la differenza tra «non so dove sia questo denaro» e «l'ho messo io nella banca X».
- **Il conto di un incasso si decide una volta sola**: quello scelto da chi registra l'incasso, o in
  mancanza quello di **accredito della fattura**, o in mancanza il conto **predefinito** dello
  studio. Il movimento in Prima Nota e il saldo nominano **lo stesso** conto, sempre: se il denaro
  entra in una banca, la riga che lo registra lo dice.
- **Il saldo memorizzato è una copia, e viene verificata**: aprendo la pagina dei conti l'app
  ricalcola il saldo dai movimenti e, se la copia non torna, la riporta al valore vero e lo annota
  nel **registro attività** (voce `SALDO_CONTO_RICONCILIATO`, con il nome del conto e i due
  importi). Se il registro mostra una voce così, un percorso aveva dimenticato di aggiornare il
  saldo: il numero mostrato è comunque quello giusto, perché viene dai movimenti.
- La riconciliazione confronta le righe importate con i movimenti registrati.
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
  proprio prefisso `/conti-bancari` (`src/routes/contabilitaContiReport.ts`, che è anche l'unica
  lettura che verifica la copia del saldo).
- **Movimento e saldo si scrivono in un posto solo**: `src/services/primaNotaMovimento.ts`
  (`creaMovimentoConSaldo`, `eliminaMovimentoEStornaSaldo`). Ci passano tutti i dieci percorsi che
  scrivono in Prima Nota — incasso rata, versamento F24, registrazione e saldo di fattura passiva,
  import CSV, movimento manuale, cancellazione, rimborso per Nota di Credito. La definizione del
  saldo è in `src/domain/saldoConto.ts` (`deltaSaldoCentesimi`, `saldoContoCentesimi`).
  `src/primaNotaSaldoCoerenza.test.ts` tiene l'elenco **chiuso**: solo quel servizio può creare o
  cancellare un movimento, e solo quel servizio e la lettura dei conti possono nominare la colonna
  del saldo. È il presidio che vale per il percorso che non è ancora stato scritto — sei su dieci
  lasciavano il saldo indietro, e nessuno dei sei faceva rumore.
- Frontend: `pages/PrimaNotaPage.tsx`, `pages/BanksPage.tsx` (liquidità complessiva e saldo per conto).
- Schema: `MovimentoPrimaNota` (`tipo`, `categoria`, `importoCentesimi`, FK `fattura`/`fatturaRicevuta`/
  `cliente`/`fornitore` a SetNull), `ContoBancario` (`saldoIniziale` è un dato, `saldoAttuale` una
  copia verificata).
- Fonti: `.agents/AGENTS.md`, `AUDIT_2026-09-27/04-contabilita-fatturazione.md`.
