# 30 · Aiuto

## 👤 Cosa fa e come si usa
- **Il menu a sinistra** è diviso in quattro aree che si aprono e chiudono con un clic: **Lavoro**, **Contabilità**, **Documenti**, **Studio**. Dashboard e Aiuto sono sempre visibili. L'area della pagina in cui ci si trova resta aperta; le altre si ricordano come le si è lasciate.
**Aiuto** (`/aiuto`) è il manuale consultabile dentro l'app.

- A sinistra si trova l'**indice delle schede**, a destra il testo della scheda aperta.
- **Cerca nel manuale** trova una parola in tutte le schede e mostra la riga in cui compare.

## 📐 Calcoli & logica
- La ricerca ignora maiuscole e accenti: «attivita» trova anche «attività».
- Le note tecniche e la scheda sull'infrastruttura sono riservate al super admin.

## 🔗 Collegamenti
- Ogni scheda descrive un modulo o una pagina dell'app; i rimandi §NN portano alla scheda con quel numero.

## ⚠️ Stati limite & errori
- Se il server non riesce a leggere le schede, la pagina dichiara che il manuale non è disponibile in questa installazione.

## 🔧 Nota tecnica
- Frontend: `pages/AiutoPage.tsx`. Backend: `src/domain/manuale.ts`, rotte `/manuale`.
- Le schede sono i file `docs/manuale/NN-nome.md`; le riservate stanno in `SCHEDE_RISERVATE`.
