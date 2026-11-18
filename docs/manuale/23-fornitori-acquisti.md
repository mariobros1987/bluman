# 23 · Fornitori & Acquisti

## 👤 Cosa fa e come si usa
**Fornitori & Acquisti** (`/fornitori`) gestisce il ciclo passivo: l'anagrafica dei fornitori, le fatture ricevute e il loro pagamento.

- **Riepilogo**: totale acquisti e costi, IVA a credito detraibile, fatture da saldare e numero di fornitori in anagrafica.
- **Registro Fatture d'Acquisto**: elenco con data, numero, fornitore, imponibile, IVA, totale e stato di pagamento. Si filtra per **Tutte**, **Aperte** o **Saldate** e si cerca per fornitore, partita IVA o numero.
- **Anagrafica Fornitori**: **+ Nuovo Fornitore ERP** apre una scheda con dati fiscali e SDI, sede e recapiti, pagamenti e IBAN, fatture e note interne. Un doppio clic sulla riga apre la scheda esistente.

**Registrare una fattura d'acquisto** si può fare in due modi, da **Registra / Importa Fattura Passiva**:

1. **Manuale**: si scelgono fornitore, esigibilità IVA (immediata, differita o split payment), numero e data, poi si compilano le righe con descrizione, categoria di spesa, quantità, prezzo e aliquota IVA (22, 10, 5, 4 o 0%).
2. **Da file XML**: si carica la fattura elettronica FatturaPA 1.2 (`.xml` o `.p7m` firmato), oppure se ne incolla il testo.

**Saldare una fattura**: dal pulsante **Salda** si indicano data del pagamento, metodo, riferimento (CRO/TRN) e note. Se il pagamento è già avvenuto, in fase di registrazione manuale si può spuntare **Registra Pagamento Immediato**.

## 📐 Calcoli & logica
- Il pagamento scrive automaticamente l'**uscita in Prima Nota** (§07).
- L'IVA delle fatture d'acquisto alimenta il **credito IVA** della liquidazione periodica (§08).
- I totali del riepilogo riguardano tutte le fatture registrate e non cambiano con la ricerca o i filtri.
- L'accesso segue il permesso del modulo **Fatture** (§17), anche via API; il collaboratore esterno è sempre escluso.

## 🔗 Collegamenti
- **Prima Nota** (§07), **Liquidazione IVA** (§08), **Banche & Conti** (§24).

## ⚠️ Stati limite & errori
- L'eliminazione di un fornitore chiede conferma; se non è possibile, compare il motivo.
- Se il caricamento non riesce, la pagina lo dichiara e propone **Riprova**.
- Registrare o importare una fattura già presente (stesso fornitore, stesso numero, stesso anno) → **409**: non entra una seconda volta.
- Saldare una fattura già saldata → **409**. Saldo e uscita in Prima Nota avvengono insieme o per niente.

## 🔧 Nota tecnica
- Frontend: `pages/FornitoriPage.tsx`, `components/fornitori/`.
- Rotte: `src/routes/fornitori.ts` (`/fornitori`, `/fatture-ricevute`, `import-xml`, `:id/paga`), chiave RBAC `invoices`.
- Regole di doppione e saldo: `src/services/fatturaPassiva.ts`; movimento e saldo: `src/services/primaNotaMovimento.ts`.
