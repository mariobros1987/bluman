# 11 · Firma elettronica (SES / FEA / FEQ)

## 👤 Cosa fa e come si usa
La firma trasforma un documento (o la **conclusione di un modulo**) in un atto con valore legale.
- **Firma del cliente** (dal Portale, §12): riceve un **OTP** via email/WhatsApp, lo inserisce e firma
  — è una **Firma Elettronica Semplice (OTP verificata) · art. 20 CAD**. Può firmare anche caricando un
  file firmato (`.p7m`) o via provider qualificati (Aruba/InfoCert/Namirial/SPID) per FEQ.
- **Il passaggio codice → firma**: digitato il codice a 6 cifre, la finestra del codice **si chiude** e
  compare il **pad** della firma grafica. Il codice è monouso e viene convalidato **insieme** alla
  firma, non prima: se è errato la firma non si appone, il pad si chiude e si torna al campo per
  correggerlo. Non esiste una «verifica del codice» separata, e non per dimenticanza: accettarlo
  consumandolo prima della firma lo renderebbe un oracolo da tentare a ripetizione.
- **Firma dello studio**: dalla scheda documento (`FirmaStudioModal`), con OTP e sigillo. Firmare a
  nome dello studio è funzione dell'**amministratore** (advisor/super_admin): un collaboratore non
  può, anche se ha i permessi sui documenti. Si firma solo un documento **pubblicato** (né una bozza
  né un documento con una richiesta di modifica aperta), e come per il cliente ne nasce il
  **verbale di firma**.
- **Multi-firma**: un documento **del fascicolo** con più parti (`{{firma_cliente}}`/`{{firma_studio}}`) diventa
  `firmato` solo quando **tutte** hanno firmato; prima è `parzialmente_firmato`. Ogni parte è
  scritta nel dato (`cliente`/`studio`) e non si deduce dal tipo di firma: la firma dello studio
  con un file caricato resta una firma **dello studio** anche se il meccanismo è «file caricato».
  È qui che vive la controfirma, e solo qui: la **lettera d'incarico non è un documento** (non ha
  aree firma, il testo lo compone il portale) e si firma dal cliente, senza seconda firma.
- La **copia firmata** (PDF) porta in coda la **Cronologia delle firme** (codice, data/ora UTC, valore
  legale, impronta del sigillo). Sotto il nome di ciascuna parte compare **il sigillo di quella
  firma**, riletto dalla sua riga: per le firme anteriori al 03/10/2026 l'impronta non è
  ricostruibile e la riga dice `Sigillo SHA-256 non registrato`, che è la verità.

## 📐 Calcoli & logica
- **L'impronta la calcola il server**, **mai** il browser. Per i documenti del fascicolo e per i
  moduli è l'impronta dei dati canonici (il file in archivio, i dati del modulo); per la **lettera
  d'incarico** — che non è un file e non è archiviata: il testo è un template del portale riempito
  nel browser — è l'impronta dei **dati dell'incarico** (parti, studio, progetto, moduli e
  corrispettivi) **più la versione delle clausole del mandato** (una costante di piattaforma,
  `LETTERA_INCARICO_TESTO_SHA256`), tenuta onesta da `src/firmaLetteraIncarico.test.ts`: chi cambia
  una clausola e non aggiorna la costante ha il test rosso. L'**IP** e la marca temporale si
  prendono solo dal **sigillo** emesso da `/portal/verify-otp-and-sign` (regola 7 — una firma che
  nessuno ha apposto non si disegna). ⚠️ Per la lettera il verbale scrive una riga **«Cosa copre
  l'impronta»**: il digest copre i dati e la *versione* delle clausole, **non** il testo reso al
  cliente riga per riga (ricomporlo nel server sarebbe una seconda resa, che può divergere in
  silenzio da quella che il cliente legge). Detto, invece che sottinteso.
- L'**unico** ambito che riceve ancora l'impronta dal browser è l'`addendum`, che non ha una
  sorgente server-side da cui ricalcolarla. La lettera non è più in quel novero (03/10/2026).
- **Sigillo HMAC**: sia la firma cliente sia la firma studio usano l'impronta sul **contenuto** del
  file + sigillo **HMAC** (`sigilloHmac`).
- **Anti ri-firma**: una parte firma **una volta sola** (409 su tentativo doppio); la controfirma
  dell'altra parte resta ammessa. La guardia riconosce la parte dal dato scritto in firma, non dal
  tipo di firma: anche la firma dello studio arrivata da un file caricato è protetta.
- **Ambiti**: `documento`, `modulo_completato` (concludere un modulo dal portale è una firma FEA),
  `engagement_letter`.
- **La lettera d'incarico si firma su un incarico.** La firma porta il **progetto** su cui è stata
  apposta, e senza progetto il server la rifiuta. Non è una formalità: è ciò che permette di
  rispondere a «quale incarico risulta firmato?». Prima la firma non lo diceva, e il portale — che
  poteva solo chiedere «questo cliente ha firmato una lettera?» — dava per firmato **ogni** progetto
  successivo. Quindi: un progetto nuovo nasce **da firmare**, anche se il cliente ha firmato altri
  incarichi in passato.

## 🔗 Collegamenti
- **Documenti** (§10): il documento pubblicato diventa firmabile; una volta firmato è immutabile.
- **Progetti** (§01): la conclusione di un modulo è una firma.
- **Portale** (§12): il flusso OTP del cliente.

## ⚠️ Stati limite & errori
- Ri-firma della stessa parte → **409**; firmare un modulo non `done` o non proprio → **409**.
- **Firma dello studio**: su un documento `bozza` o `in_revisione` → **409**; da un ruolo diverso da
  advisor/super_admin → **403**; se il file è stato bloccato dall'antivirus → **400**. Sono le
  stesse guardie della firma cliente, portate qui il 03/10/2026.
- Firmare la lettera d'incarico **senza un progetto** → **400** su tutti e tre i punti d'ingresso
  (richiesta del codice, firma col codice, firma col file): il codice non viene nemmeno inviato.
  Nel portale i pulsanti restano spenti e il motivo è scritto accanto.
- Senza `EMAIL_RELAY_SECRET` l'invio OTP via canali non parte (relay fail-closed, §15).
- Le etichette UI usano il wording SES «art. 20 CAD» (non «FEA/eIDAS») dove appropriato.
- ⚠️ **Lo studio e il portale leggono la stessa riga**: entrambi leggono la firma vera
  (`firma_elettronica`, ambito `engagement_letter`, con il progetto come riferimento). Prima lo studio
  leggeva `engagement_letter.stato_firma`, che nessuna rotta scrive — quindi la scheda del progetto
  diceva «IN ATTESA» anche su una lettera firmata, mentre il portale la dava per firmata. Ora
  `GET /progetti/:id` espone `firmaLettera` e lo storico contrattuale mostra chi ha firmato, il canale
  verificato, il valore legale e l'identificativo della firma. Attenzione: **una lettera firmata prima
  del 02/10/2026 non risulta firmata da nessun progetto** (la firma non lo diceva), quindi la scheda
  dirà «IN ATTESA» — è la lettura onesta, non un guasto da segnalare come nuovo.

## 🔧 Nota tecnica
- Rotte: `src/routes/firma.ts` (`progettoDaIncaricare`, `improntaLetteraIncarico`, elenco firme),
  `portale.ts` (`/portal/verify-otp-and-sign`, `/portal/firma-con-file`),
  `documentiFirmaStudio.ts` (`/documenti/:id/firma-studio`). Servizi: `otpService`
  (`sigilloHmac`, `generateEidasSignatureSeal`), `copiaFirmata.ts`, `generaPdfDocumento`,
  **`letteraIncarico.ts`** (il testo della lettera come costante di piattaforma: l'estrazione dal
  sorgente del frontend e la sua impronta),
  **`effettiFirma.ts`** (`segnaDocumentoFirmato`, `generaVerbaleDiFirma` — gli effetti collaterali
  di una firma, condivisi da cliente e studio dopo l'estrazione dal monolite del 03/10/2026).
- Frontend: `components/documenti/FirmaStudioModal.tsx`, `components/portal/FirmaOtpModal.tsx`,
  `SuccessSealModal.tsx`, `components/portal/firmaLettera.ts` (quale progetto risulta firmato),
  `components/projectDetail/StoricoContrattiTab.tsx` (lo storico contrattuale dello studio).
- Backend: `prismaApp.getProgetto` espone `firmaLettera` (la firma del progetto); il presidio
  `src/firmaLetteraStudio.test.ts` tiene allineate le due letture.
- Schema: `FirmaElettronica` (`firmatoAt`, `ip_address`, hash, sigillo, **`riferimentoId`** = il
  progetto per la lettera d'incarico, il documento per il vault, il modulo per la conclusione),
  enum stato firma su `Documento`. Dal 03/10/2026 porta anche **`parte`** (`cliente`|`studio` —
  chi ha firmato, che non si deduce dal meccanismo) e **`sigilloDigest`** (l'impronta HMAC di
  quella firma, persistita perché la copia firmata ricomposta dopo la controfirma deve rileggere
  il sigillo della prima parte invece di prendere in prestito quello dell'evento in corso;
  migrazione `20261003120000_firma_parte_e_sigillo`).
- Fonti: `.agents/AGENTS.md`, `AUDIT_2026-09-27/05-documenti-firma.md`, `piano-firma-legale-ses-fea-feq.md`.
