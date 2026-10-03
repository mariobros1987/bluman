# 02 — KYC/AML (K0–K9)

> Audit del modulo Compliance/AML Malta v0.2 sul codice reale (non sulla mappa AGENTS.md).
> Riferimento spec: `bluman-kyc-compliance-specifica-v0.2.md`. Ogni rilievo cita `file:riga`.
> Data: 2026-09-27. Auditor senior.

---

## Come funziona & logica applicata

### Fondazione (K0) — regole per configurazione
Ogni studio ha una riga `TenantComplianceSettings` (pacchetto giurisdizione `MT`/`IT`, profilo
`CSP_MFSA`/`ALTRO_SOGGETTO_OBBLIGATO`, `retentionYears`, `mlroUserId`, canale, provider screening,
soglia TE, allarme 14gg). Gestita da `GET/PUT /tenant/compliance-settings`
(`src/routes/compliance.ts:32,41`). Il principio §3.1 «le regole cambiano per configurazione, non nel
codice» è realizzato via questi parametri + i feature flag; i default incerti sono marcati
`[da verificare]` (es. cadenza formazione 12 mesi `src/domain/formazioneKyc.ts:10`, soglia TE 25%
`src/routes/kyc.ts:236`).

Il modulo è attivabile **per-studio a due livelli**: `Tenant.moduliConcessi` (piattaforma) ∧
¬`Tenant.moduliDisattivati` (admin studio) → motore puro `src/util/moduliTenant.ts:21`, guardia
`src/util/guardiaModuli.ts:11` (`moduloKycAttivo`, fail-open sull'errore di lettura). Ogni rotta
`/kyc` e `/tenant/compliance-*` risponde **403** se il modulo è spento.

### Catena ComplianceEvent (append-only, tamper-evident)
`registraComplianceEvent` (`src/services/complianceEventLog.ts:20`) è il punto unico che aggiunge un
anello: legge l'ultimo evento del tenant, calcola `sha256(tipo+payload+createdAt+hashPrecedente)`
(`complianceService.ts:28`) e persiste `createdAt` **esplicito** uguale all'istante firmato.
`verificaCatena` (`complianceService.ts:61`) ricontrolla linkage e hash e ritorna il primo indice
rotto. Ogni transizione di stato, decisione MLRO, screening, override, retention, ecc. emette un
evento.

### Ciclo di vita del fascicolo (K1) — macchina a stati pura
`FascicoloKyc` è il `KycCase` della spec. Stati v0.2 (`src/domain/kycStateMachine.ts:13`):
`bozza → in_raccolta → in_verifica → in_attesa_approvazione → approvato | respinto | sospeso →
in_revisione → chiuso`. Transizioni ammesse in `TRANSIZIONI_KYC:34`; `chiuso` è terminale.
`transizioneKyc` (`src/services/kycCaseService.ts:41`) valida la transizione, applica il gate MLRO
(§8.3), il gate screening (§8.4), persiste storico + ComplianceEvent. Alla creazione
(`src/routes/kyc.ts:86`) il livello/rischio/scadenza iniziali li calcola il motore
`calcolaRischioKyc` (`src/domain/kycEngine.ts:48`).

### Le regole di business
- **Rischio worst-case (K3, §6)**: 4 pilastri (cliente/geografia/prodotto/canale), il complessivo è il
  più alto (`src/domain/calcoloRischio.ts:23`); rafforzata se alto (`:37`); revisione Alto 6/Medio
  12/Basso 24 mesi (`:42`). Versionato (`POST /kyc/:id/rischio` crea nuova versione, `kyc.ts:312`).
- **Titolare effettivo (K2, §7)**: `calcolaTitolariEffettivi` (`src/domain/catenaControllo.ts:32`)
  risale i `LegameControllo`, moltiplica le quote lungo i percorsi (worst-case/somma per percorso),
  gestisce cicli, applica la soglia (25% default). Allarme variazione a 14gg
  (`scadenzaVariazioneTe:74`).
- **Gate operativo (K4, §8.1)**: `operativitaBloccataDaKyc` (`src/services/kycGate.ts:25`) è il punto
  unico: niente fattura/avvio incarico se il cliente ha un fascicolo che non consente operatività
  (`kycBloccaOperativita` `kycStateMachine.ts:97` → solo `approvato`/`in_revisione` passano). Onora
  l'`OverrideKyc` motivato (≥10 char, valido 30gg, `kycGate.ts:12,43`).
- **Screening (K5, §8.4)**: `screeningBloccaApprovazione` (`src/domain/screeningKyc.ts:61`) blocca
  l'approvazione se il match più recente per un tipo è `match_da_valutare`/`match_confermato`; NON
  blocca sull'assenza di screening (scelta esplicita, config futura).
- **Anomalie/STR (K8, §5.3)**: `AnomaliaKyc` → decisione MLRO (`anomalieService.ts`, mappa
  `statoDaDecisione` `src/domain/anomalieKyc.ts:38`); `segnalazione_fiau` innesca la STR. La STR
  (`segnalazioneFiauService.ts`) **congela uno snapshot immutabile** del fascicolo
  (`costruisciDossierStr` `src/domain/segnalazioneFiau.ts:66`) e registra riferimento+timestamp
  goAML dopo l'invio manuale dell'MLRO; **non trasmette** e non genera XSD (§10).
- **Retention (K9, §5.4/§8.9)**: alla chiusura, `retentionScadenza = chiusoAt + retentionYears`
  (`src/domain/retentionKyc.ts:25`). Gate d'oro: nessun esito prima della scadenza
  (`puoRegistrareEsitoRetention:73`). `anonimizzato` azzera il PII PRIMA dell'etichetta
  (`retentionService.ts:55`); `cancellato` è solo un'etichetta (nessun delete fisico). Proroga solo
  in avanti (`:99`).
- **Cron (K7/K9)**: `runDailyNotificationCron` (`src/services/cronService.ts`) avvisa lo studio di
  revisioni dovute (blocco 4), conservazioni in scadenza (5) e formazione dovuta (6), solo a modulo
  attivo, con `notificaStudioSilenziosa` (mai al cliente). Le stesse regole alimentano le scadenze
  derivate del calendario (`calendarioEventi.ts:518,558`).

### Vincolo §5.3 (nulla visibile al cliente) — come è tenuto
Tutte le rotte `/kyc` e `/tenant/compliance-*` bloccano il ruolo `cliente` con `vietatoAlCliente`
(`kyc.ts:30`, `compliance.ts:16`). Il portale espone al cliente **solo i propri documenti**
(`/portal/kyc/documenti`, `portale.ts:46`) — nessun rischio, screening o anomalia. Le STR sono
riservate MLRO/admin (`puoDecidereMlro`, `kyc.ts:463`). Sul perimetro API il vincolo §5.3 risulta
**rispettato** (vedi però il rilievo sulla lettura anomalie interna).

---

## Rilievi d'audit

- **[ALTA] La «modalità bozza» del tenant (§8.2/§14) non è applicata: è solo un badge.**
  `modalitaBozza` (`src/services/complianceService.ts:19`) è consultata unicamente per restituire il
  flag in `GET/PUT /tenant/compliance-settings` (`compliance.ts:38,86`) e mostrarlo nel frontend.
  Né `transizioneKyc`/`PATCH /kyc/:id/stato` (`kyc.ts:169`) né il gate `operativitaBloccataDaKyc`
  (`src/services/kycGate.ts:25`) la consultano. — **Impatto:** uno studio senza `regulatoryProfile`
  e senza MLRO può comunque approvare un fascicolo e sbloccare fatturazione/incarichi; il criterio di
  accettazione §14 «Senza profilo e MLRO nessun incarico passa in esecuzione» **fallisce**.
  — **Rimedio:** nel gate e/o nella transizione ad `approvato`, se `modalitaBozza(settings)` bloccare
  con 409/403 esplicito.

- **[MEDIA-ALTA] La valutazione di rischio per-cliente (K3) non impone le quattro motivazioni (§6/§14).**
  `POST /kyc/:id/rischio` (`kyc.ts:312-343`) salva l'assessment con `clienteMotivazione:
  b.clienteMotivazione || null` (ecc.) e **non** chiama mai `assessmentCompleto`
  (`calcoloRischio.ts:32`) — che infatti non è nemmeno importato in `kyc.ts:11`. La stessa regola è
  invece imposta sul business risk di studio (`compliance.ts:146`). — **Impatto:** si può creare e
  poi approvare un fascicolo con pilastri di rischio privi di motivazione — esattamente la
  «categorizzazione su pochi dati» contestata dalla FIAU (§6). — **Rimedio:** validare
  `assessmentCompleto({cliente,geografia,prodotto,canale})` con 400 prima di creare la versione.

- **[MEDIA] Il soggetto principale del fascicolo (`SoggettoKyc` = `Party`) non ha percorso di
  creazione lato studio.** La create staff (`kyc.ts:86`) non valorizza `soggettoId`, e non esiste una
  rotta staff che lo imposti. Viene popolato **solo** in modo pigro quando il *cliente* carica un
  documento dal portale (`portale.ts:35-44` `soggettoKycDelCliente`). — **Impatto:** senza soggetto,
  la catena di controllo K2 ha radice nulla e ritorna sempre vuoto (`kyc.ts:237-239`), gli screening
  nascono con `soggettoId: null` (`kyc.ts:425`), e dossier STR/report mostrano il soggetto come «n/d»
  (`kyc.ts:537,688`; `segnalazioneFiau.ts:75`). Un KYC interamente gestito dallo studio (cliente che
  non usa il portale) non identifica mai il soggetto verificato. — **Rimedio:** creare/collegare il
  `SoggettoKyc` dal `Cliente` alla creazione del fascicolo, o aggiungere una rotta staff dedicata.

- **[MEDIA] Nessuna granularità RBAC interna sul contenuto dei fascicoli (§9).** Le rotte `/kyc`
  distinguono solo `cliente` (403) e i ruoli con potere di decisione MLRO; ogni altro ruolo interno
  (`collaboratore_interno`/`esterno`, advisor, super_admin) ha **lettura e scrittura piena** su
  fascicolo, rischio, screening, TE (nessun `puoDecidereMlro` sulle GET generiche, es. `kyc.ts:47,
  302,390`). La mappa RBAC `onRequest` non copre `/kyc` (solo 9 chiavi, cfr. §23). — **Impatto:** i
  ruoli §9 «Operatore / Responsabile compliance / Amministratore tecnico (nessun accesso ai
  contenuti)» non sono distinti; least-privilege non applicato. — **Rimedio:** chiave RBAC dedicata al
  contenuto compliance + esclusione dell'amministratore tecnico.

- **[MEDIA] Il fascicolo anomalie non ha permessi separati né log d'accesso in lettura (§5.3/§9).**
  `GET /kyc/:id/anomalie` (`kyc.ts:469-481`) ha solo `vietatoAlCliente` + `moduloSpento`: qualunque
  ruolo interno legge le anomalie, senza gate `puoDecidereMlro` e **senza** `recordAudit` sulla
  lettura. Le STR invece sono correttamente MLRO-gated (`kyc.ts:553`) — incoerenza. — **Impatto:** la
  spec §5.3 «il fascicolo anomalie ha permessi e log di accesso separati» e §9 «log dedicato, anche in
  sola lettura» non sono soddisfatti. — **Rimedio:** gate MLRO/compliance sulla GET anomalie +
  registrazione di un evento d'accesso in lettura.

- **[MEDIA] `GET /tenant/compliance-events` restituisce e verifica i 500 eventi PIÙ VECCHI.**
  `compliance.ts:97-101`: `orderBy createdAt asc, take: 500`. Oltre i 500 eventi, la coda (i più
  recenti) non è mai né restituita né verificata, e la UI (`:112`, `reverse()` che promette «il più
  recente in cima») mostra in realtà i 500 più vecchi. — **Impatto:** la storia di compliance recente
  diventa invisibile e `verificaCatena` non copre mai la coda proprio dove servirebbe. — **Rimedio:**
  verificare la catena completa (o per finestre) e paginare la vista dai più recenti.

- **[MEDIA] La catena ComplianceEvent non è protetta dalla concorrenza.** `registraComplianceEvent`
  (`complianceEventLog.ts:24-42`) legge l'ultimo evento e ne crea uno nuovo senza lock/serializzazione
  e senza vincolo univoco su `(tenantId, hashPrecedente)`. Due scritture concorrenti leggono lo stesso
  predecessore e **biforcano** la catena (due anelli con lo stesso `hashPrecedente`); inoltre due
  eventi nello stesso millisecondo rendono ambiguo l'ordinamento `asc` usato da `verificaCatena`.
  — **Impatto:** falsi allarmi di manomissione o fork reale della catena sotto carico (impatto reale
  oggi basso: in produzione solo traffico di prova). — **Rimedio:** advisory lock per-tenant o indice
  univoco su `(tenantId, hashPrecedente)`.

- **[MEDIA-BASSA] Il rischio iniziale usa il motore legacy ITALIANO, non Malta (§3.1).** La create
  (`kyc.ts:75-84`) chiama `calcolaRischioKyc` (`kycEngine.ts`), tarato su D.Lgs. 231/2007: soglia
  default €15.000 (`kyc.ts:25-27`), categorie semplificata `pa`/`societa_quotata`/`ente_vigilato_ue`
  e mitigazione SPID/CIE (`kycEngine.ts:16-17,79`). Non legge il `jurisdictionPack` del tenant, e
  `paesiAltoRischio` arriva `[]` di default (`kyc.ts:79`), quindi la geografia non scatta mai se non
  passata. Il K3 a 4 pilastri (allineato Malta) sovrascrive **solo** se un operatore lo lancia a mano;
  fino ad allora questo `rischioCalcolato` di stampo IT guida il gate e l'obbligo di approvazione MLRO
  §8.3. — **Impatto:** contraddice «regole per configurazione / Malta». — **Rimedio:** derivare il
  rischio iniziale dal pacchetto giurisdizione, oppure esigere un K3 prima dell'approvazione.

- **[BASSA] Fascicoli multipli per cliente e stato iniziale.** `POST /clienti/:clienteId/kyc`
  (`kyc.ts:86`) **crea sempre** un nuovo fascicolo (il commento dice «crea/rinnova» ma non c'è update)
  in stato `in_raccolta` (non `bozza`, stato iniziale della spec §8). Gate e portale leggono
  `orderBy createdAt desc`. Creare un nuovo fascicolo per un cliente già approvato **ri-blocca**
  silenziosamente l'operatività. — **Rimedio:** riusare il fascicolo aperto o rifiutare i duplicati.

- **[BASSA] `livelloVerifica` non viene de-escalato.** `POST /kyc/:id/rischio` imposta
  `livelloVerifica: 'rafforzata'` quando il rischio è alto (`kyc.ts:338`), ma una versione successiva
  che torna a basso/medio non lo reimposta. — **Impatto:** livello di verifica sovrastimato (prudente,
  ma può risultare incoerente col rischio corrente). — **Rimedio:** ricalcolare `livelloVerifica` dal
  rischio complessivo ad ogni versione.

### Elementi verificati e conformi
- RLS presente e forzata su tutte le tabelle nuove del modulo (migrazioni `..._kyc_k0..k9`, K8b, retention,
  business_risk, formazione, questionario): `ENABLE`+`FORCE ROW LEVEL SECURITY` e policy
  `isolamento_tenant ... app_tenant_corrente()` per `bluman_app` (verificato nei `migration.sql`).
- §5.3 rispettato sul perimetro API/portale/cron/notifiche (nessuna esposizione di rischio, screening
  o anomalie al cliente; reminder via `notificaStudioSilenziosa`).
- Gate MLRO §8.3 (`richiedeApprovazioneMlro`) e gate screening §8.4 correttamente cablati nella
  transizione; ogni cambio di stato emette un ComplianceEvent (§8.10).
- Retention §8.9: nessuna azione prima della scadenza; anonimizzazione che azzera il PII prima
  dell'etichetta; proroga solo in avanti.

---

## Domande aperte / da verificare col titolare

1. **Indipendenza MLRO (§9):** `puoDecidereMlro` e l'approvazione rafforzata trattano advisor/
   super_admin come sempre abilitati anche quando esiste un MLRO nominato distinto (`kyc.ts:141,463`).
   È voluto che il responsabile dello studio possa decidere STR/segnalazioni al posto dell'MLRO?
2. **Modalità bozza:** confermi che bloccare l'operatività quando manca profilo+MLRO è un requisito da
   attivare ora (§14) e non una scelta rimandata? (Rilievo ALTA sopra.)
3. **Soggetto del fascicolo:** vuoi che il soggetto KYC principale nasca automaticamente dal Cliente
   alla creazione del fascicolo, o resti legato all'upload del cliente dal portale?
4. **Screening obbligatorio:** oggi si blocca solo sul match non risolto, non sull'assenza di
   screening. Per Malta va reso obbligatorio uno screening prima dell'approvazione?
5. **Soglia TE 25% e cadenza formazione 12 mesi** sono `[da verificare]`: valori da confermare col
   consulente AML maltese (§3/§15).
6. **Rischio iniziale IT vs MT:** l'engine di creazione va riscritto sulle regole maltesi, o si accetta
   che il valore iniziale sia provvisorio finché non si esegue il K3 a 4 pilastri?
7. **Profilo regolatorio** (`CSP_MFSA` vs `ALTRO_SOGGETTO_OBBLIGATO`) ancora non scelto: le funzioni
   per-profilo (Authorisation, registro servizi, coordinamento MBR) restano flag non esercitati.
