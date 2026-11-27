# 24 · Banche & Conti

## 👤 Cosa fa e come si usa
**Banche & Conti** (`/banks`) mostra la liquidità dello studio e i conti su cui si appoggiano incassi e pagamenti.

- **In alto**: **Liquidità complessiva** dello studio e numero di conti registrati.
- **Per ogni conto**: nome, banca, IBAN, BIC/SWIFT e **saldo attuale**. Il conto predefinito è evidenziato.
- **+ Nuovo Conto / Cassa**: si indicano nome del conto e istituto (obbligatori), IBAN, BIC/SWIFT, saldo iniziale e se usarlo come conto predefinito per l'accredito delle fatture. Si può registrare anche la cassa contanti.

## 📐 Calcoli & logica
- Il saldo di un conto è **saldo iniziale + entrate − uscite** dei suoi movimenti (§07).
- All'apertura della pagina il saldo viene ricontrollato sui movimenti e riallineato se necessario.
- Un incasso senza conto indicato usa quello di accredito della fattura e, in mancanza, il **conto predefinito** (§06).

## 🔗 Collegamenti
- **Prima Nota** (§07), **Scadenzario** (§06), **Fornitori** (§23).

## ⚠️ Stati limite & errori
- **Saldo fermo a zero con incassi registrati**: succede se gli incassi sono stati registrati senza conto. In Prima Nota quei movimenti portano «⚠ Conto non indicato».
- Se la lettura non riesce, la pagina lo dichiara e propone **Riprova**.
- Senza conti, invita a configurare il primo.
- Da questa pagina i conti si aggiungono soltanto: non sono presenti comandi per modificarli o eliminarli.

## 🔧 Nota tecnica
- Frontend: `pages/BanksPage.tsx`. Rotte: `/conti-bancari` in `src/routes/contabilitaContiReport.ts`, chiave RBAC `banks`.
- Saldo ricalcolato dai movimenti alla lettura (`domain/saldoConto.ts`).
