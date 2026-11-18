# 22 · Coda KYC / AML

## 👤 Cosa fa e come si usa
La **Coda KYC / AML** (`/compliance`) raccoglie in un'unica vista le pratiche di verifica aperte dello studio, così non serve aprire i clienti uno per uno.

- **In alto**: quante pratiche sono in coda e quante sono **approvabili ora**.
- **Per ogni pratica**: cliente, stato, livello di verifica, rischio con punteggio, scadenza, segnali (screening aperto, anomalie) e **perché non si approva**.
- **Approvare in blocco**: si selezionano le pratiche pronte, oppure **Tutte le approvabili**, si aggiunge se serve una motivazione e si preme **Approva selezionate**.

## 📐 Calcoli & logica
- Le pratiche approvabili compaiono per prime.
- **Chi è approvabile lo decide il server**, con gli stessi controlli del modulo KYC (§13). Solo le pratiche pronte si possono selezionare.
- L'approvazione chiude la verifica, abilita l'operatività e resta scritta nello storico del fascicolo e nel registro di compliance.
- La motivazione è facoltativa, al massimo 500 caratteri, e finisce nello storico delle pratiche.

## 🔗 Collegamenti
- **KYC / AML** (§13): il fascicolo completo del cliente.
- **Clienti** (§02): la pagina usa gli stessi permessi dell'anagrafica.
- **Impostazioni** (§16): profilo regolatorio e attivazione del modulo.

## ⚠️ Stati limite & errori
- **Modulo non attivo**: la pagina indica di attivarlo da Impostazioni → Moduli.
- **Profilo regolatorio mancante**: nessuna pratica si può approvare finché non viene impostato in Impostazioni → Compliance & AML.
- **Pratiche respinte durante l'approvazione**: un riquadro elenca ciascun cliente con il motivo; le altre vengono approvate normalmente.

## 🔧 Nota tecnica
- Frontend: `pages/CompliancePage.tsx`, `api/kyc.ts`. Chiave RBAC `clients`.
- Rotte: `src/routes/kyc.ts` (coda e approvazione massiva).
