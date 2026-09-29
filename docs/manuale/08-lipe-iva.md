# 08 · LIPE / Liquidazione IVA & F24

## 👤 Cosa fa e come si usa
La **Liquidazione IVA Periodica** (`/liquidazione-iva`) calcola l'IVA del periodo e prepara il
prospetto **F24**.
- Scegli il **periodo** (mensile o trimestrale); vedi la **simulazione live** di IVA a debito/credito
  e i **codici tributo** F24.
- **Salvi** la liquidazione e, quando versi, la marchi **versata**: il pagamento F24 registra in
  automatico il movimento in **Prima Nota** (§07).

## 📐 Calcoli & logica
- Motore deterministico `lipeEngine` conforme **DPR 633/72**: aggregazione mensile/trimestrale,
  esclusione dal debito dell'IVA in **split payment** (non incassata dallo studio) e gestione
  dell'esigibilità, calcolo **debito/credito**, e associazione automatica dei **codici tributo F24**
  (mensili `6001`–`6012`, trimestrali `6031`–`6034`, periodica `6099`).
- Il calcolo è **spiegabile** (§12): ogni voce del prospetto deriva da regole esplicite, non da numeri
  cablati.

## 🔗 Collegamenti
- **Fatture** (§05): l'IVA a debito viene dalle fatture emesse del periodo.
- **Ciclo passivo / Fatture ricevute**: l'IVA a credito dagli acquisti.
- **Prima Nota** (§07): il versamento F24 registra l'uscita.

## ⚠️ Stati limite & errori
- Periodo senza operazioni: prospetto a zero, non inventato.
- Le regole aperte (reset annuale numerazione, esigibilità differita) sono decisioni fiscali da
  confermare col titolare — vedi note di progetto.

## 🔧 Nota tecnica
- Motore: `src/services/lipeEngine.ts` (+ test `lipeEngine.test.ts`). Rotte:
  `src/routes/liquidazioneIva.ts` — `GET /liquidazione-iva`, `POST /liquidazione-iva/calcola`,
  `POST /liquidazione-iva/salva`, `POST /liquidazione-iva/:periodo/marca-versata` (→ movimento Prima Nota).
- Frontend: `pages/LiquidazioneIvaPage.tsx`.
- Schema: `LiquidazioneIva`.
- Fonti: `.agents/AGENTS.md`, `AUDIT_2026-09-27/04-contabilita-fatturazione.md`.
