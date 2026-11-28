# 03 · Libreria & Catalogo

## 👤 Cosa fa e come si usa
La **Libreria** (`/library`) è il catalogo dello studio da cui nascono le pratiche. Contiene:
- **Articoli** — le singole prestazioni (nome, categoria, ore e prezzo di default, con i loro passaggi
  template);
- **Moduli template** — pacchetti di prestazioni: ogni modulo ha una **distinta base** (elenco di
  articoli con quantità), un prezzo **a pacchetto** opzionale, una **giurisdizione** target e le sue
  **dipendenze**;
- **Giurisdizioni** — dati di riferimento (nome, codice, tipo), con **crea / modifica / elimina**;
- **Modelli di documento** — per il Document Studio (§10);
- **Form per il cliente** — un nome e un elenco di domande, salvati per lo studio (scheda «Modelli
  Documenti in Bianco & Form Master»). Il form si **indica sull'articolo**, in Catalogo Articoli →
  Modifica: è «il form da compilare da parte del cliente» (titolare, 28/11/2026);
- **Grafo dipendenze** dei moduli (visualizzazione).

**Costruttore modulo**: si compone la distinta (articoli + quantità), si imposta categoria,
giurisdizione e listino, e si scelgono le **«🔗 Dipende da (moduli)»**. In **modifica** tutto è
pre-compilato, dipendenze incluse.

Flusso: crei/aggiorni qui articoli e moduli → in un **preventivo** (§04) scegli i moduli → alla
**accettazione** diventano i moduli del progetto (§01).

## 📐 Calcoli & logica
- **Ore/prezzo del modulo** = somma di (ore/prezzo articolo × quantità) delle righe di distinta, salvo
  il **prezzo a pacchetto** (forfait) che, se impostato, **prevale** sulla somma. Le singole righe
  possono avere **override** di ore/prezzo.
- **Versioni congelate (§15.3)**: all'istanziazione in un progetto, versione di articolo e modulo
  vengono **congelate** — modificare il template **non** cambia i progetti già creati (sono copie
  indipendenti).
- **Dipendenze (modulo → modulo)**: impostate nel costruttore; il backend **rifiuta i cicli** (400).
  Un progetto eredita le dipendenze del template.
- **Una micro-voce per nome**: se la distinta contiene due articoli con lo stesso nome,
  all'istanziazione ne resta **una** (vedi §01).
- **Form dell'articolo**: nei progetti creati **dopo** aver indicato il form, l'attività nata da
  quell'articolo ha in coda un passaggio del cliente «Compila il form «…»» con le domande del form
  (copiate: cambiare o eliminare il form dopo non tocca i progetti già creati). **Se lo stesso
  cliente ha già compilato quel form** in un altro progetto dello studio, il passaggio nasce con
  quelle risposte — le più recenti, e solo per le domande che il form ha ancora — e la sua
  descrizione dice da quale progetto vengono. Resta **da fare**: le risposte riprese le controlla
  una persona. Le risposte non passano mai da un cliente a un altro.
- **Giurisdizione**: un modulo può essere legato a una giurisdizione (es. Malta) o essere **generico**;
  il filtro per giurisdizione mostra i moduli pertinenti.

## 🔗 Collegamenti
- **Preventivi & Progetti** (§04, §01): i moduli template si **istanziano** nei moduli di progetto
  (con versioni congelate); le dipendenze del template diventano le dipendenze del progetto.
- **Documenti** (§10): i modelli di documento/form della Libreria alimentano il Document Studio.
- **Fatture** (§05): articoli, prezzi e prezzo-pacchetto sono la base degli importi.

## ⚠️ Stati limite & errori
- **Filtri del Catalogo Articoli**: sono le categorie che gli articoli hanno davvero. Se filtro o ricerca non trovano niente, la pagina lo dice e offre **Mostra tutti gli articoli**.
- **Documenti dell'articolo**: nella modifica di un articolo i documenti allacciati **non vengono ancora salvati** (si salvano nome, prezzo, ore e il form del cliente); il modale lo avvisa. Cosa farne non è deciso.
- **Form**: un form senza domande non si crea (400); due form con lo stesso nome nello studio no (409); un form indicato da un articolo non si elimina finché non lo si toglie da lì (409). Form non letti → errore con «Riprova», non «nessun form».
- **Limiti dichiarati del form**: oggi le risposte le scrive l'operatore dalla scheda del passaggio; la compilazione dal portale del cliente arriva con il rifacimento dell'area cliente. I progetti già creati non ricevono il passaggio. Un form non si modifica: se ne crea uno nuovo.
- Eliminare una **giurisdizione** ancora usata da moduli o progetti → **409** (messaggio esplicito).
- Impostare una **dipendenza** che formerebbe un ciclo (A→B→A) → **400**.
- Nessuna riga inventata: un modulo senza distinta è **vuoto**, non si riempie a render time (regola 7).

## 🔧 Nota tecnica
- **Frontend**: `pages/Library.tsx` (tab: grafo, costruttore, articoli, giurisdizioni, modelli);
  `components/library/` — `CreaModuloForm` (distinta + `dipendenzeDaIds`), `ArticoliCatalogView`,
  `NuovoArticoloModal`, `GiurisdizioniView` (crea/modifica/elimina), `LibreriaDocumentiEForm`,
  `FormMasterSection` (i form, con `hooks/useFormMaster.ts` e `api/formMaster.ts`).
- **Form** (`src/routes/formArticolo.ts`): `GET`/`POST /form-master`, `DELETE /form-master/:id`,
  `PATCH /articoli/:id` (nome, prezzo, ore, `formMasterId`). Regole in `domain/formArticolo.ts`;
  il passaggio e il riuso delle risposte in `services/formArticolo.ts`, chiamato dall'istanziazione
  (`prismaIstanziazionePort`) e dal ripristino delle voci di un modulo.
- **Rotte** (`src/routes/catalogo.ts`): `GET /moduli` (+`giurisdizioneId`), `POST`/`PUT /moduli-template`
  (accettano `dipendenzeDaIds`, con anti-ciclo), `GET`/`POST`/`PUT /articoli`,
  `GET`/`POST`/`PUT`/`DELETE /giurisdizioni`.
- **Anti-ciclo**: `src/services/dipendenzeModuli.ts` → `trovaCicloDipendenze`.
- **Schema**: `Articolo`, `PassaggioTemplate`, `ModuloTemplate`, `RigaDistinta` (distinta base),
  `ModuloDipendenzaTemplate` (dipendenze), `Giurisdizione`.
- **Fonti**: `.agents/AGENTS.md`, `docs/storico/AUDIT_2026-09-27/03-progetti-motore-stato.md`.
