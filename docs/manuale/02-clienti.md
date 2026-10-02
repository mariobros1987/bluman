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
- **Due viste, e si sceglie**: **Elenco** (predefinita) o **Schede**, con l'interruttore in alto a
  destra. La scelta è ricordata nel browser, e le schede mostrano i contatti solo quando ci sono.
- **Riepilogo**: quattro riquadri — totale, **società**, **persone** e **senza accesso al portale**.
  Il quarto è **cliccabile** e applica il filtro: dice quanto lavoro resta sulle credenziali.

## 📐 Calcoli & logica
- Qui **non** si calcolano stati: il rischio AML e la due diligence vivono nel modulo **KYC** (§13);
  in anagrafica c'è solo la scheda/badge **Compliance**.
- **Elenco paginato lato server**: ricerca testuale (nome, email, P.IVA, codice fiscale), filtro
  **tipo** (`company`/`individual`) e filtro **accesso al portale** (`con`/`senza`). I conteggi del
  riepilogo sono calcolati dal backend **dentro i filtri attivi**, così i quattro riquadri restano
  coerenti fra loro. L'elenco si ordina cliccando le intestazioni «Cliente» e «Tipo».
- **I filtri stanno nel backend, non nella pagina**: filtrare le sole righe già caricate darebbe
  risultati falsi, perché con 50 clienti per pagina «senza accesso» mostrerebbe solo quelli assenti
  *da quella pagina*. Un valore di `portale` inventato è un **400**, non un filtro ignorato.
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
- **Frontend**: `pages/ClientsPage.tsx` (due viste: elenco/tabelle e schede; preferenza in
  `localStorage` alla chiave `bluman_clienti_vista`); modale `components/clients/AnagraficaErpModal.tsx`
  (tab `generale · progetti · sede · sdi · compliance`).
- **Rotte** (`src/routes/clienti.ts`): `GET /clienti` (paginato: `search`, `tipo`, `portale`,
  `sortBy`/`sortOrder` fra `createdAt`·`nome`·`tipo`·`rischioAml`, `riepilogo`
  società/persone/`senzaPortale`), `POST /clienti`, `PUT /clienti/:id`,
  `POST /clienti/:id/magic-link`; login del cliente `POST /auth/magic-login` (`src/routes/auth.ts`).
- **Il filtro del portale legge `passwordHash`**, la stessa colonna da cui `serializzaCliente` ricava
  `hasPassword`: filtro e pastiglia che l'operatore vede non possono divergere. `hasPassword` non è
  una colonna, è calcolato in lettura.
- **Magic Link** (`MagicLink`): in riga solo lo **SHA-256** del token (mai il token), con `scadenza`,
  `email`, `usatoAt`; **riutilizzabile** fino a scadenza (il cliente riapre il link più volte), la
  **revoca** è la cancellazione della riga.
- **Schema** (`Cliente`): P.IVA, Codice Fiscale, Codice SDI, IBAN, rischio AML, UBO, `referentiJson`
  (segreti rimossi). Il `cliente` è passwordless (§23).
- **Fonti**: `.agents/AGENTS.md`, `AUDIT_2026-09-27/01-sicurezza-multitenant.md`.
