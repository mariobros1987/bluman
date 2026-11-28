# 06 · Scadenzario incassi & Solleciti

## 👤 Cosa fa e come si usa
Lo **Scadenzario** (`/scadenzario`) tiene le **rate di incasso** generate dalle fatture:
scadenze, importi, stato (aperta/parziale/incassata/stornata) e ritardi.
- **Registrare un incasso**: da una rata → importo, data, conto, metodo → registra il pagamento (e crea
  in automatico il movimento di Prima Nota, §07). Il **conto è obbligatorio**: lo sceglie chi registra,
  e il movimento in Prima Nota lo **nomina**. Lo stesso modulo si apre dal Registro Fatture (§05).
- **Stornare un incasso** registrato per errore: sulla rata, **↩ Storna incasso** → si sceglie
  l'incasso e si scrive il motivo. L'incasso non si cancella: si scrive una riga contraria, la rata
  torna da incassare e dal conto esce lo stesso importo.
- **Solleciti**: da una rata scaduta si invia un sollecito con **escalation** a 3 livelli
  (promemoria → sollecito → diffida) via email/WhatsApp.
- **Filtri**: stato, cliente, ricerca e **periodo** (data di scadenza).

## 📐 Calcoli & logica
- **Registra Incasso** chiede la **data** in cui il denaro è arrivato (proposta: oggi, mai futura) e il **conto** su cui è entrato (proposto: quello della fattura, altrimenti il predefinito; la scelta resta di chi registra). La data finisce in Prima Nota; il saldo del conto scelto sale dell'importo. **Senza conto l'incasso non si registra**: se lo studio non ne ha ancora, il modulo lo dice e porta a Banche e conti (§24).
- **Storna incasso** (deciso dal titolare il 28/11/2026): scrive una registrazione con l'importo negativo che nomina l'incasso annullato, quindi la somma delle registrazioni di una rata resta il suo incassato vero. La rata torna «in attesa» o «parziale», la fattura torna «emessa» se non è più tutta saldata, e in Prima Nota entra un'uscita dallo **stesso conto** dell'incasso. Chi ha stornato e il motivo restano nel Log Audit (`INCASSO_STORNATO`). Un incasso si storna una volta sola, e uno storno non si storna: se serve, si registra di nuovo l'incasso.
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
- Incasso senza conto → **400**; studio senza conti → **409** con l'invito a crearne uno.
- Storno di un incasso già stornato, di una riga di storno, o su una fattura annullata da Nota di Credito → **409** con il motivo.
- Storno di un incasso vecchio di cui non si riconosce il movimento in Prima Nota (più movimenti uguali su conti diversi) → **409**, e non viene scritto niente: non si fa uscire denaro da un conto scelto a caso.
- Inviare una diffida senza i livelli precedenti → bloccato da `puoInviareSollecito`.
- Empty state sincero se non ci sono scadenze.

## 🔧 Nota tecnica
- Rotte: `src/routes/contabilitaScadenzario.ts` (lista + incassi, filtro periodo),
  `contabilitaStornoIncasso.ts` (`POST /invoices/scadenze/:id/incassi/:incassoId/storno`), `solleciti.ts`.
  Regole dello storno: `domain/stornoIncasso.ts` (puro, lo usa anche la pagina).
  Motore: `services/sollecitiEngine.ts`. Modello `Sollecito` (storia, migrazione dedicata) con RLS.
- Frontend: `pages/ScadenzarioPage.tsx`, `components/contabilita/RegistraIncassoModal.tsx` e
  `StornaIncassoModal.tsx`, `components/solleciti/InviaSollecitoModal.tsx`.
- Schema: `ScadenzaIncasso` (`dataScadenza`, `stato`), `RegistrazioneIncasso` (`stornoDiId`: lo
  storno nomina l'incasso che annulla), `MovimentoPrimaNota.registrazioneIncassoId`, `Sollecito`.
- Fonti: `.agents/AGENTS.md`, `docs/storico/AUDIT_2026-09-27/04-contabilita-fatturazione.md`.
