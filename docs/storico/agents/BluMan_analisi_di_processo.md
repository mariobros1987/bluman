# BluMan (Bluecode Advisory Platform) — Analisi di processo

**Progetto:** BluMan · **Versione documento:** 2.1 (chiusi: fatturazione elettronica SDI, bootstrap sistema, sicurezza upload, paginazione/scala) · **Data:** 09.08.2026
**Base di partenza:** diagramma architettura (23.05.26) + prototipo funzionale HTML

---

## 1. Obiettivo del documento

Prima di scrivere codice, fissiamo il processo produttivo end-to-end così come lo vive lo studio: dal primo contatto con il cliente fino alla chiusura e fatturazione del progetto. Il prototipo HTML che stiamo costruendo in parallelo è già coerente con questo processo (moduli, micro-voci, wizard di creazione, consuntivazione, alert ritardi, procedura guidata). Questo documento cresce insieme al prototipo: ogni decisione presa qui viene integrata, così che il risultato finale sia **il documento unico e dettagliato da consegnare all'informatico** che svilupperà l'app — la specifica di riferimento per tutto lo sviluppo, non solo un'analisi preliminare.

Uso come **caso di studio guida** lo scenario più rappresentativo della tua attività — quello già presente nel prototipo: **la costituzione/trasferimento di una struttura societaria internazionale per un cliente privato**, con holding, trust, conti correnti e IP. È l'esempio che mette in gioco quasi tutti i moduli della libreria, quindi è il test più severo per il modello dati.

---

## 2. Attori del sistema

| Attore | Ruolo | Cosa fa nel sistema |
|---|---|---|
| **Advisor / Titolare studio** | Owner del progetto | Pre-analisi, preventivi, engagement letter, supervisione generale, dashboard ritardi |
| **Collaboratori interni** (legale, fiscale, back office) | Risorse assegnate | Lavorano sulle micro-voci assegnate, consuntivano ore, caricano documenti |
| **Collaboratori esterni** (notai, trust company, banche — opzionale) | Risorse invitate via email | Accesso limitato al modulo/micro-voce per cui sono invitati |
| **Cliente (persona fisica o società)** | Committente | Riceve preventivo, firma engagement letter, carica documenti richiesti, firma form, visualizza avanzamento nel portale |
| **Sistema** | Automazioni | Calcola tempi/costi, rileva ritardi, invia notifiche, genera documenti |

Questa distinzione (interno / esterno / cliente / sistema) è importante perché determina **i permessi**: nel modello dati ogni persona che accede al progetto deve avere uno scope preciso (progetto intero, modulo, singola micro-voce).

A questi si aggiunge un attore trasversale:

| Attore | Ruolo | Cosa fa nel sistema |
|---|---|---|
| **Super Admin** | Gestore della piattaforma (Anthropic-side / owner del prodotto) | Non appartiene a nessuno studio: supervisiona **tutti i tenant**, con una propria dashboard aggregata (numero studi attivi, progetti totali per tenant, fatturato aggregato, stato di salute/utilizzo di ciascun tenant). Non entra nel merito operativo dei singoli progetti dei clienti finali, ma può: creare/sospendere tenant, gestire piani/licenze, vedere metriche di utilizzo, intervenire in caso di supporto tecnico. |

## 2bis. Architettura multi-tenant e Super Admin

Il sistema è **multi-tenant fin dal giorno 1**: ogni studio di consulenza (es. Bluecode Ltd) è un **Tenant** isolato, con i propri clienti, progetti, libreria moduli, team e fatturazione. Nessun dato di un tenant è mai visibile a un altro.

Implicazioni pratiche sul modello:
- **Ogni entità di dominio porta un `tenant_id`** (Cliente, Progetto, ModuloTemplate, Utente, Fattura, ecc.) — non è un dettaglio implementativo rimandabile, va nello schema fin dalla prima tabella.
- L'**utente Super Admin** vive in uno spazio separato (non ha `tenant_id`, o ha un flag `is_super_admin` che bypassa il filtro tenant a livello di query) e accede a una **dashboard cross-tenant** distinta da quella operativa dello studio.
- Gli **utenti "normali"** (advisor, collaboratori, clienti) appartengono sempre a un tenant e non possono mai vedere dati fuori dal proprio tenant, indipendentemente dal ruolo che hanno al suo interno.
- La **libreria moduli** (§3) è per-tenant: ogni studio costruisce e personalizza i propri moduli/micro-voci; non è condivisa tra studi (a meno di un futuro "marketplace di template", fuori scope MVP).

**Dashboard Super Admin — contenuti minimi:**
- elenco tenant con stato (attivo/sospeso/trial), data di attivazione, piano;
- KPI aggregati: n. progetti totali per tenant, valore di portafoglio per tenant, n. utenti attivi;
- azioni: creazione nuovo tenant, sospensione, reset accesso owner del tenant;
- log di sistema/errori a livello infrastrutturale (non a livello di dato cliente).

---

## 3. Entità del dominio (modello concettuale)

Queste sono le entità che il prototipo già disegna implicitamente e che vanno formalizzate in tabelle/collection. **Tutte, tranne Tenant e Super Admin, portano `tenant_id`.**

- **Tenant** — lo studio di consulenza cliente della piattaforma: ragione sociale, piano, stato
- **Utente** — persona con accesso al sistema: `super_admin` (senza tenant) oppure legata a un tenant con ruolo (`advisor`, `collaboratore_interno`, `collaboratore_esterno`, `cliente`)
- **Cliente** — anagrafica, tipo (persona fisica / società), referenti, storico progetti
- **Articolo (micro-processo, libreria, versionato)** — il "pezzo" riutilizzabile e standalone (es. "Raccolta documentazione KYC", "Apertura conto corrente singolo", "Redazione NDA"): nome, categoria, ore stimate, prezzo di default, **la propria procedura guidata di default**. Richiamabile da moduli diversi — vedi §3bis
- **ModuloTemplate (distinta base, libreria, versionata)** — nome, categoria. Non definisce più direttamente le sue micro-voci: la sua composizione è espressa tramite **righe di distinta** che richiamano Articoli
- **RigaDistinta** — collega un ModuloTemplate a un Articolo: ordine, quantità (default 1, es. "Apertura conto" ×2 se servono due società), versione dell'articolo richiamata (pinned), eventuale override di ore/prezzo per quel contesto specifico, flag obbligatorio/opzionale
- **ModuloDipendenza (template)** — relazione tra ModuloTemplate (es. "Tax planning" dipende da "Corporate structuring"): nodo/arco di un grafo diretto, riutilizzabile in ogni progetto che li istanzia entrambi. **Resta a livello di modulo, non di articolo** (vedi §3bis)
- **Progetto** — cliente, stato (`pre_project`, `in_progress`, `completed`), date, valore totale, % avanzamento aggregata
- **ModuloProgetto (istanza)** — copia **della versione di template in vigore al momento della creazione** (congelata), agganciata a un progetto specifico, con proprio stato/avanzamento/team/prezzo (personalizzabile rispetto al template di origine)
- **MicroVoceProgetto (istanza)** — quello che utente/cliente vedono e su cui si lavora. Generata da una RigaDistinta al momento della creazione del progetto: eredita nome/ore/procedura dall'**Articolo** (in versione congelata), poi vive di vita propria con ore consuntivate, stato, risorsa assegnata, documenti collegati, causa di ritardo/blocco
- **ProceduraTemplate** — la sequenza di passaggi guidati standard associata a un **Articolo** (non più al modulo): appartiene al "pezzo" riutilizzabile, così viaggia con lui ovunque venga richiamato. Fa parte del template versionato, quindi eredita lo stesso comportamento di congelamento del §11
- **Passaggio (step)** — singolo elemento della procedura: `titolo`, `tipo` (`info` | `documento` | `form` | `verifica`), `chi` (`operatore` | `cliente`), `ordine` (posizione, riordinabile), `descrizione`, `campi_form` (solo se tipo=form), `stato` (`pending` | `done`), riferimento al documento caricato (solo se tipo=documento). Esiste sia a livello di template (passaggi standard dell'articolo) sia di istanza (passaggi effettivi di quella micro-voce in quel progetto, personalizzabili senza toccare il template)
- **Risorsa/Collaboratore** — utente interno o esterno, ruolo, colore/avatar, elenco progetti/micro-voci a cui ha accesso
- **Documento** — file, tipo (template vuoto / compilato / firmato), micro-voce di riferimento, versione
- **Preventivo** — bozza collegata a un cliente, righe = moduli selezionati, stato (bozza/inviato/accettato/rifiutato)
- **Engagement letter** — generata da un preventivo accettato, importi, stato firma, link firma digitale
- **Fattura** — testata: cliente/progetto, numero, data, stato (bozza/emessa/incassata)
- **FatturaRiga** — riga di dettaglio: può riferirsi a un **modulo intero**, a una **% di avanzamento parziale di un modulo**, oppure a una **milestone libera** scollegata dai moduli (es. "acconto alla firma", "saldo a consegna") — vedi §12
- **EventoCalendario** — collaboratore, progetto (opzionale), data/ora, tipo
- **Notifica** — destinatario (cliente o collaboratore), canale (email), oggetto, stato lettura

Questo è già lo scheletro dello schema DB (relazionale: Postgres è una scelta naturale data la struttura fortemente gerarchica Tenant → Progetto → Modulo → Micro-voce → Documento, più i grafi di dipendenza).

---

## 3bis. Modello a distinta base (BOM) per gli articoli

Anziché scrivere le micro-voci "a mano" dentro ogni modulo, la libreria si organizza in due livelli, sul modello articolo/distinta base tipico dei sistemi di produzione:

- **Articolo** = il micro-processo riutilizzabile, definito una sola volta, indipendente dal modulo in cui verrà usato — es. *"Raccolta documentazione KYC"*, *"Apertura conto corrente singolo"*, *"Redazione NDA"*. Ogni articolo porta con sé la propria procedura guidata di default (§6bis).
- **Modulo (distinta base)** = un elenco ordinato di **righe di distinta**, ciascuna delle quali richiama un articolo con una quantità e, se serve, un override locale di ore/prezzo.

**Esempio concreto sul caso di studio:** l'articolo *"Apertura conto corrente singolo"* può comparire:
- nel modulo *Apertura conti correnti*, richiamato con quantità 2 (una per società) — al posto delle due micro-voci scritte a mano "Apertura conto soc. 1" e "Apertura conto soc. 2" che avevamo nel caso di studio del §5;
- eventualmente anche in un futuro modulo *Cambio banca* o *Espansione operativa*, senza doverlo ridefinire da zero.

Se cambia un requisito dell'articolo (es. la normativa KYC richiede un documento aggiuntivo), si aggiorna **una sola volta** l'articolo — creando una nuova versione — e tutti i moduli che lo richiamano possono adottarla alla prossima pubblicazione della propria distinta, senza toccare ogni modulo singolarmente.

**Prezzo del modulo:** per default è la **somma dei prezzi delle righe di distinta** (`articolo.prezzo_default` oppure `override_prezzo` della riga, moltiplicato per `quantita`) — così il prezzo riflette sempre davvero cosa contiene il modulo, e se aggiungi/rimuovi un articolo dalla distinta il prezzo si aggiorna da solo. Resta però possibile impostare un **prezzo pacchetto** a livello di modulo (`prezzo_pacchetto`) che sovrascrive la somma — utile per sconti commerciali su un pacchetto venduto come blocco unico, senza dover alterare i prezzi dei singoli articoli (che restano corretti per quando vengono usati altrove).

**Cosa NON cambia rispetto alle decisioni già prese:**
- Il **congelamento delle versioni** (§11) si applica anche qui, ma su due livelli: ogni riga di distinta pinna la versione dell'articolo in vigore quando il modulo è stato pubblicato; il modulo istanziato in un progetto pinna a sua volta la versione del modulo. Un progetto avviato non cambia comportamento se in libreria aggiorni l'articolo o il modulo.
- Le **dipendenze** (§7ter) restano a livello di modulo, non di articolo — un articolo può comparire in più moduli con "storie" di dipendenza diverse, quindi modellare la dipendenza sul modulo (il contesto d'uso) resta più semplice e sufficiente per ora.
- L'utente finale continua a vedere e cliccare **micro-voci** dentro un modulo, esattamente come nel prototipo: il livello "articolo/distinta base" è un dettaglio di come la libreria è organizzata dietro le quinte, non un nuovo concetto con cui il consulente deve interagire ogni giorno (a meno che non stia proprio curando la libreria).

---

## 4. Il processo end-to-end — panoramica delle fasi

```
FASE 0  Pre-progetto        →  contatto cliente, preventivo, engagement letter
FASE 1  Setup progetto      →  wizard: selezione moduli, parametrizzazione, creazione istanze
FASE 2  Esecuzione          →  team lavora sulle micro-voci, consuntiva ore, carica documenti
FASE 3  Monitoraggio        →  dashboard, % avanzamento, rilevazione automatica ritardi
FASE 4  Comunicazione       →  notifiche cliente/team, firma digitale, portale cliente
FASE 5  Fatturazione        →  stato pagamento per modulo, valore vs fatturato
FASE 6  Chiusura            →  progetto completato, archiviazione, storicizzazione per il cliente
```

Ora percorriamo queste fasi applicate al caso concreto.

---

## 5. Caso di studio: trasferimento/costituzione di una struttura societaria internazionale

**Cliente:** Marco Ricci, persona fisica, patrimonio familiare da riorganizzare spostando l'operatività in una giurisdizione più efficiente (Malta) mantenendo la protezione patrimoniale per la famiglia.

### FASE 0 — Pre-progetto

1. **Incontro iniziale.** L'advisor raccoglie a mano libera situazione attuale del cliente, obiettivi (efficienza fiscale, protezione patrimoniale, eventuale passaggio generazionale), asset coinvolti, giurisdizioni di interesse.
   → *Nel sistema:* si crea la scheda **Cliente** (se non esiste) e si registra un progetto in stato `pre_project`, con un solo modulo iniziale attivo: *Analisi patrimoniale iniziale*.

2. **Preventivo per l'analisi canonica.** Prima di impegnarsi su tutto il progetto, si preventiva solo la fase di analisi (es. 12h, € 3.500). Il cliente accetta questo primo step "a rischio basso".

3. **Esecuzione dell'analisi patrimoniale.** Le micro-voci del modulo *Analisi patrimoniale iniziale* vengono lavorate una a una: raccolta documentazione, analisi struttura esistente, redazione report, presentazione al cliente. Ogni micro-voce viene consuntivata in ore reali.

4. **Preventivo del progetto completo.** Sulla base di quanto emerso, l'advisor compone (nel **wizard "Nuovo progetto"**) la struttura completa selezionando dalla libreria moduli:
   - Corporate structuring Malta (40h · € 12.000)
   - Holding internazionale — se serve una capogruppo separata
   - Struttura Trust (30h · € 8.500) — per la protezione del patrimonio familiare
   - Apertura conti correnti (20h · € 4.500)
   - Contratti intra-societari (25h · € 6.000)
   - Tax planning internazionale (18h · € 5.500)

   Il sistema somma automaticamente ore e importi (regola di calcolo, vedi §7) e mostra il riepilogo prima della conferma.

5. **Accettazione ed engagement letter.** Alla conferma del wizard, il sistema genera automaticamente un'**engagement letter** con l'elenco dei moduli, gli importi e le condizioni. Il documento viene inviato al cliente via email con link per la **firma digitale**. Solo dopo la firma il progetto passa a `in_progress`.

### FASE 1 — Setup del progetto

Alla creazione, ogni modulo selezionato viene **istanziato** dal template di libreria: le sue micro-voci vengono copiate con le ore preventivate standard (modificabili caso per caso), e ogni micro-voce riceve:
- una risorsa assegnata (o "da assegnare"),
- una cartella documentale (dove poi finiranno moduli da compilare / documenti firmati),
- uno stato iniziale `pending`.

Il team viene composto assegnando i collaboratori ai moduli (es. il legale sul modulo Trust e Contratti, il fiscalista sul Tax planning); i collaboratori esterni vengono invitati via email e ricevono accesso limitato al modulo/micro-voce assegnata.

### FASE 2 — Esecuzione

Il lavoro procede in parallelo sui moduli. Esempio realistico (coerente col prototipo):

- **Corporate structuring Malta** avanza regolarmente: le società vengono costituite, ma la micro-voce *"Contratto di servizio intercompany"* è in corso con solo metà delle ore consuntivate rispetto al preventivo.
- **Struttura Trust** si blocca: la micro-voce *"Redazione deed of trust"* è in stato `delayed` perché lo studio è **in attesa di documentazione dal trustee designato** — un ritardo causato da un fattore esterno, non dal team.
- **Apertura conti correnti** peggio ancora: lo stato del modulo è `blocked` perché il **KYC è stato respinto dalla banca**, con nota esplicita del motivo e necessità di documentazione integrativa urgente.
- **Tax planning** è ancora `pending`, e questa volta **non per pigrizia dello scheduling ma perché il sistema lo blocca esplicitamente**: nella libreria del tenant, il modulo *Tax planning internazionale* ha una dipendenza dichiarata da *Corporate structuring* (§7bis). Finché quest'ultimo non raggiunge lo stato `completed`, le micro-voci di Tax planning restano in uno stato `pending · in attesa di dipendenza`, non assegnabili né avviabili, e questo è visibile in UI con un'indicazione esplicita ("bloccato da: Corporate structuring Malta") invece di apparire come una semplice priorità non ancora presa in carico.

Ogni collaboratore, mentre lavora, **consuntiva le ore** sulla propria micro-voce e può caricare documenti a supporto (es. dossier KYC, bozza contratto). Il documento può essere: template vuoto da compilare, form compilato, oppure documento firmato dal cliente.

### FASE 3 — Monitoraggio in tempo reale

Ogni micro-voce, modulo e progetto ha una **% di avanzamento calcolata**, non inserita a mano (vedi regola in §7). La dashboard aggrega su tutti i progetti:
- progetti attivi vs totali,
- valore di portafoglio vs fatturato,
- avanzamento medio,
- numero di ritardi attivi.

Quando una micro-voce entra in stato `delayed` o `blocked`, il sistema:
1. marca in rosso/ambra il modulo e il progetto coinvolti,
2. registra **la causa del ritardo** in un campo testuale dedicato (obbligatorio quando lo stato cambia a delayed/blocked — oggi nel mockup è un dato statico, va reso un campo che il collaboratore compila),
3. genera un **alert** visibile in dashboard con: progetto → modulo → causa,
4. innesca le **notifiche** (vedi Fase 4).

Questo distinguo — ritardo interno (poche ore lavorate rispetto al preventivo) vs blocco esterno (KYC respinto, attesa terzi) — è concettualmente diverso e va modellato con due segnali separati: uno **quantitativo** (ore consuntivate vs preventivate, calcolato dal sistema) e uno **qualitativo** (nota di blocco, inserita manualmente dal collaboratore).

### FASE 4 — Comunicazione e portale cliente

- Alla generazione dell'engagement letter → email al cliente con link di firma.
- Quando un modulo cambia stato in modo rilevante (completato, o entra in ritardo/blocco) → notifica al team assegnato **e** al cliente (con linguaggio diverso: al cliente si comunica in modo sintetico e non tecnico, es. *"Apertura conti correnti: in attesa di documentazione aggiuntiva richiesta dalla banca"*, senza esporre dettagli interni).
- Il cliente accede a un **portale** dove vede: stato di avanzamento dei moduli, documenti da firmare (con link), documenti già scambiati. Non vede le ore consuntivate né i dettagli interni del team.
- Tutti i collaboratori (interni ed esterni con accesso) vedono un **calendario condiviso** con gli impegni già pianificati sul progetto, per evitare sovrapposizioni e pianificare appuntamenti (es. call con la banca, firma dal notaio).

### FASE 5 — Fatturazione

Ogni modulo ha un proprio importo e può essere fatturato indipendentemente dagli altri (es. si fattura *Analisi patrimoniale* appena completata, mentre *Struttura Trust* è ancora in corso). Il sistema tiene: valore totale progetto, fatturato, differenza da fatturare — con vista breakdown per modulo (stato, valore, % avanzamento).

### FASE 6 — Chiusura

Un progetto passa a `completed` quando tutti i moduli sono `completed`. A quel punto: si archivia il progetto (resta visibile in sola lettura nello storico cliente), tutti i documenti restano associati alla scheda cliente per riferimenti futuri (es. un nuovo progetto per lo stesso cliente potrà attingere alla stessa anagrafica e agli stessi documenti KYC già raccolti).

---

## 6. Macchine a stati

**Micro-voce:** `pending → active → done`, con deviazione possibile in qualunque momento verso `delayed` (ore sforate o causa esterna temporanea) o `blocked` (impedimento che ferma il lavoro finché non risolto). Da `delayed`/`blocked` si torna ad `active` quando il motivo del blocco è rimosso.

**Modulo:** stato derivato dall'insieme delle sue micro-voci — `pending` se tutte pending, `in_progress` se almeno una è active/done, `completed` se tutte done, `delayed`/`blocked` se almeno una micro-voce lo è (il modulo eredita lo stato più critico).

**Progetto:** `pre_project` (solo modulo di analisi iniziale attivo, preventivo non ancora accettato per il resto) → `in_progress` (engagement letter firmata) → `completed`.

---

## 6bis. Procedura guidata per micro-voce

Questa è la funzionalità che rende operativa la raccolta documenti/dati dal cliente, non solo la "cartella documenti" generica già prevista nel modello originario. Ogni micro-voce, quando viene aperta, mostra al collaboratore (e in forma ridotta al cliente) una **sequenza di passaggi guidati**, non un semplice elenco di allegati.

**Tipi di passaggio:**

| Tipo | Chi lo vede/agisce | Comportamento |
|---|---|---|
| `info` | Solo operatore | Passaggio informativo/di preparazione interna, nessuna azione richiesta al cliente |
| `documento` | Cliente | Il cliente carica un file specifico richiesto dall'operatore (es. "copia passaporto"); lo stato passa a `done` automaticamente al caricamento |
| `form` | Cliente | Il cliente compila dei campi testuali definiti dall'operatore (es. "recapito preferito", "codice fiscale") e li invia; lo stato passa a `done` all'invio |
| `verifica` | Solo operatore | Checkpoint interno di validazione prima di considerare la micro-voce conclusa (non visibile al cliente) |

**Personalizzazione:** ogni micro-voce parte da una procedura standard ereditata dal template (§3), ma l'operatore può in qualsiasi momento **aggiungere, rimuovere o riordinare** i passaggi per il caso specifico — senza alterare il template, che resta la base per i prossimi progetti. Questo è coerente con la logica di versionamento congelato già decisa (§11): il template è lo standard, l'istanza è personalizzabile.

**Vista cliente vs vista operatore:** il cliente, nel portale, vede **solo i passaggi di tipo `documento` e `form`** — nella sequenza corretta, con indicazione chiara di cosa deve fare (etichetta del documento richiesto, oppure i campi del form). Non vede mai i passaggi `info`/`verifica`, che restano interni al team. Questo evita di esporre al cliente il "dietro le quinte" operativo, mostrandogli solo ciò che deve effettivamente fare.

**Notifiche collegate:** quando una micro-voce ha un passaggio `documento`/`form` ancora `pending` assegnato al cliente, il sistema può inviare un promemoria email con link diretto al passaggio nel portale (riusa il meccanismo di notifica già previsto in Fase 4, §5).

---

## 7. Regole di calcolo (da implementare come logica di dominio, non come dato statico)

- **% avanzamento micro-voce:** binaria oggi (0% pending, 100% done) — si può raffinare come `min(100, ore_consuntivate / ore_preventivate * 100)` ma limitata a 100 finché lo stato non è `done`, per evitare che un semplice sforamento ore mostri "completato" prima del tempo.
- **% avanzamento modulo:** media pesata sulle ore preventivate delle sue micro-voci, non media semplice (una micro-voce da 10h pesa più di una da 1h).
- **% avanzamento progetto:** media pesata sulle ore preventivate dei suoi moduli.
- **Valore modulo:** `prezzo_pacchetto` se impostato in libreria, altrimenti somma delle righe di distinta (`articolo.prezzo_default` o `override_prezzo` × `quantita`) — vedi §3bis. Alla creazione del progetto questo valore viene congelato in `modulo_progetto.prezzo` e resta negoziabile per singolo cliente senza toccare la libreria.
- **Valore progetto:** somma dei prezzi dei moduli istanziati (non dei template, perché un prezzo può essere negoziato/parametrizzato per singolo cliente).

### 7bis. Ritardo/blocco — doppio innesco (automatico + manuale)

Il ritardo non è mai un solo segnale, ne servono due che convivono — e qui correggo un'imprecisione delle versioni precedenti di questo documento, dove `at_risk` compariva come se fosse uno stato alla pari di `delayed`/`blocked`: non lo è, e trattarlo come tale avrebbe creato ambiguità nel motore di stati (§16).

1. **Innesco automatico → segnale, non stato.** Una micro-voce `active` con `ore_consuntivate > ore_preventivate` e ancora non `done` espone un flag calcolato `segnale_rischio=true` (con `ore_extra` = quante ore in più). Non è un valore dello stato principale (`stato` resta `active`): è un'informazione aggiuntiva che si accende e spegne da sola man mano che le ore consuntivate cambiano, senza bisogno che nessuno la dichiari o la rimuova manualmente.
2. **Innesco manuale → stato vero e proprio.** In qualsiasi momento un collaboratore può marcare la propria micro-voce come `delayed` (rallentata, ma proseguibile) o `blocked` (ferma, non proseguibile) **inserendo obbligatoriamente una nota di causa** (es. "KYC respinto dalla banca", "in attesa documentazione trustee"). Questo è un cambio di `stato` vero, persistito, non un flag calcolato.

I due segnali restano indipendenti e possono coesistere: una micro-voce `blocked` può avere anche `segnale_rischio=true` se, oltre al blocco esterno dichiarato, le ore consuntivate hanno già superato il preventivo. In UI lo stato principale (`blocked`/`delayed`) domina visivamente, ma il flag di rischio resta visibile come indicatore secondario — servono a reportistica diversa: il flag automatico misura l'efficienza di stima interna, lo stato manuale comunica al cliente e attiva il team.

### 7ter. Grafo di dipendenze tra moduli

Le dipendenze si dichiarano **a livello di template** (nella libreria del tenant), non a livello di singolo progetto — così ogni volta che un advisor compone un progetto nel wizard, il sistema sa già che, ad esempio, *Tax planning* dipende da *Corporate structuring*.

Regole pratiche:
- È un **grafo diretto aciclico (DAG)**: alla creazione/modifica di una dipendenza il sistema verifica che non si generino cicli (A dipende da B che dipende da A).
- Una dipendenza si esprime a livello di **modulo intero** (non di singola micro-voce), per restare gestibile: "il modulo X non può avviarsi finché il modulo Y non è `completed`".
- Nel **wizard di creazione progetto**, se l'advisor seleziona un modulo con dipendenze e non seleziona anche il modulo da cui dipende, il sistema avvisa (non blocca necessariamente: può essere una dipendenza già soddisfatta da un progetto precedente dello stesso cliente).
- A runtime, un modulo con dipendenze non soddisfatte resta bloccato in uno stato dedicato (non "in attesa" generico, ma "in attesa di: [nome modulo]"), per non confondere questo blocco strutturale con un ritardo operativo (§7bis).

---

## 8. Requisiti funzionali per area applicativa

| Area | Funzioni chiave |
|---|---|
| **Dashboard** | KPI (progetti attivi, valore portafoglio, avanzamento medio, ritardi), banner alert ritardi, lista progetti con barra avanzamento |
| **Progetti** | Wizard creazione (cliente → selezione moduli → riepilogo/engagement letter), vista dettaglio a tab (Moduli & Attività, Team, Documenti, Fatturazione), procedura guidata per micro-voce con passaggi personalizzabili e riordinabili |
| **Clienti** | Anagrafica, storico progetti, documenti collegati (CRM minimo) |
| **Calendario** | Vista condivisa impegni team, creazione appuntamenti legati o meno a un progetto |
| **Libreria moduli** | Gestione **articoli** (micro-processi riutilizzabili, con la propria procedura guidata) e **distinte base** (moduli come elenchi ordinati di articoli richiamati, con quantità e override locali) — vedi §3bis |
| **Impostazioni** | Utenti, ruoli, permessi granulari (progetto/modulo/micro-voce), invito collaboratori esterni |
| **Portale cliente** | Vista sola-lettura avanzamento, documenti da firmare (link), documenti scambiati, notifiche email, **passaggi guidati da completare** (upload documento o compilazione form) con promemoria automatico se rimangono pending |

---

## 9. Permessi — matrice di scope

| Ruolo | Progetto intero | Modulo assegnato | Micro-voce assegnata | Dati economici |
|---|---|---|---|---|
| Advisor/owner | ✅ | ✅ | ✅ | ✅ |
| Collaboratore interno | 👁️ lettura | ✅ scrittura se assegnato | ✅ scrittura | ✅ se abilitato |
| Collaboratore esterno invitato | ❌ | 👁️/✅ solo se invitato | ✅ solo se assegnato | ❌ |
| Cliente | 👁️ solo il proprio, vista semplificata | 👁️ solo % e documenti | ❌ | ❌ |

---

## 10. Architettura tecnica di massima (per lo sviluppo)

- **Frontend:** l'attuale prototipo HTML/vanilla JS può restare la base per un rifacimento in un framework component-based (React) mantenendo la stessa struttura di viste (Dashboard, Progetti, Dettaglio progetto a tab, Wizard modale, Portale cliente separato con auth propria).
- **Backend:** API REST (o GraphQL se preferisci query annidate Progetto→Modulo→Micro-voce in una chiamata) con logica di calcolo (§7) centralizzata lato server, mai ricalcolata solo lato client.
- **Database:** relazionale (PostgreSQL), schema gerarchico Tenant → Cliente → Progetto → Modulo (istanza) → Micro-voce (istanza) → Documento/Ore/Passaggio, più le tabelle di libreria (Articolo, distinta base) referenziate ma non vincolanti dopo l'istanziazione — vedi §3bis, §14.
- **Notifiche:** servizio email transazionale (es. Postmark/SendGrid) con webhook di conferma lettura/firma.
- **Firma digitale:** integrazione con provider terzo (es. Namirial, DocuSign, o soluzione EU-compliant per validità legale in Malta/Italia).
- **Storage documenti:** bucket con versioning (S3-compatibile), riferimenti per micro-voce.
- **Autenticazione:** ruoli distinti per staff interno vs portale cliente (due superfici, stesso backend).

---

## 11. Decisioni architetturali prese

| Tema | Decisione | Impatto sul modello |
|---|---|---|
| **Multi-tenant** | Sì, con un Super Admin trasversale che supervisiona tutti i tenant da una dashboard dedicata | `tenant_id` su ogni entità (§2bis); Super Admin fuori dal perimetro tenant |
| **Dipendenze tra moduli** | Sì, modellate come grafo diretto aciclico a livello di template | Nuova entità ModuloDipendenza; stato "in attesa di dipendenza" distinto dal ritardo operativo (§7ter) |
| **Innesco ritardo/blocco** | Entrambi: automatico su ore sforate + manuale su causa esterna dichiarata | `segnale_rischio` calcolato (flag, non stato) + stati `delayed`/`blocked` con nota obbligatoria, cumulabili (§7bis, dettaglio motore in §16) |
| **Versionamento template** | Congelato a due livelli: l'articolo pinnato dalla riga di distinta, il modulo pinnato dal progetto istanziato — i progetti già avviati non cambiano se la libreria viene aggiornata | `articolo.versione` pinnata in `riga_distinta`; `modulo_template.versione` pinnata in `modulo_progetto` (§3bis, §14) |
| **Fatturazione** | Ibrida: sia per stato avanzamento parziale di un modulo, sia per milestone libere indipendenti dai moduli | FatturaRiga può riferirsi a modulo intero, a % di un modulo, oppure a nessun modulo (milestone libera) — vedi §12 |
| **Modello di libreria** | A distinta base (BOM): Articoli riutilizzabili richiamati da più Moduli tramite Righe di distinta, invece di micro-voci scritte una volta per modulo | Nuove entità Articolo, RigaDistinta; la procedura guidata si sposta dall'appartenere al modulo all'appartenere all'articolo (§3bis) |

## 12. Fatturazione flessibile — dettaglio

La fatturazione **non è vincolata 1:1 ai moduli**. Una FatturaRiga può essere di tre tipi:

1. **A modulo completato** — es. "Analisi patrimoniale iniziale — € 3.500" quando il modulo passa a `completed`.
2. **A percentuale di un modulo (fatturazione parziale)** — es. "Corporate structuring Malta — acconto 50% — € 6.000" quando il modulo è al 50% di avanzamento, anche se non ancora concluso. Il sistema deve tracciare, per ogni modulo, **quanto è già stato fatturato** (in valore, non solo in %) per evitare doppie fatturazioni sullo stesso modulo.
3. **Milestone libera, indipendente dai moduli** — es. "Acconto alla firma dell'engagement letter — € 5.000" o "Saldo finale progetto — € 2.000": non referenzia nessun modulo specifico, ma solo il Progetto. Utile per condizioni contrattuali che non seguono l'avanzamento operativo (es. anticipo richiesto prima di iniziare qualunque lavoro).

Questo significa che il totale "da fatturare" del progetto (già presente nel mockup come vista) va calcolato come:
`valore_progetto − Σ(fatture emesse su moduli) − Σ(fatture emesse su milestone libere)`
e non più come semplice differenza valore/fatturato aggregato — perché ora possono coesistere logiche diverse sullo stesso progetto.

---

## 13. Roadmap di sviluppo proposta

Il multi-tenant non è più rimandabile a una fase successiva: essendo strutturale (`tenant_id` su ogni tabella), va nel MVP. Lo stesso vale ormai per il **grafo di dipendenze tra moduli**: dalla §15.3 in poi (istanziazione del progetto) e nel motore di stati (§16.5), la risoluzione delle dipendenze è parte del flusso base, non un'aggiunta successiva — un progetto con moduli dipendenti non funzionerebbe correttamente senza.

**MVP (v1):**
Multi-tenant di base (Tenant, Utente con ruoli incl. Super Admin) → Cliente → **libreria a distinta base** (Articoli riutilizzabili + Moduli come elenchi di righe di distinta, §3bis) → **grafo di dipendenze tra moduli** (§7ter) → Preventivo → Engagement letter → Progetto con moduli/micro-voci versionate → procedura guidata per micro-voce (passaggi info/documento/form/verifica, personalizzabile, vista operatore e vista cliente) → consuntivazione ore → doppio innesco ritardo (automatico + manuale) → dashboard tenant con % avanzamento e alert → dashboard Super Admin di base (elenco tenant, KPI aggregati) → notifiche email base (incluso promemoria su passaggi pending).

**V2:**
Interfaccia di gestione della libreria da UI (oggi la struttura dati esiste già in MVP, ma creare/modificare articoli e distinte via interfaccia grafica — non solo via script/seed — arriva qui), portale cliente con firma digitale integrata, fatturazione ibrida (parziale + milestone libere), calendario condiviso.

**V3:**
Permessi granulari fini per collaboratori esterni (l'interfaccia di gestione — il controllo di scope minimo è già in ogni endpoint da MVP, §15.1), reportistica avanzata (marginalità per modulo/collaboratore/articolo, per tenant), eventuale marketplace di template condivisi tra tenant.

---

## 14. Schema database proposto

Schema relazionale (PostgreSQL), con `tenant_id` su ogni tabella tranne `tenant` e `user` quando `role = super_admin`.

```
tenant
  id, ragione_sociale, piano, stato, created_at

user
  id, tenant_id (nullable se super_admin), nome, email, ruolo,
  stato [attivo|invitato|disattivato]
  [ruolo: super_admin | advisor | collaboratore_interno | collaboratore_esterno | cliente]

cliente
  id, tenant_id, nome, tipo [individual|company], referenti_json, created_at

modulo_template          -- distinta base (header): prezzo/ore normalmente derivati dalla somma delle righe,
  id, tenant_id, nome, categoria, versione,           con possibilità di override a "prezzo pacchetto"
  prezzo_pacchetto (nullable),          -- se valorizzato, sovrascrive la somma delle righe di distinta (sconto commerciale)
  is_ultima_versione, created_at

articolo                 -- il "pezzo" riutilizzabile (micro-processo standalone)
  id, tenant_id, nome, categoria, versione, ore_default, prezzo_default,
  is_ultima_versione, created_at

riga_distinta             -- collega un modulo_template a un articolo (la distinta base vera e propria)
  id, tenant_id, modulo_template_id,
  articolo_id, articolo_versione,     -- pinned alla pubblicazione della distinta
  ordine, quantita (default 1),
  override_ore (nullable), override_prezzo (nullable), obbligatorio (bool, default true)

passaggio_template
  id, articolo_id, titolo, tipo [info|documento|form|verifica],
  chi [operatore|cliente], ordine, descrizione, campi_form_json (nullable)

modulo_dipendenza_template
  id, tenant_id, modulo_template_id, dipende_da_modulo_template_id
  -- verifica anti-ciclo applicata a livello applicativo alla scrittura; resta a livello di modulo, non di articolo (§3bis)

preventivo
  id, tenant_id, cliente_id, stato [bozza|inviato|accettato|rifiutato],
  righe_json, valore_totale, created_at

engagement_letter
  id, tenant_id, preventivo_id, stato_firma, link_firma, firmato_at

progetto
  id, tenant_id, cliente_id, nome, stato [pre_project|in_progress|completed],
  data_inizio, data_scadenza, valore_totale, created_at

modulo_progetto
  id, tenant_id, progetto_id,
  modulo_template_id, modulo_template_versione   -- congelati alla creazione
  nome, categoria, prezzo, ore_preventivate, ore_consuntivate,
  stato [pending|attesa_dipendenza|in_progress|delayed|blocked|done]
  -- calcolato da calcolaStatoModulo (§16.2), mai scritto manualmente salvo eccezioni esplicite (§16.6)

microvoce_progetto
  id, tenant_id, modulo_progetto_id,
  articolo_id, articolo_versione,     -- congelati alla creazione del progetto, ereditati dalla riga di distinta
  riga_distinta_id,                   -- traccia da quale riga della distinta è stata generata (utile con quantità > 1)
  nome, ore_preventivate, ore_consuntivate,   -- nome denormalizzato da articolo.nome per comodità di query
  stato [pending|attesa_dipendenza|active|delayed|blocked|done],
  segnale_rischio (bool, default false), ore_extra (int, default 0),   -- calcolati dal motore stati, §16 — non fanno parte dello stato principale
  causa_nota, risorsa_id (FK user), ordine

passaggio_progetto
  id, tenant_id, microvoce_progetto_id,
  titolo, tipo [info|documento|form|verifica], chi [operatore|cliente],
  ordine, descrizione, campi_form_json (nullable),
  stato [pending|done], documento_id (FK documento, nullable), risposte_form_json (nullable)
  -- creata per copia dal passaggio_template all'istanziazione della micro-voce (stesso principio di congelamento)
  -- ordine modificabile liberamente per questa istanza, senza toccare il template

modulo_progetto_dipendenza     -- copia congelata delle dipendenze del template al momento dell'istanziazione
  id, tenant_id, modulo_progetto_id, dipende_da_modulo_progetto_id

documento
  id, tenant_id, microvoce_progetto_id, tipo [template_vuoto|compilato|firmato],
  file_url, versione, caricato_da, created_at

fattura
  id, tenant_id, progetto_id, numero, data, stato [bozza|emessa|incassata]

fattura_riga
  id, tenant_id, fattura_id,
  tipo [modulo_completo|modulo_parziale|milestone_libera],
  modulo_progetto_id (nullable, null se milestone_libera),
  percentuale (nullable, usato se modulo_parziale),
  importo, descrizione

evento_calendario
  id, tenant_id, user_id, progetto_id (nullable), titolo, data_inizio, data_fine

accesso_risorsa
  id, tenant_id, user_id,
  tipo_risorsa [progetto|modulo|microvoce], risorsa_id,
  livello [lettura|scrittura], invitato_da (FK user), created_at

notifica
  id, tenant_id, destinatario_id, destinatario_tipo [user|cliente],
  canale [email], oggetto, corpo, stato_lettura, inviata_at
```

Note implementative chiave:
- **Row-Level Security su `tenant_id`** consigliata a livello DB (Postgres RLS), così un bug applicativo non può far trapelare dati tra tenant — il Super Admin bypassa la policy con un ruolo DB dedicato.
- Gli stati di `microvoce_progetto` distinguono esplicitamente `attesa_dipendenza` (blocco strutturale, §7ter) da `delayed`/`blocked` (dichiarazione manuale, §7bis) da `segnale_rischio` (flag calcolato, §7bis/§16): sono concettualmente diversi, e da qui in avanti non convivono più nello stesso campo enum.
- `modulo_progetto_dipendenza` copia le dipendenze del template al momento della creazione del progetto (coerente con il versionamento congelato del §11): se in futuro cambi le dipendenze in libreria, i progetti già avviati non cambiano comportamento a metà lavoro.
- `riga_distinta` pinna `articolo_versione`: se aggiorni un articolo (nuova versione), i moduli che lo richiamano non cambiano automaticamente — bisogna ripubblicare la distinta del modulo per adottare la nuova versione dell'articolo. Doppio congelamento, stesso principio del §11 applicato a un livello in più.

---

## 15. API — Fase 0-1 (pre-progetto → progetto attivo)

Il flusso che genera le prime scritture reali nel sistema, dal contatto col cliente al progetto avviato. Endpoint REST, contesto tenant sempre implicito nel token di autenticazione (mai passato manualmente dal client).

### 15.1 Regola di scope — da rispettare fin dal primo endpoint

Ogni endpoint sotto elenca, oltre all'input, **chi può chiamarlo**. Questo non è un dettaglio rimandabile: il controllo di scope (tenant + ruolo + eventuale assegnazione alla risorsa specifica) va scritto nel middleware/guard di ogni endpoint da subito, anche in versione minimale — la UI di gestione permessi granulari (§9) può arrivare dopo, il controllo sotto no.

### 15.2 Endpoint

```
POST   /clienti
  chi: advisor
  body: {nome, tipo[individual|company], referenti[]}
  → crea Cliente nel tenant corrente

GET    /clienti/:id
  chi: advisor, collaboratore con accesso a un progetto di quel cliente
  → anagrafica + storico progetti

POST   /progetti
  chi: advisor
  body: {cliente_id, nome}
  → crea Progetto in stato pre_project (nessun modulo ancora istanziato)

POST   /preventivi
  chi: advisor
  body: {cliente_id, progetto_id, righe: [{modulo_template_id, modulo_template_versione}]}
  → crea Preventivo in stato bozza; calcola valore_totale sommando
     prezzo_pacchetto o somma righe di distinta per ogni modulo (§7)

PATCH  /preventivi/:id
  chi: advisor, solo se stato=bozza
  body: {righe?}
  → ricalcola valore_totale

POST   /preventivi/:id/invia
  chi: advisor
  → stato→inviato; genera Notifica email al cliente con link portale

POST   /preventivi/:id/accetta
  chi: cliente (dal portale, sul proprio preventivo) oppure advisor per conto del cliente
  → stato→accettato; innesca la creazione dell'engagement letter (vedi sotto)
  → NON istanzia ancora i moduli: l'istanziazione avviene dopo la firma (vedi 15.3)

POST   /engagement-letters
  chi: sistema (triggerato da preventivo accettato, non chiamato manualmente)
  → genera documento con importi/condizioni dal preventivo; stato_firma=in_attesa

POST   /engagement-letters/:id/invia-per-firma
  chi: advisor (o automatico subito dopo la generazione)
  → chiama il servizio di firma digitale **dietro un'interfaccia astratta**
     (FirmaProvider.inviaPerFirma(documento)) — il provider concreto
     (Namirial/DocuSign/altro) si sceglie dopo senza toccare questo endpoint

POST   /engagement-letters/:id/webhook-firma      [chiamato dal provider esterno]
  chi: solo il provider (autenticazione via secret/signature del webhook)
  → firmato_at valorizzato; stato_firma→completata
  → innesca 15.3 (istanziazione moduli + attivazione progetto)

GET    /progetti/:id
  chi: advisor, collaboratore assegnato ad almeno un modulo del progetto, cliente (vista ridotta)
  → dettaglio con moduli/microvoci/stato aggregato (la vista cliente filtra
     ciò che non deve vedere, come da §9)
```

### 15.3 Cosa succede internamente alla firma dell'engagement letter

Questo è il passaggio più delicato del flusso, perché scrive gran parte del grafo di entità in un colpo solo — va isolato in un service/transazione unica, non sparso su più chiamate HTTP separate:

1. Progetto passa da `pre_project` a `in_progress`.
2. Per ogni riga del preventivo accettato: crea `modulo_progetto`, pinnando `modulo_template_versione` in vigore.
3. Per ogni `riga_distinta` di quel modulo: crea `microvoce_progetto` (una per unità di `quantita`), pinnando `articolo_versione`.
4. Per ogni `passaggio_template` dell'articolo pinnato: crea `passaggio_progetto` per copia (procedura guidata pronta all'uso, personalizzabile da subito).
5. Per ogni `modulo_dipendenza_template` coinvolta: crea `modulo_progetto_dipendenza`; i moduli con dipendenze non soddisfatte partono con le loro micro-voci in stato `attesa_dipendenza` invece che `pending` (§7ter).
6. Notifica email al cliente e al team con riepilogo del progetto avviato.

Se un passaggio di questa sequenza fallisce, l'intera operazione va annullata (transazione atomica) — un progetto "a metà istanziato" è uno stato incoerente da evitare a ogni costo.

---

## 16. Motore di calcolo stati

Questo è un modulo di dominio **puro** (funzioni che ricevono entità e restituiscono nuovi valori, nessuna chiamata diretta a DB/HTTP al suo interno): questo lo rende testabile in isolamento con unit test, e riutilizzabile sia da un endpoint API sia da un job schedulato, senza doverlo riscrivere. Il service layer (le API di §15 e quelle successive) lo chiama e persiste il risultato.

### 16.1 Funzioni sulla micro-voce

```
valutaSegnaleRischio(microvoce) → {segnale_rischio, ore_extra}
  segnale_rischio = microvoce.stato === 'active' AND microvoce.ore_consuntivate > microvoce.ore_preventivate
  ore_extra = max(0, microvoce.ore_consuntivate − microvoce.ore_preventivate)
  -- richiamata ad ogni consuntivazione ore (16.4)

calcolaPercentualeMicroVoce(microvoce) → number [0-100]
  se stato === 'done' → 100
  se stato in (pending, attesa_dipendenza) → 0
  altrimenti → min(99, ore_consuntivate / ore_preventivate × 100)
  -- il tetto a 99 (non 100) finché non è 'done' evita che una micro-voce
     mostri "completata" solo perché ha sforato le ore, senza che nessuno
     l'abbia effettivamente chiusa
```

### 16.2 Funzioni sul modulo (aggregazione dalle sue micro-voci)

```
calcolaStatoModulo(microvoci[]) → stato
  se una qualsiasi è 'blocked'          → 'blocked'
  altrimenti se una qualsiasi è 'delayed' → 'delayed'
  altrimenti se tutte sono 'done'         → 'done'
  altrimenti se tutte sono 'attesa_dipendenza' → 'attesa_dipendenza'
  altrimenti se almeno una è 'active' o 'done' → 'in_progress'
  altrimenti                                    → 'pending'
  -- il modulo eredita sempre lo stato più critico tra le sue micro-voci

calcolaPercentualeModulo(microvoci[]) → number
  = Σ(percentuale_i × ore_preventivate_i) / Σ(ore_preventivate_i)
  -- media pesata, non semplice: una micro-voce da 10h pesa più di una da 1h
```

### 16.3 Funzioni sul progetto

```
calcolaPercentualeProgetto(moduli[]) → number
  = Σ(percentuale_modulo_i × ore_preventivate_modulo_i) / Σ(ore_preventivate_modulo_i)

calcolaStatoProgetto(moduli[]) → stato
  se tutti i moduli sono 'done' → 'completed'
  altrimenti                     → 'in_progress'
  -- 'pre_project' è uno stato che precede l'istanziazione dei moduli (§15.3),
     non viene mai calcolato da questa funzione
```

### 16.4 Trigger — quando il motore viene invocato

```
registraConsuntivazione(microvoce_id, ore_aggiuntive, note?)
  1. microvoce.ore_consuntivate += ore_aggiuntive
  2. {segnale_rischio, ore_extra} = valutaSegnaleRischio(microvoce) → persisti
  3. ricalcola percentuale_modulo e stato_modulo del modulo padre → persisti
  4. se stato_modulo appena diventato 'done' → chiama risolviDipendenze(modulo_id) [16.5]
  5. ricalcola percentuale_progetto → persisti
  6. se segnale_rischio è appena passato da false a true → genera alert interno (dashboard),
     MAI notifica al cliente (il segnale di rischio è un'informazione operativa interna)

marcaRitardoManuale(microvoce_id, nuovo_stato[delayed|blocked], causa_nota)
  1. valida che causa_nota non sia vuota → altrimenti rifiuta la richiesta
  2. microvoce.stato = nuovo_stato; microvoce.causa_nota = causa_nota
  3. ricalcola stato_modulo (16.2) → persisti
  4. genera Notifica cliente (versione sintetica, es. "in attesa di documentazione dalla banca")
     E Notifica team (versione tecnica, con causa_nota completa)
  5. genera alert dashboard

risolviRitardoManuale(microvoce_id)
  1. microvoce.stato = 'active'; microvoce.causa_nota = null
     (valutare in V2 uno storico separato dei ritardi risolti, utile per reportistica —
      non necessario per l'MVP)
  2. ricalcola stato_modulo (16.2) → persisti
```

### 16.5 Risoluzione delle dipendenze — lo sblocco a cascata

```
risolviDipendenze(modulo_progetto_id_completato)
  1. trova tutte le modulo_progetto_dipendenza dove
     dipende_da_modulo_progetto_id = modulo_progetto_id_completato
  2. per ogni modulo dipendente trovato:
     a. verifica se TUTTE le sue dipendenze sono ora soddisfatte
        (ogni modulo da cui dipende ha stato = 'done')
     b. se sì: tutte le sue micro-voci in stato 'attesa_dipendenza' → 'pending'
        (pronte per essere prese in carico dal team)
     c. genera Notifica al team assegnato: "Modulo [nome] è ora sbloccato"
  -- funzione idempotente: richiamarla più volte sullo stesso modulo completato
     non produce effetti collaterali diversi dalla prima chiamata
```

### 16.6 Un punto da tenere a mente per l'implementazione

Le funzioni di aggregazione (16.2, 16.3) vanno ricalcolate **a cascata verso l'alto** ogni volta che cambia una micro-voce, ma **mai verso il basso**: cambiare manualmente lo stato di un modulo non deve mai riscrivere lo stato delle sue micro-voci (lo stato del modulo è sempre un derivato, non una fonte di verità). Se in futuro serve un'azione "forza completamento modulo" per un caso eccezionale, va trattata come eccezione esplicita e tracciata, non come scrittura silenziosa a cascata verso le micro-voci.

---

## 17. API — Fase 2-4 (esecuzione, procedura guidata, documenti)

Il flusso quotidiano una volta che il progetto è attivo: il team lavora sulle micro-voci, il cliente completa i passaggi che gli vengono richiesti. Tutti gli endpoint che scrivono stato passano dal motore di §16 — nessuna logica di calcolo duplicata qui.

### 17.1 Consuntivazione e stato micro-voce

```
POST   /microvoci/:id/consuntiva
  chi: risorsa assegnata alla micro-voce, advisor
  body: {ore, nota?}
  → chiama registraConsuntivazione (16.4)

POST   /microvoci/:id/ritardo
  chi: risorsa assegnata, advisor
  body: {stato[delayed|blocked], causa_nota}   -- causa_nota obbligatoria, validata server-side
  → chiama marcaRitardoManuale (16.4)

POST   /microvoci/:id/risolvi-ritardo
  chi: risorsa assegnata, advisor
  → chiama risolviRitardoManuale (16.4)

PATCH  /microvoci/:id/assegna
  chi: advisor
  body: {risorsa_id}
  → assegna/riassegna la risorsa responsabile

PATCH  /microvoci/:id/completa
  chi: risorsa assegnata, advisor
  → valida: TUTTI i passaggi_progetto della micro-voce hanno stato='done',
     altrimenti rifiuta con errore esplicito ("2 passaggi ancora da completare")
  → microvoce.stato = 'done'; ricalcola modulo/progetto (16.2/16.3)
  → se il modulo appena completato → risolviDipendenze (16.5)
```

Questa validazione in `/completa` è il punto in cui la procedura guidata (§6bis) e il motore di stati (§16) si toccano davvero: **una micro-voce non si può chiudere se il cliente non ha ancora caricato un documento o compilato un form richiesto**. Prima di questa API i due pezzi erano descritti separatamente nel documento; qui diventano una regola di business unica.

### 17.2 Procedura guidata (passaggi)

```
GET    /microvoci/:id/passaggi
  chi: operatore assegnato/advisor (tutti i passaggi), cliente (solo quelli con chi='cliente')
  → lista passaggi in ordine, con stato

POST   /passaggi/:id/upload
  chi: cliente (se passaggio.chi='cliente' e tipo='documento'), operatore per conto del cliente
  body: multipart file
  → crea Documento; passaggio.documento_id = documento.id; passaggio.stato='done'
  → Notifica interna al team: "documento ricevuto per [passaggio] su [micro-voce]"

POST   /passaggi/:id/submit-form
  chi: cliente (se passaggio.chi='cliente' e tipo='form')
  body: {risposte: {...}}
  → passaggio.risposte_form_json = risposte; passaggio.stato='done'
  → Notifica interna al team

POST   /passaggi/:id/marca-completato
  chi: operatore (solo per tipo='info'|'verifica', mai per passaggi del cliente)
  → passaggio.stato='done'

POST   /microvoci/:id/passaggi
  chi: operatore assegnato, advisor
  body: {titolo, tipo, chi, descrizione, campi_form?}
  → crea passaggio_progetto in coda (ordine = max+1) — personalizzazione a livello di
     istanza, il passaggio_template della libreria resta invariato (§3bis, §11)

DELETE /passaggi/:id
  chi: operatore assegnato, advisor
  → rimuove il passaggio dall'istanza (non tocca il template)

PATCH  /microvoci/:id/passaggi/riordina
  chi: operatore assegnato, advisor
  body: {ordine: [passaggio_id, ...]}   -- nuovo ordine completo
  → aggiorna il campo ordine di ciascun passaggio coinvolto
```

### 17.3 Documenti liberi e vista progetto

```
POST   /microvoci/:id/documenti
  chi: cliente, operatore
  body: multipart file
  → documento non legato a un passaggio specifico (cartella documentale libera,
     coerente con l'impostazione originaria del progetto)

GET    /progetti/:id/documenti
  chi: come da matrice permessi (§9)
  → tutti i documenti del progetto, raggruppati per modulo/micro-voce
```

### 17.4 Job schedulato — promemoria passaggi in sospeso

```
promemoriaPassaggiPending()   [job schedulato, es. giornaliero — non un endpoint HTTP]
  per ogni passaggio_progetto con stato='pending', chi='cliente',
      non aggiornato da più di N giorni (soglia configurabile per tenant):
    → genera Notifica email al cliente con link diretto al passaggio nel portale
  -- riusa lo stesso canale di notifica di §15, non un sistema separato
```

---

## 18. API — Fatturazione

Chiude il ciclo economico del progetto (§12). Nessuna logica di calcolo qui che non sia già stata definita altrove — solo scrittura/lettura coerente con la formula del residuo.

```
POST   /progetti/:id/fatture
  chi: advisor
  → crea Fattura in stato bozza per il progetto

POST   /fatture/:id/righe
  chi: advisor
  body: {tipo[modulo_completo|modulo_parziale|milestone_libera], modulo_progetto_id?, percentuale?, importo, descrizione}
  → valida prima di inserire:
     - modulo_completo: il modulo referenziato deve avere stato='done', altrimenti rifiuta
     - modulo_parziale: percentuale cumulata di questo modulo su tutte le fatture non-bozza
       non può superare 100% (evita doppia fatturazione sullo stesso modulo, §12)
     - milestone_libera: nessun vincolo di modulo, solo importo e descrizione libera

POST   /fatture/:id/emetti
  chi: advisor
  → stato bozza→emessa; assegna numero fattura progressivo per tenant

POST   /fatture/:id/incassa
  chi: advisor
  → stato emessa→incassata

GET    /progetti/:id/fatturazione
  chi: advisor, cliente (vista limitata a importi e stato, non a dettaglio interno)
  → residuo_da_fatturare = valore_progetto − Σ(importo di fattura_riga su fatture non bozza)  [formula §12]
     breakdown per modulo (fatturato/residuo) e per milestone libere
```

---

## 19. Permessi granulari

Il controllo minimo di scope (tenant + ruolo) è già richiesto in ogni endpoint da §15.1 in poi — questa sezione aggiunge il livello **per-risorsa**, necessario perché lo studio lavora con collaboratori esterni (notai, banche, trust company) che devono vedere *solo* il modulo o la micro-voce per cui sono stati invitati, non l'intero progetto del cliente.

```
accesso_risorsa                          -- nuova entità (§14)
  id, tenant_id, user_id,
  tipo_risorsa [progetto|modulo|microvoce], risorsa_id,
  livello [lettura|scrittura], invitato_da (FK user), created_at

POST   /progetti/:id/collaboratori
  chi: advisor
  body: {email, tipo_risorsa, risorsa_id, livello}
  → se l'email non corrisponde a un utente esistente, crea Utente (ruolo=collaboratore_esterno)
  → crea accesso_risorsa; invia email di invito con link diretto alla risorsa assegnata

DELETE /accessi/:id
  chi: advisor
  → revoca l'accesso (il collaboratore perde visibilità sulla risorsa, non viene eliminato come utente)

GET    /progetti/:id/accessi
  chi: advisor
  → elenco di chi ha accesso a cosa nel progetto, utile per audit
```

**Regola di verifica (usata da ogni endpoint, non solo da questi):** `checkScope(user, tipo_risorsa, risorsa_id, livello_richiesto)` — formalizza quello che in §15.1 era descritto solo a parole. Un collaboratore esterno con accesso a un modulo vede automaticamente tutte le micro-voci di quel modulo (lo scope è ereditato verso il basso nella gerarchia, mai verso l'alto).

---

## 20. Calendario

Additivo rispetto al nucleo: nuova entità debolmente collegata, nessun impatto su moduli/micro-voci/fatturazione.

```
POST   /eventi
  chi: advisor, collaboratore (per sé stesso o, se advisor, per altri)
  body: {titolo, data_inizio, data_fine, progetto_id?, partecipanti[]}
  → crea EventoCalendario; se legato a un progetto, notifica i partecipanti

GET    /eventi?da=&a=&user_id=
  chi: chiunque abbia accesso al calendario condiviso del tenant
  → vista filtrata per intervallo di date e/o singolo collaboratore

PATCH  /eventi/:id
  chi: creatore dell'evento, advisor

DELETE /eventi/:id
  chi: creatore dell'evento, advisor
```

**Nota di scope:** un evento legato a un `progetto_id` eredita la visibilità del progetto stesso (§9) — chi non ha accesso al progetto non vede il dettaglio dell'evento, al massimo lo slot come "occupato".

---

## 21. Dashboard Super Admin

L'ultima delle quattro per importanza operativa: conta davvero solo quando esiste più di un tenant sulla piattaforma. Endpoint riservati esclusivamente a `ruolo=super_admin` (bypass del filtro tenant, §2bis).

```
GET    /admin/tenants
  → elenco tenant con stato, piano, data attivazione, KPI di sintesi
     (n. progetti totali, valore di portafoglio, n. utenti attivi)

POST   /admin/tenants
  body: {ragione_sociale, piano}
  → crea nuovo Tenant + primo utente advisor (owner)

PATCH  /admin/tenants/:id
  body: {stato?, piano?}
  → sospende/riattiva un tenant, cambia piano

GET    /admin/tenants/:id/metriche
  → dettaglio KPI del singolo tenant

POST   /admin/tenants/:id/reset-owner-access
  → reset dell'accesso dell'owner (supporto tecnico), tracciato in log
```

---

## 22. Firma digitale — scelta del provider

Il documento prevedeva finora solo l'interfaccia astratta (`FirmaProvider.inviaPerFirma`, §15.2) senza indicare un provider concreto. Ecco il criterio di scelta e una raccomandazione.

**Livello di firma richiesto:** per un'engagement letter (accordo commerciale, non un atto notarile) è sufficiente la **Firma Elettronica Avanzata (AES)** secondo eIDAS — non serve la Firma Elettronica Qualificata (QES), che richiede verifica d'identità più pesante (video-identificazione o certificato su smart card) e costa di più per volume. La QES può diventare necessaria in futuro per documenti specifici (es. atti societari in certe giurisdizioni), ma non per il flusso base.

**Criteri per il provider:**
- conformità eIDAS (validità legale in tutta l'UE, quindi anche Malta e Italia);
- webhook affidabile per lo stato firma (necessario per l'endpoint `/engagement-letters/:id/webhook-firma`, §15.2);
- audit trail scaricabile (utile in caso di contestazione, specialmente su importi);
- pricing per volume, non per singolo utente (lo studio ha pochi operatori ma potenzialmente molte firme/mese).

**Raccomandazione:** partire con un provider europeo eIDAS-nativo (es. Namirial, o Yousign) piuttosto che una soluzione USA con solo "estensione" eIDAS — semplifica la conformità e riduce ambiguità legali per clienti UE. Trattandosi di una scelta commerciale (prezzi/piani cambiano nel tempo), verificare le condizioni attuali direttamente col fornitore prima di firmare un contratto — il dato che conta per lo sviluppo è che **l'interfaccia resta la stessa indipendentemente da chi si sceglie**, quindi questa decisione non blocca l'inizio dello sviluppo del resto del sistema.

---

## 23. Autenticazione e sessione

Ogni endpoint dei §15/§17/§18/§19/§20/§21 dava per scontato "un contesto utente/tenant già risolto" senza mai specificare come. Ecco lo schema completo, differenziato per tipo di utente perché le esigenze sono diverse.

```
Staff (advisor, collaboratore_interno, collaboratore_esterno)
  → email + password (hash con bcrypt o argon2, mai in chiaro)
  → JWT access token (durata 15 min) + refresh token (durata 30gg, rotante e revocabile)
  → claims nel token: {user_id, tenant_id, ruolo}
  → ogni richiesta API valida il token, estrae tenant_id e ruolo,
     li usa per il controllo di scope (§15.1) prima di eseguire qualsiasi query

Cliente (portale)
  → passwordless — nessuna password da gestire per un utente che accede sporadicamente
  → login "a magic link": stesso meccanismo già previsto per firma/upload (§15, §17.4) —
     il cliente riceve un'email con link a scadenza breve (15 min), che genera
     una sessione portale valida per la sessione di lavoro (non per sempre)
  → riduce sia l'attrito (nessuna password da ricordare) sia la superficie
     d'attacco (niente password del cliente da poter compromettere)

Super Admin
  → email + password + 2FA obbligatorio (TOTP) — l'accesso cross-tenant
     giustifica una soglia di sicurezza più alta rispetto allo staff normale
  → sessione più breve (es. 4h) rispetto allo staff
```

**Nota implementativa:** il `tenant_id` nel claim del JWT è ciò che permette al Row-Level Security di Postgres (§14) di funzionare senza che ogni query debba ricordarsi di filtrare manualmente — il token è la fonte di verità del contesto, non un parametro passato dal client.

---

## 24. Confronto prototipo ↔ documento

Ripercorrendo ogni schermata del prototipo HTML contro le sezioni di questo documento:

| Schermata prototipo | Copertura nel documento |
|---|---|
| Dashboard (KPI, alert ritardi) | ✅ §8 |
| Wizard creazione progetto | ✅ §15 |
| Tab "Moduli & Attività" | ✅ §16, §17.1 |
| Tab "Documenti" | ✅ §17.3 |
| Tab "Fatturazione" (valore/fatturato/da fatturare, breakdown per modulo) | ✅ §12, §18 |
| Libreria moduli (grafo dipendenze) | ✅ §3bis, §7ter |
| Procedura guidata (upload/form/riordino) | ✅ §6bis, §17.2 |
| **Tab "Team"** (per collaboratore: ore consuntivate, voci completate vs in corso) | ❌ gap trovato |
| Placeholder "Impostazioni" (utenti, permessi) | ❌ gap trovato — gestione utenti interni mai definita |

Due gap reali, non ipotetici — il prototipo mostra dati che il documento non genera ancora. Li chiudo qui:

```
GET    /progetti/:id/team
  chi: advisor, collaboratore con accesso al progetto
  → aggrega per ogni risorsa assegnata a un modulo/micro-voce del progetto:
     nome, ruolo, ore_consuntivate totali, n. micro-voci completate vs in corso/attesa
  -- stessa aggregazione mostrata dalla tab "Team" del prototipo

POST   /tenant/utenti
  chi: advisor
  body: {email, nome, ruolo[advisor|collaboratore_interno]}
  → invita un collaboratore interno (email con link di attivazione password)

GET    /tenant/utenti
  chi: advisor
  → elenco utenti dello studio con ruolo e stato (attivo/invitato/disattivato)

PATCH  /tenant/utenti/:id
  chi: advisor
  body: {ruolo?, stato?}
  → cambia ruolo o disattiva un utente (mai eliminazione fisica, per preservare
     lo storico di chi ha lavorato su cosa)
```

Nessun altro gap emerso dal confronto: le altre sette schermate hanno tutte una copertura diretta e verificabile in una sezione specifica.

---

## 25. Si può iniziare a scrivere codice?

Risposta onesta: **sì per il nucleo, con tre cose da tenere d'occhio in parallelo — non bloccanti, ma da non dimenticare prima del go-live.**

**Cosa è pronto per essere codificato subito:** schema DB (§14), motore di calcolo stati (§16), tutte le API (§15, §17, §18, §19, §20, §21), autenticazione (§23). Un informatico può iniziare da qui senza aspettare altro — è già più dettagliato di molte specifiche con cui si lavora nella pratica.

**Cosa resta da decidere, in parallelo allo sviluppo:**
1. **Protezione dati (GDPR).** Il sistema tratta documenti KYC, passaporti, dati finanziari e strutture patrimoniali di cittadini UE — è un profilo di rischio più alto della media. Prima del go-live (non prima di iniziare a scrivere codice) va deciso: hosting in region UE, crittografia dei documenti at-rest, policy di retention/cancellazione, e un Data Processing Agreement con ogni fornitore terzo (email transazionale, storage, firma digitale). Non blocca lo sviluppo, ma va integrato mentre si scrive, non aggiunto a posteriori.
2. **Stack tecnico concreto.** Il documento specifica Postgres e API REST (§10) ma non un linguaggio/framework backend specifico — è una scelta legittimamente lasciata all'informatico (o da concordare insieme se hai una preferenza), e non cambia nulla di quanto specificato qui.
3. **Infrastruttura e ambienti** (hosting, CI/CD, staging vs produzione) — decisioni operative del team di sviluppo, ortogonali al contenuto di questo documento.

Nessuno di questi tre è un prerequisito per iniziare a scrivere il codice del backend; sono cose da chiudere entro il go-live, non entro il primo commit.

---

## 26. Fatturazione elettronica (SDI)

Questo è il gap più serio trovato nella revisione: lo schema `fattura`/`fattura_riga` (§14) era generico, non conforme alla normativa italiana. Se lo studio (o i suoi clienti) sono soggetti IVA italiani, la fattura elettronica via SDI (Sistema di Interscambio) non è opzionale — è un obbligo di legge, con un formato XML specifico (FatturaPA) e una numerazione fiscale progressiva senza buchi.

**Non tutte le fatture passano da SDI.** Dipende dal cliente:

| Tipo cliente | Canale |
|---|---|
| Privato o business italiano | SDI obbligatorio (fattura elettronica) |
| Cliente estero (es. società maltese, cliente UE/extra-UE) | Fattura standard (PDF), non trasmessa a SDI — ma comunque numerata e archiviata regolarmente |

**Estensione allo schema `fattura` (§14):**

```
fattura
  ...campi esistenti...
  tipo_cliente_fiscale [privato_italia|business_italia|estero]
  partita_iva (nullable), codice_fiscale (nullable)          -- del cliente, obbligatori se canale=sdi
  numero_progressivo                                          -- es. "2026/00042", sequenziale per tenant
                                                                  e anno fiscale, SENZA buchi (obbligo di legge —
                                                                  va generato in transazione con lock, mai in modo
                                                                  ottimistico/concorrente)
  canale [sdi|standard]                                       -- derivato da tipo_cliente_fiscale
  stato_sdi [n/a|inviata|consegnata|scartata|mancata_consegna] -- solo se canale=sdi
  xml_fatturapa_url (nullable)                                -- generato solo se canale=sdi
```

**API aggiuntive:**

```
POST   /fatture/:id/emetti   [estende l'endpoint già definito in §18]
  → se canale='sdi': genera XML FatturaPA, lo trasmette tramite intermediario
     (es. Aruba, FatturaPRO, o web service diretto SDI) dietro un'interfaccia
     astratta SDIProvider.trasmetti(xml) — stesso pattern già usato per la firma
     digitale (§22): il provider concreto si sceglie dopo, senza toccare la logica
  → se canale='standard': genera solo il PDF, nessuna trasmissione

POST   /fatture/:id/webhook-sdi   [chiamato dall'intermediario SDI]
  chi: solo l'intermediario (autenticazione via secret del webhook)
  → aggiorna stato_sdi (consegnata/scartata/mancata_consegna)
  → se scartata: notifica interna all'advisor con il motivo dello scarto,
     la fattura NON si considera emessa finché non viene corretta e ritrasmessa
```

**Nota per l'informatico:** la generazione di `numero_progressivo` è l'unico punto di tutto il documento dove una race condition ha conseguenze legali, non solo un bug di UX — due fatture con lo stesso numero o un buco nella sequenza sono entrambi problemi normativi, non solo tecnici.

---

## 27. Bootstrap del sistema — il primo utente

Il documento presuppone ovunque "il tenant esiste, il super admin esiste" senza mai spiegare come nascono. È il classico problema circolare: serve un utente per crearne altri, ma il primo da dove arriva?

**Sequenza di bootstrap (una tantum, all'installazione):**

```
1. Script/comando eseguito manualmente sul server al primo deploy
   (MAI un endpoint HTTP pubblico, per ovvie ragioni di sicurezza)
   → crea il primo Utente con ruolo=super_admin, tenant_id=null
   → password temporanea generata casualmente e stampata una sola volta
     in console/log sicuro (mai salvata in chiaro, mai inviata via email)

2. Il super admin fa il primo login con la password temporanea
   → obbligato a cambiarla immediatamente
   → obbligato ad attivare il 2FA (§23) prima di poter fare qualsiasi altra azione

3. Il super admin crea il primo Tenant (es. Bluecode) via POST /admin/tenants (§21)
   → questo crea anche il primo utente advisor/owner di quel tenant,
     con invito via email (link di attivazione, non password temporanea)

4. L'advisor riceve l'email, imposta la propria password, ed è operativo
   → da qui in poi tutto segue i flussi già documentati (§15 in avanti)
```

Questo va scritto come script eseguibile (es. `npm run bootstrap` o comando CLI equivalente), documentato nel README del progetto — non lasciato come sequenza implicita che "qualcuno saprà fare".

---

## 28. Vincoli di upload e sicurezza file

Il sistema riceve documenti da terzi (KYC, passaporti, dossier finanziari) caricati da clienti esterni tramite un link — è un vettore di rischio reale, mai affrontato esplicitamente nel documento finora.

**Vincoli da applicare a ogni upload (passaggi guidati §17.2, documenti liberi §17.3):**

- **Dimensione massima per file:** 20 MB (ragionevole per scansioni/PDF, non per video — se in futuro serve altro, va rivalutato per tipo di passaggio)
- **Formati accettati:** whitelist esplicita — `pdf, jpg, jpeg, png, docx, xlsx` — mai eseguibili o script, controllo sul **contenuto reale del file** (magic bytes), non solo sull'estensione dichiarata dal client (un `.exe` rinominato `.pdf` deve essere rifiutato)
- **Scansione antivirus obbligatoria prima della disponibilità:** ogni file caricato passa da uno scanner (es. ClamAV self-hosted, o un servizio cloud) **prima** di essere reso scaricabile da chiunque altro

**Estensione allo schema `documento` (§14):**

```
documento
  ...campi esistenti...
  stato_scansione [in_corso|pulito|infetto]
  scansionato_at (nullable)
```

**Comportamento:** un documento appena caricato è visibile solo a chi lo ha caricato finché `stato_scansione != 'pulito'`. Se risulta `infetto`: il file non diventa mai accessibile ad altri, viene notificato internamente all'operatore assegnato (mai al cliente, per non allarmarlo su un probabile falso positivo o un problema del suo dispositivo), e resta in stato bloccato finché non viene ri-caricato un file pulito.

---

## 29. Paginazione, ricerca e scala attesa

Le liste principali (progetti, clienti, utenti, fatture) erano sempre specificate come "GET lista" senza mai dire come si comportano con centinaia di risultati — non bloccante per iniziare a scrivere codice, ma meglio fissare un default esplicito ora che lasciarlo implicito fino a quando qualcuno se ne accorge in produzione.

**Default proposto (applicabile a tutte le liste del documento):**

```
GET /progetti?page=1&limit=25&q=...
  limit: default 25, massimo 100 per richiesta
  q: ricerca testuale opzionale su nome progetto/cliente
  → risposta include {dati[], totale, pagina, pagine_totali}
```

**Scala attesa (assunzione da validare con lo studio, non un dato certo):** dimensionamento pensato per qualche decina di tenant nei primi due anni, centinaia di progetti per tenant, migliaia di documenti per tenant — un carico gestibile con un'istanza Postgres standard e senza bisogno di sharding orizzontale nel breve termine. Se i numeri reali attesi sono ordini di grandezza diversi (es. migliaia di tenant fin da subito, per un lancio come prodotto SaaS aggressivo), vale la pena dirlo all'informatico prima di iniziare, perché cambia scelte su indici e caching fin dal primo schema.

---

## 30. Prossimi passi

Con §26-29 questo documento chiude i cinque punti emersi dalla domanda "se fossi l'informatico, mi basterebbe questo?": fatturazione elettronica SDI (il gap più serio, poteva costringere a riscrivere lo schema fatture a metà sviluppo), bootstrap del primo utente/tenant, vincoli e sicurezza sugli upload, e i default di paginazione/scala.

Restano, come indicato in §25, le tre cose che non bloccano l'inizio dello sviluppo ma vanno chiuse entro il go-live: la policy di protezione dati/GDPR di dettaglio, la scelta finale dello stack tecnico concreto, e le decisioni di infrastruttura — tutte cose che si affinano insieme all'informatico che scrive il codice, non prima.

**Il documento è pronto per il passaggio successivo:** conversione in formato Word/PDF con indice navigabile — fatto, è la versione che stai leggendo. Non contiene ancora gli screenshot del prototipo per ogni sezione: se li vuoi inclusi, è un secondo passaggio a parte.
