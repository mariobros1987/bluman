# 30 · Aiuto

## 👤 Cosa fa e come si usa
- **Il «?» accanto al titolo** di ogni pagina apre direttamente la scheda che spiega quella pagina.
- **Il menu a sinistra** è diviso in quattro aree che si aprono e chiudono con un clic: **Lavoro**, **Contabilità**, **Documenti**, **Studio**. Dashboard e Aiuto sono sempre visibili. L'area della pagina in cui ci si trova resta aperta; le altre si ricordano come le si è lasciate.
**Aiuto** (`/aiuto`) è il manuale consultabile dentro l'app.

- A sinistra si trova l'**indice delle schede**, a destra il testo della scheda aperta.
- **Cerca nel manuale** trova una parola in tutte le schede e mostra la riga in cui compare.

### Note della beta
- **Il pulsante 📝 accanto al titolo**, uguale in ogni pagina, apre le note della pagina in cui ci si trova: chi prova il gestionale scrive lì cosa non funziona o cosa migliorerebbe, e sceglie se è un **errore**, un **miglioramento** o una **domanda**. Pagina, nome e data li aggiunge l'app. Il numero accanto all'icona dice quante note aperte ha quella pagina.
- Le note le scrive e le legge chi lavora nello studio; il cliente del portale non le vede. La propria nota si può eliminare finché è aperta.
- **Note della beta** (`/note-beta`, area Studio del menu, solo advisor e super admin) le raccoglie tutte, divise per pagina: da lì si segna **risolta** ciò che è stato sistemato, e **Copia tutto** mette l'elenco mostrato negli appunti, pronto da incollare a chi fa le correzioni.
- A beta finita si spengono da **Impostazioni → moduli in standby** («Note della beta»): spariscono il pulsante e la pagina, le note già scritte restano nel database.

## 📐 Calcoli & logica
- La ricerca ignora maiuscole e accenti: «attivita» trova anche «attività».
- Le note tecniche e la scheda sull'infrastruttura sono riservate al super admin.
- Le note della beta sono raggruppate per pagina e non per singola pratica: una nota scritta nel dettaglio di un progetto vale per la pagina «Dettaglio Progetto», e «Vai alla pagina» riporta al progetto da cui è stata scritta.

## 🔗 Collegamenti
- Ogni scheda descrive un modulo o una pagina dell'app; i rimandi §NN portano alla scheda con quel numero.

## ⚠️ Stati limite & errori
- Se il server non riesce a leggere le schede, la pagina dichiara che il manuale non è disponibile in questa installazione.
- Una nota della beta non salvata lo dichiara e il testo scritto resta nel campo; se le note non si leggono compare l'errore con «Riprova», non «nessuna nota».

## 🔧 Nota tecnica
- Frontend: `pages/AiutoPage.tsx`. Backend: `src/domain/manuale.ts`, rotte `/manuale`.
- Le schede sono i file `docs/manuale/NN-nome.md`; le riservate stanno in `SCHEDE_RISERVATE`.
- Note della beta: `components/beta/PulsanteNoteBeta.tsx`, `pages/NoteBetaPage.tsx`; regole in `src/domain/notaBeta.ts`, rotte `/note-beta` (`src/routes/noteBeta.ts`), tabella `nota_beta`.
