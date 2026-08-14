# BluMan — Piano di sviluppo

**Fonte:** `BluMan_specifica_di_sviluppo_v2.3.docx` (34 sezioni) — ogni voce qui sotto referenzia la sezione di origine (§N) per tracciabilità.
**Come leggerlo:** ordine di esecuzione consigliato, non ordine narrativo del documento. Ogni fase è pensata per essere completabile e testabile prima di passare alla successiva. Checkbox per spuntare mano a mano.

---

## ⚠️ Prima di iniziare — un'incoerenza trovata rileggendo il documento

**§13 (Roadmap)** classifica fatturazione ibrida, calendario condiviso e permessi granulari come **V2/V3**. Ma:
- **§18-21** scrivono le API complete di tutti e quattro come se fossero pronte da subito, non abbozzate.
- In una discussione successiva a quella roadmap, l'ordine di priorità reale concordato era: **fatturazione → permessi → calendario → dashboard super admin**, motivato dal fatto che senza fatturazione lo studio non si fa pagare dal giorno 1.

Il documento non è mai stato aggiornato per riconciliare queste due cose. **Questo piano segue l'ordine di priorità reale (fatturazione presto), non la classificazione V2/V3 di §13** — decisione da confermare con chi ha commissionato il progetto prima di procedere, non qualcosa che ho deciso unilateralmente qui.

---

## FASE 0 — Setup e fondamenta di progetto

- [ ] Repository, linguaggio/framework backend (scelta libera, §25 — non specificato nel documento)
- [ ] Postgres in locale via Docker Compose (§ discussione infra — container per l'app, DB gestito in produzione, non containerizzato)
- [ ] Struttura cartelle: separare nettamente il **motore di stati** (§16) come modulo di dominio puro, senza dipendenze da HTTP/DB — è esplicitamente richiesto per testabilità
- [ ] CI di base (lint + test) prima ancora di scrivere la prima entità

## FASE 1 — Schema database (§14, con estensioni §19/§26/§28)

- [ ] `tenant`, `user` (incl. `stato` attivo/invitato/disattivato — nota aggiunta in §24)
- [ ] `cliente`
- [ ] Libreria a distinta base (§3bis): `articolo`, `modulo_template` (con `prezzo_pacchetto` nullable), `riga_distinta`, `passaggio_template`, `modulo_dipendenza_template`
- [ ] `preventivo`, `engagement_letter`
- [ ] `progetto`, `modulo_progetto`, `microvoce_progetto` (incl. `segnale_rischio`, `ore_extra` — §7bis/§16), `passaggio_progetto`, `modulo_progetto_dipendenza`
- [ ] `documento` **con** `stato_scansione`, `scansionato_at` (estensione §28 — includerli da subito, non aggiungerli dopo)
- [ ] `fattura` **con i campi SDI fin dall'inizio** (§26): `tipo_cliente_fiscale`, `partita_iva`, `codice_fiscale`, `numero_progressivo`, `canale`, `stato_sdi`, `xml_fatturapa_url` — evita una migrazione dolorosa a metà sviluppo
- [ ] `fattura_riga`
- [ ] `evento_calendario`
- [ ] `accesso_risorsa` (§19) — **3 FK nullable** (`progetto_id`, `modulo_progetto_id`, `microvoce_progetto_id`) con CHECK "esattamente una valorizzata", non un riferimento polimorfico `tipo_risorsa`+`risorsa_id` — trovato disegnando lo schema ER prima di iniziare: un ID polimorfico non è verificabile dal database, e su una tabella di permessi l'integrità reale conta più della compattezza
- [ ] `notifica`
- [ ] **Row-Level Security su `tenant_id`** a livello Postgres (§14) — non rimandare, è la difesa in profondità contro un bug applicativo che fa trapelare dati tra tenant
- [ ] Verifica anti-ciclo sul grafo `modulo_dipendenza_template` (§7ter) — vincolo applicativo, non esprimibile come FK semplice

## FASE 2 — Autenticazione (§23)

- [ ] Staff: hash password (bcrypt/argon2), JWT access (15 min) + refresh (30gg, rotante, revocabile), claims `{user_id, tenant_id, ruolo}`
- [ ] Cliente: login passwordless a magic link (riusa lo stesso meccanismo di §15/§17.4, non costruirne uno separato)
- [ ] Super Admin: password + 2FA TOTP obbligatorio, sessione più breve (4h)
- [ ] Middleware che estrae `tenant_id`/`ruolo` dal token e li applica **prima** di ogni query (base per RLS + `checkScope`, §19)

## FASE 3 — Bootstrap del sistema (§27)

- [ ] Script CLI (mai endpoint pubblico) che crea il primo `super_admin` con password temporanea stampata una tantum
- [ ] Flusso: primo login → cambio password obbligatorio → attivazione 2FA obbligatoria prima di qualunque altra azione
- [ ] `POST /admin/tenants` crea anche il primo advisor del tenant via invito email (non password temporanea)
- [ ] Documentare la sequenza nel README — non lasciarla implicita

## FASE 4 — Libreria: articoli e distinta base (§3bis, §30)

- [ ] `POST /articoli`, `GET /articoli` (paginato, §29), `PATCH /articoli/:id/disattiva` — **niente modifica del contenuto in MVP** (§30, decisione esplicita: correggere = disattiva + crea nuovo)
- [ ] `POST /moduli` in transazione unica (ModuloTemplate + RigaDistinta per riga + ModuloDipendenzaTemplate per dipendenza), `GET /moduli`, `GET /moduli/:id`, `PATCH /moduli/:id/disattiva`
- [ ] Calcolo prezzo modulo: somma righe di distinta, salvo `prezzo_pacchetto` se impostato (§7, §3bis)
- [ ] Verifica anti-ciclo su `modulo_dipendenza_template` alla creazione (§7ter)
- [ ] **Versionamento vero (nuova versione + ripubblicazione) esplicitamente fuori scope MVP** — rimandato a V2 per non scriverlo sotto pressione insieme al resto (§30); l'interfaccia grafica di gestione libreria resta V2 come già previsto (§13)

## FASE 5 — Motore di calcolo stati (§16) — dominio puro, da testare in isolamento

- [ ] `valutaSegnaleRischio`, `calcolaPercentualeMicroVoce` (16.1)
- [ ] `calcolaStatoModulo`, `calcolaPercentualeModulo` (16.2) — occhio alla precedenza: blocked > delayed > done > attesa_dipendenza > in_progress > pending
- [ ] `calcolaPercentualeProgetto`, `calcolaStatoProgetto` (16.3)
- [ ] `registraConsuntivazione`, `marcaRitardoManuale`, `risolviRitardoManuale` (16.4)
- [ ] `risolviDipendenze` — **deve essere idempotente** (16.5), test dedicato per questo
- [ ] Test esplicito sulla regola 16.6: aggiornare un modulo non deve mai riscrivere lo stato delle sue micro-voci (cascata solo verso l'alto)
- [ ] Test esplicito: `segnale_rischio` e `delayed`/`blocked` devono poter coesistere senza conflitti (§7bis)

## FASE 6 — API Fase 0-1: pre-progetto → progetto attivo (§15)

- [ ] `POST /clienti`, `GET /clienti/:id`
- [ ] `POST /progetti` (stato iniziale `pre_project`)
- [ ] `POST /preventivi`, `PATCH /preventivi/:id`, `POST /preventivi/:id/invia`, `POST /preventivi/:id/accetta`
- [ ] `POST /engagement-letters`, `POST /engagement-letters/:id/invia-per-firma` — dietro interfaccia astratta `FirmaProvider` (§22)
- [ ] `POST /engagement-letters/:id/webhook-firma` — autenticazione via secret webhook
- [ ] **La transazione di istanziazione (§15.3)** — il pezzo più delicato di tutto il documento: 6 passaggi in un'unica transazione atomica (crea `modulo_progetto` → `microvoce_progetto` per ogni riga×quantità → `passaggio_progetto` per copia → `modulo_progetto_dipendenza` → micro-voci dipendenti in `attesa_dipendenza` → notifica). Se un passaggio fallisce, rollback completo — mai un progetto "a metà istanziato"
- [ ] `GET /progetti/:id` con vista filtrata per ruolo (§9)

## FASE 7 — API Fase 2-4: esecuzione e procedura guidata (§17)

- [ ] `POST /microvoci/:id/consuntiva`, `/ritardo`, `/risolvi-ritardo`, `PATCH .../assegna`
- [ ] `PATCH /microvoci/:id/completa` — **con la validazione che collega procedura guidata e motore stati**: rifiuta se non tutti i `passaggio_progetto` sono `done` (§17.1, il punto di raccordo più importante del documento)
- [ ] `GET /microvoci/:id/passaggi`, `POST /passaggi/:id/upload`, `/submit-form`, `/marca-completato`
- [ ] `POST /microvoci/:id/passaggi`, `DELETE /passaggi/:id`, `PATCH .../riordina` — personalizzazione a livello di istanza, mai sul template
- [ ] `POST /microvoci/:id/documenti`, `GET /progetti/:id/documenti`
- [ ] Job schedulato `promemoriaPassaggiPending` (soglia giorni configurabile per tenant)

## FASE 8 — Sicurezza upload (§28) — implementare insieme alla Fase 7, non dopo

- [ ] Limite dimensione 20MB
- [ ] Whitelist formati verificata sui **magic bytes**, non sull'estensione dichiarata dal client
- [ ] Pipeline di scansione antivirus (ClamAV o servizio cloud) — documento visibile solo a chi l'ha caricato finché `stato_scansione != 'pulito'`
- [ ] Comportamento su `infetto`: mai accessibile ad altri, notifica interna all'operatore (mai al cliente)

## FASE 9 — Fatturazione, incluso SDI (§18 + §26) — **priorità alta, vedi nota in cima**

- [ ] `POST /progetti/:id/fatture`, `POST /fatture/:id/righe` con le tre validazioni (modulo_completo richiede stato=done; modulo_parziale non supera 100% cumulato; milestone_libera libera)
- [ ] Campi SDI su `fattura` fin dallo schema (già in Fase 1) — qui l'implementazione: distinzione `tipo_cliente_fiscale` → `canale` derivato
- [ ] `numero_progressivo`: **generazione in transazione con lock**, mai concorrente/ottimistica — unico punto del sistema con conseguenze legali dirette in caso di bug
- [ ] `POST /fatture/:id/emetti` — genera XML FatturaPA e trasmette se canale=sdi (dietro interfaccia astratta `SDIProvider`), solo PDF se canale=standard
- [ ] `POST /fatture/:id/webhook-sdi`, `POST /fatture/:id/incassa`
- [ ] `GET /progetti/:id/fatturazione` con la formula esatta del residuo (§12)

## FASE 10 — Permessi granulari (§19) — **priorità alta, vedi nota in cima**

- [ ] `checkScope(user, {progetto_id?, modulo_progetto_id?, microvoce_progetto_id?}, livello)` — usato da ogni endpoint sensibile, non solo dai tre sotto; il chiamante passa esattamente uno dei tre id
- [ ] `POST /progetti/:id/collaboratori` (crea utente esterno se non esiste + invito email; valida server-side che sia passato esattamente uno tra `progetto_id`/`modulo_progetto_id`/`microvoce_progetto_id`)
- [ ] `DELETE /accessi/:id`, `GET /progetti/:id/accessi`
- [ ] Verifica: scope ereditato verso il basso (accesso a un modulo → accesso a tutte le sue micro-voci), mai verso l'alto

## FASE 11 — Gap del confronto prototipo↔documento (§24)

- [ ] `GET /progetti/:id/team` (aggregazione ore/completate per collaboratore)
- [ ] `POST /tenant/utenti`, `GET /tenant/utenti`, `PATCH /tenant/utenti/:id` (gestione collaboratori interni — mai cancellazione fisica)

## FASE 12 — Calendario (§20)

- [ ] `POST/GET/PATCH/DELETE /eventi`
- [ ] Scope ereditato dal progetto collegato (chi non vede il progetto vede solo lo slot occupato, non il dettaglio)

## FASE 13 — Dashboard Super Admin (§21)

- [ ] `GET/POST/PATCH /admin/tenants`, `GET /admin/tenants/:id/metriche`, `POST .../reset-owner-access`
- [ ] Verifica bypass RLS sicuro solo per `ruolo=super_admin`, non un semplice check applicativo

## FASE 14 — Paginazione e ricerca (§29) — trasversale, applicare a tutte le liste sopra

- [ ] Pattern standard `?page=&limit=&q=` su `/progetti`, `/clienti`, `/tenant/utenti`, `/fatture` — default 25, max 100
- [ ] Non aggiungerlo "dopo" lista per lista: definirlo una volta come helper condiviso prima di costruire la seconda lista

## FASE 15 — Notifiche email

- [ ] Servizio email transazionale (Postmark/SendGrid o simile, §10) dietro interfaccia astratta — stesso pattern di FirmaProvider/SDIProvider
- [ ] Webhook di conferma lettura dove disponibile

## FASE 16 — Frontend

- [ ] Decisione: rifacimento component-based (React, §10) mantenendo la struttura di viste già validata nel prototipo HTML, oppure altro framework — non specificato, a discrezione
- [ ] Portale cliente come superficie separata con auth propria (magic link, Fase 2)
- [ ] Riferimento visivo: `BluMan_platform.html` (prototipo) — utile per interazioni/microcopy, **non per la struttura dati sottostante** (che aveva 3 scostamenti dal documento prima dell'ultimo aggiornamento — verificare comunque a vista prima di fidarsi ciecamente)

## FASE 17 — Testing

- [ ] Unit test motore stati (Fase 5) — priorità massima essendo dominio puro, il più facile da testare bene
- [ ] Test di integrazione sulla transazione di istanziazione (§15.3) — rollback su fallimento a metà
- [ ] Test sul generatore di `numero_progressivo` fatture sotto concorrenza (Fase 9)
- [ ] Test RLS: un utente del tenant A non deve mai poter leggere righe del tenant B, nemmeno con query malformate

## FASE 18 — Decisioni non bloccanti da chiudere entro il go-live (§25)

Non fermano lo sviluppo, ma vanno chiuse prima di andare in produzione:
- [ ] Provider firma digitale concreto (§22 — criterio già dato, scelta commerciale da confermare)
- [ ] Provider/intermediario SDI concreto (§26 — es. Aruba, FatturaPRO)
- [ ] GDPR: hosting in region UE, crittografia documenti at-rest, retention policy, DPA con ogni fornitore terzo
- [ ] Infrastruttura: hosting, CI/CD, ambienti staging/produzione — Docker per l'app, database su servizio gestito separato (non containerizzato in produzione)
- [ ] Stack tecnico backend concreto (linguaggio/framework) — non specificato nel documento, libero

---

## Checklist di chiusura per ogni fase (da ripetere ad ogni consegna)

- [ ] Ogni endpoint ha il controllo di scope (§15.1) implementato, non solo pianificato
- [ ] Ogni scrittura di stato passa dal motore di §16, nessuna logica di calcolo duplicata altrove
- [ ] Ogni tabella nuova ha `tenant_id` (tranne `tenant` stessa e `user` quando `super_admin`)
- [ ] Ogni lista nuova rispetta il pattern di paginazione di Fase 14
