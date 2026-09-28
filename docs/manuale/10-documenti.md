# 10 · Documenti / Vault & Document Studio

## 👤 Cosa fa e come si usa
Il **Vault documentale** conserva i documenti della pratica; il **Document Studio** li crea in stile
Word (WYSIWYG, foglio A4, export PDF) con i **Smart Tags** ERP.
- **Archivio** (`/archivio`): navigazione Cliente → Progetto → Documenti; ricerca, «mostra archiviati»,
  filtro **periodo** (data documento).
- **Document Studio** (`/documents`): compone un documento da un modello, inserisce i Smart Tags
  (`{{cliente.codice_fiscale}}`, `{{cliente.sdi}}`, …), lo lega a una **micro-voce reale** del progetto
  (nessun id inventato) ed esporta PDF/Word.
- **Ciclo di vita**: `bozza → pubblicato → in_revisione → parzialmente_firmato → firmato`; versioni
  concatenate (`documentoPadreId`) con cronologia a ritroso.
- **Nome file leggibile**: a video il nome è ripulito (niente prefisso tenant/timestamp né token).

## 📐 Calcoli & logica
- **Documenti firmati immutabili**: non si eliminano mai (409 anche per admin) — si **archiviano**
  (`isArchiviato`); PATCH stato / nuova-versione / delete su un firmato → **409**.
- **Sblocco** (`PATCH /documenti/:id/sblocca`): solo admin, motivazione ≥10 caratteri, audit; la firma
  storica resta come evidenza.
- **Liste operative** escludono gli archiviati (`?includiArchiviati=true` per lo storico).
- **Smart Tags** risolti dai dati reali del cliente/progetto; niente valori di ripiego.

## 🔗 Collegamenti
- **Progetti** (§01): i documenti si legano a progetto/micro-voce; i passaggi possono richiederli.
- **Firma** (§11): pubblicazione → firma SES/FEA/FEQ.
- **Portale** (§12): il cliente vede e firma i documenti pubblicati.
- **Libreria** (§03): modelli di documento e form.

## ⚠️ Stati limite & errori
- Eliminare/modificare un documento **firmato** → **409** (solo archiviazione).
- Editor: salvataggio vincolato a una micro-voce reale del progetto (niente id inventati).
- Upload: scansione di sicurezza del file; errore esplicito se fallisce.

## 🔧 Nota tecnica
- Rotte: `src/routes/documenti.ts` (`GET /documenti` con filtro periodo, sblocca, archivia,
  nuova-versione), `documenti-template`. Servizi: `generazioneDocumenti.ts` (PDF/DOCX, Smart Tags),
  `storageService.ts`, `securityScanner.ts`. Nome file: `utils/index.ts → nomeFileLeggibile`.
- Frontend: `pages/DocumentEditorPage.tsx`, `pages/ArchivioDocumentiPage.tsx`,
  `components/documenti/ElencoDocumentiCartella.tsx`, `components/passaggio/TabDocumenti.tsx`.
- Schema: `Documento` (`statoDoc`, `versione`, `documentoPadreId`, `isArchiviato`, `dataScadenzaDoc`),
  `ModelloDocumentoCustom`, `EngagementLetter`.
- Fonti: `.agents/AGENTS.md`, `AUDIT_2026-09-27/05-documenti-firma.md`.
