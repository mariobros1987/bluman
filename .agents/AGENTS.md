# BluMan Advisory Platform — Mappa Architetturale & Regole Sviluppo

Questo file serve come indice rapido per l'IA ed i collaboratori per identificare i file responsabili ed evitare scansioni complete dell'intera codebase.

---

## 🏛 1. Mappa dei Componenti Frontend (`frontend/src/`)

- **`pages/Dashboard.tsx`**: Dashboard principale con KPI portafoglio, avvisi ritardo e progetti in corso.
- **`pages/ClientsPage.tsx`**: Anagrafica Clienti ERP, filtraggio, Magic Link passwordless e modal `AnagraficaErpModal`.
- **`pages/ProjectDetail.tsx`**: Vista dettagliata del progetto con tab:
  - `🗂 Moduli & Microvoci`
  - `🕸 Grafo & Dipendenze Moduli` (`GrafoModuliProgettoView`)
  - `💶 Fatturazione & SDI` (`FatturazioneTab` con Fatture FT e Note di Credito NC)
- **`pages/Library.tsx`**: Gestione Distinta Base, Costruttore Moduli Template, Catalogo Articoli e Modelli Documenti in Bianco.
- **`pages/ClientPortal.tsx`**: Portale Cliente a 5 schede (Proposta & Firma 1-Click, Live Progress, Form Societari, Documenti, Contatti Advisor).
- **`pages/SettingsPage.tsx`**: Anagrafica Studio, Sede Legale/Operativa, Configuratore PDF Fatture con Logo ed Anteprima Live.

---

## 🔌 2. API Backend Fastify (`src/server.ts`) & API Client (`frontend/src/api/client.ts`)

- **Progetti**: `GET /progetti`, `GET /progetti/:id`
- **Clienti**: `GET /clienti`, `POST /clienti`
- **Fatturazione**: `POST /progetti/:id/fatture` (gestisce sia Fatture `FT` che Note di Credito `NC` con numerazione distinta).
- **Upload Documenti**: `POST /upload` (riceve base64 e salva in `./uploads/`), `GET /uploads/:filename`
- **Articoli & Listino**: `GET /articoli`, `POST /articoli`, `PATCH /articoli/:id` (Modifica Prezzo & Ore Admin)

---

## 🗄 3. Database Schema (`prisma/schema.prisma`)

- **`Tenant`**: Dati studio, Sede Legale, Sede Operativa, P.IVA, Logo URL, Colore Tema PDF.
- **`Cliente`**: Dati ERP, Partita IVA, Codice Fiscale, Sede Legale, Codice SDI, IBAN, Rischio AML, UBO, Fonte Patrimonio, Data KYC.
- **`Fattura`**: `tipoDocumento` (`fattura` | `nota_credito`), `serie` (`FT` | `NC`), `numeroProgressivoSerie`, `causaNotaCredito`.
- **`PassaggioProgetto`**: `noteOperatoreJson`, `richiedeFirmaCliente`, `documentoAllegatoUrl`.
