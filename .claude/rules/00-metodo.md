# Metodo di lavoro di Claude — COMUNE A TUTTI I PROGETTI

> File comune: identico in ogni repo, viene dallo Standard (repo `standard` dello stesso account)
> (`templates/.claude/rules/`). Non si modifica qui: si cambia nello standard e
> si riporta con `strumenti/aggiorna-metodo.sh`. Le differenze di questo
> progetto stanno in `90-progetto.md`, le regole del prodotto in `CLAUDE.md`.

1. **Tutto passa da una PR.** Mai push diretto sul ramo di produzione: il deploy
   accetta solo il merge di una PR (`deploy.yml`, job `verifica`).
2. **Il tecnico lo decide Claude** e lo dichiara nella PR («Ho deciso da solo»).
   A Fabio si chiede solo: una regola di business non scritta, una spesa,
   un'azione irreversibile su dati veri, un risultato che contraddice la richiesta.
   Le domande si fanno **all'inizio del giro**, tutte insieme, prima di scrivere
   codice, non a metà strada (Fabio, 11/11).
3. **Se manca qualcosa** (accesso, segreto, file, risposta): fermarsi e dirlo in
   una riga. Non inventare, non mockare, non aggirare un blocco.
4. **Ogni dato dichiara se è misurato, dichiarato o ipotizzato.** Un'ipotesi non
   si scrive come un fatto.
5. **Il merge è automatico.** Con prove verdi e `review-ok` la PR entra e va in
   produzione da sola: nessuna sessione chiede «mergia» e nessuna lo fa a mano.
   Il «mergia la #N» di Fabio serve **solo** su una PR `serve-fabio`: allora la
   sessione mette `ok-fabio` (arriva su Telegram) e il merge lo fa il giro
   automatico. Senza quella richiesta scritta una sessione non mette mai
   `ok-fabio`; le altre etichette le mette il revisore (Fabio, 11/11).
6. **Quello che Claude può fare, non lo fa Fabio.** A Fabio restano segreti,
   spese, impostazioni dell'account, decisioni di prodotto, e i passi che i
   blocchi di sicurezza di Claude non lasciano fare: un passo per riga, comandi
   completi. Mai chiedergli di incollare log o output che Claude può leggere.
7. **Le regole si applicano con criterio.** Sono vincolanti; ma se in un caso
   concreto una regola fa danno o non ha senso, Claude lo dice e propone di
   cambiarla (qui, in `90-progetto.md` o in `CLAUDE.md`), invece di applicarla
   alla cieca o di ignorarla in silenzio. In una regola finisce solo ciò che, se
   sbagliato, costa soldi, dati, sicurezza o produzione; il resto è un consiglio
   (`METODO.md` dello standard, «Convenzioni consigliate»). `CLAUDE.md` resta
   sotto le 150 righe e `90-progetto.md` sotto le 40: storia, perché e
   comportamenti vanno in DIARIO, ARCHITECTURE e DEPLOY (`aggiorna-metodo.sh`
   avvisa se si supera).
8. **Memoria e verifica.** Una decisione di prodotto va nel `DIARIO.md` del
   repo, una di metodo nel `DIARIO.md` dello standard, nello stesso commit della
   modifica, col perché e chi l'ha presa. Prima della PR: typecheck, build e le
   prove collegate ai file toccati, se ce ne sono (la suite intera la fa la CI,
   solo dove serve: punto 9). A Fabio si scrive solo quando serve un suo gesto o
   quando un lavoro è finito: corto, in italiano.
9. **Un giro, una PR, il controllo che serve** (Fabio, 10/11). Un messaggio di
   Fabio con più modifiche è un giro: tutte sullo stesso ramo, un commit per
   modifica, e la PR si apre a giro finito, aggiornata all'ultimo ramo di
   produzione; PR separate solo per una parte urgente o di un'altra area. Il
   livello lo decide `scripts/livello.sh` da `.github/livelli.txt` di
   produzione: **leggero** (documenti, file che non portano regole) niente prove
   e niente revisore; **normale** prove collegate e revisore; **sensibile**
   (soldi, dati, accessi: le aree a effort alto) suite intera, in parti
   parallele, e revisore. Nessuna PR ferma in silenzio: prove rosse e conflitti
   li riprende il correttore; la sentinella rilancia da sola ciò che il sistema sa
   sistemare (prove interrotte, correttore mai partito) e scrive a Fabio solo
   quando serve lui; la sessione che vede una PR ferma la sistema senza aspettarlo.
   Le prove non dipendono dal tempo reale (attese, soglie in secondi, orologio):
   solo il test che controlla apposta quel tempo può farlo.
10. **Thread dei Projects di Claude Code** (Fabio, 27/11). Un giro di Fabio è un
   thread, con le regole del punto 9: il coordinatore lo divide in più thread solo
   per un'altra area o una parte urgente. Il ramo del thread è quello che gli dà
   Claude Code (`claude/project-thread-…`) o `thread/<cosa>`: è il segno con cui gli
   script sanno che il correttore è il thread e non `fix.yml` (due correttori sullo
   stesso ramo si scrivono addosso); non si rinomina. Il thread apre la PR con gli
   strumenti GitHub che ha, la segue e corregge lui prove rosse e richieste del
   revisore; i giri li conta lo Standard (2 per motivo, poi `serve-fabio`), e se il
   thread non manda un commit entro un'ora la sentinella mette `serve-fabio`. I
   conflitti li allinea `fix.yml`: prima di ogni push il thread aggiorna il ramo.
   Mai merge (nemmeno «Merge it»), force-push o etichette diverse da `ok-fabio`
   (punto 5): il merge resta di `automerge.sh`. Decisioni e «ricorda che…» vanno nel
   repo (punto 8: DIARIO, o `90-progetto.md` se è metodo del progetto), non nella
   memoria del progetto, che può essere spenta. Fuori da un progetto (PC, issue) i
   rami restano `feat/…` e `fix/…`, e il correttore `fix.yml`.
