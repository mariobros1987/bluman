# 🤖 Istruzioni & Context Prompt per l'IA (Nuovo PC)

Questo file contiene il contesto completo, le regole di sviluppo tassative ed il prompt di avvio pronto da copiare ed incollare nella finestra dell'IA sul nuovo computer.

---

## 📋 PROMPT DA COPIARE ED INCOLLARE ALLA NUOVA IA:

```text
Ciao! Sto lavorando sulla piattaforma BluMan Advisory (ERP per Studi di Consulenza, Corporate Structuring, Trust e Tax Planning). 

Repository GitHub: https://github.com/mariobros1987/bluman
Stack: React 19 + TypeScript + Fastify API + Prisma ORM + Supabase PostgreSQL + Graphify.

REGOLE TASSATIVE DA SEGUIRE RIGOROSAMENTE:
1. Isolamento Multi-Tenant Tassativo (tenant_id): I dati tra i vari Tenant/Studi non si devono MAI mischiare. Il filtro applicativo su tenant_id non basta e non è la difesa: è RLS che lo è. Nel codice che serve una richiesta HTTP usa `prisma` da src/util/prismaClient.ts, mai `new PrismaClient()`; `prismaAmministrativo()` scavalca le policy ed è ammesso solo in script, seed, bootstrap, backup e nella ricerca utente al login. Verifica con `npx tsx src/scripts/checkRls.ts`.
2. Migrazioni Versionate: lo schema si cambia con `prisma migrate dev` / `prisma migrate deploy`. MAI `prisma db push --accept-data-loss` su un database con dati reali: riallinea lo schema cancellando in silenzio colonne e tabelle.
3. Sincronizzazione Database & Persistenza Cloud Tassativa: Tutto quello che viene aggiunto o modificato nell'interfaccia (spunte, passaggi, note, scadenze, assegnazioni) deve essere tassativamente salvabile e collegato al database PostgreSQL via API Fastify. Non possiamo permetterci di perdere dati. Aggiorna sia prisma/schema.prisma (con npx prisma generate) sia tutti i file di documentazione (.md).
4. Grafo Graphify: Esegui `graphify extract . --code-only` e `graphify cluster-only .` per mantenere la mappa delle dipendenze aggiornata. NOTA: il grafo è attualmente STALE — la CLI non è installata sulla postazione Windows dove sono state fatte le correzioni di Fase 0 e di Fase 1.
5. Nessuna credenziale reale (password SMTP/IMAP, token, chiavi API, password di database) nel codice versionato o nei file .md, ripieghi inclusi: `|| 'password-qualunque'` ed un campo password precompilato nella UI sono credenziali cablate, perché il valore che l'API annuncia è quello con cui si entra. Le credenziali dello studio stanno nella riga Tenant del database e si gestiscono via PUT /tenant/settings; le password delle persone solo come hash scrypt su user.password_hash. Presidio: `npx vitest run src/credenziali.test.ts`.
6. Stati e percentuali di avanzamento (§16) li calcola il backend, non il frontend: `src/domain/stateEngine.ts` è puro e `src/services/calcoloService.ts` è l'unico punto che lo traduce in letture e scritture Prisma. Non reintrodurre percentuali cablate nelle pagine React e non duplicare le formule nel frontend — il dominio non deve finire nel bundle pubblico. La cascata sale sempre (micro-voce → modulo → progetto), mai verso il basso (§16.6).
7. Il frontend non inventa dati che il database non ha. Se un progetto non ha moduli, la pagina lo dichiara vuoto: non mostra una lista di ripiego. Vietati i ripieghi che riempiono un buco con un valore verosimile — `|| 75` su una percentuale, `|| 3500` su un prezzo, `|| 'Senior Advisor'` su un operatore, un elenco di micro-voci costruito a render time: rendono l'inventato indistinguibile dal reale, e la conseguenza non è estetica, è che nessuno si accorge più che il dato manca. Vale a maggior ragione per le evidenze legali: marca temporale, numero di repertorio, impronta SHA-256 e indirizzo IP si prendono SOLO dal sigillo emesso da `/portal/verify-otp-and-sign`; il browser non conosce il proprio IP pubblico e non può attestarlo, e una firma che nessuno ha apposto non si disegna. Un pulsante che scrive solo in `localStorage` non ha salvato niente (regola 3): non dica "salvato".
8. Niente nuovi monoliti — un file = un compito: ogni file deve avere la dimensione giusta per il proprio compito; se i processi si possono dividere in sottosezioni mantenibili in futuro, ognuna con il proprio compito, vanno divise. Vietato creare nuovi file monolitici: sopra ~500 righe si valuta lo split, sopra ~800 righe la pianificazione dello split è obbligatoria. Strategia da adottare: nel frontend la pagina tiene stato, handler ed effetti e il JSX viene estratto in componenti presentazionali tipizzati in `frontend/src/components/<dominio>/` (props tipizzate, niente logica di business nel figlio); nel backend una rotta per dominio in `src/routes/<dominio>.ts` con la logica in `src/services/`. Esecuzione: un file alla volta, refactoring meccanico senza cambi di comportamento, typecheck dopo ogni estrazione (`npx tsc -b` in frontend/, `npx tsc --noEmit` alla root), commit separati e revertibili.

CREDENZIALI DI TEST:
Non esistono e non devono essere reintrodotte. Fino alla Fase 0 src/server.ts conteneva
una tabella di sette utenti con password nel sorgente: chiunque leggesse il repository
pubblico poteva autenticarsi in produzione. Sono state rimosse, insieme all'accettazione
di qualunque password come jolly, e non vanno trascritte nemmeno qui per spiegare che sono
state rimosse — l'elenco esatto vive solo in src/credenziali.test.ts, che le cerca.
L'unica fonte di verità è la tabella `user` del database (§23).
- Primo super_admin su DB vuoto: `npm run bootstrap` (§27), stampa la password una volta.
- Utenti esistenti senza password: `npm run passwords:assign`.
- Nuovi collaboratori: li crea il super_admin o l'advisor via POST /tenant/utenti, che
  restituisce la password temporanea nella risposta.
- Nuovi studi: solo il super_admin, via POST /admin/tenants, che crea anche la riga user
  del responsabile (ruolo advisor) e restituisce la password una volta sola. Perduta? La
  rigenera POST /admin/tenants/:id/reset-password.
- Ruolo `cliente`: passwordless, solo Magic Link su /portal.
La password la emette SEMPRE il server: nessun campo per proporla, nessun valore di
ripiego, solo l'hash scrypt in database.
Gerarchia (§2bis): super_admin gestisce tutto e vede tutti i tenant; advisor è
responsabile del solo proprio tenant; i collaboratori appartengono al tenant da cui sono
stati creati. Un advisor non può creare un super_admin.
ATTENZIONE all'invariante `user.tenant_id` NULL per i super_admin: la policy RLS di `user`
concede la visione delle righe senza tenant al solo super_admin, quindi dà per assodato che
i super_admin SIANO quelle righe. Un super_admin con tenant_id valorizzato diventa un utente
ordinario di quello studio e il suo advisor può declassarlo — succedeva davvero, perché il
seed li creava dentro il tenant e prismaApp.listaUtenti() li riassegnava a ogni lettura.
Non reintrodurre né l'una né l'altra cosa. Verifica: `npx tsx src/scripts/verificaAccessi.ts`
(i super_admin devono comparire come `tutti i tenant`).
La suite ha tre presidi: src/server.test.ts rifiuta ognuna delle vecchie coppie
email/password, src/credenziali.test.ts scandisce src/, frontend/src/, api/ ed i file .md
alla ricerca di credenziali cablate, token finti e del ripiego `!password ||`, e
src/gerarchiaRuoli.test.ts verifica la gerarchia dei ruoli controllando anche che la
scrittura respinta non avvenga comunque.
src/accessoCliente.test.ts presidia l'accesso del cliente: token magic inventato o scaduto
→ 401, token valido → JWT col tenant preso dalla riga; in tabella solo lo SHA-256 del token;
path traversal su /uploads → 400; /uploads senza Bearer né firma → 401.
src/calcoloService.test.ts presidia il motore di stato: percentuali mostrate (col tetto a 99
finché lo stato non è chiuso), segnali di rischio, cosa il ricalcolo scrive davvero a database
(solo le righe divergenti), i moduli senza micro-voci che NON vanno declassati, e la presenza
di segnaleRischio/oreExtra per singolo modulo nella risposta HTTP — è il dato su cui il banner
della Dashboard scrive le sue righe.

STATO ATTUALE:
Abbiamo completato l'autenticazione JWT RBAC, il Portale Cliente con Firma Elettronica Semplice (OTP verificata · art. 20 CAD; 6 Tab con Profilo & Sicurezza Password, e selezione dinamica dei progetti con moduli/micro-voci attivi aggiornati in tempo reale), l'Anagrafica ERP Clienti con modale progetti attivi integrato, la Fatturazione/NC con tracciato XML SDI, il Connettore SDI 1-Click, il Document Studio Word-like con Smart Tags, il Grafo Dipendenze Moduli nel progetto, il Calendario Condiviso con Scadenzario Attività Studio (/calendar), il Cron Worker Scadenze UBO/Marchi ed il Cambio Password Obbligatorio al Primo Accesso per tutti gli utenti dello studio e clienti con reset rapido da parte del Super Admin e Lead Advisor.
Fase 0 di sicurezza chiusa: credenziali cablate rimosse dal sorgente E dal frontend (il bundle Vite su Vercel è pubblico come il repository) e dalle funzioni serverless in api/; guard onRequest che respinge con 401 tutto ciò che non è in un elenco di rotte pubbliche, così una rotta nuova nasce protetta; /admin/tenants riservato al super_admin su tutti e quattro i verbi (RLS non poteva coprirlo: `tenant` è la tabella che contiene gli studi, non una tabella figlia filtrata per tenant_id); colonna tenant.lead_advisor_password eliminata dal database; super_admin riportati a tenant_id NULL con la migrazione 20260819190000 e listaUtenti() tornato di sola lettura (prima riscriveva cinque utenti cablati a ogni GET, spostandoli nel tenant che leggeva); magic link del portale cliente persistiti come SHA-256 in `magic_link` con scadenza a 7 giorni (prima /auth/magic-login accettava qualunque stringa `client_*` e firmava un JWT con tenant ed email cablati: era una sessione `cliente` valida per chiunque, non un controllo debole); GET /uploads/:filename confinata sotto uploads/ e non più anonima (Bearer oppure firma HMAC in query string, perché quegli URL finiscono in `<img src>` che non può inviare header); scrypt + JWT HMAC senza dipendenze native; rate limiting su /auth/*; RLS effettiva e forzata su tutte le 34 tabelle col ruolo `bluman_app` che non può scavalcarla; migrazioni versionate al posto di `db push` nel Dockerfile; variabili Railway puntate a Supabase.
Fase 1 (Integrazione State Engine) chiusa: `src/domain/stateEngine.ts` (già puro) è ora collegato all'applicazione da `src/services/calcoloService.ts`, che calcola l'avanzamento senza query e lo PERSISTE con `ricalcolaProgetto()`; `GET /progetti` e `GET /progetti/:id` restituiscono `avanzamento` (stato, percentuale, segnaleRischio, oreExtra) per progetto E per singolo modulo; nuova rotta `POST /progetti/:id/ricalcola` (audit `PROGETTO_RICALCOLATO`) che scrive solo le righe divergenti, per non sporcare `updatedAt` a ogni click. Sparite le percentuali cablate: Dashboard.tsx dava 45% a ogni progetto in corso, 10% a ogni altro e 50% a ogni modulo `in_progress`, mentre la barra di ProjectDetail.tsx leggeva `percentualeAvanzamento`, un campo che il backend non ha MAI prodotto — era ferma a zero da sempre. Le percentuali non hanno una colonna e non serviva una migrazione: derivano da `stato`, `orePreventivate` e `oreConsuntivate`, già in riga; si persistono solo gli stati e i segnali di rischio, che una query non ricostruisce. Due cose da non toccare: il tetto a 99 in `percentualeVisibile()` (un modulo al 99.7% non deve dichiarare 100 mentre è `in_progress`) e la guardia sui moduli senza micro-voci, che `calcolaStatoModulo([])` declasserebbe a `pending` cancellando uno stato messo a mano. Gli avvisi tengono separati il ritardo di calendario dallo sforamento di ore, perché hanno rimedi diversi: non riassumerli in un solo messaggio. Diagnostica di sola lettura prima di scrivere sui dati reali: `npx tsx src/scripts/probeAvanzamento.ts`. Suite: 18 file, 230 test.
Correzione successiva a Fase 1 — il frontend non inventa più i moduli (regola 7). Il Portale Cliente mostrava sempre la stessa lista di moduli qualunque progetto si scegliesse dal selettore: il difetto non era il selettore ma il mappatore, che quando il progetto non aveva moduli a database ripiegava su un elenco costruito per nome cliente. `mapProjectToPortalModules` ora restituisce `[]` e la pagina dichiara il vuoto; i due progetti sintetici di ripiego (valore 28.500 €, giurisdizione Malta) sono spariti da `loadPortalData`. La stessa bugia stava anche nell'ERP: `ProjectDetail.tsx` fabbricava moduli e micro-voci in SEI punti diversi, incluso un ripiego a render time dentro `ModuloBlock` che avrebbe annullato ogni correzione a monte (e le righe inventate erano cliccabili: `consuntivaMicrovoceApi` sarebbe stata chiamata con l'id di una micro-voce inesistente), e un pulsante "Istanzia Subito" che scriveva tre moduli da 23.500 € nel solo `localStorage`, mai a database — violava la regola 3 e adesso rimanda al percorso reale "+ Aggiungi Modulo da Libreria". Il progetto "1234" non ha moduli: il "Modulo Iniziale Incarico Advisory" che si vedeva era inventato dalla pagina, non un dato. Rimosse anche le evidenze di firma cablate: l'Engagement Letter generava un PDF con marca temporale e due indirizzi IP fissi, e una controfirma dello studio che non esiste in nessun registro; ora repertorio, data e impronta vengono dal sigillo eIDAS reale e senza sigillo il PDF esce senza pagina di evidenze. Lo stato di firma era letto da chiavi `localStorage` col nome di un cliente specifico: in un browser dove quel cliente aveva firmato, ogni altro cliente si vedeva "firmato". `POST /progetti/:id/ricalcola` era una scrittura senza controllo di ruolo: ora risponde 403 a chi non è advisor o super_admin, perché il filtro nella UI non è la difesa (regola 1). Ultima cosa, la più sgradevole: il form dati societari della scheda 3 nasceva precompilato con ragione sociale, partita IVA, CODICE FISCALE e IBAN di un cliente reale, e nulla li sovrascriveva — ogni cliente trovava i dati di un terzo nei propri campi, pronti da salvare come propri. Ora si riempie dalla riga del cliente autenticato e i campi assenti restano vuoti.
Sicurezza Password al Primo Accesso & Profilo Operatore (§27, §23): implementato il modale bloccante `MustChangePasswordModal` per utenti con `stato: 'invitato'`, l'aggiornamento dinamico dello stato sessione da `/auth/me`, il cambio password cifrato scrypt da `POST /auth/change-password` e `POST /portal/change-password`, il modale profilo `UserProfileModal` per lo staff e la scheda `👤 6. Profilo & Password` nel Portale Cliente. Pulsante `🔄 Reset Pass` aggiunto nelle schede collaboratori di `SettingsPage.tsx` e in `SuperAdminPage.tsx`. Assegnate password temporanee monouso a tutti gli utenti con `npm run passwords:assign -- --force`.
Debiti ancora aperti: due moduli con zero micro-voci su "Struttura Holding — Famiglia Ricci" (stato messo a mano, non verificabile dal motore); due clienti "Holding Beta S.r.l." e due progetti "Struttura Holding — Famiglia Ricci" omonimi, lasciati per decisione del titolare e distinti solo nelle etichette della UI.

DA DOVE RIPARTIRE (aggiornato al 27 agosto 2026, dopo i cicli §WF-DOC firma/sblocco/tracciabilità e Punto 3 del piano gap firma documenti):
Completato il 27 agosto 2026:
- la conclusione di un'operazione nel portale è una firma FEA a tutti gli effetti, non più
  una conferma locale: nuovo ambito `modulo_completato` in `/portal/verify-otp-and-sign` e
  `/portal/firma-con-file`; l'impronta SHA-256 la calcola il server dai dati canonici del
  modulo (`improntaModuloCompletato`), il browser non la manda; guard 409 se il modulo non
  appartiene al cliente, non è `done` o è già firmato; riga `FirmaElettronica` con data,
  hash e IP visibile subito allo studio; il portale carica le conclusioni da `GET /firme`
  (`elencoFirmeApi` con ambito) e non usa più `localStorage`;
- blocco totale dei documenti `firmato`: `PATCH /documenti/:id/stato`,
  `POST /documenti/:id/nuova-versione` e `DELETE /documenti/:id` rispondono **409** se il
  documento è firmato (lato app e lato portale spariscono i pulsanti e restano data/riferimento
  firma + ricevuta eIDAS);
- `PATCH /documenti/:id/sblocca` riservato all'admin del tenant (`advisor`/`super_admin`),
  motivazione obbligatoria ≥10 caratteri, audit `DOCUMENTO_SBLOCCATO`, notifica
  `documento_sbloccato`, riga `firmaElettronica` conservata come evidenza storica;
- tracciabilità a ritroso: `GET /portal/documenti` restituisce `documentoPadreId` e
  `versioniPrecedenti[]` (risalita della catena con tetto di 12 salti, firme degli antenati
  risolte dalla mappa `firmaPerDocumento`); il portale mostra la cronologia espandibile 🕘
  nella scheda documento e richiami compatti nelle schede moduli/deliverable;
- l'editor (`DocumentEditorPage.tsx`) vincola il salvataggio alla micro-voce reale del
  progetto scelto (nessun id inventato, fascia «Percorso del documento»);
- CI GitHub Actions riscritta: typecheck backend (`tsc --noEmit`), 281 test vitest, build
  backend, typecheck frontend REALE (`tsc -b --force` — il `tsc --noEmit` sul tsconfig del
  frontend con `"files": []` non verifica nulla) e build frontend; generato
  `frontend/package-lock.json` perché `npm ci` in CI funzionasse;
- `analisi.txt` declassato a documento storico (fotografia delle fasi iniziali, non è più il
  piano operativo corrente).
Verifiche: `npx tsc --noEmit` in radice verde, `npx tsc -b --force` in frontend/ verde,
`npx vitest run` 281/281 in 22 file, `npm run build` verde.
Restano aperte le voci non spuntate di `PIANO_DI_MIGLIORAMENTO.md` (0.1-0.5, 0.7, Fase 1+).

Completato il 27 agosto 2026 — secondo ciclo (Punto 3 del `piano-sviluppo-gap-firma-documenti.md`):
- fix produzione eliminazione moduli (DELETE `/progetti/:id/moduli/:moduloId` rispondeva 500):
  guard **409** se il modulo ha ore consuntivate o righe fattura collegate e transazione
  ordinata accessi → passaggi → microvoci → dipendenze → modulo;
- Punto 3 chiuso: migrazione additiva `20260827180000_archiviazione_documenti_firmati`
  (`isArchiviato`/`archiviatoAt`/`archiviatoDaId` su `Documento`, `isArchiviato` su
  `EngagementLetter`), `PATCH /documenti/:id/archivia` (solo admin, audit
  `DOCUMENTO_ARCHIVIATO`), `DELETE /documenti/:id` rifiutata con **409 per tutti, admin
  inclusi**, su documento firmato o con firma/OTP pendente collegati; liste operative senza
  archiviati (`?includiArchiviati=true` per lo storico) e pulsante «📦 Archivia» nella UI;
  17 test nuovi in `src/archiviazioneDocumentiFirmati.test.ts`;
- etichette firma declassate a SES: wording «Firma Elettronica Semplice (OTP verificata) ·
  art. 20 CAD» al posto di FEA/eIDAS/firma digitale nella UI; il sigillo server-side in DB
  (`generateEidasSignatureSeal()`) e i valori enum interni (`fea_otp`…) non cambiano; le
  opzioni di firma qualificata esterna (file `.p7m`, provider Aruba/InfoCert/Namirial/SPID)
  restano.
Verifiche: `npx tsc --noEmit` in radice verde, `npx tsc -b --force` in frontend/ verde,
`npx vitest run` verde.
⚠️ Il deploy Railway deve applicare la migrazione `20260827180000_archiviazione_documenti_firmati`
(il Dockerfile esegue `prisma migrate deploy`).

PIANO OPERATIVO STORICO (22 agosto 2026) — SUPERATO, conservato per memoria:
Il piano per fasi in `analisi.txt` (Fase 0/1 chiuse, Fase 2 UI CORE tracking ore 2.1-2.5) è
una fotografia delle fasi iniziali: i task elencati sono stati nel frattempo completati o
assorbiti dall'evoluzione dell'app. `analisi.txt` resta come documento storico; il piano
corrente è la sezione «DA DOVE RIPARTIRE» qui sopra più le voci aperte di
`PIANO_DI_MIGLIORAMENTO.md`. Non aggiungere task nuovi in `analisi.txt`.

Decisioni prese dal titolare (27 agosto 2026):
1. Ricalcolo sulla riga divergente di "holding dibenedetto": LASCIARE COSÌ. Le letture
   mostrano già il valore corretto perché lo calcolano; il pulsante esiste ma non va premuto.
   Se in futuro si vorrà la scrittura in produzione, è `POST /progetti/:id/ricalcola`
   (solo advisor/super_admin).
2. I due moduli senza micro-voci su "Struttura Holding — Famiglia Ricci": LASCIARLI COSÌ
   per ora. Il codice li preserva (nessun declassamento automatico).
3. La conferma di conclusione operazione nel portale: TRASFORMATA IN FIRMA VERA. Ora è una
   FEA con lo stesso flusso OTP dei documenti: ambito `modulo_completato` in
   `/portal/verify-otp-and-sign` e `/portal/firma-con-file`, impronta calcolata dal server
   sui dati canonici del modulo (`improntaModuloCompletato`: nome, categoria, prezzo,
   progetto, microvoci ordinate — mai dal browser), guard 409 se il modulo non è `done` o
   è già firmato, riga in `FirmaElettronica` con data, hash e IP del momento della firma.
   Il portale rilegge le conclusioni da `GET /firme` filtrato per ambito: la firma fatta su
   un dispositivo è visibile a tutti, studio compreso. La chiave localStorage
   `bluman_module_signatures_…` non è più né scritta né letta.
4. Etichette firma nella UI: niente più diciture FEA/eIDAS/firma digitale/firma elettronica
   avanzata — il wording corretto è «Firma Elettronica Semplice (OTP verificata) · art. 20
   CAD» (SES). Il sigillo server-side in database non cambia; le opzioni di firma qualificata
   esterna (file `.p7m`, provider Aruba/InfoCert/Namirial/SPID) restano disponibili; gli
   identificatori interni (`generateEidasSignatureSeal()`, enum `fea_otp`) non si toccano.
5. Documenti firmati: solo archiviabili, MAI eliminabili. L'hard delete di `Documento`
   firmato (o con firma/OTP pendente collegati) è vietato a tutti, admin inclusi (409);
   l'unica uscita è `PATCH /documenti/:id/archivia`.
6. Ordine operativo del piano gap (`piano-sviluppo-gap-firma-documenti.md`): 3 → 2 → 1 → 4.
7. Punto 1 (export PDF+Word): due motori dallo stesso merge dati — **Docxtemplater** per il
   Word e **pdfkit** per il PDF. Niente LibreOffice su Railway. L'hash legale resta sul PDF.
8. Punto 4 (notifiche): audit del cablaggio esistente + implementazione dei trigger mancanti
   della matrice, non solo report.

Decisioni che aspettano ancora il titolare del dato, da non prendere da soli:
1. Nel Vault i documenti allegano l'evidenza di firma solo se esiste; l'IP non c'è più perché
   non era mai stato registrato. Le firme NUOVE registrano l'IP lato server
   (`firma_elettronica.ip_address` da `req.ip`): la voce riguarda solo le firme storiche.
   Se l'evidenza forense serve per davvero anche sul pregresso, va decisa una sanatoria.

Prima di toccare qualsiasi cosa, esegui `npx prisma generate`, poi `npx vitest run`,
`npx tsc --noEmit` in radice e `npm run typecheck` in `frontend/` (che esegue
`tsc -b --force`: il `tsc --noEmit` sul tsconfig del frontend, avendo `"files": []`, non
verifica nulla ed è vietato come presidio). Se qualcosa è rosso PRIMA delle tue
modifiche, dillo invece di aggiustarlo di nascosto.
`npx prisma generate` viene prima per un motivo concreto: il client generato in `node_modules`
non è versionato e resta indietro rispetto a `prisma/schema.prisma`. Succede davvero — `Cliente`
ha `email` e `password_hash` nello schema, ma con il client vecchio `npx tsc --noEmit` in radice
fallisce con dieci errori su `src/server.ts` ("'email' does not exist in type ClienteWhereInput").
Non è codice rotto e non va "corretto" toccando server.ts: è il codegen da rifare.

Leggiti i file .agents/AGENTS.md, README.md ed ISTRUZIONI_INSTALLAZIONE.md prima di iniziare qualsiasi modifica!
```

---

## 🏛 Mappa Architetturale Rapida

- **`frontend/src/pages/Dashboard.tsx`**: Dashboard KPI portafoglio, avvisi ritardo e navigazione clienti.
- **`frontend/src/pages/Projects.tsx`**: Gestione Avanzata Progetti (Schede Operatore, Tabella ERP Matrice, Kanban Pipeline).
- **`frontend/src/pages/ClientsPage.tsx`**: Anagrafica Clienti ERP (4 schede) e Magic Link passwordless.
- **`frontend/src/pages/CalendarPage.tsx`**: Calendario Condiviso & Scadenzario Studio (Vista Mese / Agenda Lista con dati reali da DB).
- **`frontend/src/pages/ProjectDetail.tsx`**: Dettaglio Progetto con Grafo Moduli (`GrafoModuliProgettoView`), Comunicazioni Omnichannel, Fatture/NC e Scadenze microvoci.
- **`frontend/src/pages/DocumentEditorPage.tsx`**: Studio Document Studio (Word WYSIWYG, Smart Tags ERP, Foglio A4, PDF) con selettore micro-voce di destinazione e «Percorso del documento».
- **`frontend/src/pages/Library.tsx`**: Distinta Base, Catalogo Articoli, Modelli Documenti ed Editing Prezzi Unitari.
- **`frontend/src/pages/ClientPortal.tsx`**: Portale Cliente a 7 schede (Proposta & Firma con OTP, Avanzamento, Form Societari, Documenti & Contratti, Fatture, Chat & Comunicazioni, Profilo & Password) con cronologia versioni a ritroso §WF-DOC (`versioniPrecedenti[]`). Dopo lo split del 28/08/2026 (commit `6aee803`) questo file tiene solo stato, handler ed effetti; il JSX vive nei 18 componenti presentazionali di **`frontend/src/components/portal/`** (login, 7 tab, 6 modali, `types.ts`/`mapPortalModules.ts`/`format.ts`/`styles.ts`).
- **`frontend/src/pages/InvoicesPage.tsx`**: Registro Fatture/NC ed Export XML SDI FatturaPA.
- **`frontend/src/pages/PrimaNotaPage.tsx`**: Registro Prima Nota, Movimenti Cassa/Banca e Riconciliazione CSV.
- **`frontend/src/pages/RetainersPage.tsx`**: Contratti Ricorrenti & Retainer Studio periodici.
- **`frontend/src/pages/SettingsPage.tsx`**: Impostazioni Studio, Configuratore PDF, Gestione Team con iniziali/hover card, Matrice Permessi RBAC ed Email Suite SMTP/IMAP.
- **`src/server.ts`**: Server Fastify API — dopo lo split dei monoliti (27/08/2026) è un guscio sottile (~510 righe): middleware, hook `onRequest` di autenticazione (§23), `/stream` SSE, health/refresh, error handler centrale. Le rotte sono nei moduli `src/routes/` (auth, tenant, catalogo, clienti, progetti, contabilita, documenti, portale, firma, notifiche, webhooks), registrate sempre dentro il wrapper `server.register` di `buildServer`. Gli endpoint storici — `/auth/login`, `/auth/magic-login`, `/portal/request-otp`, `/portal/verify-otp-and-sign`, `/portal/documenti` (con `documentoPadreId` + `versioniPrecedenti[]`), `/documenti/:id/sblocca` (solo admin, §WF-DOC), `/documenti/:id/archivia` (soft-delete dei firmati), `DELETE /progetti/:id/moduli/:moduloId` (guard 409 + transazione ordinata), `/progetti/:id/ricalcola`, `/cron/esegui-notifiche-scadenze`, `/invoices/:id/trasmetti-sdi` — esistono tutti, solo spostati nei moduli di dominio. Gli helper condivisi vivono in `src/util/serverHelpers.ts`.
- **`src/domain/stateEngine.ts`**: Motore di stato §16 in funzioni pure (nessun database, solo `import type`). Non aggiungerci query.
- **`src/services/calcoloService.ts`**: Unico ponte fra il motore e Prisma — `calcolaAvanzamento()` (in memoria, zero query), `arricchisciProgetti()` e `ricalcolaProgetto()` (persiste la cascata verso l'alto).
- **`prisma/schema.prisma`**: Schema database Supabase PostgreSQL con RLS isolata per Tenant.

---

## ⚙️ Comandi di Avvio sul Nuovo PC

```bash
# 1. Clona il repository
git clone https://github.com/mariobros1987/bluman.git
cd bluman

# 2. Installa dipendenze
npm install
cd frontend && npm install && cd ..

# 3. Avvia Backend Fastify (Porta 3000)
npx tsx src/index.ts

# 4. Avvia Frontend React (Porta 5173)
cd frontend && npm run dev
```

### 🔑 Identità Git e deploy Vercel (IMPORTANTE)

Vercel (piano Hobby, team `fanta-ia`) **blocca il deploy se l'autore del commit non è riconosciuto** come proprietario del progetto ("The deployment was blocked because the commit author did not have contributing access..."). L'email dell'autore DEVE essere quella dell'account GitHub proprietario del repo:

```bash
git config user.name "Mario Dibenedetto"
git config user.email "mariobros1987@gmail.com"   # NON mario.dibenedetto87@gmail.com: quella non è mappata sull'account GitHub e blocca Vercel
```

- Il repo ha già questa configurazione locale (impostata il 28/08/2026 dopo un blocco del deploy).
- Il progetto root `bluman` si deploya da solo a ogni push su `main` (integrazione GitHub); il progetto `frontend` si deploya manualmente dalla cartella `frontend/` con `npx vercel --prod`.
- Verifica stato deploy: `npx vercel ls` (CLI già autenticata).

---

## ⚡ Connessione Diretta a Supabase tramite CLI & Prisma (IMPORTANTISSIMO)

### 1. Configurazione Variabile `.env` Database URL:
Nel file `.env` sul nuovo PC servono **tre** stringhe di connessione, tre ruoli diversi di
proposito (§14 — vedi `.env.example` e `src/util/prismaClient.ts`):
```env
# Runtime: ruolo applicativo, NON può scavalcare le policy RLS.
DATABASE_URL="postgresql://bluman_app.[PROJECT-REF]:[APP-PASSWORD]@[POOLER-HOST]:5432/postgres"
# Migrazioni Prisma: ruolo proprietario dello schema.
DIRECT_URL="postgresql://postgres.[PROJECT-REF]:[DB-PASSWORD]@[POOLER-HOST]:5432/postgres"
# Manutenzione, seed, bootstrap, backup e ricerca utente al login: scavalca RLS.
ADMIN_DATABASE_URL="postgresql://postgres.[PROJECT-REF]:[DB-PASSWORD]@[POOLER-HOST]:5432/postgres"
```

### 2. Collegamento Supabase CLI & Migrazioni Prisma:
Per collegarsi ed allineare il database Supabase dal terminale:

```bash
# A. Collegamento tramite Supabase CLI
npx supabase link --project-ref cfdtjdrfeidbemhunilt

# B. Ruolo applicativo + policy RLS (una volta per database, serve psql per \gexec)
PW=$(node -e "console.log(require('crypto').randomBytes(24).toString('base64').replace(/[^A-Za-z0-9]/g,'').slice(0,28))")
psql "$ADMIN_DATABASE_URL" -v ON_ERROR_STOP=1 -v pw="$PW" \
     -f supabase/migrations/20260819_rls_effettiva.sql
npx tsx src/scripts/checkRls.ts   # deve mostrare bluman_app, bypassa_rls=false, 0 righe con tenant finto

# C. Generazione Prisma Client & applicazione migrazioni versionate
npx prisma generate
npx prisma migrate deploy      # MAI `db push --accept-data-loss` su un DB con dati reali
npm run seed                   # Popola i dati master di seed sul DB reale Supabase
```

> ⚠️ `prisma db push --accept-data-loss` riallinea lo schema cancellando in silenzio
> colonne e tabelle non presenti nel file. Era il comando di avvio del container su
> Railway: ora il `Dockerfile` esegue `prisma migrate deploy`.

