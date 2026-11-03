# BluMan — Piano di Sviluppo & Stato Avanzamento Produzione

**Fonte:** `BluMan_specifica_di_sviluppo_v2.3.docx` (34 sezioni).

> ### ⚠️ Documento storico: le caselle non sono lo stato del progetto
>
> Fermo al **18/09/2026**. Da allora il repository è andato avanti e questo file no: non nomina
> nemmeno l'aiuto in-app (`/aiuto`), che è arrivato dopo.
>
> Le caselle sono compilate a mano e non sono mai state verificate contro il codice, quindi
> sbagliano in tutte e due le direzioni. Un esempio per ciascuna: la voce su
> `numeroProgressivoSerie` è spuntata ✅ mentre la serie **non** si azzera a fine anno
> (`src/routes/contabilitaFatture.ts`) — una casella verde sopra un difetto aperto; e tutto il
> lavoro spedito dopo settembre qui non c'è, perché nessuno è più tornato a spuntare niente.
>
> Per sapere cosa manca davvero si legge il codice. La fotografia di un momento sta in
> `AUDIT_2026-09-27/` e `AUDIT_2026-10-11/`, la mappa tecnica in `.agents/AGENTS.md`. Resta qui
> come promemoria di cosa si era pianificato, non come elenco di cosa resta da fare.

---

## 🎯 Stato di Avanzamento Fasi (Aggiornato)

### FASE 0 — Setup e Fondamenta Progetto
- [x] Repository Git locale e remoto GitHub (`mariobros1987/bluman`).
- [x] Backend Fastify + TypeScript + Prisma ORM.
- [x] Frontend React 19 + Vite.
- [x] Mappa architetturale ed indicizzazione per ottimizzazione token (`.agents/AGENTS.md`).
- [x] **Audit Produzione Enterprise**: Documento analitico completo di Go-Live readiness (`production_readiness_audit.md`).

### FASE 0 (bis) — Chiusura Falle di Sicurezza Bloccanti (`analisi.txt`)
Le voci qui sotto erano guasti sfruttabili, non miglioramenti: chiunque leggesse il
repository pubblico poteva autenticarsi in produzione, e l'isolamento tra studi dipendeva
interamente dal fatto che nessuna query dimenticasse il filtro applicativo.

- [x] **Credenziali cablate rimosse da `src/server.ts`**: eliminata la tabella di utenti e
  password nel sorgente (8 coppie email/password) e l'accettazione di qualunque password
  come jolly. L'unica fonte di verità è la tabella `user` del database (§23).
  `src/server.test.ts` contiene un test di regressione che rifiuta ognuna delle vecchie
  coppie: se torna verde per una di esse, la falla è stata reintrodotta.
- [x] **Credenziali cablate rimosse anche dal frontend e dalle funzioni serverless**. Il
  backend non era l'unico posto: `frontend/src/api/client.ts` conteneva una `defaultUserMap`
  di nove coppie email/password che autenticavano **lato client**, senza mai interpellare il
  server — quel file finisce nel bundle pubblico su Vercel, quindi le password erano
  scaricabili da chiunque aprisse la pagina. Rimossi: la mappa, il token di sessione finto,
  la sessione finta di `magicLoginApi`, le tre scorciatoie di ruolo di `LoginPage.tsx`
  (precompilavano tre account reali), il campo password del form di `SuperAdminPage.tsx` e
  la password di ripiego di `api/send-email.ts`. `loginApi` ora interroga solo
  `POST /auth/login` e propaga un errore se il server non risponde, invece di far entrare
  comunque. I valori esatti non sono trascritti qui: vivono solo in
  `src/credenziali.test.ts`, che li cerca.
- [x] **Nessuna rotta aperta per sbaglio (§23)**: l'hook `onRequest` di `src/server.ts`
  respinge con `401` ogni richiesta priva di JWT verificabile. L'elenco codificato è quello
  delle rotte **pubbliche** (`/health`, login, Magic Link, webhook di canale): tutto il
  resto è protetto per difetto, così una rotta nuova non nasce aperta. Il confronto è sul
  pattern (`req.routeOptions.url`), non sull'URL grezzo, perché `onRequest` gira dopo il
  routing. **RLS non copriva questo caso**: una richiesta anonima che porta il tenant di
  default corrisponde legittimamente alle policy, quindi prima del guard RLS lavorava
  correttamente sul tenant sbagliato. `src/server.test.ts` verifica dieci rotte in coppia
  (401 senza token, non-401 con token) e controlla che login, `/health` e webhook restino
  pubblici e che il preflight CORS non venga respinto.
- [x] **`/admin/tenants` riservato al `super_admin`**: la funzione `soloSuperAdmin` risponde
  403 su tutti e quattro i verbi. Prima erano raggiungibili da qualunque utente
  autenticato: un collaboratore interno poteva elencare ogni studio della piattaforma con
  ragione sociale, P.IVA ed email del responsabile, registrarne di nuovi, sospenderli e
  cancellarli. Neanche questo è un compito di RLS — `tenant` è la tabella che *contiene* gli
  studi, non una tabella figlia filtrata per `tenant_id`.
- [x] **Password del responsabile: emessa dal server, mostrata una volta**. La colonna
  `tenant.lead_advisor_password` conteneva la password in chiaro, era restituita da
  `GET /admin/tenants`, era scrivibile da qualunque utente del tenant via `PATCH
  /tenant/info` e finiva in ogni backup. Eliminata dallo schema e dal database con
  `prisma/migrations/20260819120000_rimozione_password_chiaro_tenant/` (applicata su
  Supabase). Al suo posto: `POST /admin/tenants` crea anche la riga `user` del responsabile
  (`ruolo: advisor`) e restituisce la password temporanea una volta sola;
  `POST /admin/tenants/:id/reset-password` la rigenera se va perduta. Il modale del super
  admin la tiene in memoria finché resta aperto e non la salva da nessuna parte.
- [x] **Presidio automatico contro il ritorno delle credenziali**: `src/credenziali.test.ts`
  scandisce `src/`, `frontend/src/` e `api/` e fallisce se una delle vecchie password, un
  token finto o il ripiego `!password ||` ricompare su una riga non commentata. È il test
  che ha trovato `api/send-email.ts`, fuori dal perimetro della ricerca fatta a mano sul
  solo `frontend/src`.
- [x] **`src/scripts/testTenantDb.ts` non riscrive più il tenant di produzione**: conteneva
  tre password in chiaro, sovrascriveva le impostazioni dello studio reale
  `00000000-…-0001` e stampava ogni campo, segreti compresi. Ora pretende `TEST_TENANT_ID`,
  usa segnaposto `.invalid` e maschera i campi segreti.
- [x] **Primo accesso senza credenziali precaricate**: `npm run bootstrap` (§27) crea il
  primo `super_admin` e stampa una password temporanea una sola volta;
  `npm run passwords:assign` copre gli utenti creati dai seed con `password_hash` a NULL;
  i collaboratori li crea il responsabile via `POST /tenant/utenti`.
- [x] **Gerarchia ruoli applicata lato server (§2bis)**: `super_admin` gestisce tutto e vede
  tutti i tenant (`tenant_id` NULL) ed è l'unico che può cambiare studio con `x-tenant-id`;
  l'`advisor` è responsabile del solo proprio tenant e non può creare un `super_admin`; i
  collaboratori appartengono al tenant da cui vengono creati. Email già registrata presso
  un altro studio → 409, mai spostamento di tenant.
- [x] **Il `super_admin` era finito *dentro* un tenant, e un advisor poteva declassarlo**.
  La policy RLS di `user` concede la visione delle righe senza tenant al solo super admin,
  cioè dà per assodato che i super_admin *siano* le righe con `tenant_id` NULL. Il database
  non lo rispettava: `seedFull.ts` li creava con `tenantId = TENANT_ID` e
  `prismaApp.listaUtenti()` li riassegnava al tenant che stava leggendo. Con i `tenant_id`
  uguali, il controllo anti-furto di `POST /tenant/utenti` non scattava e l'`update`
  riscriveva `ruolo` a `collaboratore_interno`: il responsabile di un singolo studio poteva
  declassare il super admin della piattaforma, e con due sole righe lasciarla senza.
  Chiuso su tre piani: la migrazione `20260819190000_super_admin_senza_tenant` ripara il
  dato — con NULL è **RLS** a nascondere la riga, quindi la difesa torna al motore e non a
  un confronto applicativo (regola 1); `listaUtenti()` è tornato di sola lettura; e un 403
  esplicito copre la modifica di una riga il cui ruolo *esistente* è `super_admin`.
  Presidio: `src/gerarchiaRuoli.test.ts`, che verifica anche che l'`update` non venga
  nemmeno tentato — la risposta giusta non basta, la scrittura non deve avvenire.
- [x] **`prismaApp.listaUtenti()` non riscrive più il team a ogni lettura**. Conteneva un
  elenco cablato di cinque persone riscritto con `upsert` a ogni chiamata: `update:
  { tenantId: this.tenantId }` **spostava** quelle righe nello studio che stava leggendo —
  lo stesso furto cross-tenant che il 409 respinge, per una via che nessun controllo
  copriva — e creava utenti senza `password_hash` con email divergenti da quelle vere
  (`francesca@` accanto a `francesca.disabato@`), che restano in anagrafica senza poter
  accedere. Era anche il ripiego del `catch` di `GET /tenant/utenti`: un fallimento di
  lettura si trasformava in una scrittura non richiesta sullo stesso database appena
  fallito. Ora la rotta risponde `503` e lo dice, invece di restituire un elenco vuoto che
  farebbe sembrare lo studio senza collaboratori.
- [x] **Verifica di accessibilità prima del rilascio**: `npx tsx src/scripts/verificaAccessi.ts`
  elenca ruolo, tenant e presenza/assenza di `password_hash` (mai l'hash) e esce con 1 se
  non esiste un `super_admin` attivo con password. Un deploy che chiude l'autenticazione
  senza un super admin utilizzabile blocca la piattaforma fuori da sé stessa: la domanda va
  posta prima, non scoperta dopo.
- [x] **Hashing password senza dipendenze native**: scrypt (`src/util/password.ts`) e JWT
  HMAC-SHA256 firmati a mano (`src/util/jwt.ts`); `bcrypt` e `jsonwebtoken` rimossi dalle
  dipendenze. `JWT_SECRET` obbligatorio (≥32 caratteri) con `NODE_ENV=production`.
- [x] **Rate limiting sulle rotte `/auth/*`** per fermare gli attacchi a forza bruta sul
  login e sul Magic Link.
- [x] **RLS effettiva, non solo dichiarata** — vedi la voce 4 della checklist di rilascio
  qui sotto: il runtime si connette col ruolo `bluman_app`, che non può scavalcare le
  policy, e il contesto tenant viaggia per richiesta.
- [x] **Migrazioni versionate**: baseline `prisma/migrations/0_init/` con drift zero
  verificato, e `Dockerfile` che esegue `prisma migrate deploy` al posto del precedente
  `prisma db push --accept-data-loss`, che a ogni avvio del container riallineava lo schema
  cancellando in silenzio colonne e tabelle non presenti nel file.
- [x] **Pulizia dati inquinati**: rimossi i 57 record di test che attraversavano i tenant.

### FASE 1 (bis) — Integrazione del Motore di Stato (`analisi.txt`, §16)

Il motore di calcolo esisteva già completo e testato in `src/domain/stateEngine.ts`, ma
**nessuno lo chiamava** sul percorso di lettura: le percentuali mostrate erano costanti scritte
nel frontend. Questa fase collega le due metà.

Architettura scelta: **il backend è l'unica verità**. Il calcolo vive in un service che chiama
le funzioni pure e persiste gli stati; le pagine leggono `avanzamento` dall'API e non deducono
nulla. Il dominio non finisce nel bundle pubblico.

- [x] **`src/services/calcoloService.ts`** — unico punto che traduce `stateEngine.ts` in
  letture e scritture Prisma. Espone `calcolaAvanzamento()` (puro, nessuna query),
  `arricchisciProgetti()` (allega l'avanzamento a un elenco già caricato) e
  `ricalcolaProgetto()` (persiste la cascata micro-voce → modulo → progetto).
- [x] **Le percentuali non vengono persistite, e non serve una migrazione**: derivano per
  intero da `stato`, `orePreventivate` e `oreConsuntivate`, che sono già in riga. Una colonna
  `percentuale` sarebbe un dato denormalizzato libero di divergere dai propri ingredienti
  senza che nessuno se ne accorga. Si persistono solo `stato` (modulo, progetto) e
  `segnaleRischio`/`oreExtra` (micro-voce), che una query non può ricostruire.
- [x] **`POST /progetti/:id/ricalcola`** — ricalcolo esplicito dopo un'importazione, una
  correzione a mano o un cambio di regole. Autenticata come tutte le altre, con audit log.
  Nel piano originale si chiamava `/projects/:id/recalculate`: il nome è stato reso italiano
  come ogni altra rotta del file.
- [x] **`GET /progetti` e `GET /progetti/:id` restituiscono `avanzamento`** — stato,
  percentuale, segnale di rischio e ore extra, per progetto e per singolo modulo. Su
  `GET /progetti/:id` l'avanzamento è applicato **dopo** lo spread di `projectStateStore`,
  così la forma inviata dal client non può riscrivere il valore calcolato.
- [x] **`Dashboard.tsx` legge le percentuali invece di inventarle**. Assegnava `45%` a ogni
  progetto in corso, `10%` a ogni altro e `50%` a ogni modulo `in_progress`: numeri senza
  alcun rapporto con le ore lavorate. Ora l'avviso di ritardo di un progetto viene da uno stato
  `delayed`/`blocked` reale o da un segnale di rischio del motore, non da `delay: false` fisso.
- [x] **`ProjectDetail.tsx` mostra un avanzamento che esiste**. La barra del progetto leggeva
  `dbRes.percentualeAvanzamento`, un campo che **il backend non ha mai prodotto**: era ferma a
  zero da sempre. I moduli usavano `60%` fisso.
- [x] **Un modulo senza micro-voci non viene declassato**. `calcolaStatoModulo([])` risponde
  `pending`, corretto per un modulo appena creato ma distruttivo su uno chiuso a mano: con zero
  micro-voci non c'è nulla da aggregare e la riga è l'unica informazione esistente. Il service
  la preserva e non scrive. Il caso è reale — vedi il debito 3.
- [x] **Gli avvisi distinguono il ritardo dallo sforamento di ore** (task 1.6). Il banner della
  Dashboard filtrava solo `delay || blocked`, mentre il contatore "Ritardi attivi" conta anche
  `segnaleRischio`: un progetto in allarme per sole ore sforate compariva nel contatore e nel
  titolo del banner **senza nessuna riga sotto**. Ora ogni motivo produce la propria riga, e
  sono tenuti separati perché hanno rimedi diversi — un ritardo si recupera col calendario, uno
  sforamento solo rinegoziando o assorbendo il costo. Lo stesso segnale compare sull'intestazione
  del modulo in `ProjectDetail.tsx` (`⚠ Ore sforate — +Nh oltre il preventivo`): un allarme
  visibile in dashboard e invisibile nel dettaglio manda a cercare la causa dove non c'è.
- [x] **Presidio**: `src/calcoloService.test.ts`, 23 test. Coprono le percentuali mostrate
  (compreso il tetto a 99 quando l'aritmetica arrotonderebbe a 100 su un progetto non chiuso),
  la media pesata sulle ore, i segnali di rischio, **quali righe vengono scritte e quali no**,
  e le proprietà della rotta via HTTP (200, 404, 401, avanzamento in `GET /progetti` con
  `segnaleRischio`/`oreExtra` per singolo modulo, che sono ciò su cui il banner si scrive).
- [x] **Test del motore puro** (task 1.7): `src/domain/stateEngine.test.ts`, 42 test, un
  `describe` per ognuna delle 10 funzioni esportate — comprese l'assenza di mutazione degli
  input e le guardie contro array vuoti e divisione per zero.
- [x] **Diagnostica**: `npx tsx src/scripts/probeAvanzamento.ts` — sola lettura, dice quali
  righe un ricalcolo cambierebbe *prima* di eseguirlo. È così che sono emersi i debiti 3 e 4.

Il pulsante che mancava adesso c'è: `ricalcolaProgettoApi()` è collegata all'intestazione del
Dettaglio Progetto, visibile ad advisor e super_admin, con conferma esplicita perché è una
scrittura. La scelta di collocarla lì e non fra i comandi quotidiani è del titolare del dato: il
ricalcolo è manutenzione, e va dove un errore si vede. La rotta `POST /progetti/:id/ricalcola`
era però una scrittura **senza controllo di ruolo**: qualunque collaboratore autenticato poteva
riallineare gli stati di un progetto. Ora risponde 403 a chi non è advisor o super_admin, perché
il filtro nella UI non è la difesa (regola 1) — un gate solo nel browser si aggira con una
chiamata diretta.

### FASE 1 (ter) — Il frontend non inventa più i dati che il database non ha
Difetto sistemico, non un refuso: **nove** punti fra due pagine costruivano contenuto verosimile
al posto del dato mancante, rendendo l'inventato indistinguibile dal reale.
- [x] **Portale Cliente** (`frontend/src/pages/ClientPortal.tsx`). Sintomo riferito: i moduli non
  cambiavano al cambio di progetto dal selettore. Il selettore era sano; il difetto era
  `mapProjectToPortalModules`, che quando il progetto non aveva moduli a database ripiegava su un
  elenco scelto **per nome cliente** — perciò identico per ogni progetto dello stesso cliente. Ora
  restituisce `[]` e la pagina dichiara il vuoto. Rimossi anche i due progetti sintetici di
  ripiego (valore 28.500 €, giurisdizione Malta) che comparivano quando il cliente non aveva
  progetti, il pannello "Data Esecuzione: Agosto 2026" (il tipo non porta alcuna data) e tre
  ripieghi `|| 75` su percentuali che il backend calcola.
- [x] **Dettaglio Progetto** (`frontend/src/pages/ProjectDetail.tsx`), sei punti. Il più grave era
  un ripiego **a render time** dentro `ModuloBlock`, che avrebbe annullato ogni correzione a monte:
  le micro-voci inventate erano cliccabili e `consuntivaMicrovoceApi` sarebbe stata chiamata con
  l'id di una micro-voce inesistente. Sparito il "Modulo Iniziale Incarico Advisory" (id 101, 15h,
  3.500 €) che si vedeva sul progetto "1234", il quale a database ha **zero** moduli.
- [x] **Un pulsante che dichiarava di aver salvato senza salvare**: "⚡ Istanzia Subito Moduli &
  Microvoci Operative" scriveva tre moduli per 23.500 € nel solo `localStorage`, mai a database —
  violazione della regola 3. Ora rimanda al percorso reale, "+ Aggiungi Modulo da Libreria", che
  passa da `salvaProgettoDettaglioApi`.
- [x] **Tabella redditività**: le ore reali erano interpolate dalla percentuale, cioè ore che
  nessuno aveva consuntivato, e un modulo senza consuntivazione mostrava "🟡 In Target". Ora legge
  `m.a` (ore consuntivate) e senza dati scrive `—` e "⚪ Nessuna ora consuntivata".
- [x] **Evidenze di firma cablate** — la parte con conseguenze legali. L'Engagement Letter generava
  un PDF che attestava marca temporale e indirizzo IP fissi e **una controfirma dello studio che
  non esiste in nessun registro**: una firma che nessuno aveva apposto. Repertorio, data e impronta
  SHA-256 ora vengono dal sigillo eIDAS emesso da `/portal/verify-otp-and-sign` (che l'IP reale ce
  l'ha, dalla richiesta); senza sigillo il PDF esce senza pagina di evidenze e il pannello lo
  dichiara, invece di mostrarne di finte. Rimossi gli stessi IP cablati dal Vault documenti e dagli
  allegati di modulo.
- [x] **Lo stato di firma tracimava fra clienti**: era inizializzato da chiavi `localStorage` col
  nome di un cliente specifico, quindi in un browser dove quel cliente aveva firmato **ogni** altro
  cliente si vedeva "firmato & congelato". Ora si risolve solo sul nome del cliente autenticato.
- [x] **Un `catch` che dichiarava firmato in caso di errore**: `handleSign` registrava "Simulazione
  firma completata" e proseguiva come se tutto fosse riuscito. Ora dice che la firma è registrata
  ma i moduli operativi non sono stati istanziati, che è quello che è davvero accaduto.
- [x] **Conferma di modulo che si spacciava per FEA**: era interamente lato browser, senza chiamata
  al server, con IP inventato, e annunciava "Sigillo FEA eIDAS UE 910/2014". Ora è etichettata come
  presa visione locale. Trasformarla in firma vera è una scelta di prodotto: vedi i debiti.
- [x] **Rimossa una fallback morta in `src/server.ts`**: il login cliente ripiegava su
  `app.getClienti()`, metodo che `AppPort` non dichiara e che nessuna implementazione definisce —
  `'getClienti' in app` era sempre falso. Era anche l'unico errore di `npx tsc --noEmit` in radice.
- [x] **Il form dati societari mostrava a tutti i dati di un cliente reale**: ragione sociale,
  partita IVA, **codice fiscale e IBAN** di `Holding Beta S.r.l.` erano i valori iniziali dello
  stato, e nulla li sovrascriveva (`setFormData` era chiamata solo dagli `onChange` dei campi):
  quindi qualunque cliente apriva la scheda 3 e trovava i dati di un terzo nei propri campi, pronti
  da salvare come propri. Ora il form si riempie dalla riga del cliente autenticato (`nome`,
  `piva`, `codiceFiscale`, `iban`, `ubo`) e i campi che il database non ha restano vuoti.
- [x] **Verifica**: `npx tsc --noEmit` pulito in radice e in `frontend/`, `npx vitest run` 18 file /
  230 test, `npx vite build` pulito. Nessuna scrittura sui dati di produzione: tutte le correzioni
  sono di presentazione o di autorizzazione.

### FASE 1 (quater) — Sicurezza Password al Primo Accesso (§27) & Profilo Staff
- [x] **Cambio Password Obbligatorio al Primo Accesso**: gli utenti creati o resettati con `stato: 'invitato'` hanno `mustChangePassword = true` restituito da `POST /auth/login` e `GET /auth/me`.
- [x] **Modale non chiudibile `MustChangePasswordModal.tsx`**: blocca l'accesso finché l'utente non inserisce la password provvisoria e una nuova password personale permanente (con misuratore di forza live conforme ISO/IEC 27001). Al salvataggio chiama `POST /auth/change-password`, aggiorna `stato: 'attivo'` su Supabase e sblocca l'interfaccia.
- [x] **Modale Profilo Staff (`UserProfileModal.tsx`)**: accessibile dalla barra superiore e dal piè di pagina della Sidebar per aggiornare nome, specializzazione e password personale.
- [x] **Scheda Profilo & Password nel Portale Cliente (`/portal`)**: aggiunta Tab 6 `👤 6. Profilo & Password` con endpoint dedicato `POST /portal/change-password`.
- [x] **Reset Password da parte del Super Admin & Advisor**: pulsante `🔄 Reset Pass` su ogni collaboratore in `SettingsPage.tsx` e per i Lead Advisor in `SuperAdminPage.tsx` tramite `POST /tenant/utenti/:id/reset-password` e `POST /admin/tenants/:id/reset-password` (genera password temporanee monouso e imposta `stato: 'invitato'`).
- [x] **Routing & Logout Rapido**: aggiunto pulsante `🚪 Esci` nella barra superiore di `AppLayout.tsx` e gestione della rotta esplicita `/login` con reindirizzamento pulito.

### FASE 1 — Schema Database PostgreSQL & Prisma (`prisma/schema.prisma`)
- [x] `Tenant`: Dati fiscali studio, sedi legali/operative distinte, logo URL, colore tema PDF, note legali.
- [x] `Cliente`: Dati anagrafici ERP, Partita IVA, Codice Fiscale, Sede Legale, Codice SDI, IBAN, Rischio AML, UBO, Fonte Patrimonio, Data KYC.
- [x] Libreria a distinta base: `articolo`, `modulo_template`, `riga_distinta`, `passaggio_template`, `modulo_dipendenza_template`.
- [x] `ModelloDocumentoInBianco` e `FormMaster`: Libreria contratti PDF e moduli master dati.
- [x] `Fattura`: Gestione distinta per `tipoDocumento` (`fattura` | `nota_credito`), serie autonoma (`FT` vs `NC`), `numeroProgressivoSerie` e campi tracciato SDI Comped.
- [x] `PassaggioProgetto`: `noteOperatoreJson`, `richiedeFirmaCliente`, `documentoAllegatoUrl`.

### FASE 3 — Ciclo Passivo, Fornitori ERP, Liquidazione IVA (LIPE) & Solleciti di Pagamento (2 Settembre 2026)
- [x] **Anagrafica Fornitori ERP (`/fornitori`)**:
  - Tabella `fornitore` in PostgreSQL con isolamento multi-tenant (`tenantId`) e indici.
  - Modale ERP `AnagraficaFornitoreErpModal.tsx` a 5 schede (Dati Fiscali & SDI, Sede & Recapiti, Pagamenti & IBAN, Storico Acquisti, Note Interne).
  - API `GET /fornitori`, `POST /fornitori`, `PUT /fornitori/:id`, `DELETE /fornitori/:id` con validazione tollerante Zod.
- [x] **Registrazione Fatture d'Acquisto / Ciclo Passivo**:
  - Modello `fattura_ricevuta` con scorporo imponibile/IVA, esigibilità immediata/differita/split-payment e parsing XML SDI automatico (`src/services/fatturaPassivaParser.ts`).
  - Modale `RegistraFatturaPassivaModal.tsx` con righe spese multiple e registrazione automatica dell'uscita in Prima Nota Cassa/Banca.
- [x] **Liquidazione IVA Periodica (LIPE) & Prospetto F24 (`/liquidazione-iva`)**:
  - Motore di calcolo deterministico `src/services/lipeEngine.ts` conforme DPR 633/72 con aggregazione mensile/trimestrale, scorporo split-payment, interesse 1% trimestrale e calcolo automatico codici tributo F24 (6001-6012, 6031-6034).
  - API `GET /liquidazione-iva` e `POST /liquidazione-iva/salva`.
  - Frontend `LiquidazioneIvaPage.tsx` con simulazione live e riepilogo F24.
- [x] **Solleciti di Pagamento & Calcolo Interessi di Mora (D.Lgs. 231/2002)**:
  - Motore deterministico `src/services/sollecitiEngine.ts` con 3 livelli di sollecito, calcolo giorni ritardo, maggiorazione BCE +8% e rimborso forfettario spese 40€ (art. 6).
  - Rotte `src/routes/solleciti.ts` (`POST /invoices/solleciti/invia`, `GET /invoices/solleciti/insoluti`).
  - Componente `InviaSollecitoModal.tsx` integrato in `ScadenzarioPage.tsx` con dispatch Email e WhatsApp.
- [x] **Validazione Pervasiva Zod**:
  - Schemi Zod implementati per tutti i payload in ingresso in `src/schemas/`.
- [x] **Regola 9 di Distribuzione Doppia (Railway CLI + Vercel)**:
  - Documentata ed estesa in `AGENTS.md` e `ISTRUZIONI_PER_IA.md`.

### FASE 2 — Frontend UI & Portale Cliente Passwordless
- [x] **Dashboard (`/`)**: KPI portafoglio, avvisi ritardo, navigazione deep-link ai clienti ed ai progetti.
- [x] **Anagrafica Clienti ERP (`/clients`)**: Modal `AnagraficaErpModal` a 4 schede per dati legali, sedi, fatturazione SDI e fascicolo KYC/AML con persistenza bidirezionale garantita (PostgreSQL `prisma.cliente` + `referentiJson`).
- [x] **Dettagli Progetto (`/projects/:id`)**:
  - `🗂 Moduli & Microvoci` (Consuntivazione ore, diario note operatore salvabili e checklist passaggi con audit log).
  - `🕸 Grafo & Dipendenze Moduli` (Workflow visivo con **🔒 Lucchetti Topologici Dinamici**, frecce `➔`, pulsante `+ Aggiungi Modulo da Libreria` e **`✉️ Notifica Sblocco al Cliente`**).
  - `💶 Fatturazione & SDI` (Emissione sia di Fatture `FT` che Note di Credito `NC` con serie distinte ed anteprima PDF).
  - `📊 Redditività & Margini` (Dashboard analitica con Margine Lordo Studio, Resa Oraria Effettiva €/ora, Ore Stimate vs Reali ed export **📄 Dossier Trasparenza PDF**).
  - `📄 Documenti & Vault Legale` (Archivio contratti, certificati MFSA, fascicolo KYC ed **📤 Upload File PDF**).
  - `💬 Comunicazioni & Ingestion` (Timeline messaggi omnichannel WhatsApp, Telegram, Email, Signal sincronizzata live col Portale Cliente e con binding automatico dei recapiti dall'Anagrafica ERP).
  - `📜 Storico Contratti & Addendum` (Registro immutabile delle versioni contrattuali firmate e marca temporale eIDAS).
  - **Archiviazione & Eliminazione Sicura**: Blocco fiscale anti-cancellazione se presenti fatture.
- [x] **Registro Fatture & Note di Credito (`/invoices`)**:
  - Dashboard globale per tutte le fatture e note di credito dello studio.
  - KPI (Fatturato Emesso, Incassato Saldate, In Sospeso, Note Credito).
  - Generazione ed esportazione 1-Click **📥 XML SDI (FatturaPA v1.2.2)** per l'Agenzia delle Entrate.
- [x] **Registro Prima Nota & Movimenti Cassa/Banca (`/prima-nota`)**:
  - Storico contabile con tracciamento codice CRO/TRN e metodo di pagamento.
  - Modal **📥 Importa Estratto Conto (CSV)** per caricamento e riconciliazione automatica con le partite aperte.
- [x] **Scadenzario Incassi & Partite Aperte (`/payments`)**:
  - Sezione dedicata alle partite aperte, rateizzazioni ed incassi in scadenza.
  - Modal **💰 Registra Incasso** per saldare acconti/rate con tracciamento CRO/TRN e note operatore.
  - Azione **✉️ Sollecita Pagamento** con invio notifiche ed IBAN del Tenant.
- [x] **Contratti Ricorrenti & Retainer Studio (`/retainers`) — *Ispirato ad OpenSTAManager***:
  - Gestione contratti continuativi di Advisory, Corporate Governance e Compliance AML.
  - Pianificazione frequenza canone (mensile, trimestrale, semestrale, annuale) e data prossima fatturazione.
  - Modal 1-Click **`➕ Nuovo Contratto Retainer`** collegato all'Anagrafica Clienti ERP ed al Progetto con link 1-Click `📁 Nome Progetto ↗`.
- [x] **Checklist & SOP Compliance di Progetto — *Ispirato ad OpenSTAManager***:
  - Voci di controllo e spunte obbligatorie per ciascun passaggio operativo di progetto.
  - Persistenza dello stato completato ed audit operatore.
- [x] **Libreria Moduli & Distinta Base (`/library`)**:
  - Split-screen builder con **editing prezzo unitario (€)** in distinta base.
  - Catalogo articoli con modal di modifica prezzo, ore listino, **📄 Modelli Documenti in Bianco Collegati (PDF)** e **📋 Form Master Dinamici** per Admin.
  - Tab **🌍 Giurisdizioni Studio**: Gestione giurisdizioni (Malta 🇲🇹, Gibilterra 🇬🇮, Florida 🇺🇸, Delaware 🇺🇸, EAU 🇦🇪) e menu 1-click **`➕ Associa Modello`** e **`✕ Scollega`**.
  - Tab **🕸 Grafo Topologico Moduli**: Layout topologico a 3 colonne (*Punto di partenza*, *Sbloccati a cascata*, *Dipendenti*) con **Filtro Live per Giurisdizione Target (`selectedGiurId`)**, frecce connettori SVG viola illuminated (`#arrow-active`) e badge **🔒 Dipende da**.
  - **Costruttore Moduli & Articoli**: menu a tendina **`🌍 Giurisdizione Target *`** per associare ciascun modulo o prestazione ad una giurisdizione specifica.
  - **Assegnazione 1-Click a Cliente & Anti-Duplicazione**: Modal **`🚀 Assegna Modulo a Cliente`** con scansione live degli articoli già svolti per evitare lavoro doppio ed addebiti duplicati (0h addebitate per doppioni).
  - Tab 5: Modelli contratti PDF in bianco e Form Master con azionatori 1-Click **`📥 Scarica PDF`** per generare PDF reali e **`🔗 Collega a Cliente`**.
- [x] **Wizard Nuovo Progetto con Filtro Giurisdizioni a Cascata (`NewProjectWizard.tsx`)**:
  - **Step 0**: Selezione Giurisdizione/Piazza Finanziaria target.
  - **Step 1**: Selezione Cliente e Nome Progetto.
  - **Step 2**: Filtro libreria a cascata (1. Moduli specifici in evidenza, 2. Moduli generici, 3. Altre giurisdizioni).
- [x] **Portale Cliente Passwordless (`/portal`)**:
  - Scheda 1: ✍️ Proposta d'Ordine & Firma Engagement Letter 1-Click.
  - Scheda 2: 📊 Avanzamento Live Lavori (progress bar e timeline sincronizzata).
  - Scheda 3: 📋 Form Dati Societari con salvataggio diretto.
  - Scheda 4: 📎 Vault Documenti Legali.
  - Scheda 5: 💬 Live Chat & Comunicazioni Dirette con l'Advisor (invio messaggi reali con persistenza PostgreSQL).
- [x] **Impostazioni Studio, Gestione Team & Matrice Permessi RBAC (`/settings`)**:
  - Sede Legale e Sede Operativa disaccoppiate.
  - Configuratore Layout Fattura PDF (Logo studio, colore tema, note legali ed anteprima live).
  - **📧 Server Email SMTP Transazionale & Omnichannel**: Form configurazione SMTP + 4 Pulsanti di Test per WhatsApp, Telegram Bot, Signal Daemon ed Email.
  - **👥 Gestione Team & Performance Operatori**: Card interattive con **Francesca Disabato**, **Joe Disabato**, **Avv. Lorenzo Marino**, **Elena Rossi** e **Super Admin**.
  - **📊 Scheda Dettagliata Operatore & Timesheet Live**: Modal 1-Click con consuntivo ore lavorate, progetti assegnati, microvoci ultimate, tasso di efficienza ed export PDF.
  - **🔑 Matrice Permessi & Controllo Accessi RBAC (Stile OpenSTAManager)**: Modal a tab per definire per ciascun operatore/collaboratore il livello di autorizzazione (`denied`, `read`, `write`) per le 8 sezioni dello studio, con persintenza DB Prisma `PermessoModulo` e blocco API.
- [x] **Studio Document Studio & Word-like Contract Builder (`/documents`) — *Ispirato ad OpenSTAManager & DocuSeal***:
  - Editor visuale WYSIWYG per la redazione e personalizzazione dei contratti, relazioni e documenti dello Studio.
  - Toolbar di formattazione ricca (H1, H2, H3, tabelle, elenchi, allineamento, colori).
  - Foglio A4 tipografico con Intestazione (Logo Studio e dati fiscali) e Piè di Pagina (Paginazione "Pagina X di Y" e dati legali).
  - **🏷 Smart Tags ERP Live (Mail Merge)**: Inserimento 1-click di tag dinamici (`{{cliente.ragione_sociale}}`, `{{cliente.partita_iva}}`, `{{cliente.sede_legale}}`, `{{cliente.referente}}`, `{{progetto.titolo}}`, `{{progetto.importo_totale}}`, `{{studio.ragione_sociale}}`, `{{data_odierna}}`).
  - **Libreria Modelli Master Predefiniti**: Lettera d'Incarico (Engagement Letter), Accordo NDA Bilaterale, Memorandum Società Malta, Contratto Servizi Intercompany, Procura Speciale.
  - **Azioni 1-Click**: Esportazione PDF Vettoriale A4 e Salvataggio diretto nel Vault del Progetto.

- [x] **Firma Elettronica Avanzata (FEA) con OTP SMS/WhatsApp/Email (`/portal`)**:
  - Generazione codice OTP a 6 cifre temporizzato (TTL 5 minuti) con rate-limiting.
  - Invio al cliente via WhatsApp Cloud API / Email transazionale.
  - Modale interattivo nel Portale Cliente con convalida istantanea e apposizione del sigillo digitale eIDAS (Timestamp ISO UTC, SHA-256 Digest e IP certificato).
- [x] **Worker Cron Scadenze & Rinnovi Automatici (`src/services/cronService.ts`)**:
  - Scansione automatica delle scadenze rinnovi UBO Registry / MFSA Malta (annuali).
  - Scansione monitoraggio marchi EUIPO e solleciti fatture in scadenza/scadute.
  - Dispatch proattivo notifiche WhatsApp ed Email transazionali.
  - Trigger manuale 1-Click nel Calendario Condiviso Studio (`CalendarPage.tsx`).
- [x] **Webhook Ricezione Telegram Bot Reale (`/webhooks/communications/telegram`)**:
  - Serverless Function e ricezione messaggi da Telegram Webhook API.
  - Matching anagrafica cliente ERP e ingestion automatica delle comunicazioni nella timeline del progetto.
  - ⚠️ **La Serverless Function su Vercel non c'è più** (`api/webhooks/communications/telegram.ts`, rimossa il 16/09/2026): inoltrava a Railway **scartando `x-telegram-bot-api-secret-token`**, che per Telegram è l'unica autenticazione della rotta, e rispondeva comunque `200`, quindi Telegram non ritentava mai e i messaggi dei clienti sparivano senza traccia. Ora il webhook è registrato sul dominio del **backend**.
  - **Il cliente può anche agganciare da sé la sua chat a una pratica** (16/09/2026): il menu `🔗 Link Telegram` nella testata della pratica compone `t.me/<Bot>?start=<payload firmato>` e lo può spedire via email o WhatsApp. Serve perché il matching in anagrafica è un'euristica a due cancelli — un solo cliente con quel contatto **e** un solo progetto aperto — che si arrende davanti a un cliente con due pratiche aperte. I dettagli in `README.md` e `PIANO_DI_MIGLIORAMENTO.md` §1bis.
- [x] **Connettore SDI Diretto 1-Click (`src/services/sdiService.ts` & `InvoicesPage.tsx`)**:
  - Trasmissione web service delle fatture elettroniche XML al Sistema di Interscambio (SdI - Agenzia delle Entrate) con generazione identificativo SdI e audit trail.
- [x] **Modulo di Sicurezza & Sanitizzazione Upload KYC (`src/services/securityScanner.ts`)**:
  - Validazione binaria *Magic-Bytes* (PDF, PNG, JPEG) e blocco eseguibili/script pericolosi per la massima conformità bancaria.

---

## 🔍 Checklist per il Rilascio in Produzione A-Z (Enterprise Readiness)

Per la messa in produzione professionale ed il passaggio ad un ambiente live:

### FASE 2 — Autenticazione RBAC & Permessi Attori (§2bis, §23)
- [x] Staff: Login JWT (`POST /auth/login`), verifica token (`GET /auth/me`), ruoli (`super_admin`, `advisor`, `collaboratore_interno`, `collaboratore_esterno`).
- [x] Cliente: Login passwordless a Magic Link (`POST /auth/magic-login`).
- [x] Interfaccia Frontend: Pagina di Login `LoginPage.tsx`, supporto per disconnessione (Logout) e controllo sessione in `localStorage`. Il login è **reale**: `loginApi` interroga solo `POST /auth/login`, non ha più una mappa di credenziali locali e propaga un errore se il server non risponde, invece di far entrare comunque.

1. **🔐 Autenticazione JWT & Sessioni Cookie Secure**:
   - [x] Firma JWT con HMAC SHA-256 e verifica payload Bearer Header su tutte le rotte.
   - [x] Guard `onRequest` con elenco di rotte **pubbliche** (non di rotte protette): ogni
     rotta nuova nasce protetta. Confronto sul pattern `req.routeOptions.url`, perché
     `onRequest` gira dopo il routing. 10 rotte presidiate da test in coppia (401 senza
     token / non-401 con token) in `src/server.test.ts`.
   - [x] Controllo di ruolo `soloSuperAdmin` sui quattro verbi di `/admin/tenants` (§2bis):
     403 per advisor e collaboratori. RLS non poteva coprirlo, perché `tenant` è la tabella
     che contiene gli studi, non una tabella figlia filtrata per `tenant_id`.
2. **📧 Transport Email SMTP Reale (Nodemailer + Register.it / SendGrid)**:
   - [x] Modulo Nodemailer (`src/services/emailService.ts`) integrato per l'invio reale di Magic Link e notifiche.
3. **📦 Cloud Object Storage (AWS S3 / Supabase Storage)**:
   - [x] Modulo Cloud Storage (`src/services/storageService.ts`) per l'upload e la gestione di contratti su Supabase Storage.
4. **🛡 Row-Level Security (RLS) PostgreSQL**:
   - [x] Migrazione SQL nativa (`supabase/migrations/20260819_rls_effettiva.sql`): una policy
     RESTRICTIVE `isolamento_tenant` per tabella, RLS attivo **e forzato**
     (`FORCE ROW LEVEL SECURITY`) su tutte le 34 tabelle. Il blocco per introspezione del
     file copre ogni tabella con un `tenant_id` NOT NULL, quindi le tabelle nuove entrano
     nell'isolamento appena viene rieseguito; le migrazioni Prisma che ne creano una portano
     comunque la propria policy, perché `migrate deploy` gira senza nessuno davanti.
   - [x] Tre ruoli database distinti: `bluman_app` (runtime, `NOBYPASSRLS`, nessun `CREATE`
     su `public`) su `DATABASE_URL`, il proprietario dello schema su `DIRECT_URL` per le
     migrazioni, e `ADMIN_DATABASE_URL` per script di manutenzione, seed e backup.
   - [x] Contesto tenant per richiesta: l'hook `onRequest` di `src/server.ts` chiama
     `attivaContestoTenant`, e l'estensione Prisma in `src/util/prismaClient.ts` avvolge ogni
     operazione in una transazione che imposta `app.current_tenant_id` e `app.current_ruolo`.
     Le transazioni interattive reimpostano il contesto sul proprio `tx`, perché girano su
     una connessione separata.
   - [x] Comportamento **fail-closed**: senza contesto tenant nessuna riga è visibile. Un
     errore di programmazione produce un guasto immediato, non una fuga silenziosa di dati.
   - [x] Verifica sul database reale: `npx tsx src/scripts/checkRls.ts` →
     `current_user: bluman_app`, `bypassa_rls: false`, 0 tabelle raggiungibili senza policy,
     0 clienti visibili con un tenant inesistente.
   - [x] La precedente `20260815_enable_rls.sql` è superata: le sue policy PERMISSIVE si
     sommavano in OR annullando l'isolamento. `src/adapters/prisma/applyRls.ts` ora si rifiuta
     di eseguire e stampa il comando corretto, invece di riapplicarla in silenzio.
5. **📜 Webhook Firma Qualificata eIDAS (FEA / OTP SMS)**:
   - [x] Tracciamento IP, User Agent e Timestamp 1-click engagement letter nel Portale Cliente con convalida OTP WhatsApp/Email.

---

## ⚠️ Debiti Noti Aperti (da chiudere prima del Go-Live)

Elencati qui perché non chiuderli è una scelta, non una dimenticanza.

> **Aggiornamento 14 settembre 2026** — i debiti 1, 2, 3 e 4 sono **chiusi**:
> il grafo Graphify è stato rigenerato (2675 nodi, 6681 archi, 293 community —
> la CLI era installata sulla postazione Windows); le righe `user` residue, i moduli
> senza micro-voci e la riga da riallineare non esistono più nel database attuale
> (verificato con `verificaAccessi.ts` e `probeAvanzamento.ts`: 7 utenti tutti con
> password, 0 righe da ricalcolare, 0 moduli non verificabili — il database è stato
> ricreato con dati di collaudo dopo la stesura di questa sezione). Restano aperti i
> debiti da 5 in poi.

1. **Mappa Graphify STALE**: l'ultima estrazione è del **17 agosto**, quindi *nessuna*
   correzione di Fase 0 è nel grafo — compresi il modello `MagicLink` e le funzioni nuove di
   `src/util/jwt.ts` e `src/services/storageService.ts` — né la Fase 1, che aggiunge
   `src/services/calcoloService.ts` e la rotta `POST /progetti/:id/ricalcola`: sono nodi e
   archi mancanti, non solo righe cambiate. La CLI `graphify` non è installata sulla
   postazione Windows dove sono state fatte. Da rigenerare dove la CLI esiste
   (`graphify extract . --code-only` + `graphify cluster-only .`), senza reinstallarla qui
   solo per questo.
2. **Due righe `user` residue senza password** — `francesca@bluecode.advisory` e
   `lorenzo@bluecode.advisory`, duplicati di `francesca.disabato@` e `lorenzo.marino@`
   lasciati da `seedFull.ts` e dal vecchio auto-seed di `listaUtenti()`. Sono inerti (senza
   `password_hash` non si accede da `/auth/login`) e ora non si rigenerano più, ma sporcano
   l'anagrafica del team. Non le si cancella da qui: `user` è referenziata da audit log,
   timesheet e accessi progetto, quindi la rimozione va fatta consapevolmente dalla
   dashboard super admin. Verifica dello stato: `npx tsx src/scripts/verificaAccessi.ts`.
3. **Due moduli con stato non verificabile**: su `Struttura Holding — Famiglia Ricci` i moduli
   `Analisi patrimoniale iniziale` (`done`) e `Corporate structuring Malta` (`in_progress`)
   hanno **zero micro-voci** a database. Il loro stato è stato messo a mano e non ha nulla
   sotto che lo giustifichi: il motore non può né confermarlo né correggerlo, e il service lo
   preserva invece di declassarlo (vedi `calcoloService.ts`). Va deciso a mano se istanziare le
   micro-voci o azzerare i moduli. Diagnosi: `npx tsx src/scripts/probeAvanzamento.ts`.
4. **Una riga di stato modulo da riallineare**: su `holding dibenedetto` il modulo
   `Analisi patrimoniale iniziale` è `pending` in riga ma ha 5 micro-voci con ore consuntivate
   (17% calcolato) — residuo del periodo in cui nessuno propagava lo stato verso l'alto. Le
   letture mostrano già il valore giusto perché lo calcolano; la riga si riallinea con
   `POST /progetti/:id/ricalcola`. Non è stato eseguito sui dati reali: è una scrittura in
   produzione e va fatta da chi possiede il dato. Il pulsante ora esiste nell'intestazione del
   Dettaglio Progetto: premerlo **è** quella scrittura.
5. **Due clienti e due progetti omonimi**, lasciati per decisione del titolare: `Holding Beta
   S.r.l.` compare due volte in anagrafica e `Struttura Holding — Famiglia Ricci` due volte fra i
   progetti. Nessuna scrittura di consolidamento: si distinguono nelle etichette della UI. Chi
   legge un selettore con due voci identiche non sta guardando un bug del selettore.
6. **La conferma di conclusione operazione nel portale non è una firma**: vive solo nel
   `localStorage` del dispositivo del cliente, non passa da `/portal/verify-otp-and-sign`, non
   produce sigillo FEA e **lo studio non la vede a database**. Le etichette non rivendicano più
   una firma qualificata, ma restano due strade: farla passare dall'endpoint OTP che emette il
   sigillo (diventa una firma vera e persistita), oppure togliere il pulsante. È una scelta di
   prodotto, non di implementazione.
7. **Le evidenze forensi vanno registrate lato server o non esistono**: gli indirizzi IP cablati
   sono stati rimossi dal Vault e dagli allegati perché il browser non conosce il proprio IP
   pubblico e non può attestarlo. Se l'evidenza serve su ogni documento firmato, va scritta al
   momento della firma dove l'IP della richiesta è noto — come già fa
   `generateEidasSignatureSeal()` in `src/services/otpService.ts`.
8. **L'elenco documenti del portale è ancora un seed cablato**: `portalDocs` in
   `ClientPortal.tsx` nasce con quattro documenti inventati (NDA, statuto, UBO, trust) con
   dimensioni e date fisse, e l'NDA è marcato `firmato: true` con una data di firma cablata.
   Non è stato toccato in questo giro perché è la scheda "Documenti", non i moduli: va deciso se
   collegarlo al Vault reale o dichiararlo vuoto come si è fatto per i moduli.

### ✅ Chiusi in questa fase

- ~~**`/auth/magic-login` accetta qualunque stringa con prefisso `client_`**~~ — era l'ultima
  porta d'ingresso non verificata. Non un controllo debole: **assente**, perché i token non
  venivano persistiti da nessuna parte e non c'era nulla contro cui confrontarli; e il JWT
  restituito portava tenant ed email **cablati nel sorgente**, quindi un `curl` con
  `{"magicToken":"client_x"}` otteneva una sessione `cliente` valida sul tenant che contiene
  i dati. Il rate limiting non lo copriva: non c'era niente da indovinare. Ora esiste la
  tabella `magic_link` (migrazione `20260819210000_magic_link_persistito`, con la propria
  policy RLS): in riga va lo **SHA-256** del token — chi legge il database non entra al posto
  del cliente — con scadenza a 7 giorni, email del destinatario e `usato_at` per il consumo.
  Il token lo genera `generateMagicToken()` con 16 byte da `crypto.randomBytes`, non più
  `Date.now()`; `tenantId` ed email del JWT vengono **dalla riga**. Il primo login valido
  valorizza `usato_at` con un aggiornamento condizionale atomico e ogni riuso viene rifiutato;
  cambio/reset password revocano i link attivi e incrementano `sessionVersion`, invalidando i
  JWT precedenti. Il lookup usa `prismaAmministrativo()` perché la richiesta è anonima per
  scopre proprio dalla riga cercata: è il caso ammesso dalla regola 1, come la ricerca utente
  al login. Lato frontend spariscono le due fabbricazioni di token nel browser
  (`ClientsPage.tsx`, `ClientPortal.tsx`) e il default `client_demo`.
- ~~**`GET /uploads/:filename` è pubblica e non sanifica il nome file**~~ — Fastify decodifica
  i parametri di rotta, quindi `..%2f..%2fpackage.json` arrivava al handler come
  `../../package.json` e `path.join` usciva dalla cartella. Ora il nome viene **rifiutato**
  con 400 se non passa `nomeFileValido()` (nessun `..`, solo `[a-zA-Z0-9_.-]`, max 255) — si
  rifiuta invece di sanificare, perché un nome riscritto in silenzio darebbe 404 e
  nasconderebbe il tentativo — e in aggiunta si verifica che il percorso **risolto** stia
  sotto `uploads/`: è il controllo che regge anche alle codifiche che una regex non prevede.
  La rotta non è più anonima: il handler pretende il Bearer **oppure** una firma HMAC in
  query string (`?firma=&scad=`, `firmaDownload`/`verificaFirmaDownload` in `src/util/jwt.ts`,
  confronto con `timingSafeEqual`). Servono due prove alternative perché questi URL finiscono
  in `<img src>` in 6 punti — logo dello studio, fatture, HTML delle stampe PDF — e in un
  `href` diretto, e nessuno di questi può inviare un header `Authorization`. Resta in
  `ROTTE_PUBBLICHE` perché il guard non legge la query string: lì "pubblica" ora significa
  "la controlla il handler". La firma dura 7 giorni e viene **rinnovata a ogni lettura** di
  `logoUrl` (`rifirmaUrlUpload`), altrimenti il logo si romperebbe da solo dopo una settimana.
  Corretto per la stessa via anche l'URL restituito da `uploadDocumento()`, che era
  `http://127.0.0.1:3000/uploads/...`: dal browser di un utente non portava da nessuna parte.
- ~~**Variabili d'ambiente su Railway**~~ — `JWT_SECRET` (48 caratteri) era già impostato;
  `DATABASE_URL` (ruolo `bluman_app`), `DIRECT_URL` e `ADMIN_DATABASE_URL` ora puntano al
  pooler Supabase `aws-1-eu-west-1.pooler.supabase.com:5432`, impostati con
  `railway variable set … --skip-deploys` perché prendano effetto al prossimo deploy e non
  a metà traffico. Il Postgres di Railway resta in piedi ma non è più usato; il valore
  precedente di `DATABASE_URL` è nel file locale gitignorato `.env.railway-backup.local`.
  Verifica con `npx tsx src/scripts/checkRls.ts` → `current_user: bluman_app`,
  `bypassa_rls: false`, RLS attivo e forzato su 34 tabelle, 0 clienti con tenant inesistente.
- ~~**Token finto nel frontend**~~ — `getAuthHeaders()` non ha più il token di ripiego.
  Quella stringa non era un JWT: il backend non poteva verificarla, ne ricavava
  `ruolo: undefined` e trattava la richiesta come non autenticata. Ora, in assenza di token,
  l'header non viene inviato affatto e la risposta è un `401` esplicito.


