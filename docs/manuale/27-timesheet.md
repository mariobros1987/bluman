# 27 · Timesheet Ore

## 👤 Cosa fa e come si usa
Il **Timesheet** (`/timesheet`) è la griglia settimanale delle ore del team: una riga per persona, una colonna per giorno. Con le frecce e con **Oggi** ci si sposta tra le settimane.

**Operatore**
1. Si fa clic su una propria cella.
2. Si inseriscono le ore (da 0 a 24) e, se serve, progetto e nota.
3. Si preme **Salva bozza**. **Svuota cella** azzera una registrazione.

**Responsabile** (advisor o super admin)
- Apre una cella e sceglie **Approva ore** o **Rifiuta**, con un motivo facoltativo.
- Con **Approva** approva tutte le bozze di una persona, con **Approva tutto** quelle dell'intera settimana.

## 📐 Calcoli & logica
- Ogni cella ha uno stato: **bozza**, **approvato** o **rifiutato**.
- Ciascuno modifica **solo le proprie ore**. Il responsabile approva o rifiuta, ma non cambia le ore altrui.
- Una cella **approvata è bloccata per tutti**.
- In fondo alla griglia si leggono i totali per giorno e per settimana, oltre al numero di bozze in attesa.

## 🔗 Collegamenti
- **Report** (§26): le ore approvate alimentano «Ore per Operatore».
- **Progetti** (§01): la registrazione può essere collegata a un progetto.

## ⚠️ Stati limite & errori
- Un valore fuori dall'intervallo 0–24 non viene accettato.
- Se la lettura o il salvataggio non riescono, compare il messaggio di errore.

## 🔧 Nota tecnica
- Frontend: `pages/TimesheetPage.tsx`. Rotte `/timesheet` in `src/routes/progetti.ts` (fuori matrice: ognuno scrive solo la propria riga; approva advisor/super_admin).
- Tabella `OraTimesheet`.
