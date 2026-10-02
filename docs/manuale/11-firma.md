# 11 · Firma elettronica (SES / FEA / FEQ)

## 👤 Cosa fa e come si usa
La firma trasforma un documento (o la **conclusione di un modulo**) in un atto con valore legale.
- **Firma del cliente** (dal Portale, §12): riceve un **OTP** via email/WhatsApp, lo inserisce e firma
  — è una **Firma Elettronica Semplice (OTP verificata) · art. 20 CAD**. Può firmare anche caricando un
  file firmato (`.p7m`) o via provider qualificati (Aruba/InfoCert/Namirial/SPID) per FEQ.
- **Firma dello studio**: dalla scheda documento (`FirmaStudioModal`), con OTP e sigillo.
- **Multi-firma**: un documento con più parti (`{{firma_cliente}}`/`{{firma_studio}}`) diventa
  `firmato` solo quando **tutte** hanno firmato; prima è `parzialmente_firmato`.
- La **copia firmata** (PDF) porta in coda la **Cronologia delle firme** (codice, data/ora UTC, valore
  legale, impronta del sigillo).

## 📐 Calcoli & logica
- **L'impronta la calcola il server** dai dati canonici (documento o modulo), **mai** il browser;
  l'**IP** e la marca temporale si prendono solo dal **sigillo** emesso da
  `/portal/verify-otp-and-sign` (regola 7 — una firma che nessuno ha apposto non si disegna).
- **Sigillo HMAC**: sia la firma cliente sia la firma studio usano l'impronta sul **contenuto** del
  file + sigillo **HMAC** (`sigilloHmac`).
- **Anti ri-firma**: una parte firma **una volta sola** (409 su tentativo doppio); la controfirma
  dell'altra parte resta ammessa.
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
- Rotte: `src/routes/firma.ts` (`segnaDocumentoFirmato`, `progettoDaIncaricare`, elenco firme),
  `portale.ts` (`/portal/verify-otp-and-sign`, `/portal/firma-con-file`). Servizi: `otpService`
  (`sigilloHmac`, `generateEidasSignatureSeal`), `copiaFirmata.ts`, `generaPdfDocumento`.
- Frontend: `components/documenti/FirmaStudioModal.tsx`, `components/portal/FirmaOtpModal.tsx`,
  `SuccessSealModal.tsx`, `components/portal/firmaLettera.ts` (quale progetto risulta firmato),
  `components/projectDetail/StoricoContrattiTab.tsx` (lo storico contrattuale dello studio).
- Backend: `prismaApp.getProgetto` espone `firmaLettera` (la firma del progetto); il presidio
  `src/firmaLetteraStudio.test.ts` tiene allineate le due letture.
- Schema: `FirmaElettronica` (`firmatoAt`, `ip_address`, hash, sigillo, **`riferimentoId`** = il
  progetto per la lettera d'incarico, il documento per il vault, il modulo per la conclusione),
  enum stato firma su `Documento`.
- Fonti: `.agents/AGENTS.md`, `AUDIT_2026-09-27/05-documenti-firma.md`, `piano-firma-legale-ses-fea-feq.md`.
