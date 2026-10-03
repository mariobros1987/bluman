# Security review avversariale post-fix — 27/09/2026

Revisione mirata alle superfici toccate oggi (auth/2FA, RBAC matrice, isolamento
multi-tenant/RLS, firma multi-parte, relay canali, guardie di ruolo). Obiettivo:
regressioni introdotte dai fix. Ogni rilievo cita `file:riga` sul codice reale.

## Sintesi

Le correzioni odierne sulle superfici sensibili sono, nella grande maggioranza,
solide: il bypass 2FA via pre-token è chiuso in profondità, la firma-studio usa
HMAC + impronta sul contenuto reale, il relay è fail-closed, il gate KYC copre
entrambe le vie di fatturazione, le nuove tabelle KYC hanno RLS forzata, e la PUT
fattura è atomica nel contesto tenant. **Non ho trovato regressioni dirette nei
singoli fix.**

Il problema più serio è **strutturale e amplificato (non causato) dal lavoro RBAC
di oggi**: il server applica «nessuna riga in matrice = consentito» (default
permissivo), mentre il frontend applica default **restrittivi per ruolo**. Poiché
un collaboratore appena creato non ha alcuna riga `permessoModulo`, l'API concede
di default a `collaboratore_interno`/`collaboratore_esterno` moduli che la UI nega
(clienti, fatture, banche, prima nota…). I fix di oggi hanno tappato solo il
sottoinsieme distruttivo (DELETE cliente), non la lettura/scrittura di massa.

Conteggio: **1 Alta, 1 Media, 3 Basse.**

## Rilievi

### [Severità Alta] RBAC server «default permissivo» ⇄ frontend «default per ruolo»: accesso API oltre la UI

- **Descrizione.** L'hook di enforcement blocca solo se esiste una riga
  `permessoModulo` con livello `denied`/`read`; in assenza di riga lascia passare
  (default permissivo). Il frontend invece, in assenza di matrice salvata, applica
  default per ruolo: `collaboratore_esterno` → `denied` su clienti/fatture/banche/
  primanota/scadenzario/retainers; `collaboratore_interno` → `read` su clienti/
  documenti/library e `denied` su fatture/banche/primanota/scadenzario. La creazione
  di un collaboratore **non semina alcuna riga** `permessoModulo`: le righe nascono
  solo quando l'admin salva la matrice in OperatorDetailModal. Quindi, nello stato
  di default (nessuna matrice configurata), il server concede ciò che la UI nega.
- **File.** `src/server.ts:513-544` (blocco enforcement: `denied`/`read` bloccano,
  tutto il resto passa) e commento `:499-512`; `src/util/rbacModuli.ts:11-19`
  (default permissivo dichiarato); frontend `frontend/src/utils/rbac.ts:49-63`
  (default restrittivi per ruolo); nessuna semina permessi in
  `src/routes/tenant.ts:624-632` (creazione utente); `GET /clienti` senza guard
  `src/routes/clienti.ts:158`, `serializzaCliente` espone CF/IBAN/UBO/rischioAml
  `src/routes/clienti.ts:39-59`; `POST/PUT/DELETE /invoices` senza guard di ruolo
  `src/routes/contabilitaFatture.ts:197,298` (solo `tenantId`).
- **Come sfruttarlo.** Con un JWT valido di `collaboratore_esterno` (il ruolo meno
  fidato, es. un consulente freelance) e nessuna matrice configurata:
  `GET /clienti` restituisce l'anagrafica completa dello studio con codice fiscale,
  IBAN, P.IVA, UBO, fonte patrimonio, rischio AML; `POST /invoices` e
  `PUT /invoices/:id` creano/modificano fatture; `POST /conti-bancari`,
  `POST /prima-nota`, `/contratti-ricorrenti` alterano la contabilità — tutto
  mentre la UI mostra quei moduli come «negati». RLS **non** difende: la richiesta
  porta un tenant legittimo, l'isolamento cross-tenant regge, ma l'autorizzazione
  dentro lo studio no. Che il gap sia reale lo conferma il fix parziale in
  `clienti.ts:479-484`, dove è stato aggiunto un guard esplicito su DELETE proprio
  perché «con la matrice clients a default permissivo un collaboratore poteva
  cancellare qualunque cliente».
- **Rimedio.** Riconciliare i due modelli. Opzione robusta: replicare lato server i
  default per ruolo del frontend (una funzione condivisa `permessoEffettivo(ruolo,
  modulo, riga?)` che, in assenza di riga, applichi lo stesso fallback di
  `rbac.ts`), così «nessuna riga» non significhi «accesso pieno» per i
  collaboratori. In alternativa, seminare le righe `permessoModulo` di default alla
  creazione dell'utente (coerenti con `rbac.ts`) e mantenere il default permissivo
  solo per advisor. Nel frattempo, aggiungere guard di ruolo espliciti sulle rotte
  di lettura/scrittura sensibili non ancora coperte (`GET/POST/PUT /clienti`,
  CRUD `/invoices`, `/conti-bancari`, `/prima-nota`, `/contratti-ricorrenti`).

### [Severità Media] `PATCH /tenant/info`: l'advisor può scrivere campi di piattaforma/abbonamento

- **Descrizione.** Il fix di oggi ha ristretto la rotta ad `advisor`/`super_admin`
  (bene), ma la whitelist `allowedKeys` include `piano`, `stato`, `dataAttivazione`,
  `dataScadenza` senza un ulteriore sotto-controllo di ruolo (che invece esiste per
  `moduliDisattivati` e per le chiavi canali). Questi sono campi di governo
  piattaforma, non impostazioni di studio.
- **File.** `src/routes/tenant.ts:290-305` (guard advisor/super_admin + sotto-check
  solo su canali/moduli), `:353-371` (`allowedKeys` con `piano`/`stato`/
  `dataScadenza`/`dataAttivazione`).
- **Come sfruttarlo.** Un `advisor` del proprio studio invia
  `PATCH /tenant/info {"dataScadenza":"2099-01-01","piano":"enterprise"}` e
  auto-proroga/aggiorna l'abbonamento; `{"stato":"attivo"}` potrebbe riattivare uno
  studio che la piattaforma intendeva sospeso (o, al contrario, auto-DoS con
  `sospeso`/`archiviato`, che al prossimo login blocca l'accesso — vedi
  `auth.ts:113-118`).
- **Rimedio.** Spostare `piano`, `stato`, `dataAttivazione`, `dataScadenza` (e
  `giurisdizione`/`durataMesi` se sono governance) sotto un check `super_admin`,
  come già fatto per gli altri campi riservati.

### [Severità Bassa] Firma-studio: nessun aggiornamento di `statoDoc` né verbale (asimmetria col flusso cliente)

- **Descrizione.** Il flusso studio crea la `FirmaElettronica` e la copia firmata
  ma non chiama `segnaDocumentoFirmato` né `generaVerbaleDiFirma`. Con la nuova
  logica multi-parte, se il cliente firma per primo (→`parzialmente_firmato`) e poi
  firma lo studio, lo stato resta `parzialmente_firmato` anche a firme complete: lo
  studio non ritriggera il ricalcolo. Nessun rischio di sicurezza (lo stato è
  *sotto*-dichiarato, non sovra-dichiarato; il valore legale vive nella firma), ma
  incoerenza di evidenza e assenza di verbale lato studio.
- **File.** `src/routes/documentiFirmaStudio.ts:128-197` (nessuna chiamata al
  ricalcolo/verbale); ricalcolo definito e invocato solo lato cliente
  `src/routes/firma.ts:1120-1148,1616,1940`.
- **Come sfruttarlo.** Non sfruttabile: è un difetto di coerenza dati. Già annotato
  in `AUDIT_2026-09-27/05-documenti-firma.md`.
- **Rimedio.** Al termine della firma-studio chiamare `segnaDocumentoFirmato` (e,
  se voluto, `generaVerbaleDiFirma`) come nel flusso cliente.

### [Severità Bassa] Lettura posta in arrivo fuori dalla matrice `communications`

- **Descrizione.** Solo le rotte di **invio** (`/comunicazioni/invia-*`) sono
  mappate a `communications`; le rotte di lettura in arrivo sono POST ma non
  mappate, quindi un collaboratore con `communications: denied` può comunque
  innescare la lettura della casella dello studio (email/allegati/Signal).
- **File.** `src/util/rbacModuli.ts:66-69` (solo invia-*); rotte non mappate
  `src/routes/comunicazioni.ts:397` (`email-in-arrivo`), `:433`
  (`poll-imap-allegati`), `:475` (`signal-in-arrivo`).
- **Come sfruttarlo.** `denied` sul modulo non impedisce di leggere la posta in
  arrivo dello studio. È scelta dichiarata («lettura resta libera»), ma incoerente
  con la semantica di `denied`.
- **Rimedio.** Se `denied` deve significare «nessun accesso al canale», mappare
  anche le rotte in arrivo (bloccando su `denied`, lasciando `read`).

### [Severità Bassa] Firma-studio ammessa su documento in `bozza`

- **Descrizione.** Il flusso cliente rifiuta la firma su `bozza`/`in_revisione`
  (`firma.ts:932-951`); il flusso studio non controlla `statoDoc`, quindi lo studio
  può apporre il sigillo su una propria bozza.
- **File.** `src/routes/documentiFirmaStudio.ts:56-97` (nessun controllo su
  `statoDoc`).
- **Come sfruttarlo.** Non è un vettore esterno (è lo studio sul proprio
  documento), ma può generare un'evidenza legale su un testo non ancora
  pubblicato. Impatto minimo.
- **Rimedio.** Valutare il rifiuto della firma-studio su `statoDoc === 'bozza'`,
  coerentemente col lato cliente.

## Verificato OK (nessun rilievo)

- **Bypass 2FA (pre_totp).** Il marcatore `scopo:'pre_totp'` è respinto come
  sessione nell'hook `onRequest` prima di ogni altra valutazione
  (`src/server.ts:418-419`) e ri-verificato in `/auth/totp/verifica`
  (`src/routes/auth.ts:822-825`). Il rinnovo token avviene solo nel ramo
  autenticato, che i pre-token non raggiungono (`server.ts:458-468`).
  `magic-login`/`client-login` emettono solo token `cliente` con `sessionVersion`
  (`auth.ts:250-258,325-333`). Nessun altro endpoint accetta un JWT ignorando
  `scopo`.
- **Firma-studio (evidenza legale).** Sigillo in HMAC-SHA256 con chiave server
  (`otpService.ts:346`), `docHash` = SHA-256 del **contenuto reale** del file con
  fail-closed se illeggibile (`documentiFirmaStudio.ts:91-96`). Anti ri-firma per
  parte scoped su `tenantId`+`riferimentoId`+`tipoFirma` ('studio' vs non-studio),
  non aggirabile via ruolo (`documentiFirmaStudio.ts:72-79`, `firma.ts:953-960`).
- **Stato multi-firma.** `completo` richiede tutte le parti previste dagli slot del
  template; una firma sola su due → `parzialmente_firmato`
  (`firma.ts:1136-1141`). La cronologia firme è ricostruita dalle righe
  `FirmaElettronica` lette dal server (`firma.ts:1130-1135,204-210`).
- **Isolamento multi-tenant/RLS.** RLS `ENABLE`+`FORCE` con policy `isolamento_tenant`
  sulle nuove tabelle KYC (`prisma/migrations/20260924120000_kyc_k1_anagrafica_soggetti/migration.sql`)
  e su `firma_elettronica` (`prisma/migrations/20260823120000_otp_persistito_e_firme`).
  Le rotte nuove usano il client `prisma` con contesto tenant (non
  `prismaAmministrativo`, usato solo negli accessi anonimi documentati:
  `auth.ts` login/magic-login/totp). `PUT /invoices/:id` è atomico dentro
  `conContestoInTransazione` (`contabilitaFatture.ts:237-289`).
- **Relay canali.** `api/send-email.ts` è fail-closed senza `EMAIL_RELAY_SECRET`
  (503, `:276-281`), confronto segreto timing-safe (`:244-254`), nessun header CORS
  (`:262-266`), certificati TLS verificati salvo opt-in esplicito, nessun ripiego su
  credenziali d'ambiente, destinatario e host validati → nessun open-relay/SSRF
  residuo; i segreti non tornano al browser. Gli invii `/comunicazioni/invia-*` sono
  sotto la matrice `communications` e tracciati con audit (`comunicazioni.ts:150-156`).
- **Guardie di ruolo.** Gate KYC su fatturazione applicato in entrambe le vie
  (`contabilitaFatture.ts:70`, `contabilitaRegistro.ts:43`); `/kyc/:id/soggetto`
  protetto da `vietatoAlCliente`+`moduloSpento` e lookup fascicolo tenant-scoped
  (`kyc.ts:62-66`); creazione team con vincoli anti-escalation super_admin
  (`tenant.ts:559-607`); DELETE/reset/magic-link cliente ristretti a advisor/
  super_admin (`clienti.ts:484`).
- **Contorno.** CORS con whitelist esplicita, helmet CSP `default-src 'none'`,
  rate-limit dedicato sugli endpoint credenziali, error handler che non espone
  dettagli interni in produzione (`server.ts:266-374`).
