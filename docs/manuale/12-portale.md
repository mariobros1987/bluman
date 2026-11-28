# 12 · Portale Cliente

## 👤 Cosa fa e come si usa
Il **Portale** (`/portal`) è l'area del **cliente**, ad accesso **passwordless**: entra dal **Magic
Link** ricevuto via email (§02). Ha **7 schede**:
1. **Proposta e firma** — vede la proposta e la lettera d'incarico e la firma con **OTP** (art. 20 CAD);
2. **Avanzamento** — le fasi dell'incarico con lo stato calcolato dal server: «Da iniziare», «Inizia dopo un'altra fase», «In corso (x%)», «Completato»;
3. **Dati societari** — propone modifiche ai propri dati, che lo studio conferma;
4. **Documenti** — scarica/firma i documenti pubblicati, con cronologia versioni a ritroso; se lo studio usa il modulo KYC, carica qui i documenti d'identità;
5. **Fatture** — le sue fatture, con «Da pagare», «Pagata» e, per una rata non pagata oltre la scadenza, «Scaduta»;
6. **Messaggi** — messaggi con lo studio (anche Telegram/WhatsApp agganciati alla pratica);
7. **Profilo** — recapiti e password del portale (almeno 8 caratteri).

## 📐 Calcoli & logica
- Il cliente vede **solo i propri dati**: RLS per tenant + guard sul ruolo `cliente` (un token cliente
  non vede il parco progetti dello studio).
- L'avanzamento mostrato è quello **calcolato dal backend** (§01), non ricostruito nel browser.
- La **conclusione di un modulo** dal portale è una **firma FEA** (§11): impronta dal server, IP dal
  sigillo; niente scritture solo in `localStorage`.
- I documenti mostrano evidenza di firma solo se **esiste** un sigillo (regola 7).
- **La lettera d'incarico usa l'anagrafica dello studio del database** (nome, sede, P.IVA, IBAN,
  responsabile), la stessa che entra nell'impronta della firma: il portale la riceve da
  `GET /portal/contatti`. Finché non è arrivata la lettera non si mostra e non si firma; se non
  arriva, il portale lo dice e offre «Riprova». Un dato che lo studio non ha compilato compare nella
  lettera come «DATO MANCANTE».
- Il motivo per cui un canale del codice di firma non è disponibile è detto con parole per il
  cliente («Non attivo per questo studio», «Lo studio non ha il tuo cellulare»).
- La **lettera d'incarico** risulta firmata **per il progetto che si sta guardando**, non perché il
  cliente ne abbia firmata una in passato (§11). Aprendo un incarico nuovo la lettera è da firmare,
  anche se il cliente ha già firmato altri mandati. Senza nessun progetto aperto il pulsante di
  firma resta spento e il portale dice perché.

## 🔗 Collegamenti
- **Clienti** (§02): accesso via Magic Link.
- **Progetti** (§01): avanzamento e conclusione moduli.
- **Documenti & Firma** (§10–11): pubblicazione e firma OTP.
- **Fatture** (§05) e **Comunicazioni** (§15).

## ⚠️ Stati limite & errori
- Magic link scaduto/inventato → **401**; token valido → JWT col tenant preso dalla riga.
- Firmare un modulo non `done` o non proprio → **409**.
- Empty state sinceri (nessun documento/fattura ancora).
- Anagrafica dello studio non letta → al posto della lettera un avviso con «Riprova»; niente firma.
- Modulo KYC spento → la sezione dei documenti d'identità non compare.

## 🔧 Nota tecnica
- Frontend: `pages/ClientPortal.tsx` + `components/portal/` (18 componenti presentazionali: login, 7
  tab, modali, `usePortalData`, `mapPortalModules`).
- Rotte: `src/routes/portale.ts` (`/portal/contatti` con l'anagrafica dello studio, `/portal/fatture`
  con `scaduta`, `/portal/kyc/documenti`, `/portal/kyc/documento`), `src/routes/firma.ts`
  (`/portal/request-otp`, `/portal/verify-otp-and-sign`, `/portal/firma-con-file`); login
  `POST /auth/magic-login`. Le rotte che la sessione del cliente può usare sono l'elenco
  `ROTTE_CLIENTE_CONSENTITE` (`src/util/authorization.ts`).
- Lettera: `components/portal/letteraIncaricoHtml.ts`; anagrafica dello studio e copia locale:
  `useContattiStudioPortale.ts`; stato dei moduli: `faseModulo.ts`.
- Fonti: `.agents/AGENTS.md`, `spec-portale-moduli-firma.md`.
