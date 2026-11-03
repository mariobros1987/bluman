# 04 · Segreti, crittografia & configurazione — 11/10/2026

> Audit avversariale a mano. Ogni rilievo cita `file:riga` su codice letto.
> Nessun valore di segreto è riportato: le credenziali sono citate per nome.

## Sintesi

La gestione dei segreti è matura: ogni segreto critico è **obbligatorio in produzione** (il
processo si ferma se manca o è troppo corto), la crittografia usa primitive corrette (HMAC-SHA256
per JWT e sigillo, AES-256-GCM per il TOTP con chiave derivata via HKDF, AES-256 per il backup),
i confronti sensibili sono a tempo costante, e i file `.env.example`/`.env.prod.example` contengono
**solo valori vuoti e commenti**, nessuna credenziale reale (Regola 5 rispettata). Il nuovo modulo
della copia off-site (`backupOffSite.ts`) è scritto con cura difensiva esemplare. I rilievi sono
tradeoff dichiarati, non difetti.

## Rilievi

### [Severità Bassa] Il sigillo di firma ripiega su `JWT_SECRET`

- **Descrizione.** `SIGILLO_HMAC_SECRET` ripiega su `JWT_SECRET` quando non impostato
  (`otpService.ts:322`). È un tradeoff dichiarato (non imporre nuova configurazione), e in
  produzione comunque **si ferma** se nessuno dei due è ≥32 caratteri (`:323-329`). Però lega due
  domini: ruotare `JWT_SECRET` (che slogga le sessioni) cambierebbe anche la chiave del sigillo, e
  i sigilli emessi prima non sarebbero più riverificabili — a meno di gestire `JWT_PREVIOUS_SECRETS`
  anche per il sigillo, cosa che `sigilloHmac` non fa.
- **File.** `src/services/otpService.ts:321-347`.
- **Come sfruttarlo.** Non è un exploit: è un rischio di invalidazione delle prove di firma a una
  rotazione del segreto JWT.
- **Rimedio.** Impostare un `SIGILLO_HMAC_SECRET` dedicato e stabile in produzione (indipendente da
  JWT_SECRET), così la rotazione delle sessioni non tocca la riverificabilità dei sigilli.

### [Severità Bassa] Marca temporale del sigillo = orologio del server

- **Descrizione.** Il `timestampIso` del sigillo è l'orologio del server, non una marca temporale
  qualificata (RFC 3161 / TSA esterna). È già annotato nel codice come lavoro futuro: per la data
  certa opponibile ai terzi non basta l'orologio locale.
- **File.** `src/services/otpService.ts:317-319`.
- **Rimedio.** Integrare una TSA esterna quando la firma dovrà essere opponibile; vedi
  `piano-firma-legale-ses-fea-feq.md`. Non è sicurezza applicativa in senso stretto, ma valore legale.

## Note positive (verificate, nessun rilievo)

- **Segreti obbligatori in produzione**: JWT (`jwt.ts:24-40`), sigillo (`otpService.ts:323-329`),
  TOTP (`totp.ts:182-186`). In sviluppo degradano con avviso; in produzione terminano.
- **Copia off-site (voce 8-bis)** — `src/services/backupOffSite.ts`: il token **non è mai
  restituito** da nessuna rotta (si espone solo il `mtime` come data di configurazione,
  `leggiConfigurazione:157-165`); `validaTokenRclone` pretende `refresh_token` (`:117-123`),
  rifiuta JSON invalido, config intera e testo troppo lungo; il file è scritto `0640` con
  `temp`+`rename` e `chmod` esplicito dopo la rinomina (`scriviTokenRclone:189-193`);
  `leggiStato`/`leggiJson` degradano a `sconosciuto`/`unknown`, **mai** a `ok`, su file assente o
  malformato (`:276-320`). Difesa esemplare.
- **Nessun segreto committato**: `.env.example` e `.env.prod.example` hanno solo valori vuoti e
  commenti (verificato: tutte le chiavi `SECRET/TOKEN/PASS/KEY` sono `=""` o `= `).
- **Crittografia**: HMAC-SHA256 (JWT, sigillo), AES-256-GCM + HKDF-SHA256 (TOTP), AES-256 (backup);
  magic token come SHA-256 del valore (giustificato: segreto ad alta entropia, non una password).

## Conteggio: 0 Alta, 0 Media, 2 Bassa.
