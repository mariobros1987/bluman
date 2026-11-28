# 09 · Contratti ricorrenti / Retainer

## 👤 Cosa fa e come si usa
I **Contratti Ricorrenti** (`/retainers`) sono gli incarichi periodici (retainer): un importo che si
fattura a cadenza fissa (mensile, trimestrale, annuale).
- Crei un contratto legato a un **cliente** (ed eventualmente a un **progetto**), con **titolo**,
  **frequenza** e **importo**; il sistema tiene la **prossima data di fatturazione**.
- Alla scadenza **generi la fattura** del periodo con un'azione esplicita (pulsante «genera fattura»,
  non un automatismo): la fattura prende la numerazione del registro (§05), **entra nello
  Scadenzario Incassi** (§06) e la **prossima data** avanza secondo la frequenza.
- Quando un canone arriva alla data, la Dashboard lo ricorda in **Da fare oggi** («N canoni Retainer
  da fatturare», §21) con il pulsante che porta qui. La fattura resta un gesto dell'operatore
  (deciso dal titolare il 28/11/2026).

## 📐 Calcoli & logica
- `prossimaFatturazione` avanza secondo la **frequenza**; l'importo è fisso salvo modifica del
  contratto.
- La fattura generata usa la **numerazione progressiva** standard (§05) e le regole IVA del cliente.
- È un lavoro **annuale che si ripete**: si modella come contratto ricorrente, non duplicando progetti
  (coerente con «l'anno è una lente, non uno scatolone», vedi §18).

## 🔗 Collegamenti
- **Clienti** (§02): il contratto è del cliente.
- **Progetti** (§01): può essere legato a una pratica.
- **Fatture** (§05): genera le fatture periodiche.

## ⚠️ Stati limite & errori
- Contratto senza cliente/importo → non creabile.
- La generazione fattura segue le stesse guardie del registro (numerazione, IVA), compreso il blocco se al cliente mancano i dati fiscali (§05).

## 🔧 Nota tecnica
- Rotte: `src/routes/contabilitaContratti.ts` — `GET /contratti-ricorrenti`, `POST /contratti-ricorrenti`,
  `POST /contratti-ricorrenti/:id/genera-fattura` (genera la fattura, la mette nello Scadenzario e
  avanza `prossimaFatturazione`). Frontend: `pages/RetainersPage.tsx`.
- Schema: `ContrattoRicorrente` (`clienteId`, `progettoId?`, `titolo`, `frequenza`, `importoCentesimi`,
  `prossimaFatturazione`, `note`).
- Fonti: `.agents/AGENTS.md`.
