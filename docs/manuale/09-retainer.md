# 09 · Contratti ricorrenti / Retainer

## 👤 Cosa fa e come si usa
I **Contratti Ricorrenti** (`/retainers`) sono gli incarichi periodici (retainer): un importo che si
fattura a cadenza fissa (mensile, trimestrale, annuale).
- Crei un contratto legato a un **cliente** (ed eventualmente a un **progetto**), con **frequenza** e
  **importo**; il sistema tiene la **prossima data di fatturazione**.
- Alla scadenza si **genera la fattura** del periodo (con la numerazione del registro, §05).

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
- La generazione fattura segue le stesse guardie del registro (numerazione, IVA).

## 🔧 Nota tecnica
- Rotte: `src/routes/contabilitaContratti.ts`. Frontend: `pages/RetainersPage.tsx`.
- Schema: `ContrattoRicorrente` (`clienteId`, `progettoId?`, `frequenza`, `importoCentesimi`,
  `prossimaFatturazione`).
- Fonti: `.agents/AGENTS.md`.
