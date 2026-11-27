# 29 · Cartella Modelli

## 👤 Cosa fa e come si usa
La **Cartella Modelli** (`/modelli`) è l'archivio dei modelli di documento dello studio, con lo stato di revisione di ciascuno. **Document Studio** (§10) attinge da questo stesso elenco, visibile a tutti i colleghi.

- **Riepilogo**: modelli attivi, approvati, in revisione, bozze, di serie mai adottati e archiviati.
- **Ricerca e filtri**: testo, categoria, stato di revisione e **Mostra gli archiviati**.
- **Nuovo modello**: si assegna un titolo e il modello si apre in Document Studio per la stesura.
- **Su ogni modello**: **Apri in Document Studio**, **Revisione**, **Archivia** o **Ripristina**, **Elimina**.
- **Esporta JSON** e **Importa JSON** salvano e caricano i modelli tramite file.

## 📐 Calcoli & logica
- **Stati di revisione**: **Bozza** (testo in lavorazione), **In revisione** (rilettura in corso, modello ancora utilizzabile), **Approvato** (testo riletto e validato).
- **Modificare un modello approvato fa decadere l'approvazione.**
- Un modello **di serie** viene adottato dallo studio nel momento in cui se ne registra la revisione.
- **Eliminare un modello non cambia i documenti già generati** nei progetti.
- **Livello di firma**: aprendo un modello in Document Studio, il documento parte dal livello di firma del modello (SES, FEA o FEQ); l'operatore può cambiarlo prima di salvare. Un documento salvato, riaperto, mantiene il suo livello.

## 🔗 Collegamenti
- **Document Studio** (§10), **Libreria** (§03), **Firma** (§11).

## ⚠️ Stati limite & errori
- **Elenco possibilmente incompleto**: se la lettura dal server non riesce, un avviso invita a premere **Ricarica** prima di concludere che un modello manca.
- **Modelli rimasti solo in questo browser**: un avviso propone **Porta nell'archivio dello studio**, così diventano visibili ai colleghi.

## 🔧 Nota tecnica
- Frontend: `pages/CartellaModelliPage.tsx`, `hooks/useCartellaTemplate.ts`, `components/documenti/SchedaModello.tsx`.
- Rotte: `/documenti-template`, chiave RBAC `documents`.
