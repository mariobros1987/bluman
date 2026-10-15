# 06 · Scadenzario incassi & Solleciti

## 👤 Cosa fa e come si usa
Lo **Scadenzario** (`/invoices/scadenzario`) tiene le **rate di incasso** generate dalle fatture:
scadenze, importi, stato (aperta/parziale/incassata/stornata) e ritardi.
- **Registrare un incasso**: da una rata → importo, metodo, conto → registra il pagamento (e crea in
  automatico il movimento di Prima Nota, §07). Il conto scelto è quello che riceve il denaro: se non
  lo si sceglie si usa il conto di accredito della fattura e, in mancanza, il conto predefinito dello
  studio — e il movimento in Prima Nota lo **nomina**, così la banca che ha il denaro è scritta da
  qualche parte.
- **Solleciti**: da una rata scaduta si invia un sollecito con **escalation** a 3 livelli
  (promemoria → sollecito → diffida) via email/WhatsApp.
- **Filtri**: stato, cliente, ricerca e **periodo** (data di scadenza).

## 📐 Calcoli & logica
- **Mora D.Lgs. 231/2002**: giorni di ritardo, maggiorazione **tasso legale BCE +8%** e **indennizzo
  forfettario 40 €** (art. 6). Il motore `sollecitiEngine` calcola importi e testo.
- **Escalation stretta**: la regola pura `puoInviareSollecito` impedisce che la **diffida** sia il
  primo contatto — prima devono esserci i livelli precedenti, con la loro **storia**.
- **Cron W2**: segnala allo studio le fatture **emesse ma mai trasmesse allo SdI** da oltre 3 giorni.

## 🔗 Collegamenti
- **Fatture** (§05): le rate nascono dalla fattura; una NC può stornare rate aperte.
- **Prima Nota** (§07): l'incasso registra il movimento cassa/banca.
- **Comunicazioni** (§15): i solleciti escono via email/WhatsApp (governati dalla matrice).

## ⚠️ Stati limite & errori
- Incassare una rata **stornata** → **409**.
- Inviare una diffida senza i livelli precedenti → bloccato da `puoInviareSollecito`.
- Empty state sincero se non ci sono scadenze.

## 🔧 Nota tecnica
- Rotte: `src/routes/contabilitaScadenzario.ts` (lista + incassi, filtro periodo), `solleciti.ts`.
  Motore: `services/sollecitiEngine.ts`. Modello `Sollecito` (storia, migrazione dedicata) con RLS.
- Frontend: `pages/ScadenzarioPage.tsx`, `components/solleciti/InviaSollecitoModal.tsx`.
- Schema: `ScadenzaIncasso` (`dataScadenza`, `stato`), `RegistrazioneIncasso`, `Sollecito`.
- Fonti: `.agents/AGENTS.md`, `AUDIT_2026-09-27/04-contabilita-fatturazione.md`.
