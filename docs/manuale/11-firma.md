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

## 🔗 Collegamenti
- **Documenti** (§10): il documento pubblicato diventa firmabile; una volta firmato è immutabile.
- **Progetti** (§01): la conclusione di un modulo è una firma.
- **Portale** (§12): il flusso OTP del cliente.

## ⚠️ Stati limite & errori
- Ri-firma della stessa parte → **409**; firmare un modulo non `done` o non proprio → **409**.
- Senza `EMAIL_RELAY_SECRET` l'invio OTP via canali non parte (relay fail-closed, §15).
- Le etichette UI usano il wording SES «art. 20 CAD» (non «FEA/eIDAS») dove appropriato.

## 🔧 Nota tecnica
- Rotte: `src/routes/firma.ts` (`segnaDocumentoFirmato`, elenco firme), `portale.ts`
  (`/portal/verify-otp-and-sign`, `/portal/firma-con-file`). Servizi: `otpService` (`sigilloHmac`,
  `generateEidasSignatureSeal`), `copiaFirmata.ts`, `generaPdfDocumento`.
- Frontend: `components/documenti/FirmaStudioModal.tsx`, `components/portal/FirmaOtpModal.tsx`,
  `SuccessSealModal.tsx`.
- Schema: `FirmaElettronica` (`firmatoAt`, `ip_address`, hash, sigillo), enum stato firma su `Documento`.
- Fonti: `.agents/AGENTS.md`, `AUDIT_2026-09-27/05-documenti-firma.md`, `piano-firma-legale-ses-fea-feq.md`.
