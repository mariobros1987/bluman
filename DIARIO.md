# DIARIO — BluMan

Decisioni con il perché, una riga ciascuna, per data. Lo scrive chi fa la
modifica, o l'attività settimanale dai corpi delle PR. Non è un log: ci va solo ciò che un giorno
qualcuno vorrà sapere il perché. Prima del 17/11/2026 la storia sta in ISTRUZIONI_PER_IA.md,
README.md e `docs/storico/`.

## 2026-11-03
- Piano delle correzioni dalla diagnosi del 02/11 (PIANO.md): permessi, importi, dati inventati, sicurezza; il backlog del titolare resta in LAVORO_RIMANENTE.md e non si tocca (Fabio).

## 2026-11-17
- Pubblicazione accidentale: alle 10:56 un push di `5a9c293` (il `main` delle correzioni, fino allo step D1) è finito su `main` di `mariobros1987/bluman`, che nel clone era ancora `origin`. Nessuna migrazione dentro; Railway e Vercel hanno pubblicato da soli; blusmart.eu non è stato toccato (lo aggiorna solo il titolare). Da qui: `upstream` = `mariobros1987/bluman` con push disattivato (`NO_PUSH`), `origin` = il fork `wolftradesystem-tech/bluman` (Fabio).
- Adottato lo Standard sul fork, senza deploy dal fork (Fabio): qui girano CI, revisore, correttore, task, merge automatico, sentinella e riepilogo; la produzione del fork è `main`. Pubblicare = PR da `wolftradesystem-tech:main` a `mariobros1987/bluman` `main`, unita con `gh pr merge` solo su «pubblica» di Fabio; all'unione Railway e Vercel (bluman.vercel.app, copia di riserva) pubblicano da soli, blusmart.eu (server Register.it, la produzione usata dallo studio) solo il titolare con `scripts/distribuisci.sh --solo-vps`.
- Una pubblicazione che cambia `prisma/migrations` si unisce solo dopo un backup del DB di produzione, perché Railway applica le migrazioni all'avvio senza backup (Fabio); la PR lo segnala da sola: lo scrive `scripts/pubblica.sh` in testa, e con `--merge` rifiuta senza `--backup-fatto` (Claude, il come).
- I workflow con secret (review, fix, task, automerge, sentinella, riepilogo, deploy) hanno la guardia `if: github.repository == 'wolftradesystem-tech/bluman'`, perché con la pubblicazione arrivano anche nel repo del titolare; `ci.yml` senza guardia (Fabio). Fuori dal fork `ci.yml` gira sulle macchine di GitHub coi minuti del titolare, com'era prima; nel fork sui runner «ci» del PC (Claude, il come).
- `deploy.yml` nel fork non deploya: segna su Telegram che `main` è avanzato e se la prossima pubblicazione porta migrazioni. Esiste perché `automerge.sh`, comune e identico in ogni progetto, lo lancia dopo ogni merge e senza di lui avviserebbe «deploy non partito» a ogni PR; Fabio aveva chiesto «niente deploy.yml», che va letto come «nessun deploy dal fork»: confermato da Fabio il 17/11 (Claude il come).
- Tutti i job girano sui runner «ci» del PC, anche quelli che nel metodo stanno sui server (etichetta, merge, verifica, riepilogo, sentinella), perché il fork non ha server. Limite dichiarato: col PC spento non gira niente, e la separazione «il PC non mergia» del 09/11 qui non c'è (Claude).
- Il fork è pubblico, e un fork non cambia visibilità: revisore e merge solo su PR da rami del fork stesso, e la CI di una PR da un fork esterno parte solo con l'approvazione di Fabio (impostazione «approvazione per tutti i collaboratori esterni» del repo) (Claude).
- Schema con `prisma migrate dev` e migrazioni versionate (regola 2 del titolare), non `db push` come nel metodo comune; npm, non pnpm; Node 22 in CI; bot Telegram nuovo e dedicato (`bluman_ci_bot`); backup fuori dal server: no, non è del fork (Fabio).
- Documenti in radice del titolare (ISTRUZIONI_PER_IA, LAVORO_RIMANENTE, guide, specifiche) lasciati dove stanno: spostarli in `docs/storico/` cambia i rimandi di README, manuale e `credenziali.test.ts`, ed è lavoro da concordare col titolare (PIANO, step Standard S.4 e 5.1) (Claude).
- Vercel: Fabio dice che all'unione pubblica da solo; `docs/manuale/19-infra-deploy.md` dice che il deploy Vercel da webhook GitHub resta `BLOCKED` e che pubblica solo la CLI. Da misurare alla prima pubblicazione (dichiarato, non misurato).

## 2026-11-27
- Giro di correzioni dopo l'analisi del 26/11 (Fabio: «vai così»): si corregge tutto ciò che non chiede una regola di business nuova; blocchi, storni, IVA trimestrale e fatturazione fuori Italia aspettano il titolare. Numerazione E/F/G/M del rapporto `BluMan_Analisi_26-11-2026.pdf`.
- E1 — Document Studio parte dal livello di firma del modello con cui si apre, e un documento salvato riparte dal suo: prima il livello si ereditava solo scegliendo il modello dalla barra laterale, quindi un modello FEA aperto dalla Cartella Modelli si salvava come firma semplice. Nessuna regola nuova: il livello resta modificabile dall'operatore (se imporre un minimo è la domanda D11 per il titolare).
- E3 — la Coda KYC legge prima i moduli dello studio e poi la coda, e una coda non letta è un errore con «Riprova»: a modulo spento il server risponde 403 alla coda, e letta insieme ai moduli quella risposta faceva comparire «nessuna pratica in coda: tutte gestite» con il pannello di approvazione sotto.
- F6 — la voce di menu «Coda KYC / AML» segue il modulo: sparisce quando il server dice che è spento (non concesso, o in standby), resta quando non si sa. Deciso da Claude: è la stessa regola dello standby degli altri moduli, non una regola nuova.

## 2026-11-18
- Fornitori, fatture d'acquisto e liquidazione IVA seguono la chiave `invoices` anche via API (Fabio: «sistema tutto», proposta di Claude): l'app le nascondeva già a chi non ha Fatture, ma le rotte erano fuori matrice e senza controllo di ruolo. Nessuna voce nuova in matrice; le giurisdizioni restano leggibili da tutti e si scrivono con `library = write`.
- Una fattura d'acquisto è «la stessa» se ha stesso fornitore, stesso numero e stesso anno del documento: la seconda registrazione o il secondo import rispondono 409. Controllo applicativo, senza vincolo UNIQUE a database: metterlo chiede una migrazione e prima va verificato che in produzione non esistano già doppioni (deciso da Claude, da riprendere col titolare).
- Il saldo di una fattura d'acquisto e la sua uscita in Prima Nota stanno in una transazione sola, e il passaggio a saldata è condizionato a `pagata = false`: prima un errore a metà lasciava la fattura saldata senza movimento.
- La pagina Pagamenti (`/payments`) resta fuori dal menu ma il suo «Sollecita» ora apre l'invio vero dello Scadenzario: se tenerla o toglierla è una decisione di prodotto ancora aperta.
- Dodici schede nuove nel manuale (20–31) per le pagine che non ne avevano una; la 31 (Multi-Tenant Admin) è riservata al super admin come la 19. Scritte leggendo il codice, non provando l'app: da rileggere con chi la usa.
- Non corretto, solo dichiarato nella scheda 28: nel Log Audit i filtri per ruolo e categoria agiscono sulla pagina visualizzata (le etichette lo dicono già); portarli sul server chiede di decidere come si classificano le azioni.
