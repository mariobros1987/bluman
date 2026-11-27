# 25 · Pagamenti

## 👤 Cosa fa e come si usa
La pagina **Pagamenti** (`/payments`) è una vista delle rate di incasso con la registrazione rapida in Prima Nota. **Non ha una voce nel menu**: si raggiunge solo scrivendo l'indirizzo.

- **Tre totali**: incassato effettivo, partite aperte e incassi scaduti.
- **Filtri**: ricerca per fattura, cliente o progetto; cliente; stato della rata.
- **Registra Incasso**: si indicano importo, data dell'incasso, metodo, riferimento CRO/TRN e note, poi **Salva in Prima Nota**.
- **Sollecita** apre lo stesso invio dello Scadenzario Incassi (§06).

## 📐 Calcoli & logica
- La data dell'incasso può essere oggi o un giorno passato, mai futura.
- Una rata scaduta e non incassata viene segnalata **In Ritardo**.
- L'accesso segue il permesso del modulo Banche.

## 🔗 Collegamenti
- **Scadenzario** (§06), **Prima Nota** (§07), **Fatture** (§05).

## ⚠️ Stati limite & errori
- Se la lettura non riesce, la pagina lo dichiara e propone **Riprova**.
- Se la registrazione fallisce, un messaggio avvisa che la scadenza non è stata aggiornata.

## 🔧 Nota tecnica
- Frontend: `pages/PaymentsPage.tsx` (rotta `/payments`, chiave RBAC `banks`, nessuna voce in `Sidebar.tsx`).
- Usa `InviaSollecitoModal` e le stesse API dello Scadenzario.
