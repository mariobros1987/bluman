# 12 · Portale Cliente

## 👤 Cosa fa e come si usa
Il **Portale** (`/portal`) è l'area del **cliente**, ad accesso **passwordless**: entra dal **Magic
Link** ricevuto via email (§02). Ha **9 schede**, e si apre sulla prima:
1. **Riepilogo** — la pagina personale: in testa «Tocca a te» con le cose da fare, ognuna col tasto che porta alla scheda giusta; sotto, per ogni incarico, le fasi con lo stato calcolato dal server e chi ci sta lavorando (lo studio o il cliente). Se non c'è niente da fare lo dice;
2. **Da fare** — le richieste dello studio fase per fase: dati da compilare, documenti da mandare, cose da confermare. Il cliente risponde da qui; i dati già dati allo studio in un'altra richiesta arrivano precompilati;
3. **Proposta e firma** — vede la proposta e la lettera d'incarico e la firma con **OTP** (art. 20 CAD);
4. **Avanzamento** — le fasi dell'incarico con lo stato calcolato dal server: «Da iniziare», «Inizia dopo un'altra fase», «In corso (x%)», «Completato»;
5. **Dati societari** — propone modifiche ai propri dati, che lo studio conferma;
6. **Documenti** — scarica/firma i documenti pubblicati, con cronologia versioni a ritroso; se lo studio usa il modulo KYC, carica qui i documenti d'identità;
7. **Fatture** — le sue fatture, con «Da pagare», «Pagata» e, per una rata non pagata oltre la scadenza, «Scaduta»;
8. **Messaggi** — il **canale protetto** con lo studio: testo e file (fino a 5, 15 MB l'uno), conservati cifrati (§15);
9. **Profilo** — recapiti e password del portale (almeno 8 caratteri).

**Dallo studio.** Una richiesta al cliente è un passaggio «a carico del cliente» di un'attività
(§01): un form con i campi da compilare, un documento, una conferma. Sopra i moduli della pratica la
riga «In mano al cliente» dice quanti sono aperti e quanti hanno già la risposta, e il tasto
**«Avvisa il cliente»** gli manda l'avviso. La risposta del cliente si legge nel passaggio: l'operatore
la controlla, la porta nei dati con «Usa», e chiude il passaggio col ✓.

## 📐 Calcoli & logica
- Il cliente vede **solo i propri dati**: RLS per tenant + guard sul ruolo `cliente` (un token cliente
  non vede il parco progetti dello studio).
- L'avanzamento mostrato è quello **calcolato dal backend** (§01), non ricostruito nel browser.
- **«Tocca a te»** lo compone il server (`GET /portal/riepilogo`), in quest'ordine: lettera d'incarico
  da firmare, richieste dello studio nelle fasi già avviate, fasi concluse da confermare, fatture da
  pagare (prima le scadute), messaggi non letti. I documenti da firmare si aggiungono dall'elenco dei
  documenti. Una richiesta di una fase non ancora avviata sta in «Più avanti» e non conta.
- **Di chi è il turno**: del cliente se ha almeno una cosa da fare su quell'incarico, altrimenti
  dello studio.
- **La risposta del cliente non chiude la richiesta**: resta «Inviata, in controllo» finché
  l'operatore non chiude il passaggio. È scritta a parte da ciò che registra lo studio, così un
  salvataggio dello studio non la cancella e si sa sempre chi ha scritto cosa.
- **Precompilazione** (risposta 16 del titolare): un campo con la stessa etichetta di uno già
  compilato in un'altra richiesta dello stesso incarico arriva già pieno. Vale il dato registrato
  dallo studio; in mancanza, l'ultima risposta del cliente.
- **L'avviso al cliente** parte solo dal tasto «Avvisa il cliente», non a ogni salvataggio: campanella
  del portale, ed email se non ha già un avviso uguale da leggere. Dice quante richieste ci sono,
  non cosa contengono.
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
- Riepilogo non letto → lo dice («Non vuol dire che non ci sia niente da fare») e offre «Riprova»:
  non mostra «niente da fare».
- Risposta a una richiesta con un campo lasciato vuoto, o a una richiesta già chiusa → rifiutata
  con il motivo; il testo scritto resta nel modulo.
- «Avvisa il cliente» senza richieste aperte nelle fasi avviate → **409**, con la spiegazione.

## 🔧 Nota tecnica
- Frontend: `pages/ClientPortal.tsx` + `components/portal/` (login, 9 tab, modali, `usePortalData`,
  `mapPortalModules`). Pagina personale: `TabRiepilogo.tsx`, `TabRichieste.tsx`, `SchedaRichiesta.tsx`,
  `usePortalRiepilogo.ts`, `azioniCliente.ts`; messaggi: `TabMessaggi.tsx`, `useCanaleProtetto.ts`;
  chiamate: `api/canaleProtetto.ts`. Lato studio: `projectDetail/RichiesteAlCliente.tsx`,
  `passaggio/ModaleFormPassaggio.tsx`.
- Riepilogo e richieste: `src/routes/portaleRiepilogo.ts` (`GET /portal/riepilogo`,
  `POST /portal/richieste/:passaggioId/risposta`, `POST /progetti/:id/richieste-cliente/avviso`), logica
  pura in `src/services/riepilogoCliente.ts`. Le risposte del cliente stanno in
  `passaggio_progetto.risposte_cliente_json` e `risposta_cliente_at`.
- Ciò che un progetto mostra al cliente lo decide `src/services/proiezioneProgetto.ts`: niente dati
  di accesso, tariffe del team, note interne, bozze di fattura.
- Rotte: `src/routes/portale.ts` (`/portal/contatti` con l'anagrafica dello studio, `/portal/fatture`
  con `scaduta`, `/portal/kyc/documenti`, `/portal/kyc/documento`), `src/routes/firma.ts`
  (`/portal/request-otp`, `/portal/verify-otp-and-sign`, `/portal/firma-con-file`); login
  `POST /auth/magic-login`. Le rotte che la sessione del cliente può usare sono l'elenco
  `ROTTE_CLIENTE_CONSENTITE` (`src/util/authorization.ts`).
- Lettera: `components/portal/letteraIncaricoHtml.ts`; anagrafica dello studio e copia locale:
  `useContattiStudioPortale.ts`; stato dei moduli: `faseModulo.ts`.
- Fonti: `.agents/AGENTS.md`, `spec-portale-moduli-firma.md`.
