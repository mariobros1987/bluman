# 04 · Preventivi & istanziazione (§15.3)

## 👤 Cosa fa e come si usa
Il **preventivo** raccoglie i moduli scelti per un cliente e, quando viene **accettato**, li
**istanzia** nel progetto (crea moduli, micro-voci, passaggi e dipendenze reali a database).
- Percorso principale: **wizard «Nuovo progetto»** (`NewProjectWizard`) — scegli cliente, moduli
  della Libreria e crei. È l'unico percorso che istanzia davvero i moduli (crea il preventivo **e**
  lo accetta in un colpo).
- Nel riepilogo, se una voce compare in **più moduli selezionati**, un avviso invita a condividerla
  dopo la creazione (vedi §01 — «🔗 Voci condivise»).

## 📐 Calcoli & logica
- **Istanziazione in un'unica transazione (§15.3)**: se qualcosa fallisce, si annulla tutto — mai un
  progetto «mezzo creato». Congela le **versioni** di articoli e moduli.
- **Idempotenza**: l'accettazione fa un **compare-and-set** sullo stato del preventivo
  (`bozza`/`inviato` → `accettato`); un doppio invio o una race trova 0 righe e **aborta** → niente
  moduli duplicati.
- **Una micro-voce per nome** nel modulo (§01); **valore preventivo** = somma dei prezzi dei moduli.

## 🔗 Collegamenti
- **Libreria** (§03): i moduli scelti sono template di libreria.
- **Progetti** (§01): l'accettazione genera i moduli del progetto (con dipendenze ereditate).
- **Portale** (§12): la proposta può essere accettata/firmata dal cliente (firma FEA).

## ⚠️ Stati limite & errori
- Preventivo **senza righe** → errore esplicito (il progetto verrebbe vuoto).
- Preventivo **già accettato** → errore/409 (istanziazione duplicata evitata).
- Timeout della transazione → **rollback** completo; l'accettazione è riprovabile.

## 🔧 Nota tecnica
- `src/services/istanziaProgetto.ts` (dominio dell'istanziazione) + `adapters/prisma/prismaIstanziazionePort.ts`;
  `prismaApp.accettaPreventivoEIstanzia`. Rotte `POST /preventivi`, `POST /preventivi/:id/accetta`.
- Frontend: `components/NewProjectWizard.tsx`, `api/progetti.ts` → `creaPreventivoEAccettaApi`.
- Schema: `Preventivo` (`righeJson`, `stato`, `valoreTotale`).
- Fonti: `.agents/AGENTS.md`, `AUDIT_2026-09-27/03-progetti-motore-stato.md`.
