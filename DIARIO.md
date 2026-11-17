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
