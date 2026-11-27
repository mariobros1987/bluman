# 21 · Dashboard

## 👤 Cosa fa e come si usa
- **Da fare oggi**, in cima: che cosa aspetta, con il pulsante per andarci. Elenca le **rate scadute** da incassare (con quanto resta da incassare), le **rate che scadono entro 7 giorni**, le **fatture d'acquisto da pagare** e i **moduli in ritardo o con ore sforate**. Se non c'è niente lo dice. Compaiono solo le voci delle pagine a cui hai accesso; se una lettura non riesce, il riquadro avvisa che può essere incompleto.
La **Dashboard** (`/`) è la prima schermata dopo l'accesso: dà il quadro del portafoglio e segnala cosa richiede attenzione.

- **Quattro contatori**: **Progetti attivi** (con il numero di quelli in lavorazione), **Ritardi attivi**, **Valore portafoglio** e **Avanzamento medio**.
- **Situazioni che richiedono attenzione immediata**: il riquadro elenca progetto e modulo interessati, con una riga per ogni motivo.
- **Elenco progetti**: due schede, **Progetti in Corso** e **Archivio Progetti**, con la ricerca per progetto o cliente.
- **Dalla scheda di un progetto**: un clic apre il progetto (§01), un clic sul nome del cliente apre la sua anagrafica (§02).
- **+ Nuovo progetto** avvia la procedura guidata di creazione (§04).

## 📐 Calcoli & logica
- La pagina rispetta il **Periodo** globale scelto nella barra in alto (§18).
- Stato e percentuale di avanzamento arrivano dal motore di calcolo (§01): la Dashboard non li ricava da sola.
- **Ritardo e ore sforate restano due avvisi distinti**: un ritardo riguarda i tempi, uno sforamento riguarda le ore consumate rispetto al preventivo.
- Il valore di un progetto entra nel portafoglio solo se è registrato.
- I contatori riguardano i progetti **non archiviati**, come la scheda «Progetti in Corso».

## 🔗 Collegamenti
- **Progetti** (§01), **Clienti** (§02), **Preventivi** (§04), **Periodo** (§18).

## ⚠️ Stati limite & errori
- **Dati aggiornati alle…**: in cima alla pagina si legge l'ora dell'ultima lettura riuscita, con **Aggiorna** per rileggere.
- **Pillola in alto a destra**: conta le **notifiche non lette** di ogni tipo; i ritardi veri sono indicati a parte (per esempio «🔔 3 notifiche da leggere · ⚠ 1 ritardo»).
- Se il server non risponde, la pagina mostra l'errore con il pulsante **Riprova**, senza dati sostitutivi.
- Senza progetti, un messaggio invita a creare il primo.

- La Dashboard legge i **50 progetti più recenti** del periodo. Se il periodo ne contiene di più, un avviso lo dichiara e i contatori riguardano solo quelli letti: per il quadro completo si usa la pagina Progetti.

## 🔧 Nota tecnica
- Frontend: `pages/Dashboard.tsx` (legge `GET /progetti` con `limit: 50` e il Periodo globale).
- Stato e percentuali: `avanzamento` calcolato dal backend (§01).
