# BluMan — Modulo KYC & Compliance
**Specifica funzionale per lo sviluppo — bozza v0.2 (23/09/2026)**

> Documento di lavoro. Le regole di business derivano da ricerche su fonti pubbliche (FIAU, MFSA, MBR, studi professionali) e **vanno validate con un consulente antiriciclaggio maltese** prima di essere considerate definitive. Dove una regola è incerta è marcata **[da verificare]**.

**Novità rispetto alla v0.1**
- Giurisdizione di riferimento: **Malta** (la v0.1 era impostata sul quadro italiano).
- Nuova sezione 3: **configurazione per giurisdizione e per profilo di soggetto obbligato**. Il profilo (company service provider autorizzato MFSA oppure altro soggetto obbligato) non è ancora deciso, quindi il sistema deve supportare **entrambi come impostazione**.
- Figura dell'**MLRO**, canale **goAML**, conservazione a **5 anni**, valutazione del rischio **per pilastri**, controllo **media negativi**.

---

## 1. Scopo

Integrare in BluMan i processi di **identificazione del cliente (KYC)**, **adeguata verifica (CDD)**, **profilazione del rischio**, **monitoraggio continuo** e **conformità privacy**, in modo che:

- nessun incarico si avvii senza aver completato la verifica richiesta;
- ogni verifica sia **tracciata, dimostrabile e conservata**;
- il sistema gestisca **scadenze e revisioni**;
- le regole cambino **per configurazione**, non per modifica del codice.

**Principio guida:** il KYC non è un'app a parte. Si costruisce con i mattoni già esistenti (multi-tenancy, libreria moduli/BOM, DAG, firma elettronica, audit trail, conservazione digitale, reminder).

## 2. Innesto nell'architettura esistente

| Componente BluMan | Uso nel modulo KYC |
|---|---|
| Multi-tenancy | Checklist, politiche, profilo normativo e profili di rischio per tenant/progetto. Isolamento totale. |
| Libreria moduli (BOM) | Il KYC è un **modulo di libreria** con sotto-moduli agganciabili agli incarichi. |
| DAG dipendenze | Il modulo KYC è **nodo a monte**: esecuzione e fatturazione dipendono dallo stato `APPROVATO`. |
| Firma elettronica (SES/FEA/FEQ) | Dichiarazioni del cliente, dichiarazione sul titolare effettivo, informativa privacy, mandato. |
| Audit trail | Ogni azione KYC è un evento immutabile. |
| Conservazione digitale | Fascicolo KYC conservato per il termine del pacchetto giurisdizione attivo. |
| Reminder | Scadenza documenti, revisioni periodiche, richieste pendenti, variazioni titolare effettivo. |
| Bot Telegram | Solo **notifiche generiche e solleciti**. Nessun documento d'identità né dati sensibili. |
| **Pacchetto giurisdizione (nuovo)** | Insieme di parametri e regole per Paese, selezionato a livello di tenant/progetto (sez. 3). |

## 3. Configurazione: giurisdizione e profilo (sezione chiave)

### 3.1 Concetto
Le regole non vanno scritte nel codice dei processi. Ogni tenant (e, se serve, ogni progetto) ha:

- un **pacchetto giurisdizione** (`MT` attivo; `IT` predisposto, vedi 3.4);
- un **profilo di soggetto obbligato** all'interno del pacchetto.

Il modulo KYC legge da qui autorità, termini, canali di segnalazione, checklist e funzioni abilitate.

### 3.2 Impostazioni del tenant

| Impostazione | Valori | Note |
|---|---|---|
| `jurisdictionPack` | `MT` (default), `IT` | Determina normativa, autorità, termini. |
| `regulatoryProfile` | `CSP_MFSA` \| `ALTRO_SOGGETTO_OBBLIGATO` | **Scelta da fare in seguito**: entrambi devono funzionare. Modificabile con evento di audit. |
| `otherSubjectCategory` | testo/elenco | Solo se `ALTRO_SOGGETTO_OBBLIGATO`: categoria in cui rientra il soggetto **[da verificare]**. |
| `retentionYears` | default 5 (MT) | Parametro, con possibilità di proroga per singolo fascicolo. |
| `mlroAssigned` | utente | Obbligatorio prima di attivare il modulo. |
| `reportingChannel` | `goAML` (MT) | Il sistema prepara e registra, **non invia**. |
| `screeningProvider` | `MANUALE` \| provider | Interfaccia astratta. |

**Regola:** finché `regulatoryProfile` non è impostato, il tenant può usare il modulo in modalità **bozza** (nessun incarico può passare in esecuzione).

### 3.3 Cosa cambia tra i due profili (Malta)

| Aspetto | `CSP_MFSA` | `ALTRO_SOGGETTO_OBBLIGATO` |
|---|---|---|
| Norme di riferimento | PMLA (Cap. 373), PMLFTR (S.L. 373.01), Implementing Procedures **Parte I + sezioni Parte II per i company service providers**; Company Service Providers Act (Cap. 529) | PMLA, PMLFTR, Implementing Procedures **Parte I + Parte II se prevista per la categoria** **[da verificare]** |
| Autorità | FIAU (AML/CFT) **e** MFSA (autorizzazione/vigilanza) | FIAU; eventuale altro supervisore di categoria **[da verificare]** |
| Anagrafica autorizzazione | Scheda `Authorisation`: n. autorizzazione, ambito servizi, condizioni, data | Non prevista (campo facoltativo per l'iscrizione di categoria) |
| Servizi erogati | Registro obbligatorio dei servizi (costituzione società, sede legale, amministratore/direttore, socio fiduciario, ecc.), ognuno con peso di rischio | Registro dei servizi facoltativo |
| Coordinamento depositi al registro dei titolari effettivi | Funzione attiva (bozza dati per la comunicazione, allarme 14 gg) | Funzione disattivabile |
| Adempimenti MFSA specifici | Modulo dedicato da mappare **[da verificare]** | Disattivato |
| Questionario periodico FIAU (REQ) | Preparazione dati per l'MLRO, che è l'unico a poterlo inviare **[da verificare applicabilità]** | Come sopra **[da verificare]** |
| Checklist KYC | Set CSP (es. verifica catena di controllo, scopo della struttura societaria, fonte del patrimonio) | Set generale Parte I |

Tutto ciò che è "funzione" è un **feature flag** legato al profilo, non un ramo del codice.

### 3.4 Pacchetto `IT` (predisposto, non prioritario)
Il pacchetto `IT` resta come opzione per clienti/tenant italiani: normativa D.Lgs. 231/2007, autorità UIF, canale portale UIF, conservazione secondo la norma italiana **[da verificare]**. Non va sviluppato in dettaglio ora: basta che il modello dei parametri lo consenta.

## 4. Perimetro normativo (Malta)

- **Antiriciclaggio:** Prevention of Money Laundering Act (Cap. 373); PMLFTR (S.L. 373.01); **Implementing Procedures FIAU** Parte I (generale) e Parte II (settoriale). Usare la versione in vigore (risulta una versione aprile 2026 della Parte I) **[da verificare]**.
- **Company service providers:** Cap. 529 e regole MFSA (solo profilo `CSP_MFSA`).
- **Titolari effettivi:** Companies Act (Cap. 386) e regolamenti sul registro dei titolari effettivi (S.L. 386.19) presso il Malta Business Registry.
- **Trust:** Trusts and Trustees Act, se rilevante **[da verificare]**.
- **Privacy:** GDPR e legge maltese di attuazione; autorità di controllo maltese.
- **Firma elettronica:** già coperta dal modulo firme.
- **Regolamento UE antiriciclaggio (AMLR):** applicazione attesa dal 2027, da tenere in considerazione nell'architettura **[da verificare]**.

## 5. Macro-processi

### 5.1 Onboarding cliente
```
1. Apertura pratica KYC (cliente + incarico) e verifica del profilo tenant
2. Identificazione soggetto (persona fisica / giuridica)
3. Acquisizione documenti e dati
4. Individuazione titolare/i effettivo/i e catena di controllo
5. Screening: sanzioni, PEP, media negativi
6. Scopo e natura del rapporto / dell'incarico (e servizi richiesti)
7. Valutazione del rischio cliente per pilastri (sez. 6)
8. Livello di verifica: semplificata / ordinaria / rafforzata
9. Approvazione (ruolo autorizzato)
10. Firma delle dichiarazioni del cliente
11. Sblocco dei moduli dipendenti nel DAG
```

### 5.2 Monitoraggio continuo
- Revisione periodica in funzione del rischio.
- Scadenza documenti e poteri di rappresentanza.
- Variazioni: nuovo titolare effettivo, cambio struttura, nuova attività. **Allarme a 14 giorni** dalla variazione se il tenant coordina i depositi al registro dei titolari effettivi.
- Ripetizione degli screening con cadenza definita.
- Le variazioni generano un **caso** con responsabile e scadenza, non un semplice promemoria.

### 5.3 Anomalie e segnalazioni
- Segnalazione interna all'**MLRO** entro il giorno lavorativo successivo al rilievo **[da verificare]**.
- L'MLRO valuta senza ritardo, può richiedere informazioni aggiuntive, decide se segnalare e registra la motivazione.
- Il sistema **prepara i dati** e registra **riferimento e timestamp goAML**; l'invio avviene sul portale FIAU. Tempi di invio (indicati come "lo stesso giorno" in fonti di settore) **[da verificare]**.
- **Vincolo critico:** nulla di questo flusso deve essere visibile o deducibile dal cliente né dai canali client-facing. Divieto di informare il cliente.
- Il fascicolo anomalie ha permessi e log di accesso separati.

### 5.4 Chiusura e conservazione
- Alla chiusura il fascicolo passa in conservazione con scadenza calcolata da `retentionYears` (default **5 anni dalla fine del rapporto**, salvo proroga richiesta).
- Il fascicolo del cliente societario va conservato anche se la società è stata cancellata dal registro.
- Allo scadere: cancellazione o anonimizzazione con evento di audit.

### 5.5 Valutazioni a livello di studio
- **Valutazione del rischio dell'attività** (business risk assessment), versionata e con storico.
- Formazione: registro delle attività formative dell'MLRO, degli amministratori e del personale.
- Questionario periodico FIAU (REQ), se applicabile: raccolta dati per l'MLRO.

## 6. Valutazione del rischio cliente (struttura obbligata)

La FIAU ha contestato in provvedimenti pubblicati categorizzazioni basate su pochi dati, perché non coprivano tutti i pilastri di rischio. Quindi `RiskAssessment` **non è un punteggio unico**: è composto da quattro sezioni, ciascuna con dati, punteggio e motivazione:

| Pilastro | Esempi di fattori |
|---|---|
| Cliente | Tipologia, struttura societaria, PEP, media negativi, reputazione |
| Geografia | Paese del cliente, dei titolari effettivi, delle controparti |
| Prodotto/servizio | Servizio richiesto (per i CSP: costituzione, sede, ruoli fiduciari, ecc.) |
| Canale di distribuzione | Onboarding remoto o in presenza, intermediari |

Il livello complessivo deriva dai quattro pilastri con regola documentata. Ogni valutazione è **versionata**, con motivazione scritta e data della prossima revisione.

## 7. Modello dati

| Entità | Contenuto essenziale |
|---|---|
| `TenantComplianceSettings` | `jurisdictionPack`, `regulatoryProfile`, `retentionYears`, `mlroAssigned`, flag funzionali. Versionata. |
| `Authorisation` | (solo `CSP_MFSA`) n. autorizzazione, ambito, condizioni, date. |
| `ServiceOffering` | Servizio erogato, peso di rischio, applicabilità per profilo. |
| `Party` | Soggetto (PF/PG): anagrafica, identificativi fiscali, residenza/sede, tenant. |
| `IdentityDocument` | Tipo, numero, emittente, scadenza, file cifrato, esito verifica. |
| `Representation` | Rappresentante ↔ rappresentato, poteri, fonte. |
| `BeneficialOwner` | Titolare effettivo, criterio, percentuale, fonte, data ultima verifica. |
| `OwnershipLink` | Archi della catena di controllo. |
| `BoRegistryFiling` | Dati e stato della comunicazione al registro dei titolari effettivi; scadenza a 14 gg. |
| `KycCase` | Pratica: stato, livello di verifica, responsabile, collegamento all'incarico. |
| `RiskAssessment` | Quattro sezioni (sez. 6), punteggi, livello, motivazione, versione, prossima revisione. |
| `ScreeningResult` | Tipo (sanzioni / PEP / media negativi), fonte, data, esito, valutazione dei match e falsi positivi. |
| `PurposeOfEngagement` | Scopo e natura del rapporto, origine dei fondi/patrimonio se pertinente. |
| `AnomalyCase` | Fascicolo riservato: segnalazione interna, valutazione, decisione dell'MLRO. |
| `MlroDecisionLog` | Decisioni dell'MLRO con motivazione, timestamp, riferimento goAML. |
| `TrainingRecord` | Formazione svolta, partecipanti, date. |
| `BusinessRiskAssessment` | Valutazione del rischio dell'attività, versioni. |
| `ComplianceEvent` | Evento immutabile (tipo, attore, timestamp, payload, hash). |
| `RetentionPolicy` | Termini per tipo documento, proroghe per fascicolo. |

**Note tecniche**
- Tutte le entità sono **tenant-scoped**.
- Le decisioni di rischio e le impostazioni di compliance sono **versionate**, mai sovrascritte.
- `ComplianceEvent` è append-only, con hash concatenato o equivalente.
- Ogni modifica a `regulatoryProfile` o `jurisdictionPack` genera evento di audit e non altera retroattivamente i fascicoli chiusi.

## 8. Stati e regole di business

**Stati di `KycCase`:** `BOZZA → IN_RACCOLTA → IN_VERIFICA → IN_ATTESA_APPROVAZIONE → APPROVATO | RESPINTO | SOSPESO → IN_REVISIONE → CHIUSO`

**Regole**
1. Un incarico con dipendenza KYC non può passare in esecuzione né generare fatture senza caso `APPROVATO`.
2. Senza `regulatoryProfile` e `mlroAssigned` il tenant resta in modalità bozza.
3. Rischio **alto** ⇒ verifica rafforzata + approvazione dell'MLRO o ruolo superiore.
4. Match PEP/sanzioni non risolto ⇒ blocco dell'approvazione.
5. Media negativi: valutazione manuale registrata, con peso in base a attualità, rilevanza, natura e credibilità della fonte.
6. Documento scaduto o mancante ⇒ `SOSPESO` e reminder.
7. Titolare effettivo non individuabile ⇒ motivazione obbligatoria ed escalation all'MLRO.
8. Identificazione da remoto **non chiude** la CDD: restano rischio, scopo del rapporto, titolare effettivo e monitoraggio.
9. Nessuna cancellazione fisica prima della scadenza di retention.
10. Ogni cambio di stato genera un `ComplianceEvent`.

## 9. Ruoli e permessi (RBAC)

| Ruolo | Permessi |
|---|---|
| Operatore | Crea e compila pratiche, carica documenti. |
| Responsabile compliance | Verifica, assegna rischio, gestisce revisioni. |
| **MLRO** | Accesso completo e illimitato ai dati e ai fascicoli, gestisce anomalie, decide sulle segnalazioni, invia il questionario periodico. Ruolo **obbligatorio** e non delegabile in modo che ne pregiudichi l'indipendenza. |
| Amministratore / vertice | Approva casi ad alto rischio, riceve report; formazione tracciata. |
| Amministratore tecnico | **Nessun accesso ai contenuti** dei fascicoli. |
| Cliente | Solo upload guidato e firma dei propri documenti. **Mai** stato di rischio, screening o anomalie. |

Accessi ai fascicoli anomalie: log dedicato, anche in sola lettura.

## 10. Integrazioni

- **Screening:** interfaccia `ScreeningProvider` (sanzioni, PEP, media negativi). Provider esterno o processo manuale con allegato dell'esito.
- **Registro titolari effettivi (Malta Business Registry):** acquisizione manuale con allegato; l'accesso è limitato a chi ha un interesse legittimo, quindi non presumere accesso automatico. Automazioni future.
- **goAML:** nessuna integrazione diretta in prima fase; esportazione dei dati preparati per l'MLRO e registrazione del riferimento.
- **Firma elettronica e conservazione:** moduli esistenti.
- **Notifiche:** Telegram/email, solo testi generici.

## 11. Sicurezza e privacy

- Documenti d'identità cifrati a riposo, chiavi gestite separatamente, download tracciato.
- Upload del cliente tramite **link sicuro a scadenza** (token monouso), non tramite Telegram.
- Messaggi Telegram senza nomi, importi o esiti.
- Minimizzazione: raccogliere solo il necessario per il livello di verifica.
- Retention parametrica con job di scadenza e log.
- Backup e ripristino con la stessa protezione.
- Log accessi consultabili dall'MLRO.
- Valutare se necessaria una DPIA.

## 12. Notifiche e reminder

| Trigger | Destinatario | Azione |
|---|---|---|
| Documento in scadenza (es. 60/30/7 gg) | Operatore + cliente (messaggio generico) | Sollecito rinnovo |
| Revisione periodica | Responsabile compliance | Task |
| Variazione titolare effettivo | Responsabile compliance | Caso con scadenza 14 gg (se attiva la funzione) |
| Pratica ferma oltre N giorni | Operatore | Sollecito |
| Match screening non risolto | Responsabile compliance / MLRO | Task urgente |
| Segnalazione interna aperta | MLRO | Task con scadenza |
| Scadenza retention | MLRO | Conferma cancellazione/anonimizzazione |
| Formazione periodica | MLRO | Promemoria |

## 13. Fasi di sviluppo proposte

| Fase | Contenuto | Esito atteso |
|---|---|---|
| **K0** | **Impostazioni tenant e pacchetto giurisdizione**: `TenantComplianceSettings`, profilo, feature flag, modalità bozza | Regole configurabili, entrambi i profili supportati |
| **K1** | Anagrafica e documenti: `Party`, `IdentityDocument`, `Representation`, `KycCase`, `ComplianceEvent`, permessi (incl. MLRO) | Anagrafica con audit |
| **K2** | Titolare effettivo, catena di controllo, `BoRegistryFiling` | Ricostruzione controllo e allarme 14 gg |
| **K3** | Valutazione del rischio per pilastri, versioning, registro servizi | Livello di verifica motivato |
| **K4** | Gating nel DAG, stati e approvazioni | Incarichi bloccati senza KYC |
| **K5** | Screening (sanzioni, PEP, media negativi) | Esiti tracciati e blocchi |
| **K6** | Upload sicuro, firme, notifiche | Onboarding remoto |
| **K7** | Monitoraggio: revisioni, scadenze, reminder, variazioni | Ciclo di vita completo |
| **K8** | Fascicolo anomalie, `MlroDecisionLog`, esportazione dati per goAML | Gestione segnalazioni interna |
| **K9** | Conservazione, retention, valutazione rischio attività, formazione, questionario periodico, report | Chiusura del ciclo |
| **K10** (eventuale) | Pacchetto `IT` | Supporto a tenant italiani |

## 14. Criteri di accettazione e test

- Cambiare `regulatoryProfile` attiva/disattiva le funzioni del profilo **senza modifiche al codice** (test su entrambi i profili).
- Senza profilo e MLRO nessun incarico passa in esecuzione.
- Un incarico con dipendenza KYC non avanza senza caso `APPROVATO`.
- Ogni transizione produce un evento non modificabile.
- Il cliente **non può** vedere né dedurre rischio, screening o anomalie (test sui permessi e sulle API client-facing).
- `RiskAssessment` non si chiude se manca uno dei quattro pilastri.
- Documenti cifrati a riposo, download loggato.
- La scadenza di retention rispetta `retentionYears` e le proroghe.
- Nessuna cancellazione anticipata dei dati in retention.
- Isolamento tra tenant verificato con test automatici.

## 15. Punti aperti

1. **Scelta del profilo** (`CSP_MFSA` o altro): rimandata; nel caso "altro", indicare la **categoria di soggetto obbligato** e la Parte II applicabile.
2. Validazione dell'intero impianto con un consulente antiriciclaggio maltese.
3. **Screening:** provider esterno o manuale; fornitore e budget.
4. **Pesi e soglie** delle quattro sezioni di rischio.
5. Adempimenti **MFSA** specifici da mappare (solo `CSP_MFSA`).
6. **Questionario periodico FIAU:** applicabilità e formato dei dati.
7. **Ruoli reali**: chi è l'MLRO, chi approva, eventuale sostituto.
8. **Migrazione** dei clienti già in portafoglio: KYC retroattivo o solo nuovi incarichi?
9. Clienti/strutture in **più giurisdizioni**: uno o più tenant, e quando attivare il pacchetto `IT`.
10. Trust: gestione dei rapporti fiduciari e relative regole **[da verificare]**.
