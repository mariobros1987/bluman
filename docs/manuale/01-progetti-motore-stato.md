# 01 · Progetti & Motore di stato (§16)

## 👤 Cosa fa e come si usa
Un **progetto** è una pratica per un cliente. Dentro ha **moduli** (le prestazioni), ogni modulo ha
**micro-voci** (le attività), ogni micro-voce ha **passaggi** (gli step operativi).

- **Come nasce**: da un **preventivo accettato** (vedi §04) — i moduli non si creano a mano; i modelli
  arrivano dalla **Libreria** (§03).
- **Elenco progetti** (`/projects`): viste schede / tabella / kanban, con ricerca e filtri (stato,
  categoria, operatore, **periodo**), avanzamento % e avvisi di ritardo.
- **Scheda progetto** (`/projects/:id`): moduli espandibili con le loro micro-voci, **grafo delle
  dipendenze**, comunicazioni, fatture e scadenze.
- **Cosa fa l'operatore su una micro-voce**: **consuntiva le ore**, la marca **completata**, la mette
  **in ritardo** (con motivo obbligatorio) o la sblocca; apre i **passaggi**.
- **Cosa si trova aprendo una micro-voce**: quattro schede — **Checklist Passaggi**, **Note & Registro
  Attività**, **Documenti & Workflow** e **💬 Messaggi**. L'ultima non è più in sola lettura: dal
  **2026-10-06** elenca i messaggi scambiati col cliente **che riguardano questa voce**, dice *perché*
  ciascuno è lì (badge colorato per origine) e — in fondo — ha il **compositore** per rispondere
  restando dove si sta leggendo. Il messaggio nasce **già abbinato** alla voce (§15).
- **Chiusura / fine anno**: un progetto con fatture **non si elimina**, si **archivia** (resta
  consultabile con `?includiArchiviati=true`).

## 📐 Calcoli & logica (li fa il backend, §16)
- **La cascata sale, mai scende (§16.6)**: lo stato di una micro-voce cambia solo per **azione
  esplicita** (consuntivazione, ritardo, completamento); da lì si ricalcola il modulo, poi il
  progetto. Non si scrive mai lo stato di una micro-voce «dall'alto».
- **Stato modulo** = da `calcolaStatoModulo(micro-voci)`; **stato progetto** = da
  `calcolaStatoProgetto(moduli)`. Le **percentuali** derivano da stato + ore prev./cons. e **non si
  salvano** (nessuna colonna: così non possono divergere dai loro ingredienti).
- **Attivazione del progetto**: scatta quando il cliente firma la **lettera d'incarico di quel
  progetto** (§11) — non accettando il preventivo, e non «l'ultimo progetto del cliente». Prima
  avveniva a ogni firma del portale (anche solo prendere visione di un documento faceva partire un
  progetto in lavorazione) e sceglieva il progetto più recente: con più incarichi aperti se ne apriva
  uno che nessuno aveva firmato.
- **Tetto 99%** finché lo stato non è `done`/`completed`: un modulo che dice «100%» mentre è ancora
  aperto è l'inganno che §16.1 evita — il 100 lo concede solo lo stato, non l'aritmetica.
- **Segnale di rischio (ore sforate)**: per micro-voce `valutaSegnaleRischio`; sul modulo è l'**OR**
  dei segnali, le **ore extra** si **sommano**. È un allarme sul lavoro in corso: su una voce `done`
  si spegne, ma le ore extra restano (costo storico, serve a preventivare meglio).
- **Moduli senza micro-voci**: non si ricalcolano (la riga è l'unica fonte) e non vengono declassati.
- **Ricalcolo**: le azioni normali aggiornano già lo stato; `POST /progetti/:id/ricalcola` forza la
  cascata (utile dopo un import o una correzione a mano) e **sblocca le dipendenze**.

### Stati possibili
- **Micro-voce**: `pending · attesa_dipendenza · active · delayed · blocked · done`.
- **Modulo**: `pending · attesa_dipendenza · in_progress · delayed · blocked · done`.
- **Progetto**: `pre_project` (prima della firma dell'engagement letter — non si calcola) → poi calcolato.

### Micro-voci: unicità, quantità, condivisione
- **Una micro-voce per NOME nel modulo**: all'istanziazione, due righe di distinta con lo stesso nome
  danno **una sola** voce (si tiene la prima). Evita i doppioni (es. da un doppio seed).
- **Quantità > 1** sulla stessa riga = più **unità** dello stesso articolo (legittimo, non è un doppione).
- **Condivisione tra due moduli**: se la stessa voce vale anche per un altro modulo, dalla scheda
  progetto → pulsante **«🔗 Voci condivise»** sul modulo si sceglie in quali altri moduli vale. La voce
  resta **una sola** (si esegue una volta) e **conta per entrambi**; le ore del progetto **non
  raddoppiano** (contate una volta sola). **409** se il modulo di destinazione ha già una voce con lo
  stesso nome.

### Dipendenze tra moduli
Le dipendenze sono **tra moduli** (non tra articoli/micro-voci): «il modulo A dipende dal modulo B».
Si impostano nel **costruttore modulo in Libreria** (§03) → campo **«🔗 Dipende da (moduli)»** (multi-
selezione degli altri moduli); il backend rifiuta i **cicli** (400). Un progetto istanziato eredita le
dipendenze dei suoi template. Finché il modulo «da cui dipende» non è `done`, le micro-voci del
dipendente restano `attesa_dipendenza`; quando quel modulo si chiude, il ricalcolo le **sblocca**
(`attesa_dipendenza → pending`). Il grafo nella scheda progetto mostra il vero stato delle dipendenze.

## 🔗 Collegamenti
- **Preventivi / Libreria** (§03–04): i moduli nascono dall'istanziazione dei template (distinta base).
- **Documenti & Firma** (§10–11): i passaggi possono richiedere documenti/firma; concludere un modulo
  dal portale è una **firma FEA** (impronta calcolata dal server sui dati del modulo).
- **Fatture** (§05): si fattura sul **modulo** (completo / parziale / milestone) — la riga fattura
  punta al modulo; un modulo con fatture blocca l'eliminazione del progetto.
- **Calendario** (§14): le scadenze delle micro-voci compaiono nel calendario/scadenzario attività.
- **Comunicazioni & RBAC** (§15, §17): assegnazione operatori e permessi per modulo.
- **Filtri / Periodo** (§18): l'elenco filtra per periodo (sovrapposizione data inizio–scadenza).

## ⚠️ Stati limite & errori
- Elenco vuoto o progetto **senza moduli**: la pagina lo dichiara vuoto, **non** mostra dati di ripiego.
- `DELETE /progetti/:id` → **409** se ha fatture/NC (si archivia); `DELETE …/moduli/:moduloId` → **409**
  se il modulo ha ore consuntivate o righe fattura.
- Completare una micro-voce con **passaggi ancora aperti** → **409** (§17.1).
- Marca-ritardo / blocco: **causaNota obbligatoria**.
- Solo `advisor` / `super_admin` eliminano o archiviano; il ruolo `cliente` vede **solo i propri** progetti.

## 🔧 Nota tecnica
- **Dominio puro**: `src/domain/stateEngine.ts` — `calcolaStatoModulo`, `calcolaPercentualeModulo`,
  `calcolaStatoProgetto`, `calcolaPercentualeProgetto`, `valutaSegnaleRischio`, `risolviDipendenze`
  (nessuna query).
- **Ponte con Prisma**: `src/services/calcoloService.ts` — `calcolaAvanzamento` (in memoria, zero
  query), `arricchisciProgetti`, `ricalcolaProgetto` (persiste la cascata + sblocco dipendenze).
  Persistiti: `stato` di modulo/progetto, `segnaleRischio`/`oreExtra` della micro-voce. **Non**
  persistite: le percentuali.
- **Istanziazione**: `src/services/istanziaProgetto.ts` (+ `adapters/prisma/prismaIstanziazionePort.ts`)
  — dedup per nome, guardia compare-and-set sul preventivo (niente doppia istanziazione).
- **Rotte** (`src/routes/progetti.ts`): `GET /progetti` (paginato; filtri stato/categoria/operatore/
  periodo), `GET /progetti/:id` (`getProgetto` in `prismaApp.ts`), `POST /progetti`,
  `DELETE /progetti/:id`, `PUT /progetti/:id/archivia`, `POST /progetti/:id/ricalcola`,
  `DELETE /progetti/:id/moduli/:moduloId`, `POST /progetti/:id/microvoci/:mvId/condivisione`;
  consuntivazione `POST /microvoci/:id/consuntiva`, marca/risolvi ritardo.
- **Schema** (`prisma/schema.prisma`): `Progetto`, `ModuloProgetto`, `MicrovoceProgetto`,
  `PassaggioProgetto`, `ModuloProgettoDipendenza`, `MicrovoceModuloCondiviso`.
- **Frontend**: `pages/Projects.tsx` (elenco), `pages/ProjectDetail.tsx` + `components/projectDetail/`
  (`ModuliTab`, `ModuloBlock`, grafo `GrafoModuliProgettoView`), `PassaggioModal`.
- **La scheda «💬 Messaggi» di una voce** (`components/passaggio/TabMessaggi.tsx`) è **proiezione**, non
  una seconda casella: il messaggio è **una riga sola** in `comunicazione_progetto`, e la scheda ne
  mostra quelle abbinate. «Compare in entrambi i posti» (voce e chat della pratica) è vero e gratis: non
  c'è nessuna copia da tenere allineata. Il compositore che vi si monta è lo **stesso** della chat —
  `hooks/useInvioComunicazione.ts` + `components/ComposerComunicazione.tsx`, avvolti da
  `components/passaggio/ComposerMicrovoce.tsx`, che è l'unico a leggere le impostazioni dello studio
  (così aprire la checklist non fa una richiesta di rete che non serve). Abbinare e **slegare** restano
  nella chat, dove si vede la conversazione intorno: dalla voce c'è il ritorno «Apri nella chat della
  pratica →».
- **Fonti**: `AUDIT_2026-09-27/03-progetti-motore-stato.md`, `.agents/AGENTS.md`.
