# 03 · Libreria & Catalogo

## 👤 Cosa fa e come si usa
La **Libreria** (`/library`) è il catalogo dello studio da cui nascono le pratiche. Contiene:
- **Articoli** — le singole prestazioni (nome, categoria, ore e prezzo di default, con i loro passaggi
  template);
- **Moduli template** — pacchetti di prestazioni: ogni modulo ha una **distinta base** (elenco di
  articoli con quantità), un prezzo **a pacchetto** opzionale, una **giurisdizione** target e le sue
  **dipendenze**;
- **Giurisdizioni** — dati di riferimento (nome, codice, tipo), con **crea / modifica / elimina**;
- **Modelli di documento e form** — per il Document Studio (§10);
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
- **Giurisdizione**: un modulo può essere legato a una giurisdizione (es. Malta) o essere **generico**;
  il filtro per giurisdizione mostra i moduli pertinenti.

## 🔗 Collegamenti
- **Preventivi & Progetti** (§04, §01): i moduli template si **istanziano** nei moduli di progetto
  (con versioni congelate); le dipendenze del template diventano le dipendenze del progetto.
- **Documenti** (§10): i modelli di documento/form della Libreria alimentano il Document Studio.
- **Fatture** (§05): articoli, prezzi e prezzo-pacchetto sono la base degli importi.

## ⚠️ Stati limite & errori
- Eliminare una **giurisdizione** ancora usata da moduli o progetti → **409** (messaggio esplicito).
- Impostare una **dipendenza** che formerebbe un ciclo (A→B→A) → **400**.
- Nessuna riga inventata: un modulo senza distinta è **vuoto**, non si riempie a render time (regola 7).

## 🔧 Nota tecnica
- **Frontend**: `pages/Library.tsx` (tab: grafo, costruttore, articoli, giurisdizioni, modelli);
  `components/library/` — `CreaModuloForm` (distinta + `dipendenzeDaIds`), `ArticoliCatalogView`,
  `NuovoArticoloModal`, `GiurisdizioniView` (crea/modifica/elimina), `LibreriaDocumentiEForm`.
- **Rotte** (`src/routes/catalogo.ts`): `GET /moduli` (+`giurisdizioneId`), `POST`/`PUT /moduli-template`
  (accettano `dipendenzeDaIds`, con anti-ciclo), `GET`/`POST`/`PUT /articoli`,
  `GET`/`POST`/`PUT`/`DELETE /giurisdizioni`.
- **Anti-ciclo**: `src/services/dipendenzeModuli.ts` → `trovaCicloDipendenze`.
- **Schema**: `Articolo`, `PassaggioTemplate`, `ModuloTemplate`, `RigaDistinta` (distinta base),
  `ModuloDipendenzaTemplate` (dipendenze), `Giurisdizione`.
- **Fonti**: `.agents/AGENTS.md`, `AUDIT_2026-09-27/03-progetti-motore-stato.md`.
