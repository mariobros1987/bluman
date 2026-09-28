# 02 · Clienti & Anagrafica ERP

## 👤 Cosa fa e come si usa
L'anagrafica dei clienti dello studio (persone fisiche o società), pagina **Clienti** (`/clients`).

- **Creare / modificare un cliente**: modale a **5 schede** —
  1. **Generale** (dati fiscali: ragione sociale/nome, P.IVA, Codice Fiscale, tipo);
  2. **Progetti** attivi del cliente (collegamento alle pratiche);
  3. **Sede & Contatti** (indirizzo, referenti);
  4. **Fatturazione SDI** (Codice Destinatario, IBAN — servono a fatture e XML SDI);
  5. **Compliance KYC** (solo se il modulo KYC è attivo per lo studio) — badge e rimando al fascicolo.
- **Accesso del cliente al Portale**: **senza password**. Dall'anagrafica si **genera/invia il Magic
  Link** via email; il cliente entra dal link (vedi §12). Il ruolo `cliente` non ha password.
- **Riepilogo**: l'elenco mostra quante **società** e quante **persone**.

## 📐 Calcoli & logica
- Qui **non** si calcolano stati: il rischio AML e la due diligence vivono nel modulo **KYC** (§13);
  in anagrafica c'è solo la scheda/badge **Compliance**.
- **Elenco paginato lato server**: ricerca testuale, filtro **tipo** (`company`/`individual`) e
  riepilogo società/persone calcolato dal backend.
- **Segreti mai esposti**: `passwordHash` e le password dentro `referentiJson` vengono **rimossi** in
  lettura e non sono persistibili dal client (regola 5).

## 🔗 Collegamenti
- **Progetti** (§01): un cliente ha le sue pratiche; la scheda «Progetti» le elenca.
- **Fatture** (§05): P.IVA / CF / Codice SDI / IBAN alimentano la fatturazione e il tracciato XML SdI.
- **Portale** (§12): accesso passwordless tramite **Magic Link**.
- **KYC** (§13): scheda Compliance e fascicolo del cliente.
- **RBAC** (§17): creazione/modifica e le azioni sensibili (magic-link, reset) passano dal modulo
  `clients` (permesso per ruolo).

## ⚠️ Stati limite & errori
- Un **collaboratore** che tenta di cambiare la password di un cliente/utente dall'anagrafica → **400**
  («procedura dedicata»): il cambio password non passa da qui.
- Magic-link e reset password sono riservati (guard di ruolo sul modulo `clients`).
- Nessun cliente → empty state sincero, non una lista di ripiego.

## 🔧 Nota tecnica
- **Frontend**: `pages/ClientsPage.tsx`; modale `components/clients/AnagraficaErpModal.tsx` (tab
  `generale · progetti · sede · sdi · compliance`).
- **Rotte** (`src/routes/clienti.ts`): `GET /clienti` (paginato: `search`, `tipo`, `riepilogo`
  società/persone), `POST /clienti`, `PUT /clienti/:id`, `POST /clienti/:id/magic-link`; login del
  cliente `POST /auth/magic-login` (`src/routes/auth.ts`).
- **Magic Link** (`MagicLink`): in riga solo lo **SHA-256** del token (mai il token), con `scadenza`,
  `email`, `usatoAt`; **riutilizzabile** fino a scadenza (il cliente riapre il link più volte), la
  **revoca** è la cancellazione della riga.
- **Schema** (`Cliente`): P.IVA, Codice Fiscale, Codice SDI, IBAN, rischio AML, UBO, `referentiJson`
  (segreti rimossi). Il `cliente` è passwordless (§23).
- **Fonti**: `.agents/AGENTS.md`, `AUDIT_2026-09-27/01-sicurezza-multitenant.md`.
