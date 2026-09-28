# 18 · Filtri per data & Periodo / Esercizio

## 👤 Cosa fa e come si usa
Due strumenti per lavorare «per periodo»:
- **Filtro Da/A** nelle barre filtri di **Progetti, Fatture, Scadenzario, Documenti**: due campi data
  indipendenti (entrambi opzionali).
- **Selettore globale «Periodo»** nella barra in alto (chip): quick-pick degli **anni** + **«Tutto»** +
  intervallo personalizzato. Impostato una volta, **pilota** il filtro delle pagine sopra; è sempre
  visibile e **azzerabile**.

È la risposta a «progetti per anno»: l'anno è una **lente**, non uno scatolone — non si spostano
fisicamente i record, si filtra per periodo (e a fine anno si **archivia** ciò che è chiuso).

## 📐 Calcoli & logica
- Le date sono validate (`YYYY-MM-DD`, respinte le impossibili) e normalizzate ai **bordi giorno UTC**.
- **Progetti**: filtro per **sovrapposizione** del periodo con `[dataInizio, dataScadenza]` (estremi
  nullable). **Fatture**: data di emissione (circoscrive anche i totali del riepilogo). **Scadenzario**:
  data di scadenza. **Documenti**: data documento (`createdAt`).
- **Esclusi per scelta** dal periodo globale: Anagrafica clienti, KYC (ritenzione 5 anni) e Impostazioni.
- Empty state con azione: «nessun risultato in questo periodo — azzera» (regola 13), mai far sembrare
  spariti dati che ci sono (regola 7).

## 🔗 Collegamenti
- **Progetti/Fatture/Scadenzario/Documenti** (§01/05/06/10): sono le liste filtrabili.

## ⚠️ Stati limite & errori
- Estremo data malformato → **400** (il chiamante lo respinge).
- Cambiando il periodo globale, le pagine si riallineano ma il filtro locale può override.

## 🔧 Nota tecnica
- Backend: `src/util/intervalloData.ts` (`parseDataIso`, `leggiIntervalloData`, `filtroData`);
  `dataDa`/`dataA` in `leggiPaginazione` + `PaginazioneQuerySchema`. Applicato in `routes/progetti.ts`,
  `contabilitaRegistro.ts`, `contabilitaScadenzario.ts`, `documenti.ts`.
- Frontend: `components/ui/FiltroPeriodo.tsx`, `context/PeriodoContext.tsx`,
  `components/layout/SelettorePeriodo.tsx`, `api/paginazione.ts` (`queryPaginazione`).
- Fonti: `.agents/AGENTS.md`.
